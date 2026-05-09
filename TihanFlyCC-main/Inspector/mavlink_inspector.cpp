#include "mavlink_inspector.h"

#include <sstream>
#include <iomanip>
#include <cstring>
#include <algorithm>

// ─── helpers ───────────────────────────────────────────────────────────────

static std::string json_escape(const std::string& s)
{
    std::string out;
    out.reserve(s.size() + 4);
    for (unsigned char c : s)
    {
        if      (c == '"')  out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if (c < 0x20)  { char buf[8]; snprintf(buf, sizeof(buf), "\\u%04x", c); out += buf; }
        else                out += static_cast<char>(c);
    }
    return out;
}

// ─── Static reflection tables ──────────────────────────────────────────────
// MAVLINK_MESSAGE_INFO and MAVLINK_MESSAGE_NAMES are always defined by
// ardupilotmega/mavlink.h — no special compile flags needed.

static const mavlink_message_info_t s_msg_info[] = MAVLINK_MESSAGE_INFO;
static constexpr size_t s_msg_info_count =
    sizeof(s_msg_info) / sizeof(s_msg_info[0]);

static const struct { const char* name; uint32_t msgid; }
    s_msg_names[] = MAVLINK_MESSAGE_NAMES;
static constexpr size_t s_msg_names_count =
    sizeof(s_msg_names) / sizeof(s_msg_names[0]);

// Binary search over s_msg_info (sorted by msgid)
static const mavlink_message_info_t* find_msg_info(uint32_t msgid)
{
    size_t lo = 0, hi = s_msg_info_count;
    while (lo < hi)
    {
        size_t mid = (lo + hi) / 2;
        if      (s_msg_info[mid].msgid < msgid) lo = mid + 1;
        else if (s_msg_info[mid].msgid > msgid) hi = mid;
        else                                    return &s_msg_info[mid];
    }
    return nullptr;
}

// ─── MessageEntry ──────────────────────────────────────────────────────────

float MavlinkInspector::MessageEntry::rate_hz() const
{
    if (timestamps.size() < 2) return 0.0f;

    auto now    = std::chrono::steady_clock::now();
    auto cutoff = now - std::chrono::seconds(MavlinkInspector::RATE_WINDOW_SEC);

    int in_window = 0;
    for (auto& ts : timestamps)
        if (ts >= cutoff) ++in_window;

    if (in_window < 2) return 0.0f;

    float dur = std::chrono::duration<float>(
                    timestamps.back() - timestamps.front()).count();
    if (dur <= 0.0f) return 0.0f;

    return static_cast<float>(in_window - 1) / dur;
}

// ─── MavlinkInspector ──────────────────────────────────────────────────────

MavlinkInspector::MavlinkInspector(asio::io_context& io)
    : io_(io), timer_(io)
{}

void MavlinkInspector::set_ws_callback(WsCallback cb)
{
    ws_callback_ = std::move(cb);
}

void MavlinkInspector::start()
{
    running_ = true;
    schedule_timer();
}

void MavlinkInspector::stop()
{
    running_ = false;
    timer_.cancel();
}

void MavlinkInspector::on_message(const mavlink_message_t& msg)
{
    auto now = std::chrono::steady_clock::now();

    std::lock_guard<std::mutex> lock(mutex_);
    auto& entry = entries_[msg.msgid];

    if (entry.name.empty())
        entry.name = message_name(msg.msgid);

    ++entry.count;

    entry.timestamps.push_back(now);
    auto cutoff = now - std::chrono::seconds(RATE_WINDOW_SEC + 1);
    while (!entry.timestamps.empty() && entry.timestamps.front() < cutoff)
        entry.timestamps.pop_front();

    decode_fields(msg, entry.fields);
}

// ─── Timer ─────────────────────────────────────────────────────────────────

void MavlinkInspector::schedule_timer()
{
    timer_.expires_after(std::chrono::milliseconds(BROADCAST_INTERVAL_MS));
    timer_.async_wait([this](const std::error_code& ec) { on_timer(ec); });
}

void MavlinkInspector::on_timer(const std::error_code& ec)
{
    if (ec || !running_) return;
    broadcast_snapshot();
    schedule_timer();
}

// ─── JSON broadcast ────────────────────────────────────────────────────────

void MavlinkInspector::broadcast_snapshot()
{
    if (!ws_callback_) return;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (entries_.empty()) return;   // no messages yet — skip empty broadcast
    }

    std::string json;
    json.reserve(4096);
    json += R"({"type":"mavlink_inspector","messages":[)";

    bool first_msg = true;
    {
        std::lock_guard<std::mutex> lock(mutex_);

        std::vector<std::pair<uint32_t, const MessageEntry*>> sorted;
        sorted.reserve(entries_.size());
        for (auto& kv : entries_)
            sorted.push_back({kv.first, &kv.second});
        std::sort(sorted.begin(), sorted.end(),
                  [](auto& a, auto& b){ return a.first < b.first; });

        for (auto& [id, ep] : sorted)
        {
            const MessageEntry& e = *ep;
            if (!first_msg) json += ',';
            first_msg = false;

            char rate_buf[32];
            snprintf(rate_buf, sizeof(rate_buf), "%.2f", e.rate_hz());

            json += "{\"id\":";
            json += std::to_string(id);
            json += ",\"name\":\"";
            json += json_escape(e.name);
            json += "\",\"rate\":";
            json += rate_buf;
            json += ",\"count\":";
            json += std::to_string(e.count);
            json += ",\"fields\":{";

            bool first_field = true;
            for (auto& [fname, fval] : e.fields)
            {
                if (!first_field) json += ',';
                first_field = false;
                json += '"';
                json += json_escape(fname);
                json += "\":\"";
                json += json_escape(fval);
                json += '"';
            }

            json += "}}";
        }
    }

    json += "]}";
    ws_callback_(json);
}

// ─── Field decoding ────────────────────────────────────────────────────────

void MavlinkInspector::decode_fields(const mavlink_message_t& msg,
                                      std::unordered_map<std::string, std::string>& out)
{
    const mavlink_message_info_t* info = find_msg_info(msg.msgid);
    if (!info)
    {
        // Unknown message: show raw payload hex
        const uint8_t* p = reinterpret_cast<const uint8_t*>(msg.payload64);
        std::string hex;
        hex.reserve(msg.len * 3);
        char buf[4];
        for (uint8_t i = 0; i < msg.len; ++i)
        {
            snprintf(buf, sizeof(buf), "%02X ", p[i]);
            hex += buf;
        }
        out["payload_hex"] = std::move(hex);
        return;
    }

    const uint8_t* payload = reinterpret_cast<const uint8_t*>(msg.payload64);

    for (unsigned i = 0; i < info->num_fields; ++i)
    {
        const mavlink_field_info_t& f = info->fields[i];
        const uint8_t* ptr = payload + f.wire_offset;

        unsigned alen = (f.array_length > 0) ? f.array_length : 1;

        std::string value;
        value.reserve(32 * alen);

        for (unsigned ai = 0; ai < alen; ++ai)
        {
            if (ai > 0) value += ',';

            switch (f.type)
            {
                case MAVLINK_TYPE_CHAR:
                {
                    if (f.array_length > 0)
                    {
                        char buf[256] = {};
                        size_t copy = std::min<size_t>(f.array_length, sizeof(buf)-1);
                        memcpy(buf, payload + f.wire_offset, copy);
                        value = std::string(buf);
                        ai = alen;
                        break;
                    }
                    char c = static_cast<char>(*(ptr + ai));
                    value += (c >= 32 && c < 127) ? c : '?';
                    break;
                }
                case MAVLINK_TYPE_UINT8_T:
                { uint8_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_INT8_T:
                { int8_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string((int)v); break; }
                case MAVLINK_TYPE_UINT16_T:
                { uint16_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_INT16_T:
                { int16_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_UINT32_T:
                { uint32_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_INT32_T:
                { int32_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_UINT64_T:
                { uint64_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_INT64_T:
                { int64_t v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v)); value += std::to_string(v); break; }
                case MAVLINK_TYPE_FLOAT:
                {
                    float v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v));
                    char buf[32]; snprintf(buf, sizeof(buf), "%.6g", (double)v);
                    value += buf; break;
                }
                case MAVLINK_TYPE_DOUBLE:
                {
                    double v; memcpy(&v, ptr+ai*sizeof(v), sizeof(v));
                    char buf[32]; snprintf(buf, sizeof(buf), "%.10g", v);
                    value += buf; break;
                }
                default: value += '?'; break;
            }
        }

        out[f.name] = std::move(value);
    }
}

// ─── Name lookup ───────────────────────────────────────────────────────────

std::string MavlinkInspector::message_name(uint32_t msgid)
{
    for (size_t i = 0; i < s_msg_names_count; ++i)
        if (s_msg_names[i].msgid == msgid)
            return std::string(s_msg_names[i].name);

    return "MSG_" + std::to_string(msgid);
}
