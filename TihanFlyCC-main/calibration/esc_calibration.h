#pragma once
/**
 * esc_calibration.h
 * TiHANFly GCS — ArduPilot ESC Calibration (Safety-Button / Reboot method)
 *
 * ─── WHY THE RC_CHANNELS_OVERRIDE METHOD IS WRONG ────────────────────────────
 *
 * Sending RC_CHANNELS_OVERRIDE (chan3=2000 / 1000) on ArduPilot Copter 4.x:
 *
 *   • Triggers "Radio Failsafe - Disarming" — ArduPilot treats the GCS RC
 *     override as a lost-RC condition and fires FS_THR_ENABLE.
 *   • ESC throttle range is NOT stored because calibration mode was never
 *     properly entered — the FC needs a safety-button long-press to transition
 *     into ESC-cal mode, not a raw throttle override from the GCS.
 *   • Any beeps heard are failsafe beeps, NOT calibration confirmation beeps.
 *
 * ─── CORRECT ARDUPILOT PROTOCOL (matches QGC + Mission Planner) ──────────────
 *
 *  Step 1  GCS sends MAV_CMD_PREFLIGHT_CALIBRATION  param7=1
 *          → ArduPilot writes ESC-cal flag to EEPROM
 *          → ACK result=4 (UNSUPPORTED) is normal on Copter 4.x; proceed anyway
 *          → Timeout (3 s) also proceeds (same QGC / MP behaviour)
 *
 *  Step 2  GCS sends MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN  param1=1
 *          → FC reboots
 *
 *  Step 3  On next boot the FC is in "ESC calibration pending" state.
 *          User long-presses the safety button (≥2 s):
 *            • FC drives all ESC outputs to MAX (~2000 µs) — ESCs beep entry tone
 *            • FC drives all ESC outputs to MIN (~1000 µs) — ESCs beep confirmation
 *            • FC reboots into normal flight mode automatically
 *
 * The GCS sends ONLY steps 1 and 2 and then instructs the user via the UI.
 * No RC_CHANNELS_OVERRIDE is needed or safe.
 *
 * ─── Retry logic ─────────────────────────────────────────────────────────────
 *
 *  MAV_RESULT_TEMPORARILY_REJECTED (3): up to MAX_RETRIES attempts, 2 s apart.
 *  On final retry exhaustion the sequence stops with an "error" status.
 *  All other non-success results (DENIED=1, FAILED=2) stop immediately.
 *
 * ─── WebSocket JSON emitted ───────────────────────────────────────────────────
 *   { "type":"esc_calibration_status", "stage":"preflight",   "message":"…", "busy":true  }
 *   { "type":"esc_calibration_status", "stage":"accepted",    "message":"…", "busy":true  }
 *   { "type":"esc_calibration_status", "stage":"timeout",     "message":"…", "busy":true  }
 *   { "type":"esc_calibration_status", "stage":"retrying",    "message":"…", "busy":true  }
 *   { "type":"esc_calibration_status", "stage":"rebooting",   "message":"…", "busy":true  }
 *   { "type":"esc_calibration_status", "stage":"wait_safety", "message":"…", "busy":false }
 *   { "type":"esc_calibration_status", "stage":"cancelled",   "message":"…", "busy":false }
 *   { "type":"esc_calibration_status", "stage":"error",       "message":"…", "busy":false }
 *
 * ─── WebSocket JSON consumed ──────────────────────────────────────────────────
 *   { "type":"start_esc_calibration"  }
 *   { "type":"cancel_esc_calibration" }
 */

#include <mavlink/ardupilotmega/mavlink.h>
#include <functional>
#include <atomic>
#include <string>

class EscCalibration
{
public:
    using SendCallback      = std::function<void(const std::string&)>;
    using TransportCallback = std::function<void(const mavlink_message_t&)>;

    // ── Wiring (call once from main.cpp) ─────────────────────────────────────
    void setSendCallback     (SendCallback      cb);
    void setTransportCallback(TransportCallback cb);
    void setVehicleInfo      (int sysid, int compid);

    // ── Control ──────────────────────────────────────────────────────────────
    // startEscCalibration() blocks for ~4 s — always run on a detached thread.
    // After it completes the FC is rebooting; user then presses safety button.
    void startEscCalibration();
    void cancelEscCalibration();

    // ── MAVLink inbound ───────────────────────────────────────────────────────
    void processMessage(const mavlink_message_t& msg);

private:
    void sendStatus(const std::string& stage,
                    const std::string& message,
                    bool               busy);

    void sendPreflight();
    void sendReboot();

    SendCallback      send_cb_;
    TransportCallback transport_cb_;

    int sysid_  = 1;
    int compid_ = 1;

    std::atomic<bool> calibrating_ { false };
    std::atomic<bool> cancelled_   { false };
    std::atomic<bool> ack_received_{ false };
    std::atomic<int>  ack_result_  { -1    };
};
