#include <gtest/gtest.h>
#include <gmock/gmock.h>
#define private public
#define protected public
#include "Vehicle/vehicle.h"
#include "Vehicle/vehicle_manager.h"
#include "Link/link_manager.h"
#include <mavlink/ardupilotmega/mavlink.h>
#include <thread>
#include <chrono>

using namespace testing;

class VehicleTest : public Test {
protected:
    asio::io_context io;
    std::unique_ptr<LinkManager> link_manager;
    std::unique_ptr<VehicleManager> manager;

    void SetUp() override {
        link_manager = std::make_unique<LinkManager>();
        manager = std::make_unique<VehicleManager>(link_manager.get());
    }

    mavlink_message_t create_heartbeat(int sysid = 1) {
        mavlink_message_t msg;
        mavlink_msg_heartbeat_pack(sysid, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
        return msg;
    }
};

// UT-VEH-001: Initialization & Empty State
TEST_F(VehicleTest, InitializationAndEmptyState) {
    EXPECT_EQ(manager->get_active_vehicle(), nullptr);
    EXPECT_TRUE(manager->get_all_sysids().empty());
}

// UT-VEH-002: Vehicle Discovery via HEARTBEAT
TEST_F(VehicleTest, VehicleDiscovery) {
    int discovered_sysid = 0;
    manager->set_on_new_vehicle([&](std::shared_ptr<Vehicle> v) {
        discovered_sysid = v->sysid();
    });

    mavlink_message_t msg = create_heartbeat(42);
    manager->handle_message(msg, 0);

    EXPECT_EQ(discovered_sysid, 42);
    auto active_vehicle = manager->get_active_vehicle();
    ASSERT_NE(active_vehicle, nullptr);
    EXPECT_EQ(active_vehicle->sysid(), 42);
    EXPECT_EQ(active_vehicle->ui_sysid(), 42); // first vehicle gets ui sysid = sysid
}

// UT-VEH-003: Inbound Telemetry Processing
TEST_F(VehicleTest, InboundTelemetryProcessing) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    
    // SYS_STATUS for battery
    mavlink_message_t sys_msg;
    mavlink_msg_sys_status_pack(1, 1, &sys_msg, 0, 0, 0, 500, 11500, -1, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    v->process_message(sys_msg);
    EXPECT_EQ(v->battery_remaining(), 50);
    EXPECT_FLOAT_EQ(v->battery_voltage(), 11.5f);

    // GPS_RAW_INT for location
    mavlink_message_t gps_msg;
    mavlink_msg_gps_raw_int_pack(1, 1, &gps_msg, 0, 3, 400000000, -730000000, 100000, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0);
    v->process_message(gps_msg);
    EXPECT_EQ(v->gps_fix_type(), 3);
    EXPECT_EQ(v->gps_satellites(), 10);
    EXPECT_DOUBLE_EQ(v->latitude(), 40.0);
    EXPECT_DOUBLE_EQ(v->longitude(), -73.0);
    EXPECT_FLOAT_EQ(v->altitude_msl(), 100.0f);

    // BATTERY_STATUS
    mavlink_message_t bat_msg;
    uint16_t voltages[10] = {3800, 3800, 3800, UINT16_MAX, UINT16_MAX, UINT16_MAX, UINT16_MAX, UINT16_MAX, UINT16_MAX, UINT16_MAX};
    mavlink_msg_battery_status_pack(1, 1, &bat_msg, 0, 0, 0, 0, voltages, -1, -1, -1, 40, 0, 0, 0, 0, 0);
    v->process_message(bat_msg);
    EXPECT_EQ(v->battery_remaining(), 40);
    EXPECT_FLOAT_EQ(v->battery_voltage(), 11.4f);

    // GLOBAL_POSITION_INT
    mavlink_message_t gp_msg;
    mavlink_msg_global_position_int_pack(1, 1, &gp_msg, 0, 400000000, -730000000, 100000, 0, 0, 0, 0, 0);
    v->process_message(gp_msg);
    EXPECT_DOUBLE_EQ(v->latitude(), 40.0);

    // VFR_HUD
    mavlink_message_t hud_msg;
    mavlink_msg_vfr_hud_pack(1, 1, &hud_msg, 0, 0, 0, 0, 50.0f, 0);
    v->process_message(hud_msg);
    EXPECT_FLOAT_EQ(v->altitude_msl(), 50.0f);

    // ATTITUDE for orientation
    mavlink_message_t att_msg;
    mavlink_msg_attitude_pack(1, 1, &att_msg, 0, 0.1f, 0.2f, 0.3f, 0, 0, 0);
    v->process_message(att_msg);
    EXPECT_FLOAT_EQ(v->roll(), 0.1f);
    EXPECT_FLOAT_EQ(v->pitch(), 0.2f);
    EXPECT_FLOAT_EQ(v->yaw(), 0.3f);
    
    // Heartbeat for mode and armed state
    mavlink_message_t hb_msg;
    mavlink_msg_heartbeat_pack(1, 1, &hb_msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_FLAG_SAFETY_ARMED | MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 4, MAV_STATE_ACTIVE);
    v->process_message(hb_msg);
    EXPECT_TRUE(v->is_armed());
    EXPECT_EQ(v->flight_mode_string(), "GUIDED");

    // Calibrations
    EXPECT_NO_THROW(v->accel_calib());
    EXPECT_NO_THROW(v->compass_calib());
    EXPECT_NO_THROW(v->esc_calib());
    EXPECT_NO_THROW(v->radio_calib());
}

// UT-VEH-004: Outbound MAVLink Routing
TEST_F(VehicleTest, OutboundMavlinkRouting) {
    auto v = std::make_shared<Vehicle>(1, 1, 99, link_manager.get(), 1);
    // LinkManager doesn't have link 99, so it just won't send anything physically,
    // but the function should not crash and should properly route.
    mavlink_message_t msg = create_heartbeat(1);
    EXPECT_NO_THROW(v->send_mavlink(msg));
}

// UT-VEH-005: Custom Message Handler Registration
TEST_F(VehicleTest, CustomMessageHandlerRegistration) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    
    int callback_count = 0;
    v->register_handler(MAVLINK_MSG_ID_PARAM_VALUE, [&](const mavlink_message_t& msg) {
        callback_count++;
    });

    mavlink_message_t p_msg;
    mavlink_msg_param_value_pack(1, 1, &p_msg, "TEST", 1.0, 1, 1, 0);
    v->process_message(p_msg);
    EXPECT_EQ(callback_count, 1);

    // Unregistered message
    mavlink_message_t h_msg = create_heartbeat(1);
    v->process_message(h_msg);
    EXPECT_EQ(callback_count, 1); // should not increase
}

// UT-VEH-006: Vehicle Timeout & Eviction
TEST_F(VehicleTest, VehicleTimeoutEviction) {
    int lost_sysid = 0;
    manager->set_on_vehicle_lost([&](int sysid, int /*compid*/) {
        lost_sysid = sysid;
    });

    mavlink_message_t msg = create_heartbeat(99);
    manager->handle_message(msg, 0);
    EXPECT_NE(manager->get_active_vehicle(), nullptr);
    EXPECT_EQ(manager->get_active_vehicle()->sysid(), 99);

    // Artificially set created_at_ and last_heartbeat_ to the past to trigger timeout instantly
    manager->get_active_vehicle()->created_at_ -= std::chrono::seconds(20);
    manager->get_active_vehicle()->last_heartbeat_ -= std::chrono::seconds(20);
    
    manager->check_timeouts();

    EXPECT_EQ(lost_sysid, 99);
    EXPECT_EQ(manager->get_active_vehicle(), nullptr);
}

// UT-VEH-007: Advanced Routing & Ignored Messages
TEST_F(VehicleTest, AdvancedRoutingAndLookups) {
    // 1. Ignore GCS heartbeat
    mavlink_message_t gcs_msg;
    mavlink_msg_heartbeat_pack(255, 0, &gcs_msg, MAV_TYPE_GCS, MAV_AUTOPILOT_INVALID, 0, 0, 0);
    manager->handle_message(gcs_msg, 0);
    EXPECT_EQ(manager->get_vehicle(255), nullptr);

    // 2. Discover valid vehicle
    mavlink_message_t msg = create_heartbeat(42);
    manager->handle_message(msg, 1);
    
    // 3. Test lookups
    auto v = manager->get_vehicle(42);
    ASSERT_NE(v, nullptr);
    EXPECT_EQ(manager->get_vehicle_by_link(1), v);
    EXPECT_EQ(manager->get_vehicle_by_ui_sysid(v->ui_sysid()), v);
    
    auto ui_sysids = manager->get_all_ui_sysids();
    ASSERT_EQ(ui_sysids.size(), 1);
    EXPECT_EQ(ui_sysids[0], v->ui_sysid());

    // 4. Test Sysid 0 Broadcast
    int callback_count = 0;
    v->register_handler(MAVLINK_MSG_ID_STATUSTEXT, [&](const mavlink_message_t&) {
        callback_count++;
    });
    mavlink_message_t bcast_msg;
    mavlink_msg_statustext_pack(0, 0, &bcast_msg, 0, "Test Broadcast", 0, 0);
    manager->handle_message(bcast_msg, 0);
    EXPECT_EQ(callback_count, 1);
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-VEH-FUNC-001
    Function : VehicleManager::handle_message
    Description : Message dispatcher.
    Input : Heartbeat msg
    Expected Output : Executes successfully
*/
TEST_F(VehicleTest, HandleMessageFUNC) {
    mavlink_message_t msg = create_heartbeat(42);
    EXPECT_NO_THROW(manager->handle_message(msg, 0));
}

/*
    UT-VEH-FUNC-002
    Function : VehicleManager::check_timeouts
    Description : Evicts timed out vehicles.
    Input : None
    Expected Output : Executes successfully
*/
TEST_F(VehicleTest, CheckTimeoutsFUNC) {
    EXPECT_NO_THROW(manager->check_timeouts());
}

/*
    UT-VEH-FUNC-003
    Function : VehicleManager::get_active_vehicle
    Description : Returns active vehicle.
    Input : None
    Expected Output : Vehicle ptr or null
*/
TEST_F(VehicleTest, GetActiveVehicleFUNC) {
    EXPECT_NO_THROW(manager->get_active_vehicle());
}

/*
    UT-VEH-FUNC-004
    Function : VehicleManager::set_on_new_vehicle
    Description : Callback registration.
    Input : callback
    Expected Output : Executes successfully
*/
TEST_F(VehicleTest, SetOnNewVehicleFUNC) {
    EXPECT_NO_THROW(manager->set_on_new_vehicle([](std::shared_ptr<Vehicle>){}));
}

/*
    UT-VEH-FUNC-005
    Function : VehicleManager::set_on_vehicle_lost
    Description : Callback registration.
    Input : callback
    Expected Output : Executes successfully
*/
TEST_F(VehicleTest, SetOnVehicleLostFUNC) {
    EXPECT_NO_THROW(manager->set_on_vehicle_lost([](int, int){}));
}

/*
    UT-VEH-FUNC-006
    Function : Vehicle::process_message
    Description : Updates vehicle telemetry.
    Input : msg
    Expected Output : Telemetry fields updated
*/
TEST_F(VehicleTest, VehicleProcessMessageFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    mavlink_message_t msg = create_heartbeat(1);
    EXPECT_NO_THROW(v->process_message(msg));
}

/*
    UT-VEH-FUNC-007
    Function : Vehicle::send_mavlink
    Description : Routes outbound message.
    Input : msg
    Expected Output : Routes without crash
*/
TEST_F(VehicleTest, VehicleSendMavlinkFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    mavlink_message_t msg = create_heartbeat(1);
    EXPECT_NO_THROW(v->send_mavlink(msg));
}

/*
    UT-VEH-FUNC-008
    Function : Vehicle::register_handler
    Description : Subscribes custom callback.
    Input : msgid, callback
    Expected Output : Callback registered
*/
TEST_F(VehicleTest, VehicleRegisterHandlerFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_NO_THROW(v->register_handler(1, [](const mavlink_message_t&){}));
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-VEH-EXT-001
    Function : VehicleManager::set_on_new_vehicle
    Description : Null callbacks handling.
    Input : null callback
    Expected Output : Sets safely without crash
*/
TEST_F(VehicleTest, NullCallbackHandling) {
    EXPECT_NO_THROW({
        manager->set_on_new_vehicle(nullptr);
        manager->set_on_vehicle_lost(nullptr);
    });
}

/*
    UT-VEH-009
    Function : Vehicle::sysid
    Description : Retrieve system ID of the vehicle.
    Input : None
    Expected Output : returns sysid value
*/
TEST_F(VehicleTest, SysidFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_EQ(v->sysid(), 1);
}

/*
    UT-VEH-010
    Function : Vehicle::compid
    Description : Retrieve component ID of the vehicle.
    Input : None
    Expected Output : returns compid value
*/
TEST_F(VehicleTest, CompidFUNC) {
    auto v = std::make_shared<Vehicle>(1, 2, 0, link_manager.get(), 1);
    EXPECT_EQ(v->compid(), 2);
}

/*
    UT-VEH-011
    Function : Vehicle::ui_sysid
    Description : Retrieve UI system ID of the vehicle.
    Input : None
    Expected Output : returns ui_sysid value
*/
TEST_F(VehicleTest, UiSysidFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 5);
    EXPECT_EQ(v->ui_sysid(), 5);
}

/*
    UT-VEH-012
    Function : Vehicle::link_id
    Description : Retrieve link ID connected to this vehicle.
    Input : None
    Expected Output : returns link ID value
*/
TEST_F(VehicleTest, LinkIdFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 3, link_manager.get(), 1);
    EXPECT_EQ(v->link_id(), 3);
}

/*
    UT-VEH-013
    Function : Vehicle::set_link_id
    Description : Set the active link ID for the vehicle.
    Input : link_id = 4
    Expected Output : link_id updated
*/
TEST_F(VehicleTest, SetLinkIdFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 3, link_manager.get(), 1);
    v->set_link_id(4);
    EXPECT_EQ(v->link_id(), 4);
}

/*
    UT-VEH-014
    Function : Vehicle::update_telemetry
    Description : Periodic telemetry check and status updates.
    Input : None
    Expected Output : executes successfully
*/
TEST_F(VehicleTest, UpdateTelemetryFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    mavlink_message_t msg = {};
    EXPECT_NO_THROW(v->update_telemetry(msg));
}

/*
    UT-VEH-015
    Function : Vehicle::update_heartbeat
    Description : Update last heartbeat timestamp.
    Input : None
    Expected Output : executes successfully
*/
TEST_F(VehicleTest, UpdateHeartbeatFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_NO_THROW(v->update_heartbeat());
}

/*
    UT-VEH-016
    Function : Vehicle::is_alive
    Description : Check if the vehicle is currently communicating/alive.
    Input : None
    Expected Output : returns bool status
*/
TEST_F(VehicleTest, IsAliveFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_TRUE(v->is_alive());
}

/*
    UT-VEH-017
    Function : Vehicle::is_armed
    Description : Check if the vehicle motors are armed.
    Input : None
    Expected Output : returns bool status
*/
TEST_F(VehicleTest, IsArmedFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FALSE(v->is_armed());
}

/*
    UT-VEH-018
    Function : Vehicle::flight_mode_string
    Description : Get readable flight mode name string.
    Input : None
    Expected Output : returns mode string
*/
TEST_F(VehicleTest, FlightModeStringFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_EQ(v->flight_mode_string(), "UNKNOWN");
}

/*
    UT-VEH-019
    Function : Vehicle::battery_remaining
    Description : Retrieve battery remaining percentage.
    Input : None
    Expected Output : returns percentage integer
*/
TEST_F(VehicleTest, BatteryRemainingFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_EQ(v->battery_remaining(), -1);
}

/*
    UT-VEH-020
    Function : Vehicle::battery_voltage
    Description : Retrieve battery voltage.
    Input : None
    Expected Output : returns voltage float
*/
TEST_F(VehicleTest, BatteryVoltageFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FLOAT_EQ(v->battery_voltage(), 0.0f);
}

/*
    UT-VEH-021
    Function : Vehicle::gps_fix_type
    Description : Retrieve GPS fix level type.
    Input : None
    Expected Output : returns fix type integer
*/
TEST_F(VehicleTest, GpsFixTypeFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_EQ(v->gps_fix_type(), 0);
}

/*
    UT-VEH-022
    Function : Vehicle::gps_satellites
    Description : Retrieve count of connected GPS satellites.
    Input : None
    Expected Output : returns satellites count
*/
TEST_F(VehicleTest, GpsSatellitesFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_EQ(v->gps_satellites(), 0);
}

/*
    UT-VEH-023
    Function : Vehicle::latitude
    Description : Retrieve current latitude degrees.
    Input : None
    Expected Output : returns double degrees
*/
TEST_F(VehicleTest, LatitudeFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_DOUBLE_EQ(v->latitude(), 0.0);
}

/*
    UT-VEH-024
    Function : Vehicle::longitude
    Description : Retrieve current longitude degrees.
    Input : None
    Expected Output : returns double degrees
*/
TEST_F(VehicleTest, LongitudeFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_DOUBLE_EQ(v->longitude(), 0.0);
}

/*
    UT-VEH-025
    Function : Vehicle::altitude_msl
    Description : Retrieve altitude above mean sea level.
    Input : None
    Expected Output : returns float altitude
*/
TEST_F(VehicleTest, AltitudeMslFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FLOAT_EQ(v->altitude_msl(), 0.0f);
}

/*
    UT-VEH-026
    Function : Vehicle::roll
    Description : Retrieve vehicle roll orientation.
    Input : None
    Expected Output : returns roll float
*/
TEST_F(VehicleTest, RollFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FLOAT_EQ(v->roll(), 0.0f);
}

/*
    UT-VEH-027
    Function : Vehicle::pitch
    Description : Retrieve vehicle pitch orientation.
    Input : None
    Expected Output : returns pitch float
*/
TEST_F(VehicleTest, PitchFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FLOAT_EQ(v->pitch(), 0.0f);
}

/*
    UT-VEH-028
    Function : Vehicle::yaw
    Description : Retrieve vehicle yaw orientation.
    Input : None
    Expected Output : returns yaw float
*/
TEST_F(VehicleTest, YawFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FLOAT_EQ(v->yaw(), 0.0f);
}

/*
    UT-VEH-029
    Function : Vehicle::speed
    Description : Retrieve vehicle ground speed.
    Input : None
    Expected Output : returns speed float
*/
TEST_F(VehicleTest, SpeedFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FLOAT_EQ(v->speed(), 0.0f);
}

/*
    UT-VEH-030
    Function : Vehicle::accel_calib
    Description : Retrieve vehicle accel calibration instance.
    Input : None
    Expected Output : returns reference to AccelCalibration
*/
TEST_F(VehicleTest, AccelCalibFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_NO_THROW(v->accel_calib());
}

/*
    UT-VEH-031
    Function : Vehicle::compass_calib
    Description : Retrieve vehicle compass calibration instance.
    Input : None
    Expected Output : returns reference to CompassCalibration
*/
TEST_F(VehicleTest, CompassCalibFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_NO_THROW(v->compass_calib());
}

/*
    UT-VEH-032
    Function : Vehicle::esc_calib
    Description : Retrieve vehicle esc calibration instance.
    Input : None
    Expected Output : returns reference to EscCalibration
*/
TEST_F(VehicleTest, EscCalibFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_NO_THROW(v->esc_calib());
}

/*
    UT-VEH-033
    Function : Vehicle::radio_calib
    Description : Retrieve vehicle radio calibration instance.
    Input : None
    Expected Output : returns reference to RadioCalibration
*/
TEST_F(VehicleTest, RadioCalibFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_NO_THROW(v->radio_calib());
}

/*
    UT-VEH-034
    Function : Vehicle::check_and_clear_reboot
    Description : Check and clear vehicle reboot flag.
    Input : None
    Expected Output : returns bool status
*/
TEST_F(VehicleTest, CheckAndClearRebootFUNC) {
    auto v = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
    EXPECT_FALSE(v->check_and_clear_reboot());
}

/*
    UT-VEH-035
    Function : VehicleManager::get_all_sysids
    Description : Retrieve all discovered system IDs.
    Input : None
    Expected Output : returns list of IDs
*/
TEST_F(VehicleTest, GetAllSysidsFUNC) {
    EXPECT_TRUE(manager->get_all_sysids().empty());
}

/*
    UT-VEH-036
    Function : VehicleManager::get_all_ui_sysids
    Description : Retrieve all mapped UI system IDs.
    Input : None
    Expected Output : returns list of UI IDs
*/
TEST_F(VehicleTest, GetAllUiSysidsFUNC) {
    EXPECT_TRUE(manager->get_all_ui_sysids().empty());
}


