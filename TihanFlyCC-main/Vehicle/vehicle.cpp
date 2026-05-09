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
                 LinkManager* link_manager)
    : sysid_(sysid),
      compid_(compid),
      link_id_(link_id),
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

int Vehicle::sysid()   const { return sysid_;   }
int Vehicle::compid()  const { return compid_;  }

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