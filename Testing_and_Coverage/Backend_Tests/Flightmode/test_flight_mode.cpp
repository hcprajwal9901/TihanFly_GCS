#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "Flightmode/flight_mode.h"
#include <nlohmann/json.hpp>
#include <vector>
#include <string>
#include <thread>

using json = nlohmann::json;

class FlightModeTest : public ::testing::Test {
protected:
    FlightMode fm;
    std::vector<std::string> sent_ws_messages;
    std::vector<mavlink_message_t> sent_mavlink_messages;

    void SetUp() override {
        fm.setVehicleInfo(1, 1);
        
        fm.setSendCallback([this](const std::string& msg) {
            sent_ws_messages.push_back(msg);
        });
        
        fm.setTransportCallback([this](const mavlink_message_t& msg) {
            sent_mavlink_messages.push_back(msg);
        });
    }

    void TearDown() override {
        sent_ws_messages.clear();
        sent_mavlink_messages.clear();
    }
    
    mavlink_message_t create_rc_channels(uint16_t ch5) {
        mavlink_message_t msg;
        mavlink_rc_channels_t rc = {};
        rc.chan5_raw = ch5;
        mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
        return msg;
    }
    
    mavlink_message_t create_heartbeat(uint32_t custom_mode, uint8_t base_mode) {
        mavlink_message_t msg;
        mavlink_heartbeat_t hb = {};
        hb.custom_mode = custom_mode;
        hb.base_mode = base_mode;
        mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);
        return msg;
    }
    
    mavlink_message_t create_param_value(const char* param_id, float value) {
        mavlink_message_t msg;
        mavlink_param_value_t pv = {};
        pv.param_value = value;
        std::strncpy(pv.param_id, param_id, 16);
        mavlink_msg_param_value_encode(1, 1, &msg, &pv);
        return msg;
    }
};

// UT-FM-001: Initialization and Wiring
TEST_F(FlightModeTest, InitializationAndWiring) {
    fm.pushStatus();
    ASSERT_EQ(sent_ws_messages.size(), 1);
    json j = json::parse(sent_ws_messages[0]);
    EXPECT_EQ(j["type"], "flight_mode_status");
    EXPECT_EQ(j["sysid"], 1);
    EXPECT_EQ(j["mode"], "STABILIZE");
}

// UT-FM-002: Mode Helpers Coverage
TEST_F(FlightModeTest, ModeHelpersCoverage) {
    EXPECT_EQ(FlightMode::modeFromName("AUTO"), CopterMode::AUTO);
    EXPECT_EQ(FlightMode::modeFromName("auto"), CopterMode::AUTO);
    EXPECT_EQ(FlightMode::modeFromName("UNKNOWN_MODE"), CopterMode::UNKNOWN);
    
    EXPECT_EQ(FlightMode::modeFromId(5), CopterMode::LOITER);
    EXPECT_EQ(FlightMode::modeFromId(255), CopterMode::UNKNOWN);
}

// UT-FM-003: RC Channels Parsing
TEST_F(FlightModeTest, RCChannelsParsing) {
    mavlink_message_t msg = create_rc_channels(1300);
    fm.processMessage(msg);
    
    ASSERT_GE(sent_ws_messages.size(), 2);
    
    bool pwm_found = false;
    bool status_found = false;
    for (const auto& ws : sent_ws_messages) {
        json j = json::parse(ws);
        if (j["type"] == "flight_mode_pwm") {
            EXPECT_EQ(j["slot"], 1);
            EXPECT_EQ(j["pwm"], 1300);
            pwm_found = true;
        } else if (j["type"] == "flight_mode_status") {
            EXPECT_EQ(j["slot"], 1);
            EXPECT_EQ(j["pwm"], 1300);
            EXPECT_EQ(j["mode"], "STABILIZE");
            status_found = true;
        }
    }
    EXPECT_TRUE(pwm_found);
    EXPECT_TRUE(status_found);
}

// UT-FM-004: Heartbeat Parsing (Arming and Mode override)
TEST_F(FlightModeTest, HeartbeatParsing) {
    mavlink_message_t msg = create_heartbeat(5, MAV_MODE_FLAG_SAFETY_ARMED);
    fm.processMessage(msg);
    
    ASSERT_GE(sent_ws_messages.size(), 2);
    
    bool armed_found = false;
    bool mode_found = false;
    for (const auto& ws : sent_ws_messages) {
        json j = json::parse(ws);
        if (j["type"] == "event" && j["event"] == "armed") {
            armed_found = true;
        } else if (j["type"] == "flight_mode_status") {
            EXPECT_EQ(j["mode"], "LOITER");
            mode_found = true;
        }
    }
    EXPECT_TRUE(armed_found);
    EXPECT_TRUE(mode_found);
}

// UT-FM-005: Param Value Handling
TEST_F(FlightModeTest, ParamValueHandling) {
    mavlink_message_t msg = create_param_value("FLTMODE3", 4.0f);
    fm.processMessage(msg);
    
    ASSERT_EQ(sent_ws_messages.size(), 1);
    json j = json::parse(sent_ws_messages[0]);
    EXPECT_EQ(j["type"], "flight_mode_param");
    EXPECT_EQ(j["slot"], 2);
    EXPECT_EQ(j["mode_id"], 4);
    EXPECT_EQ(j["mode"], "GUIDED");
    
    sent_ws_messages.clear();
    
    // Trigger RC channels in slot 2 (1400 pwm)
    msg = create_rc_channels(1400); 
    fm.processMessage(msg);
    
    bool found = false;
    for (const auto& ws : sent_ws_messages) {
        json j2 = json::parse(ws);
        if (j2["type"] == "flight_mode_status") {
            EXPECT_EQ(j2["mode"], "GUIDED");
            found = true;
        }
    }
    EXPECT_TRUE(found);
}

// UT-FM-006: Set Mode Command
TEST_F(FlightModeTest, SetModeCommand) {
    fm.setMode(CopterMode::AUTO);
    
    ASSERT_EQ(sent_mavlink_messages.size(), 1);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages[0], &cmd);
    
    EXPECT_EQ(cmd.command, MAV_CMD_DO_SET_MODE);
    EXPECT_EQ(cmd.param1, MAV_MODE_FLAG_CUSTOM_MODE_ENABLED);
    EXPECT_EQ(cmd.param2, 3.0f);
    
    // Testing warning when callback is not set
    FlightMode fm_empty;
    fm_empty.setMode(CopterMode::AUTO);
}

// UT-FM-007: Save Flight Modes
TEST_F(FlightModeTest, SaveFlightModes) {
    std::array<uint8_t, 6> modes = {0, 1, 2, 3, 4, 5};
    fm.saveFlightModes(modes);
    
    ASSERT_EQ(sent_mavlink_messages.size(), 6);
    
    for (int i = 0; i < 6; ++i) {
        mavlink_param_set_t ps;
        mavlink_msg_param_set_decode(&sent_mavlink_messages[i], &ps);
        EXPECT_EQ(ps.param_value, static_cast<float>(i));
        EXPECT_EQ(ps.param_type, MAV_PARAM_TYPE_INT32);
        
        std::string param_id(ps.param_id, strnlen(ps.param_id, 16));
        std::string expected = "FLTMODE" + std::to_string(i + 1);
        EXPECT_EQ(param_id, expected);
    }
    
    ASSERT_GE(sent_ws_messages.size(), 1);
    json j = json::parse(sent_ws_messages.back());
    EXPECT_EQ(j["type"], "flight_mode_saved");
    
    // Testing warning when callback is not set
    FlightMode fm_empty;
    fm_empty.saveFlightModes(modes);
}

// UT-FM-008: Request Params
TEST_F(FlightModeTest, RequestParams) {
    fm.requestParams();
    fm.resetParamsRequested();
    
    ASSERT_EQ(sent_mavlink_messages.size(), 6);
    
    for (int i = 0; i < 6; ++i) {
        mavlink_param_request_read_t req;
        mavlink_msg_param_request_read_decode(&sent_mavlink_messages[i], &req);
        
        std::string param_id(req.param_id, strnlen(req.param_id, 16));
        std::string expected = "FLTMODE" + std::to_string(i + 1);
        EXPECT_EQ(param_id, expected);
        EXPECT_EQ(req.param_index, -1);
    }
    
    // Testing warning when callback is not set
    FlightMode fm_empty;
    fm_empty.requestParams();
}
