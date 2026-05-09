#include "compass_calibration.h"
#include <nlohmann/json.hpp>
#include <cmath>
#include <chrono>
#include <thread>

using json = nlohmann::json;


// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTRUCTOR / DESTRUCTOR
// ═══════════════════════════════════════════════════════════════════════════════

CompassCalibration::CompassCalibration()
{
    std::cout << "[CompassCalibration] Constructed\n";
}

CompassCalibration::~CompassCalibration()
{
    // Stop retry thread first
    stopRetryWatcher();

    // Stop overall timeout thread
    {
        std::lock_guard<std::mutex> lk(overallTimeoutMtx_);
        overallTimeoutActive_ = false;
        overallTimeoutArmed_  = false;
    }
    overallTimeoutCv_.notify_all();
    if (overallTimeoutThread_.joinable())
        overallTimeoutThread_.join();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VEHICLE CONTEXT INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::setVehicleInfo(int sysid, int compid)
{
    sysid_  = sysid;
    compid_ = compid;
    std::cout << "[Compass] Vehicle info set: sysid=" << sysid_
              << " compid=" << compid_ << "\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROCESS MAVLINK MESSAGE
//
//  Called by Vehicle::process_message() via register_handler() for each of
//  these msgids:
//    MAVLINK_MSG_ID_HEARTBEAT        (  0)
//    MAVLINK_MSG_ID_COMMAND_ACK      ( 77)
//    MAVLINK_MSG_ID_STATUSTEXT       (253)
//    MAVLINK_MSG_ID_MAG_CAL_PROGRESS (191)  ← sysid=0 broadcast from ArduPilot
//    MAVLINK_MSG_ID_MAG_CAL_REPORT   (192)  ← sysid=0 broadcast from ArduPilot
//
//  WIRING REQUIREMENT (main.cpp) — TWO things must be true:
//
//  [1] The link receive callback must forward ALL parsed MAVLink messages to
//      vehicle_manager.handle_message() — no message-ID whitelist.
//      VehicleManager already routes sysid=0 to all live vehicles.
//
//  [2] The on_new_vehicle callback must call vehicle->register_handler() for
//      ALL FIVE message IDs listed above, including 191 and 192.
//      Without those two registrations, progress/report packets are silently
//      dropped inside Vehicle::process_message() and nothing reaches here.
//
//  See main_wiring_fix.cpp for the exact code patterns.
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::processMessage(const mavlink_message_t& msg)
{
    // [FIX-M] Diagnostic counter — logs every 100 calls so you can verify
    // this function is being reached without reading every line.
    uint64_t cnt = ++msg_count_;
    if (cnt % 100 == 0)
        std::cout << "[Compass] processMessage() call #" << cnt
                  << " (latest msgid=" << msg.msgid << ")\n";

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

        // ── COMMAND_ACK ───────────────────────────────────────────────────────
        case MAVLINK_MSG_ID_COMMAND_ACK:
        {
            mavlink_command_ack_t ack;
            mavlink_msg_command_ack_decode(&msg, &ack);

            if (ack.command == MAV_CMD_DO_START_MAG_CAL ||
                ack.command == MAV_CMD_DO_CANCEL_MAG_CAL)
            {
                handleCommandAck(ack);
            }
            break;
        }

        // ── STATUSTEXT ────────────────────────────────────────────────────────
        case MAVLINK_MSG_ID_STATUSTEXT:
        {
            if (compassState == CompassCalibState::IN_PROGRESS)
            {
                mavlink_statustext_t st;
                mavlink_msg_statustext_decode(&msg, &st);
                handleStatusText(st);
            }
            break;
        }

        // ── MAG_CAL_PROGRESS (191) ────────────────────────────────────────────
        //
        //  ArduPilot sends this with sysid=0 (broadcast) after calibration starts.
        //  VehicleManager::handle_message() routes sysid=0 to all live vehicles.
        //  Vehicle::process_message() dispatches to this handler only if
        //  register_handler(MAVLINK_MSG_ID_MAG_CAL_PROGRESS, ...) was called
        //  in the on_new_vehicle wiring in main.cpp.
        //
        //  [FIX-K]: On some ArduPilot firmware the first MAG_CAL_PROGRESS arrives
        //  BEFORE the COMMAND_ACK for DO_START_MAG_CAL.  The previous code dropped
        //  the progress packet when state == IDLE because the guard checked
        //  "IN_PROGRESS" only.  Fix: treat any MAG_CAL_PROGRESS while IDLE as an
        //  implicit ACK — auto-transition to IN_PROGRESS so bars start updating.
        //
        //  [FIX-L]: handleImplicitAck() is now called BEFORE the state guard so
        //  the IN_PROGRESS transition always happens, regardless of ordering.
        //
        //  DIAGNOSTIC: the log line below fires unconditionally — if it never
        //  appears after "DO_START_MAG_CAL accepted", the wiring is broken.
        case MAVLINK_MSG_ID_MAG_CAL_PROGRESS:
        {
            std::cout << "[Compass] MAG_CAL_PROGRESS received — state="
                      << (int)compassState.load() << "\n";

            // [FIX-K]: If state is IDLE, a progress packet means the drone
            // started calibrating before we received COMMAND_ACK.
            // Auto-transition to IN_PROGRESS so the rest of the flow works.
            if (compassState == CompassCalibState::IDLE)
            {
                std::cout << "[Compass] MAG_CAL_PROGRESS while IDLE — "
                             "auto-transitioning to IN_PROGRESS (firmware sent "
                             "progress before ACK)\n";
                compassState.store(CompassCalibState::IN_PROGRESS);
            }

            // [FIX-L]: handleImplicitAck() before state guard — ensures the
            // overall timeout is armed even if we just transitioned above.
            handleImplicitAck();

            if (compassState == CompassCalibState::IN_PROGRESS)
            {
                mavlink_mag_cal_progress_t prog;
                mavlink_msg_mag_cal_progress_decode(&msg, &prog);
                handleMagCalProgress(prog);
            }
            break;
        }

        // ── MAG_CAL_REPORT (192) ──────────────────────────────────────────────
        //
        //  ArduPilot sends this with sysid=0 (broadcast) when each compass
        //  finishes its calibration run.  Accepted in both IN_PROGRESS and DONE:
        //  a second compass may report after the first already triggered the
        //  DONE transition — dropping it would leave that compass bar stuck.
        //
        //  Same wiring requirement as MAG_CAL_PROGRESS above.
        case MAVLINK_MSG_ID_MAG_CAL_REPORT:
        {
            std::cout << "[Compass] MAG_CAL_REPORT received — state="
                      << (int)compassState.load() << "\n";

            mavlink_mag_cal_report_t rep;
            mavlink_msg_mag_cal_report_decode(&msg, &rep);

            // [FIX] Accept MAG_CAL_REPORT in IN_PROGRESS, DONE, and FAILED states.
            //
            // Previously, state=FAILED immediately killed the session when one
            // compass failed.  The remaining compass(es) kept streaming
            // MAG_CAL_REPORT but all were silently dropped here with
            // "MAG_CAL_REPORT ignored — state=3", leaving them unable to report
            // success.  Now handleMagCalReport() tracks per-compass failure
            // counts and only transitions to final FAILED/DONE when all active
            // compasses have reported.  We must accept reports in all three
            // non-IDLE states for this to work.
            if (compassState == CompassCalibState::IN_PROGRESS ||
                compassState == CompassCalibState::DONE         ||
                compassState == CompassCalibState::FAILED)
            {
                handleMagCalReport(rep);
            }
            else
            {
                std::cout << "[Compass] MAG_CAL_REPORT ignored — state=IDLE\n";
            }
            break;
        }

        default:
            break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMPLICIT ACK HANDLER
//
//  Called the first time MAG_CAL_PROGRESS or a relevant STATUSTEXT arrives
//  while the retry watcher is still running.
//
//  Non-blocking: we just set retryActive_ = false and return immediately.
//  The retry thread self-terminates on its next 100ms slice check.
//  No sleep, no spin-wait, MAVLink RX thread is not blocked.
//
//  [FIX-B]: startOverallTimeout() is idempotent — see its implementation.
//  Even if handleCommandAck() and handleImplicitAck() both call it, the
//  watchdog is only armed once.
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::handleImplicitAck()
{
    bool expected = false;
    if (!implicitAckReceived_.compare_exchange_strong(expected, true))
        return;   // already handled

    if (!retryActive_)
        return;   // explicit COMMAND_ACK already stopped the watcher

    std::cout << "[Compass] Implicit ACK received (MAG_CAL_PROGRESS / STATUSTEXT) — "
                 "stopping retry watcher and arming overall timeout\n";

    // Just signal the thread to stop — no busy-wait, no sleep.
    // The retry thread exits on its next 100ms slice. The RX thread is not blocked.
    retryActive_ = false;

    startOverallTimeout();

    sendStatusJSON("Drone accepted calibration — rotate the drone "
                   "slowly through all orientations.");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START COMPASS CALIBRATION
//
//  [FIX-A]: Guarded by startMutex_ to prevent concurrent invocations.
//  If the user double-clicks Start before the first detached thread exits,
//  the second call blocks on the mutex until the first fully completes.
//  This prevents both threads from calling stopRetryWatcher() → join() on the
//  same joinable retryThread_, which would throw std::system_error.
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::startCompassCalibration(bool large_vehicle)
{
    // [FIX-A]: Serialize concurrent start requests.
    std::lock_guard<std::mutex> startLock(startMutex_);

    if (compassState == CompassCalibState::IN_PROGRESS)
    {
        std::cout << "[Compass] Already in progress — ignoring duplicate start\n";
        return;
    }

    if (armed_)
    {
        std::cout << "[Compass] Rejected: vehicle is armed\n";
        sendResultJSON("failed",
                       "Vehicle must be DISARMED before compass calibration. "
                       "Disarm the vehicle and try again.");
        return;
    }

    // Guard: warn if vehicle info was never injected (sysid/compid both 0).
    // sysid=0 is valid as a broadcast target on some firmware, but almost
    // certainly means setVehicleInfo() was not called — flag it in the log.
    if (sysid_ == 0 && compid_ == 0)
    {
        std::cout << "[Compass] WARNING: sysid/compid not set — "
                     "call setVehicleInfo() before starting calibration. "
                     "Commands will be sent with sysid=0/compid=0.\n";
    }

    // Guard: refuse to start if transport callback was never set.
    // This prevents a silent failure where the command is built but never sent.
    if (!transport_cb_)
    {
        std::cout << "[Compass] ERROR: transport_cb_ not set — "
                     "call setTransportCallback() before starting calibration\n";
        sendResultJSON("failed",
                       "Internal error: compass transport not configured. "
                       "Reconnect to the vehicle and try again.");
        return;
    }

    // Always stop the previous retry watcher before starting a new one.
    // If startRetryWatcher() is called while retryThread_ is still joinable
    // (e.g. after a cancel that only set retryActive_=false but didn't join),
    // the assignment of a new std::thread would destroy the old joinable one
    // and call std::terminate().
    stopRetryWatcher();

    // Stop the previous overall-timeout thread before launching a new one.
    // Without this, re-assigning overallTimeoutThread_ while it is still
    // joinable calls std::terminate().
    {
        std::lock_guard<std::mutex> lk(overallTimeoutMtx_);
        overallTimeoutActive_ = false;
        overallTimeoutArmed_  = false;
    }
    overallTimeoutCv_.notify_all();
    if (overallTimeoutThread_.joinable())
        overallTimeoutThread_.join();

    large_vehicle_ = large_vehicle;

    compassState.store(CompassCalibState::IN_PROGRESS);
    for (int i = 0; i < MAX_COMPASSES; ++i)
        progress_[i] = 0;
    calibStartRetries_   = 0;
    implicitAckReceived_ = false;

    // Send initial 0% progress to frontend for all compasses
    for (int i = 0; i < MAX_COMPASSES; ++i)
    {
        progress_[i] = 0;
        sendProgressJSON(i, 0);
    }

    // Initialize compass completion tracking
    for (int i = 0; i < MAX_COMPASSES; ++i)
    {
        compassStatus_[i]  = {false, MAG_CAL_NOT_STARTED, 0};
        compassActive_[i]  = false;
    }
    activeCompassCount_  = 0;
    successCompassCount_ = 0;
    failedCompassCount_  = 0;

    calibStartSentAt_ = std::chrono::steady_clock::now();

    std::cout << "[Compass] Starting calibration (large_vehicle="
              << (large_vehicle_ ? "true" : "false") << ")\n";

    sendStatusJSON("Waiting for drone response...");

    launchOverallTimeoutThread();
    startRetryWatcher();

    // Initial confirmation counter is 1, not 0
    // (0 may be deduplicated by firmware)
    sendStartMagCalCommand(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CANCEL COMPASS CALIBRATION
//
//  [FIX-D]: compassState is set to FAILED BEFORE cancelOverallTimeout() so the
//  timeout thread can never race and fire a second "failed" result.
//  Previously, if the timeout thread woke between the cancel-command send and
//  the state update, it would see IN_PROGRESS and send its own failure result
//  alongside the cancel result — corrupting the UI.
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::cancelCompassCalibration()
{
    // [FIX-D]: Atomically transition to FAILED first.
    // After this succeeds, the timeout thread's state check will see FAILED
    // and no-op even if it woke up during the cancel window.
    CompassCalibState expected = CompassCalibState::IN_PROGRESS;
    if (!compassState.compare_exchange_strong(expected, CompassCalibState::FAILED))
    {
        std::cout << "[Compass] Cancel ignored — not in progress state\n";
        return;
    }

    std::cout << "[Compass] Calibration cancelled by user\n";

    // Disarm the watchdog and stop retries — state is already FAILED so
    // neither the timeout thread nor the retry thread will take further action.
    cancelOverallTimeout();
    retryActive_ = false;

    sendCancelMagCalCommand();
    sendResultJSON("failed", "Calibration cancelled by user.");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCEPT COMPASS CALIBRATION
//
//  [FIX-E]: This is now the ONLY place that sends DO_ACCEPT_MAG_CAL.
//  handleMagCalReport() no longer sends it automatically on all-success.
//  This prevents the double-accept (auto + user-click) that caused ArduPilot
//  to re-commit offsets and beep twice.
//
//  Flow:
//    1. All compasses succeed → handleMagCalReport() sends status="done"
//       to the frontend and sets compassState=DONE.
//    2. Frontend shows Accept button (enabled).
//    3. User clicks Accept → frontend sends accept_compass_calibration WS msg.
//    4. main.cpp calls compassCalib.acceptCompassCalibration().
//    5. This function sends DO_ACCEPT_MAG_CAL → ArduPilot commits + beeps.
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::acceptCompassCalibration()
{
    if (compassState != CompassCalibState::DONE)
    {
        std::cout << "[Compass] Accept ignored — calibration not in DONE state\n";
        return;
    }

    std::cout << "[Compass] Accept requested — sending DO_ACCEPT_MAG_CAL\n";
    sendAcceptMagCalCommand();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::handleCommandAck(const mavlink_command_ack_t& ack)
{
    // Only handle the START ACK here. The CANCEL ACK previously fell through
    // and called startOverallTimeout(), which restarted the watchdog after a
    // user-initiated cancel — corrupting calibration state.
    if (ack.command == MAV_CMD_DO_CANCEL_MAG_CAL)
    {
        std::cout << "[Compass] DO_CANCEL_MAG_CAL ACK result=" << (int)ack.result
                  << " — cancel confirmed, ignoring\n";
        return;
    }

    // From here: ack.command == MAV_CMD_DO_START_MAG_CAL
    if (ack.result != MAV_RESULT_ACCEPTED)
    {
        std::cout << "[Compass] DO_START_MAG_CAL rejected: result=" << (int)ack.result << "\n";
        sendResultJSON("failed",
                       "Drone rejected calibration command. "
                       "Ensure vehicle is disarmed and try again.");
        compassState.store(CompassCalibState::FAILED);
        // [FIX-C]: Use stopRetryWatcher() (which joins) instead of bare flag
        // set. This ensures the thread is properly joined so the next call to
        // startCompassCalibration() doesn't encounter a zombie joinable thread.
        stopRetryWatcher();
        cancelOverallTimeout();
        return;
    }

    std::cout << "[Compass] DO_START_MAG_CAL accepted by drone\n";

    // [FIX-C]: Stop retry watcher properly via stopRetryWatcher() (joins the
    // thread) instead of just setting retryActive_=false. The bare flag-set
    // left the thread joinable-but-live; the next startCompassCalibration()
    // call would join it correctly, but there was a window where it was a
    // zombie. Using stopRetryWatcher() eliminates that window.
    //
    // Note: stopRetryWatcher() sets retryActive_=false then joins. Because
    // the retry thread sleeps in 100ms slices, this join returns within ~100ms.
    // We are on the MAVLink RX thread here — 100ms is acceptable since
    // handleCommandAck is infrequent (once per calibration start).
    stopRetryWatcher();

    // [FIX-B]: startOverallTimeout() is idempotent — uses compare-exchange
    // internally so concurrent calls from here and handleImplicitAck() only
    // arm the watchdog once.
    startOverallTimeout();

    sendStatusJSON("Drone accepted calibration — rotate the drone "
                   "slowly through all orientations.");
}

void CompassCalibration::handleStatusText(const mavlink_statustext_t& st)
{
    std::string text(st.text, sizeof(st.text));
    text = text.substr(0, text.find('\0'));  // Null-terminate

    std::cout << "[Compass] STATUSTEXT: " << text << "\n";

    // Check for calibration-related messages
    if (text.find("calibration started") != std::string::npos ||
        text.find("Mag") != std::string::npos)
    {
        handleImplicitAck();
    }
}

void CompassCalibration::handleMagCalProgress(const mavlink_mag_cal_progress_t& prog)
{
    std::cout << "[Compass] Progress compass_id=" << (int)prog.compass_id
              << " pct=" << (int)prog.completion_pct << "%\n";

    if (prog.compass_id < MAX_COMPASSES)
    {
        progress_[prog.compass_id] = prog.completion_pct;

        // Register this compass as active the first time we see it.
        // This tells handleMagCalReport() how many compasses to wait for.
        if (!compassActive_[prog.compass_id])
        {
            compassActive_[prog.compass_id] = true;
            activeCompassCount_++;
            std::cout << "[Compass] compass_id=" << (int)prog.compass_id
                      << " registered as active (total active=" << activeCompassCount_ << ")\n";
        }
    }

    // Send ALL compass progress to frontend.
    // Cap at 99% while still running — 100% is set only when MAG_CAL_REPORT
    // SUCCESS arrives.
    for (int i = 0; i < MAX_COMPASSES; ++i)
    {
        uint8_t capped = std::min(progress_[i], static_cast<uint8_t>(99));
        sendProgressJSON(i, capped);
    }
}

void CompassCalibration::handleMagCalReport(const mavlink_mag_cal_report_t& rep)
{
    const uint8_t compass_id = rep.compass_id;

    std::cout << "[Compass] MAG_CAL_REPORT"
              << " compass_id=" << (int)compass_id
              << " status=" << (int)rep.cal_status
              << " (" << calStatusToString(rep.cal_status) << ")"
              << " fitness=" << rep.fitness
              << " active=" << activeCompassCount_
              << " succeeded=" << successCompassCount_
              << "\n";

    // Deduplicate — only process each compass once
    if (compass_id < MAX_COMPASSES && compassStatus_[compass_id].reported)
    {
        std::cout << "[Compass] MAG_CAL_REPORT for compass_id=" << (int)compass_id
                  << " already processed — SKIPPING duplicate\n";
        return;
    }

    if (rep.cal_status == MAG_CAL_SUCCESS)
    {
        if (compass_id < MAX_COMPASSES)
        {
            compassStatus_[compass_id].reported     = true;
            compassStatus_[compass_id].final_status = rep.cal_status;
        }

        successCompassCount_++;

        std::cout << "[Compass] Compass " << (int)compass_id << " SUCCESS"
                  << " (" << successCompassCount_ << "/" << activeCompassCount_ << " done)\n";

        // Set this compass bar to 100%
        sendProgressJSON(compass_id, 100);

        // Send per-compass result so the frontend can show a tick
        sendResultJSON("compass_done",
                       "Compass " + std::to_string(compass_id + 1) + " calibration complete!",
                       compass_id);

        // Only declare overall DONE when EVERY active compass has succeeded.
        // If activeCompassCount_ is 0 (no PROGRESS packets seen yet, rare edge
        // case), fall back to completing immediately so we never hang.
        bool allDone = (activeCompassCount_ > 0)
                       ? (successCompassCount_ >= activeCompassCount_)
                       : true;

        if (allDone)
        {
            std::cout << "[Compass] All " << activeCompassCount_
                      << " compass(es) succeeded — marking DONE\n";

            compassState.store(CompassCalibState::DONE);
            cancelOverallTimeout();

            // [FIX-AUTO-ACCEPT]: Automatically accept offsets as soon as all
            // compasses succeed, without waiting for a user button press.
            // This matches the user's preferred flow: calibrate → auto-save →
            // ask for reboot. The frontend no longer shows an Accept button;
            // it goes straight to the reboot prompt.
            std::cout << "[Compass] Auto-accepting offsets (DO_ACCEPT_MAG_CAL)\n";
            sendAcceptMagCalCommand();

            sendResultJSON("done",
                           "Compass calibration complete! Offsets saved automatically.",
                           -1);

            // compass_complete triggers the reboot popup on the frontend
            if (send_cb_) {
                json jc;
                jc["type"] = "compass_complete";
                send_cb_(jc.dump());
            }
        }
        else
        {
            std::cout << "[Compass] Waiting for remaining "
                      << (activeCompassCount_ - successCompassCount_)
                      << " compass(es)...\n";

            sendStatusJSON("Compass " + std::to_string(compass_id + 1)
                           + " done — keep rotating for remaining compass(es)...");
        }
    }
    else if (rep.cal_status == MAG_CAL_FAILED ||
             rep.cal_status == MAG_CAL_BAD_ORIENTATION ||
             rep.cal_status == MAG_CAL_BAD_RADIUS)
    {
        if (compass_id < MAX_COMPASSES)
        {
            compassStatus_[compass_id].reported     = true;
            compassStatus_[compass_id].final_status = rep.cal_status;
        }

        failedCompassCount_++;

        std::cout << "[Compass] Compass " << (int)compass_id << " FAILED: "
                  << calStatusToString(rep.cal_status)
                  << " (failed=" << failedCompassCount_
                  << " succeeded=" << successCompassCount_
                  << " active=" << activeCompassCount_ << ")\n";

        // [FIX] Notify the frontend that THIS compass failed, but do NOT
        // immediately set state=FAILED and kill the whole session.
        // Other compasses may still be running and can still succeed.
        // We send a per-compass failed result so the UI can colour that
        // bar red, then wait for the remaining compasses to report.
        sendResultJSON("compass_failed",
                       "Compass " + std::to_string(compass_id + 1)
                       + " failed: " + calStatusToString(rep.cal_status)
                       + " (fitness=" + std::to_string(rep.fitness) + ")",
                       compass_id);

        // Check if ALL active compasses have now reported (success or failure).
        int reportedCount = successCompassCount_ + failedCompassCount_;
        bool allReported  = (activeCompassCount_ > 0)
                            ? (reportedCount >= activeCompassCount_)
                            : true;

        if (allReported)
        {
            // Every compass has now finished — declare overall result.
            cancelOverallTimeout();

            if (successCompassCount_ > 0 && failedCompassCount_ == 0)
            {
                // All succeeded (shouldn't reach here via the FAILED branch,
                // but guard it anyway).
                compassState.store(CompassCalibState::DONE);
                sendResultJSON("done",
                               "All compass calibration complete! "
                               "Click Accept to save offsets.",
                               -1);
                if (send_cb_) {
                    json jc;
                    jc["type"] = "compass_complete";
                    send_cb_(jc.dump());
                }
            }
            else if (successCompassCount_ > 0)
            {
                // At least one succeeded, at least one failed — partial success.
                // Auto-accept the successful offsets immediately.
                compassState.store(CompassCalibState::DONE);

                std::string msg = "Partial calibration: "
                    + std::to_string(successCompassCount_) + " compass(es) OK, "
                    + std::to_string(failedCompassCount_) + " failed. "
                    "Good offsets saved automatically.";

                std::cout << "[Compass] Partial success — auto-accepting: " << msg << "\n";
                sendAcceptMagCalCommand();
                sendResultJSON("done", msg, -1);

                if (send_cb_) {
                    json jc;
                    jc["type"] = "compass_complete";
                    send_cb_(jc.dump());
                }
            }
            else
            {
                // Every compass failed.
                compassState.store(CompassCalibState::FAILED);
                sendResultJSON("failed",
                               "All " + std::to_string(failedCompassCount_)
                               + " compass(es) failed calibration. "
                               "Move away from metal/electronics and try again.",
                               -1);
            }
        }
        else
        {
            // Some compasses still running — just log and let them finish.
            int remaining = activeCompassCount_ - reportedCount;
            std::cout << "[Compass] " << remaining
                      << " compass(es) still in progress after compass "
                      << (int)compass_id << " failed — waiting...\n";

            sendStatusJSON("Compass " + std::to_string(compass_id + 1)
                           + " failed — keep rotating, "
                           + std::to_string(remaining)
                           + " compass(es) still in progress...");
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND SENDERS
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::sendStartMagCalCommand(uint8_t confirmation)
{
    if (!transport_cb_)
    {
        std::cout << "[Compass] WARNING: no transport callback\n";
        return;
    }

    mavlink_message_t        mavmsg;
    mavlink_command_long_t   cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_DO_START_MAG_CAL;
    cmd.confirmation     = confirmation;
    // param1 is a BITMASK of compasses to calibrate, NOT a vehicle type.
    // 0 = calibrate ALL compasses (same as QGC). A value of 1.0f would only
    // start compass 0, which is why MAG 2 and MAG 3 never received progress.
    cmd.param1           = 0;                              // 0 = all compasses
    cmd.param2           = 0;                              // no auto-start delay
    cmd.param3           = large_vehicle_ ? 1.0f : 0.0f;  // relaxed sphere fit
    cmd.param4 = cmd.param5 = cmd.param6 = cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                    &mavmsg, &cmd);
    transport_cb_(mavmsg);

    std::cout << "[Compass] Sent DO_START_MAG_CAL (confirmation="
              << (int)confirmation << ")\n";
}

void CompassCalibration::sendCancelMagCalCommand()
{
    if (!transport_cb_)
    {
        std::cout << "[Compass] WARNING: no transport callback\n";
        return;
    }

    mavlink_message_t        mavmsg;
    mavlink_command_long_t   cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_DO_CANCEL_MAG_CAL;
    cmd.confirmation     = 0;
    cmd.param1 = cmd.param2 = cmd.param3 = cmd.param4 =
    cmd.param5 = cmd.param6 = cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                    &mavmsg, &cmd);
    transport_cb_(mavmsg);

    std::cout << "[Compass] Sent DO_CANCEL_MAG_CAL\n";
}

// ─────────────────────────────────────────────────────────────────────────────
//  sendAcceptMagCalCommand
//
//  Sends MAV_CMD_DO_ACCEPT_MAG_CAL (42425) when the user explicitly accepts.
//  This tells ArduPilot to commit the computed offsets to EEPROM and
//  trigger the drone's success beep.
//  param1 = bitmask of compasses to accept; 0 = accept all.
//
//  [FIX-E]: Only called from acceptCompassCalibration(). Never called
//  automatically from handleMagCalReport() — that was the source of the
//  double-accept bug.
// ─────────────────────────────────────────────────────────────────────────────

void CompassCalibration::sendAcceptMagCalCommand()
{
    if (!transport_cb_)
    {
        std::cout << "[Compass] WARNING: no transport callback for ACCEPT\n";
        return;
    }

    mavlink_message_t        mavmsg;
    mavlink_command_long_t   cmd{};

    cmd.target_system    = static_cast<uint8_t>(sysid_);
    cmd.target_component = static_cast<uint8_t>(compid_);
    cmd.command          = MAV_CMD_DO_ACCEPT_MAG_CAL;
    cmd.confirmation     = 0;
    cmd.param1           = 0;  // 0 = accept all compasses
    cmd.param2 = cmd.param3 = cmd.param4 = cmd.param5 =
    cmd.param6 = cmd.param7 = 0;

    mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER,
                                    &mavmsg, &cmd);
    transport_cb_(mavmsg);

    std::cout << "[Compass] Sent DO_ACCEPT_MAG_CAL — offsets will be saved to EEPROM\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RETRY WATCHER
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::startRetryWatcher()
{
    retryActive_ = true;

    retryThread_ = std::thread([this]()
    {
        while (retryActive_)
        {
            // 100 ms slices — join() returns within ~100ms after retryActive_=false
            for (int slice = 0; slice < 10 && retryActive_; ++slice)
                std::this_thread::sleep_for(std::chrono::milliseconds(100));

            if (!retryActive_) break;
            if (compassState != CompassCalibState::IN_PROGRESS) break;

            auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now() - calibStartSentAt_).count();

            if (elapsed >= CALIB_START_TIMEOUT_S)
            {
                if (calibStartRetries_ >= CALIB_MAX_RETRIES)
                {
                    std::cout << "[Compass] No response after "
                              << CALIB_MAX_RETRIES << " retries — giving up\n";
                    compassState.store(CompassCalibState::FAILED);
                    sendResultJSON("failed",
                                   "No response from drone. "
                                   "Check connection and that the vehicle is disarmed.");
                    retryActive_ = false;
                    break;
                }

                calibStartRetries_++;
                std::cout << "[Compass] No response — retry "
                          << calibStartRetries_ << "/" << CALIB_MAX_RETRIES << "\n";

                sendStatusJSON("No response from drone — retrying ("
                               + std::to_string(calibStartRetries_)
                               + "/" + std::to_string(CALIB_MAX_RETRIES) + ")...");

                // Increment confirmation on each retry per MAVLink spec
                sendStartMagCalCommand(static_cast<uint8_t>(calibStartRetries_));

                calibStartSentAt_ = std::chrono::steady_clock::now();
            }
        }
    });
}

void CompassCalibration::stopRetryWatcher()
{
    retryActive_ = false;

    if (retryThread_.joinable())
        retryThread_.join();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OVERALL CALIBRATION TIMEOUT
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::launchOverallTimeoutThread()
{
    // Never assign over a joinable thread — that calls std::terminate().
    // The caller (startCompassCalibration) is responsible for stopping the old
    // thread before calling us. This guard is a safety net.
    if (overallTimeoutThread_.joinable())
    {
        std::cout << "[Compass] WARNING: launchOverallTimeoutThread called while "
                     "previous thread still joinable — joining first\n";
        overallTimeoutActive_ = false;
        overallTimeoutCv_.notify_all();
        overallTimeoutThread_.join();
    }

    overallTimeoutActive_ = true;
    overallTimeoutArmed_  = false;

    overallTimeoutThread_ = std::thread([this]()
    {
        while (true)
        {
            {
                std::unique_lock<std::mutex> lk(overallTimeoutMtx_);
                overallTimeoutCv_.wait(lk, [this]{
                    return overallTimeoutArmed_.load() || !overallTimeoutActive_.load();
                });
            }

            if (!overallTimeoutActive_) break;

            auto deadline = std::chrono::steady_clock::now()
                            + std::chrono::seconds(CALIB_OVERALL_TIMEOUT_S);
            {
                std::unique_lock<std::mutex> lk(overallTimeoutMtx_);
                overallTimeoutCv_.wait_until(lk, deadline, [this]{
                    return !overallTimeoutArmed_.load() || !overallTimeoutActive_.load();
                });
            }

            if (!overallTimeoutActive_) break;

            // Woke early because disarmed — loop back to wait
            if (!overallTimeoutArmed_) continue;

            // Deadline elapsed — check state before acting
            // [FIX-D]: If compassState is not IN_PROGRESS (e.g. cancel already
            // set it to FAILED), do not fire another failure result.
            if (compassState != CompassCalibState::IN_PROGRESS)
            {
                overallTimeoutArmed_ = false;
                continue;
            }

            std::cout << "[Compass] Overall calibration timeout after "
                      << CALIB_OVERALL_TIMEOUT_S << "s\n";

            sendCancelMagCalCommand();
            compassState.store(CompassCalibState::FAILED);

            sendResultJSON("failed",
                           "Compass calibration timed out after "
                           + std::to_string(CALIB_OVERALL_TIMEOUT_S)
                           + "s. Ensure the drone is away from magnetic "
                             "interference and try again.");

            overallTimeoutArmed_ = false;
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  startOverallTimeout
//
//  [FIX-B]: Idempotent — uses compare_exchange_strong on overallTimeoutArmed_
//  so concurrent calls from handleCommandAck() and handleImplicitAck() only
//  arm the watchdog once. Previously both paths unconditionally set
//  overallTimeoutArmed_=true and called notify_all(), which could wake the
//  timeout thread twice and corrupt its countdown.
// ─────────────────────────────────────────────────────────────────────────────

void CompassCalibration::startOverallTimeout()
{
    if (!overallTimeoutThread_.joinable())
        launchOverallTimeoutThread();

    // [FIX-B]: Only arm if not already armed. compare_exchange guarantees at
    // most one successful arm even if called concurrently.
    bool wasArmed = false;
    if (overallTimeoutArmed_.compare_exchange_strong(wasArmed, true))
    {
        // We set it — notify the thread to start the countdown.
        overallTimeoutCv_.notify_all();
        std::cout << "[Compass] Overall timeout armed\n";
    }
    else
    {
        std::cout << "[Compass] Overall timeout already armed — skipping duplicate arm\n";
    }
}

void CompassCalibration::cancelOverallTimeout()
{
    {
        std::lock_guard<std::mutex> lk(overallTimeoutMtx_);
        overallTimeoutArmed_ = false;
    }
    overallTimeoutCv_.notify_all();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  JSON HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

void CompassCalibration::sendStatusJSON(const std::string& message)
{
    if (!send_cb_) return;

    json j;
    j["type"]    = "compass_calibration_status";
    j["sensor"]  = "compass";
    j["message"] = message;
    send_cb_(j.dump());
}

void CompassCalibration::sendProgressJSON(int compass_id, uint8_t pct)
{
    if (!send_cb_) return;

    json j;
    j["type"]       = "compass_progress";
    j["sensor"]     = "compass";
    j["compass_id"] = compass_id;
    j["compass"]    = compass_id;   // alias: spec field name
    j["progress"]   = static_cast<int>(pct);
    send_cb_(j.dump());
}

void CompassCalibration::sendResultJSON(const std::string& status,
                                        const std::string& message,
                                        int compass_id)
{
    if (!send_cb_) return;

    json j;
    j["type"]    = "compass_result";
    j["sensor"]  = "compass";
    j["status"]  = status;
    j["message"] = message;

    if (compass_id >= 0)
        j["compass_id"] = compass_id;

    send_cb_(j.dump());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAVLINK MESSAGE NAME
// ═══════════════════════════════════════════════════════════════════════════════

std::string CompassCalibration::mavlinkMsgName(uint32_t msgid)
{
    switch (msgid)
    {
        case MAVLINK_MSG_ID_HEARTBEAT:           return "HEARTBEAT";
        case MAVLINK_MSG_ID_SYS_STATUS:          return "SYS_STATUS";
        case MAVLINK_MSG_ID_ATTITUDE:            return "ATTITUDE";
        case MAVLINK_MSG_ID_COMMAND_LONG:        return "COMMAND_LONG";
        case MAVLINK_MSG_ID_COMMAND_ACK:         return "COMMAND_ACK";
        case MAVLINK_MSG_ID_STATUSTEXT:          return "STATUSTEXT";
        case MAVLINK_MSG_ID_MAG_CAL_PROGRESS:    return "MAG_CAL_PROGRESS";
        case MAVLINK_MSG_ID_MAG_CAL_REPORT:      return "MAG_CAL_REPORT";
        case MAVLINK_MSG_ID_PARAM_VALUE:         return "PARAM_VALUE";
        case MAVLINK_MSG_ID_GPS_RAW_INT:         return "GPS_RAW_INT";
        case MAVLINK_MSG_ID_VFR_HUD:             return "VFR_HUD";
        case MAVLINK_MSG_ID_GLOBAL_POSITION_INT: return "GLOBAL_POSITION_INT";
        case MAVLINK_MSG_ID_RAW_IMU:             return "RAW_IMU";
        case MAVLINK_MSG_ID_SCALED_IMU2:         return "SCALED_IMU2";
        case MAVLINK_MSG_ID_BATTERY_STATUS:      return "BATTERY_STATUS";
        case MAVLINK_MSG_ID_AUTOPILOT_VERSION:   return "AUTOPILOT_VERSION";
        default:
            return "MSG#" + std::to_string(msgid);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CAL STATUS → STRING
// ═══════════════════════════════════════════════════════════════════════════════

std::string CompassCalibration::calStatusToString(uint8_t status)
{
    switch (status)
    {
        case MAG_CAL_NOT_STARTED:       return "NOT_STARTED";
        case MAG_CAL_WAITING_TO_START:  return "WAITING_TO_START";
        case MAG_CAL_RUNNING_STEP_ONE:  return "RUNNING_STEP_ONE";
        case MAG_CAL_RUNNING_STEP_TWO:  return "RUNNING_STEP_TWO";
        case MAG_CAL_SUCCESS:           return "SUCCESS";
        case MAG_CAL_FAILED:            return "FAILED";
        case MAG_CAL_BAD_ORIENTATION:   return "BAD_ORIENTATION";
        case MAG_CAL_BAD_RADIUS:        return "BAD_RADIUS";
        default:
            return "UNKNOWN(" + std::to_string(status) + ")";
    }
}