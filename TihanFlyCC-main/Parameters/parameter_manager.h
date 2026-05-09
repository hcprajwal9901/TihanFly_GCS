#pragma once
/**
 * parameter_manager.h
 * TiHANFly GCS — Parameter Manager (MAVLink ↔ WebSocket Bridge)
 *
 * Implements the full ArduPilot/MAVLink parameter protocol:
 *   • PARAM_REQUEST_LIST  → streams ALL parameters from the FC
 *   • PARAM_VALUE         → receives individual parameter echoes
 *   • PARAM_SET           → writes a parameter to the FC
 *   • PARAM_REQUEST_READ  → requests one parameter by name
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
 *     { "type": "param_load_start",    "message": "…" }
 *     { "type": "param_load_progress", "received": N, "total": M, "percent": P }
 *     { "type": "param_load_complete", "count": N, "elapsed_ms": T }
 *     { "type": "param_set_sent",      "param_id": "…", "value": 1.0 }
 *     { "type": "param_all",           "params": [ {param_id, value, default, type, index}, … ] }
 *     { "type": "param_error",         "message": "…" }
 *
 * Thread-safety:
 *   processMessage()   is called from the link-manager thread.
 *   All public methods may be called from the WebSocket thread.
 *   The parameter store is guarded by an internal mutex.
 */

#include <mavlink/ardupilotmega/mavlink.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <functional>
#include <iostream>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

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

    explicit ParameterManager(int sysid = 1, int compid = 1);

    // ── Dependency injection ─────────────────────────────────────────────────
    void setSendCallback     (SendCb      cb);
    void setTransportCallback(TransportCb cb);

    // ── MAVLink inbound (call from link-manager for every incoming message) ──
    void processMessage(const mavlink_message_t& msg);

    // ── Commands (called from WebSocket handler) ─────────────────────────────

    /** Send PARAM_REQUEST_LIST; clears local cache; streams all params. */
    void requestAllParameters();

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
    std::unordered_map<std::string, Parameter> params_;   // keyed by name

    std::atomic<bool>    loading_       { false };
    std::atomic<int>     received_      { 0 };
    std::atomic<int>     total_         { 0 };
    std::atomic<int64_t> load_start_ms_ { 0 };

    SendCb      send_cb_;
    TransportCb transport_cb_;

    // ── Private helpers ──────────────────────────────────────────────────────
    void handle_param_value   (const mavlink_message_t& msg);
    void push_param_update    (const Parameter& p) const;
    void push_load_progress   () const;
    void push_error           (const std::string& msg) const;

    static std::string trim_param_name(const char* raw, std::size_t max = 16);
};