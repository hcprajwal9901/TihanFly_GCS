#pragma once

#include <mavlink/ardupilotmega/mavlink.h>
#include <chrono>
#include <iostream>
#include <functional>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>

// ─────────────────────────────────────────────────────────────────────────────
//  CompassCalibration
//
//  Standalone compass (magnetometer) calibration module.
//  Does NOT depend on Vehicle — communicates exclusively through injected
//  callbacks, mirroring the design of AccelCalibration.
//
//  ── Typical call order ────────────────────────────────────────────────────
//    compass.setVehicleInfo(sysid, compid);
//    compass.setSendCallback(ws_send_fn);
//    compass.setTransportCallback(mavlink_send_fn);   // ← vehicle->send_mavlink
//    compass.startCompassCalibration();
//    // feed every incoming mavlink_message_t to compass.processMessage()
//    compass.cancelCompassCalibration();   // if user aborts
//    compass.acceptCompassCalibration();   // after status="done"
//
//  ── Inbound message routing (main.cpp MUST do ALL of these) ───────────────
//
//  [WIRING 1] Link receive callback must forward ALL parsed MAVLink messages
//    to VehicleManager::handle_message() — no message-ID whitelist.
//    ArduPilot sends MAG_CAL_PROGRESS (191) and MAG_CAL_REPORT (192) with
//    sysid=0 (broadcast). If the receive callback has a whitelist that
//    excludes 191/192, those messages are silently dropped before ever
//    reaching the vehicle.
//
//  [WIRING 2] on_new_vehicle callback must call vehicle->register_handler()
//    for all five message IDs that processMessage() handles:
//      MAVLINK_MSG_ID_HEARTBEAT        (  0)
//      MAVLINK_MSG_ID_COMMAND_ACK      ( 77)
//      MAVLINK_MSG_ID_STATUSTEXT       (253)
//      MAVLINK_MSG_ID_MAG_CAL_PROGRESS (191)  ← most often missing
//      MAVLINK_MSG_ID_MAG_CAL_REPORT   (192)  ← most often missing
//    Without those two registrations, progress/report packets are silently
//    dropped inside Vehicle::process_message().
//
//  [WIRING 3] VehicleManager::handle_message() already routes sysid=0
//    broadcast messages to all live vehicles — no change needed there.
//
//  ── Fix log ──────────────────────────────────────────────────────────────
//    [BUG 1] Non-blocking retry watcher cleanup — handleImplicitAck() no longer
//            blocks the MAVLink RX thread on thread join().
//    [BUG 2] First MAG_CAL_PROGRESS / relevant STATUSTEXT now acts as an
//            implicit ACK, stopping the retry watcher.
//    [BUG 3] sendStartMagCalCommand() now accepts a confirmation counter
//            that is incremented on each retry, satisfying the MAVLink spec.
//    [BUG 4] compassState is now std::atomic<CompassCalibState>, eliminating
//            the data race between the MAVLink rx thread and retry thread.
//    [BUG 5] Retry watcher sleeps in 100 ms increments rather than 1 s, so
//            stopRetryWatcher().join() returns within ~100 ms instead of up
//            to 1 s, avoiding a dead zone on the MAVLink rx thread.
//    [BUG 6] CRITICAL FIX: Completion now ONLY triggered by MAG_CAL_REPORT
//            with status == MAG_CAL_SUCCESS. Progress bars no longer reach
//            100% before drone finishes. Per-compass status tracking added.
//    [BUG 7] Duplicate completion reports prevented: handleMagCalReport()
//            now checks if a compass has already been reported on before
//            processing. Avoids sending the same "done" message 100+ times.
//    [BUG 8] Progress bars capped at 99% to prevent premature 100% display.
//
//  ── Second-pass fixes ────────────────────────────────────────────────────
//    [FIX-A] startCompassCalibration() is guarded by startMutex_ to prevent
//            concurrent invocations from double-joining retryThread_.
//    [FIX-B] startOverallTimeout() is idempotent: uses a compare-exchange on
//            overallTimeoutArmed_ so concurrent calls from handleCommandAck()
//            and handleImplicitAck() only arm the watchdog once.
//    [FIX-C] handleCommandAck() now calls stopRetryWatcher() (join) instead of
//            bare retryActive_=false, ensuring the thread is properly joined
//            before the next startCompassCalibration() attempt.
//    [FIX-D] cancelCompassCalibration() sets state to FAILED before
//            cancelOverallTimeout() so the timeout thread can never race and
//            fire a second "failed" result after a user cancel.
//    [FIX-E] DO_ACCEPT_MAG_CAL is no longer sent automatically on all-success.
//            It is sent ONLY when the user clicks Accept (acceptCompassCalibration()).
//            This removes the double-accept: auto + user-click.
//            The frontend Accept button is now mandatory to commit offsets.
//    [FIX-F] retryThreadDone_ removed — it was written but never read (dead code).
//
//  ── Third-pass additions ────────────────────────────────────────────────
//    [FIX-G] startCompassCalibration() now guards against missing transport_cb_
//            and logs a clear error instead of silently sending nothing.
//    [FIX-H] startCompassCalibration() warns (but does not abort) when
//            sysid_==0 && compid_==0 — catches missing setVehicleInfo() call.
//    [FIX-I] setVehicleInfo() now logs the values it receives so the wiring
//            can be confirmed from the startup log without a debugger.
//    [FIX-J] processMessage() logs MAG_CAL_PROGRESS and MAG_CAL_REPORT
//            unconditionally (before any state guard) so a missing handler
//            registration in main.cpp shows up immediately in the log.
//
//  ── Fourth-pass additions (this version) ────────────────────────────────
//    [FIX-K] processMessage() no longer ignores MAG_CAL_PROGRESS when state
//            is IDLE. ArduPilot sends the first progress packet before the
//            COMMAND_ACK on some firmware; if state is still IDLE at that
//            moment the progress was silently dropped. Fix: treat first
//            MAG_CAL_PROGRESS as an implicit ACK and auto-transition to
//            IN_PROGRESS so bars start updating immediately.
//    [FIX-L] handleMagCalProgress() now calls handleImplicitAck() before
//            the state guard so the transition always fires even if
//            COMMAND_ACK never arrives (older ArduPilot firmware).
//    [FIX-M] Diagnostic counter added: processMessage() increments
//            msg_count_ on every call and logs it at 100-call intervals
//            so it is easy to verify the handler is being called at all.
// ─────────────────────────────────────────────────────────────────────────────

// Track individual compass calibration completion
struct CompassStatus {
    bool    reported        = false;
    uint8_t final_status    = 0;
    uint8_t final_progress  = 0;
};

class CompassCalibration
{
public:

    CompassCalibration();
    ~CompassCalibration();

    // ── Vehicle context injection ─────────────────────────────────────────
    //
    //  Must be called before startCompassCalibration().
    //  In the on_new_vehicle callback:
    //    compass.setVehicleInfo(vehicle->sysid(), vehicle->compid());
    void setVehicleInfo(int sysid, int compid);

    // ── Message ingestion ─────────────────────────────────────────────────
    //
    //  Call this from the register_handler lambdas registered in the
    //  on_new_vehicle callback for msgids 0, 77, 191, 192, 253.
    void processMessage(const mavlink_message_t& msg);

    // ── Calibration state ─────────────────────────────────────────────────
    enum class CompassCalibState {
        IDLE,
        IN_PROGRESS,
        DONE,
        FAILED
    };

    // [BUG 4]: atomic to eliminate data race between MAVLink rx thread and
    // retry thread.
    std::atomic<CompassCalibState> compassState{CompassCalibState::IDLE};

    static constexpr int MAX_COMPASSES = 3;
    uint8_t progress_[MAX_COMPASSES] = {0, 0, 0};

    // ── Public API ────────────────────────────────────────────────────────
    void startCompassCalibration(bool large_vehicle = false);
    void cancelCompassCalibration();

    // [FIX-E]: acceptCompassCalibration() is now the ONLY place that sends
    // DO_ACCEPT_MAG_CAL. It must be called after status="done" is received.
    // The frontend Accept button triggers this. No automatic accept on success.
    void acceptCompassCalibration();

    // ── Injected callbacks ────────────────────────────────────────────────
    //
    //  setSendCallback: called to push JSON strings to the WebSocket client.
    //    compass.setSendCallback([&ws_server](const std::string& s){
    //        ws_server.broadcast(s);
    //    });
    //
    //  setTransportCallback: called to send MAVLink messages to the drone.
    //    MUST route via vehicle->send_mavlink(), NOT directly to a Link.
    //    compass.setTransportCallback([vehicle](const mavlink_message_t& m){
    //        vehicle->send_mavlink(m);
    //    });
    void setSendCallback(std::function<void(const std::string&)> cb)
    {
        send_cb_ = cb;
    }

    void setTransportCallback(std::function<void(const mavlink_message_t&)> cb)
    {
        transport_cb_ = cb;
    }

    // Legacy snake_case aliases — kept for source compatibility
    void set_send_callback(std::function<void(const std::string&)> cb)
    {
        send_cb_ = cb;
    }

    void set_transport_callback(std::function<void(const mavlink_message_t&)> cb)
    {
        transport_cb_ = cb;
    }

private:

    // ── Vehicle identity ──────────────────────────────────────────────────
    int sysid_  = 0;
    int compid_ = 0;

    // ── [FIX-M] Diagnostic message counter ───────────────────────────────
    // Incremented on every processMessage() call. Logged every 100 calls so
    // you can confirm the handler is being reached without reading every line.
    std::atomic<uint64_t> msg_count_{0};

    // ── Armed state ───────────────────────────────────────────────────────
    bool armed_ = false;

    // ── Large vehicle flag ────────────────────────────────────────────────
    bool large_vehicle_ = false;

    // ── [FIX-A]: Mutex guarding startCompassCalibration() against concurrent
    // invocations (e.g. user double-clicks Start before the first thread exits).
    // Without this, two threads could both call stopRetryWatcher() → join() on
    // the same joinable retryThread_, and the second join throws system_error.
    std::mutex startMutex_;

    // ── Per-compass completion tracking ──────────────────────────────────
    CompassStatus compassStatus_[MAX_COMPASSES];

    // Track which compasses are actively calibrating.
    // Populated on first MAG_CAL_PROGRESS for each compass_id.
    // ALL active compasses must report SUCCESS before DONE is declared.
    bool compassActive_[MAX_COMPASSES] = {false, false, false};
    int  activeCompassCount_  = 0;
    int  successCompassCount_ = 0;
    int  failedCompassCount_  = 0;  // [FIX] track per-compass failures without killing session

    // ── Retry logic ───────────────────────────────────────────────────────
    static constexpr int CALIB_START_TIMEOUT_S = 4;
    static constexpr int CALIB_MAX_RETRIES     = 3;

    int  calibStartRetries_ = 0;
    std::chrono::steady_clock::time_point calibStartSentAt_;

    std::thread       retryThread_;
    std::atomic<bool> retryActive_{false};

    // [BUG 2]: tracks whether the retry watcher has already been stopped
    // by an implicit ACK (MAG_CAL_PROGRESS or STATUSTEXT) so we don't call
    // startOverallTimeout() twice.
    std::atomic<bool> implicitAckReceived_{false};

    void startRetryWatcher();
    void stopRetryWatcher();

    // ── Overall calibration timeout ───────────────────────────────────────
    static constexpr int CALIB_OVERALL_TIMEOUT_S = 300;

    std::thread                overallTimeoutThread_;
    std::mutex                 overallTimeoutMtx_;
    std::condition_variable    overallTimeoutCv_;
    std::atomic<bool>          overallTimeoutActive_{false};
    std::atomic<bool>          overallTimeoutArmed_{false};

    void launchOverallTimeoutThread();
    void startOverallTimeout();
    void cancelOverallTimeout();

    // ── Callbacks ─────────────────────────────────────────────────────────
    std::function<void(const std::string&)>        send_cb_;
    std::function<void(const mavlink_message_t&)>  transport_cb_;

    // ── Internal helpers ──────────────────────────────────────────────────
    // [BUG 3]: confirmation parameter incremented on each retry
    void sendStartMagCalCommand(uint8_t confirmation = 0);
    void sendCancelMagCalCommand();

    // [FIX-E]: Only called from acceptCompassCalibration() — never automatically.
    void sendAcceptMagCalCommand();

    // [BUG 2]: called on first MAG_CAL_PROGRESS or matching STATUSTEXT
    void handleImplicitAck();

    void handleCommandAck    (const mavlink_command_ack_t&      ack);
    void handleStatusText    (const mavlink_statustext_t&       st);
    void handleMagCalProgress(const mavlink_mag_cal_progress_t& prog);
    void handleMagCalReport  (const mavlink_mag_cal_report_t&   rep);

    void sendStatusJSON  (const std::string& message);
    void sendProgressJSON(int compass_id, uint8_t pct);
    void sendResultJSON  (const std::string& status,
                          const std::string& message,
                          int compass_id = -1);

    static std::string mavlinkMsgName(uint32_t msgid);
    static std::string calStatusToString(uint8_t status);
};