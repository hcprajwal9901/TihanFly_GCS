#include "vehicle_manager.h"
#include "../Link/link_manager.h"

#include <iostream>

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

VehicleManager::VehicleManager(LinkManager* link_manager)
    : link_manager_(link_manager)
{
    if (!link_manager_)
        throw std::invalid_argument(
            "[VehicleManager] link_manager must not be null");
}

// ---------------------------------------------------------------------------
// Lifecycle callback registration
// ---------------------------------------------------------------------------

void VehicleManager::set_on_new_vehicle(NewVehicleCallback cb)
{
    on_new_vehicle_ = std::move(cb);
}

void VehicleManager::set_on_vehicle_lost(VehicleLostCallback cb)
{
    on_vehicle_lost_ = std::move(cb);
}

// ---------------------------------------------------------------------------
// Message routing
//
// Only heartbeat messages trigger vehicle discovery.  All other message
// types are silently dropped for unknown sysids — they may have arrived
// before the first heartbeat, which is normal in MAVLink.
//
// On every HEARTBEAT from a known vehicle we call set_link_id() so that
// Serial <-> UDP failover is handled here, once, rather than being
// duplicated across multiple places in main.cpp.
// ---------------------------------------------------------------------------

void VehicleManager::handle_message(const mavlink_message_t& msg,
                                    int link_id)
{
    const int sysid  = static_cast<int>(msg.sysid);
    const int compid = static_cast<int>(msg.compid);

    // Composite key: "sysid:link_id"
    // Two boards with the same sysid (both ArduPilot default SYSID_THISMAV=1)
    // on different physical links are treated as separate vehicles.
    const std::string key = std::to_string(sysid) + ":" + std::to_string(link_id);

    // ── Broadcast messages (sysid == 0) ──────────────────────────────────────
    //
    // ArduPilot sends several calibration messages with sysid=0 (broadcast):
    //   MAG_CAL_PROGRESS  (191)
    //   MAG_CAL_REPORT    (192)
    //   Some STATUSTEXT variants during calibration
    //
    // The previous code dropped every non-heartbeat frame from an unknown
    // sysid.  sysid=0 is never registered as a vehicle, so ALL calibration
    // progress and report messages were silently swallowed — the drone
    // accepted DO_START_MAG_CAL but the GCS never saw any progress data.
    //
    // Fix: route sysid=0 messages directly to all live vehicles without
    // going through the normal discovery path.  This matches Mission Planner
    // and QGC behaviour (both route sysid=0 to the active vehicle).
    // Route sysid=0 broadcast messages (MAG_CAL_PROGRESS, MAG_CAL_REPORT)
if (sysid == 0)
{
    std::vector<std::shared_ptr<Vehicle>> targets;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (auto& [id, v] : vehicles_)
            if (v && v->is_alive()) targets.push_back(v);
    }
    if (!targets.empty())
    {
        std::cout << "[VehicleManager] sysid=0 broadcast msgid="
                  << msg.msgid << " → routing to "
                  << targets.size() << " vehicle(s)\n";
        for (auto& v : targets)
            v->process_message(msg);
    }
    return;
}

    std::shared_ptr<Vehicle> vehicle;
    bool is_new = false;

    {
        std::lock_guard<std::mutex> lock(mutex_);

        auto it = vehicles_.find(key);

        if (it == vehicles_.end())
        {
            // Only create a new Vehicle on heartbeat — canonical MAVLink
            // vehicle-discovery pattern.
            if (msg.msgid != MAVLINK_MSG_ID_HEARTBEAT)
                return;

            // ── Filter non-autopilot heartbeats ──────────────────────────────
            //
            // ArduPilot flight controllers always heartbeat with:
            //   compid == MAV_COMP_ID_AUTOPILOT1 (= 1)
            //   type   != MAV_TYPE_GCS
            //   autopilot != MAV_AUTOPILOT_INVALID
            //
            // compid = 0 (MAV_COMP_ID_ALL) means the sender is a GCS echo,
            // SiK/RFD radio, companion computer, or mavproxy forwarding node —
            // NOT a flight controller.  Registering it as a "vehicle" causes
            // the UI drone-selector to show it as a selectable drone, but ARM /
            // SET_MODE / etc. sent to it are silently ignored because it has no
            // ArduPilot stack.
            //
            // Rule: only accept a new Vehicle entry when the heartbeat comes
            // from an actual autopilot component (compid == 1) that is not a
            // ground station, and whose autopilot field is not INVALID/GENERIC.
            {
                mavlink_heartbeat_t hb{};
                mavlink_msg_heartbeat_decode(&msg, &hb);

                const bool is_gcs =
                    (hb.type == MAV_TYPE_GCS);
                const bool is_invalid_autopilot =
                    (hb.autopilot == MAV_AUTOPILOT_INVALID);
                const bool is_broadcast_compid =
                    (compid == 0);   // MAV_COMP_ID_ALL — not a real FC

                if (is_gcs || is_invalid_autopilot || is_broadcast_compid)
                {
                    std::cout << "[VehicleManager] Ignored non-FC heartbeat:"
                              << " sysid="     << sysid
                              << " compid="    << compid
                              << " type="      << static_cast<int>(hb.type)
                              << " autopilot=" << static_cast<int>(hb.autopilot)
                              << '\n';
                    return;
                }
            }

            int ui_sysid = sysid;
            bool duplicate;
            do {
                duplicate = false;
                for (const auto& [k, v] : vehicles_) {
                    if (v && v->ui_sysid() == ui_sysid) {
                        duplicate = true;
                        ui_sysid++;
                        break;
                    }
                }
            } while (duplicate);

            vehicle = std::make_shared<Vehicle>(
                sysid, compid, link_id, link_manager_, ui_sysid);

            vehicles_[key] = vehicle;
            is_new = true;

            std::cout << "[VehicleManager] New vehicle discovered:"
                      << " sysid="     << sysid
                      << " ui_sysid="  << ui_sysid
                      << " compid="    << compid
                      << " link_id="   << link_id
                      << '\n';
        }
        else
        {
            vehicle = it->second;

            // Keep the vehicle's outbound link_id in sync with whichever
            // link the latest heartbeat arrived on.  Handles seamless
            // Serial <-> UDP failover without special-casing in main.cpp.
            if (msg.msgid == MAVLINK_MSG_ID_HEARTBEAT)
                vehicle->set_link_id(link_id);
        }
    }   // mutex released before any callbacks to avoid potential deadlocks

    // Fire new-vehicle callback outside the lock so the caller can safely
    // call get_vehicle() / get_active_vehicle() from within the callback.
    if (is_new && on_new_vehicle_)
        on_new_vehicle_(vehicle);

    vehicle->process_message(msg);
}

// ---------------------------------------------------------------------------
// Timeout eviction
// Fires on_vehicle_lost_ for each evicted vehicle, outside the lock.
// ---------------------------------------------------------------------------

void VehicleManager::check_timeouts()
{
    std::vector<std::pair<int,int>> lost_vehicles;  // {sysid, ui_sysid}

    {
        std::lock_guard<std::mutex> lock(mutex_);

        for (auto it = vehicles_.begin(); it != vehicles_.end(); )
        {
            if (!it->second->is_alive())
            {
                std::cout << "[VehicleManager] Vehicle " << it->second->sysid()
                          << " (link=" << it->second->link_id()
                          << ") timed out — removing\n";
                lost_vehicles.push_back({it->second->sysid(),
                                         it->second->ui_sysid()});
                it = vehicles_.erase(it);
            }
            else
            {
                ++it;
            }
        }
    }

    if (on_vehicle_lost_)
        for (auto& [sysid, ui_sysid] : lost_vehicles)
            on_vehicle_lost_(sysid, ui_sysid);
}

// ---------------------------------------------------------------------------
// get_active_vehicle()
//
// Returns the first live Vehicle in the registry without requiring the caller
// to know any sysid.  This is the correct entry point for CommandManager
// (Mode B) — the Vehicle itself already carries sysid, compid, link_id, and
// a LinkManager pointer, so nothing extra is needed from outside.
//
// Returns nullptr if:
//   - No vehicle has been discovered yet (waiting for first HEARTBEAT), or
//   - All known vehicles have timed out.
// ---------------------------------------------------------------------------

std::shared_ptr<Vehicle> VehicleManager::get_active_vehicle() const
{
    std::lock_guard<std::mutex> lock(mutex_);

    for (const auto& [sysid, vehicle] : vehicles_)
    {
        if (vehicle && vehicle->is_alive())
            return vehicle;
    }

    return nullptr;
}

// ---------------------------------------------------------------------------
// get_vehicle()  — explicit sysid lookup
// ---------------------------------------------------------------------------

std::shared_ptr<Vehicle>
VehicleManager::get_vehicle(int sysid) const
{
    std::lock_guard<std::mutex> lock(mutex_);

    std::shared_ptr<Vehicle> found_dead = nullptr;
    for (const auto& [key, vehicle] : vehicles_)
    {
        if (vehicle && vehicle->sysid() == sysid)
        {
            if (vehicle->is_alive())
                return vehicle;
            found_dead = vehicle;
        }
    }
    return found_dead;
}

// ---------------------------------------------------------------------------
// get_vehicle_by_link()
//
// Returns the first live Vehicle whose current link_id matches the given
// link_id.  This is used by calibration modules to target a specific drone
// by the physical transport it is connected on, rather than by sysid.
//
// Flow:
//   CalibModule → get_vehicle_by_link(link_id)
//               → Vehicle.send_mavlink()
//               → LinkManager.send(link_id)
//               → Link.write_bytes()
//               → Transport → Drone
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// get_all_sysids()
//
// Returns the sysids of every vehicle that is currently alive in the
// registry.  Thread-safe — guarded by the same mutex_ used throughout.
// ---------------------------------------------------------------------------

std::vector<int> VehicleManager::get_all_sysids() const
{
    std::lock_guard<std::mutex> lock(mutex_);

    std::vector<int> result;
    result.reserve(vehicles_.size());

    for (const auto& [key, vehicle] : vehicles_)
    {
        if (vehicle && vehicle->is_alive())
            result.push_back(vehicle->sysid());
    }

    return result;
}

std::vector<int> VehicleManager::get_all_ui_sysids() const
{
    std::lock_guard<std::mutex> lock(mutex_);

    std::vector<int> result;
    result.reserve(vehicles_.size());

    for (const auto& [key, vehicle] : vehicles_)
    {
        if (vehicle && vehicle->is_alive())
            result.push_back(vehicle->ui_sysid());
    }

    return result;
}

std::shared_ptr<Vehicle>
VehicleManager::get_vehicle_by_ui_sysid(int ui_sysid) const
{
    std::lock_guard<std::mutex> lock(mutex_);

    for (const auto& [key, vehicle] : vehicles_)
    {
        if (vehicle && vehicle->is_alive() && vehicle->ui_sysid() == ui_sysid)
            return vehicle;
    }

    return nullptr;
}

// ---------------------------------------------------------------------------

std::shared_ptr<Vehicle>
VehicleManager::get_vehicle_by_link(int link_id) const
{
    std::lock_guard<std::mutex> lock(mutex_);

    for (const auto& [sysid, vehicle] : vehicles_)
    {
        if (vehicle && vehicle->is_alive() && vehicle->link_id() == link_id)
            return vehicle;
    }

    return nullptr;
}