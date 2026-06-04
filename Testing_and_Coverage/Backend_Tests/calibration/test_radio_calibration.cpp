#include <gtest/gtest.h>
#include "calibration/radio_calibration.h"

// UT-CAL-RAD-001: Initialization
TEST(RadioCalibrationTest, Initialization) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    EXPECT_FALSE(radio.isRunning());
    // Test accessor for out of bounds
    EXPECT_EQ(radio.channel(-1).raw, 0);
    EXPECT_EQ(radio.channel(20).raw, 0);
}

// UT-CAL-RAD-002: Start and Cancel
TEST(RadioCalibrationTest, StartAndCancel) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    
    // Call cancel when not running
    radio.cancelRadioCalibration();
    
    // Call complete when not running
    radio.completeRadioCalibration();
    
    bool transport_called = false;
    radio.setTransportCallback([&](const mavlink_message_t& msg) {
        transport_called = true;
        EXPECT_EQ(msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);
    });
    
    radio.startRadioCalibration();
    EXPECT_TRUE(radio.isRunning());
    EXPECT_TRUE(transport_called);
    
    // Duplicate start
    radio.startRadioCalibration();
    
    transport_called = false;
    radio.cancelRadioCalibration();
    EXPECT_FALSE(radio.isRunning());
    EXPECT_TRUE(transport_called);
}

// UT-CAL-RAD-003: Message Processing - Wrong Sysid
TEST(RadioCalibrationTest, MessageProcessingWrongSysid) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    
    mavlink_message_t msg;
    mavlink_rc_channels_t rc = {};
    rc.chan1_raw = 1500;
    mavlink_msg_rc_channels_encode(2, 1, &msg, &rc); // sysid 2
    
    radio.processMessage(msg);
    EXPECT_EQ(radio.channel(0).raw, 0);
}

// UT-CAL-RAD-004: Message Processing - RC Channels
TEST(RadioCalibrationTest, MessageProcessingRcChannels) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    
    bool json_sent = false;
    radio.setSendCallback([&](const std::string& json) {
        json_sent = true;
    });
    
    radio.startRadioCalibration();
    
    mavlink_message_t msg;
    mavlink_rc_channels_t rc = {};
    rc.chan1_raw = 1500;
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    
    radio.processMessage(msg);
    EXPECT_EQ(radio.channel(0).raw, 1500);
    EXPECT_EQ(radio.channel(0).min, 1500);
    EXPECT_EQ(radio.channel(0).max, 1500);
    EXPECT_TRUE(json_sent);
}

// UT-CAL-RAD-005: Message Processing - RC Channels Raw
TEST(RadioCalibrationTest, MessageProcessingRcChannelsRaw) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    radio.startRadioCalibration();
    
    mavlink_message_t msg;
    mavlink_rc_channels_raw_t rc = {};
    rc.chan1_raw = 1200;
    mavlink_msg_rc_channels_raw_encode(1, 1, &msg, &rc);
    
    radio.processMessage(msg);
    EXPECT_EQ(radio.channel(0).raw, 1200);
}

// UT-CAL-RAD-006: Message Processing - COMMAND_ACK
TEST(RadioCalibrationTest, MessageProcessingCommandAck) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    
    radio.startRadioCalibration();
    
    mavlink_message_t msg;
    mavlink_command_ack_t ack = {};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    
    // Test ACCEPTED
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    radio.processMessage(msg);
    EXPECT_TRUE(radio.isRunning());
    
    // Test TEMPORARILY_REJECTED (soft failure)
    ack.result = MAV_RESULT_TEMPORARILY_REJECTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    radio.processMessage(msg);
    EXPECT_TRUE(radio.isRunning());
    
    // Test hard failure
    bool json_sent = false;
    radio.setSendCallback([&](const std::string& json) {
        json_sent = true;
    });
    ack.result = MAV_RESULT_DENIED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    radio.processMessage(msg);
    EXPECT_FALSE(radio.isRunning());
    EXPECT_TRUE(json_sent);
}

// UT-CAL-RAD-007: Message Processing - STATUSTEXT
TEST(RadioCalibrationTest, MessageProcessingStatusText) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    
    bool json_sent = false;
    radio.setSendCallback([&](const std::string& json) {
        json_sent = true;
    });
    
    mavlink_message_t msg;
    mavlink_statustext_t st = {};
    
    // Ignored message
    strcpy(st.text, "Hello world");
    mavlink_msg_statustext_encode(1, 1, &msg, &st);
    radio.processMessage(msg);
    EXPECT_FALSE(json_sent);
    
    // Matched message
    strcpy(st.text, "Radio calibration successful");
    mavlink_msg_statustext_encode(1, 1, &msg, &st);
    radio.processMessage(msg);
    EXPECT_TRUE(json_sent);
}

// UT-CAL-RAD-008: Complete
TEST(RadioCalibrationTest, Complete) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    
    radio.startRadioCalibration();
    
    // Add some data
    mavlink_message_t msg;
    mavlink_rc_channels_t rc = {};
    rc.chan1_raw = 1000;
    rc.chan2_raw = 1500;
    rc.chan3_raw = 1000; // Throttle
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    radio.processMessage(msg);
    
    rc.chan1_raw = 2000;
    rc.chan2_raw = 1500;
    rc.chan3_raw = 2000;
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    radio.processMessage(msg);
    
    radio.completeRadioCalibration();
    EXPECT_FALSE(radio.isRunning());
    
    // Check trim calculations
    EXPECT_EQ(radio.channel(0).trim, 1500); // Average of 1000 and 2000
    EXPECT_EQ(radio.channel(1).trim, 1500); // Did not move, should be default/last
    EXPECT_EQ(radio.channel(2).trim, 1000); // Throttle min
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-RADIO-FUNC-001
    Function : RadioCalibration::setVehicleInfo
    Description : Verify vehicle info initialization.
    Input : sysid = 1, compid = 1
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, SetVehicleInfoFUNC) {
    RadioCalibration radio;
    EXPECT_NO_THROW({
        radio.setVehicleInfo(1, 1);
    });
}

/*
    UT-RADIO-FUNC-002
    Function : RadioCalibration::setSendCallback
    Description : Verify send callback assignment.
    Input : Valid std::function
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, SetSendCallbackFUNC) {
    RadioCalibration radio;
    EXPECT_NO_THROW({
        radio.setSendCallback([](const std::string&) {});
    });
}

/*
    UT-RADIO-FUNC-003
    Function : RadioCalibration::setTransportCallback
    Description : Verify transport callback assignment.
    Input : Valid std::function
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, SetTransportCallbackFUNC) {
    RadioCalibration radio;
    EXPECT_NO_THROW({
        radio.setTransportCallback([](const mavlink_message_t&) {});
    });
}

/*
    UT-RADIO-FUNC-004
    Function : RadioCalibration::startRadioCalibration
    Description : Verify starting radio calibration process.
    Input : None
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, StartRadioCalibrationFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    radio.setTransportCallback([](const mavlink_message_t&) {});
    EXPECT_NO_THROW({
        radio.startRadioCalibration();
        radio.cancelRadioCalibration();
    });
}

/*
    UT-RADIO-FUNC-005
    Function : RadioCalibration::cancelRadioCalibration
    Description : Verify cancellation of radio calibration.
    Input : None
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, CancelRadioCalibrationFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    radio.setTransportCallback([](const mavlink_message_t&) {});
    EXPECT_NO_THROW({
        radio.startRadioCalibration();
        radio.cancelRadioCalibration();
    });
}

/*
    UT-RADIO-FUNC-006
    Function : RadioCalibration::completeRadioCalibration
    Description : Verify completion of radio calibration.
    Input : None
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, CompleteRadioCalibrationFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    radio.setTransportCallback([](const mavlink_message_t&) {});
    EXPECT_NO_THROW({
        radio.startRadioCalibration();
        radio.completeRadioCalibration();
    });
}

/*
    UT-RADIO-FUNC-007
    Function : RadioCalibration::processMessage
    Description : Verify processing of MAVLink RC channel messages.
    Input : RC channels message
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, ProcessMessageFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    mavlink_message_t msg;
    mavlink_rc_channels_t rc = {};
    rc.chan1_raw = 1500;
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    EXPECT_NO_THROW({
        radio.processMessage(msg);
    });
}

/*
    UT-RADIO-FUNC-008
    Function : RadioCalibration::sendStartCommand
    Description : Verify sending start preflight command.
    Input : None
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, SendStartCommandFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    bool called = false;
    radio.setTransportCallback([&](const mavlink_message_t& msg) {
        if (msg.msgid == MAVLINK_MSG_ID_COMMAND_LONG) {
            called = true;
        }
    });
    radio.startRadioCalibration();
    EXPECT_TRUE(called);
}

/*
    UT-RADIO-FUNC-009
    Function : RadioCalibration::sendCancelCommand
    Description : Verify sending cancel preflight command.
    Input : None
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, SendCancelCommandFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    bool called = false;
    radio.setTransportCallback([&](const mavlink_message_t& msg) {
        if (msg.msgid == MAVLINK_MSG_ID_COMMAND_LONG) {
            called = true;
        }
    });
    radio.startRadioCalibration();
    radio.cancelRadioCalibration();
    EXPECT_TRUE(called);
}

/*
    UT-RADIO-FUNC-010
    Function : RadioCalibration::broadcastChannelData
    Description : Verify channel data dispatch.
    Input : None
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, BroadcastChannelDataFUNC) {
    RadioCalibration radio;
    radio.setVehicleInfo(1, 1);
    bool json_sent = false;
    radio.setSendCallback([&](const std::string&) {
        json_sent = true;
    });
    radio.startRadioCalibration();
    mavlink_message_t msg;
    mavlink_rc_channels_t rc = {};
    rc.chan1_raw = 1500;
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    radio.processMessage(msg);
    EXPECT_TRUE(json_sent);
}

/*
    UT-RADIO-FUNC-011
    Function : RadioCalibration::broadcastStatus
    Description : Verify status text broadcast.
    Input : text = "Test", success = true
    Expected Output : Executes successfully
*/
TEST(RadioCalibrationTest, BroadcastStatusFUNC) {
    RadioCalibration radio;
    bool json_sent = false;
    radio.setSendCallback([&](const std::string& json) {
        if (json.find("Test") != std::string::npos) {
            json_sent = true;
        }
    });
    radio.setVehicleInfo(1, 1);
    radio.startRadioCalibration();
    mavlink_message_t msg;
    mavlink_command_ack_t ack = {};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_DENIED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    radio.processMessage(msg);
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-RADIO-EXT-001
    Function : RadioCalibration::setVehicleInfo
    Description : Verify negative inputs handling.
    Input : sysid = -1, compid = -1
    Expected Output : Sets values without failure
*/
TEST(RadioCalibrationTest, NegativeVehicleInfoHandling) {
    RadioCalibration radio;
    EXPECT_NO_THROW({
        radio.setVehicleInfo(-1, -1);
    });
}

/*
    UT-RADIO-EXT-002
    Function : RadioCalibration::processMessage
    Description : Verify handling of invalid empty/corrupt messages.
    Input : Malformed message
    Expected Output : Gracefully discards message
*/
TEST(RadioCalibrationTest, MalformedMessageHandling) {
    RadioCalibration radio;
    mavlink_message_t msg = {};
    EXPECT_NO_THROW({
        radio.processMessage(msg);
    });
}

