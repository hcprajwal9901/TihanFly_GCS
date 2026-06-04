#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "Flightmode/flight_mode.h"
#include <nlohmann/json.hpp>
#include <vector>
#include <string>
#include <thread>
#include <limits>

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




/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/


/*
===============================================================================
    FLIGHT_MODE.CPP FUNCTIONAL TEST CASES
===============================================================================
*/

/*
    UT-FM-FUNC-001
    Function : FlightMode::modeName
    Description : Handles functionality for mode name.
    Input : CopterMode::AUTO
    Expected Output : "AUTO"
*/
TEST_F(FlightModeTest, ModeNameValidation)
{
    EXPECT_EQ(
        FlightMode::modeName(CopterMode::AUTO),
        "AUTO"
    );
}

/*
    UT-FM-FUNC-002
    Function : FlightMode::modeFromName
    Description : Handles functionality for mode from name.
    Input : "AUTO"
    Expected Output : CopterMode::AUTO
*/
TEST_F(FlightModeTest, ModeFromNameValidation)
{
    EXPECT_EQ(
        FlightMode::modeFromName("AUTO"),
        CopterMode::AUTO
    );
}

/*
    UT-FM-FUNC-003
    Function : FlightMode::modeFromId
    Description : Handles functionality for mode from id.
    Input : 5
    Expected Output : CopterMode::LOITER
*/
TEST_F(FlightModeTest, ModeFromIdValidation)
{
    EXPECT_EQ(
        FlightMode::modeFromId(5),
        CopterMode::LOITER
    );
}

/*
    UT-FM-FUNC-004
    Function : FlightMode::setVehicleInfo
    Description : Sets vehicle info.
    Input : sysid = 1, compid = 1
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, SetVehicleInfoValidation)
{
    EXPECT_NO_THROW({
        fm.setVehicleInfo(1, 1);
    });
}

/*
    UT-FM-FUNC-005
    Function : FlightMode::setSendCallback
    Description : Sets send callback.
    Input : callback function
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, SetSendCallbackValidation)
{
    EXPECT_NO_THROW({

        fm.setSendCallback(
            [](const std::string& msg) {}
        );

    });
}

/*
    UT-FM-FUNC-006
    Function : FlightMode::setTransportCallback
    Description : Sets transport callback.
    Input : callback function
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, SetTransportCallbackValidation)
{
    EXPECT_NO_THROW({

        fm.setTransportCallback(
            [](const mavlink_message_t& msg) {}
        );

    });
}

/*
    UT-FM-FUNC-007
    Function : FlightMode::pushStatus
    Description : Pushes current status.
    Input : None
    Expected Output : flight_mode_status JSON sent
*/
TEST_F(FlightModeTest, PushStatusValidation)
{
    fm.pushStatus();

    ASSERT_EQ(sent_ws_messages.size(), 1);

    json j = json::parse(sent_ws_messages[0]);

    EXPECT_EQ(j["type"], "flight_mode_status");
}

/*
    UT-FM-FUNC-008
    Function : FlightMode::processMessage
    Description : Processes MAVLink message.
    Input : RC_CHANNELS message
    Expected Output : flight_mode_pwm JSON sent
*/
TEST_F(FlightModeTest, ProcessMessageValidation)
{
    mavlink_message_t msg = create_rc_channels(1300);

    fm.processMessage(msg);

    bool found = false;

    for (const auto& ws : sent_ws_messages)
    {
        json j = json::parse(ws);

        if (j["type"] == "flight_mode_pwm")
        {
            EXPECT_EQ(j["pwm"], 1300);
            found = true;
        }
    }

    EXPECT_TRUE(found);
}

/*
    UT-FM-FUNC-009
    Function : FlightMode::setMode
    Description : Sets flight mode.
    Input : CopterMode::AUTO
    Expected Output : MAV_CMD_DO_SET_MODE sent
*/
TEST_F(FlightModeTest, SetModeValidation)
{
    fm.setMode(CopterMode::AUTO);

    ASSERT_EQ(sent_mavlink_messages.size(), 1);

    mavlink_command_long_t cmd;

    mavlink_msg_command_long_decode(
        &sent_mavlink_messages[0],
        &cmd
    );

    EXPECT_EQ(cmd.command, MAV_CMD_DO_SET_MODE);
}

/*
    UT-FM-FUNC-010
    Function : FlightMode::saveFlightModes
    Description : Saves flight modes.
    Input : {0,1,2,3,4,5}
    Expected Output : 6 PARAM_SET messages sent
*/
TEST_F(FlightModeTest, SaveFlightModesValidation)
{
    std::array<uint8_t, 6> modes =
    {
        0, 1, 2, 3, 4, 5
    };

    fm.saveFlightModes(modes);

    EXPECT_EQ(sent_mavlink_messages.size(), 6);
}

/*
    UT-FM-FUNC-011
    Function : FlightMode::pwmToSlot
    Description : Handles PWM to slot conversion.
    Input : PWM = 1300
    Expected Output : slot = 1
*/
TEST_F(FlightModeTest, PWMToSlotValidation)
{
    mavlink_message_t msg = create_rc_channels(1300);

    fm.processMessage(msg);

    bool found = false;

    for (const auto& ws : sent_ws_messages)
    {
        json j = json::parse(ws);

        if (j["type"] == "flight_mode_status")
        {
            EXPECT_EQ(j["slot"], 1);
            found = true;
        }
    }

    EXPECT_TRUE(found);
}

/*
    UT-FM-FUNC-012
    Function : FlightMode::broadcastStatus
    Description : Broadcasts flight status.
    Input : Status message
    Expected Output : flight_mode_status JSON generated
*/
TEST_F(FlightModeTest, BroadcastStatusValidation)
{
    fm.pushStatus();

    ASSERT_EQ(sent_ws_messages.size(), 1);

    json j = json::parse(sent_ws_messages[0]);

    EXPECT_EQ(j["type"], "flight_mode_status");
}

/*
    UT-FM-FUNC-013
    Function : FlightMode::sendParamSet
    Description : Sends parameter set.
    Input : Flight mode values
    Expected Output : PARAM_SET MAVLink messages sent
*/
TEST_F(FlightModeTest, SendParamSetValidation)
{
    std::array<uint8_t, 6> modes =
    {
        0, 1, 2, 3, 4, 5
    };

    fm.saveFlightModes(modes);

    ASSERT_EQ(sent_mavlink_messages.size(), 6);

    mavlink_param_set_t ps;

    mavlink_msg_param_set_decode(
        &sent_mavlink_messages[0],
        &ps
    );

    EXPECT_EQ(ps.param_value, 0);
}

/*
    UT-FM-FUNC-014
    Function : FlightMode::requestParams
    Description : Requests flight mode parameters.
    Input : None
    Expected Output : 6 PARAM_REQUEST_READ messages sent
*/
TEST_F(FlightModeTest, RequestParamsValidation)
{
    fm.requestParams();

    ASSERT_EQ(sent_mavlink_messages.size(), 6);

    mavlink_param_request_read_t req;

    mavlink_msg_param_request_read_decode(
        &sent_mavlink_messages[0],
        &req
    );

    EXPECT_EQ(req.param_index, -1);
}




/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-FM-EXT-001
    Function : FlightMode::modeFromName
    Description : Validate invalid mode string handling.
    Input : "INVALID_MODE"
    Expected Output : CopterMode::UNKNOWN
*/
TEST_F(FlightModeTest, InvalidModeStringHandling)
{
    EXPECT_EQ(
        FlightMode::modeFromName("INVALID_MODE"),
        CopterMode::UNKNOWN
    );
}

/*
    UT-FM-EXT-002
    Function : FlightMode::modeFromId
    Description : Validate invalid mode ID handling.
    Input : 255
    Expected Output : CopterMode::UNKNOWN
*/
TEST_F(FlightModeTest, InvalidModeIdHandling)
{
    EXPECT_EQ(
        FlightMode::modeFromId(255),
        CopterMode::UNKNOWN
    );
}

/*
    UT-FM-EXT-003
    Function : FlightMode::processMessage
    Description : Validate minimum PWM handling.
    Input : PWM = 0
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, MinimumPWMHandling)
{
    mavlink_message_t msg =
        create_rc_channels(999);

    EXPECT_NO_THROW({
        fm.processMessage(msg);
    });
}

/*
    UT-FM-EXT-004
    Function : FlightMode::processMessage
    Description : Validate maximum PWM handling.
    Input : PWM = 65535
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, MaximumPWMHandling)
{
    mavlink_message_t msg =
        create_rc_channels(2001);

    EXPECT_NO_THROW({
        fm.processMessage(msg);
    });
}

/*
    UT-FM-EXT-005
    Function : FlightMode::processMessage
    Description : Validate invalid heartbeat mode.
    Input : custom_mode = 9999
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, InvalidHeartbeatModeHandling)
{
    mavlink_message_t msg =
        create_heartbeat(
            9999,
            MAV_MODE_FLAG_SAFETY_ARMED
        );

    EXPECT_NO_THROW({
        fm.processMessage(msg);
    });
}

/*
    UT-FM-EXT-006
    Function : FlightMode::processMessage
    Description : Validate empty parameter ID.
    Input : ""
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, EmptyParameterIdHandling)
{
    mavlink_message_t msg =
        create_param_value("", 0);

    EXPECT_NO_THROW({
        fm.processMessage(msg);
    });
}

/*
    UT-FM-EXT-007
    Function : FlightMode::processMessage
    Description : Validate huge parameter value.
    Input : float max value
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, HugeParameterValueHandling)
{
    mavlink_message_t msg =
        create_param_value(
            "FLTMODE1",
            std::numeric_limits<float>::max()
        );

    EXPECT_NO_THROW({
        fm.processMessage(msg);
    });
}

/*
    UT-FM-EXT-008
    Function : FlightMode::setMode
    Description : Validate null transport callback handling.
    Input : AUTO mode
    Expected Output : Executes successfully
*/
TEST(FlightModeStandaloneTest, SetModeWithoutCallback)
{
    FlightMode fm;

    EXPECT_NO_THROW({
        fm.setMode(CopterMode::AUTO);
    });
}

/*
    UT-FM-EXT-009
    Function : FlightMode::requestParams
    Description : Validate requestParams without callback.
    Input : None
    Expected Output : Executes successfully
*/
TEST(FlightModeStandaloneTest, RequestParamsWithoutCallback)
{
    FlightMode fm;

    EXPECT_NO_THROW({
        fm.requestParams();
    });
}

/*
    UT-FM-EXT-010
    Function : FlightMode::saveFlightModes
    Description : Validate saveFlightModes without callback.
    Input : {0,1,2,3,4,5}
    Expected Output : Executes successfully
*/
TEST(FlightModeStandaloneTest, SaveFlightModesWithoutCallback)
{
    FlightMode fm;

    std::array<uint8_t, 6> modes =
    {
        0, 1, 2, 3, 4, 5
    };

    EXPECT_NO_THROW({
        fm.saveFlightModes(modes);
    });
}

/*
    UT-FM-EXT-011
    Function : FlightMode::processMessage
    Description : Validate repeated RC message handling.
    Input : 1000 RC messages
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, ContinuousRCStressHandling)
{
    for (int i = 0; i < 1000; ++i)
    {
        mavlink_message_t msg =
            create_rc_channels(
                1000 + (i % 1000)
            );

        EXPECT_NO_THROW({
            fm.processMessage(msg);
        });
    }
}

/*
    UT-FM-EXT-012
    Function : FlightMode::processMessage
    Description : Validate repeated heartbeat handling.
    Input : 500 heartbeat messages
    Expected Output : Executes successfully
*/
TEST_F(FlightModeTest, ContinuousHeartbeatStressHandling)
{
    for (int i = 0; i < 500; ++i)
    {
        mavlink_message_t msg =
            create_heartbeat(
                i % 10,
                MAV_MODE_FLAG_SAFETY_ARMED
            );

        EXPECT_NO_THROW({
            fm.processMessage(msg);
        });
    }
}


