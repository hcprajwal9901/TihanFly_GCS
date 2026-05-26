#pragma once
/**
 * parameter_manager.h
 * TiHANFly GCS — Parameter Manager (MAVLink ↔ WebSocket Bridge)
 *
 * Implements the full ArduPilot/MAVLink parameter protocol:
 *   • PARAM_REQUEST_LIST  → streams ALL parameters from the FC
 *   • PARAM_VALUE         → receives individual parameter echoes
 *   • PARAM_SET           → writes a parameter to the FC
 *   • PARAM_REQUEST_READ  → requests one parameter by name or index
 *
 * Performance optimisations (v2):
 *   • Active retry thread re-requests missing index slots every pass,
 *     with 10 ms inter-request spacing to avoid flooding WiFi buffers.
 *   • Second PARAM_REQUEST_LIST fired 3 s after the first if total count
 *     still unknown (handles the common case of the first packet being dropped).
 *   • Per-sysid disk cache: params saved as JSON after load completes.
 *     On next requestAllParameters() the cached snapshot is pushed to the
 *     frontend immediately (<5 ms), then the FC refresh runs in the background.
 *     Cache file deleted on drone disconnect or backend terminate.
 *
 * WebSocket JSON protocol:
 *   GCS → Backend:
 *     { "type": "param_request_list" }
 *     { "type": "param_set", "param_id": "BATT_LOW_VOLT", "value": 10.5 }
 *     { "type": "param_request_one", "name": "ARMING_CHECK" }
 *     { "type": "param_get_all" }
 *     { "type": "param_save_file", "path": "my.param" }
 *     { "type": "param_load_file", "path": "my.param" }
 *
 *   Backend → GCS:
 *     { "type": "param_value",         "param_id": "…", "value": 10.5, "default": 10.5, "index": N, "count": M }
 *     { "type": "param_load_start",    "message": "…", "from_cache": true/false }
 *     { "type": "param_load_progress", "received": N, "total": M, "percent": P }
 *     { "type": "param_load_complete", "count": N, "elapsed_ms": T }
 *     { "type": "param_set_sent",      "param_id": "…", "value": 1.0 }
 *     { "type": "param_all",           "params": [ {param_id, value, default, type, index}, … ] }
 *     { "type": "param_error",         "message": "…" }
 *
 * Thread-safety:
 *   processMessage() is called from the link-manager thread.
 *   All public methods may be called from the WebSocket thread.
 *   The parameter store and cache state are guarded by internal mutexes.
 */

#include <mavlink/ardupilotmega/mavlink.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;
namespace fs = std::filesystem;

// ── Parameter record ──────────────────────────────────────────────────────────
struct Parameter
{
    std::string name;
    float       value        = 0.f;
    float       default_val  = 0.f;   // populated on first receipt; never overwritten by PARAM_SET echo
    uint8_t     type         = MAV_PARAM_TYPE_REAL32;
    uint16_t    index        = 0;
    uint16_t    count        = 0;     // total param count reported by FC
    bool        default_set  = false; // true once default_val is recorded
};

// ── ParameterManager ──────────────────────────────────────────────────────────
class ParameterManager
{
public:
    /// Callback types injected at startup
    using SendCb      = std::function<void(const std::string&)>;       // JSON → WebSocket
    using TransportCb = std::function<void(const mavlink_message_t&)>; // MAVLink → FC

    explicit ParameterManager(int sysid = 1, int compid = 1,
                              const std::string& cache_dir = "./param_cache");
    ~ParameterManager();

    /** Override the cache file key (default = sysid_).
     *  Set this to ui_sysid so that multiple drones that share the same
     *  real MAVLink sysid=1 (ArduPilot default in multi-port mode) each
     *  get a distinct cache file:  param_cache/sysid_<key>.json
     *  Thread-safe — must be called before requestAllParameters(). */
    void setCacheKey(int key);

    // ── Dependency injection ─────────────────────────────────────────────────
    void setSendCallback     (SendCb      cb);
    void setTransportCallback(TransportCb cb);

    /** Update the target sysid/compid to match the active vehicle. Call this
     *  whenever a new vehicle is discovered or the active vehicle changes.
     *  Thread-safe. */
    void setVehicleInfo(int sysid, int compid);

    // ── MAVLink inbound (call from link-manager for every incoming message) ──
    void processMessage(const mavlink_message_t& msg);

    // ── Commands (called from WebSocket handler) ─────────────────────────────

    /** Send PARAM_REQUEST_LIST; loads cache snapshot first (if available) for
     *  instant UI feedback; then refreshes from FC in the background.
     *  @param force  If false (auto-trigger), silently skips if a load is already
     *                running.  If true (user Refresh), always restarts. */
    void requestAllParameters(bool force = true);

    /** Send PARAM_REQUEST_READ for a single named parameter. */
    void requestParameter(const std::string& param_name);

    /**
     * Send PARAM_SET for one parameter.
     * @param param_name  ArduPilot parameter name (max 16 chars).
     * @param value       New floating-point value.
     * @param type        MAV_PARAM_TYPE_* (default REAL32).
     */
    void setParameter(const std::string& param_name, float value,
                      uint8_t type = MAV_PARAM_TYPE_REAL32);

    // ── Cache management ─────────────────────────────────────────────────

    /** Delete the cache file identified by cache_key (= ui_sysid).
     *  Call when that drone disconnects.  The key must match what was set
     *  via setCacheKey() — it is the ui_sysid, not the real MAVLink sysid. */
    void deleteCache(int cache_key) const;

    /** Delete ALL cache files. Call on backend shutdown. */
    void deleteAllCaches();

    /** Load cache file. Returns true if cache was found and loaded. */
    bool loadCache();

    /** Update the cache value of a parameter directly and trigger a debounced save to disk. */
    void updateParamCache(const std::string& name, float value);

    /** Dynamically adjust request spacing based on the connection baudrate. */
    void setRequestSpacingFromBaudrate(int baudrate);

    // ── Accessors ────────────────────────────────────────────────────────────

    /** JSON array of all cached parameters — shape matches frontend expectation. */
    json getAllParametersJson() const;

    bool isLoading()      const { return loading_.load(); }
    int  receivedCount()  const { return received_.load(); }
    int  totalCount()     const { return total_.load(); }

private:
    int sysid_;
    int compid_;

    mutable std::mutex                         mutex_;
    std::unordered_map<std::string, Parameter> params_;          // keyed by name
    std::set<uint16_t>                         received_indices_; // tracks which index slots arrived

    std::atomic<bool>    loading_       { false };
    std::atomic<int>     received_      { 0 };
    std::atomic<int>     total_         { 0 };
    std::atomic<int64_t> load_start_ms_ { 0 };

    // ── Retry machinery ──────────────────────────────────────────────────────
    std::thread          retry_thread_;
    std::atomic<bool>    retry_stop_    { false };
    std::atomic<bool>    relist_sent_   { false };  // prevents firing more than one mid-stream re-list

    // ── Debounced post-set cache write ───────────────────────────────────────
    // Each setParameter() call resets a 2-second timer.  When the timer fires
    // (i.e. no further PARAM_SET for 2 s) the updated params_ map is flushed
    // to disk.  This avoids N disk writes when the user applies N params at once.
    std::thread           save_timer_thread_;
    std::atomic<bool>     save_timer_stop_  { false };
    std::atomic<int64_t>  save_timer_deadline_ms_ { 0 };  // epoch ms
    void schedule_cache_save();   // arms/re-arms the 2-second timer

    // ── QGC/MP-style tuning constants (WiFi-optimised) ────────────────────────
    static constexpr int RETRY_INTERVAL_MS  = 500;    // ms to wait after a retry pass
    std::atomic<int>     request_spacing_ms_{ 3 };    // ms between individual PARAM_REQUEST_READ (WiFi-safe, dynamically adjusted)
    static constexpr int RETRY_BATCH_SIZE   = 200;    // legacy
    static constexpr int MAX_RETRY_BATCH    = 2000;   // legacy
    static constexpr int LOAD_TIMEOUT_MS    = 300000;  // 5-minute hard timeout
    static constexpr int RELIST_TIMEOUT_MS  = 3000;    // re-send list if no count after 3 s
    static constexpr int RELIST_IDLE_MS     = 3000;    // re-send list if stream stalls mid-way
    static constexpr int STREAM_IDLE_MS     = 500;     // ms without new params = stream done
    static constexpr int MAX_GRACE_MS       = 25000;   // 25s — let full WiFi stream finish

    // ── Disk cache ───────────────────────────────────────────────────────────
    std::string          cache_dir_;
    std::mutex           cache_mutex_;
    std::mutex           thread_mutex_;
    int                  cache_key_;    // key used for cache filename (= ui_sysid when set)

    std::string   cache_path() const;           // uses cache_key_
    bool          load_cache_file();            // returns true if cache was found & loaded
    void          save_cache_file();            // saves current params_ keyed by cache_key_
    void          save_cache_async();           // fires save_cache_file() in a detached thread

    SendCb      send_cb_;
    TransportCb transport_cb_;

    // ── Private helpers ──────────────────────────────────────────────────────
    void handle_param_value   (const mavlink_message_t& msg);
    void push_param_update    (const Parameter& p) const;
    void push_load_progress   () const;
    void push_error           (const std::string& message) const;
    void request_by_index     (uint16_t index);
    void retry_loop           ();
    void stop_retry_thread    ();

    static std::string trim_param_name(const char* raw, std::size_t max = 16);
};