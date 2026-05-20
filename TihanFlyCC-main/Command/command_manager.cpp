/**
 * command_manager.cpp
 * TiHANFly GCS — Command queue and mission upload
 *
 * Routing modes — see command_manager.h for full description.
 *
 *   Mode A  set_vehicle_direct(Vehicle*)
 *     execute() → vehicle->send_mavlink()
 *     Available for single-vehicle builds that manage their own Vehicle.
 *
 *   Mode B  set_vehicle_manager(VehicleManager*)   ← ACTIVE MODE
 *     execute() → vehicle_manager_->get_active_vehicle() → vehicle->send_mavlink()
 *     No sysid is needed — the Vehicle object already carries sysid, compid,
 *     link_id, and a LinkManager pointer.
 *     VehicleManager discovers vehicles automatically from HEARTBEAT frames.
 *
 * Pipeline (Mode B):
 *   CommandManager::execute()
 *     → resolve_vehicle()                          (sysid-free lookup)
 *       → VehicleManager::get_active_vehicle()     (first live vehicle)
 *         → Vehicle::send_mavlink()                (serialize)
 *           → LinkManager::send(link_id_)          (route to link)
 *             → Link → Transport → Drone
 *
 * resolve_vehicle() encapsulates mode selection so execute() stays clean and
 * sysid-free.
 *
 * Mission upload still calls active_transport->async_send() directly because
 * the MAVLink mission protocol is a stateful handshake sequence that does
 * not map cleanly onto single Vehicle::send_mavlink() calls.
 *
 * Thread safety:
 *   add_command() and process() acquire queue_mutex_ so they are safe to
 *   call from multiple threads (e.g. per-client WebSocket threads).
 */

#include "command_manager.h"
#include "Vehicle/vehicle.h"          // needed for send_mavlink()
#include "Vehicle/vehicle_manager.h"  // needed for get_active_vehicle()

#include <unordered_map>
#include <iostream>
#include <nlohmann/json.hpp>
#include "mavlink/ardupilotmega/mavlink.h"

using json = nlohmann::json;

// ═══════════════════════════════════════════════════════════════════════════════
CommandManager::CommandManager() = default;

// ───────────────────────────────────────────────────────────────────────────────
//  Routing configuration
// ───────────────────────────────────────────────────────────────────────────────

void CommandManager::set_vehicle_direct(Vehicle* vehicle)
{
    direct_vehicle_  = vehicle;
    vehicle_manager_ = nullptr;   // clear Mode B so only one mode is active
}

// No sysid parameter — the Vehicle object itself carries all identity info.
void CommandManager::set_vehicle_manager(VehicleManager* vm)
{
    vehicle_manager_ = vm;
    direct_vehicle_  = nullptr;   // clear Mode A so only one mode is active
}

// removed set_active_vehicle

void CommandManager::set_transport(std::shared_ptr<Transport> transport)
{
    active_transport = transport;
}

// ───────────────────────────────────────────────────────────────────────────────
//  resolve_vehicle()
//
//  Returns the target Vehicle* without requiring any sysid from the caller.
//
//  Mode A — direct_vehicle_ is set by set_vehicle_direct():
//    Return it as-is.
//
//  Mode B — vehicle_manager_ is set by set_vehicle_manager():
//    Delegate to VehicleManager::get_active_vehicle() which returns the first
//    live vehicle it knows about.  The Vehicle object already stores sysid,
//    compid, link_id, and the LinkManager pointer, so the routing chain
//    needs nothing extra from CommandManager.
//
//    Returns nullptr and logs a warning if:
//      • No vehicle has been discovered yet (waiting for first HEARTBEAT), or
//      • All known vehicles have timed out (VehicleManager evicted them).
// ───────────────────────────────────────────────────────────────────────────────

Vehicle* CommandManager::resolve_vehicle(const Command& cmd) const
{
    // ── Command-specific override ─────────────────────────────────────────────
    if (cmd.target_vehicle)
    {
        return cmd.target_vehicle.get();
    }

    // ── Mode A: direct pointer ────────────────────────────────────────────────
    if (direct_vehicle_)
        return direct_vehicle_;

    // ── Mode B: first live vehicle from VehicleManager ───────────────────────
    if (vehicle_manager_)
    {
        auto v = vehicle_manager_->get_active_vehicle();
        if (!v)
        {
            std::cout << "[Command] ERROR: VehicleManager has no live vehicle"
                         " yet (waiting for first HEARTBEAT?)\n";
            return nullptr;
        }
        return v.get();
    }

    std::cout << "[Command] ERROR: no routing configured —"
                 " call set_vehicle_direct() or set_vehicle_manager()\n";
    return nullptr;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Command queue  (thread-safe)
// ═══════════════════════════════════════════════════════════════════════════════

void CommandManager::add_command(int id, const std::string& cmd_name,
                                  float p1, float p2,
                                  const std::string& mode,
                                  std::shared_ptr<Vehicle> target)
{
    std::lock_guard<std::mutex> lock(queue_mutex_);
    queue_.push({id, cmd_name, p1, p2, mode, target});
}

void CommandManager::process()
{
    // Drain the queue under the lock so concurrent add_command() calls on
    // other threads can't interleave with our drain.
    std::queue<Command> local;
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        std::swap(local, queue_);
    }

    // Execute outside the lock — execute() may take non-trivial time and
    // we don't want to block producers for the duration.
    while (!local.empty())
    {
        Command cmd = local.front();
        local.pop();
        execute(cmd);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  execute()
//
//  Pipeline (Mode B):
//    CommandManager::execute()
//      → resolve_vehicle()
//          → VehicleManager::get_active_vehicle()   (sysid-free)
//      → Vehicle::send_mavlink()                    (serialize + hand off)
//      → LinkManager::send(link_id_)
//      → Link → Transport → Drone
//
//  CommandManager never touches Transport for normal commands.
// ═══════════════════════════════════════════════════════════════════════════════

void CommandManager::execute(const Command& cmd)
{
    std::cout << "[Command] Executing: " << cmd.name << "\n";

    if (cmd.name.empty())
    {
        std::cout << "[Command] WARNING: empty command name — skipping\n";
        return;
    }

    // Resolve the target vehicle before building the message so we can bail
    // early without packing a MAVLink frame we won't send.
    //
    // In Mode B this calls VehicleManager::get_active_vehicle() and returns
    // the raw pointer to the first live Vehicle.  The shared_ptr keeping that
    // Vehicle alive is held by VehicleManager, which outlives this call.
    Vehicle* vehicle = resolve_vehicle(cmd);
    if (!vehicle)
        return;

    // Read sysid / compid from the Vehicle itself so we never hard-code them.
    const uint8_t target_sysid  = static_cast<uint8_t>(vehicle->sysid());
    const uint8_t target_compid = static_cast<uint8_t>(vehicle->compid());

    // ── Build MAVLink message ────────────────────────────────────────────────
    mavlink_message_t message{};

    if (cmd.name == "ARM")
    {
        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_COMPONENT_ARM_DISARM,
            0, 1.0f, 0.0f, 0, 0, 0, 0, 0);
    }
    else if (cmd.name == "FORCE_ARM")
    {
        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_COMPONENT_ARM_DISARM,
            0, 1.0f, 21196.0f, 0, 0, 0, 0, 0);
    }
    else if (cmd.name == "DISARM")
    {
        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_COMPONENT_ARM_DISARM,
            0, 0.0f, 0.0f, 0, 0, 0, 0, 0);
    }
    else if (cmd.name == "TAKEOFF")
    {
        float altitude = cmd.param1 > 0 ? cmd.param1 : 10.0f;
        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_NAV_TAKEOFF,
            0, 0, 0, 0, 0, 0, 0, altitude);
        std::cout << "[Command] Takeoff altitude: " << altitude << "m\n";
    }
    else if (cmd.name == "LAND")
    {
        // Use DO_SET_MODE to explicitly set the mode to LAND (9) instead of NAV_LAND 
        // to avoid unintended mode mapping side-effects (e.g. DRIFT).
        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_DO_SET_MODE,
            0,
            MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            9.0f,  // ArduCopter LAND mode
            0, 0, 0, 0, 0);
    }
    else if (cmd.name == "RTL")
    {
        // Use DO_SET_MODE to explicitly set the mode to RTL (6) instead of NAV_RETURN_TO_LAUNCH
        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_DO_SET_MODE,
            0,
            MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            6.0f,  // ArduCopter RTL mode
            0, 0, 0, 0, 0);
    }
    else if (cmd.name == "SET_MODE")
    {
        // ArduCopter custom mode numbers
        // https://ardupilot.org/copter/docs/flight-modes.html
        static const std::unordered_map<std::string, int> MODE_MAP = {
            {"STABILIZE",     0},
            {"Stabilize",     0},
            {"ACRO",          1},
            {"Acro",          1},
            {"ALT_HOLD",      2},
            {"Altitude Hold", 2},
            {"Alt Hold",      2},
            {"AUTO",          3},
            {"Auto",          3},
            {"GUIDED",        4},
            {"Guided",        4},
            {"LOITER",        5},
            {"Loiter",        5},
            {"RTL",           6},
            {"CIRCLE",        7},
            {"Circle",        7},
            {"LAND",          9},
            {"Land",          9},
            {"DRIFT",         11},
            {"Drift",         11},
            {"SPORT",         13},
            {"Sport",         13},
            {"FLIP",          14},
            {"Flip",          14},
            {"AUTOTUNE",      15},
            {"AutoTune",      15},
            {"POSHOLD",       16},
            {"Position Hold", 16},
            {"Position",      16},
            {"Pos Hold",      16},
            {"BRAKE",         17},
            {"Brake",         17},
            {"THROW",         18},
            {"Throw",         18},
            {"AVOID_ADSB",    19},
            {"Avoid ADSB",    19},
            {"GUIDED_NOGPS",  20},
            {"Guided No GPS", 20},
            {"SMART_RTL",     21},
            {"Smart RTL",     21},
            {"FLOWHOLD",      22},
            {"Flow Hold",     22},
            {"FOLLOW",        23},
            {"Follow",        23},
            {"Follow Me",     23},
            {"ZIGZAG",        24},
            {"Zigzag",        24},
            {"ZigZag",        24},
            {"SYSTEMID",      25},
            {"System ID",     25},
            {"AUTOROTATE",    26},
            {"Heli Autorotate", 26},
            {"AUTO_RTL",      27},
            {"Auto RTL",      27},
        };

        int custom_mode = 0;
        auto it = MODE_MAP.find(cmd.mode_name);
        if (it != MODE_MAP.end())
            custom_mode = it->second;
        else
            std::cout << "[Command] Unknown mode: " << cmd.mode_name << "\n";

        std::cout << "[Command] Setting mode: " << cmd.mode_name
                  << " (custom_mode=" << custom_mode << ")\n";

        mavlink_msg_command_long_pack(
            255, 200, &message,
            target_sysid, target_compid,
            MAV_CMD_DO_SET_MODE,
            0,
            MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            static_cast<float>(custom_mode),
            0, 0, 0, 0, 0);
    }
    else
    {
        std::cout << "[Command] Unknown command: " << cmd.name << "\n";
        return;
    }

    // ── Dispatch through the Vehicle layer ───────────────────────────────────
    //
    // Vehicle::send_mavlink()   ← serialize the mavlink_message_t to bytes
    //   → LinkManager::send(link_id_)
    //     → Link::get_transport()->async_send()
    //       → Transport (UDP / Serial)
    //         → Drone
    //
    // CommandManager does NOT touch Transport here.
    vehicle->send_mavlink(message);

    // ── Fire response callback → WebSocket / UI ──────────────────────────────
    if (response_callback_)
    {
        json res;
        res["type"]    = "response";
        res["command"] = cmd.name;
        res["status"]  = "success";
        res["message"] = "Command executed";
        if (cmd.name == "TAKEOFF")
            res["altitude"] = cmd.param1 > 0 ? cmd.param1 : 10.0f;
        response_callback_(res.dump());
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Mission upload  (direct transport — low-level MAVLink mission protocol)
//
//  This is the only place CommandManager talks to Transport directly.
//  The mission protocol is a stateful handshake:
//    GCS → MISSION_COUNT
//    Drone → MISSION_REQUEST(seq)  … repeated per item …
//    GCS → MISSION_ITEM(seq)
//    Drone → MISSION_ACK
//  This sequence cannot be expressed as independent Vehicle::send_mavlink()
//  calls, so bypassing the Vehicle layer here is intentional and correct.
// ═══════════════════════════════════════════════════════════════════════════════

void CommandManager::upload_mission(int                              request_id,
                                     const std::vector<WaypointItem>& waypoints,
                                     uint8_t target_sysid,
                                     uint8_t target_compid,
                                     Vehicle* vehicle)
{
    // When a Vehicle* is supplied, we route through its link (multi-vehicle).
    // Otherwise we require active_transport (legacy serial path).
    if (!vehicle && !active_transport)
    {
        std::cout << "[Mission] ERROR: no active transport and no target vehicle — "
                     "call set_transport() or pass a Vehicle* to upload_mission()\n";
        if (response_callback_)
        {
            json res;
            res["type"]    = "mission_ack";
            res["id"]      = request_id;
            res["status"]  = "error";
            res["message"] = "No active transport";
            response_callback_(res.dump());
        }
        return;
    }

    if (mission_in_progress_.exchange(true))
    {
        std::cout << "[Mission] Upload already in progress\n";
        return;
    }

    pending_mission_       = waypoints;
    mission_request_id_    = request_id;
    mission_target_sysid_  = target_sysid;
    mission_target_compid_ = target_compid;
    mission_target_vehicle_ = vehicle;   // nullptr → use active_transport
    std::cout << "[Mission] Starting upload of "
              << waypoints.size() << " waypoints to sysid=" << (int)target_sysid
              << (vehicle ? " (via vehicle link)" : " (via active_transport)") << "\n";
    send_mission_count();
}

void CommandManager::send_mission_count()
{
    mavlink_message_t msg;
    mavlink_msg_mission_count_pack(
        255, 200, &msg, mission_target_sysid_, mission_target_compid_,
        static_cast<uint16_t>(pending_mission_.size()),
        MAV_MISSION_TYPE_MISSION, 0);

    if (mission_target_vehicle_)
    {
        // Multi-vehicle path: route through the vehicle's own link/transport
        mission_target_vehicle_->send_mavlink(msg);
    }
    else
    {
        uint8_t  buf[MAVLINK_MAX_PACKET_LEN];
        uint16_t len = mavlink_msg_to_send_buffer(buf, &msg);
        active_transport->async_send(buf, len);
    }
    std::cout << "[Mission] Sent MISSION_COUNT=" << pending_mission_.size() << "\n";
}

void CommandManager::send_mission_item(uint16_t seq)
{
    if (seq >= pending_mission_.size()) return;

    const WaypointItem& wp = pending_mission_[seq];

    // ── ArduPilot requires MISSION_ITEM_INT (msg 73), NOT MISSION_ITEM (msg 39) ──
    // Newer firmware rejects MISSION_ITEM with "GCS should send MISSION_ITEM_INT"
    // and cancels the upload.  MISSION_ITEM_INT encodes lat/lon as int32_t × 1e7
    // (degrees × 10^7) instead of float, giving sub-centimetre precision.
    // Altitude (z) remains a plain float in metres.
    mavlink_message_t msg;
    mavlink_msg_mission_item_int_pack(
        255, 200, &msg,
        mission_target_sysid_, mission_target_compid_,            // target_system, target_component
        seq,
        wp.frame,
        wp.command,
        (seq == 0) ? 1 : 0,                       // current=1 for home/first item
        wp.autocontinue ? 1 : 0,
        wp.hold_time, 0.f, 0.f, 0.f,             // param1-4
        static_cast<int32_t>(wp.lat * 1e7),       // x = lat × 1e7  (int32)
        static_cast<int32_t>(wp.lng * 1e7),       // y = lng × 1e7  (int32)
        wp.altitude,                               // z = altitude (float, metres)
        MAV_MISSION_TYPE_MISSION);

    if (mission_target_vehicle_)
    {
        // Multi-vehicle path: route through the vehicle's own link/transport
        mission_target_vehicle_->send_mavlink(msg);
    }
    else
    {
        uint8_t  buf[MAVLINK_MAX_PACKET_LEN];
        uint16_t len = mavlink_msg_to_send_buffer(buf, &msg);
        active_transport->async_send(buf, len);
    }

    std::cout << "[Mission] Sent ITEM_INT seq=" << seq
              << " cmd=" << wp.command
              << " lat=" << wp.lat
              << " lng=" << wp.lng
              << " alt=" << wp.altitude << "\n";
}


void CommandManager::on_mission_request(uint16_t seq)
{
    std::cout << "[Mission] MISSION_REQUEST seq=" << seq << "\n";
    if (!mission_in_progress_) return;
    send_mission_item(seq);
}

void CommandManager::on_mission_ack(uint8_t type)
{
    std::cout << "[Mission] MISSION_ACK type=" << static_cast<int>(type) << "\n";
    mission_in_progress_    = false;
    mission_target_vehicle_ = nullptr;  // release vehicle reference

    if (response_callback_)
    {
        json res;
        res["type"]    = "mission_ack";
        res["id"]      = mission_request_id_;
        res["status"]  = (type == MAV_MISSION_ACCEPTED) ? "success" : "error";
        res["message"] = (type == MAV_MISSION_ACCEPTED)
                         ? "Mission uploaded successfully"
                         : "Mission upload failed (ack=" +
                               std::to_string(static_cast<int>(type)) + ")";
        response_callback_(res.dump());
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
void CommandManager::set_response_callback(
    std::function<void(const std::string&)> cb)
{
    response_callback_ = cb;
}