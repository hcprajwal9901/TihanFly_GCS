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
#include "calibration/esc_calibration.h"

using json = nlohmann::json;

// ─── Accessors for Private Members ──────────────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct EscCalibCalibratingTag {
    typedef std::atomic<bool> EscCalibration::*type;
    friend type get(EscCalibCalibratingTag);
};
template struct PrivateAccessor<EscCalibCalibratingTag, &EscCalibration::calibrating_>;

struct EscCalibCancelledTag {
    typedef std::atomic<bool> EscCalibration::*type;
    friend type get(EscCalibCancelledTag);
};
template struct PrivateAccessor<EscCalibCancelledTag, &EscCalibration::cancelled_>;

struct EscCalibAckReceivedTag {
    typedef std::atomic<bool> EscCalibration::*type;
    friend type get(EscCalibAckReceivedTag);
};
template struct PrivateAccessor<EscCalibAckReceivedTag, &EscCalibration::ack_received_>;

struct EscCalibAckResultTag {
    typedef std::atomic<int> EscCalibration::*type;
    friend type get(EscCalibAckResultTag);
};
template struct PrivateAccessor<EscCalibAckResultTag, &EscCalibration::ack_result_>;


class EscCalibrationTest : public ::testing::Test {
protected:
    EscCalibration calib_;
    std::vector<std::string> sent_json_messages_;
    std::vector<mavlink_message_t> sent_mavlink_messages_;
    std::mutex json_mtx_;

    void SetUp() override {
        sent_json_messages_.clear();
        sent_mavlink_messages_.clear();
        
        calib_.setSendCallback([this](const std::string& msg) {
            std::lock_guard<std::mutex> lk(json_mtx_);
            sent_json_messages_.push_back(msg);
        });

        calib_.setTransportCallback([this](const mavlink_message_t& msg) {
            sent_mavlink_messages_.push_back(msg);
        });
        
        calib_.setVehicleInfo(1, 1);
    }

    void TearDown() override {
        calib_.cancelEscCalibration();
    }
};

// UT-ESC-001: Initialization Defaults
TEST_F(EscCalibrationTest, Initialization_DefaultsAreCorrect) {
    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    EXPECT_FALSE(calib_.*calibrating_ptr);
}

// UT-ESC-002: Inbound Message Ingestion
TEST_F(EscCalibrationTest, Ingest_PreflightAckSetsAckReceived) {
    // Arrange
    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    calib_.*calibrating_ptr = true;

    auto ack_received_ptr = get(EscCalibAckReceivedTag{});
    auto ack_result_ptr = get(EscCalibAckResultTag{});

    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);

    // Act
    calib_.processMessage(msg);

    // Assert
    EXPECT_TRUE(calib_.*ack_received_ptr);
    EXPECT_EQ(calib_.*ack_result_ptr, static_cast<int>(MAV_RESULT_ACCEPTED));
}

// UT-ESC-003: Already Calibrating Rejection
TEST_F(EscCalibrationTest, Start_RejectsIfAlreadyCalibrating) {
    // Arrange
    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    calib_.*calibrating_ptr = true;

    // Act
    calib_.startEscCalibration();

    // Assert
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "esc_calibration_status");
    EXPECT_EQ(response["stage"], "busy");
}

// UT-ESC-004: Cancellation Happy Path
TEST_F(EscCalibrationTest, Start_CancellationExitsImmediately) {
    // Arrange: start calibration in a detached thread and cancel immediately
    std::thread calib_thread([this]() {
        calib_.startEscCalibration();
    });

    // Wait until it enters calibrating phase
    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    while (!(calib_.*calibrating_ptr)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    // Act
    calib_.cancelEscCalibration();
    calib_thread.join();

    // Assert
    EXPECT_FALSE(calib_.*calibrating_ptr);
    
    std::lock_guard<std::mutex> lk(json_mtx_);
    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["type"], "esc_calibration_status");
    EXPECT_EQ(response["stage"], "cancelled");
}

// UT-ESC-005: Start Sends Param and Reboot Commands
TEST_F(EscCalibrationTest, Start_SendsCommandsThenExitsOnCancel) {
    // Arrange
    std::thread calib_thread([this]() {
        calib_.startEscCalibration();
    });

    // Wait for it to send the PARAM_SET command
    while (sent_mavlink_messages_.empty()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    // Cancel to exit quickly
    calib_.cancelEscCalibration();
    calib_thread.join();

    // Assert: Verify MAVLink message sent was PARAM_SET for ESC_CALIBRATION
    ASSERT_GE(sent_mavlink_messages_.size(), 1u);
    mavlink_message_t param_msg = sent_mavlink_messages_[0];
    EXPECT_EQ(param_msg.msgid, MAVLINK_MSG_ID_PARAM_SET);
    
    mavlink_param_set_t param;
    mavlink_msg_param_set_decode(&param_msg, &param);
    EXPECT_STREQ(param.param_id, "ESC_CALIBRATION");
    EXPECT_FLOAT_EQ(param.param_value, 3.0f);
}

// UT-ESC-006: ESC Calibration Happy Path (Full run to reboot & power_cycle)
TEST_F(EscCalibrationTest, Start_HappyPathFullRun) {
    std::thread calib_thread([this]() {
        calib_.startEscCalibration();
    });

    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    while (!(calib_.*calibrating_ptr)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    // Wait for PARAM_SET to be sent
    while (sent_mavlink_messages_.empty()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    // Wait for thread to finish (since it sleeps for 2s in preflight, sends reboot, then sleeps 2s)
    calib_thread.join();

    // Verify messages: PARAM_SET, then REBOOT
    ASSERT_GE(sent_mavlink_messages_.size(), 2u);
    mavlink_message_t reboot_msg = sent_mavlink_messages_[1];
    EXPECT_EQ(reboot_msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);
    
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&reboot_msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN);
    EXPECT_FLOAT_EQ(cmd.param1, 1.0f);

    // Verify status stages dumped
    bool power_cycle_logged = false;
    for (const auto& log : sent_json_messages_) {
        json j = json::parse(log);
        if (j.value("stage", "") == "power_cycle") {
            power_cycle_logged = true;
        }
    }
    EXPECT_TRUE(power_cycle_logged);
}

// UT-ESC-007: Inbound Command ACK - Cover mavResultToString
TEST_F(EscCalibrationTest, CoverMavResultToString) {
    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    calib_.*calibrating_ptr = true;

    std::vector<int> results = {
        MAV_RESULT_ACCEPTED,
        MAV_RESULT_TEMPORARILY_REJECTED,
        MAV_RESULT_DENIED,
        MAV_RESULT_FAILED,
        MAV_RESULT_UNSUPPORTED,
        MAV_RESULT_IN_PROGRESS,
        MAV_RESULT_CANCELLED,
        99 // Unknown
    };

    for (int res : results) {
        mavlink_message_t msg;
        mavlink_command_ack_t ack{};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = static_cast<uint8_t>(res);
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
        calib_.processMessage(msg);
    }
}

// UT-ESC-008: Start without transport fails
TEST_F(EscCalibrationTest, Start_NoTransportRejects) {
    calib_.setTransportCallback(nullptr);
    calib_.startEscCalibration();

    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    EXPECT_FALSE(calib_.*calibrating_ptr);

    ASSERT_GE(sent_json_messages_.size(), 1u);
    json response = json::parse(sent_json_messages_.back());
    EXPECT_EQ(response["stage"], "error");
}

// UT-ESC-009: Start retry triggered then cancelled
TEST_F(EscCalibrationTest, Start_TemporarilyRejectedRetryThenCancel) {
    std::thread calib_thread([this]() {
        calib_.startEscCalibration();
    });

    auto calibrating_ptr = get(EscCalibCalibratingTag{});
    while (!(calib_.*calibrating_ptr)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    // Feed a TEMPORARILY_REJECTED ACK during the first 2-second sleep
    mavlink_message_t msg;
    mavlink_command_ack_t ack{};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_TEMPORARILY_REJECTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    calib_.processMessage(msg);

    // Wait a bit to let it process the TEMPORARILY_REJECTED result and emit "retrying" status
    std::this_thread::sleep_for(std::chrono::milliseconds(2100));

    // Cancel to exit quickly during the second retry sleep
    calib_.cancelEscCalibration();
    calib_thread.join();

    // Verify retry status was emitted
    bool retrying_logged = false;
    for (const auto& log : sent_json_messages_) {
        json j = json::parse(log);
        if (j.value("stage", "") == "retrying") {
            retrying_logged = true;
        }
    }
    EXPECT_TRUE(retrying_logged);
}

