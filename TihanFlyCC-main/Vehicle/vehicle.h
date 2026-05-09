#pragma once

#include <mavlink/ardupilotmega/mavlink.h>
#include <functional>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <chrono>
#include <stdexcept>
#include <memory>

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
            LinkManager* link_manager);

    // Destructor must be defined in vehicle.cpp (where AccelCalibration is
    // a complete type) so that unique_ptr<AccelCalibration>'s deleter is
    // only instantiated there — not in every TU that includes vehicle.h.
    ~Vehicle();

    // ---------------------------------------------------------------
    // Identity
    // ---------------------------------------------------------------
    int sysid()   const;
    int compid()  const;
    int link_id() const;

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

private:
    void update_heartbeat();

    int sysid_;
    int compid_;
    int link_id_;

    LinkManager* link_manager_;   // never null after construction

    mutable std::mutex link_id_mtx_;   // guards link_id_ for set/get

    std::unordered_map<uint32_t, std::vector<MessageHandler>> handlers_;
    mutable std::mutex handlers_mtx_;

    std::chrono::steady_clock::time_point last_heartbeat_;
    mutable std::mutex heartbeat_mtx_;

    // Per-vehicle calibration — owned here, created on first use via unique_ptr
    // to avoid a circular include between vehicle.h and accel_calibration.h.
    std::unique_ptr<AccelCalibration>    accel_calib_;
    std::unique_ptr<CompassCalibration>  compass_calib_;
    std::unique_ptr<EscCalibration>      esc_calib_;
    std::unique_ptr<RadioCalibration>    radio_calib_;
};