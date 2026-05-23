/**
 * switch_manager.cpp
 * TiHANFly GCS — RC Switch Options Manager
 *
 * Place this file in:   Parameters/switch_manager.cpp
 * Matching header:      Parameters/switch_manager.h
 *
 * Add to CMakeLists.txt SOURCES:
 *   Parameters/switch_manager.cpp
 */

#include "switch_manager.h"

#include "../Vehicle/vehicle_manager.h"  // VehicleManager full definition
#include "../Vehicle/vehicle.h"          // Vehicle::send_mavlink, sysid, compid

#include <iostream>
#include <stdexcept>

// ─────────────────────────────────────────────────────────────────────────────
// GCS identity — must match the sysid/compid the drone expects from the GCS.
// Adjust if your main.cpp uses different values.
// ─────────────────────────────────────────────────────────────────────────────
static constexpr uint8_t GCS_SYSID  = 255;
static constexpr uint8_t GCS_COMPID = MAV_COMP_ID_MISSIONPLANNER;

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

SwitchManager::SwitchManager(VehicleManager* vehicle_manager)
    : vehicle_manager_(vehicle_manager)
{
    if (!vehicle_manager_)
        throw std::invalid_argument(
            "[SwitchManager] vehicle_manager must not be null");

    std::cout << "[SwitchManager] Initialised\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// set_switch_option()
//
// Primary entry point called by the UI when the user changes a dropdown.
//
// Flow:
//   1. Resolve the active vehicle (returns early if none is live).
//   2. Update pending_changes_ under the mutex.
//   3. Delegate the actual MAVLink encode + send to send_param_set().
//   4. Fire the optional on_write_ callback so the UI can update badges.
// ─────────────────────────────────────────────────────────────────────────────

void SwitchManager::set_switch_option(int channel, int option_value)
{
    // ── 1. Resolve active vehicle ────────────────────────────────────────────
    auto vehicle = vehicle_manager_->get_active_vehicle();
    if (!vehicle)
    {
        std::cerr << "[SwitchManager] No active vehicle — "
                     "cannot set RC" << channel << "_OPTION\n";
        return;
    }

    // ── 2. Stage the change ──────────────────────────────────────────────────
    {
        std::lock_guard<std::mutex> lock(mutex_);
        pending_changes_[channel] = option_value;
    }

    // ── 3. Build & send PARAM_SET ────────────────────────────────────────────
    send_param_set(channel, option_value, vehicle);

    // ── 4. Notify UI ─────────────────────────────────────────────────────────
    if (on_write_)
        on_write_(channel, make_param_name(channel), option_value);
}

// ─────────────────────────────────────────────────────────────────────────────
// write_all_pending()
//
// Sends a PARAM_SET for every staged change.  Designed for the "Write All"
// button in the Switch Options panel — the user edits several dropdowns,
// then submits them all at once.
//
// Returns the number of parameters sent (0 if no vehicle is live or the
// pending map is empty).
// ─────────────────────────────────────────────────────────────────────────────

int SwitchManager::write_all_pending()
{
    auto vehicle = vehicle_manager_->get_active_vehicle();
    if (!vehicle)
    {
        std::cerr << "[SwitchManager] No active vehicle — "
                     "cannot write pending changes\n";
        return 0;
    }

    // Take a snapshot so the lock isn't held across network calls.
    std::unordered_map<int, int> snapshot;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        snapshot = pending_changes_;
    }

    if (snapshot.empty())
    {
        std::cout << "[SwitchManager] write_all_pending: nothing to write\n";
        return 0;
    }

    int sent = 0;
    for (const auto& [channel, option_value] : snapshot)
    {
        send_param_set(channel, option_value, vehicle);

        if (on_write_)
            on_write_(channel, make_param_name(channel), option_value);

        ++sent;
    }

    std::cout << "[SwitchManager] Wrote " << sent
              << " pending RC switch option(s)\n";

    return sent;
}

// ─────────────────────────────────────────────────────────────────────────────
// request_param_read()
//
// Asks the drone to echo back the current value of RC<channel>_OPTION via a
// PARAM_VALUE response.  Wire a Vehicle message handler for
// MAVLINK_MSG_ID_PARAM_VALUE in main.cpp (or in ParameterManager) to consume
// the reply and update the UI.
// ─────────────────────────────────────────────────────────────────────────────

void SwitchManager::request_param_read(int channel) const
{
    auto vehicle = vehicle_manager_->get_active_vehicle();
    if (!vehicle)
    {
        std::cerr << "[SwitchManager] No active vehicle — "
                     "cannot request RC" << channel << "_OPTION\n";
        return;
    }

    const std::string param_name = make_param_name(channel);

    // Pad to exactly 16 chars as required by the MAVLink spec.
    char param_id[16] = {};
    param_name.copy(param_id, sizeof(param_id));

    mavlink_message_t msg;
    mavlink_msg_param_request_read_pack(
        GCS_SYSID,
        GCS_COMPID,
        &msg,
        static_cast<uint8_t>(vehicle->sysid()),
        static_cast<uint8_t>(vehicle->compid()),
        param_id,
        -1   // index = -1  →  look up by name
    );

    vehicle->send_mavlink(msg);

    std::cout << "[SwitchManager] Requested read of "
              << param_name << '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// clear_pending()
// ─────────────────────────────────────────────────────────────────────────────

void SwitchManager::clear_pending()
{
    std::lock_guard<std::mutex> lock(mutex_);
    const int n = static_cast<int>(pending_changes_.size());
    pending_changes_.clear();
    std::cout << "[SwitchManager] Cleared " << n
              << " pending change(s)\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// pending_count()
// ─────────────────────────────────────────────────────────────────────────────

int SwitchManager::pending_count() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return static_cast<int>(pending_changes_.size());
}

// ─────────────────────────────────────────────────────────────────────────────
// set_on_write()
// ─────────────────────────────────────────────────────────────────────────────

void SwitchManager::set_on_write(WriteCallback cb)
{
    std::lock_guard<std::mutex> lock(mutex_);
    on_write_ = std::move(cb);
}

// ─────────────────────────────────────────────────────────────────────────────
// make_param_name()  [private, static]
//
// Builds the ArduPilot parameter string for an RC switch channel.
//   channel=7  →  "RC7_OPTION"
//   channel=12 →  "RC12_OPTION"
// ─────────────────────────────────────────────────────────────────────────────

/*static*/
std::string SwitchManager::make_param_name(int channel)
{
    return "RC" + std::to_string(channel) + "_OPTION";
}

// ─────────────────────────────────────────────────────────────────────────────
// send_param_set()  [private]
//
// Encodes a MAVLink PARAM_SET and dispatches it through the Vehicle layer.
// This is the single place where the PARAM_SET wire format is constructed,
// keeping set_switch_option() and write_all_pending() DRY.
//
// ArduPilot expects RCx_OPTION to be sent as MAV_PARAM_TYPE_INT32 even though
// the MAVLink field is a float — the float bit-pattern encodes the integer.
// mavlink_msg_param_set_pack handles the cast correctly when you pass a float
// cast from an int, which is the standard GCS convention.
//
// Caller is responsible for ensuring `vehicle` is non-null.
// ─────────────────────────────────────────────────────────────────────────────

void SwitchManager::send_param_set(
    int                                   channel,
    int                                   option_value,
    const std::shared_ptr<Vehicle>&       vehicle)
{
    const std::string param_name = make_param_name(channel);

    // MAVLink param_id field: exactly 16 bytes, null-padded.
    char param_id[16] = {};
    param_name.copy(param_id, sizeof(param_id));

    // ArduPilot encodes integer parameters as a float carrying the raw int
    // bit-pattern.  This is the correct cast for MAV_PARAM_TYPE_INT32.
    const float param_value = static_cast<float>(option_value);

    mavlink_message_t msg;
    mavlink_msg_param_set_pack(
        GCS_SYSID,                                  // GCS system id
        GCS_COMPID,                                 // GCS component id
        &msg,
        static_cast<uint8_t>(vehicle->sysid()),     // target system
        static_cast<uint8_t>(vehicle->compid()),    // target component
        param_id,                                   // parameter name
        param_value,                                // value (int-as-float)
        MAV_PARAM_TYPE_INT32                        // type
    );

    // ── Dispatch through the Vehicle layer ──────────────────────────────────
    //
    //   Vehicle::send_mavlink()
    //     → LinkManager::send(link_id)
    //       → Link::write_bytes()
    //         → Transport::async_send()
    //           → Drone (ArduPilot)
    //
    vehicle->send_mavlink(msg);

    std::cout << "[SwitchManager] Set " << param_name
              << " = " << option_value
              << "  (sysid=" << vehicle->sysid()
              << " link_id=" << vehicle->link_id() << ")\n";
}