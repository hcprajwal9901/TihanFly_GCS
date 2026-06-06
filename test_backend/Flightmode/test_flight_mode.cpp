#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <memory>
#include <atomic>
#include <future>
#include <array>
#include <nlohmann/json.hpp>

#include "Flightmode/flight_mode.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;
using json = nlohmann::json;

class FlightModeTest : public ::testing::Test {
protected:
    FlightMode fm_;
};

// UT-FLT-001: Happy Path - Enum translation and string helpers
TEST_F(FlightModeTest, HelperMethods_TranslateCorrectly) {
    EXPECT_EQ(FlightMode::modeName(CopterMode::GUIDED), "GUIDED");
    EXPECT_EQ(FlightMode::modeFromName("Guided"), CopterMode::GUIDED);
    EXPECT_EQ(FlightMode::modeFromId(5), CopterMode::LOITER);
}

// UT-FLT-002: Happy Path - Inbound RC_CHANNELS resolves slot and triggers websocket broadcast
TEST_F(FlightModeTest, ProcessMessage_RCChannelsTriggersPWMAndStatusBroadcasts) {
    // Arrange
    fm_.setVehicleInfo(1, 1);

    std::atomic<int> pwm_messages{0};
    std::atomic<int> status_messages{0};
    fm_.setSendCallback([&](const std::string& j) {
        json msg = json::parse(j);
        if (msg["type"] == "flight_mode_pwm") {
            pwm_messages++;
            EXPECT_EQ(msg["pwm"], 1400);
            EXPECT_EQ(msg["slot"], 2); // PWM 1400 is in slot 2 (thresholds: 1230, 1360, 1490...)
        } else if (msg["type"] == "flight_mode_status") {
            status_messages++;
            EXPECT_EQ(msg["pwm"], 1400);
            EXPECT_EQ(msg["slot"], 2);
        }
    });

    // Send a PARAM_VALUE first to configure slot 2 to LOITER (5)
    mavlink_message_t param_msg;
    mavlink_msg_param_value_pack(1, 1, &param_msg, "FLTMODE3", 5.0f, MAV_PARAM_TYPE_INT32, 100, 0);
    fm_.processMessage(param_msg);

    // Send the RC_CHANNELS message
    mavlink_message_t rc_msg;
    mavlink_rc_channels_t rc{};
    rc.chan5_raw = 1400; // slot 2
    mavlink_msg_rc_channels_encode(1, 1, &rc_msg, &rc);

    // Act
    fm_.processMessage(rc_msg);

    // Assert
    EXPECT_EQ(pwm_messages.load(), 1);
    EXPECT_EQ(status_messages.load(), 1);
}

// UT-FLT-003: Happy Path - Inbound HEARTBEAT updates armed state and mode overrides
TEST_F(FlightModeTest, ProcessMessage_HeartbeatArmedEventAndModeOverride) {
    // Arrange
    fm_.setVehicleInfo(1, 1);

    std::promise<std::string> event_promise;
    auto event_future = event_promise.get_future();

    std::promise<std::string> status_promise;
    auto status_future = status_promise.get_future();

    fm_.setSendCallback([&](const std::string& j) {
        json msg = json::parse(j);
        if (msg["type"] == "event") {
            event_promise.set_value(j);
        } else if (msg["type"] == "flight_mode_status") {
            status_promise.set_value(j);
        }
    });

    mavlink_message_t msg;
    // Armed guided mode heartbeat
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 
                               MAV_MODE_FLAG_SAFETY_ARMED | MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 
                               4, // GUIDED
                               MAV_STATE_ACTIVE);

    // Act
    fm_.processMessage(msg);

    // Assert
    ASSERT_TRUE(event_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    json ev = json::parse(event_future.get());
    EXPECT_EQ(ev["event"], "armed");

    ASSERT_TRUE(status_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    json st = json::parse(status_future.get());
    EXPECT_EQ(st["mode"], "GUIDED");
}

// UT-FLT-004: Happy Path - Request Parameters from Autopilot
TEST_F(FlightModeTest, RequestParams_DispatchesParamReads) {
    // Arrange
    fm_.setVehicleInfo(12, 1);

    std::atomic<int> sent_reads{0};
    fm_.setTransportCallback([&](const mavlink_message_t& m) {
        if (m.msgid == MAVLINK_MSG_ID_PARAM_REQUEST_READ) {
            sent_reads++;
            mavlink_param_request_read_t req;
            mavlink_msg_param_request_read_decode(&m, &req);
            EXPECT_EQ(req.target_system, 12);
        }
    });

    // Act
    fm_.requestParams();

    // Assert
    EXPECT_EQ(sent_reads.load(), 6); // FLTMODE1 to FLTMODE6
}

// UT-FLT-005: Happy Path - Set Mode Command long-pack
TEST_F(FlightModeTest, SetMode_SendsSetModeCommand) {
    // Arrange
    fm_.setVehicleInfo(1, 1);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();
    fm_.setTransportCallback([&](const mavlink_message_t& m) {
        sent_msg_promise.set_value(m);
    });

    // Act
    fm_.setMode(CopterMode::RTL);

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);

    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&out_msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_SET_MODE);
    EXPECT_FLOAT_EQ(cmd.param2, static_cast<float>(CopterMode::RTL));
}

// UT-FLT-006: Happy Path - Save flight modes configuration
TEST_F(FlightModeTest, SaveFlightModes_SendsParamSets) {
    // Arrange
    fm_.setVehicleInfo(1, 1);

    std::atomic<int> sent_sets{0};
    fm_.setTransportCallback([&](const mavlink_message_t& m) {
        if (m.msgid == MAVLINK_MSG_ID_PARAM_SET) {
            sent_sets++;
            mavlink_param_set_t set;
            mavlink_msg_param_set_decode(&m, &set);
            EXPECT_EQ(set.param_type, MAV_PARAM_TYPE_INT32);
        }
    });

    std::array<uint8_t, FlightMode::NUM_SLOTS> modes = {0, 2, 5, 6, 9, 16};

    // Act
    fm_.saveFlightModes(modes);

    // Assert
    EXPECT_EQ(sent_sets.load(), 6);
}
