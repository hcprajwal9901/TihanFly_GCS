#include "radio_calibration.h"
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ═══════════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════════

void RadioCalibration::setVehicleInfo(int sysid, int compid)
{
    sysid_  = sysid;
    compid_ = compid;
}

void RadioCalibration::setSendCallback(std::function<void(const std::string&)> cb)
{
    send_cb_ = cb;
}

void RadioCalibration::setTransportCallback(std::function<void(const mavlink_message_t&)> cb)
{
    transport_cb_ = cb;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

void RadioCalibration::startRadioCalibration()
{
    if (accumulating_)
    {
        std::cout << "[RadioCalib] Already accumulating – ignoring duplicate start\n";
        return;
    }

    // Reset all channel min/max accumulators
    for (auto& ch : channels_)
    {
        ch.raw  = 0;
        ch.min  = 65535;
        ch.max  = 0;
        ch.trim = 1500;
    }

    sendStartCommand();

    running_      = true;    // may get cleared if FC rejects via COMMAND_ACK
    accumulating_ = true;    // keeps min/max recording alive regardless of ACK

    broadcastStatus("Radio calibration started. Move all sticks and switches to their full extents.");
    std::cout << "[RadioCalib] Calibration started\n";
}

void RadioCalibration::cancelRadioCalibration()
{
    if (!accumulating_)
        return;

    sendCancelCommand();
    running_      = false;
    accumulating_ = false;

    broadcastStatus("Radio calibration cancelled.");
    std::cout << "[RadioCalib] Calibration cancelled\n";
}

void RadioCalibration::completeRadioCalibration()
{
    if (!accumulating_)
    {
        std::cout << "[RadioCalib] completeRadioCalibration() called but no session active — ignoring\n";
        return;
    }

    std::cout << "[RadioCalib] Completing calibration — computing min/max/trim\n";

    // Compute trim for every channel that received data
    for (int i = 0; i < NUM_CHANNELS; ++i)
    {
        auto& ch = channels_[i];
        if (ch.max > ch.min)
        {
            // Channel 3 (Throttle, 0-based idx=2): trim at minimum
            ch.trim = (i == 2) ? ch.min
                                : static_cast<uint16_t>((ch.min + ch.max) / 2);
        }
        else
        {
            // No movement recorded — use last known raw value or default 1500
            ch.trim = (ch.raw != 0) ? ch.raw : 1500;
            // Also fill min/max from raw so the popup has sensible values
            if (ch.raw != 0 && ch.min == 65535) ch.min = ch.raw;
            if (ch.raw != 0 && ch.max == 0)     ch.max = ch.raw;
        }
    }

    // Build and send radio_calibration_complete JSON to frontend
    json j;
    j["type"]    = "radio_calibration_complete";
    j["success"] = true;

    json chs = json::array();
    for (int i = 0; i < NUM_CHANNELS; ++i)
    {
        const auto& ch = channels_[i];
        // Include channel if it has any real data
        if (ch.raw == 0 && ch.min == 65535 && ch.max == 0)
            continue;

        // A channel "moved" if its recorded range exceeds a small deadband (>4 µs).
        // Untouched switches / disconnected channels typically sit fixed at one
        // value (e.g. 999|999 or 1499|1500) and should be flagged for the frontend
        // so they can be visually distinguished from properly exercised channels.
        const bool moved = (ch.max > ch.min) && ((ch.max - ch.min) > 4);

        json c;
        c["channel"] = i + 1;   // 1-based for frontend
        c["min"]     = (ch.min == 65535) ? ch.raw : ch.min;
        c["max"]     = (ch.max == 0)     ? ch.raw : ch.max;
        c["trim"]    = ch.trim;
        c["moved"]   = moved;   // false → channel never moved; frontend greys it out
        chs.push_back(c);
    }
    j["channels"] = chs;

    if (send_cb_)
        send_cb_(j.dump());

    running_      = false;
    accumulating_ = false;

    broadcastStatus("Radio calibration successful.", true);
    std::cout << "[RadioCalib] Calibration complete — " << chs.size() << " channels reported\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MESSAGE INGESTION
// ═══════════════════════════════════════════════════════════════════════════════

void RadioCalibration::processMessage(const mavlink_message_t& msg)
{
    // Discard frames not from this vehicle's autopilot.
    // RC_CHANNELS is unicast (not broadcast like MAG_CAL_*), so filtering
    // is both safe and necessary to prevent RC data cross-talk between drones.
    if (static_cast<int>(msg.sysid) != sysid_)
        return;

    switch (msg.msgid)
    {
        // ── RC_CHANNELS — live values from the drone ───────────────────────
        case MAVLINK_MSG_ID_RC_CHANNELS:
        {
            mavlink_rc_channels_t rc;
            mavlink_msg_rc_channels_decode(&msg, &rc);

            // Map each raw field to our channels_ array (0-based index)
            const uint16_t raw[18] = {
                rc.chan1_raw,  rc.chan2_raw,  rc.chan3_raw,  rc.chan4_raw,
                rc.chan5_raw,  rc.chan6_raw,  rc.chan7_raw,  rc.chan8_raw,
                rc.chan9_raw,  rc.chan10_raw, rc.chan11_raw, rc.chan12_raw,
                rc.chan13_raw, rc.chan14_raw, rc.chan15_raw, rc.chan16_raw,
                rc.chan17_raw, rc.chan18_raw
            };

            for (int i = 0; i < NUM_CHANNELS; ++i)
            {
                auto& ch = channels_[i];
                ch.raw = raw[i];

                // Accumulate min/max whenever a calibration session is active.
                // Use accumulating_ (set on start, cleared on complete/cancel)
                // instead of running_ so data is captured even when the FC
                // returns a soft ACK result (TEMPORARILY_REJECTED=1, UNSUPPORTED=3)
                // but has actually entered calibration mode.
                if (accumulating_ && raw[i] != 0 && raw[i] != UINT16_MAX)
                {
                    if (raw[i] < ch.min) ch.min = raw[i];
                    if (raw[i] > ch.max) ch.max = raw[i];
                }
            }

            // Always broadcast live channel data to the frontend so the
            // radio panel bars stay animated, even outside a calibration.
            broadcastChannelData();
            break;
        }

        // ── RC_CHANNELS_RAW — older/legacy message, same treatment ─────────
        case MAVLINK_MSG_ID_RC_CHANNELS_RAW:
        {
            mavlink_rc_channels_raw_t rc;
            mavlink_msg_rc_channels_raw_decode(&msg, &rc);

            const uint16_t raw[8] = {
                rc.chan1_raw, rc.chan2_raw, rc.chan3_raw, rc.chan4_raw,
                rc.chan5_raw, rc.chan6_raw, rc.chan7_raw, rc.chan8_raw
            };

            for (int i = 0; i < 8; ++i)
            {
                auto& ch = channels_[i];
                ch.raw = raw[i];

                if (accumulating_ && raw[i] != 0 && raw[i] != UINT16_MAX)
                {
                    if (raw[i] < ch.min) ch.min = raw[i];
                    if (raw[i] > ch.max) ch.max = raw[i];
                }
            }

            broadcastChannelData();
            break;
        }

        // ── COMMAND_ACK — drone confirms it entered / left calib mode ───────
        case MAVLINK_MSG_ID_COMMAND_ACK:
        {
            mavlink_command_ack_t ack;
            mavlink_msg_command_ack_decode(&msg, &ack);

            if (ack.command == MAV_CMD_PREFLIGHT_CALIBRATION)
            {
                if (ack.result == MAV_RESULT_ACCEPTED)
                {
                    std::cout << "[RadioCalib] COMMAND_ACK: MAV_RESULT_ACCEPTED\n";
                }
                else if (ack.result == MAV_RESULT_TEMPORARILY_REJECTED ||
                         ack.result == MAV_RESULT_IN_PROGRESS          ||
                         ack.result == MAV_RESULT_UNSUPPORTED)
                {
                    // Soft / ignorable results — ArduPilot commonly returns
                    // TEMPORARILY_REJECTED (1) or UNSUPPORTED (3) for
                    // MAV_CMD_PREFLIGHT_CALIBRATION yet still enters radio
                    // calibration mode immediately afterwards (confirmed by the
                    // "PreArm: RC calibrating" STATUSTEXT that follows).
                    // Keep accumulating_ alive so min/max recording continues
                    // uninterrupted.  Do NOT surface a rejection message to
                    // the user — calibration is already proceeding.
                    std::cout << "[RadioCalib] COMMAND_ACK: soft/ignorable result=" << (int)ack.result
                              << " (TEMPORARILY_REJECTED / IN_PROGRESS / UNSUPPORTED)"
                                 " — continuing to accumulate\n";
                }
                else
                {
                    // Genuine hard failure: MAV_RESULT_DENIED (2) / FAILED (4) / NO_RESOURCES (6)
                    std::cout << "[RadioCalib] COMMAND_ACK: hard failure result=" << (int)ack.result << "\n";

                    if (running_ || accumulating_)
                    {
                        running_      = false;
                        accumulating_ = false;
                        broadcastStatus("Radio calibration rejected by flight controller.", false);
                    }
                }
            }
            break;
        }

        // ── STATUSTEXT — forward drone messages to the UI ────────────────
        case MAVLINK_MSG_ID_STATUSTEXT:
        {
            mavlink_statustext_t st;
            mavlink_msg_statustext_decode(&msg, &st);

            std::string text(st.text,
                             strnlen(st.text, sizeof(st.text)));

            // Only relay radio-related status messages
            if (text.find("Radio") != std::string::npos ||
                text.find("radio") != std::string::npos ||
                text.find("RC")    != std::string::npos)
            {
                json j;
                j["type"]    = "radio_calibration_status";
                j["message"] = text;

                if (send_cb_)
                    send_cb_(j.dump());

                std::cout << "[RadioCalib] STATUSTEXT: " << text << "\n";
            }
            break;
        }

        default:
            break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

const RadioCalibration::ChannelData& RadioCalibration::channel(int idx) const
{
    if (idx < 0 || idx >= NUM_CHANNELS)
    {
        static ChannelData dummy{};
        return dummy;
    }
    return channels_[idx];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRIVATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

void RadioCalibration::sendStartCommand()
{
    if (!transport_cb_)
    {
        std::cout << "[RadioCalib] WARNING: no transport callback\n";
        return;
    }

    mavlink_message_t      mavmsg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_PREFLIGHT_CALIBRATION;
    cmd.confirmation     = 0;
    cmd.param1           = 0;   // Gyro     — off
    cmd.param2           = 0;   // Mag      — off
    cmd.param3           = 0;   // Pressure — off
    cmd.param4           = 1;   // Radio    — ON  ← triggers RC calib
    cmd.param5           = 0;
    cmd.param6           = 0;
    cmd.param7           = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                    &mavmsg, &cmd);
    transport_cb_(mavmsg);

    std::cout << "[RadioCalib] Sent MAV_CMD_PREFLIGHT_CALIBRATION param4=1\n";
}

void RadioCalibration::sendCancelCommand()
{
    if (!transport_cb_)
        return;

    // Sending param4=0 exits radio calibration mode on ArduPilot
    mavlink_message_t      mavmsg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_PREFLIGHT_CALIBRATION;
    cmd.confirmation     = 0;
    cmd.param1 = cmd.param2 = cmd.param3 = 0;
    cmd.param4           = 0;   // Radio — OFF (exits calib mode)
    cmd.param5 = cmd.param6 = cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                    &mavmsg, &cmd);
    transport_cb_(mavmsg);

    std::cout << "[RadioCalib] Sent cancel (param4=0)\n";
}

void RadioCalibration::broadcastChannelData() const
{
    if (!send_cb_)
        return;

    json j;
    j["type"] = "rc_channels";

    json chs = json::array();
    for (int i = 0; i < NUM_CHANNELS; ++i)
    {
        const auto& ch = channels_[i];
        if (ch.raw == 0)
            continue;   // skip unused/unmapped channels

        json c;
        c["channel"] = i + 1;   // 1-based
        c["raw"]     = ch.raw;
        chs.push_back(c);
    }
    j["channels"] = chs;

    send_cb_(j.dump());
}

void RadioCalibration::broadcastStatus(const std::string& text, bool success) const
{
    if (!send_cb_)
        return;

    json j;
    j["type"]    = "radio_calibration_status";
    j["message"] = text;
    j["success"] = success;

    send_cb_(j.dump());
}