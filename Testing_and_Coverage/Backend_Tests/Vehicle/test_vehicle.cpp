#include <gtest/gtest.h>
#include <gmock/gmock.h>
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

    // Artificially wait 8.1 seconds for eviction (since is_alive() uses 8s)
    std::this_thread::sleep_for(std::chrono::milliseconds(8100));
    
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
