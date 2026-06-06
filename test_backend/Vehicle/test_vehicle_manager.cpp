#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <chrono>
#include <memory>
#include <atomic>
#include <future>

#include "Vehicle/vehicle_manager.h"
#include "Link/link_manager.h"
#include "../Link/mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

// Reuse private accessor tags for Vehicle to simulate aging heartbeat
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct VehicleLastHeartbeatTag {
    typedef std::chrono::steady_clock::time_point Vehicle::*type;
    friend type get(VehicleLastHeartbeatTag);
};

struct VehicleCreatedAtTag {
    typedef std::chrono::steady_clock::time_point Vehicle::*type;
    friend type get(VehicleCreatedAtTag);
};

class VehicleManagerTest : public ::testing::Test {
protected:
    asio::io_context io_;
    LinkManager link_manager_;
    std::shared_ptr<MockTransport> mock_transport_ = std::make_shared<MockTransport>();
    int link_id_ = 0;

    void SetUp() override {
        link_id_ = link_manager_.add_link(mock_transport_, io_);
    }
};

// Helper to construct a mavlink heartbeat packet
static mavlink_message_t make_hb(uint8_t sysid, uint8_t compid) {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(sysid, compid, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    return msg;
}

// UT-VM-001: Happy Path - Discovery of a new vehicle on heartbeat
TEST_F(VehicleManagerTest, HandleMessage_DiscoversNewVehicleOnHeartbeat) {
    // Arrange
    VehicleManager vm(&link_manager_);
    
    std::promise<std::shared_ptr<Vehicle>> new_vehicle_promise;
    auto new_vehicle_future = new_vehicle_promise.get_future();

    vm.set_on_new_vehicle([&](std::shared_ptr<Vehicle> v) {
        new_vehicle_promise.set_value(v);
    });

    mavlink_message_t hb = make_hb(42, 1);

    // Act
    vm.handle_message(hb, link_id_);

    // Assert
    ASSERT_TRUE(new_vehicle_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    auto vehicle = new_vehicle_future.get();
    ASSERT_NE(vehicle, nullptr);
    EXPECT_EQ(vehicle->sysid(), 42);
    EXPECT_EQ(vehicle->link_id(), link_id_);
    
    // Verify lookups
    EXPECT_EQ(vm.get_vehicle(42), vehicle);
    EXPECT_EQ(vm.get_active_vehicle(), vehicle);
    EXPECT_EQ(vm.get_vehicle_by_link(link_id_), vehicle);
    
    std::vector<int> sysids = vm.get_all_sysids();
    ASSERT_EQ(sysids.size(), 1);
    EXPECT_EQ(sysids[0], 42);
}

// UT-VM-002: Happy Path - Ignores non-heartbeat frames for unknown vehicles
TEST_F(VehicleManagerTest, HandleMessage_IgnoresNonHeartbeatForUnknownVehicles) {
    // Arrange
    VehicleManager vm(&link_manager_);
    
    bool discovered = false;
    vm.set_on_new_vehicle([&](std::shared_ptr<Vehicle>) {
        discovered = true;
    });

    // Create a GPS raw int message
    mavlink_message_t msg;
    mavlink_msg_gps_raw_int_pack(1, 1, &msg, 0, 3, 123456780, 876543210, 15000, 9999, 9999, 100, 36000, 12, 0, 0, 0, 0, 0, 0);
    msg.sysid = 99; // Unknown vehicle sysid

    // Act
    vm.handle_message(msg, link_id_);

    // Assert
    EXPECT_FALSE(discovered);
    EXPECT_EQ(vm.get_vehicle(99), nullptr);
}

// UT-VM-003: Happy Path - Separate Vehicles for Same Sysid on Different Links
TEST_F(VehicleManagerTest, HandleMessage_TracksSeparateVehiclesForSameSysidOnDifferentLinks) {
    // Arrange
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_hb(42, 1);
    vm.handle_message(hb, link_id_); // initially discovered on link_id_

    // Set up a second link
    int second_link_id = link_manager_.add_link(mock_transport_, io_);

    // Act: Receive heartbeat from same vehicle sysid on second link
    vm.handle_message(hb, second_link_id);

    // Assert
    auto vehicle1 = vm.get_vehicle_by_link(link_id_);
    auto vehicle2 = vm.get_vehicle_by_link(second_link_id);
    
    ASSERT_NE(vehicle1, nullptr);
    ASSERT_NE(vehicle2, nullptr);
    EXPECT_NE(vehicle1, vehicle2);
    EXPECT_EQ(vehicle1->sysid(), 42);
    EXPECT_EQ(vehicle2->sysid(), 42);
    EXPECT_EQ(vehicle1->link_id(), link_id_);
    EXPECT_EQ(vehicle2->link_id(), second_link_id);
}

// UT-VM-004: State Verification - Evicting timed out vehicles
TEST_F(VehicleManagerTest, CheckTimeouts_EvictsDeadVehicles) {
    // Arrange
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_hb(10, 1);
    vm.handle_message(hb, link_id_);

    auto vehicle = vm.get_vehicle(10);
    ASSERT_NE(vehicle, nullptr);

    // Age the vehicle's heartbeat artificially beyond the 15s boot grace period
    auto created_at_ptr = get(VehicleCreatedAtTag{});
    auto last_hb_ptr = get(VehicleLastHeartbeatTag{});
    (*vehicle).*created_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(25);
    (*vehicle).*last_hb_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(15); // >10s ago

    std::promise<int> lost_promise;
    auto lost_future = lost_promise.get_future();
    vm.set_on_vehicle_lost([&](int sysid, int ui_sysid) {
        lost_promise.set_value(sysid);
    });

    // Act: Check timeouts
    vm.check_timeouts();

    // Assert
    ASSERT_TRUE(lost_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    EXPECT_EQ(lost_future.get(), 10);
    EXPECT_EQ(vm.get_vehicle(10), nullptr);
    EXPECT_EQ(vm.get_all_sysids().size(), 0);
}

// UT-VM-005: Construction with null LinkManager throws invalid_argument
TEST_F(VehicleManagerTest, Construction_NullLinkManagerThrows) {
    EXPECT_THROW(VehicleManager(nullptr), std::invalid_argument);
}

// UT-VM-006: Broadcast sysid=0 message routes to all live vehicles
TEST_F(VehicleManagerTest, HandleMessage_BroadcastRoutesToLiveVehicles) {
    VehicleManager vm(&link_manager_);
    
    // Discover vehicle
    mavlink_message_t hb = make_hb(42, 1);
    vm.handle_message(hb, link_id_);
    auto vehicle = vm.get_vehicle(42);
    ASSERT_NE(vehicle, nullptr);
    
    // Register handler for MAG_CAL_PROGRESS (191) on vehicle
    std::atomic<int> progress_calls{0};
    vehicle->register_handler(MAVLINK_MSG_ID_MAG_CAL_PROGRESS, [&](const mavlink_message_t& m) {
        progress_calls++;
    });

    // Send broadcast MAG_CAL_PROGRESS
    mavlink_message_t broadcast_msg;
    mavlink_mag_cal_progress_t prog{};
    mavlink_msg_mag_cal_progress_encode(0, 0, &broadcast_msg, &prog); // sysid = 0, compid = 0

    vm.handle_message(broadcast_msg, link_id_);

    EXPECT_EQ(progress_calls.load(), 1);
}

// UT-VM-007: Ignores non-FC heartbeats
TEST_F(VehicleManagerTest, HandleMessage_IgnoresNonFcHeartbeats) {
    VehicleManager vm(&link_manager_);
    
    // 1. GCS heartbeat
    mavlink_message_t msg1;
    mavlink_msg_heartbeat_pack(1, 1, &msg1, MAV_TYPE_GCS, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    vm.handle_message(msg1, link_id_);
    EXPECT_EQ(vm.get_vehicle(1), nullptr);

    // 2. Invalid autopilot
    mavlink_message_t msg2;
    mavlink_msg_heartbeat_pack(1, 1, &msg2, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_INVALID, 0, 0, MAV_STATE_STANDBY);
    vm.handle_message(msg2, link_id_);
    EXPECT_EQ(vm.get_vehicle(1), nullptr);

    // 3. Broadcast component id (0)
    mavlink_message_t msg3;
    mavlink_msg_heartbeat_pack(1, 0, &msg3, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    vm.handle_message(msg3, link_id_);
    EXPECT_EQ(vm.get_vehicle(1), nullptr);
}

// UT-VM-008: Subsequent heartbeat updates vehicle link ID
TEST_F(VehicleManagerTest, HandleMessage_UpdatesLinkIdOnSubsequentHeartbeats) {
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_hb(42, 1);
    vm.handle_message(hb, link_id_);
    
    auto vehicle = vm.get_vehicle(42);
    ASSERT_NE(vehicle, nullptr);
    EXPECT_EQ(vehicle->link_id(), link_id_);

    // Manually change the vehicle's internal link_id
    vehicle->set_link_id(99);
    EXPECT_EQ(vehicle->link_id(), 99);

    // Send subsequent heartbeat on the original link_id to trigger the link update back to link_id_
    vm.handle_message(hb, link_id_);
    EXPECT_EQ(vehicle->link_id(), link_id_);
}

// UT-VM-009: CheckTimeouts keeps live vehicles
TEST_F(VehicleManagerTest, CheckTimeouts_KeepsLiveVehicles) {
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_hb(42, 1);
    vm.handle_message(hb, link_id_);
    
    // Check timeouts immediately (vehicle is within boot grace period)
    vm.check_timeouts();
    EXPECT_NE(vm.get_vehicle(42), nullptr);
}

// UT-VM-010: get_vehicle returns found dead vehicle if no live vehicle matches
TEST_F(VehicleManagerTest, GetVehicle_ReturnsFoundDeadIfNoneAlive) {
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_hb(42, 1);
    vm.handle_message(hb, link_id_);
    
    auto vehicle = vm.get_vehicle(42);
    ASSERT_NE(vehicle, nullptr);

    // Age the vehicle's heartbeat to mark it as dead
    auto created_at_ptr = get(VehicleCreatedAtTag{});
    auto last_hb_ptr = get(VehicleLastHeartbeatTag{});
    (*vehicle).*created_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(25);
    (*vehicle).*last_hb_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(15);

    // get_vehicle should still return it as the found dead vehicle
    EXPECT_EQ(vm.get_vehicle(42), vehicle);
}

// UT-VM-011: get_all_ui_sysids and lookups by UI sysid / link
TEST_F(VehicleManagerTest, Getters_AllUiSysidsAndUiSysidLookups) {
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_hb(42, 1);
    vm.handle_message(hb, link_id_);
    
    auto vehicle = vm.get_vehicle(42);
    ASSERT_NE(vehicle, nullptr);

    // Verify UI sysids getter
    std::vector<int> ui_sysids = vm.get_all_ui_sysids();
    ASSERT_EQ(ui_sysids.size(), 1u);
    EXPECT_EQ(ui_sysids[0], vehicle->ui_sysid());

    // Lookup by UI sysid
    EXPECT_EQ(vm.get_vehicle_by_ui_sysid(vehicle->ui_sysid()), vehicle);
    EXPECT_EQ(vm.get_vehicle_by_ui_sysid(-1), nullptr);

    // Lookup by link id
    EXPECT_EQ(vm.get_vehicle_by_link(link_id_), vehicle);
    EXPECT_EQ(vm.get_vehicle_by_link(-1), nullptr);
}

