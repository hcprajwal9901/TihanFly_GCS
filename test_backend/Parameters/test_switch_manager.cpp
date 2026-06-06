#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <memory>
#include <atomic>
#include <future>

#include "Parameters/switch_manager.h"
#include "Vehicle/vehicle.h"
#include "Vehicle/vehicle_manager.h"
#include "Link/link_manager.h"
#include "../Link/mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;

class SwitchManagerTest : public ::testing::Test {
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
static mavlink_message_t make_heartbeat_msg(uint8_t sysid, uint8_t compid) {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(sysid, compid, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    return msg;
}

// UT-SW-001: Happy Path - Staging switch option changes
TEST_F(SwitchManagerTest, SetSwitchOption_StagesOptionAndDispatchesParamSet) {
    // Arrange
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_heartbeat_msg(1, 1);
    vm.handle_message(hb, link_id_);

    SwitchManager sm(&vm);
    
    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    std::promise<int> cb_channel_promise;
    auto cb_channel_future = cb_channel_promise.get_future();
    sm.set_on_write([&](int channel, const std::string& param, int val) {
        cb_channel_promise.set_value(channel);
    });

    // Act: Set RC7 option to 41 (ArmDisarm)
    sm.set_switch_option(7, 41);

    // Assert 1: pending count is 1
    EXPECT_EQ(sm.pending_count(), 1);

    // Assert 2: callback triggered
    ASSERT_TRUE(cb_channel_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    EXPECT_EQ(cb_channel_future.get(), 7);

    // Assert 3: MAVLink PARAM_SET dispatched
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_PARAM_SET);

    mavlink_param_set_t set;
    mavlink_msg_param_set_decode(&out_msg, &set);
    EXPECT_FLOAT_EQ(set.param_value, 41.0f);
    EXPECT_STREQ(set.param_id, "RC7_OPTION");
}

// UT-SW-002: Happy Path - Write all staged pending changes
TEST_F(SwitchManagerTest, WriteAllPending_SendsStagedOptions) {
    // Arrange
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_heartbeat_msg(1, 1);
    vm.handle_message(hb, link_id_);

    SwitchManager sm(&vm);
    
    // Stage two options
    sm.set_switch_option(6, 10);
    sm.set_switch_option(8, 20);

    // Reset mocks for batch writing
    testing::Mock::VerifyAndClearExpectations(mock_transport_.get());

    std::atomic<int> sent_count{0};
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .Times(2)
        .WillRepeatedly(Invoke([&](const uint8_t* data, std::size_t len) {
            sent_count++;
        }));

    // Act: Write all pending staged options
    int written = sm.write_all_pending();

    // Assert
    EXPECT_EQ(written, 2);
    EXPECT_EQ(sent_count.load(), 2);
}

// UT-SW-003: Happy Path - Request Parameter Read
TEST_F(SwitchManagerTest, RequestParamRead_SendsRequestRead) {
    // Arrange
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_heartbeat_msg(5, 1);
    vm.handle_message(hb, link_id_);

    SwitchManager sm(&vm);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    // Act
    sm.request_param_read(9);

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_PARAM_REQUEST_READ);

    mavlink_param_request_read_t read;
    mavlink_msg_param_request_read_decode(&out_msg, &read);
    EXPECT_EQ(read.target_system, 5);
    EXPECT_STREQ(read.param_id, "RC9_OPTION");
}

// UT-SW-004: Happy Path - Clearing pending changes
TEST_F(SwitchManagerTest, ClearPending_DiscardsStagedOptions) {
    // Arrange
    VehicleManager vm(&link_manager_);
    mavlink_message_t hb = make_heartbeat_msg(1, 1);
    vm.handle_message(hb, link_id_);

    SwitchManager sm(&vm);

    sm.set_switch_option(7, 41);
    EXPECT_EQ(sm.pending_count(), 1);

    // Act
    sm.clear_pending();

    // Assert
    EXPECT_EQ(sm.pending_count(), 0);
}

// UT-SW-005: Boundary - Missing active vehicle
TEST_F(SwitchManagerTest, NoActiveVehicle_SafelyAborts) {
    // Arrange
    VehicleManager vm(&link_manager_); // no discovered vehicles -> no active vehicle
    SwitchManager sm(&vm);

    EXPECT_CALL(*mock_transport_, async_send(_, _)).Times(0);

    // Act & Assert (Should not crash or send)
    sm.set_switch_option(6, 10);
    EXPECT_EQ(sm.write_all_pending(), 0);
}
