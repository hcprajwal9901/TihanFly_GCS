/**
 * flight_mode.cpp
 * TiHANFly GCS — Flight Mode Detection & Configuration Module
 *
 * Changes vs original:
 *  • constexpr array out-of-line definitions removed for C++17 (inline
 *    constexpr in the header is sufficient; the .cpp definitions caused
 *    duplicate-symbol warnings with some compilers).
 *  • RC_CHANNELS handler now resolves PWM → slot → slotModes_[slot] →
 *    CopterMode and updates activeMode_ immediately, then calls
 *    broadcastStatus().  This mirrors Mission Planner behaviour and makes
 *    the frontend update instantly on RC switch changes without waiting for
 *    the next HEARTBEAT.
 *  • PARAM_VALUE handler now stores the received mode_id in slotModes_[i]
 *    so the RC_CHANNELS handler always has an up-to-date local copy of the
 *    configured FLTMODE params.
 *  • saveFlightModes() updates slotModes_[i] before sending PARAM_SET so
 *    the local cache is immediately consistent with what was saved.
 *  • sendParamSet() uses MAV_PARAM_TYPE_INT32 (ArduCopter FLTMODE params
 *    are int32, not int8 — using the wrong type can cause the autopilot
 *    to reject the PARAM_SET silently).
 *  • setMode() logs the outgoing mode name for easier debugging.
 *  • All strnlen calls guarded to treat param_id as exactly 16 bytes.
 */

#include "flight_mode.h"
#include <nlohmann/json.hpp>
#include <cstring>

using json = nlohmann::json;

// ── String ↔ CopterMode table ─────────────────────────────────────────────────

struct ModeEntry { CopterMode mode; const char* name; };

static constexpr ModeEntry MODE_TABLE[] = {
    { CopterMode::STABILIZE,    "STABILIZE"    },
    { CopterMode::ACRO,         "ACRO"         },
    { CopterMode::ALT_HOLD,     "ALT_HOLD"     },
    { CopterMode::AUTO,         "AUTO"         },
    { CopterMode::GUIDED,       "GUIDED"       },
    { CopterMode::LOITER,       "LOITER"       },
    { CopterMode::RTL,          "RTL"          },
    { CopterMode::CIRCLE,       "CIRCLE"       },
    { CopterMode::LAND,         "LAND"         },
    { CopterMode::DRIFT,        "DRIFT"        },
    { CopterMode::SPORT,        "SPORT"        },
    { CopterMode::FLIP,         "FLIP"         },
    { CopterMode::AUTOTUNE,     "AUTOTUNE"     },
    { CopterMode::POSHOLD,      "POSHOLD"      },
    { CopterMode::BRAKE,        "BRAKE"        },
    { CopterMode::THROW,        "THROW"        },
    { CopterMode::AVOID_ADSB,   "AVOID_ADSB"   },
    { CopterMode::GUIDED_NOGPS, "GUIDED_NOGPS" },
    { CopterMode::SMART_RTL,    "SMART_RTL"    },
    { CopterMode::FLOWHOLD,     "FLOWHOLD"     },
    { CopterMode::FOLLOW,       "FOLLOW"       },
    { CopterMode::ZIGZAG,       "ZIGZAG"       },
    { CopterMode::SYSTEMID,     "SYSTEMID"     },
    { CopterMode::AUTOROTATE,   "AUTOROTATE"   },
    { CopterMode::AUTO_RTL,     "AUTO_RTL"     },
    { CopterMode::UNKNOWN,      "UNKNOWN"      },
};

std::string FlightMode::modeName(CopterMode m)
{
    for (const auto& e : MODE_TABLE)
        if (e.mode == m) return e.name;
    return "UNKNOWN";
}

CopterMode FlightMode::modeFromName(const std::string& name)
{
    for (const auto& e : MODE_TABLE)
        if (name == e.name) return e.mode;
    return CopterMode::UNKNOWN;
}

CopterMode FlightMode::modeFromId(uint8_t id)
{
    for (const auto& e : MODE_TABLE)
        if (static_cast<uint8_t>(e.mode) == id) return e.mode;
    return CopterMode::UNKNOWN;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Constructor
// ═══════════════════════════════════════════════════════════════════════════════

FlightMode::FlightMode()
{
    std::cout << "[FlightMode] Module created\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Wiring
// ═══════════════════════════════════════════════════════════════════════════════

void FlightMode::setVehicleInfo(int sysid, int compid)
{
    sysid_           = sysid;
    compid_          = compid;
    paramsRequested_ = false;  // reset so requestParams() fires on next connect
}

void FlightMode::setSendCallback(std::function<void(const std::string&)> cb)
{
    send_cb_ = cb;
}

void FlightMode::setTransportCallback(std::function<void(const mavlink_message_t&)> cb)
{
    transport_cb_ = cb;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Public state push  (call on new client connect)
// ═══════════════════════════════════════════════════════════════════════════════

void FlightMode::pushStatus()
{
    broadcastStatus(activeMode_, lastPwm_);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAVLink ingress
// ═══════════════════════════════════════════════════════════════════════════════

void FlightMode::processMessage(const mavlink_message_t& msg)
{
    // ── RC_CHANNELS (id 65) — flight-mode channel (ch5) ──────────────────────
    if (msg.msgid == MAVLINK_MSG_ID_RC_CHANNELS)
    {
        mavlink_rc_channels_t rc;
        mavlink_msg_rc_channels_decode(&msg, &rc);

        uint16_t pwm  = rc.chan5_raw;
        int      slot = pwmToSlot(pwm);

        if (pwm != lastPwm_ || slot != lastSlot_)
        {
            const bool slotChanged = (slot != lastSlot_);

            lastPwm_  = pwm;
            lastSlot_ = slot;

            // ── Resolve slot → configured FLTMODE param → CopterMode ──────────
            // This is the key fix: instead of waiting for the next HEARTBEAT,
            // we immediately look up the mode configured for this slot in the
            // local slotModes_ cache (populated from PARAM_VALUE messages).
            CopterMode slotMode = modeFromId(slotModes_[slot]);
            activeMode_ = slotMode;

            // Broadcast raw PWM change (lightweight, for PWM indicator)
            json jpwm;
            jpwm["type"] = "flight_mode_pwm";
            jpwm["slot"] = slot;
            jpwm["pwm"]  = pwm;
            if (send_cb_) send_cb_(jpwm.dump());

            // Broadcast full status with resolved mode name
            broadcastStatus(activeMode_, pwm);

            // Log only when the RC switch actually moves to a new slot.
            // Suppresses constant 1499/1500 PWM jitter noise.
            if (slotChanged)
            {
                json jlog;
                jlog["event"] = "flight_mode_change";
                jlog["pwm"]   = pwm;
                jlog["slot"]  = slot;
                jlog["mode"]  = modeName(activeMode_);
                std::cout << "[FlightMode] " << jlog.dump() << "\n";
            }
        }
    }

    // ── HEARTBEAT — armed-state tracking + mode correction ───────────────────
    //
    // ArduPilot behaviour when DISARMED:
    //   custom_mode reflects the last *commanded* mode (RC switch OR GCS command).
    //   The heartbeat IS the authoritative source for GCS-commanded mode changes
    //   while disarmed — e.g. "set mode GUIDED" from the UI while on the bench.
    //   The old rule (RC slot wins when known) was discarding GCS commands.
    //
    // ArduPilot behaviour when ARMED:
    //   custom_mode reliably tracks the active mode, so heartbeat IS ground truth.
    //
    // Rule applied here:
    //   • Always track the armed state from base_mode.
    //   • If ARMED   → heartbeat mode wins (failsafe, GCS command, etc.).
    //   • If DISARMED → heartbeat mode always wins (it reflects GCS commands too).
    //     RC_CHANNELS still updates activeMode_ immediately on switch changes,
    //     but the heartbeat can correct it (e.g. GCS override while disarmed).
    else if (msg.msgid == MAVLINK_MSG_ID_HEARTBEAT)
    {
        mavlink_heartbeat_t hb;
        mavlink_msg_heartbeat_decode(&msg, &hb);

        const bool isArmed = (hb.base_mode & MAV_MODE_FLAG_SAFETY_ARMED) != 0;
        isArmed_ = isArmed;

        CopterMode hbMode = modeFromId(static_cast<uint8_t>(hb.custom_mode));

        // Both armed and disarmed: heartbeat is always authoritative.
        // The RC_CHANNELS handler still provides immediate feedback on RC
        // switch changes, but the heartbeat corrects any GCS-commanded
        // overrides (e.g. "set mode GUIDED" while disarmed on the bench).
        if (hbMode != activeMode_ && hbMode != CopterMode::UNKNOWN)
        {
            activeMode_ = hbMode;
            broadcastStatus(activeMode_, lastPwm_);
            std::cout << "[FlightMode] Mode (heartbeat, "
                      << (isArmed ? "armed" : "disarmed") << ") → "
                      << modeName(hbMode) << "\n";
        }
    }

    // ── PARAM_VALUE — autopilot echoes FLTMODE* ───────────────────────────────
    else if (msg.msgid == MAVLINK_MSG_ID_PARAM_VALUE)
    {
        mavlink_param_value_t pv;
        mavlink_msg_param_value_decode(&msg, &pv);

        // param_id is a fixed 16-byte field, NOT null-terminated when full
        std::string pid(pv.param_id,
                        strnlen(pv.param_id,
                                sizeof(pv.param_id)));

        for (int i = 0; i < NUM_SLOTS; ++i)
        {
            if (pid == PARAM_NAMES[i])
            {
                auto mode_id = static_cast<uint8_t>(pv.param_value);

                // ── Cache the mode ID so RC_CHANNELS can use it immediately ──
                slotModes_[i] = mode_id;

                json j;
                j["type"]    = "flight_mode_param";
                j["slot"]    = i;
                j["mode_id"] = static_cast<int>(mode_id);
                j["mode"]    = modeName(modeFromId(mode_id));
                if (send_cb_) send_cb_(j.dump());

                json jlog;
                jlog["event"]  = "flight_mode_param_received";
                jlog["param"]  = pid;
                jlog["id"]     = static_cast<int>(mode_id);
                jlog["mode"]   = modeName(modeFromId(mode_id));
                std::cout << "[FlightMode] " << jlog.dump() << "\n";
                break;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Frontend commands
// ═══════════════════════════════════════════════════════════════════════════════

void FlightMode::setMode(CopterMode mode)
{
    if (!transport_cb_)
    {
        std::cout << "[FlightMode] WARNING: no transport callback for setMode\n";
        return;
    }

    mavlink_message_t      mavmsg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_DO_SET_MODE;
    cmd.confirmation     = 0;
    cmd.param1           = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
    cmd.param2           = static_cast<float>(mode);

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                    &mavmsg, &cmd);
    transport_cb_(mavmsg);

    std::cout << "[FlightMode] Sent DO_SET_MODE → " << modeName(mode) << "\n";
}

void FlightMode::saveFlightModes(const std::array<uint8_t, NUM_SLOTS>& modes)
{
    if (!transport_cb_)
    {
        std::cout << "[FlightMode] WARNING: no transport callback for saveFlightModes\n";
        return;
    }

    for (int i = 0; i < NUM_SLOTS; ++i)
    {
        // ── Update local cache first ─────────────────────────────────────────
        // This keeps slotModes_ consistent with what was just written so that
        // the RC_CHANNELS handler immediately reflects the new configuration
        // without waiting for the autopilot PARAM_VALUE echo.
        slotModes_[i] = modes[i];

        sendParamSet(PARAM_NAMES[i], static_cast<float>(modes[i]));
    }

    // Single structured log — one line for the whole save operation
    json jlog;
    jlog["event"] = "flight_modes_saved";
    json arr = json::array();
    for (int i = 0; i < NUM_SLOTS; ++i)
    {
        json entry;
        entry["param"] = PARAM_NAMES[i];
        entry["id"]    = static_cast<int>(modes[i]);
        entry["mode"]  = modeName(modeFromId(modes[i]));
        arr.push_back(entry);
    }
    jlog["slots"] = arr;
    std::cout << "[FlightMode] " << jlog.dump() << "\n";

    json j;
    j["type"]    = "flight_mode_saved";
    j["message"] = "Flight modes saved to autopilot.";
    if (send_cb_) send_cb_(j.dump());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Private helpers
// ═══════════════════════════════════════════════════════════════════════════════

int FlightMode::pwmToSlot(uint16_t pwm) const
{
    for (int i = 0; i < NUM_SLOTS; ++i)
        if (pwm <= PWM_BOUNDS[i]) return i;
    return NUM_SLOTS - 1;
}

void FlightMode::broadcastStatus(CopterMode mode, uint16_t pwm)
{
    if (!send_cb_) return;

    json j;
    j["type"] = "flight_mode_status";
    j["mode"] = modeName(mode);
    j["pwm"]  = pwm;
    j["slot"] = pwmToSlot(pwm);
    send_cb_(j.dump());
}

void FlightMode::sendParamSet(const char* param_id, float value)
{
    if (!transport_cb_) return;

    mavlink_message_t   mavmsg;
    mavlink_param_set_t ps{};

    ps.target_system    = static_cast<uint8_t>(sysid_);
    ps.target_component = static_cast<uint8_t>(compid_);
    ps.param_value      = value;
    // ArduCopter FLTMODE params are int32 — using INT8 causes silent rejection
    ps.param_type       = MAV_PARAM_TYPE_INT32;

    std::strncpy(ps.param_id, param_id, 16);

    mavlink_msg_param_set_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                 &mavmsg, &ps);
    transport_cb_(mavmsg);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Request FLTMODE params from autopilot
// ═══════════════════════════════════════════════════════════════════════════════

void FlightMode::requestParams()
{
    if (!transport_cb_)
    {
        std::cout << "[FlightMode] WARNING: no transport callback for requestParams\n";
        return;
    }

    // Send a PARAM_REQUEST_READ for each FLTMODE1-6 individually.
    // Using PARAM_REQUEST_READ (by name) is more reliable than
    // PARAM_REQUEST_LIST which dumps every param and can flood the link.
    for (int i = 0; i < NUM_SLOTS; ++i)
    {
        mavlink_message_t        mavmsg;
        mavlink_param_request_read_t req{};

        req.target_system    = static_cast<uint8_t>(sysid_);
        req.target_component = static_cast<uint8_t>(compid_);
        req.param_index      = -1;          // -1 = look up by name
        std::strncpy(req.param_id, PARAM_NAMES[i], 16);

        mavlink_msg_param_request_read_encode(
            255, MAV_COMP_ID_MISSIONPLANNER, &mavmsg, &req);
        transport_cb_(mavmsg);
    }

    paramsRequested_ = true;
    std::cout << "[FlightMode] Requested FLTMODE1-6 from autopilot\n";
}