#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <array>
#include <nlohmann/json.hpp>
#include <mavlink/ardupilotmega/mavlink.h>
#include "calibration/radio_calibration.h"

using json = nlohmann::json;

// ─── Accessors for Private Members ──────────────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct RadioCalibRunningTag {
    typedef bool RadioCalibration::*type;
    friend type get(RadioCalibRunningTag);
};
template struct PrivateAccessor<RadioCalibRunningTag, &RadioCalibration::running_>;

struct RadioCalibAccumulatingTag {
    typedef bool RadioCalibration::*type;
    friend type get(RadioCalibAccumulatingTag);
};
template struct PrivateAccessor<RadioCalibAccumulatingTag, &RadioCalibration::accumulating_>;


class RadioCalibrationTest : public ::testing::Test {
protected:
    RadioCalibration calib_;
    std::vector<std::string> sent_json_messages_;
    std::vector<mavlink_message_t> sent_mavlink_messages_;

    void SetUp() override {
        sent_json_messages_.clear();
        sent_mavlink_messages_.clear();

        calib_.setSendCallback([this](const std::string& msg) {
            sent_json_messages_.push_back(msg);
        });

        calib_.setTransportCallback([this](const mavlink_message_t& msg) {
            sent_mavlink_messages_.push_back(msg);
        });

        calib_.setVehicleInfo(1, 1);
    }
};

// UT-RC-001: Initialization state
TEST_F(RadioCalibrationTest, Initialization_DefaultsAreCorrect) {
    EXPECT_FALSE(calib_.isRunning());
    
    // Check channel structures are clean
    for (int i = 0; i < RadioCalibration::NUM_CHANNELS; ++i) {
        auto ch = calib_.channel(i);
        EXPECT_EQ(ch.raw, 0);
        EXPECT_EQ(ch.min, 65535);
        EXPECT_EQ(ch.max, 0);
        EXPECT_EQ(ch.trim, 1500);
    }
}

// UT-RC-002: Start calibration state and command sending
TEST_F(RadioCalibrationTest, Start_DisarmedResetsChannelsAndSendsCommand) {
    // Act
    calib_.startRadioCalibration();

    // Assert
    EXPECT_TRUE(calib_.isRunning());
    
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_message_t start_msg = sent_mavlink_messages_.back();
    EXPECT_EQ(start_msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);

    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&start_msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_PREFLIGHT_CALIBRATION);
    EXPECT_FLOAT_EQ(cmd.param4, 1.0f); // Radio calibration ON

    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "radio_calibration_status");
    EXPECT_TRUE(response["message"].get<std::string>().find("started") != std::string::npos);
}

// UT-RC-003: Ingest RC_CHANNELS message updates min/max values
TEST_F(RadioCalibrationTest, Ingest_RcChannelsUpdatesMinMaxRanges) {
    // Arrange: start calibration to enable accumulation
    calib_.startRadioCalibration();
    sent_json_messages_.clear();

    // Message 1: mid sticks
    mavlink_message_t msg1;
    mavlink_rc_channels_t rc1{};
    rc1.chan1_raw = 1500;
    rc1.chan2_raw = 1500;
    rc1.chan3_raw = 1100; // Throttle min
    rc1.chan4_raw = 1500;
    mavlink_msg_rc_channels_encode(1, 1, &msg1, &rc1);

    // Message 2: extreme sticks
    mavlink_message_t msg2;
    mavlink_rc_channels_t rc2{};
    rc2.chan1_raw = 1000; // roll min
    rc2.chan2_raw = 2000; // pitch max
    rc2.chan3_raw = 1900; // throttle max
    rc2.chan4_raw = 1500;
    mavlink_msg_rc_channels_encode(1, 1, &msg2, &rc2);

    // Act
    calib_.processMessage(msg1);
    calib_.processMessage(msg2);

    // Assert
    auto ch1 = calib_.channel(0); // Roll
    EXPECT_EQ(ch1.raw, 1000);
    EXPECT_EQ(ch1.min, 1000);
    EXPECT_EQ(ch1.max, 1500);

    auto ch2 = calib_.channel(1); // Pitch
    EXPECT_EQ(ch2.raw, 2000);
    EXPECT_EQ(ch2.min, 1500);
    EXPECT_EQ(ch2.max, 2000);

    auto ch3 = calib_.channel(2); // Throttle
    EXPECT_EQ(ch3.raw, 1900);
    EXPECT_EQ(ch3.min, 1100);
    EXPECT_EQ(ch3.max, 1900);

    // Live channel data should have been broadcasted via WebSocket
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "rc_channels");
}

// UT-RC-004: Ingest Command Ack soft and hard results
TEST_F(RadioCalibrationTest, Ingest_CommandAckSoftVsHardRejections) {
    // Arrange
    calib_.startRadioCalibration();
    auto running_ptr = get(RadioCalibRunningTag{});
    auto accumulating_ptr = get(RadioCalibAccumulatingTag{});

    // Case 1: soft rejection (TEMPORARILY_REJECTED). Accumulation should stay alive.
    mavlink_message_t msg1;
    mavlink_command_ack_t ack1{};
    ack1.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack1.result = MAV_RESULT_TEMPORARILY_REJECTED;
    mavlink_msg_command_ack_encode(1, 1, &msg1, &ack1);

    calib_.processMessage(msg1);
    EXPECT_TRUE(calib_.*running_ptr);
    EXPECT_TRUE(calib_.*accumulating_ptr); // remains true!

    // Case 2: hard rejection (DENIED). Accumulation should shut down.
    mavlink_message_t msg2;
    mavlink_command_ack_t ack2{};
    ack2.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack2.result = MAV_RESULT_DENIED;
    mavlink_msg_command_ack_encode(1, 1, &msg2, &ack2);

    calib_.processMessage(msg2);
    EXPECT_FALSE(calib_.*running_ptr);
    EXPECT_FALSE(calib_.*accumulating_ptr); // cleared!
}

// UT-RC-005: Complete calibration computes correct trims
TEST_F(RadioCalibrationTest, Complete_CalculatesTrimsAndEmitsReport) {
    // Arrange
    calib_.startRadioCalibration();

    // Ingest some data
    mavlink_message_t msg;
    mavlink_rc_channels_t rc{};
    rc.chan1_raw = 1000; // Roll min
    rc.chan2_raw = 1500;
    rc.chan3_raw = 1100; // Throttle min
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    calib_.processMessage(msg);

    rc.chan1_raw = 2000; // Roll max
    rc.chan3_raw = 1900; // Throttle max
    mavlink_msg_rc_channels_encode(1, 1, &msg, &rc);
    calib_.processMessage(msg);

    sent_json_messages_.clear();

    // Act
    calib_.completeRadioCalibration();

    // Assert: Check trims
    auto roll_ch = calib_.channel(0);
    EXPECT_EQ(roll_ch.trim, 1500); // (1000 + 2000) / 2
    
    auto throttle_ch = calib_.channel(2);
    EXPECT_EQ(throttle_ch.trim, 1100); // Throttle trim = min (1100)

    EXPECT_FALSE(calib_.isRunning());

    ASSERT_GE(sent_json_messages_.size(), 1u);
    json last_response = json::parse(sent_json_messages_[0]);
    EXPECT_EQ(last_response["type"], "radio_calibration_complete");
    EXPECT_TRUE(last_response["success"]);
    
    // Check channel list contains roll and throttle
    json chs = last_response["channels"];
    ASSERT_GE(chs.size(), 2u);
    
    EXPECT_EQ(chs[0]["channel"], 1);
    EXPECT_EQ(chs[0]["min"], 1000);
    EXPECT_EQ(chs[0]["max"], 2000);
    EXPECT_TRUE(chs[0]["moved"]);
}

// UT-RC-006: Cancel radio calibration
TEST_F(RadioCalibrationTest, Cancel_SendsCancelCommandAndHalts) {
    // Arrange
    calib_.startRadioCalibration();
    sent_mavlink_messages_.clear();

    // Act
    calib_.cancelRadioCalibration();

    // Assert
    EXPECT_FALSE(calib_.isRunning());
    
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_.back(), &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_PREFLIGHT_CALIBRATION);
    EXPECT_FLOAT_EQ(cmd.param4, 0.0f); // Radio calibration OFF
}

// UT-RC-007: Start calibration when already accumulating
TEST_F(RadioCalibrationTest, Start_AlreadyAccumulatingIgnores) {
    calib_.startRadioCalibration();
    sent_json_messages_.clear();
    
    // Attempt second start
    calib_.startRadioCalibration();
    
    // Verify no new message was sent
    EXPECT_TRUE(sent_json_messages_.empty());
}

// UT-RC-008: Cancel calibration when not accumulating
TEST_F(RadioCalibrationTest, Cancel_NotAccumulatingIgnores) {
    sent_mavlink_messages_.clear();
    calib_.cancelRadioCalibration();
    EXPECT_TRUE(sent_mavlink_messages_.empty());
}

// UT-RC-009: Complete calibration when not accumulating
TEST_F(RadioCalibrationTest, Complete_NotAccumulatingIgnores) {
    sent_json_messages_.clear();
    calib_.completeRadioCalibration();
    EXPECT_TRUE(sent_json_messages_.empty());
}

// UT-RC-010: Ingest ignores messages from mismatched sysid
TEST_F(RadioCalibrationTest, Ingest_IgnoresMismatchedSysid) {
    calib_.startRadioCalibration();
    
    mavlink_message_t msg;
    mavlink_rc_channels_t rc{};
    rc.chan1_raw = 1200;
    // msg has sysid = 2, but vehicle set to 1
    mavlink_msg_rc_channels_encode(2, 1, &msg, &rc);

    calib_.processMessage(msg);
    EXPECT_EQ(calib_.channel(0).raw, 0); // unchanged
}

// UT-RC-011: Legacy RC_CHANNELS_RAW message updates channel ranges
TEST_F(RadioCalibrationTest, Ingest_RcChannelsRawUpdatesMinMax) {
    calib_.startRadioCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_rc_channels_raw_t rc{};
    rc.chan1_raw = 1100;
    rc.chan2_raw = 1900;
    mavlink_msg_rc_channels_raw_encode(1, 1, &msg, &rc);

    calib_.processMessage(msg);

    EXPECT_EQ(calib_.channel(0).raw, 1100);
    EXPECT_EQ(calib_.channel(0).min, 1100);
    EXPECT_EQ(calib_.channel(1).raw, 1900);
    EXPECT_EQ(calib_.channel(1).max, 1900);
    EXPECT_FALSE(sent_json_messages_.empty());
}

// UT-RC-012: Ingest COMMAND_ACK ACCEPTED result logs correctly
TEST_F(RadioCalibrationTest, Ingest_CommandAckAccepted) {
    calib_.startRadioCalibration();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    // Should process without disabling calibration
    calib_.processMessage(msg);
    EXPECT_TRUE(calib_.isRunning());
}

// UT-RC-013: Relays relevant STATUSTEXT messages
TEST_F(RadioCalibrationTest, Ingest_StatusTextRelayed) {
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_statustext_t st{};
    strcpy(st.text, "Radio calibration active");
    mavlink_msg_statustext_encode(1, 1, &msg, &st);

    calib_.processMessage(msg);

    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "radio_calibration_status");
    EXPECT_EQ(response["message"], "Radio calibration active");
}

// UT-RC-014: channel() out of bounds returns dummy data
TEST_F(RadioCalibrationTest, Channel_OutOfBoundsReturnsDummy) {
    auto dummy = calib_.channel(-1);
    EXPECT_EQ(dummy.raw, 0);
    
    auto dummy2 = calib_.channel(99);
    EXPECT_EQ(dummy2.raw, 0);
}

// UT-RC-015: Warnings when no transport callback is configured
TEST_F(RadioCalibrationTest, NoTransportCallbackWarnings) {
    RadioCalibration local_calib;
    local_calib.setVehicleInfo(1, 1);
    
    // Call start/cancel without transport callback. Should not crash.
    local_calib.startRadioCalibration();
    local_calib.cancelRadioCalibration();
}

