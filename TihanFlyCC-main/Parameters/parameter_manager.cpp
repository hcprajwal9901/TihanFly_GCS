/**
 * parameter_manager.cpp
 * TiHANFly GCS — Parameter Manager (MAVLink ↔ WebSocket Bridge)
 *
 * Changes v2:
 *   • REQUEST_SPACING_MS reduced to 10 ms (was 20 ms) — halves retry time.
 *   • RETRY_INTERVAL_MS reduced to 200 ms (was 500 ms).
 *   • Second PARAM_REQUEST_LIST fired if total count not known after 3 s
 *     (handles first packet being dropped over WiFi).
 *   • Disk cache: params saved as ./param_cache/sysid_<N>.json after every
 *     successful load. On the next requestAllParameters() call the cache is
 *     pushed to the frontend instantly, then the FC refresh runs in background.
 *     Cache deleted on drone disconnect or clean backend shutdown.
 */

#include "parameter_manager.h"
#include <chrono>
#include <cstring>
#include <fstream>
#include <sstream>

using Clock = std::chrono::steady_clock;

// ─────────────────────────────────────────────────────────────────────────────
//  Constructor / Destructor / Dependency Injection
// ─────────────────────────────────────────────────────────────────────────────

ParameterManager::ParameterManager(int sysid, int compid,
                                   const std::string& cache_dir)
    : sysid_(sysid), compid_(compid), cache_dir_(cache_dir)
{
    // Ensure cache directory exists
    try { fs::create_directories(cache_dir_); }
    catch (const std::exception& e) {
        std::cerr << "[ParameterManager] Cache dir creation failed: " << e.what() << "\n";
    }

    std::cout << "[ParameterManager] Initialized (sysid=" << sysid_
              << " compid=" << compid_ << " cache=" << cache_dir_ << ")\n";
}

ParameterManager::~ParameterManager()
{
    stop_retry_thread();
}

void ParameterManager::setSendCallback(SendCb cb)      { send_cb_      = std::move(cb); }
void ParameterManager::setTransportCallback(TransportCb cb) { transport_cb_ = std::move(cb); }

void ParameterManager::setVehicleInfo(int sysid, int compid)
{
    sysid_  = sysid;
    compid_ = compid;
    std::cout << "[ParameterManager] Target updated → sysid=" << sysid_
              << " compid=" << compid_ << "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAVLink Inbound Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::processMessage(const mavlink_message_t& msg)
{
    switch (msg.msgid)
    {
        case MAVLINK_MSG_ID_PARAM_VALUE:
            if (sysid_ == 0 || static_cast<int>(msg.sysid) == sysid_)
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

    if (total_.load() != static_cast<int>(pv.param_count))
        total_.store(static_cast<int>(pv.param_count));

    Parameter p;
    {
        std::lock_guard<std::mutex> lk(mutex_);

        auto it     = params_.find(name);
        bool is_new = (it == params_.end());

        if (is_new)
        {
            p.name        = name;
            p.value       = pv.param_value;
            p.default_val = pv.param_value;
            p.default_set = true;
            p.type        = pv.param_type;
            p.index       = pv.param_index;
            p.count       = pv.param_count;
            params_[name] = p;
            received_.fetch_add(1);
            received_indices_.insert(pv.param_index);
        }
        else
        {
            it->second.value = pv.param_value;
            it->second.type  = pv.param_type;
            it->second.index = pv.param_index;
            it->second.count = pv.param_count;
            p = it->second;
            received_indices_.insert(pv.param_index);
        }
    }

    push_param_update(p);

    if (loading_.load())
    {
        push_load_progress();

        const int rcv = received_.load();
        const int tot = total_.load();

        if (tot > 0 && rcv >= tot)
        {
            loading_.store(false);
            stop_retry_thread();

            const int64_t elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                Clock::now().time_since_epoch()).count() - load_start_ms_.load();

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

            // Save to disk cache asynchronously (non-blocking)
            save_cache_async();
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

    stop_retry_thread();

    // ── Step 1: serve cached snapshot immediately (if available) ─────────────
    // This makes the Full Params panel appear instantly on reconnect.
    const bool had_cache = load_cache_file(sysid_);

    // ── Step 2: reset for fresh load ─────────────────────────────────────────
    {
        std::lock_guard<std::mutex> lk(mutex_);
        if (!had_cache)
        {
            params_.clear();
            received_indices_.clear();
        }
        else
        {
            // Keep the cache data in params_ for display, but reset tracking
            // so the retry loop knows which indices are still "missing" from FC
            received_indices_.clear();
            for (const auto& [name, p] : params_)
                received_indices_.insert(p.index);
        }
    }

    received_.store(had_cache ? static_cast<int>(params_.size()) : 0);
    total_.store(0);
    loading_.store(true);
    load_start_ms_.store(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            Clock::now().time_since_epoch()).count());

    // Notify frontend
    json start;
    start["type"]       = "param_load_start";
    start["from_cache"] = had_cache;
    start["message"]    = had_cache
        ? "Loaded " + std::to_string(params_.size()) + " params from cache — refreshing from FC…"
        : "Requesting all parameters from flight controller…";
    if (send_cb_) send_cb_(start.dump());

    // ── Step 3: send PARAM_REQUEST_LIST to FC ────────────────────────────────
    auto send_list = [this]()
    {
        mavlink_param_request_list_t req{};
        req.target_system    = static_cast<uint8_t>(sysid_);
        req.target_component = static_cast<uint8_t>(compid_);
        mavlink_message_t mavmsg;
        mavlink_msg_param_request_list_encode(
            255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &req);
        transport_cb_(mavmsg);
        std::cout << "[ParameterManager] Sent PARAM_REQUEST_LIST"
                  << " (sysid=" << sysid_ << ")\n";
    };

    send_list();

    // ── Step 4: start retry thread ────────────────────────────────────────────
    retry_stop_.store(false);
    retry_thread_ = std::thread([this, send_list]()
    {
        std::cout << "[ParameterManager] Retry thread started\n";

        // 1-second initial grace period
        for (int i = 0; i < 20 && !retry_stop_.load(); ++i)
            std::this_thread::sleep_for(std::chrono::milliseconds(50));

        // ── Re-send PARAM_REQUEST_LIST if total still unknown after 3 s ───────
        // Handles the common case where the first list-request packet is dropped.
        {
            auto waited = std::chrono::milliseconds(0);
            while (!retry_stop_.load() && loading_.load()
                   && total_.load() <= 0
                   && waited.count() < RELIST_TIMEOUT_MS)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                waited += std::chrono::milliseconds(100);
            }
            if (!retry_stop_.load() && loading_.load() && total_.load() <= 0)
            {
                std::cout << "[ParameterManager] No param count received — re-sending PARAM_REQUEST_LIST\n";
                send_list();
                std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            }
        }

        // ── Main retry loop ───────────────────────────────────────────────────
        while (!retry_stop_.load())
        {
            if (!loading_.load()) break;

            const int tot = total_.load();
            if (tot <= 0)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
                continue;
            }

            // Timeout check
            const int64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                Clock::now().time_since_epoch()).count();
            if ((now_ms - load_start_ms_.load()) > LOAD_TIMEOUT_MS)
            {
                std::cout << "[ParameterManager] Load timeout after "
                          << LOAD_TIMEOUT_MS / 1000 << " s\n";
                loading_.store(false);
                push_error("Parameter load timed out. Only "
                           + std::to_string(received_.load()) + "/"
                           + std::to_string(tot) + " received.");

                // Save partial results anyway
                save_cache_async();
                break;
            }

            // Collect missing index slots
            std::vector<uint16_t> missing;
            {
                std::lock_guard<std::mutex> lk(mutex_);
                for (uint16_t idx = 0; idx < static_cast<uint16_t>(tot); ++idx)
                {
                    if (received_indices_.find(idx) == received_indices_.end())
                    {
                        missing.push_back(idx);
                        if (static_cast<int>(missing.size()) >= MAX_RETRY_BATCH)
                            break;
                    }
                }
            }

            if (missing.empty())
            {
                if (received_.load() >= tot) break; // all done
                std::this_thread::sleep_for(std::chrono::milliseconds(RETRY_INTERVAL_MS));
                continue;
            }

            std::cout << "[ParameterManager] Retry pass: "
                      << missing.size() << " missing / " << tot
                      << " (rcv=" << received_.load() << ")\n";

            // Re-request each missing param with spacing (prevents buffer flood)
            for (uint16_t idx : missing)
            {
                if (retry_stop_.load() || !loading_.load()) break;
                request_by_index(idx);
                std::this_thread::sleep_for(std::chrono::milliseconds(REQUEST_SPACING_MS));
            }

            // Wait before next scan (interval starts after pass finishes)
            for (int i = 0; i < RETRY_INTERVAL_MS / 50 && !retry_stop_.load(); ++i)
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        std::cout << "[ParameterManager] Retry thread exiting\n";
    });
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
    req.param_index      = -1;

    std::memset(req.param_id, 0, sizeof(req.param_id));
    std::strncpy(req.param_id, param_name.c_str(), sizeof(req.param_id));

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

    {
        std::lock_guard<std::mutex> lk(mutex_);
        auto it = params_.find(param_name);
        if (it != params_.end()) type = it->second.type;
    }

    mavlink_param_set_t ps{};
    ps.target_system    = static_cast<uint8_t>(sysid_);
    ps.target_component = static_cast<uint8_t>(compid_);
    ps.param_value      = value;
    ps.param_type       = type;
    std::memset(ps.param_id, 0, sizeof(ps.param_id));
    std::strncpy(ps.param_id, param_name.c_str(), sizeof(ps.param_id));

    mavlink_message_t mavmsg;
    mavlink_msg_param_set_encode(255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &ps);
    transport_cb_(mavmsg);

    std::cout << "[ParameterManager] Sent PARAM_SET " << param_name
              << " = " << value << "\n";

    {
        std::lock_guard<std::mutex> lk(mutex_);
        auto it = params_.find(param_name);
        if (it != params_.end())
        {
            it->second.value = value;
            push_param_update(it->second);
        }
    }

    json ack;
    ack["type"]     = "param_set_sent";
    ack["param_id"] = param_name;
    ack["value"]    = value;
    ack["message"]  = "PARAM_SET sent — waiting for FC echo…";
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
//  Disk Cache
// ─────────────────────────────────────────────────────────────────────────────

std::string ParameterManager::cache_path(int sysid) const
{
    return cache_dir_ + "/sysid_" + std::to_string(sysid) + ".json";
}

bool ParameterManager::load_cache_file(int sysid)
{
    const std::string path = cache_path(sysid);
    if (!fs::exists(path)) return false;

    try
    {
        std::ifstream f(path);
        if (!f.is_open()) return false;

        json arr = json::parse(f);
        if (!arr.is_array() || arr.empty()) return false;

        std::lock_guard<std::mutex> lk(mutex_);
        params_.clear();
        received_indices_.clear();

        for (const auto& item : arr)
        {
            Parameter p;
            p.name        = item.value("param_id", "");
            p.value       = item.value("value",    0.f);
            p.default_val = item.value("default",  p.value);
            p.type        = static_cast<uint8_t>(item.value("type",  0));
            p.index       = static_cast<uint16_t>(item.value("index", 0));
            p.default_set = true;
            if (!p.name.empty())
            {
                params_[p.name] = p;
                received_indices_.insert(p.index);
            }
        }

        const int cnt = static_cast<int>(params_.size());
        received_.store(cnt);
        std::cout << "[ParameterManager] Loaded " << cnt
                  << " params from cache: " << path << "\n";

        // Push cached snapshot to frontend (instant)
        if (send_cb_)
        {
            json snap;
            snap["type"]   = "param_all";
            snap["params"] = getAllParametersJson();
            snap["cached"] = true;
            send_cb_(snap.dump());
        }

        return true;
    }
    catch (const std::exception& e)
    {
        std::cerr << "[ParameterManager] Cache load failed: " << e.what() << "\n";
        return false;
    }
}

void ParameterManager::save_cache_file()
{
    const std::string path = cache_path(sysid_);
    try
    {
        std::lock_guard<std::mutex> lk(cache_mutex_);
        json arr = getAllParametersJson();

        std::ofstream f(path, std::ios::trunc);
        if (!f.is_open()) throw std::runtime_error("Cannot open " + path);
        f << arr.dump(2);
        f.close();

        std::cout << "[ParameterManager] Cache saved: " << path
                  << " (" << arr.size() << " params)\n";
    }
    catch (const std::exception& e)
    {
        std::cerr << "[ParameterManager] Cache save failed: " << e.what() << "\n";
    }
}

void ParameterManager::save_cache_async()
{
    // Fire-and-forget detached thread so load completion isn't blocked by I/O
    std::thread([this]() { save_cache_file(); }).detach();
}

void ParameterManager::deleteCache(int sysid)
{
    const std::string path = cache_path(sysid);
    try
    {
        if (fs::exists(path))
        {
            fs::remove(path);
            std::cout << "[ParameterManager] Cache deleted: " << path << "\n";
        }
    }
    catch (const std::exception& e)
    {
        std::cerr << "[ParameterManager] Cache delete failed: " << e.what() << "\n";
    }
}

void ParameterManager::deleteAllCaches()
{
    try
    {
        for (const auto& entry : fs::directory_iterator(cache_dir_))
        {
            if (entry.path().extension() == ".json")
            {
                fs::remove(entry.path());
                std::cout << "[ParameterManager] Cache deleted: "
                          << entry.path().string() << "\n";
            }
        }
    }
    catch (const std::exception& e)
    {
        std::cerr << "[ParameterManager] deleteAllCaches failed: " << e.what() << "\n";
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Retry helpers
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::request_by_index(uint16_t index)
{
    if (!transport_cb_) return;

    mavlink_param_request_read_t req{};
    req.target_system    = static_cast<uint8_t>(sysid_);
    req.target_component = static_cast<uint8_t>(compid_);
    req.param_index      = static_cast<int16_t>(index);
    std::memset(req.param_id, 0, sizeof(req.param_id));
    req.param_id[0] = '\0';

    mavlink_message_t mavmsg;
    mavlink_msg_param_request_read_encode(
        255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &req);
    transport_cb_(mavmsg);
}

void ParameterManager::stop_retry_thread()
{
    retry_stop_.store(true);
    if (retry_thread_.joinable())
        retry_thread_.join();
    retry_stop_.store(false); // reset for next use
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
    j["type_id"]  = p.type;

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
    const std::size_t len = strnlen(raw, max);
    return {raw, len};
}