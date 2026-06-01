#include "vehicle.h"
#include "../Link/link_manager.h"   // full definition needed for send()
#include "../calibration/accel_calibration.h"
#include "../calibration/compass_calibration.h"
#include "../calibration/esc_calibration.h"
#include "../calibration/radio_calibration.h"

#include <iostream>

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

Vehicle::Vehicle(int sysid, int compid, int link_id,
                 LinkManager* link_manager, int ui_sysid)
    : sysid_(sysid),
      compid_(compid),
      link_id_(link_id),
      ui_sysid_(ui_sysid),
      link_manager_(link_manager),
      last_heartbeat_(std::chrono::steady_clock::now()),
      accel_calib_(std::make_unique<AccelCalibration>()),
      compass_calib_(std::make_unique<CompassCalibration>()),
      esc_calib_(std::make_unique<EscCalibration>()),
      radio_calib_(std::make_unique<RadioCalibration>())
{
    if (!link_manager_)
        throw std::invalid_argument(
            "[Vehicle] link_manager must not be null");

    // Inject this vehicle's identity into its calibration instances immediately.
    accel_calib_->setVehicleInfo(sysid_, compid_);
    compass_calib_->setVehicleInfo(sysid_, compid_);
    esc_calib_->setVehicleInfo(sysid_, compid_);
    radio_calib_->setVehicleInfo(sysid_, compid_);

    std::cout << "[Vehicle] Created sysid=" << sysid_
              << " link_id=" << link_id_ << '\n';
}

// ---------------------------------------------------------------------------
// Destruction
//
// Defined here (not in the header) so that unique_ptr<AccelCalibration>'s
// deleter is instantiated in this TU, where AccelCalibration is a complete
// type.  vehicle.h only forward-declares it.
// ---------------------------------------------------------------------------

Vehicle::~Vehicle() = default;

// ---------------------------------------------------------------------------
// Identity accessors
// ---------------------------------------------------------------------------

int Vehicle::sysid()    const { return sysid_;    }
int Vehicle::compid()   const { return compid_;   }
int Vehicle::ui_sysid() const { return ui_sysid_; }

int Vehicle::link_id() const
{
    std::lock_guard<std::mutex> lock(link_id_mtx_);
    return link_id_;
}

// ---------------------------------------------------------------------------
// Runtime link switching
//
// Called from main.cpp whenever the active transport changes (Serial ↔ UDP).
// All subsequent send_mavlink() calls will use the updated link_id.
// ---------------------------------------------------------------------------

void Vehicle::set_link_id(int new_link_id)
{
    std::lock_guard<std::mutex> lock(link_id_mtx_);
    if (link_id_ != new_link_id)
    {
        std::cout << "[Vehicle] link_id changed: " << link_id_
                  << " → " << new_link_id << '\n';
        link_id_ = new_link_id;
    }
}

// ---------------------------------------------------------------------------
// Inbound path
// ---------------------------------------------------------------------------

void Vehicle::process_message(const mavlink_message_t& msg)
{
    if (msg.msgid == MAVLINK_MSG_ID_HEARTBEAT)
        update_heartbeat();

    // Always update the telemetry cache, then dispatch to registered handlers
    update_telemetry(msg);

    std::vector<MessageHandler> handlers_copy;
    {
        std::lock_guard<std::mutex> lock(handlers_mtx_);
        auto it = handlers_.find(msg.msgid);
        if (it != handlers_.end())
            handlers_copy = it->second;
    }

    for (auto& handler : handlers_copy)
        handler(msg);
}

// ---------------------------------------------------------------------------
// Telemetry cache update
// Decodes inbound MAVLink frames that carry state we want to expose via
// the accessor methods below.  All writes are protected by telem_mtx_.
// ---------------------------------------------------------------------------

static const char* copter_mode_name(uint32_t custom_mode)
{
    static const char* names[] = {
        "STABILIZE",    // 0
        "ACRO",         // 1
        "ALT_HOLD",     // 2
        "AUTO",         // 3
        "GUIDED",       // 4
        "LOITER",       // 5
        "RTL",          // 6
        "CIRCLE",       // 7
        "POSITION",     // 8  (deprecated)
        "LAND",         // 9
        "OF_LOITER",    // 10 (deprecated)
        "DRIFT",        // 11
        "RESERVED_12",  // 12 (unused)
        "SPORT",        // 13
        "FLIP",         // 14
        "AUTOTUNE",     // 15
        "POSHOLD",      // 16
        "BRAKE",        // 17
        "THROW",        // 18
        "AVOID_ADSB",   // 19
        "GUIDED_NOGPS", // 20
        "SMART_RTL",    // 21
        "FLOWHOLD",     // 22
        "FOLLOW",       // 23
        "ZIGZAG",       // 24
        "SYSTEMID",     // 25
        "AUTOROTATE",   // 26
        "AUTO_RTL",     // 27
        "TURTLE",       // 28
        "RATE_ACRO"     // 29
    };
    if (custom_mode < sizeof(names)/sizeof(names[0]))
        return names[custom_mode];
    return "UNKNOWN";
}

void Vehicle::update_telemetry(const mavlink_message_t& msg)
{
    switch (msg.msgid)
    {
    case MAVLINK_MSG_ID_HEARTBEAT:
    {
        mavlink_heartbeat_t hb;
        mavlink_msg_heartbeat_decode(&msg, &hb);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        telem_.armed = (hb.base_mode & MAV_MODE_FLAG_SAFETY_ARMED) != 0;
        telem_.mode  = copter_mode_name(hb.custom_mode);
        break;
    }
    case MAVLINK_MSG_ID_SYS_STATUS:
    {
        mavlink_sys_status_t ss;
        mavlink_msg_sys_status_decode(&msg, &ss);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        if (ss.voltage_battery != UINT16_MAX)
            telem_.battery_v = ss.voltage_battery / 1000.f;
        if (ss.battery_remaining >= 0)
            telem_.battery_pct = ss.battery_remaining;
        break;
    }
    case MAVLINK_MSG_ID_BATTERY_STATUS:
    {
        mavlink_battery_status_t bs;
        mavlink_msg_battery_status_decode(&msg, &bs);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        if (bs.battery_remaining >= 0)
            telem_.battery_pct = bs.battery_remaining;
        float total = 0.f; int n = 0;
        for (int i = 0; i < 10; ++i)
            if (bs.voltages[i] != UINT16_MAX) { total += bs.voltages[i]; ++n; }
        if (n > 0) telem_.battery_v = total / 1000.f;
        break;
    }
    case MAVLINK_MSG_ID_ATTITUDE:
    {
        mavlink_attitude_t att;
        mavlink_msg_attitude_decode(&msg, &att);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        telem_.roll  = att.roll;
        telem_.pitch = att.pitch;
        telem_.yaw_rad = att.yaw;
        break;
    }
    case MAVLINK_MSG_ID_GLOBAL_POSITION_INT:
    {
        mavlink_global_position_int_t gp;
        mavlink_msg_global_position_int_decode(&msg, &gp);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        telem_.lat     = gp.lat / 1e7;
        telem_.lon     = gp.lon / 1e7;
        telem_.alt_msl = gp.alt  / 1000.f;
        break;
    }
    case MAVLINK_MSG_ID_GPS_RAW_INT:
    {
        mavlink_gps_raw_int_t gps;
        mavlink_msg_gps_raw_int_decode(&msg, &gps);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        telem_.gps_fix  = gps.fix_type;
        telem_.num_sats = gps.satellites_visible;
        if (gps.fix_type >= 2) {
            telem_.lat     = gps.lat / 1e7;
            telem_.lon     = gps.lon / 1e7;
            telem_.alt_msl = gps.alt  / 1000.f;
        }
        break;
    }
    case MAVLINK_MSG_ID_VFR_HUD:
    {
        mavlink_vfr_hud_t hud;
        mavlink_msg_vfr_hud_decode(&msg, &hud);
        std::lock_guard<std::mutex> lk(telem_mtx_);
        telem_.alt_msl = hud.alt;   // barometric alt — prefer over GPS MSL
        telem_.speed = hud.groundspeed;
        break;
    }
    default:
        break;
    }
}

void Vehicle::update_heartbeat()
{
    std::lock_guard<std::mutex> lock(heartbeat_mtx_);
    last_heartbeat_ = std::chrono::steady_clock::now();
}

// ---------------------------------------------------------------------------
// Outbound path
//
//   Vehicle.send_mavlink()
//         │
//         ▼
//   LinkManager.send(link_id)   ← routes to the link this vehicle is on
//         │
//         ▼
//   Link.write_bytes(buf, len)
//         │
//         ▼
//   Transport (UDP / Serial)
//         │
//         ▼
//   Drone (ArduPilot)
//
// link_id_ is set at construction and updated by set_link_id() whenever
// the active transport changes (Serial ↔ UDP failover).
// ---------------------------------------------------------------------------

void Vehicle::send_mavlink(const mavlink_message_t& msg)
{
    uint8_t buf[MAVLINK_MAX_PACKET_LEN];
    const uint16_t len = mavlink_msg_to_send_buffer(buf, &msg);

    int lid;
    {
        std::lock_guard<std::mutex> lock(link_id_mtx_);
        lid = link_id_;
    }

    // LinkManager.send(lid) → Link.write_bytes() → Transport → Drone
    link_manager_->send(lid, buf, len);
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

void Vehicle::register_handler(uint32_t msgid, MessageHandler handler)
{
    std::lock_guard<std::mutex> lock(handlers_mtx_);
    handlers_[msgid].push_back(std::move(handler));
}

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

bool Vehicle::is_alive() const
{
    std::lock_guard<std::mutex> lock(heartbeat_mtx_);
    return (std::chrono::steady_clock::now() - last_heartbeat_)
           < std::chrono::seconds(5);
}

// ---------------------------------------------------------------------------
// Telemetry accessors
// ---------------------------------------------------------------------------

bool Vehicle::is_armed() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.armed;
}

std::string Vehicle::flight_mode_string() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.mode;
}

int Vehicle::battery_remaining() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.battery_pct;
}

float Vehicle::battery_voltage() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.battery_v;
}

uint8_t Vehicle::gps_fix_type() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.gps_fix;
}

uint8_t Vehicle::gps_satellites() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.num_sats;
}

double Vehicle::latitude() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.lat;
}

double Vehicle::longitude() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.lon;
}

float Vehicle::altitude_msl() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.alt_msl;
}

float Vehicle::roll() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.roll;
}

float Vehicle::pitch() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.pitch;
}

float Vehicle::yaw() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.yaw_rad;
}

float Vehicle::speed() const
{
    std::lock_guard<std::mutex> lk(telem_mtx_);
    return telem_.speed;
}

AccelCalibration& Vehicle::accel_calib()
{
    return *accel_calib_;
}

CompassCalibration& Vehicle::compass_calib()
{
    return *compass_calib_;
}

EscCalibration& Vehicle::esc_calib()
{
    return *esc_calib_;
}

RadioCalibration& Vehicle::radio_calib()
{
    return *radio_calib_;
}