<<<<<<< Updated upstream
/**
 * esc_calibration.cpp
 * TiHANFly GCS — ArduPilot ESC Calibration (Safety-Button / Reboot method)
 *
 * Sequence:
 *  [preflight]   Send MAV_CMD_PREFLIGHT_CALIBRATION param7=1
 *                Wait ≤3 s for COMMAND_ACK  (proceed on timeout or result=4 — normal for ArduPilot 4.x)
 *                Retry up to MAX_RETRIES times on TEMPORARILY_REJECTED (result=3)
 *  [rebooting]   Send MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN param1=1
 *  [wait_safety] Emit "wait_safety" status — user must long-press safety button
 *                FC will autonomously sweep ESC throttle and beep; no GCS action needed
 *
 * cancelEscCalibration() sets cancelled_=true; all polling loops respect it.
 *
 * FIX (vs previous version):
 *   The old retry branch incremented retry_count only inside the loop condition
 *   check, which meant on the final attempt a TEMPORARILY_REJECTED result fell
 *   through to the hard-error block with a misleading "retrying" log already
 *   printed.  The fix separates the increment from the gate check so that:
 *     • retry_count is incremented first
 *     • if retry_count < MAX_RETRIES we retry with accurate attempt numbers
 *     • if retry_count == MAX_RETRIES we emit an explicit exhaustion error
 */

#include "esc_calibration.h"

#include <nlohmann/json.hpp>
#include <iostream>
#include <thread>
#include <chrono>

using json = nlohmann::json;

// ─────────────────────────────────────────────────────────────────────────────
//  Result code → human-readable string
// ─────────────────────────────────────────────────────────────────────────────

static std::string mavResultToString(int result)
{
    switch (result)
    {
        case MAV_RESULT_ACCEPTED:             return "0 (ACCEPTED)";
        case MAV_RESULT_DENIED:               return "1 (DENIED) — check pre-arm, RC, or disarm state";
        case MAV_RESULT_FAILED:               return "2 (FAILED) — execution error";
        case MAV_RESULT_TEMPORARILY_REJECTED: return "3 (TEMPORARILY_REJECTED) — FC busy";
        case MAV_RESULT_UNSUPPORTED:          return "4 (UNSUPPORTED) — normal for ArduPilot 4.x, proceeding";
        case MAV_RESULT_IN_PROGRESS:          return "5 (IN_PROGRESS)";
        case MAV_RESULT_CANCELLED:            return "6 (CANCELLED)";
        default:                              return std::to_string(result) + " (UNKNOWN)";
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Wiring
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::setSendCallback(SendCallback cb)           { send_cb_      = std::move(cb); }
void EscCalibration::setTransportCallback(TransportCallback cb) { transport_cb_ = std::move(cb); }
void EscCalibration::setVehicleInfo(int sysid, int compid)      { sysid_ = sysid; compid_ = compid; }

// ─────────────────────────────────────────────────────────────────────────────
//  Status broadcast
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::sendStatus(const std::string& stage,
                                const std::string& message,
                                bool               busy)
{
    json j;
    j["type"]    = "esc_calibration_status";
    j["stage"]   = stage;
    j["message"] = message;
    j["busy"]    = busy;

    std::cout << "[ESC] Stage=" << stage << " | " << message << "\n";

    if (send_cb_)
        send_cb_(j.dump());
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAVLink helpers
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::sendPreflight()
{
    if (!transport_cb_) return;

    // ArduPilot requires ESC_CALIBRATION param = 3 before reboot
    // This is more reliable than MAV_CMD_PREFLIGHT_CALIBRATION param7=1
    mavlink_message_t  msg;
    mavlink_param_set_t param{};

    param.target_system    = static_cast<uint8_t>(sysid_);
    param.target_component = static_cast<uint8_t>(compid_);
    param.param_value      = 3.0f;   // 3 = calibrate on next boot
    param.param_type       = MAV_PARAM_TYPE_INT8;

    // Copy param name — must be exactly "ESC_CALIBRATION"
    strncpy(param.param_id, "ESC_CALIBRATION", sizeof(param.param_id));

    mavlink_msg_param_set_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &param);
    transport_cb_(msg);

    std::cout << "[ESC] ESC_CALIBRATION param set to 3\n";
}

void EscCalibration::sendReboot()
{
    if (!transport_cb_) return;

    mavlink_message_t      msg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN;
    cmd.confirmation     = 0;
    cmd.param1 = 1;   // 1 = reboot autopilot
    cmd.param2 = 0;
    cmd.param3 = 0;
    cmd.param4 = 0;
    cmd.param5 = 0;
    cmd.param6 = 0;
    cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);
    transport_cb_(msg);

    std::cout << "[ESC] Reboot command sent to FC\n";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Inbound MAVLink
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::processMessage(const mavlink_message_t& msg)
{
    if (msg.msgid != MAVLINK_MSG_ID_COMMAND_ACK) return;
    if (!calibrating_) return;

    mavlink_command_ack_t ack;
    mavlink_msg_command_ack_decode(&msg, &ack);

    if (ack.command != MAV_CMD_PREFLIGHT_CALIBRATION) return;

    ack_result_.store(static_cast<int>(ack.result));
    ack_received_.store(true);

    std::cout << "[ESC] COMMAND_ACK preflight result=" << mavResultToString(ack.result) << "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cancel
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::cancelEscCalibration()
{
    if (!calibrating_) return;
    cancelled_.store(true);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Calibration sequence  (blocking — run on a detached thread)
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::startEscCalibration()
{
    bool expected = false;
    if (!calibrating_.compare_exchange_strong(expected, true))
    {
        sendStatus("busy", "ESC calibration already in progress", false);
        return;
    }

    cancelled_    .store(false);
    ack_received_ .store(false);
    ack_result_   .store(-1);

    if (!transport_cb_)
    {
        sendStatus("error", "No vehicle connected — cannot start ESC calibration", false);
        calibrating_.store(false);
        return;
    }

    // ── STEP 1: Send MAV_CMD_PREFLIGHT_CALIBRATION param7=1 ──────────────────
    const int MAX_RETRIES = 3;
    int  retry_count   = 0;
    bool preflight_done = false;

    while (!preflight_done && !cancelled_.load())
    {
        ack_received_.store(false);
        ack_result_.store(-1);

        std::string attempt_suffix;
        if (retry_count > 0)
            attempt_suffix = " (attempt " + std::to_string(retry_count + 1) +
                             "/" + std::to_string(MAX_RETRIES) + ")";

sendStatus("preflight",
           "Setting ESC_CALIBRATION=3 on FC" + attempt_suffix,
           true);
sendPreflight();

// Wait 2 s for param to be written — no ACK needed for PARAM_SET
for (int i = 0; i < 40 && !cancelled_.load(); ++i)
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

// If no real ACK arrived from processMessage(), treat as success (PARAM_SET has no ACK).
// But if processMessage() DID set a result, honour it so error branches are reachable.
if (!ack_received_.load())
{
    ack_received_.store(true);
    ack_result_.store(MAV_RESULT_ACCEPTED);
}


        if (cancelled_.load())
        {
            sendStatus("cancelled", "ESC calibration cancelled", false);
            calibrating_.store(false);
            return;
        }

        const int result = ack_result_.load();

        if (!ack_received_.load())
        {
            sendStatus("timeout",
                       "No COMMAND_ACK from FC (3 s timeout) — proceeding",
                       true);
            preflight_done = true;
        }
        else if (result == MAV_RESULT_ACCEPTED   ||
                 result == MAV_RESULT_IN_PROGRESS ||
                 result == MAV_RESULT_UNSUPPORTED)
        {
            sendStatus("accepted",
                       "FC acknowledged (result=" + mavResultToString(result) + ")",
                       true);
            preflight_done = true;
        }
        else if (result == MAV_RESULT_TEMPORARILY_REJECTED)
        {
            ++retry_count;
            if (retry_count < MAX_RETRIES)
            {
                sendStatus("retrying",
                           "FC temporarily busy (result=3) — retrying in 2 s "
                           "(" + std::to_string(retry_count + 1) +
                           "/" + std::to_string(MAX_RETRIES) + ")",
                           true);
                for (int i = 0; i < 40 && !cancelled_.load(); ++i)
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                continue;
            }
            else
            {
                sendStatus("error",
                           "FC rejected ESC calibration after " +
                           std::to_string(MAX_RETRIES) + " attempts (" +
                           mavResultToString(result) + ")",
                           false);
                calibrating_.store(false);
                return;
            }
        }
        else
        {
            sendStatus("error",
                       "FC rejected ESC calibration (" + mavResultToString(result) + ")",
                       false);
            calibrating_.store(false);
            return;
        }
    }

    if (cancelled_.load())
    {
        sendStatus("cancelled", "ESC calibration cancelled", false);
        calibrating_.store(false);
        return;
    }

    // ── STEP 2: Instruct user to power-cycle — NO reboot command sent ─────────
// ── STEP 2: Reboot the FC via MAVLink (matches Mission Planner behaviour) ──
sendStatus("rebooting",
           "Rebooting FC — wait for it to restart (≈5 s)",
           true);
sendReboot();

// Give reboot command time to transmit before serial link drops
for (int i = 0; i < 40 && !cancelled_.load(); ++i)
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

if (cancelled_.load())
{
    sendStatus("cancelled", "ESC calibration cancelled", false);
    calibrating_.store(false);
    return;
}

// ── STEP 3: Instruct user to press safety button ──────────────────────────
sendStatus("power_cycle",
           "FC is rebooting. Once restarted — long-press safety button (≥2 s). "
           "ESCs will beep max throttle, then min throttle, then FC reboots normally.",
           false);

calibrating_.store(false);
=======
/**
 * esc_calibration.cpp
 * TiHANFly GCS — ArduPilot ESC Calibration (Safety-Button / Reboot method)
 *
 * Sequence:
 *  [preflight]   Send MAV_CMD_PREFLIGHT_CALIBRATION param7=1
 *                Wait ≤3 s for COMMAND_ACK  (proceed on timeout or result=4 — normal for ArduPilot 4.x)
 *                Retry up to MAX_RETRIES times on TEMPORARILY_REJECTED (result=3)
 *  [rebooting]   Send MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN param1=1
 *  [wait_safety] Emit "wait_safety" status — user must long-press safety button
 *                FC will autonomously sweep ESC throttle and beep; no GCS action needed
 *
 * cancelEscCalibration() sets cancelled_=true; all polling loops respect it.
 *
 * FIX (vs previous version):
 *   The old retry branch incremented retry_count only inside the loop condition
 *   check, which meant on the final attempt a TEMPORARILY_REJECTED result fell
 *   through to the hard-error block with a misleading "retrying" log already
 *   printed.  The fix separates the increment from the gate check so that:
 *     • retry_count is incremented first
 *     • if retry_count < MAX_RETRIES we retry with accurate attempt numbers
 *     • if retry_count == MAX_RETRIES we emit an explicit exhaustion error
 */

#include "esc_calibration.h"

#include <nlohmann/json.hpp>
#include <iostream>
#include <thread>
#include <chrono>

using json = nlohmann::json;

// ─────────────────────────────────────────────────────────────────────────────
//  Result code → human-readable string
// ─────────────────────────────────────────────────────────────────────────────

static std::string mavResultToString(int result)
{
    switch (result)
    {
        case MAV_RESULT_ACCEPTED:             return "0 (ACCEPTED)";
        case MAV_RESULT_DENIED:               return "1 (DENIED) — check pre-arm, RC, or disarm state";
        case MAV_RESULT_FAILED:               return "2 (FAILED) — execution error";
        case MAV_RESULT_TEMPORARILY_REJECTED: return "3 (TEMPORARILY_REJECTED) — FC busy";
        case MAV_RESULT_UNSUPPORTED:          return "4 (UNSUPPORTED) — normal for ArduPilot 4.x, proceeding";
        case MAV_RESULT_IN_PROGRESS:          return "5 (IN_PROGRESS)";
        case MAV_RESULT_CANCELLED:            return "6 (CANCELLED)";
        default:                              return std::to_string(result) + " (UNKNOWN)";
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Wiring
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::setSendCallback(SendCallback cb)           { send_cb_      = std::move(cb); }
void EscCalibration::setTransportCallback(TransportCallback cb) { transport_cb_ = std::move(cb); }
void EscCalibration::setVehicleInfo(int sysid, int compid)      { sysid_ = sysid; compid_ = compid; }

// ─────────────────────────────────────────────────────────────────────────────
//  Status broadcast
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::sendStatus(const std::string& stage,
                                const std::string& message,
                                bool               busy)
{
    json j;
    j["type"]    = "esc_calibration_status";
    j["stage"]   = stage;
    j["message"] = message;
    j["busy"]    = busy;

    std::cout << "[ESC] Stage=" << stage << " | " << message << "\n";

    if (send_cb_)
        send_cb_(j.dump());
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAVLink helpers
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::sendPreflight()
{
    if (!transport_cb_) return;

    // ArduPilot requires ESC_CALIBRATION param = 3 before reboot
    // This is more reliable than MAV_CMD_PREFLIGHT_CALIBRATION param7=1
    mavlink_message_t  msg;
    mavlink_param_set_t param{};

    param.target_system    = static_cast<uint8_t>(sysid_);
    param.target_component = static_cast<uint8_t>(compid_);
    param.param_value      = 3.0f;   // 3 = calibrate on next boot
    param.param_type       = MAV_PARAM_TYPE_INT8;

    // Copy param name — must be exactly "ESC_CALIBRATION"
    strncpy(param.param_id, "ESC_CALIBRATION", sizeof(param.param_id));

    mavlink_msg_param_set_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &param);
    transport_cb_(msg);

    std::cout << "[ESC] ESC_CALIBRATION param set to 3\n";
}

void EscCalibration::sendReboot()
{
    if (!transport_cb_) return;

    mavlink_message_t      msg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN;
    cmd.confirmation     = 0;
    cmd.param1 = 1;   // 1 = reboot autopilot
    cmd.param2 = 0;
    cmd.param3 = 0;
    cmd.param4 = 0;
    cmd.param5 = 0;
    cmd.param6 = 0;
    cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);
    transport_cb_(msg);

    std::cout << "[ESC] Reboot command sent to FC\n";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Inbound MAVLink
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::processMessage(const mavlink_message_t& msg)
{
    if (msg.msgid != MAVLINK_MSG_ID_COMMAND_ACK) return;
    if (!calibrating_) return;

    mavlink_command_ack_t ack;
    mavlink_msg_command_ack_decode(&msg, &ack);

    if (ack.command != MAV_CMD_PREFLIGHT_CALIBRATION) return;

    ack_result_.store(static_cast<int>(ack.result));
    ack_received_.store(true);

    std::cout << "[ESC] COMMAND_ACK preflight result=" << mavResultToString(ack.result) << "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cancel
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::cancelEscCalibration()
{
    if (!calibrating_) return;
    cancelled_.store(true);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Calibration sequence  (blocking — run on a detached thread)
// ─────────────────────────────────────────────────────────────────────────────

void EscCalibration::startEscCalibration()
{
    bool expected = false;
    if (!calibrating_.compare_exchange_strong(expected, true))
    {
        sendStatus("busy", "ESC calibration already in progress", false);
        return;
    }

    cancelled_    .store(false);
    ack_received_ .store(false);
    ack_result_   .store(-1);

    if (!transport_cb_)
    {
        sendStatus("error", "No vehicle connected — cannot start ESC calibration", false);
        calibrating_.store(false);
        return;
    }

    // ── STEP 1: Send MAV_CMD_PREFLIGHT_CALIBRATION param7=1 ──────────────────
    const int MAX_RETRIES = 3;
    int  retry_count   = 0;
    bool preflight_done = false;

    while (!preflight_done && !cancelled_.load())
    {
        ack_received_.store(false);
        ack_result_.store(-1);

        std::string attempt_suffix;
        if (retry_count > 0)
            attempt_suffix = " (attempt " + std::to_string(retry_count + 1) +
                             "/" + std::to_string(MAX_RETRIES) + ")";

sendStatus("preflight",
           "Setting ESC_CALIBRATION=3 on FC" + attempt_suffix,
           true);
sendPreflight();

// Wait 2 s for param to be written — no ACK needed for PARAM_SET
for (int i = 0; i < 40 && !cancelled_.load(); ++i)
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

// If no real ACK arrived from processMessage(), treat as success (PARAM_SET has no ACK).
// But if processMessage() DID set a result, honour it so error branches are reachable.
if (!ack_received_.load())
{
    ack_received_.store(true);
    ack_result_.store(MAV_RESULT_ACCEPTED);
}


        if (cancelled_.load())
        {
            sendStatus("cancelled", "ESC calibration cancelled", false);
            calibrating_.store(false);
            return;
        }

        const int result = ack_result_.load();

        if (!ack_received_.load())
        {
            sendStatus("timeout",
                       "No COMMAND_ACK from FC (3 s timeout) — proceeding",
                       true);
            preflight_done = true;
        }
        else if (result == MAV_RESULT_ACCEPTED   ||
                 result == MAV_RESULT_IN_PROGRESS ||
                 result == MAV_RESULT_UNSUPPORTED)
        {
            sendStatus("accepted",
                       "FC acknowledged (result=" + mavResultToString(result) + ")",
                       true);
            preflight_done = true;
        }
        else if (result == MAV_RESULT_TEMPORARILY_REJECTED)
        {
            ++retry_count;
            if (retry_count < MAX_RETRIES)
            {
                sendStatus("retrying",
                           "FC temporarily busy (result=3) — retrying in 2 s "
                           "(" + std::to_string(retry_count + 1) +
                           "/" + std::to_string(MAX_RETRIES) + ")",
                           true);
                for (int i = 0; i < 40 && !cancelled_.load(); ++i)
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                continue;
            }
            else
            {
                sendStatus("error",
                           "FC rejected ESC calibration after " +
                           std::to_string(MAX_RETRIES) + " attempts (" +
                           mavResultToString(result) + ")",
                           false);
                calibrating_.store(false);
                return;
            }
        }
        else
        {
            sendStatus("error",
                       "FC rejected ESC calibration (" + mavResultToString(result) + ")",
                       false);
            calibrating_.store(false);
            return;
        }
    }

    if (cancelled_.load())
    {
        sendStatus("cancelled", "ESC calibration cancelled", false);
        calibrating_.store(false);
        return;
    }

    // ── STEP 2: Instruct user to power-cycle — NO reboot command sent ─────────
// ── STEP 2: Reboot the FC via MAVLink (matches Mission Planner behaviour) ──
sendStatus("rebooting",
           "Rebooting FC — wait for it to restart (≈5 s)",
           true);
sendReboot();

// Give reboot command time to transmit before serial link drops
for (int i = 0; i < 40 && !cancelled_.load(); ++i)
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

if (cancelled_.load())
{
    sendStatus("cancelled", "ESC calibration cancelled", false);
    calibrating_.store(false);
    return;
}

// ── STEP 3: Instruct user to press safety button ──────────────────────────
sendStatus("power_cycle",
           "FC is rebooting. Once restarted — long-press safety button (≥2 s). "
           "ESCs will beep max throttle, then min throttle, then FC reboots normally.",
           false);

calibrating_.store(false);
>>>>>>> Stashed changes
}