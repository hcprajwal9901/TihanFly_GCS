#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "Inspector/mavlink_inspector.h"
#include <mavlink/ardupilotmega/mavlink.h>
#include <nlohmann/json.hpp>
#include <thread>
#include <chrono>
#include <condition_variable>
#include <mutex>

using ::testing::_;

// UT-INS-001: Initialization & Callback Registration
TEST(MavlinkInspectorTest, InitializationAndCallbackRegistration) {
    asio::io_context io;
    MavlinkInspector inspector(io);
    
    bool callback_called = false;
    inspector.set_ws_callback([&](const std::string& json) {
        callback_called = true;
    });

    EXPECT_NO_THROW(inspector.start());
    EXPECT_NO_THROW(inspector.stop());
}

// UT-INS-002: Message Decoding (HEARTBEAT)
TEST(MavlinkInspectorTest, MessageDecodingHeartbeat) {
    asio::io_context io;
    MavlinkInspector inspector(io);
    
    std::string captured_json;
    inspector.set_ws_callback([&](const std::string& json) {
        captured_json = json;
    });
    
    // Create a HEARTBEAT message
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    
    // Feed the message
    inspector.on_message(msg);
    
    // Trigger the broadcast timer manually by polling the io_context
    inspector.start();
    asio::steady_timer stop_timer(io, std::chrono::milliseconds(300));
    stop_timer.async_wait([&](const std::error_code&) { inspector.stop(); });
    io.run();
    
    // Check JSON parsing
    ASSERT_FALSE(captured_json.empty());
    
    // Validate basic JSON structure
    EXPECT_TRUE(captured_json.find("\"name\":\"HEARTBEAT\"") != std::string::npos);
    EXPECT_TRUE(captured_json.find("\"autopilot\":\"3\"") != std::string::npos); // MAV_AUTOPILOT_ARDUPILOTMEGA is 3
    EXPECT_TRUE(captured_json.find("\"type\":\"2\"") != std::string::npos);      // MAV_TYPE_QUADROTOR is 2
}

// UT-INS-003: Unknown Message Handling
TEST(MavlinkInspectorTest, UnknownMessageHandling) {
    asio::io_context io;
    MavlinkInspector inspector(io);
    
    std::string captured_json;
    inspector.set_ws_callback([&](const std::string& json) {
        captured_json = json;
    });
    
    // Create a garbage message with unknown ID
    mavlink_message_t msg;
    msg.msgid = 999999; // Highly unlikely to be a valid standard message ID
    msg.len = 4;
    uint8_t* p = (uint8_t*)msg.payload64;
    p[0] = 0xAA;
    p[1] = 0xBB;
    p[2] = 0xCC;
    p[3] = 0xDD;
    
    // Feed the message
    inspector.on_message(msg);
    
    inspector.start();
    asio::steady_timer stop_timer(io, std::chrono::milliseconds(300));
    stop_timer.async_wait([&](const std::error_code&) { inspector.stop(); });
    io.run();
    
    // It should output payload_hex for unknown messages
    ASSERT_FALSE(captured_json.empty());
    EXPECT_TRUE(captured_json.find("payload_hex") != std::string::npos);
    EXPECT_TRUE(captured_json.find("AA BB CC DD") != std::string::npos || 
                captured_json.find("aa bb cc dd") != std::string::npos);
}

// UT-INS-004: Rate Calculation
TEST(MavlinkInspectorTest, RateCalculation) {
    asio::io_context io;
    MavlinkInspector inspector(io);
    
    std::string captured_json;
    inspector.set_ws_callback([&](const std::string& json) {
        captured_json = json;
    });

    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    
    // Feed multiple messages to calculate a rate
    inspector.on_message(msg);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    inspector.on_message(msg);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    inspector.on_message(msg);
    
    inspector.start();
    asio::steady_timer stop_timer(io, std::chrono::milliseconds(300));
    stop_timer.async_wait([&](const std::error_code&) { inspector.stop(); });
    io.run();
    
    // The rate should be calculated and non-zero
    ASSERT_FALSE(captured_json.empty());
    EXPECT_TRUE(captured_json.find("\"rate\":0.00") == std::string::npos);
    EXPECT_TRUE(captured_json.find("\"count\":3") != std::string::npos);
}

// UT-INS-005: JSON Broadcast Format
TEST(MavlinkInspectorTest, JsonBroadcastFormat) {
    asio::io_context io;
    MavlinkInspector inspector(io);
    
    std::string captured_json;
    inspector.set_ws_callback([&](const std::string& json) {
        captured_json = json;
    });

    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    inspector.on_message(msg);
    
    inspector.start();
    asio::steady_timer stop_timer(io, std::chrono::milliseconds(300));
    stop_timer.async_wait([&](const std::error_code&) { inspector.stop(); });
    io.run();
    
    ASSERT_FALSE(captured_json.empty());
    
    // Verify JSON wrapper
    EXPECT_TRUE(captured_json.find("{\"type\":\"mavlink_inspector\",\"messages\":[") == 0);
    EXPECT_TRUE(captured_json.find("}]}") != std::string::npos);
}

// UT-INS-006: Extended Message Decoding
TEST(MavlinkInspectorTest, ExtendedMessageDecoding) {
    asio::io_context io;
    MavlinkInspector inspector(io);
    
    std::string captured_json;
    inspector.set_ws_callback([&](const std::string& json) {
        captured_json = json;
    });

    // ATTITUDE contains floats
    mavlink_message_t msg_att;
    mavlink_msg_attitude_pack(1, 1, &msg_att, 12345, 0.1, 0.2, 0.3, 0.01, 0.02, 0.03);
    inspector.on_message(msg_att);
    
    // STATUSTEXT contains char array
    mavlink_message_t msg_text;
    mavlink_msg_statustext_pack(1, 1, &msg_text, MAV_SEVERITY_INFO, "Hello World", 0, 0);
    inspector.on_message(msg_text);
    
    inspector.start();
    asio::steady_timer stop_timer(io, std::chrono::milliseconds(300));
    stop_timer.async_wait([&](const std::error_code&) { inspector.stop(); });
    io.run();
    
    ASSERT_FALSE(captured_json.empty());
    EXPECT_TRUE(captured_json.find("Hello World") != std::string::npos);
    EXPECT_TRUE(captured_json.find("0.1") != std::string::npos || captured_json.find("0.1000") != std::string::npos);
}

