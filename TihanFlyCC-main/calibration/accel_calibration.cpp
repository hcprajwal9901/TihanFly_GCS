#include "accel_calibration.h"
#include <nlohmann/json.hpp>
#include <cmath>
#include <chrono>
#include <thread>

using json = nlohmann::json;

// ── ACCELCAL_VEHICLE_POS values ───────────────────────────────────────────────
static constexpr int ACCELCAL_POS_LEVEL    = 1;
static constexpr int ACCELCAL_POS_LEFT     = 2;
static constexpr int ACCELCAL_POS_RIGHT    = 3;
static constexpr int ACCELCAL_POS_NOSEDOWN = 4;
static constexpr int ACCELCAL_POS_NOSEUP   = 5;
static constexpr int ACCELCAL_POS_BACK     = 6;   // upside-down
static constexpr int ACCELCAL_POS_SUCCESS  = 16384;
static constexpr int ACCELCAL_POS_FAILED   = 16385;

// Attitude validation — allow ±30° (0.52 rad) from the ideal value.
static constexpr float ATTITUDE_TOLERANCE_RAD = 0.52f;

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTRUCTOR / DESTRUCTOR
// ═══════════════════════════════════════════════════════════════════════════════

AccelCalibration::AccelCalibration()
{
    std::cout << "[AccelCalibration] Constructed\n";
    launchStepTimeoutThread();
}

AccelCalibration::~AccelCalibration()
{
    stopRetryWatcher();
    // Signal the long-lived timeout thread to exit, then join.
    {
        std::lock_guard<std::mutex> lk(stepTimeoutMtx_);
        stepTimeoutActive_ = false;
        stepTimeoutArmed_  = false;
    }
    stepTimeoutCv_.notify_all();
    if (stepTimeoutThread_.joinable())
        stepTimeoutThread_.join();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VEHICLE CONTEXT INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::setVehicleInfo(int sysid, int compid)
{
    sysid_  = sysid;
    compid_ = compid;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROCESS MAVLINK MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::processMessage(const mavlink_message_t& msg)
{
    // ── Sysid filter ─────────────────────────────────────────────────────────
    // Only process messages from the drone this instance is assigned to.
    // sysid_ is set by setVehicleInfo(); until it is set (== 0) all messages
    // are accepted so nothing breaks in single-vehicle legacy code.
    if (sysid_ != 0 && msg.sysid != 0 && msg.sysid != static_cast<uint8_t>(sysid_))
        return;

    if (accelState == AccelCalibState::IN_PROGRESS)
    {
        std::cout << "[Calib][RX] msgid=" << msg.msgid
                  << " (" << mavlinkMsgName(msg.msgid) << ")"
                  << " from=" << (int)msg.sysid
                  << "/" << (int)msg.compid
                  << "\n";
    }

    switch (msg.msgid)
    {
        // ── Heartbeat ────────────────────────────────────────────────────────
        case MAVLINK_MSG_ID_HEARTBEAT:
        {
            mavlink_heartbeat_t hb;
            mavlink_msg_heartbeat_decode(&msg, &hb);
            armed_ = (hb.base_mode & MAV_MODE_FLAG_SAFETY_ARMED) != 0;
            break;
        }

        // ── Attitude telemetry ────────────────────────────────────────────────
        case MAVLINK_MSG_ID_ATTITUDE:
        {
            mavlink_attitude_t att;
            mavlink_msg_attitude_decode(&msg, &att);
            roll_  = att.roll;
            pitch_ = att.pitch;
            yaw_   = att.yaw;

            if (accelState == AccelCalibState::IN_PROGRESS && send_cb_)
            {
                json j;
                j["type"]  = "calib_attitude";
                j["roll"]  = roll_;
                j["pitch"] = pitch_;
                j["yaw"]   = yaw_;
                send_cb_(j.dump());
            }
            break;
        }

        // ── COMMAND_LONG (drone → GCS) ────────────────────────────────────────
        case MAVLINK_MSG_ID_COMMAND_LONG:
        {
            mavlink_command_long_t cmd;
            mavlink_msg_command_long_decode(&msg, &cmd);

            if (accelState == AccelCalibState::IN_PROGRESS)
            {
                std::cout << "[Calib][RX] COMMAND_LONG"
                          << " cmd="    << cmd.command
                          << " p1="     << (int)cmd.param1
                          << " target=" << (int)cmd.target_system
                          << "/" << (int)cmd.target_component << "\n";
            }

            if (cmd.command == MAV_CMD_ACCELCAL_VEHICLE_POS &&
                accelState  == AccelCalibState::IN_PROGRESS)
            {
                stopRetryWatcher();
                handleAccelVehiclePos(cmd);
            }
            break;
        }

        // ── COMMAND_ACK (drone → GCS) ─────────────────────────────────────────
        case MAVLINK_MSG_ID_COMMAND_ACK:
        {
            mavlink_command_ack_t ack;
            mavlink_msg_command_ack_decode(&msg, &ack);

            if (accelState == AccelCalibState::IN_PROGRESS || ack.command == MAV_CMD_PREFLIGHT_CALIBRATION)
            {
                std::cout << "[Calib][RX] COMMAND_ACK"
                          << " cmd="    << ack.command
                          << " result=" << (int)ack.result << "\n";
            }

            if (ack.command == MAV_CMD_PREFLIGHT_CALIBRATION)
            {
                if (accelState == AccelCalibState::IN_PROGRESS)
                {
                    if (cancelPending_)
                    {
                        std::cout << "[Calib] Ignoring cancel ACK result="
                                  << (int)ack.result << " (cancel window)\n";
                        break;
                    }

                    if (ack.result == MAV_RESULT_ACCEPTED)
                    {
                        std::cout << "[Calib] Drone accepted preflight calib — "
                                     "waiting for first position request\n";
                        stopRetryWatcher();
                        sendCalibJSON("calibration_status", "started",
                                      "Drone accepted — waiting for first position...");
                    }
                    else
                    {
                        std::cout << "[Calib] Drone REJECTED preflight calib"
                                  << " result=" << (int)ack.result << "\n";
                        stopRetryWatcher();
                        cancelStepTimeout();
                        accelState = AccelCalibState::FAILED;
                        sendCalibJSON("calibration_result", "failed",
                                      "Drone rejected calibration command. "
                                      "Make sure the vehicle is disarmed and on the ground.");
                    }
                }
                else if (accelState == AccelCalibState::IDLE)
                {
                    // Handle level calibration ACK (cmd=241, param5=2)
                    if (ack.result == MAV_RESULT_ACCEPTED)
                    {
                        std::cout << "[LevelCalib] Level calibration succeeded\n";
                        if (send_cb_)
                        {
                            json r;
                            r["type"]    = "calibration_result";
                            r["sensor"]  = "level";
                            r["step"]    = "done";
                            r["message"] = "Level calibration complete!";
                            send_cb_(r.dump());
                        }
                    }
                    else
                    {
                        std::cout << "[LevelCalib] Level calibration failed: result=" << (int)ack.result << "\n";
                        if (send_cb_)
                        {
                            json r;
                            r["type"]    = "calibration_result";
                            r["sensor"]  = "level";
                            r["step"]    = "failed";
                            r["message"] = "Level calibration failed. Drone rejected command.";
                            send_cb_(r.dump());
                        }
                    }
                }
            }

            if (ack.command == MAV_CMD_ACCELCAL_VEHICLE_POS &&
                accelState  == AccelCalibState::IN_PROGRESS &&
                ack.result  != MAV_RESULT_ACCEPTED)
            {
                handlePreflightCalibAck(ack);
            }
            break;
        }

        // ── STATUSTEXT (drone → GCS) ──────────────────────────────────────────
        case MAVLINK_MSG_ID_STATUSTEXT:
        {
            mavlink_statustext_t st;
            mavlink_msg_statustext_decode(&msg, &st);
            std::string text(st.text, strnlen(st.text, sizeof(st.text)));

            if (accelState == AccelCalibState::IN_PROGRESS)
            {
                std::cout << "[Calib][RX] STATUSTEXT: " << text << "\n";

                if (pendingPosition == 0)
                {
                    int pos = 0;
                    if      (text.find("level")      != std::string::npos) pos = ACCELCAL_POS_LEVEL;
                    else if (text.find("LEFT")        != std::string::npos) pos = ACCELCAL_POS_LEFT;
                    else if (text.find("RIGHT")       != std::string::npos) pos = ACCELCAL_POS_RIGHT;
                    else if (text.find("NOSE DOWN")   != std::string::npos) pos = ACCELCAL_POS_NOSEDOWN;
                    else if (text.find("NOSE UP")     != std::string::npos) pos = ACCELCAL_POS_NOSEUP;
                    else if (text.find("UPSIDE DOWN") != std::string::npos) pos = ACCELCAL_POS_BACK;
                    else if (text.find("Calibration successful") != std::string::npos)
                    {
                        stopRetryWatcher();
                        cancelStepTimeout();
                        accelState      = AccelCalibState::DONE;
                        pendingPosition = 0;
                        std::cout << "[Calib] STATUSTEXT success\n";
                        sendCalibJSON("calibration_result", "done",
                                      "Accelerometer calibration complete!",
                                      stepIndex_, TOTAL_STEPS);
                        break;
                    }
                    else if (text.find("Calibration FAILED") != std::string::npos ||
                             text.find("calibration failed")  != std::string::npos)
                    {
                        stopRetryWatcher();
                        cancelStepTimeout();
                        accelState      = AccelCalibState::FAILED;
                        pendingPosition = 0;
                        std::cout << "[Calib] STATUSTEXT failed\n";
                        sendCalibJSON("calibration_result", "failed",
                                      "Accelerometer calibration failed. Please try again.",
                                      stepIndex_, TOTAL_STEPS);
                        break;
                    }

                    if (pos != 0)
                    {
                        stopRetryWatcher();
                        std::cout << "[Calib] STATUSTEXT fallback → position "
                                  << accelPosToStep(pos) << "\n";
                        mavlink_command_long_t fake{};
                        fake.param1 = static_cast<float>(pos);
                        handleAccelVehiclePos(fake);
                    }
                }
            }
            break;
        }

        default:
            break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEND CALIB JSON
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::sendCalibJSON(const std::string& type,
                                     const std::string& step,
                                     const std::string& message,
                                     int step_index,
                                     int total_steps)
{
    if (!send_cb_) return;

    json j;
    j["type"]    = type;
    j["sensor"]  = "accelerometer";
    j["step"]    = step;
    j["message"] = message;

    if (step_index > 0)
    {
        j["step_index"]  = step_index;
        j["total_steps"] = total_steps;
    }

    send_cb_(j.dump());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  POSITION MAPS
// ═══════════════════════════════════════════════════════════════════════════════

std::string AccelCalibration::accelPosToStep(int pos)
{
    switch (pos)
    {
        case ACCELCAL_POS_LEVEL:    return "level";
        case ACCELCAL_POS_LEFT:     return "left";
        case ACCELCAL_POS_RIGHT:    return "right";
        case ACCELCAL_POS_NOSEDOWN: return "nose_down";
        case ACCELCAL_POS_NOSEUP:   return "nose_up";
        case ACCELCAL_POS_BACK:     return "upside_down";
        default:                    return "unknown";
    }
}

std::string AccelCalibration::accelPosToMessage(int pos)
{
    switch (pos)
    {
        case ACCELCAL_POS_LEVEL:    return "Place drone LEVEL and click Next";
        case ACCELCAL_POS_LEFT:     return "Place drone on LEFT side and click Next";
        case ACCELCAL_POS_RIGHT:    return "Place drone on RIGHT side and click Next";
        case ACCELCAL_POS_NOSEDOWN: return "Point drone NOSE DOWN and click Next";
        case ACCELCAL_POS_NOSEUP:   return "Point drone NOSE UP and click Next";
        case ACCELCAL_POS_BACK:     return "Flip drone UPSIDE DOWN and click Next";
        default:                    return "Unknown position — check drone";
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAVLINK MESSAGE NAME
// ═══════════════════════════════════════════════════════════════════════════════

std::string AccelCalibration::mavlinkMsgName(uint32_t msgid)
{
    switch (msgid)
    {
        case MAVLINK_MSG_ID_HEARTBEAT:           return "HEARTBEAT";
        case MAVLINK_MSG_ID_SYS_STATUS:          return "SYS_STATUS";
        case MAVLINK_MSG_ID_ATTITUDE:            return "ATTITUDE";
        case MAVLINK_MSG_ID_COMMAND_LONG:        return "COMMAND_LONG";
        case MAVLINK_MSG_ID_COMMAND_ACK:         return "COMMAND_ACK";
        case MAVLINK_MSG_ID_STATUSTEXT:          return "STATUSTEXT";
        case MAVLINK_MSG_ID_PARAM_VALUE:         return "PARAM_VALUE";
        case MAVLINK_MSG_ID_GPS_RAW_INT:         return "GPS_RAW_INT";
        case MAVLINK_MSG_ID_VFR_HUD:             return "VFR_HUD";
        case MAVLINK_MSG_ID_GLOBAL_POSITION_INT: return "GLOBAL_POSITION_INT";
        case MAVLINK_MSG_ID_RC_CHANNELS_RAW:     return "RC_CHANNELS_RAW";
        case MAVLINK_MSG_ID_SERVO_OUTPUT_RAW:    return "SERVO_OUTPUT_RAW";
        case MAVLINK_MSG_ID_RAW_IMU:             return "RAW_IMU";
        case MAVLINK_MSG_ID_SCALED_IMU2:         return "SCALED_IMU2";
        case MAVLINK_MSG_ID_POWER_STATUS:        return "POWER_STATUS";
        case MAVLINK_MSG_ID_BATTERY_STATUS:      return "BATTERY_STATUS";
        case MAVLINK_MSG_ID_AUTOPILOT_VERSION:   return "AUTOPILOT_VERSION";
        case MAVLINK_MSG_ID_EXTENDED_SYS_STATE:  return "EXTENDED_SYS_STATE";
        case MAVLINK_MSG_ID_HOME_POSITION:       return "HOME_POSITION";
        default:
            return "MSG#" + std::to_string(msgid);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ATTITUDE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

bool AccelCalibration::validateCurrentAttitude(int pos) const
{
    const float T       = ATTITUDE_TOLERANCE_RAD;
    const float HALF_PI = static_cast<float>(M_PI) / 2.0f;
    const float PI      = static_cast<float>(M_PI);

    switch (pos)
    {
        case ACCELCAL_POS_LEVEL:
            return (std::fabs(roll_) < T) && (std::fabs(pitch_) < T);
        case ACCELCAL_POS_LEFT:
            return std::fabs(roll_ - (-HALF_PI)) < T;
        case ACCELCAL_POS_RIGHT:
            return std::fabs(roll_ - HALF_PI) < T;
        case ACCELCAL_POS_NOSEDOWN:
            return std::fabs(pitch_ - (-HALF_PI)) < T;
        case ACCELCAL_POS_NOSEUP:
            return std::fabs(pitch_ - HALF_PI) < T;
        case ACCELCAL_POS_BACK:
            return std::fabs(std::fabs(roll_) - PI) < T;
        default:
            return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEND MAV_CMD_PREFLIGHT_CALIBRATION  (raw — no state change)
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::sendPreflightCalibCommand()
{
    mavlink_message_t msg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_PREFLIGHT_CALIBRATION;
    cmd.confirmation     = 0;
    cmd.param1           = 0;
    cmd.param2           = 0;
    cmd.param3           = 0;
    cmd.param4           = 0;
    cmd.param5           = 1;   // accelerometer calibrate
    cmd.param6           = 0;
    cmd.param7           = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);

    if (transport_cb_)
        transport_cb_(msg);
    else
        std::cout << "[AccelCalibration] WARNING: no transport callback!\n";

    calibStartSentAt_ = std::chrono::steady_clock::now();

    std::cout << "[Calib] MAV_CMD_PREFLIGHT_CALIBRATION sent"
              << " → sysid=" << sysid_
              << " compid=" << compid_ << "\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RETRY WATCHER
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::startRetryWatcher()
{
    std::lock_guard<std::mutex> lk(retryMtx_);
    if (retryThread_.joinable())
    {
        retryActive_ = false;
        retryThread_.join();
    }
    retryActive_       = true;
    calibStartRetries_ = 0;

    retryThread_ = std::thread([this]()
    {
        while (retryActive_ && accelState == AccelCalibState::IN_PROGRESS)
        {
            std::this_thread::sleep_for(std::chrono::seconds(1));

            if (!retryActive_) break;
            if (accelState != AccelCalibState::IN_PROGRESS) break;

            auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now() - calibStartSentAt_).count();

            if (elapsed >= CALIB_START_TIMEOUT_S)
            {
                if (calibStartRetries_ >= CALIB_MAX_RETRIES)
                {
                    std::cout << "[Calib] No response after "
                              << CALIB_MAX_RETRIES << " retries — giving up\n";
                    accelState = AccelCalibState::FAILED;
                    sendCalibJSON("calibration_result", "failed",
                                  "No response from drone. "
                                  "Check connection and that the vehicle is disarmed.");
                    retryActive_ = false;
                    break;
                }

                calibStartRetries_++;
                std::cout << "[Calib] No response — retry "
                          << calibStartRetries_ << "/" << CALIB_MAX_RETRIES << "\n";

                sendCalibJSON("calibration_status", "started",
                              "No response from drone — retrying ("
                              + std::to_string(calibStartRetries_)
                              + "/" + std::to_string(CALIB_MAX_RETRIES) + ")...");

                sendPreflightCalibCommand();
            }
        }
    });
}

void AccelCalibration::stopRetryWatcher()
{
    std::lock_guard<std::mutex> lk(retryMtx_);
    retryActive_ = false;
    if (retryThread_.joinable())
        retryThread_.join();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PER-STEP TIMEOUT — ONE LONG-LIVED THREAD, NO HOT-PATH JOINS
//
//  Root cause of the step-5 race condition in the old code:
//
//    handleAccelVehiclePos() (MAVLink thread) called stopStepTimeout()
//    which did thread::join().  That blocked the MAVLink thread until the
//    previous timeout thread finished its 1-second sleep tick.
//
//    Meanwhile confirmAccelPosition() (WebSocket thread) ran, saw
//    pendingPosition == 0 (handleAccelVehiclePos hadn't reached
//    "pendingPosition = pos" yet), and stored a pre-confirm.  Every
//    subsequent click re-stored the same pre-confirm because by the time
//    handleAccelVehiclePos() finally set pendingPosition the pre-confirm
//    path was already in an infinite loop.
//
//  Fix: replace per-step thread create/destroy with ONE persistent thread
//  that sleeps on a condition variable.  startStepTimeout() arms the
//  deadline and wakes it; cancelStepTimeout() disarms it — both return
//  instantly with zero blocking.  The join only happens in the destructor.
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::launchStepTimeoutThread()
{
    stepTimeoutActive_ = true;
    stepTimeoutArmed_  = false;

    stepTimeoutThread_ = std::thread([this]()
    {
        while (true)
        {
            // ── Wait until armed or destroyed ────────────────────────────────
            {
                std::unique_lock<std::mutex> lk(stepTimeoutMtx_);
                stepTimeoutCv_.wait(lk, [this]{
                    return stepTimeoutArmed_.load() || !stepTimeoutActive_.load();
                });
            }

            if (!stepTimeoutActive_) break;

            // ── Sleep until deadline, or until disarmed / destroyed ──────────
            {
                std::unique_lock<std::mutex> lk(stepTimeoutMtx_);
                auto deadline = stepDeadline_;
                stepTimeoutCv_.wait_until(lk, deadline, [this]{
                    return !stepTimeoutArmed_.load() || !stepTimeoutActive_.load();
                });
            }

            if (!stepTimeoutActive_) break;

            // Woke early because disarmed — loop back to wait.
            if (!stepTimeoutArmed_) continue;

            // Deadline truly elapsed — fire the timeout.
            if (accelState != AccelCalibState::IN_PROGRESS)
            {
                stepTimeoutArmed_ = false;
                continue;
            }

            int pos = pendingPosition;
            std::cout << "[Calib] Step timeout — user did not respond within "
                      << STEP_TIMEOUT_S << "s for position "
                      << accelPosToStep(pos) << "\n";

            if (send_cb_)
            {
                json j;
                j["type"]    = "calibration_timeout";
                j["sensor"]  = "accelerometer";
                j["step"]    = accelPosToStep(pos);
                j["message"] = "No response for "
                               + std::to_string(STEP_TIMEOUT_S)
                               + "s — hold the drone in the requested position "
                                 "and click Next, or click Reset to restart.";
                if (stepIndex_ > 0)
                {
                    j["step_index"]  = stepIndex_;
                    j["total_steps"] = TOTAL_STEPS;
                }
                send_cb_(j.dump());
            }

            // Disarm after firing once per step.
            stepTimeoutArmed_ = false;
        }
    });
}

// Arms the watchdog for the current step. Returns immediately (non-blocking).
void AccelCalibration::startStepTimeout()
{
    {
        std::lock_guard<std::mutex> lk(stepTimeoutMtx_);
        stepDeadline_     = std::chrono::steady_clock::now()
                            + std::chrono::seconds(STEP_TIMEOUT_S);
        stepTimeoutArmed_ = true;
    }
    stepTimeoutCv_.notify_all();
}

// Disarms the watchdog. Returns immediately (non-blocking).
void AccelCalibration::cancelStepTimeout()
{
    {
        std::lock_guard<std::mutex> lk(stepTimeoutMtx_);
        stepTimeoutArmed_ = false;
    }
    stepTimeoutCv_.notify_all();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START ACCEL CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::startAccelCalibration()
{
    if (accelState == AccelCalibState::IN_PROGRESS)
    {
        std::cout << "[Calib] Already in progress\n";
        return;
    }

    if (armed_)
    {
        std::cout << "[Calib] Rejected: vehicle is armed\n";
        sendCalibJSON("calibration_result", "failed",
                      "Vehicle must be DISARMED before accelerometer calibration. "
                      "Disarm the vehicle and try again.");
        return;
    }

    accelState       = AccelCalibState::IN_PROGRESS;
    pendingPosition  = 0;
    stepIndex_       = 0;
    preConfirmedPos_ = 0;

    // Cancel any stale calibration state on the drone.
    {
        cancelPending_ = true;
        mavlink_message_t cancelMsg;
        mavlink_command_long_t cancel{};
        cancel.target_system    = static_cast<uint8_t>(sysid_);
        cancel.target_component = static_cast<uint8_t>(compid_);
        cancel.command          = MAV_CMD_PREFLIGHT_CALIBRATION;
        cancel.confirmation     = 0;
        cancel.param1 = cancel.param2 = cancel.param3 = cancel.param4 = 0;
        cancel.param5 = 0;
        cancel.param6 = cancel.param7 = 0;
        mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &cancelMsg, &cancel);
        if (transport_cb_) transport_cb_(cancelMsg);
        std::cout << "[Calib] Cancel sent to reset any stale drone state\n";
        std::this_thread::sleep_for(std::chrono::milliseconds(400));
        cancelPending_ = false;
    }

    sendPreflightCalibCommand();

    sendCalibJSON("calibration_status", "started",
                  "Calibration command sent — waiting for drone...");

    startRetryWatcher();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START LEVEL CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::startLevelCalibration()
{
    if (armed_)
    {
        std::cout << "[LevelCalib] Rejected: vehicle is armed\n";
        if (send_cb_)
        {
            json j;
            j["type"]    = "calibration_result";
            j["sensor"]  = "level";
            j["step"]    = "failed";
            j["message"] = "Vehicle must be DISARMED before level calibration. "
                           "Disarm the vehicle and try again.";
            send_cb_(j.dump());
        }
        return;
    }

    std::cout << "[LevelCalib] Sending MAV_CMD_PREFLIGHT_CALIBRATION param5=2\n";

    mavlink_message_t msg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_PREFLIGHT_CALIBRATION;
    cmd.confirmation     = 0;
    cmd.param1           = 0;
    cmd.param2           = 0;
    cmd.param3           = 0;   
    cmd.param4           = 0;
    cmd.param5           = 2;   // 2 = board level calibration
    cmd.param6           = 0;
    cmd.param7           = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);

    if (transport_cb_)
        transport_cb_(msg);
    else
        std::cout << "[AccelCalibration] WARNING: no transport callback!\n";

    if (send_cb_)
    {
        json j;
        j["type"]    = "calibration_status";
        j["sensor"]  = "level";
        j["step"]    = "started";
        j["message"] = "Level calibration command sent — place drone on a flat "
                       "surface and wait...";
        send_cb_(j.dump());
    }

    std::cout << "[LevelCalib] Command sent → sysid=" << sysid_
              << " compid=" << compid_ << "\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HANDLE ACCELCAL VEHICLE POS  (COMMAND_LONG from drone)
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::handleAccelVehiclePos(const mavlink_command_long_t& cmd)
{
    int pos = static_cast<int>(std::round(cmd.param1));

    bool isSuccess = (pos == ACCELCAL_POS_SUCCESS  || pos == 16777215);
    bool isFailed  = (pos == ACCELCAL_POS_FAILED   || pos == 16777216
                      || (pos > 6 && pos != pendingPosition));

    if (isSuccess)
    {
        cancelStepTimeout();
        accelState      = AccelCalibState::DONE;
        pendingPosition = 0;
        std::cout << "[Calib] ACCELCAL_POS_SUCCESS (pos=" << pos << ")\n";
        sendCalibJSON("calibration_result", "done",
                      "Accelerometer calibration complete!",
                      stepIndex_, TOTAL_STEPS);
        return;
    }

    if (isFailed)
    {
        cancelStepTimeout();
        accelState      = AccelCalibState::FAILED;
        pendingPosition = 0;
        std::cout << "[Calib] ACCELCAL_POS_FAILED (pos=" << pos << ")\n";
        sendCalibJSON("calibration_result", "failed",
                      "Accelerometer calibration failed. Please try again.",
                      stepIndex_, TOTAL_STEPS);
        return;
    }

    if (pos == pendingPosition)
    {
        std::cout << "[Calib] Drone retry for position "
                  << accelPosToStep(pos) << " (already pending) — ignoring\n";
        return;
    }

    // ── New position ──────────────────────────────────────────────────────────
    // CRITICAL: set pendingPosition BEFORE sendCalibJSON / startStepTimeout so
    // confirmAccelPosition() on the WebSocket thread always sees a valid value.
    stepIndex_      = pos;
    pendingPosition = pos;

    std::string step = accelPosToStep(pos);
    std::string msg  = accelPosToMessage(pos);

    std::cout << "[Calib] Drone requests position: " << step
              << " (pos=" << pos << ", step=" << stepIndex_ << "/" << TOTAL_STEPS << ")"
              << "  roll=" << roll_ << " rad"
              << "  pitch=" << pitch_ << " rad\n";

    // Consume any pre-confirm (user clicked Next before COMMAND_LONG arrived).
    if (preConfirmedPos_ > 0 &&
        (preConfirmedPos_ == pos || preConfirmedPos_ + 1 == pos))
    {
        preConfirmedPos_ = 0;
        std::cout << "[Calib] Pre-confirm consumed — auto-ACKing pos=" << pos << "\n";
        sendCalibJSON("calibration_step", step, msg, stepIndex_, TOTAL_STEPS);
        confirmAccelPosition();
        return;
    }
    preConfirmedPos_ = 0;

    // Notify frontend — enables the "Next" button.
    sendCalibJSON("calibration_step", step, msg, stepIndex_, TOTAL_STEPS);

    // Arm per-step timeout — non-blocking, no join.
    startStepTimeout();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIRM ACCEL POSITION  (user clicks "Next")
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::confirmAccelPosition()
{
    if (accelState != AccelCalibState::IN_PROGRESS)
    {
        std::cout << "[Calib] confirmAccelPosition: not IN_PROGRESS\n";
        return;
    }

    if (pendingPosition == 0)
    {
        int candidate = stepIndex_;
        std::cout << "[Calib] confirmAccelPosition: no pending yet — storing pre-confirm"
                  << " stepIndex_=" << stepIndex_
                  << " candidates=" << candidate << " and " << (candidate+1) << "\n";
        preConfirmedPos_ = candidate;
        return;
    }

    // Advisory attitude check.
    bool hasLiveAttitude = (roll_ != 0.0f || pitch_ != 0.0f);
    if (hasLiveAttitude && !validateCurrentAttitude(pendingPosition))
    {
        std::string correctDir = accelPosToMessage(pendingPosition);
        std::string warnMsg    = "⚠️ Wrong orientation! " + correctDir
                                 + " — please re-orient the drone correctly before clicking Next.";

        std::cout << "[Calib] Attitude mismatch for pos="
                  << accelPosToStep(pendingPosition)
                  << " roll=" << roll_ << " pitch=" << pitch_
                  << " — sending orientation warning\n";

        if (send_cb_)
        {
            json w;
            w["type"]        = "calibration_wrong_orientation";
            w["sensor"]      = "accelerometer";
            w["step"]        = accelPosToStep(pendingPosition);
            w["message"]     = warnMsg;
            w["correct_msg"] = correctDir;
            if (stepIndex_ > 0)
            {
                w["step_index"]  = stepIndex_;
                w["total_steps"] = TOTAL_STEPS;
            }
            send_cb_(w.dump());
        }
    }

    std::cout << "[Calib] User confirmed position: " << accelPosToStep(pendingPosition)
              << " — sending COMMAND_LONG MAV_CMD_ACCELCAL_VEHICLE_POS pos="
              << pendingPosition << " to drone\n";

    mavlink_message_t msg;
    mavlink_command_long_t cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_ACCELCAL_VEHICLE_POS;
    cmd.confirmation     = 0;
    cmd.param1           = static_cast<float>(pendingPosition);
    cmd.param2 = cmd.param3 = cmd.param4 = cmd.param5 = cmd.param6 = cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);

    if (transport_cb_)
        transport_cb_(msg);
    else
        std::cout << "[AccelCalibration] WARNING: no transport callback!\n";

    cancelStepTimeout();   // non-blocking
    pendingPosition = 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HANDLE PREFLIGHT CALIB ACK
// ═══════════════════════════════════════════════════════════════════════════════

void AccelCalibration::handlePreflightCalibAck(const mavlink_command_ack_t& ack)
{
    if (ack.result == MAV_RESULT_ACCEPTED)
    {
        std::cout << "[Calib] MAV_RESULT_ACCEPTED — calibration finished OK\n";
        cancelStepTimeout();
        accelState = AccelCalibState::DONE;
        sendCalibJSON("calibration_result", "done",
                      "Accelerometer calibration complete!",
                      stepIndex_, TOTAL_STEPS);
    }
    else
    {
        std::cout << "[Calib] MAV_RESULT_FAILED result="
                  << static_cast<int>(ack.result) << "\n";
        cancelStepTimeout();
        accelState = AccelCalibState::FAILED;
        sendCalibJSON("calibration_result", "failed",
                      "Calibration failed — please retry.",
                      stepIndex_, TOTAL_STEPS);
    }
}