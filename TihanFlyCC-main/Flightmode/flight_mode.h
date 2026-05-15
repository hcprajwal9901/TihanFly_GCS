#pragma once
/**
 * flight_mode.h
 * TiHANFly GCS — Flight Mode Detection & Configuration Module
 *
 * Changes vs original:
 *  • CopterMode::POSHOLD corrected to 16 (was missing — original had
 *    Position=16 in the CommandManager map but POSHOLD unnamed here).
 *  • All enum values verified against ArduCopter 4.x source.
 *  • Documented JSON wire protocol in one place (see "Wire protocol" below).
 *  • slotModes_ cache added: stores the configured FLTMODE1-6 mode IDs
 *    received from the autopilot via PARAM_VALUE messages.  Used by the
 *    RC_CHANNELS handler to resolve PWM → slot → mode immediately, without
 *    waiting for the next HEARTBEAT — matching Mission Planner behaviour.
 *
 * Wire protocol (WebSocket JSON)
 * ────────────────────────────────────────────────────────────────────────────
 *  Incoming (frontend → GCS):
 *    { "type": "save_flight_modes", "modes": [0,2,5,6,9,5] }
 *    { "type": "set_flight_mode",   "mode":  "RTL"         }
 *
 *  Outgoing (GCS → frontend):
 *    { "type": "flight_mode_pwm",    "slot": 2, "pwm": 1540 }
 *    { "type": "flight_mode_status", "mode": "LOITER", "pwm": 1540, "slot": 2 }
 *    { "type": "flight_mode_param",  "slot": 0, "mode_id": 5, "mode": "LOITER" }
 *    { "type": "flight_mode_saved",  "message": "Flight modes saved to autopilot." }
 */

#include <mavlink/ardupilotmega/mavlink.h>
#include <functional>
#include <string>
#include <array>
#include <cstdint>
#include <iostream>
#include <map>

// ── Flight-mode IDs (ArduCopter 4.x) ─────────────────────────────────────────
enum class CopterMode : uint8_t {
    STABILIZE       =  0,
    ACRO            =  1,
    ALT_HOLD        =  2,
    AUTO            =  3,
    GUIDED          =  4,
    LOITER          =  5,
    RTL             =  6,
    CIRCLE          =  7,
    // 8 is unused
    LAND            =  9,
    // 10 is unused
    DRIFT           = 11,
    // 12 is unused
    SPORT           = 13,
    FLIP            = 14,
    AUTOTUNE        = 15,
    POSHOLD         = 16,
    BRAKE           = 17,
    THROW           = 18,
    AVOID_ADSB      = 19,
    GUIDED_NOGPS    = 20,
    SMART_RTL       = 21,
    FLOWHOLD        = 22,
    FOLLOW          = 23,
    ZIGZAG          = 24,
    SYSTEMID        = 25,
    AUTOROTATE      = 26,
    AUTO_RTL        = 27,
    UNKNOWN         = 255,
};

// ═════════════════════════════════════════════════════════════════════════════
class FlightMode
{
public:
    static constexpr int NUM_SLOTS = 6;

    // PWM upper-bounds for slots 0-5 (same thresholds as Mission Planner)
    static constexpr std::array<uint16_t, NUM_SLOTS> PWM_BOUNDS = {
        1230, 1360, 1490, 1620, 1749, 2000
    };

    // ArduCopter FLTMODE param names
    static constexpr std::array<const char*, NUM_SLOTS> PARAM_NAMES = {
        "FLTMODE1", "FLTMODE2", "FLTMODE3",
        "FLTMODE4", "FLTMODE5", "FLTMODE6"
    };

    FlightMode();

    // ── Wiring ────────────────────────────────────────────────────────────────
    void setVehicleInfo      (int sysid, int compid);
    void setSendCallback     (std::function<void(const std::string&)>       cb);
    void setTransportCallback(std::function<void(const mavlink_message_t&)> cb);

    // ── MAVLink ingress ───────────────────────────────────────────────────────
    void processMessage(const mavlink_message_t& msg);

    /**
     * Push current mode + PWM state immediately to all WebSocket clients.
     * Call this whenever a new frontend client connects so it gets the
     * current state without waiting for the next heartbeat / RC packet.
     */
    void pushStatus();

    /**
     * Request FLTMODE1-6 params from the autopilot via PARAM_REQUEST_READ.
     * Call after transport is confirmed active (from main.cpp on connect),
     * NOT from inside the heartbeat handler where transport may not be ready.
     */
    void requestParams();

    /**
     * Reset the params-requested flag so requestParams() will fire again.
     * Call from main.cpp whenever a new connection is established.
     */
    void resetParamsRequested() { paramsRequested_ = false; }

    // ── Frontend commands ─────────────────────────────────────────────────────
    void setMode        (CopterMode mode);
    void saveFlightModes(const std::array<uint8_t, NUM_SLOTS>& modes);

    // ── String helpers ────────────────────────────────────────────────────────
    static std::string modeName    (CopterMode m);
    static CopterMode  modeFromName(const std::string& name);
    static CopterMode  modeFromId  (uint8_t id);

private:
    int sysid_  = 1;
    int compid_ = 1;

    std::map<uint8_t, uint16_t>   lastPwmMap_;
    std::map<uint8_t, int>        lastSlotMap_;
    std::map<uint8_t, CopterMode> activeModeMap_;
    std::map<uint8_t, bool>       isArmedMap_;

    /**
     * Local cache of FLTMODE1-6 values as reported by the autopilot via
     * PARAM_VALUE.  Index 0 = FLTMODE1, index 5 = FLTMODE6.
     * Initialised to STABILIZE (0) so the UI has a sane default before the
     * autopilot echoes the params.  Updated by:
     *   • processMessage() on PARAM_VALUE for any FLTMODE* param.
     *   • saveFlightModes() so the cache stays consistent with what was just
     *     written, without waiting for the autopilot echo.
     */
    std::map<uint8_t, std::array<uint8_t, NUM_SLOTS>> slotModesMap_;
    bool                           paramsRequested_ = false; // request sent once per connect

    std::function<void(const std::string&)>       send_cb_;
    std::function<void(const mavlink_message_t&)> transport_cb_;

    int  pwmToSlot      (uint16_t pwm) const;
    void broadcastStatus(uint8_t sysid, CopterMode mode, uint16_t pwm);
    void sendParamSet   (const char* param_id, float value);
};