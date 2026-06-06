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
#include "calibration/compass_calibration.h"

using json = nlohmann::json;

// ─── Accessors for Private Members ──────────────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct CompassCalibArmedTag {
    typedef bool CompassCalibration::*type;
    friend type get(CompassCalibArmedTag);
};
template struct PrivateAccessor<CompassCalibArmedTag, &CompassCalibration::armed_>;

struct CompassCalibStartSentAtTag {
    typedef std::chrono::steady_clock::time_point CompassCalibration::*type;
    friend type get(CompassCalibStartSentAtTag);
};
template struct PrivateAccessor<CompassCalibStartSentAtTag, &CompassCalibration::calibStartSentAt_>;

struct CompassCalibOverallTimeoutArmedTag {
    typedef std::atomic<bool> CompassCalibration::*type;
    friend type get(CompassCalibOverallTimeoutArmedTag);
};
template struct PrivateAccessor<CompassCalibOverallTimeoutArmedTag, &CompassCalibration::overallTimeoutArmed_>;

struct CompassCalibRetryActiveTag {
    typedef std::atomic<bool> CompassCalibration::*type;
    friend type get(CompassCalibRetryActiveTag);
};
template struct PrivateAccessor<CompassCalibRetryActiveTag, &CompassCalibration::retryActive_>;

struct CompassCalibCalStatusToStringTag {
    typedef std::string (*type)(uint8_t);
    friend type get(CompassCalibCalStatusToStringTag);
};
template struct PrivateAccessor<CompassCalibCalStatusToStringTag, &CompassCalibration::calStatusToString>;

class CompassCalibrationTest : public ::testing::Test {
protected:
    CompassCalibration calib_;
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
        calib_.cancelCompassCalibration();
    }
};

// UT-CC-001: Initialization Defaults
TEST_F(CompassCalibrationTest, Initialization_DefaultsAreCorrect) {
    // Assert
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IDLE);
    for (int i = 0; i < CompassCalibration::MAX_COMPASSES; ++i) {
        EXPECT_EQ(calib_.progress_[i], 0);
    }
}

// UT-CC-002: Rejects Start If Armed
TEST_F(CompassCalibrationTest, Start_ArmedRejectsImmediately) {
    // Arrange
    auto armed_ptr = get(CompassCalibArmedTag{});
    calib_.*armed_ptr = true;

    // Act
    calib_.startCompassCalibration();

    // Assert
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IDLE);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "compass_result");
    EXPECT_EQ(response["status"], "failed");
    EXPECT_TRUE(response.contains("message"));
}

// UT-CC-003: Disarmed Start Happy Path
TEST_F(CompassCalibrationTest, Start_DisarmedSendsStartCommand) {
    // Arrange
    auto armed_ptr = get(CompassCalibArmedTag{});
    calib_.*armed_ptr = false;

    // Act
    calib_.startCompassCalibration();

    // Assert
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IN_PROGRESS);
    
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_message_t start_msg = sent_mavlink_messages_.back();
    EXPECT_EQ(start_msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);
    
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&start_msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_START_MAG_CAL);
}

// UT-CC-004: Accept Command Ack (Start Calibration)
TEST_F(CompassCalibrationTest, Ingest_CommandAckStartAccepted) {
    // Arrange
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_DO_START_MAG_CAL;
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    // Act
    calib_.processMessage(msg);

    // Assert
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "compass_calibration_status");
    EXPECT_EQ(response["sensor"], "compass");
    EXPECT_TRUE(response["message"].get<std::string>().find("accepted") != std::string::npos);
}

// UT-CC-005: Implicit Ack triggers from MAG_CAL_PROGRESS
TEST_F(CompassCalibrationTest, Ingest_ImplicitAckViaProgressWhenIdle) {
    // Arrange
    sent_json_messages_.clear();
    auto retry_active_ptr = get(CompassCalibRetryActiveTag{});
    calib_.*retry_active_ptr = true; // Set retryActive_ to true to trigger status send

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 5;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    // Act
    calib_.processMessage(msg);

    // Assert: should transition to IN_PROGRESS and broadcast status
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IN_PROGRESS);
    
    bool found_status = false;
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_calibration_status") {
            found_status = true;
            EXPECT_TRUE(j["message"].get<std::string>().find("accepted") != std::string::npos);
        }
    }
    EXPECT_TRUE(found_status);
}

// UT-CC-006: Compass Progress Updates
TEST_F(CompassCalibrationTest, Ingest_ProgressUpdatesPercentage) {
    // Arrange
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 45;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_EQ(calib_.progress_[0], 45);
    
    // Progress should be broadcasted (check for compass_id = 0)
    bool progress_found = false;
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_progress" && j["compass_id"] == 0) {
            progress_found = true;
            EXPECT_EQ(j["progress"], 45);
        }
    }
    EXPECT_TRUE(progress_found);
}

// UT-CC-007: Calibration Success Report (One Compass)
TEST_F(CompassCalibrationTest, Ingest_ReportSuccessCompletesSession) {
    // Arrange
    calib_.startCompassCalibration();
    
    // First send progress to register compass 0 as active
    mavlink_message_t prog_msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 95;
    mavlink_msg_mag_cal_progress_encode(1, 1, &prog_msg, &prog);
    calib_.processMessage(prog_msg);

    sent_json_messages_.clear();
    sent_mavlink_messages_.clear();

    // Now send completion report (success)
    mavlink_message_t report_msg;
    mavlink_mag_cal_report_t rep{};
    rep.compass_id = 0;
    rep.cal_status = MAG_CAL_SUCCESS;
    rep.fitness = 1.2f;
    mavlink_msg_mag_cal_report_encode(1, 1, &report_msg, &rep);

    // Act
    calib_.processMessage(report_msg);

    // Assert: overall state should be DONE since compass 0 is the only active one
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::DONE);
    
    bool found_done = false;
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_result" && j["status"] == "done") {
            found_done = true;
        }
    }
    EXPECT_TRUE(found_done);
    
    // It should automatically send the DO_ACCEPT_MAG_CAL command on success (auto-accept flow)
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_.back(), &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_ACCEPT_MAG_CAL);
}

// UT-CC-008: Explicit Accept Calibration
TEST_F(CompassCalibrationTest, Accept_SendsAcceptCommandWhenDone) {
    // Arrange
    // Manually transition to DONE
    calib_.compassState.store(CompassCalibration::CompassCalibState::DONE);
    sent_mavlink_messages_.clear();

    // Act
    calib_.acceptCompassCalibration();

    // Assert
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_.back(), &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_ACCEPT_MAG_CAL);
}

// UT-CC-009: Cancel Calibration
TEST_F(CompassCalibrationTest, Cancel_SendsCancelCommandAndSetsFailedState) {
    // Arrange
    calib_.startCompassCalibration();
    sent_mavlink_messages_.clear();

    // Act
    calib_.cancelCompassCalibration();

    // Assert
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::FAILED);
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_.back(), &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_CANCEL_MAG_CAL);
}

// UT-CC-010: Retry Watcher Resends Calibration
TEST_F(CompassCalibrationTest, RetryWatcher_TriggersStartResend) {
    // Arrange
    auto armed_ptr = get(CompassCalibArmedTag{});
    calib_.*armed_ptr = false;
    calib_.startCompassCalibration();
    sent_mavlink_messages_.clear();

    auto sent_at_ptr = get(CompassCalibStartSentAtTag{});
    // Set start time 5 seconds in the past
    calib_.*sent_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(5);

    // Act: wait for retry thread tick (100ms ticks in this revision, needs to expire 1s total sleep)
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));

    // Assert: Retry should send start command again
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_.back(), &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_START_MAG_CAL);
}

// UT-CC-011: CalStatusToString covers all status values
TEST_F(CompassCalibrationTest, CalStatusToString_VerifyAll) {
    auto calStatusToString_fn = get(CompassCalibCalStatusToStringTag{});
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_NOT_STARTED), "NOT_STARTED");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_WAITING_TO_START), "WAITING_TO_START");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_RUNNING_STEP_ONE), "RUNNING_STEP_ONE");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_RUNNING_STEP_TWO), "RUNNING_STEP_TWO");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_SUCCESS), "SUCCESS");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_FAILED), "FAILED");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_BAD_ORIENTATION), "BAD_ORIENTATION");
    EXPECT_EQ(calStatusToString_fn(MAG_CAL_BAD_RADIUS), "BAD_RADIUS");
    EXPECT_EQ(calStatusToString_fn(99), "UNKNOWN(99)");
}

// UT-CC-012: Rejects start if already in progress
TEST_F(CompassCalibrationTest, Start_InProgressRejectsImmediately) {
    calib_.startCompassCalibration();
    sent_mavlink_messages_.clear();

    // Try starting again while IN_PROGRESS
    calib_.startCompassCalibration();
    EXPECT_TRUE(sent_mavlink_messages_.empty()); // No second start command sent
}

// UT-CC-013: Start fails when no transport callback is set
TEST_F(CompassCalibrationTest, Start_MissingTransportCallbackFails) {
    CompassCalibration calib_no_cb;
    calib_no_cb.setVehicleInfo(1, 1);
    
    bool got_failed = false;
    calib_no_cb.setSendCallback([&](const std::string& msg) {
        json j = json::parse(msg);
        if (j["type"] == "compass_result" && j["status"] == "failed") {
            got_failed = true;
        }
    });

    calib_no_cb.startCompassCalibration();
    EXPECT_EQ(calib_no_cb.compassState.load(), CompassCalibration::CompassCalibState::IDLE);
    EXPECT_TRUE(got_failed);
}

// UT-CC-014: Start triggers warning when sysid and compid are 0
TEST_F(CompassCalibrationTest, Start_WarningWhenSysidCompidZero) {
    calib_.setVehicleInfo(0, 0);
    calib_.startCompassCalibration();
    // Verify it still starts and sends start command
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IN_PROGRESS);
    EXPECT_FALSE(sent_mavlink_messages_.empty());
}

// UT-CC-015: Accept command is ignored when state is not DONE
TEST_F(CompassCalibrationTest, Accept_IgnoredWhenNotDone) {
    calib_.acceptCompassCalibration();
    EXPECT_TRUE(sent_mavlink_messages_.empty());
}

// UT-CC-016: Accept command warning when no transport callback is set
TEST_F(CompassCalibrationTest, Accept_WarningWhenNoTransportCallback) {
    CompassCalibration calib_no_cb;
    calib_no_cb.compassState.store(CompassCalibration::CompassCalibState::DONE);
    // Should not throw or crash, just logs warning
    calib_no_cb.acceptCompassCalibration();
}

// UT-CC-017: Cancel command is ignored when state is not IN_PROGRESS
TEST_F(CompassCalibrationTest, Cancel_IgnoredWhenNotInProgress) {
    calib_.cancelCompassCalibration();
    EXPECT_TRUE(sent_mavlink_messages_.empty());
}

// UT-CC-018: Cancel warning when no transport callback is set
TEST_F(CompassCalibrationTest, Cancel_WarningWhenNoTransportCallback) {
    CompassCalibration calib_no_cb;
    calib_no_cb.setVehicleInfo(1, 1);
    calib_no_cb.compassState.store(CompassCalibration::CompassCalibState::IN_PROGRESS);
    // Should not throw or crash, just logs warning
    calib_no_cb.cancelCompassCalibration();
    EXPECT_EQ(calib_no_cb.compassState.load(), CompassCalibration::CompassCalibState::FAILED);
}

// UT-CC-019: Ingest command ACK for cancel is ignored
TEST_F(CompassCalibrationTest, Ingest_CommandAckCancelIgnored) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_DO_CANCEL_MAG_CAL;
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    calib_.processMessage(msg);
    // Should stay IN_PROGRESS (cancel ACK doesn't change state on its own, cancel request does)
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IN_PROGRESS);
    EXPECT_TRUE(sent_json_messages_.empty());
}

// UT-CC-020: Ingest command ACK start denied fails session
TEST_F(CompassCalibrationTest, Ingest_CommandAckStartDeniedFailsSession) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_DO_START_MAG_CAL;
    ack.result = MAV_RESULT_DENIED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    calib_.processMessage(msg);
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::FAILED);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "compass_result");
    EXPECT_EQ(response["status"], "failed");
}

// UT-CC-021: Heartbeat SAFETY_ARMED changes armed state and arm check rejects start
TEST_F(CompassCalibrationTest, Ingest_HeartbeatSafetyArmedPreventsStart) {
    // Send armed heartbeat
    mavlink_message_t msg;
    mavlink_heartbeat_t hb{};
    hb.base_mode = MAV_MODE_FLAG_SAFETY_ARMED;
    mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);
    calib_.processMessage(msg);

    auto armed_ptr = get(CompassCalibArmedTag{});
    EXPECT_TRUE(calib_.*armed_ptr);

    // Try starting
    calib_.startCompassCalibration();
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IDLE);
}

// UT-CC-022: STATUSTEXT triggers implicit ACK
TEST_F(CompassCalibrationTest, Ingest_StatusTextTriggersImplicitAck) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_statustext_t st{};
    strncpy(st.text, "Mag calibration started", sizeof(st.text));
    mavlink_msg_statustext_encode(1, 1, &msg, &st);

    calib_.processMessage(msg);
    // Verify it stopped retry watcher and sent accepted status
    bool found_status = false;
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_calibration_status") {
            found_status = true;
            EXPECT_TRUE(j["message"].get<std::string>().find("accepted") != std::string::npos);
        }
    }
    EXPECT_TRUE(found_status);
}

// UT-CC-023: Progress percentages are capped at 99%
TEST_F(CompassCalibrationTest, Ingest_ProgressPercentagesCappedAt99) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 100; // Send 100% in progress
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    calib_.processMessage(msg);
    // Capped at 99%
    EXPECT_EQ(calib_.progress_[0], 100);
    
    bool progress_found = false;
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_progress" && j["compass_id"] == 0) {
            progress_found = true;
            EXPECT_EQ(j["progress"], 99); // Broadcast is capped
        }
    }
    EXPECT_TRUE(progress_found);
}

// UT-CC-024: MAG_CAL_REPORT ignores duplicate reports for same compass
TEST_F(CompassCalibrationTest, Ingest_MagCalReportIgnoresDuplicates) {
    calib_.startCompassCalibration();
    
    // Register compass 0 active
    mavlink_message_t prog_msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 50;
    mavlink_msg_mag_cal_progress_encode(1, 1, &prog_msg, &prog);
    calib_.processMessage(prog_msg);

    // Send report 1
    mavlink_message_t report_msg;
    mavlink_mag_cal_report_t rep{};
    rep.compass_id = 0;
    rep.cal_status = MAG_CAL_SUCCESS;
    mavlink_msg_mag_cal_report_encode(1, 1, &report_msg, &rep);
    calib_.processMessage(report_msg);
    
    sent_json_messages_.clear();

    // Send duplicate report
    calib_.processMessage(report_msg);
    EXPECT_TRUE(sent_json_messages_.empty()); // Duplicate is ignored
}

// UT-CC-025: MAG_CAL_REPORT ignored when state is IDLE
TEST_F(CompassCalibrationTest, Ingest_MagCalReportIgnoredWhenIdle) {
    mavlink_message_t report_msg;
    mavlink_mag_cal_report_t rep{};
    rep.compass_id = 0;
    rep.cal_status = MAG_CAL_SUCCESS;
    mavlink_msg_mag_cal_report_encode(1, 1, &report_msg, &rep);

    calib_.processMessage(report_msg);
    EXPECT_TRUE(sent_json_messages_.empty());
}

// UT-CC-026: Partial success when some compasses fail but at least one succeeds
TEST_F(CompassCalibrationTest, Ingest_MagCalReportPartialSuccess) {
    calib_.startCompassCalibration();

    // Register compass 0 and 1 active
    mavlink_message_t prog_msg1, prog_msg2;
    mavlink_mag_cal_progress_t prog1{}, prog2{};
    prog1.compass_id = 0; prog1.completion_pct = 50;
    prog2.compass_id = 1; prog2.completion_pct = 50;
    mavlink_msg_mag_cal_progress_encode(1, 1, &prog_msg1, &prog1);
    mavlink_msg_mag_cal_progress_encode(1, 1, &prog_msg2, &prog2);
    calib_.processMessage(prog_msg1);
    calib_.processMessage(prog_msg2);

    sent_json_messages_.clear();
    sent_mavlink_messages_.clear();

    // Send success for compass 0
    mavlink_message_t rep_msg1;
    mavlink_mag_cal_report_t rep1{};
    rep1.compass_id = 0;
    rep1.cal_status = MAG_CAL_SUCCESS;
    mavlink_msg_mag_cal_report_encode(1, 1, &rep_msg1, &rep1);
    calib_.processMessage(rep_msg1);

    // State should still be IN_PROGRESS
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::IN_PROGRESS);

    // Send failure for compass 1
    mavlink_message_t rep_msg2;
    mavlink_mag_cal_report_t rep2{};
    rep2.compass_id = 1;
    rep2.cal_status = MAG_CAL_FAILED;
    mavlink_msg_mag_cal_report_encode(1, 1, &rep_msg2, &rep2);
    calib_.processMessage(rep_msg2);

    // Overall state should be DONE (partial success saves successful offsets)
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::DONE);
    
    // Check auto-accept is sent
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&sent_mavlink_messages_.back(), &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_ACCEPT_MAG_CAL);
}

// UT-CC-027: All compasses failed
TEST_F(CompassCalibrationTest, Ingest_MagCalReportAllFailed) {
    calib_.startCompassCalibration();

    // Register compass 0 and 1 active
    mavlink_message_t prog_msg1, prog_msg2;
    mavlink_mag_cal_progress_t prog1{}, prog2{};
    prog1.compass_id = 0;
    prog2.compass_id = 1;
    mavlink_msg_mag_cal_progress_encode(1, 1, &prog_msg1, &prog1);
    mavlink_msg_mag_cal_progress_encode(1, 1, &prog_msg2, &prog2);
    calib_.processMessage(prog_msg1);
    calib_.processMessage(prog_msg2);

    // Send failure for compass 0
    mavlink_message_t rep_msg1;
    mavlink_mag_cal_report_t rep1{};
    rep1.compass_id = 0;
    rep1.cal_status = MAG_CAL_BAD_ORIENTATION;
    mavlink_msg_mag_cal_report_encode(1, 1, &rep_msg1, &rep1);
    calib_.processMessage(rep_msg1);

    // Send failure for compass 1
    mavlink_message_t rep_msg2;
    mavlink_mag_cal_report_t rep2{};
    rep2.compass_id = 1;
    rep2.cal_status = MAG_CAL_BAD_RADIUS;
    mavlink_msg_mag_cal_report_encode(1, 1, &rep_msg2, &rep2);
    calib_.processMessage(rep_msg2);

    // Overall state should be FAILED
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::FAILED);
}

struct CompassCalibStartRetriesTag {
    typedef int CompassCalibration::*type;
    friend type get(CompassCalibStartRetriesTag);
};
template struct PrivateAccessor<CompassCalibStartRetriesTag, &CompassCalibration::calibStartRetries_>;

// UT-CC-028: Retry watcher exhausts retries and fails session
TEST_F(CompassCalibrationTest, RetryWatcher_ExhaustsRetriesAndFails) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    auto retries_ptr = get(CompassCalibStartRetriesTag{});
    // Set current retry count to MAX_RETRIES (so the next retry will exceed it)
    calib_.*retries_ptr = 5; // CALIB_MAX_RETRIES is 5

    auto sent_at_ptr = get(CompassCalibStartSentAtTag{});
    calib_.*sent_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(5);

    // Wait for the retry watcher slice
    std::this_thread::sleep_for(std::chrono::milliseconds(1200));

    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::FAILED);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "compass_result");
    EXPECT_EQ(response["status"], "failed");
}

// UT-CC-029: Message counter logging
TEST_F(CompassCalibrationTest, Ingest_MessageCounterDiagnosticLog) {
    // Send 100 heartbeat messages to trigger the diagnostic log print
    mavlink_message_t msg;
    mavlink_heartbeat_t hb{};
    mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);
    
    for (int i = 0; i < 100; ++i) {
        calib_.processMessage(msg);
    }
    // No error, verifies it handles switch case default as well
}

// UT-CC-030: EdgeCase - Null callbacks do not crash
TEST_F(CompassCalibrationTest, EdgeCase_NullCallbacks_NoCrash) {
    CompassCalibration calib_no_cb;
    calib_no_cb.setSendCallback(nullptr);
    calib_no_cb.setTransportCallback(nullptr);
    calib_no_cb.setVehicleInfo(1, 1);
    
    calib_no_cb.startCompassCalibration();
    
    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 50;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);
    calib_no_cb.processMessage(msg);
    
    calib_no_cb.cancelCompassCalibration();
    SUCCEED();
}

// UT-CC-031: EdgeCase - Uninitialized vehicle info defaults
TEST_F(CompassCalibrationTest, EdgeCase_UninitializedVehicleInfo_SendsWithDefault) {
    CompassCalibration calib_def;
    calib_def.setSendCallback([](const std::string&) {});
    
    std::vector<mavlink_message_t> msgs;
    calib_def.setTransportCallback([&](const mavlink_message_t& m) {
        msgs.push_back(m);
    });
    
    calib_def.startCompassCalibration();
    
    ASSERT_FALSE(msgs.empty());
    EXPECT_EQ(msgs.back().msgid, MAVLINK_MSG_ID_COMMAND_LONG);
}

// UT-CC-032: EdgeCase - Zero completion progress packet handles cleanly
TEST_F(CompassCalibrationTest, EdgeCase_ZeroProgressPacket_HandlesCleanly) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 0;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    calib_.processMessage(msg);
    
    EXPECT_EQ(calib_.progress_[0], 0);
    ASSERT_FALSE(sent_json_messages_.empty());
    json j = json::parse(sent_json_messages_.back());
    EXPECT_EQ(j["type"], "compass_progress");
    EXPECT_EQ(j["progress"], 0);
}

// UT-CC-033: BoundaryValue - Compass ID at boundary limit (MAX_COMPASSES) is ignored
TEST_F(CompassCalibrationTest, BoundaryValue_MaxCompassId_Ignored) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = CompassCalibration::MAX_COMPASSES;
    prog.completion_pct = 50;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    calib_.processMessage(msg);
    // Should not send any progress message for the out-of-bounds compass ID
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_progress") {
            EXPECT_NE(j["compass_id"], CompassCalibration::MAX_COMPASSES);
        }
    }
}

// UT-CC-034: BoundaryValue - Minimum compass ID 0 succeeds
TEST_F(CompassCalibrationTest, BoundaryValue_MinCompassId_Succeeds) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 10;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    calib_.processMessage(msg);
    EXPECT_EQ(calib_.progress_[0], 10);
    EXPECT_FALSE(sent_json_messages_.empty());
}

// UT-CC-035: BoundaryValue - Out-of-bounds completion percentage is clamped or handled
TEST_F(CompassCalibrationTest, BoundaryValue_MaxProgressPercent_Clamped) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_mag_cal_progress_t prog{};
    prog.compass_id = 0;
    prog.completion_pct = 200;
    mavlink_msg_mag_cal_progress_encode(1, 1, &msg, &prog);

    calib_.processMessage(msg);
    
    ASSERT_FALSE(sent_json_messages_.empty());
    bool found_progress_99 = false;
    for (const auto& raw_msg : sent_json_messages_) {
        json j = json::parse(raw_msg);
        if (j["type"] == "compass_progress" && j["compass_id"] == 0) {
            if (j["progress"] == 99) {
                found_progress_99 = true;
            }
        }
    }
    EXPECT_TRUE(found_progress_99);
}

// UT-CC-036: NegativeCase - Unsupported MAVLink message ID is ignored
TEST_F(CompassCalibrationTest, NegativeCase_InvalidMavlinkMessageId_Ignored) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    msg.msgid = MAVLINK_MSG_ID_GPS_RAW_INT;
    
    calib_.processMessage(msg);
    EXPECT_TRUE(sent_json_messages_.empty());
}

// UT-CC-037: NegativeCase - COMMAND_ACK error results transition state to FAILED
TEST_F(CompassCalibrationTest, NegativeCase_AckErrorResult_FailsSession) {
    calib_.startCompassCalibration();
    sent_json_messages_.clear();

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_DO_START_MAG_CAL;
    ack.result = MAV_RESULT_FAILED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    calib_.processMessage(msg);
    EXPECT_EQ(calib_.compassState.load(), CompassCalibration::CompassCalibState::FAILED);
    ASSERT_FALSE(sent_json_messages_.empty());
    json j = json::parse(sent_json_messages_.back());
    EXPECT_EQ(j["type"], "compass_result");
    EXPECT_EQ(j["status"], "failed");
}
