#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>
#include <nlohmann/json.hpp>
#include <mavlink/ardupilotmega/mavlink.h>
#include "calibration/accel_calibration.h"

using json = nlohmann::json;

// ─── Accessors for Private Members ──────────────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct AccelCalibArmedTag {
    typedef bool AccelCalibration::*type;
    friend type get(AccelCalibArmedTag);
};
template struct PrivateAccessor<AccelCalibArmedTag, &AccelCalibration::armed_>;

struct AccelCalibRollTag {
    typedef float AccelCalibration::*type;
    friend type get(AccelCalibRollTag);
};
template struct PrivateAccessor<AccelCalibRollTag, &AccelCalibration::roll_>;

struct AccelCalibPitchTag {
    typedef float AccelCalibration::*type;
    friend type get(AccelCalibPitchTag);
};
template struct PrivateAccessor<AccelCalibPitchTag, &AccelCalibration::pitch_>;

struct AccelCalibStartSentAtTag {
    typedef std::chrono::steady_clock::time_point AccelCalibration::*type;
    friend type get(AccelCalibStartSentAtTag);
};
template struct PrivateAccessor<AccelCalibStartSentAtTag, &AccelCalibration::calibStartSentAt_>;

struct AccelCalibStepDeadlineTag {
    typedef std::chrono::steady_clock::time_point AccelCalibration::*type;
    friend type get(AccelCalibStepDeadlineTag);
};
template struct PrivateAccessor<AccelCalibStepDeadlineTag, &AccelCalibration::stepDeadline_>;

struct AccelCalibStepTimeoutArmedTag {
    typedef std::atomic<bool> AccelCalibration::*type;
    friend type get(AccelCalibStepTimeoutArmedTag);
};
template struct PrivateAccessor<AccelCalibStepTimeoutArmedTag, &AccelCalibration::stepTimeoutArmed_>;

struct AccelCalibStepTimeoutCvTag {
    typedef std::condition_variable AccelCalibration::*type;
    friend type get(AccelCalibStepTimeoutCvTag);
};
template struct PrivateAccessor<AccelCalibStepTimeoutCvTag, &AccelCalibration::stepTimeoutCv_>;

struct AccelCalibMavlinkMsgNameTag {
    typedef std::string (*type)(uint32_t);
    friend type get(AccelCalibMavlinkMsgNameTag);
};
template struct PrivateAccessor<AccelCalibMavlinkMsgNameTag, &AccelCalibration::mavlinkMsgName>;

struct AccelCalibStepIndexTag {
    typedef int AccelCalibration::*type;
    friend type get(AccelCalibStepIndexTag);
};
template struct PrivateAccessor<AccelCalibStepIndexTag, &AccelCalibration::stepIndex_>;

static mavlink_message_t local_make_heartbeat(uint8_t sysid, uint8_t compid) {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(sysid, compid, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    return msg;
}

class AccelCalibrationTest : public ::testing::Test {
protected:
    AccelCalibration calib_;
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

    void TearDown() override {
    }
};

// UT-AC-001: Initialization state
TEST_F(AccelCalibrationTest, Initialization_DefaultsAreCorrect) {
    // Assert
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::IDLE);
    EXPECT_EQ(calib_.pendingPosition, 0);
}

// UT-AC-002: Rejects Start If Armed
TEST_F(AccelCalibrationTest, Start_ArmedRejectsImmediately) {
    // Arrange
    auto armed_ptr = get(AccelCalibArmedTag{});
    calib_.*armed_ptr = true;

    // Act
    calib_.startAccelCalibration();

    // Assert
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::IDLE);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calibration_result");
    EXPECT_EQ(response["step"], "failed");
    EXPECT_TRUE(response.contains("message"));
}

// UT-AC-003: Disarmed Start Happy Path
TEST_F(AccelCalibrationTest, Start_DisarmedSendsCalibrationCommand) {
    // Arrange
    auto armed_ptr = get(AccelCalibArmedTag{});
    calib_.*armed_ptr = false;

    // Act
    calib_.startAccelCalibration();

    // Assert
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::IN_PROGRESS);
    
    // Should send cancel command first, then start command (param5=1)
    ASSERT_GE(sent_mavlink_messages_.size(), 2u);
    
    mavlink_message_t start_msg = sent_mavlink_messages_[1];
    EXPECT_EQ(start_msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);
    
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&start_msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_PREFLIGHT_CALIBRATION);
    EXPECT_FLOAT_EQ(cmd.param5, 1.0f); // Accelerometer Calib
}

// UT-AC-004: Accept Start from Drone
TEST_F(AccelCalibrationTest, Ingest_PreflightAckAccepted) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    // Act
    calib_.processMessage(msg);

    // Assert
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calibration_status");
    EXPECT_EQ(response["step"], "started");
}

// UT-AC-005: Reject Start from Drone
TEST_F(AccelCalibrationTest, Ingest_PreflightAckRejectedFails) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_DENIED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::FAILED);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calibration_result");
    EXPECT_EQ(response["step"], "failed");
}

// UT-AC-006: Telemetry attitude broadcast
TEST_F(AccelCalibrationTest, Telemetry_ForwardsAttitudeWhenInProgress) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_attitude_t att{};
    att.roll = 0.1f;
    att.pitch = -0.2f;
    att.yaw = 1.5f;
    mavlink_msg_attitude_encode(1, 1, &msg, &att);

    // Act
    calib_.processMessage(msg);

    // Assert
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calib_attitude");
    EXPECT_FLOAT_EQ(response["roll"], 0.1f);
    EXPECT_FLOAT_EQ(response["pitch"], -0.2f);
    EXPECT_FLOAT_EQ(response["yaw"], 1.5f);
}

// UT-AC-007: Calibration progression
TEST_F(AccelCalibrationTest, Ingest_HandlesAccelVehiclePos) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_long_t cmd{};
    cmd.command = MAV_CMD_ACCELCAL_VEHICLE_POS;
    cmd.param1 = 2.0f; // LEFT position
    mavlink_msg_command_long_encode(1, 1, &msg, &cmd);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_EQ(calib_.pendingPosition, 2);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calibration_step");
    EXPECT_EQ(response["step"], "left");
}

// UT-AC-008: Statustext fallback
TEST_F(AccelCalibrationTest, Ingest_HandlesStatusTextFallback) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_statustext_t st{};
    std::strcpy(st.text, "Place vehicle on its LEFT side");
    mavlink_msg_statustext_encode(1, 1, &msg, &st);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_EQ(calib_.pendingPosition, 2); // Should map "LEFT" to 2
}

// UT-AC-009: Calibration Success Completion
TEST_F(AccelCalibrationTest, Ingest_HandlesCalibrationSuccessfulStatustext) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_statustext_t st{};
    std::strcpy(st.text, "Calibration successful");
    mavlink_msg_statustext_encode(1, 1, &msg, &st);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::DONE);
    EXPECT_EQ(calib_.pendingPosition, 0);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calibration_result");
    EXPECT_EQ(response["step"], "done");
}

// UT-AC-010: Attitude Validation Helper
TEST_F(AccelCalibrationTest, ValidateAttitude_RollAndPitchChecks) {
    // Arrange
    auto roll_ptr = get(AccelCalibRollTag{});
    auto pitch_ptr = get(AccelCalibPitchTag{});
    
    // Set state to IN_PROGRESS and pendingPosition to 1 (Level)
    calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
    calib_.pendingPosition = 1;

    // Case 1: Level position. Roll=0, Pitch=0 should be valid.
    calib_.*roll_ptr = 0.05f;
    calib_.*pitch_ptr = -0.05f;
    calib_.confirmAccelPosition(); // Confirms Level pos
    
    // Assert command was sent
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_message_t cmd_msg = sent_mavlink_messages_.back();
    EXPECT_EQ(cmd_msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&cmd_msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_ACCELCAL_VEHICLE_POS);
}

// UT-AC-011: Retry Watcher trigger
TEST_F(AccelCalibrationTest, RetryWatcher_TriggersCommandResend) {
    // Arrange
    auto armed_ptr = get(AccelCalibArmedTag{});
    calib_.*armed_ptr = false;
    calib_.startAccelCalibration();
    sent_mavlink_messages_.clear();

    auto sent_at_ptr = get(AccelCalibStartSentAtTag{});
    // Set start time 5 seconds in the past to trigger timeout
    calib_.*sent_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(5);

    // Act: sleep 1.1s for retry watcher tick
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));

    // Assert: Retry should have sent MAV_CMD_PREFLIGHT_CALIBRATION again
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_[0], &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_PREFLIGHT_CALIBRATION);
}

// UT-AC-012: Step Watchdog Trigger
TEST_F(AccelCalibrationTest, StepWatchdog_TriggersTimeoutStatus) {
    // Arrange
    // Manually set state without triggering processMessage which schedules a future watchdog
    calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
    calib_.pendingPosition = 2; // LEFT
    sent_json_messages_.clear();

    auto deadline_ptr = get(AccelCalibStepDeadlineTag{});
    auto armed_watchdog_ptr = get(AccelCalibStepTimeoutArmedTag{});
    auto cv_ptr = get(AccelCalibStepTimeoutCvTag{});

    // Manipulate watchdog deadline to 2 seconds in the past
    calib_.*deadline_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(2);
    calib_.*armed_watchdog_ptr = true;

    // Act: notify watchdog thread to wake up and process
    (calib_.*cv_ptr).notify_all();
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    // Assert: should have broadcast a timeout warning
    bool timeout_sent = false;
    for (const auto& m : sent_json_messages_) {
        json j = json::parse(m);
        if (j["type"] == "calibration_timeout") {
            timeout_sent = true;
            EXPECT_EQ(j["step"], "left");
        }
    }
    EXPECT_TRUE(timeout_sent);
}

// UT-AC-013: Level Calibration Start
TEST_F(AccelCalibrationTest, StartLevelCalibration_SendsCommand) {
    // Arrange
    auto armed_ptr = get(AccelCalibArmedTag{});
    calib_.*armed_ptr = false;

    // Act
    calib_.startLevelCalibration();

    // Assert
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_[0], &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_PREFLIGHT_CALIBRATION);
    EXPECT_FLOAT_EQ(cmd.param5, 2.0f); // level calibration
}

// UT-AC-014: MavlinkMsgName coverage
TEST_F(AccelCalibrationTest, MavlinkMsgName_Coverage) {
    // Test a variety of msgids in mavlinkMsgName helper
    struct MsgIdName {
        uint32_t id;
        std::string expected;
    } cases[] = {
        { MAVLINK_MSG_ID_HEARTBEAT, "HEARTBEAT" },
        { MAVLINK_MSG_ID_SYS_STATUS, "SYS_STATUS" },
        { MAVLINK_MSG_ID_ATTITUDE, "ATTITUDE" },
        { MAVLINK_MSG_ID_COMMAND_LONG, "COMMAND_LONG" },
        { MAVLINK_MSG_ID_COMMAND_ACK, "COMMAND_ACK" },
        { MAVLINK_MSG_ID_STATUSTEXT, "STATUSTEXT" },
        { MAVLINK_MSG_ID_PARAM_VALUE, "PARAM_VALUE" },
        { MAVLINK_MSG_ID_GPS_RAW_INT, "GPS_RAW_INT" },
        { MAVLINK_MSG_ID_VFR_HUD, "VFR_HUD" },
        { MAVLINK_MSG_ID_GLOBAL_POSITION_INT, "GLOBAL_POSITION_INT" },
        { MAVLINK_MSG_ID_RC_CHANNELS_RAW, "RC_CHANNELS_RAW" },
        { MAVLINK_MSG_ID_SERVO_OUTPUT_RAW, "SERVO_OUTPUT_RAW" },
        { MAVLINK_MSG_ID_RAW_IMU, "RAW_IMU" },
        { MAVLINK_MSG_ID_SCALED_IMU2, "SCALED_IMU2" },
        { MAVLINK_MSG_ID_POWER_STATUS, "POWER_STATUS" },
        { MAVLINK_MSG_ID_BATTERY_STATUS, "BATTERY_STATUS" },
        { MAVLINK_MSG_ID_AUTOPILOT_VERSION, "AUTOPILOT_VERSION" },
        { MAVLINK_MSG_ID_EXTENDED_SYS_STATE, "EXTENDED_SYS_STATE" },
        { MAVLINK_MSG_ID_HOME_POSITION, "HOME_POSITION" },
        { 9999, "MSG#9999" }
    };

    // Use Private Member Access hack to call static or private method if needed,
    // but mavlinkMsgName is static/public/private? In header it's public.
    auto mavlink_msg_name_fn = get(AccelCalibMavlinkMsgNameTag{});
    for (const auto& c : cases) {
        EXPECT_EQ(mavlink_msg_name_fn(c.id), c.expected);
    }
}

// UT-AC-015: SysidFilter_Mismatch
TEST_F(AccelCalibrationTest, Ingest_IgnoresMismatchedSysid) {
    // Arrange
    calib_.setVehicleInfo(2, 1);
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    // Ingest a message with sysid = 3 (mismatch)
    mavlink_message_t msg;
    mavlink_attitude_t att{};
    mavlink_msg_attitude_encode(3, 1, &msg, &att);

    // Act
    calib_.processMessage(msg);

    // Assert: should ignore and not emit calib_attitude
    EXPECT_TRUE(sent_json_messages_.empty());
}

// UT-AC-016: Heartbeat armed transitions
TEST_F(AccelCalibrationTest, Ingest_UpdatesArmedStateFromHeartbeat) {
    // Arrange
    auto armed_ptr = get(AccelCalibArmedTag{});
    calib_.*armed_ptr = false;

    mavlink_message_t msg;
    mavlink_heartbeat_t hb{};
    hb.base_mode = MAV_MODE_FLAG_SAFETY_ARMED | MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
    mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_TRUE(calib_.*armed_ptr);

    // Disarm heartbeat
    hb.base_mode = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
    mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);
    calib_.processMessage(msg);
    EXPECT_FALSE(calib_.*armed_ptr);
}

// UT-AC-017: Level Calibration drone ACKs
TEST_F(AccelCalibrationTest, LevelCalibration_HandlesAcks) {
    // 1. Success ACK
    {
        calib_.startLevelCalibration();
        sent_json_messages_.clear();

        mavlink_message_t msg;
        mavlink_command_ack_t ack{};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = MAV_RESULT_ACCEPTED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

        calib_.processMessage(msg);

        ASSERT_GE(sent_json_messages_.size(), 1u);
        json response = json::parse(sent_json_messages_.back());
        EXPECT_EQ(response["type"], "calibration_result");
        EXPECT_EQ(response["sensor"], "level");
        EXPECT_EQ(response["step"], "done");
    }

    // 2. Reject ACK
    {
        calib_.startLevelCalibration();
        sent_json_messages_.clear();

        mavlink_message_t msg;
        mavlink_command_ack_t ack{};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = MAV_RESULT_DENIED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

        calib_.processMessage(msg);

        ASSERT_GE(sent_json_messages_.size(), 1u);
        json response = json::parse(sent_json_messages_.back());
        EXPECT_EQ(response["type"], "calibration_result");
        EXPECT_EQ(response["sensor"], "level");
        EXPECT_EQ(response["step"], "failed");
    }
}

// UT-AC-018: Level Calibration Armed Rejection
TEST_F(AccelCalibrationTest, LevelCalibration_ArmedRejection) {
    // Arrange
    auto armed_ptr = get(AccelCalibArmedTag{});
    calib_.*armed_ptr = true;
    sent_json_messages_.clear();

    // Act
    calib_.startLevelCalibration();

    // Assert
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "calibration_result");
    EXPECT_EQ(response["sensor"], "level");
    EXPECT_EQ(response["step"], "failed");
}

// UT-AC-019: confirm position not in progress warning
TEST_F(AccelCalibrationTest, ConfirmPosition_NotInProgressWarning) {
    calib_.accelState = AccelCalibration::AccelCalibState::IDLE;
    // Calling confirmAccelPosition when not in progress should not crash
    EXPECT_NO_THROW({
        calib_.confirmAccelPosition();
    });
}

// UT-AC-020: wrong orientation attitude checks
TEST_F(AccelCalibrationTest, ConfirmPosition_WrongAttitudeWarning) {
    auto roll_ptr = get(AccelCalibRollTag{});
    auto pitch_ptr = get(AccelCalibPitchTag{});
    
    calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;

    struct TestPosition {
        int pos;
        float roll;
        float pitch;
        std::string expected_step;
    } cases[] = {
        { 1, 1.5f, 0.0f, "level" },      // Level pos, roll should be < 0.52 (but is 1.5)
        { 2, 0.1f, 0.0f, "left" },       // Left pos, roll should be ~ -1.57 (but is 0.1)
        { 3, 0.1f, 0.0f, "right" },      // Right pos, roll should be ~ 1.57 (but is 0.1)
        { 4, 0.0f, 0.1f, "nose_down" },  // Nose down, pitch should be ~ -1.57 (but is 0.1)
        { 5, 0.0f, 0.1f, "nose_up" },    // Nose up, pitch should be ~ 1.57 (but is 0.1)
        { 6, 0.1f, 0.1f, "upside_down" } // Upside down, roll should be ~ 3.14 (but is 0.1)
    };

    for (const auto& c : cases) {
        sent_json_messages_.clear();
        calib_.pendingPosition = c.pos;
        calib_.*roll_ptr = c.roll;
        calib_.*pitch_ptr = c.pitch;

        calib_.confirmAccelPosition();

        bool got_wrong_orientation = false;
        for (const auto& m : sent_json_messages_) {
            json j = json::parse(m);
            if (j["type"] == "calibration_wrong_orientation") {
                got_wrong_orientation = true;
                EXPECT_EQ(j["step"], c.expected_step);
            }
        }
        EXPECT_TRUE(got_wrong_orientation);
    }
}

// UT-AC-021: handleAccelVehiclePos success, failure, duplicate cases
TEST_F(AccelCalibrationTest, HandleAccelVehiclePos_EdgeAndDuplicate) {
    // Setup state
    calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
    calib_.pendingPosition = 2; // LEFT
    sent_json_messages_.clear();

    // 1. Duplicate position requests
    mavlink_command_long_t fake{};
    fake.command = MAV_CMD_ACCELCAL_VEHICLE_POS;
    fake.param1 = 2.0f; // same as pending

    calib_.processMessage(local_make_heartbeat(1, 1)); // dummy to trigger if we want, or just call directly
    // Let's call processMessage with command_long
    mavlink_message_t msg;
    mavlink_msg_command_long_encode(1, 1, &msg, &fake);
    calib_.processMessage(msg);

    // Duplicate should be ignored, so no new calibration_step messages sent
    bool got_step = false;
    for (const auto& m : sent_json_messages_) {
        json j = json::parse(m);
        if (j["type"] == "calibration_step") got_step = true;
    }
    EXPECT_FALSE(got_step);

    // 2. Success position (ACCELCAL_POS_SUCCESS)
    fake.param1 = 16384.0f;
    mavlink_msg_command_long_encode(1, 1, &msg, &fake);
    calib_.processMessage(msg);
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::DONE);

    // 3. Reset and test failure position (ACCELCAL_POS_FAILED)
    calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
    calib_.pendingPosition = 2;
    fake.param1 = 16385.0f;
    mavlink_msg_command_long_encode(1, 1, &msg, &fake);
    calib_.processMessage(msg);
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::FAILED);
}

// UT-AC-022: STATUSTEXT failed path
TEST_F(AccelCalibrationTest, Ingest_HandlesCalibrationFailedStatustext) {
    // Arrange
    calib_.startAccelCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_statustext_t st{};
    std::strcpy(st.text, "Calibration FAILED");
    mavlink_msg_statustext_encode(1, 1, &msg, &st);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::FAILED);
}

// UT-AC-023: handlePreflightCalibAck branches (COMMAND_ACK for VEHICLE_POS)
TEST_F(AccelCalibrationTest, Ingest_HandlesVehiclePosAck) {
    // 1. Preflight ack accepted (should remain in progress)
    {
        calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
        mavlink_message_t msg;
        mavlink_command_ack_t ack{};
        ack.command = MAV_CMD_ACCELCAL_VEHICLE_POS;
        ack.result = MAV_RESULT_ACCEPTED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

        calib_.processMessage(msg);
        EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::IN_PROGRESS);
    }

    // 2. Preflight ack denied/failed
    {
        calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
        mavlink_message_t msg;
        mavlink_command_ack_t ack{};
        ack.command = MAV_CMD_ACCELCAL_VEHICLE_POS;
        ack.result = MAV_RESULT_FAILED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

        calib_.processMessage(msg);
        EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::FAILED);
    }
}

// UT-AC-024: Warning about no transport callbacks
TEST_F(AccelCalibrationTest, NoTransportCallbackWarnings) {
    auto calib_no_tx = std::make_unique<AccelCalibration>();
    calib_no_tx->setVehicleInfo(1, 1);
    calib_no_tx->setSendCallback([](const std::string&) {});
    // transport_cb_ is nullptr

    // Calling start / level / confirm should output warnings without crashing
    EXPECT_NO_THROW({
        calib_no_tx->startAccelCalibration();
        calib_no_tx->startLevelCalibration();
        calib_no_tx->accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
        calib_no_tx->pendingPosition = 1;
        calib_no_tx->confirmAccelPosition();
    });
}

// UT-AC-025: Pre-confirm Next click before COMMAND_LONG arrived
TEST_F(AccelCalibrationTest, ConfirmPosition_HandlesPreConfirmNext) {
    // Arrange
    calib_.accelState = AccelCalibration::AccelCalibState::IN_PROGRESS;
    calib_.pendingPosition = 0;
    auto step_index_ptr = get(AccelCalibStepIndexTag{});
    calib_.*step_index_ptr = 2; // say LEFT is next, user clicks Next early

    // Act
    calib_.confirmAccelPosition(); // Stores preconfirmedPos_ = 2

    // Now drone requests pos = 2
    sent_json_messages_.clear();
    mavlink_message_t msg;
    mavlink_command_long_t cmd{};
    cmd.command = MAV_CMD_ACCELCAL_VEHICLE_POS;
    cmd.param1 = 2.0f; // LEFT
    mavlink_msg_command_long_encode(1, 1, &msg, &cmd);
    calib_.processMessage(msg);

    // It should automatically confirm orientation and send Next pos ack to drone
    EXPECT_EQ(calib_.pendingPosition, 0); // resets after confirm
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    EXPECT_EQ(sent_mavlink_messages_.back().msgid, MAVLINK_MSG_ID_COMMAND_LONG);
}

// UT-AC-026: Retry Watcher exhaustion limit
TEST_F(AccelCalibrationTest, RetryWatcher_ExhaustionFails) {
    // Arrange
    calib_.startAccelCalibration();
    
    // Set retries = 3 to trigger exhaustion
    auto sent_at_ptr = get(AccelCalibStartSentAtTag{});
    // Backdate start time
    calib_.*sent_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(10);
    
    // Explicitly manipulate retry loop counters
    // Wait for retry loop tick
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));

    // Wait and check if state transitioned to FAILED
    // The retry watcher runs and loops, let's wait up to 4 seconds for it to retry 3 times
    int wait_limit = 40;
    while (calib_.accelState.load() == AccelCalibration::AccelCalibState::IN_PROGRESS && wait_limit-- > 0) {
        calib_.*sent_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(10);
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    EXPECT_EQ(calib_.accelState.load(), AccelCalibration::AccelCalibState::FAILED);
}

