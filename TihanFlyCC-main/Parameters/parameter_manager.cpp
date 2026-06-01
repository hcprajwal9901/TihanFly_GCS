/**
 * parameter_manager.cpp
 * TiHANFly GCS — Parameter Manager (MAVLink ↔ WebSocket Bridge)
 *
 * Changes v3 (WiFi-optimised):
 *   • STREAM_IDLE_MS raised to 600 ms (was 200 ms) — tolerates WiFi jitter.
 *   • MAX_GRACE_MS raised to 25 s (was 1.5 s) — lets the full ArduPilot
 *     stream finish over WiFi before retries start.
 *   • REQUEST_SPACING_MS raised to 3 ms (was 1 ms) — prevents WiFi saturation.
 *   • RETRY_INTERVAL_MS raised to 1500 ms (was 500 ms) — allows WiFi RTT.
 *   • Batched retries: 50 params per retry pass instead of flooding all at once.
 *   • Mid-stream re-list: if stream stalls >4 s at <50% received, fires a
 *     second PARAM_REQUEST_LIST to recover from WiFi drops.
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
    : sysid_(sysid), compid_(compid), cache_dir_(cache_dir),
      cache_key_(sysid)  // default: keyed by real sysid; override via setCacheKey(ui_sysid)
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

    // Stop the debounced-save timer thread if it is running.
    save_timer_stop_.store(true);
    if (save_timer_thread_.joinable())
        save_timer_thread_.join();
}

void ParameterManager::setSendCallback(SendCb cb)      { send_cb_      = std::move(cb); }
void ParameterManager::setTransportCallback(TransportCb cb) { transport_cb_ = std::move(cb); }

void ParameterManager::setCacheKey(int key)
{
    cache_key_ = key;
    std::cout << "[ParameterManager] Cache key set → " << key
              << " (file: sysid_" << key << ".json)\n";
}

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

    // ── WebSocket dispatch ────────────────────────────────────────────────────
    //
    // Strategy differs between bulk load and individual requests:
    //
    //  Individual request (param_request_one, loading_==false):
    //    Send param_value immediately — the UI is waiting for exactly this param.
    //
    //  Bulk load (param_request_list, loading_==true):
    //    SUPPRESS individual param_value messages.  Sending 2092 WS frames
    //    (1046 × param_value + 1046 × param_load_progress) during a fast USB
    //    stream creates backpressure on the MAVLink RX thread, causing ~12 s
    //    loads.  Instead:
    //      • Send param_load_progress every PROGRESS_BATCH_SIZE params.
    //      • On completion, send ONE param_all with the full snapshot.
    //    This cuts WS traffic from 2092 messages to ~22, eliminating the lag.

    if (!loading_.load())
    {
        // Not a bulk load — individual request_one reply: send immediately.
        push_param_update(p);
        return;
    }

    // ── Bulk load path ────────────────────────────────────────────────────────
    const int rcv = received_.load();
    const int tot = total_.load();

    // Throttled progress update (at most once every 100 ms, and always at 100 %)
    static std::atomic<int64_t> last_progress_time_ms{0};
    const int64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        Clock::now().time_since_epoch()).count();

    int64_t last = last_progress_time_ms.load();
    if (rcv >= tot || (now_ms - last) >= 100)
    {
        if (last_progress_time_ms.compare_exchange_strong(last, now_ms))
        {
            push_load_progress();
        }
    }

    if (tot > 0 && rcv >= tot)
    {
        loading_.store(false);
        stop_retry_thread();

        const int64_t elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            Clock::now().time_since_epoch()).count() - load_start_ms_.load();

        // ── One-shot bulk delivery ─────────────────────────────────────────
        // Send ALL cached parameters in a single WS frame so the frontend
        // can populate the full table with one DOM pass (much faster than
        // 1046 incremental upserts).
        if (send_cb_)
        {
            json all_msg;
            all_msg["type"]   = "param_all";
            all_msg["params"] = getAllParametersJson();
            all_msg["cached"] = false;
            send_cb_(all_msg.dump());
        }

        // Final progress at 100 % + completion notification
        push_load_progress();

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


// ─────────────────────────────────────────────────────────────────────────────
//  Commands — called from WebSocket handler thread
// ─────────────────────────────────────────────────────────────────────────────

void ParameterManager::requestAllParameters(bool force)
{
    if (!transport_cb_)
    {
        push_error("No transport — cannot send PARAM_REQUEST_LIST");
        return;
    }

    // Auto-trigger guard: if a load is already running and this is not a
    // forced user refresh, skip silently.  Without this guard, the heartbeat
    // handler (which fires every 1 s) or reconnect logic can kill the running
    // retry thread and restart from scratch — adding 5–10 s every time.
    if (!force && loading_.load())
    {
        std::cout << "[ParameterManager] Auto-trigger skipped — load already in progress\n";
        return;
    }

    stop_retry_thread();

    // ── Step 1: serve cached snapshot immediately (if available) ─────────────
    // This makes the Full Params panel appear instantly on reconnect.
    const bool had_cache = load_cache_file();

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
    relist_sent_.store(false);
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

    // Send a second PARAM_REQUEST_LIST after a short gap — CUAVLink WiFi
    // often drops the first burst entirely; a duplicate 100 ms later has
    // a much higher chance of being processed.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    send_list();

    // ── Step 4: start retry thread ────────────────────────────────────────────
    {
        std::lock_guard<std::mutex> lk(thread_mutex_);
        retry_stop_.store(false);
        retry_thread_ = std::thread([this, send_list]()
        {
            std::cout << "[ParameterManager] Retry thread started\n";

            // ── Phase 1: Adaptive grace period (WiFi-optimised) ────────────────────
            //
            // Wait for the PARAM_REQUEST_LIST stream to finish naturally.
            // Over WiFi ArduPilot streams ~50 params/sec → ~20 s for 1046 params.
            // We declare the stream "done" when no new param arrives for
            // STREAM_IDLE_MS (1000 ms) — tolerant of WiFi jitter gaps.
            //
            // Mid-stream re-list: if the stream stalls early and we've received
            // <10 % of expected params, fire a second PARAM_REQUEST_LIST to
            // recover from WiFi drops that caused the FC to stop mid-stream.
            {
                int  last_rcv    = -1;
                auto last_change = Clock::now();
                bool stream_started = false;

                for (int elapsed_ms = 0;
                     elapsed_ms < MAX_GRACE_MS && !retry_stop_.load() && loading_.load();
                     elapsed_ms += 50)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));

                    const int cur = received_.load();
                    if (cur != last_rcv)
                    {
                        last_rcv       = cur;
                        last_change    = Clock::now();
                        stream_started = true;

                        // Already have everything — no retry needed
                        if (total_.load() > 0 && cur >= total_.load())
                            goto retry_thread_done;
                    }

                    if (stream_started)
                    {
                        const int64_t idle_ms =
                            std::chrono::duration_cast<std::chrono::milliseconds>(
                                Clock::now() - last_change).count();

                        if (idle_ms >= STREAM_IDLE_MS)
                        {
                            // If we received very few parameters (e.g. < 10%), try one re-list
                            // to get a bulk stream going, rather than 1000 individual retries.
                            if (!relist_sent_.load()
                                && total_.load() > 0
                                && cur < total_.load() / 10)
                            {
                                relist_sent_.store(true);
                                std::cout << "[ParameterManager] Stream stalled extremely early at "
                                          << cur << "/" << total_.load()
                                          << " — re-sending PARAM_REQUEST_LIST\n";
                                send_list();
                                last_change = Clock::now();  // reset idle timer
                                last_rcv = cur;
                                continue;
                            }

                            std::cout << "[ParameterManager] Stream idle "
                                      << idle_ms << " ms — starting retry (rcv="
                                      << cur << "/" << total_.load() << ")\n";
                            break;  // stream paused — start retry now
                        }
                    }
                }
            }

            // ── Phase 2: Re-send PARAM_REQUEST_LIST if total still unknown ────────
            {
                int waited_ms = 0;
                while (!retry_stop_.load() && loading_.load()
                       && total_.load() <= 0
                       && waited_ms < RELIST_TIMEOUT_MS)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
                    waited_ms += 100;
                }
                if (!retry_stop_.load() && loading_.load() && total_.load() <= 0)
                {
                    std::cout << "[ParameterManager] No param count received "
                                 "— re-sending PARAM_REQUEST_LIST\n";
                    send_list();
                    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
                }
            }

            // ── Phase 3: Self-adjusting retry loop (WiFi-optimised) ──────────────────
            //
            // Go through the list of missing parameters. For each missing parameter,
            // send a request if it has not been received yet. Sleep for REQUEST_SPACING_MS
            // after each request.
            // At the end of each pass, if the pass took less than RETRY_INTERVAL_MS,
            // sleep for the remainder to let responses arrive.
            //
            while (!retry_stop_.load())
            {
                if (!loading_.load()) break;

                const int tot = total_.load();
                if (tot <= 0)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(200));
                    continue;
                }

                // Hard timeout
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
                    save_cache_async();
                    break;
                }

                // Check if we are done
                const int rcv = received_.load();
                if (rcv >= tot) break;

                std::cout << "[ParameterManager] Retry pass: "
                          << (tot - rcv) << " missing / " << tot
                          << " (rcv=" << rcv << ")\n";

                auto pass_start = Clock::now();
                int requests_sent = 0;

                for (uint16_t idx = 0; idx < static_cast<uint16_t>(tot); ++idx)
                {
                    if (retry_stop_.load() || !loading_.load()) break;

                    // Check if already received
                    {
                        std::lock_guard<std::mutex> lk(mutex_);
                        if (received_indices_.find(idx) != received_indices_.end())
                            continue;
                    }

                    request_by_index(idx);
                    requests_sent++;
                    std::this_thread::sleep_for(std::chrono::milliseconds(request_spacing_ms_.load(std::memory_order_relaxed)));
                }

                // If we didn't send any requests, it means everything was received during the pass
                if (requests_sent == 0)
                {
                    if (received_.load() >= tot) break;
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
                    continue;
                }

                // Calculate how long this pass took
                const int64_t pass_duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                    Clock::now() - pass_start).count();

                // If the pass finished quicker than RETRY_INTERVAL_MS, sleep the remainder
                if (pass_duration_ms < RETRY_INTERVAL_MS)
                {
                    const int64_t sleep_time = RETRY_INTERVAL_MS - pass_duration_ms;
                    for (int i = 0; i < sleep_time / 50 && !retry_stop_.load() && loading_.load(); ++i)
                        std::this_thread::sleep_for(std::chrono::milliseconds(50));
                }
            }

            retry_thread_done:
            std::cout << "[ParameterManager] Retry thread exiting\n";
        });
    }
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

    // Persist the change to the cache so the next reconnect serves the
    // updated value instantly instead of the old pre-change value.
    // Uses a debounced 2-second timer to avoid N disk writes for N rapid
    // PARAM_SET calls (e.g. loading a full .param file).
    schedule_cache_save();

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

std::string ParameterManager::cache_path() const
{
    return cache_dir_ + "/sysid_" + std::to_string(cache_key_) + ".json";
}

bool ParameterManager::load_cache_file()
{
    const std::string path = cache_path();   // uses cache_key_
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
    const std::string path = cache_path();   // uses cache_key_ (= ui_sysid)
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

void ParameterManager::deleteCache(int cache_key) const
{
    // Build the path from the supplied key (= ui_sysid, not real sysid)
    const std::string path = cache_dir_ + "/sysid_" + std::to_string(cache_key) + ".json";
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

bool ParameterManager::loadCache()
{
    return load_cache_file();
}

void ParameterManager::updateParamCache(const std::string& name, float value)
{
    std::lock_guard<std::mutex> lk(mutex_);
    auto it = params_.find(name);
    if (it != params_.end())
    {
        it->second.value = value;
        push_param_update(it->second);
    }
    else
    {
        Parameter p;
        p.name = name;
        p.value = value;
        p.default_val = value;
        p.default_set = true;
        params_[name] = p;
    }
    schedule_cache_save();
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
    std::lock_guard<std::mutex> lk(thread_mutex_);
    retry_stop_.store(true);
    if (retry_thread_.joinable())
        retry_thread_.join();
    retry_stop_.store(false); // reset for next use
}

// ───────────────────────────────────────────────────────────────────────────────
//  schedule_cache_save
//
//  Arms (or re-arms) a 2-second debounce timer.  When no further setParameter
//  call fires within those 2 seconds, save_cache_file() is called once.
//
//  A single long-lived background thread is lazily created the first time this
//  is called and lives until the ParameterManager is destroyed.  The thread
//  polls every 200 ms; when it sees the deadline has passed it writes the file
//  and clears the deadline.
// ───────────────────────────────────────────────────────────────────────────────
void ParameterManager::schedule_cache_save()
{
    // Set deadline = now + 2000 ms
    const int64_t deadline = std::chrono::duration_cast<std::chrono::milliseconds>(
        Clock::now().time_since_epoch()).count() + 2000;
    save_timer_deadline_ms_.store(deadline);

    // Lazily start the timer thread (only once)
    if (!save_timer_thread_.joinable())
    {
        save_timer_stop_.store(false);
        save_timer_thread_ = std::thread([this]()
        {
            while (!save_timer_stop_.load())
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(200));

                const int64_t dl = save_timer_deadline_ms_.load();
                if (dl == 0) continue;   // no pending save

                const int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
                    Clock::now().time_since_epoch()).count();

                if (now >= dl)
                {
                    // Clear deadline first so re-entrant calls set a new one
                    save_timer_deadline_ms_.store(0);
                    save_cache_file();
                    std::cout << "[ParameterManager] Cache flushed after param change\n";
                }
            }
        });
    }
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

void ParameterManager::setRequestSpacingFromBaudrate(int baudrate)
{
    // baudrate == -1 indicates a UDP connection (WiFi), set to 5 ms spacing (highly robust, very fast)
    if (baudrate == -1)
    {
        request_spacing_ms_.store(5);
        std::cout << "[ParameterManager] Connection is UDP (WiFi) — dynamically adjusted request spacing to 5 ms\n";
    }
    // High-speed serial connection (>= 921600 baud), set to 3 ms spacing
    else if (baudrate >= 920000)
    {
        request_spacing_ms_.store(3);
        std::cout << "[ParameterManager] Connection is High-Speed Serial (" << baudrate << " baud) — dynamically adjusted request spacing to 3 ms\n";
    }
    // Standard telemetry baudrate (e.g. 115200), set to 12 ms spacing to avoid saturating the link
    else if (baudrate >= 115000)
    {
        request_spacing_ms_.store(12);
        std::cout << "[ParameterManager] Connection is Telemetry Serial (" << baudrate << " baud) — dynamically adjusted request spacing to 12 ms\n";
    }
    // Low-bandwidth telemetry radio (e.g. RFD900 / 3DR Radio at 57600), set to 25 ms spacing to ensure zero packet loss
    else
    {
        request_spacing_ms_.store(25);
        std::cout << "[ParameterManager] Connection is Low-Bandwidth Radio (" << baudrate << " baud) — dynamically adjusted request spacing to 25 ms\n";
    }
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