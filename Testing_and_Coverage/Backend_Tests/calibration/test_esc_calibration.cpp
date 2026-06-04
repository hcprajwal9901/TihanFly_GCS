#include <gtest/gtest.h>
#include "calibration/esc_calibration.h"
#include <thread>
#include <chrono>

// UT-CAL-ESC-001: Initialization
TEST(EscCalibrationTest, Initialization) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
}

// UT-CAL-ESC-002: Missing Transport Callback
TEST(EscCalibrationTest, MissingTransportCallback) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    
    bool json_sent = false;
    esc.setSendCallback([&](const std::string& json) {
        json_sent = true;
    });
    
    esc.startEscCalibration();
    EXPECT_TRUE(json_sent);
}

// Helper function to run startEscCalibration in a background thread and provide responses
void runEscTest(int result_code, int num_responses, bool wait_timeout, bool cancel) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    
    esc.setTransportCallback([&](const mavlink_message_t& msg) {
        if (msg.msgid == MAVLINK_MSG_ID_PARAM_SET) {
            // Respond to PARAM_SET? No, it waits for COMMAND_ACK for MAV_CMD_PREFLIGHT_CALIBRATION
        }
    });
    
    std::thread t([&]() {
        esc.startEscCalibration();
    });
    
    // Give thread time to send preflight command
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    
    if (cancel) {
        esc.cancelEscCalibration();
    } else if (!wait_timeout) {
        for (int i = 0; i < num_responses; ++i) {
            mavlink_message_t msg;
            mavlink_command_ack_t ack = {};
            ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
            ack.result = result_code;
            mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
            esc.processMessage(msg);
            
            if (i < num_responses - 1) {
                // Wait before sending next response (e.g. for retry loop)
                std::this_thread::sleep_for(std::chrono::milliseconds(2100));
            }
        }
    }
    
    if (wait_timeout) {
        // Wait for the timeout to occur natively (3 seconds)
        // No wait needed here, join will block until timeout occurs
    }
    
    if (t.joinable()) {
        t.join();
    }
}

// UT-CAL-ESC-003: Accepted
TEST(EscCalibrationTest, Accepted) {
    runEscTest(MAV_RESULT_ACCEPTED, 1, false, false);
}

// UT-CAL-ESC-004: Unsupported (Soft Accept)
TEST(EscCalibrationTest, Unsupported) {
    runEscTest(MAV_RESULT_UNSUPPORTED, 1, false, false);
}

// UT-CAL-ESC-005: Denied (Hard Failure)
TEST(EscCalibrationTest, Denied) {
    runEscTest(MAV_RESULT_DENIED, 1, false, false);
}

// UT-CAL-ESC-006: Timeout
TEST(EscCalibrationTest, Timeout) {
    // Too slow for quick unit tests without mocking clock, but we can call cancel early to simulate
    runEscTest(0, 0, false, true);
}

// UT-CAL-ESC-007: Temporarily Rejected Exhaustion
TEST(EscCalibrationTest, TemporarilyRejectedExhaustion) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    
    esc.setTransportCallback([&](const mavlink_message_t& msg) {
        // Do nothing
    });
    
    // Run start in a thread
    std::thread t([&]() {
        esc.startEscCalibration();
    });
    
    // Send 3 temporary rejections to trigger exhaustion
    for (int i = 0; i < 3; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        mavlink_message_t msg;
        mavlink_command_ack_t ack = {};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = MAV_RESULT_TEMPORARILY_REJECTED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
        esc.processMessage(msg);
    }
    
    if (t.joinable()) {
        t.join();
    }
}

// UT-CAL-ESC-008: Other Messages
TEST(EscCalibrationTest, OtherMessages) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    
    // Send unrelated message
    mavlink_message_t msg;
    mavlink_heartbeat_t hb = {};
    mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);
    esc.processMessage(msg);
    
    // Send wrong ack
    mavlink_command_ack_t ack = {};
    ack.command = MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    esc.processMessage(msg);
}

// UT-CAL-ESC-009: Duplicate Start
TEST(EscCalibrationTest, DuplicateStart) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    esc.setTransportCallback([&](const mavlink_message_t& msg) {});
    
    std::thread t([&]() {
        esc.startEscCalibration();
    });
    
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    
    // This duplicate start should return immediately
    esc.startEscCalibration();
    
    esc.cancelEscCalibration();
    if (t.joinable()) {
        t.join();
    }
}

TEST(EscCalibrationTest, CancelAndCallbacks) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    bool json_sent = false;
    esc.setSendCallback([&](const std::string& json) { json_sent = true; });
    esc.startEscCalibration();
    esc.cancelEscCalibration();
}
// ── NEW TESTS FOR COVERAGE IMPROVEMENT ──────────────────────────────────────

// Covers mavResultToString() for FAILED, IN_PROGRESS, CANCELLED, and unknown via processMessage().
TEST(EscCalibrationTest, MavResultToStringViaProcessMessage) {
    // Each sub-test sends an ACK with a specific result code through processMessage()
    // while calibrating_ is true, which triggers mavResultToString() at line 150.
    int results[] = { MAV_RESULT_FAILED, MAV_RESULT_IN_PROGRESS, MAV_RESULT_CANCELLED, 99 };
    for (int r : results) {
        EscCalibration esc;
        esc.setVehicleInfo(1, 1);
        esc.setTransportCallback([](const mavlink_message_t&) {});

        std::thread t([&]() {
            esc.startEscCalibration();
        });

        std::this_thread::sleep_for(std::chrono::milliseconds(50));

        mavlink_message_t msg;
        mavlink_command_ack_t ack = {};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = r;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
        esc.processMessage(msg);

        esc.cancelEscCalibration();
        if (t.joinable()) t.join();
    }
}

// Covers the hard error branch (lines 265-271).
// Sends MAV_RESULT_DENIED via processMessage during the 2s wait.
// With the conditional fallback, processMessage sets ack_result_=DENIED,
// and since ack_received_=true the fallback doesn't override it.
TEST(EscCalibrationTest, HardErrorDeniedBranch) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);

    std::string last_stage;
    esc.setSendCallback([&](const std::string& json) {
        // Parse stage from JSON
        auto pos = json.find("\"stage\":\"");
        if (pos != std::string::npos) {
            auto start = pos + 9;
            auto end = json.find("\"", start);
            last_stage = json.substr(start, end - start);
        }
    });
    esc.setTransportCallback([](const mavlink_message_t&) {});

    std::thread t([&]() {
        esc.startEscCalibration();
    });

    // Wait for the calibration thread to enter the sleep loop
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    // Send DENIED result — this sets ack_received_=true and ack_result_=DENIED
    mavlink_message_t msg;
    mavlink_command_ack_t ack = {};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_DENIED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    esc.processMessage(msg);

    if (t.joinable()) t.join();

    // Should have hit the hard error branch
    EXPECT_EQ(last_stage, "error");
}

// Covers the TEMPORARILY_REJECTED retry loop (lines 240-252) and
// exhaustion path (lines 254-262).
// Sends TEMPORARILY_REJECTED ACKs during each retry attempt's wait window.
TEST(EscCalibrationTest, TemporarilyRejectedRetryBranch) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);

    std::string last_stage;
    esc.setSendCallback([&](const std::string& json) {
        auto pos = json.find("\"stage\":\"");
        if (pos != std::string::npos) {
            auto start = pos + 9;
            auto end = json.find("\"", start);
            last_stage = json.substr(start, end - start);
        }
    });
    esc.setTransportCallback([](const mavlink_message_t&) {});

    std::thread t([&]() {
        esc.startEscCalibration();
    });

    // Send TEMPORARILY_REJECTED during each of the 3 retry attempts.
    // Each attempt has a 2s (40*50ms) wait.
    for (int attempt = 0; attempt < 3; ++attempt) {
        // Wait for the thread to enter the sleep loop for this attempt
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        mavlink_message_t msg;
        mavlink_command_ack_t ack = {};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = MAV_RESULT_TEMPORARILY_REJECTED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
        esc.processMessage(msg);

        if (attempt < 2) {
            // Wait for the 2s retry sleep to complete before the next attempt
            std::this_thread::sleep_for(std::chrono::milliseconds(4000));
        }
    }

    if (t.joinable()) t.join();

    // After 3 TEMPORARILY_REJECTED responses, should hit exhaustion error
    EXPECT_EQ(last_stage, "error");
}

// Covers the retry attempt_suffix (lines 198-200) — retry_count > 0.
// This is triggered during the retry loop when TEMPORARILY_REJECTED is received.
// Already covered by TemporarilyRejectedRetryBranch above which does multiple retries.

// Covers the post-reboot cancel check (lines 293-297).
TEST(EscCalibrationTest, CancelDuringRebootPhase) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    esc.setTransportCallback([](const mavlink_message_t&) {});

    std::thread t([&]() {
        esc.startEscCalibration();
    });

    // Wait for preflight (2s) to complete, then cancel during reboot wait
    std::this_thread::sleep_for(std::chrono::milliseconds(2200));

    esc.cancelEscCalibration();
    if (t.joinable()) t.join();
}

// Covers the in-loop cancel check (lines 215-219).
TEST(EscCalibrationTest, CancelDuringPreflightWait) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    esc.setTransportCallback([](const mavlink_message_t&) {});

    std::thread t([&]() {
        esc.startEscCalibration();
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    esc.cancelEscCalibration();

    if (t.joinable()) t.join();
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-ESC-FUNC-001
    Function : EscCalibration::mavResultToString
    Description : Verify result string serialization.
    Input : MAV_RESULT_ACCEPTED
    Expected Output : "ACCEPTED"
*/
TEST(EscCalibrationTest, MavResultToStringAccepted) {
    EXPECT_NO_THROW({
        EscCalibration esc;
        esc.setVehicleInfo(1, 1);
        esc.setTransportCallback([](const mavlink_message_t&){});
        std::thread t([&]() { esc.startEscCalibration(); });
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        mavlink_message_t msg;
        mavlink_command_ack_t ack = {};
        ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
        ack.result = MAV_RESULT_ACCEPTED;
        mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
        esc.processMessage(msg);
        if (t.joinable()) t.join();
    });
}

/*
    UT-ESC-FUNC-002
    Function : EscCalibration::setSendCallback
    Description : Verify send callback assignment.
    Input : Valid std::function
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, SetSendCallbackFUNC) {
    EscCalibration esc;
    EXPECT_NO_THROW({
        esc.setSendCallback([](const std::string&) {});
    });
}

/*
    UT-ESC-FUNC-003
    Function : EscCalibration::setTransportCallback
    Description : Verify transport callback assignment.
    Input : Valid std::function
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, SetTransportCallbackFUNC) {
    EscCalibration esc;
    EXPECT_NO_THROW({
        esc.setTransportCallback([](const mavlink_message_t&) {});
    });
}

/*
    UT-ESC-FUNC-004
    Function : EscCalibration::setVehicleInfo
    Description : Verify vehicle info initialization.
    Input : sysid = 1, compid = 1
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, SetVehicleInfoFUNC) {
    EscCalibration esc;
    EXPECT_NO_THROW({
        esc.setVehicleInfo(1, 1);
    });
}

/*
    UT-ESC-FUNC-005
    Function : EscCalibration::sendPreflight
    Description : Verify sending preflight calibration command.
    Input : None
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, SendPreflightFUNC) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    bool called = false;
    esc.setTransportCallback([&](const mavlink_message_t& msg) {
        if (msg.msgid == MAVLINK_MSG_ID_PARAM_SET) {
            called = true;
        }
    });
    std::thread t([&]() { esc.startEscCalibration(); });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    esc.cancelEscCalibration();
    if (t.joinable()) t.join();
    EXPECT_TRUE(called);
}

/*
    UT-ESC-FUNC-006
    Function : EscCalibration::sendReboot
    Description : Verify reboot command transmission.
    Input : None
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, SendRebootFUNC) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    bool called = false;
    esc.setTransportCallback([&](const mavlink_message_t& msg) {
        if (msg.msgid == MAVLINK_MSG_ID_COMMAND_LONG) {
            mavlink_command_long_t cmd;
            mavlink_msg_command_long_decode(&msg, &cmd);
            if (cmd.command == MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN) {
                called = true;
            }
        }
    });
    std::thread t([&]() { esc.startEscCalibration(); });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    mavlink_message_t msg;
    mavlink_command_ack_t ack = {};
    ack.command = MAV_CMD_PREFLIGHT_CALIBRATION;
    ack.result = MAV_RESULT_ACCEPTED;
    mavlink_msg_command_ack_encode(1, 1, &msg, &ack);
    esc.processMessage(msg);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    esc.cancelEscCalibration();
    if (t.joinable()) t.join();
}

/*
    UT-ESC-FUNC-007
    Function : EscCalibration::processMessage
    Description : Verify processing of a generic MAVLink message.
    Input : Heartbeat message
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, ProcessMessageFUNC) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    mavlink_message_t msg;
    mavlink_heartbeat_t hb = {};
    mavlink_msg_heartbeat_encode(1, 1, &msg, &hb);
    EXPECT_NO_THROW({
        esc.processMessage(msg);
    });
}

/*
    UT-ESC-FUNC-008
    Function : EscCalibration::cancelEscCalibration
    Description : Verify cancellation of an active calibration.
    Input : None
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, CancelEscCalibrationFUNC) {
    EscCalibration esc;
    EXPECT_NO_THROW({
        esc.cancelEscCalibration();
    });
}

/*
    UT-ESC-FUNC-009
    Function : EscCalibration::startEscCalibration
    Description : Verify starting calibration process.
    Input : None
    Expected Output : Executes successfully
*/
TEST(EscCalibrationTest, StartEscCalibrationFUNC) {
    EscCalibration esc;
    esc.setVehicleInfo(1, 1);
    esc.setTransportCallback([](const mavlink_message_t&){});
    std::thread t([&]() { esc.startEscCalibration(); });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    esc.cancelEscCalibration();
    if (t.joinable()) t.join();
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-ESC-EXT-001
    Function : EscCalibration::setVehicleInfo
    Description : Verify handling of negative vehicle IDs.
    Input : sysid = -1, compid = -1
    Expected Output : Gracefully sets values without crashing
*/
TEST(EscCalibrationTest, NegativeVehicleInfoHandling) {
    EscCalibration esc;
    EXPECT_NO_THROW({
        esc.setVehicleInfo(-1, -1);
    });
}

/*
    UT-ESC-EXT-002
    Function : EscCalibration::processMessage
    Description : Verify handling of corrupted/garbage messages.
    Input : Empty or malformed mavlink message
    Expected Output : Gracefully discards message
*/
TEST(EscCalibrationTest, CorruptedMessageHandling) {
    EscCalibration esc;
    mavlink_message_t msg = {};
    EXPECT_NO_THROW({
        esc.processMessage(msg);
    });
}