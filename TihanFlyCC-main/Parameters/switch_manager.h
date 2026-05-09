#pragma once
/**
 * switch_manager.h
 * TiHANFly GCS — RC Switch Options Manager
 *
 * Translates UI dropdown selections into MAVLink PARAM_SET commands
 * for RC switch option parameters (RC5_OPTION … RC16_OPTION).
 *
 * Data flow:
 *   UI → SwitchManager::set_switch_option()
 *      → VehicleManager::get_active_vehicle()
 *      → Vehicle::send_mavlink()
 *      → LinkManager::send()
 *      → Link::write_bytes()
 *      → Transport (UDP / Serial)
 *      → Drone (ArduPilot)
 *
 * Design notes:
 *   • No direct Transport or Link access — all outbound traffic goes
 *     through Vehicle::send_mavlink(), matching the rest of the GCS.
 *   • VehicleManager pointer is non-owning; it must outlive this object.
 *   • Pending changes are stored in pending_changes_ so they can be
 *     inspected or batch-written later without re-querying the UI.
 *   • All public methods are thread-safe (guarded by mutex_).
 *
 * Optional future extensions (stubs provided in .cpp):
 *   • write_all_pending()  — batch-write every dirty entry in one pass.
 *   • clear_pending()      — discard all staged changes.
 *   • request_param_read() — send PARAM_REQUEST_READ so the GCS can
 *                            confirm the value the drone currently holds.
 */

#include <mavlink/ardupilotmega/mavlink.h>

#include <functional>
#include <mutex>
#include <memory>
#include <string>
#include <unordered_map>

// Forward declaration — we only need a pointer here.
class VehicleManager;

class SwitchManager
{
public:
    // -----------------------------------------------------------------------
    // Construction
    //
    // vehicle_manager must remain valid for the entire lifetime of this
    // SwitchManager.  Pass the same VehicleManager that owns the live drone.
    // -----------------------------------------------------------------------
    explicit SwitchManager(VehicleManager* vehicle_manager);

    // -----------------------------------------------------------------------
    // set_switch_option()
    //
    // Immediately encodes and sends a MAVLink PARAM_SET for the parameter
    // "RC<channel>_OPTION" with the given integer option value.
    //
    // Parameters:
    //   channel      — RC channel number (5–16 for ArduPilot switch options)
    //   option_value — ArduPilot RCx_OPTION enum value (e.g. 41 = ArmDisarm)
    //
    // Behaviour:
    //   • Gets the active vehicle via VehicleManager.
    //   • Logs an error and returns immediately if no vehicle is live.
    //   • Stores the (channel → option_value) pair in pending_changes_ so
    //     the UI can reflect confirmed-vs-pending state.
    //   • Constructs and sends a PARAM_SET message (MAV_PARAM_TYPE_INT32).
    //   • Thread-safe — acquires mutex_ for the pending map update.
    // -----------------------------------------------------------------------
    void set_switch_option(int channel, int option_value);

    // -----------------------------------------------------------------------
    // write_all_pending()
    //
    // Sends a PARAM_SET for every (channel, value) pair currently stored
    // in pending_changes_.  Useful when the user clicks "Write All" in the
    // Switch Options panel after staging several changes.
    //
    // Returns the number of parameters actually sent (0 if no vehicle live).
    // -----------------------------------------------------------------------
    int write_all_pending();

    // -----------------------------------------------------------------------
    // request_param_read()
    //
    // Sends a PARAM_REQUEST_READ for "RC<channel>_OPTION".  The drone will
    // respond with a PARAM_VALUE message which the ParameterManager (or a
    // registered Vehicle handler) can use to confirm the written value.
    // -----------------------------------------------------------------------
    void request_param_read(int channel);

    // -----------------------------------------------------------------------
    // clear_pending()
    //
    // Discards all staged (not-yet-confirmed) changes without sending them.
    // Called when the user clicks "Revert" in the UI.
    // -----------------------------------------------------------------------
    void clear_pending();

    // -----------------------------------------------------------------------
    // pending_count()
    //
    // Returns the number of channels with staged-but-not-yet-confirmed
    // changes.  Drives the dirty-count badge in the UI footer.
    // -----------------------------------------------------------------------
    int pending_count() const;

    // -----------------------------------------------------------------------
    // on_write_complete callback (optional)
    //
    // Set this to receive a notification whenever a PARAM_SET is actually
    // dispatched.  Useful for updating UI badges.
    //   channel      — RC channel number
    //   param_name   — e.g. "RC7_OPTION"
    //   option_value — value that was sent
    // -----------------------------------------------------------------------
    using WriteCallback =
        std::function<void(int channel,
                           const std::string& param_name,
                           int option_value)>;

    void set_on_write(WriteCallback cb);

private:
    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    // Builds the ArduPilot parameter name for the given RC channel.
    // e.g. channel=7 → "RC7_OPTION"
    static std::string make_param_name(int channel);

    // Core send logic — shared by set_switch_option() and write_all_pending().
    // Caller must hold vehicle → this method does NOT lock mutex_ itself.
    void send_param_set(int                           channel,
                        int                           option_value,
                        const std::shared_ptr<class Vehicle>& vehicle);

    // -----------------------------------------------------------------------
    // Members
    // -----------------------------------------------------------------------
    VehicleManager* vehicle_manager_;   // non-owning; never null after ctor

    // Staged changes: channel → option_value
    // Updated by set_switch_option(); consumed by write_all_pending().
    std::unordered_map<int, int> pending_changes_;
    mutable std::mutex           mutex_;

    WriteCallback on_write_;
};