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

class AccelCalibration
{
public:

    AccelCalibration();
    ~AccelCalibration();

    // ── Vehicle context injection ─────────────────────────────────────────
    // Must be called before any calibration command is issued so the class
    // knows which MAVLink target to address.
    void setVehicleInfo(int sysid, int compid);

    // ── Message ingestion ─────────────────────────────────────────────────
    // Called by Vehicle::process_message() for every incoming MAVLink frame.
    void processMessage(const mavlink_message_t& msg);

    // ── Accel Calibration state ───────────────────────────────────────────
    enum class AccelCalibState {
        IDLE,
        IN_PROGRESS,
        DONE,
        FAILED
    };

    AccelCalibState accelState      = AccelCalibState::IDLE;
    int             pendingPosition = 0;    // 0 = none pending

    // Send MAV_CMD_PREFLIGHT_CALIBRATION (param5=1) to start calibration.
    // Rejects immediately if the vehicle is currently armed.
    void startAccelCalibration();

    // Send MAV_CMD_PREFLIGHT_CALIBRATION (param3=1) for 2-D level calibration.
    // The drone only needs to be flat; no per-step user confirmations required.
    // Rejects immediately if the vehicle is currently armed.
    void startLevelCalibration();

    // Called by main.cpp when the user clicks "Next".
    // Sends COMMAND_LONG (MAV_CMD_ACCELCAL_VEHICLE_POS) back to the drone.
    // If attitude validation warns, a non-blocking warning is forwarded to
    // the frontend but the command is still sent.
    void confirmAccelPosition();

    // ── Injected callbacks ────────────────────────────────────────────────

    void setSendCallback(std::function<void(const std::string&)> cb)
    {
        send_cb_ = cb;
    }

    void setTransportCallback(std::function<void(const mavlink_message_t&)> cb)
    {
        transport_cb_ = cb;
    }

    // Legacy snake_case aliases (kept for backwards compatibility with main.cpp)
    void set_send_callback(std::function<void(const std::string&)> cb)
    {
        send_cb_ = cb;
    }

    void set_transport_callback(std::function<void(const mavlink_message_t&)> cb)
    {
        transport_cb_ = cb;
    }

private:

    // ── Vehicle identity (injected via setVehicleInfo) ────────────────────
    int sysid_  = 0;
    int compid_ = 0;

    // ── Armed state ──────────────────────────────────────────────────────
    bool armed_ = false;

    // Live attitude (radians) — updated from MAVLINK_MSG_ID_ATTITUDE
    float roll_{0};
    float pitch_{0};
    float yaw_{0};

    // ── Step progress tracking ───────────────────────────────────────────
    int stepIndex_ = 0;
    static constexpr int TOTAL_STEPS = 6;

    // ── Race-condition guard ─────────────────────────────────────────────
    int preConfirmedPos_ = 0;

    // ── Cancel-window guard ──────────────────────────────────────────────
    bool cancelPending_ = false;

    // ── Retry logic ──────────────────────────────────────────────────────
    static constexpr int CALIB_START_TIMEOUT_S = 4;
    static constexpr int CALIB_MAX_RETRIES     = 3;

    int  calibStartRetries_ = 0;
    std::chrono::steady_clock::time_point calibStartSentAt_;

    std::thread       retryThread_;
    std::atomic<bool> retryActive_{false};

    void startRetryWatcher();
    void stopRetryWatcher();

    void sendPreflightCalibCommand();

    // ── Per-step timeout — ONE long-lived thread ─────────────────────────
    //
    // Using a single persistent thread + condition variable instead of
    // create/destroy per step eliminates the hot-path join that caused
    // the step-5 race condition.
    //
    // startStepTimeout()  — arms the deadline, wakes the thread.  O(1), no block.
    // cancelStepTimeout() — disarms the deadline, wakes the thread. O(1), no block.
    // launchStepTimeoutThread() — called once on first use.
    // The thread is joined only in the destructor.
    static constexpr int STEP_TIMEOUT_S = 30;

    std::thread                stepTimeoutThread_;
    std::mutex                 stepTimeoutMtx_;
    std::condition_variable    stepTimeoutCv_;
    std::atomic<bool>          stepTimeoutActive_{false};
    std::atomic<bool>          stepTimeoutArmed_{false};
    std::atomic<std::chrono::steady_clock::time_point> stepDeadline_{
        std::chrono::steady_clock::time_point{}};

    void launchStepTimeoutThread();
    void startStepTimeout();    // non-blocking arm
    void cancelStepTimeout();   // non-blocking disarm

    // ── Callbacks ────────────────────────────────────────────────────────
    std::function<void(const std::string&)>        send_cb_;
    std::function<void(const mavlink_message_t&)>  transport_cb_;

    // ── Internal helpers ─────────────────────────────────────────────────

    void sendCalibJSON(const std::string& type,
                       const std::string& step,
                       const std::string& message,
                       int step_index  = -1,
                       int total_steps = TOTAL_STEPS);

    void handleAccelVehiclePos(const mavlink_command_long_t& cmd);

    void handlePreflightCalibAck(const mavlink_command_ack_t& ack);

    bool validateCurrentAttitude(int pos) const;

    static std::string accelPosToStep(int pos);
    static std::string accelPosToMessage(int pos);
    static std::string mavlinkMsgName(uint32_t msgid);
};