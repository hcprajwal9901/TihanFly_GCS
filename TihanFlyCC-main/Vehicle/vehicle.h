#pragma once

#include <mavlink/ardupilotmega/mavlink.h>
#include <functional>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include <stdexcept>
#include <memory>
#include <string>
#include <cstring>

// Forward declarations
class LinkManager;
class AccelCalibration;
class CompassCalibration;
class EscCalibration;
class RadioCalibration;

class Vehicle
{
public:
    using MessageHandler =
        std::function<void(const mavlink_message_t&)>;

    // link_manager must remain valid for the lifetime of this Vehicle.
    Vehicle(int sysid, int compid, int link_id,
            LinkManager* link_manager, int ui_sysid);

    // Destructor must be defined in vehicle.cpp (where AccelCalibration is
    // a complete type) so that unique_ptr<AccelCalibration>'s deleter is
    // only instantiated there — not in every TU that includes vehicle.h.
    ~Vehicle();

    // ---------------------------------------------------------------
    // Identity
    // ---------------------------------------------------------------
    int sysid()    const;
    int compid()   const;
    int link_id()  const;
    int ui_sysid() const;

    // ---------------------------------------------------------------
    // Runtime link switching
    //
    // Call this whenever the active transport changes (Serial ↔ UDP).
    // All subsequent send_mavlink() calls will use the new link_id.
    // Thread-safe — guarded by link_id_mtx_.
    // ---------------------------------------------------------------
    void set_link_id(int new_link_id);

    // ---------------------------------------------------------------
    // Inbound path  (called by main's message callback or VehicleManager)
    // ---------------------------------------------------------------
    void process_message(const mavlink_message_t& msg);

    // ---------------------------------------------------------------
    // Outbound path
    // Serialises the message to bytes and sends via LinkManager →
    // Link → Transport → Drone.
    // ---------------------------------------------------------------
    void send_mavlink(const mavlink_message_t& msg);

    // ---------------------------------------------------------------
    // Message-handler registry
    // ---------------------------------------------------------------
    void register_handler(uint32_t msgid, MessageHandler handler);

    // ---------------------------------------------------------------
    // Per-vehicle AccelCalibration instance
    // Owned here so each drone gets independent calibration state.
    // ---------------------------------------------------------------
    AccelCalibration& accel_calib();

    // ---------------------------------------------------------------
    // Per-vehicle CompassCalibration instance
    // Owned here so each drone gets independent compass calib state.
    // Callbacks (transport + send) are wired in on_new_vehicle.
    // ---------------------------------------------------------------
    CompassCalibration& compass_calib();

    // ---------------------------------------------------------------
    // Per-vehicle EscCalibration instance
    // Owned here so each drone gets independent ESC calib state.
    // Callbacks (transport + send) are wired in on_new_vehicle.
    // ---------------------------------------------------------------
    EscCalibration& esc_calib();

    // ---------------------------------------------------------------
    // Per-vehicle RadioCalibration instance
    // Owned here so each drone gets independent RC calib state.
    // Callbacks (transport + send) are wired in on_new_vehicle.
    // ---------------------------------------------------------------
    RadioCalibration& radio_calib();

    // ---------------------------------------------------------------
    // Heartbeat liveness check
    // ---------------------------------------------------------------
    bool is_alive() const;

    // ---------------------------------------------------------------
    // Reboot detection
    //
    // Returns true ONCE after a heartbeat gap > 5 seconds is detected
    // (i.e. the drone rebooted).  The flag is cleared after reading so
    // callers get exactly one "reboot" event per gap.  Thread-safe.
    // ---------------------------------------------------------------
    bool check_and_clear_reboot();

    // ---------------------------------------------------------------
    // Telemetry accessors  (cached from inbound MAVLink messages)
    // Thread-safe — protected by telem_mtx_.
    // ---------------------------------------------------------------
    bool        is_armed()            const;
    std::string flight_mode_string()  const;   // e.g. "GUIDED"
    int         battery_remaining()   const;   // 0-100, -1 = unknown
    float       battery_voltage()     const;   // Volts, 0 = unknown
    uint8_t     gps_fix_type()        const;   // MAV_GPS_FIX_TYPE
    uint8_t     gps_satellites()      const;
    double      latitude()            const;   // degrees
    double      longitude()           const;   // degrees
    float       altitude_msl()        const;   // metres
    float       roll()                const;   // radians
    float       pitch()               const;   // radians
    float       yaw()                 const;   // radians
    float       speed()               const;   // m/s (from VFR_HUD)

private:
    void update_heartbeat();
    void update_telemetry(const mavlink_message_t& msg);  // called from process_message

    int sysid_;
    int compid_;
    int link_id_;
    int ui_sysid_;

    LinkManager* link_manager_;   // never null after construction

    mutable std::mutex link_id_mtx_;   // guards link_id_ for set/get

    std::unordered_map<uint32_t, std::vector<MessageHandler>> handlers_;
    mutable std::mutex handlers_mtx_;

    std::chrono::steady_clock::time_point last_heartbeat_;
    std::chrono::steady_clock::time_point created_at_;
    std::atomic<bool> rebooted_{false};
    mutable std::mutex heartbeat_mtx_;

    // ── Cached telemetry (updated by update_telemetry) ───────────
    struct TelemetryCache {
        bool        armed          = false;
        std::string mode           = "UNKNOWN";
        int         battery_pct    = -1;     // -1 = not received yet
        float       battery_v      = 0.f;
        uint8_t     gps_fix        = 0;
        uint8_t     num_sats       = 0;
        double      lat            = 0.0;
        double      lon            = 0.0;
        float       alt_msl        = 0.f;
        float       roll           = 0.f;
        float       pitch          = 0.f;
        float       yaw_rad        = 0.f;
        float       speed          = 0.f;
    };
    TelemetryCache     telem_;
    mutable std::mutex telem_mtx_;

    // Per-vehicle calibration — owned here, created on first use via unique_ptr
    // to avoid a circular include between vehicle.h and accel_calibration.h.
    std::unique_ptr<AccelCalibration>    accel_calib_;
    std::unique_ptr<CompassCalibration>  compass_calib_;
    std::unique_ptr<EscCalibration>      esc_calib_;
    std::unique_ptr<RadioCalibration>    radio_calib_;
};