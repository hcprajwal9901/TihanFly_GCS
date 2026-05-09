#pragma once
#include <mavlink/ardupilotmega/mavlink.h>
#include <functional>
#include <string>
#include <cstdint>
#include <array>
#include <iostream>

/**
 * RadioCalibration
 * ─────────────────
 * Mirrors the pattern of AccelCalibration / CompassCalibration / EscCalibration.
 *
 * MAVLink flow
 * ────────────
 *  GCS → Drone  COMMAND_LONG  MAV_CMD_PREFLIGHT_CALIBRATION  param4=1
 *  Drone → GCS  COMMAND_ACK   MAV_RESULT_ACCEPTED
 *  Drone → GCS  STATUSTEXT    "Radio calibration started"
 *  Drone → GCS  RC_CHANNELS   (continuous while user moves sticks)
 *  Drone → GCS  STATUSTEXT    "Radio calibration successful"
 *  Drone → GCS  COMMAND_ACK   (final confirmation)
 *
 * RC channel min / max / trim values are accumulated locally from
 * MAVLINK_MSG_ID_RC_CHANNELS while calibration is running, then sent
 * to the frontend as JSON so the UI can display live bar updates.
 */
class RadioCalibration
{
public:
    // ── Channel data ──────────────────────────────────────────────────────
    static constexpr int NUM_CHANNELS = 18;   // ArduPilot RC_CHANNELS carries ch1-18

    struct ChannelData
    {
        uint16_t raw  = 0;      // latest raw PWM value
        uint16_t min  = 65535;  // recorded minimum during calibration
        uint16_t max  = 0;      // recorded maximum during calibration
        uint16_t trim = 1500;   // mid-point (set after calibration)
        bool     reversed = false;
    };

    // ── Lifecycle ─────────────────────────────────────────────────────────
    void setVehicleInfo(int sysid, int compid);

    void setSendCallback     (std::function<void(const std::string&)>       cb);
    void setTransportCallback(std::function<void(const mavlink_message_t&)> cb);

    // ── Control ───────────────────────────────────────────────────────────

    /** Send MAV_CMD_PREFLIGHT_CALIBRATION (param4=1) to the drone. */
    void startRadioCalibration();

    /** Abort calibration — sends param4=0 to leave calib mode. */
    void cancelRadioCalibration();

    /**
     * Called after the user clicks "Complete" in the UI.
     * Sends the accumulated min/max/trim values to the frontend as JSON
     * and optionally writes them to the FC via PARAM_SET (future work).
     */
    void completeRadioCalibration();

    // ── Message ingestion ─────────────────────────────────────────────────
    void processMessage(const mavlink_message_t& msg);

    // ── State ─────────────────────────────────────────────────────────────
    bool isRunning()      const { return accumulating_; }   // true while user session is active

    const ChannelData& channel(int idx) const;   // idx: 0-based

private:
    // ── Helpers ───────────────────────────────────────────────────────────
    void sendStartCommand();
    void sendCancelCommand();
    void broadcastChannelData() const;
    void broadcastStatus(const std::string& msg, bool success = false) const;

    // ── State ─────────────────────────────────────────────────────────────
    int sysid_  = 1;
    int compid_ = 1;

    bool running_      = false;
    bool accumulating_ = false;   // true from start until complete/cancel; survives FC ACK rejection

    std::array<ChannelData, NUM_CHANNELS> channels_{};

    std::function<void(const std::string&)>       send_cb_;
    std::function<void(const mavlink_message_t&)> transport_cb_;
};