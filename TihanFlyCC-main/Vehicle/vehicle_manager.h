#pragma once
/**
 * vehicle_manager.h
 * TiHANFly GCS — multi-vehicle registry
 *
 * Discovers vehicles by sysid from inbound MAVLink traffic and maintains
 * a live map of shared_ptr<Vehicle> objects.
 *
 * Discovery rule: a new Vehicle is created only on receipt of a HEARTBEAT
 * from an unknown sysid.  Non-heartbeat frames from unknown sysids are
 * silently dropped (they may arrive before the first heartbeat).
 *
 * Broadcast routing (sysid == 0): ArduPilot sends MAG_CAL_PROGRESS (191),
 * MAG_CAL_REPORT (192), and some calibration STATUSTEXT messages with
 * sysid=0.  These are routed to all live vehicles without going through the
 * normal discovery path, matching Mission Planner / QGC behaviour.
 *
 * Link tracking: on every HEARTBEAT from a known vehicle, handle_message()
 * calls vehicle->set_link_id(link_id) automatically, so Serial <-> UDP
 * failover is handled here without any extra logic in main.cpp.
 *
 * Liveness: call check_timeouts() periodically (e.g. every 2-3 s from a
 * timer thread) to evict vehicles whose heartbeat has been silent for > 5 s.
 * on_vehicle_lost_ fires for each evicted sysid.
 *
 * Lifecycle callbacks:
 *   set_on_new_vehicle(cb)
 *     Fired once per newly discovered vehicle, after it is inserted into the
 *     registry.  Use this in main.cpp to attach per-Vehicle MAVLink handlers
 *     and wire module send callbacks — replaces the old hacky
 *     handlers_registered map.
 *     Signature: void cb(std::shared_ptr<Vehicle>)
 *
 *   set_on_vehicle_lost(cb)
 *     Fired from check_timeouts() for each vehicle evicted due to heartbeat
 *     timeout.  Use this to reset UI / module state.
 *     Signature: void cb(int sysid)
 *
 * Routing:
 *   get_active_vehicle() — returns the first live vehicle in the registry.
 *     Used by CommandManager (Mode B) so that routing never depends on a
 *     sysid held by the caller.  The returned Vehicle already stores its own
 *     sysid, compid, link_id, and LinkManager pointer.
 *
 *   get_vehicle(sysid)   — explicit sysid lookup; use only where a specific
 *     vehicle must be addressed (e.g. telemetry display).
 */

#include "vehicle.h"

#include <unordered_map>
#include <memory>
#include <mutex>
#include <functional>
#include <vector>

class LinkManager;

class VehicleManager
{
public:
    // link_manager must remain valid for the lifetime of this VehicleManager.
    explicit VehicleManager(LinkManager* link_manager);

    // -----------------------------------------------------------------------
    // Inbound path — call for every received MAVLink frame.
    // link_id identifies which Link the message arrived on.
    //
    // On first HEARTBEAT from a new sysid:
    //   - Creates the Vehicle, inserts it, fires on_new_vehicle_ callback.
    // On every subsequent HEARTBEAT from a known sysid:
    //   - Calls vehicle->set_link_id(link_id) to keep outbound routing current.
    // -----------------------------------------------------------------------
    void handle_message(const mavlink_message_t& msg, int link_id);

    // -----------------------------------------------------------------------
    // Evict vehicles whose heartbeat has timed out (> 5 s silence).
    // Call periodically from a background timer.
    // Fires on_vehicle_lost_ for each evicted vehicle (outside the lock).
    // -----------------------------------------------------------------------
    void check_timeouts();

    // -----------------------------------------------------------------------
    // Sysid-free routing (used by CommandManager Mode B).
    // Returns the first Vehicle whose is_alive() is true, or nullptr if
    // no live vehicle is registered yet (e.g. waiting for first heartbeat).
    // -----------------------------------------------------------------------
    std::shared_ptr<Vehicle> get_active_vehicle() const;

    // -----------------------------------------------------------------------
    // Explicit sysid lookup — returns nullptr if sysid is not (yet) known.
    // -----------------------------------------------------------------------
    std::shared_ptr<Vehicle> get_vehicle(int sysid) const;

    // -----------------------------------------------------------------------
    // Link-id lookup — returns the Vehicle whose current link_id matches.
    //
    // Use this to target a specific drone by the physical connection it
    // arrived on (e.g. serial link 1, UDP link 0).  This is the entry point
    // for per-drone calibration:
    //
    //   CalibModule → VehicleManager.get_vehicle_by_link(link_id)
    //               → Vehicle.send_mavlink()
    //               → LinkManager.send(link_id)
    //               → Link.write_bytes()
    //               → Transport (UDP / Serial)
    //               → Drone
    //
    // Returns nullptr if no live vehicle is on that link.
    // -----------------------------------------------------------------------
    std::shared_ptr<Vehicle> get_vehicle_by_link(int link_id) const;

    // -----------------------------------------------------------------------
    // Multi-vehicle: returns sysids of all currently-alive vehicles.
    // Used by send_status() to populate j["vehicles"] for the frontend
    // drone-selector dropdown.
    // -----------------------------------------------------------------------
    std::vector<int> get_all_sysids() const;

    // -----------------------------------------------------------------------
    // Lifecycle callbacks
    // -----------------------------------------------------------------------
    using NewVehicleCallback  = std::function<void(std::shared_ptr<Vehicle>)>;
    using VehicleLostCallback = std::function<void(int sysid)>;

    void set_on_new_vehicle (NewVehicleCallback  cb);
    void set_on_vehicle_lost(VehicleLostCallback cb);

private:
    LinkManager* link_manager_;   // non-owning; outlives this object

    // Key = "sysid:link_id" so two drones with the same sysid
    // (both defaulting to SYSID_THISMAV=1) on different links are
    // tracked as separate vehicles.
    std::unordered_map<std::string, std::shared_ptr<Vehicle>> vehicles_;
    mutable std::mutex mutex_;

    NewVehicleCallback  on_new_vehicle_;
    VehicleLostCallback on_vehicle_lost_;
};