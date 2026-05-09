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
    // One-shot vehicle override for the next process() call.
    //
    // When the frontend sends a command with an explicit sysid, main.cpp
    // looks up that Vehicle via VehicleManager::get_vehicle(sysid) and passes
    // it here so the command is routed to the right drone.
    //
    // The override is consumed (reset to nullptr) inside process() after the
    // command executes, so it never bleeds into the next unrelated command.
    //
    // Falls back to the normal Mode A / Mode B routing if not set.
    // -----------------------------------------------------------------------
    void set_active_vehicle(std::shared_ptr<Vehicle> vehicle);

    // -----------------------------------------------------------------------
    // Transport — required only for mission upload (low-level handshake).
    // Normal commands flow through Vehicle::send_mavlink(), not here.
    // -----------------------------------------------------------------------
    void set_transport(std::shared_ptr<Transport> transport);

    // -----------------------------------------------------------------------
    // Command queue  (thread-safe)
    // -----------------------------------------------------------------------
    void add_command(int id, const std::string& cmd,
                     float p1 = 0, float p2 = 0,
                     const std::string& mode = "");
    void process();

    // -----------------------------------------------------------------------
    // Mission upload
    // -----------------------------------------------------------------------
    void upload_mission(int request_id,
                        const std::vector<WaypointItem>& waypoints);

    void on_mission_request(uint16_t seq);
    void on_mission_ack(uint8_t type);

    // -----------------------------------------------------------------------
    // Response callback  (JSON → WebSocket / UI)
    // -----------------------------------------------------------------------
    void set_response_callback(std::function<void(const std::string&)> cb);

private:
    void     execute(const Command& cmd);
    Vehicle* resolve_vehicle() const;   // sysid-free; honours active mode
    void     send_mission_count();
    void     send_mission_item(uint16_t seq);

    // ── Routing ──────────────────────────────────────────────────────────────
    // Exactly one of these is non-null at a time.
    Vehicle*        direct_vehicle_  = nullptr;   // Mode A
    VehicleManager* vehicle_manager_ = nullptr;   // Mode B

    // One-shot override set by set_active_vehicle(); consumed in process().
    // Takes priority over both Mode A and Mode B for a single process() cycle.
    // mutable so resolve_vehicle() const can reset it after consuming.
    mutable std::shared_ptr<Vehicle> override_vehicle_;

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
};
