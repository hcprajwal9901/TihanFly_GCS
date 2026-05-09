/**
 * parameter_manager.cpp
 * TiHANFly GCS — Parameter Manager (MAVLink ↔ WebSocket Bridge)
 *
 * Implements PARAM_REQUEST_LIST / PARAM_VALUE / PARAM_SET / PARAM_REQUEST_READ.
 * See parameter_manager.h for the full API and JSON wire protocol.
 *
 * Place this file in:  TiHANFly/Parameters/parameter_manager.cpp
 */

#include "parameter_manager.h"
#include <chrono>
#include <cstring>

// ─────────────────────────────────────────────────────────────────────────────
//  Constructor / Dependency Injection
// ─────────────────────────────────────────────────────────────────────────────

ParameterManager::ParameterManager(int sysid, int compid)
    : sysid_(sysid), compid_(compid)
{
    std::cout << "[ParameterManager] Initialized (sysid=" << sysid_
              << " compid=" << compid_ << ")\n";
}

void ParameterManager::setSendCallback(SendCb cb)
{
    send_cb_ = std::move(cb);
}

void ParameterManager::setTransportCallback(TransportCb cb)
{
    transport_cb_ = std::move(cb);
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAVLink Inbound Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::processMessage(const mavlink_message_t& msg)
{
    // We only care about PARAM_VALUE here; extend this switch for
    // PARAM_EXT_VALUE or other parameter-related messages if needed.
    switch (msg.msgid)
    {
        case MAVLINK_MSG_ID_PARAM_VALUE:
            handle_param_value(msg);
            break;

        default:
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARAM_VALUE Handler
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::handle_param_value(const mavlink_message_t& msg)
{
    mavlink_param_value_t pv{};
    mavlink_msg_param_value_decode(&msg, &pv);

    const std::string name = trim_param_name(pv.param_id);

    // Update total param count
    if (total_.load() != static_cast<int>(pv.param_count))
        total_.store(static_cast<int>(pv.param_count));

    Parameter p;
    {
        std::lock_guard<std::mutex> lk(mutex_);

        auto it = params_.find(name);
        bool is_new = (it == params_.end());

        if (is_new)
        {
            // First time we see this parameter — record it as default too
            p.name        = name;
            p.value       = pv.param_value;
            p.default_val = pv.param_value;  // FC baseline value
            p.default_set = true;
            p.type        = pv.param_type;
            p.index       = pv.param_index;
            p.count       = pv.param_count;
            params_[name] = p;
            received_.fetch_add(1);
        }
        else
        {
            // Known parameter — update value only; preserve original default
            it->second.value = pv.param_value;
            it->second.type  = pv.param_type;
            it->second.index = pv.param_index;
            it->second.count = pv.param_count;
            p = it->second;
        }
    }

    // Push individual parameter update to all WebSocket clients
    push_param_update(p);

    // If we are mid-load, push progress and check for completion
    if (loading_.load())
    {
        push_load_progress();

        const int rcv = received_.load();
        const int tot = total_.load();

        if (tot > 0 && rcv >= tot)
        {
            loading_.store(false);

            const int64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now().time_since_epoch()).count();
            const int64_t elapsed = now_ms - load_start_ms_.load();

            json done;
            done["type"]       = "param_load_complete";
            done["count"]      = rcv;
            done["elapsed_ms"] = elapsed;
            done["message"]    = "All " + std::to_string(rcv)
                                 + " parameters loaded in "
                                 + std::to_string(elapsed) + " ms";

            std::cout << "[ParameterManager] Load complete: " << rcv
                      << " params in " << elapsed << " ms\n";

            if (send_cb_) send_cb_(done.dump());
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Commands — called from WebSocket handler thread
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::requestAllParameters()
{
    if (!transport_cb_)
    {
        push_error("No transport — cannot send PARAM_REQUEST_LIST");
        return;
    }

    // Clear local cache and reset counters
    {
        std::lock_guard<std::mutex> lk(mutex_);
        params_.clear();
    }
    received_.store(0);
    total_.store(0);
    loading_.store(true);
    load_start_ms_.store(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());

    // Notify the frontend
    json start;
    start["type"]    = "param_load_start";
    start["message"] = "Requesting all parameters from flight controller…";
    if (send_cb_) send_cb_(start.dump());

    // Build and send PARAM_REQUEST_LIST
    mavlink_param_request_list_t req{};
    req.target_system    = static_cast<uint8_t>(sysid_);
    req.target_component = static_cast<uint8_t>(compid_);

    mavlink_message_t mavmsg;
    mavlink_msg_param_request_list_encode(
        255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &req);
    transport_cb_(mavmsg);

    std::cout << "[ParameterManager] Sent PARAM_REQUEST_LIST "
              << "(target=" << sysid_ << "/" << compid_ << ")\n";
}

void ParameterManager::requestParameter(const std::string& param_name)
{
    if (!transport_cb_)
    {
        push_error("No transport — cannot send PARAM_REQUEST_READ");
        return;
    }

    mavlink_param_request_read_t req{};
    req.target_system    = static_cast<uint8_t>(sysid_);
    req.target_component = static_cast<uint8_t>(compid_);
    req.param_index      = -1;   // -1 → look up by name, not index

    std::memset(req.param_id, 0, sizeof(req.param_id));
    std::strncpy(req.param_id, param_name.c_str(), sizeof(req.param_id) - 1);

    mavlink_message_t mavmsg;
    mavlink_msg_param_request_read_encode(
        255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &req);
    transport_cb_(mavmsg);

    std::cout << "[ParameterManager] Sent PARAM_REQUEST_READ for '"
              << param_name << "'\n";
}

void ParameterManager::setParameter(const std::string& param_name,
                                    float value, uint8_t type)
{
    if (!transport_cb_)
    {
        push_error("No transport — cannot send PARAM_SET for '" + param_name + "'");
        return;
    }

    // Build PARAM_SET message
    mavlink_param_set_t ps{};
    ps.target_system    = static_cast<uint8_t>(sysid_);
    ps.target_component = static_cast<uint8_t>(compid_);
    ps.param_value      = value;
    ps.param_type       = type;

    std::memset(ps.param_id, 0, sizeof(ps.param_id));
    std::strncpy(ps.param_id, param_name.c_str(), sizeof(ps.param_id) - 1);

    mavlink_message_t mavmsg;
    mavlink_msg_param_set_encode(
        255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &ps);
    transport_cb_(mavmsg);

    std::cout << "[ParameterManager] Sent PARAM_SET " << param_name
              << " = " << value << "\n";

    // Optimistically update local cache so UI reflects the change immediately.
    // The FC will echo a PARAM_VALUE which will confirm or correct this.
    {
        std::lock_guard<std::mutex> lk(mutex_);
        auto it = params_.find(param_name);
        if (it != params_.end())
        {
            it->second.value = value;
            push_param_update(it->second);   // push updated value to frontend
        }
    }

    // Acknowledge to the frontend that the command was sent
    json ack;
    ack["type"]    = "param_set_sent";
    ack["param_id"] = param_name;
    ack["value"]   = value;
    ack["message"] = "PARAM_SET sent — waiting for FC echo…";
    if (send_cb_) send_cb_(ack.dump());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Accessors
// ─────────────────────────────────────────────────────────────────────────────

json ParameterManager::getAllParametersJson() const
{
    json arr = json::array();
    std::lock_guard<std::mutex> lk(mutex_);

    for (const auto& [name, p] : params_)
    {
        json item;
        item["param_id"] = p.name;
        item["value"]    = p.value;
        item["default"]  = p.default_val;
        item["type"]     = p.type;
        item["index"]    = p.index;
        arr.push_back(std::move(item));
    }
    return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal Push Helpers
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::push_param_update(const Parameter& p) const
{
    if (!send_cb_) return;

    json j;
    j["type"]     = "param_value";
    j["param_id"] = p.name;
    j["value"]    = p.value;
    j["default"]  = p.default_val;
    j["index"]    = p.index;
    j["count"]    = p.count;
    j["type_id"]  = p.type;    // MAV_PARAM_TYPE_*

    send_cb_(j.dump());
}

void ParameterManager::push_load_progress() const
{
    if (!send_cb_) return;

    const int rcv = received_.load();
    const int tot = total_.load();

    json j;
    j["type"]     = "param_load_progress";
    j["received"] = rcv;
    j["total"]    = tot;
    j["percent"]  = (tot > 0) ? (rcv * 100 / tot) : 0;

    send_cb_(j.dump());
}

void ParameterManager::push_error(const std::string& message) const
{
    std::cerr << "[ParameterManager] ERROR: " << message << "\n";
    if (!send_cb_) return;

    json j;
    j["type"]    = "param_error";
    j["message"] = message;
    send_cb_(j.dump());
}

// ─────────────────────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────────────────────

/*static*/
std::string ParameterManager::trim_param_name(const char* raw, std::size_t max)
{
    // MAVLink param_id is fixed-width and may NOT be null-terminated
    const std::size_t len = strnlen(raw, max);
    return {raw, len};
}