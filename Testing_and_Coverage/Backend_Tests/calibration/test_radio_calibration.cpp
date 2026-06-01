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
