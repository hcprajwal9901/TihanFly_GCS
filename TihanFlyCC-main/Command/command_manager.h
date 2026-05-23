#pragma once
/**
 * command_manager.h
 * TiHANFly GCS — Command queue and mission upload
 *
 * Routing modes (mutually exclusive; last one set wins):
 *
 *   A) set_vehicle_direct(Vehicle*)          ← USE THIS in single-vehicle main.cpp
 *        execute() calls vehicle->send_mavlink() directly.
 *        No sysid required — the Vehicle object already carries sysid,
 *        compid, link_id, and a LinkManager pointer.
 *
 *   B) set_vehicle_manager(VehicleManager*)
 *        Multi-vehicle builds — no sysid required.
 *        resolve_vehicle() asks VehicleManager for the first live vehicle
 *        (get_active_vehicle()).  Switch the active vehicle at any time by
 *        calling set_vehicle_direct() or by setting a new VehicleManager.
 *
 * In both modes the command pipeline is strictly:
 *   CommandManager → Vehicle::send_mavlink()
 *                  → LinkManager::send(link_id_)
 *                  → Link → Transport → Drone
 *
 * Mission upload is the single exception: the MAVLink mission protocol is a
 * stateful handshake (COUNT → REQUEST → ITEM … ACK) that sits below the
 * Vehicle abstraction, so upload_mission() uses Transport directly via
 * active_transport.  set_transport() must be called before upload_mission().
 *
 * Thread safety: add_command() and process() are guarded by queue_mutex_.
 */

#include <queue>
#include <string>
#include <memory>
#include <functional>
#include <vector>
#include <atomic>
#include <mutex>
#include <cstdint>

#include "Transport/transport.h"

class Vehicle;
class VehicleManager;

// ── Simple command ────────────────────────────────────────────────────────────
struct Command {
    int         id        = 0;
    std::string name;
    float       param1    = 0;
    float       param2    = 0;
    std::string mode_name;
    std::shared_ptr<Vehicle> target_vehicle;
};

// ── MAVLink mission item ──────────────────────────────────────────────────────
struct WaypointItem {
    uint16_t seq          = 0;
    float    lat          = 0.f;
    float    lng          = 0.f;
    float    altitude     = 0.f;
    uint16_t command      = 16;      // MAV_CMD_NAV_WAYPOINT
    uint8_t  frame        = 3;       // MAV_FRAME_GLOBAL_RELATIVE_ALT
    float    hold_time    = 0.f;
    bool     autocontinue = true;
};

// ═════════════════════════════════════════════════════════════════════════════
class CommandManager
{
public:
    CommandManager();

    // -----------------------------------------------------------------------
    // Routing — Mode A: caller owns the Vehicle object
    //   Use this in single-vehicle builds.  The Vehicle already stores sysid,
    //   compid, link_id, and a LinkManager pointer — no extra IDs needed here.
    // -----------------------------------------------------------------------
    void set_vehicle_direct(Vehicle* vehicle);

    // -----------------------------------------------------------------------
    // Routing — Mode B: multi-vehicle via VehicleManager
    //   No sysid argument — resolve_vehicle() selects the first live vehicle
    //   returned by VehicleManager::get_active_vehicle().
    // -----------------------------------------------------------------------
    void set_vehicle_manager(VehicleManager* vm);

    // -----------------------------------------------------------------------
    // Removed set_active_vehicle in favor of passing target directly to add_command.

    // -----------------------------------------------------------------------
    // Transport — required only for mission upload (low-level handshake).
    // Normal commands flow through Vehicle::send_mavlink(), not here.
    // -----------------------------------------------------------------------
    void set_transport(std::shared_ptr<Transport> transport);

    // -----------------------------------------------------------------------
    // Command queue  (thread-safe)
    // -----------------------------------------------------------------------
    void add_command(int id, const std::string& cmd_name,
                     float p1 = 0, float p2 = 0,
                     const std::string& mode = "",
                     std::shared_ptr<Vehicle> target = nullptr);
    void process();

    // -----------------------------------------------------------------------
    // Mission upload
    //   vehicle — when non-null, mission items are sent via that vehicle's
    //             own link (correct per-drone transport in multi-vehicle mode).
    //             When null, falls back to active_transport (legacy/serial).
    // -----------------------------------------------------------------------
    void upload_mission(int request_id,
                        const std::vector<WaypointItem>& waypoints,
                        uint8_t target_sysid = 1,
                        uint8_t target_compid = 0,
                        Vehicle* vehicle = nullptr);

    void on_mission_request(uint16_t seq);
    void on_mission_ack(uint8_t type);

    // -----------------------------------------------------------------------
    // Response callback  (JSON → WebSocket / UI)
    // -----------------------------------------------------------------------
    void set_response_callback(std::function<void(const std::string&)> cb);

private:
    void     execute(const Command& cmd);
    Vehicle* resolve_vehicle(const Command& cmd) const;   // sysid-free; honours active mode
    void     send_mission_count();
    void     send_mission_item(uint16_t seq);

    // ── Routing ──────────────────────────────────────────────────────────────
    // Exactly one of these is non-null at a time.
    Vehicle*        direct_vehicle_  = nullptr;   // Mode A
    VehicleManager* vehicle_manager_ = nullptr;   // Mode B

    // ── Transport (mission upload only) ──────────────────────────────────────
    std::shared_ptr<Transport> active_transport;

    // ── Command queue + mutex ─────────────────────────────────────────────────
    std::queue<Command> queue_;
    mutable std::mutex  queue_mutex_;

    std::function<void(const std::string&)> response_callback_;

    // ── Mission state ─────────────────────────────────────────────────────────
    std::vector<WaypointItem> pending_mission_;
    int                       mission_request_id_ = 0;
    std::atomic<bool>         mission_in_progress_{false};
    uint8_t                   mission_target_sysid_ = 1;
    uint8_t                   mission_target_compid_ = 0;
    // When set, mission items are sent via this vehicle's link (not active_transport).
    // Cleared when upload completes.
    Vehicle*                  mission_target_vehicle_ = nullptr;
};
