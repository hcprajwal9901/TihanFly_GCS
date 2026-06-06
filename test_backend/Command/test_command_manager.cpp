#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <memory>
#include <atomic>
#include <future>
#include <nlohmann/json.hpp>

#include "Command/command_manager.h"
#include "Vehicle/vehicle.h"
#include "Vehicle/vehicle_manager.h"
#include "Link/link_manager.h"
#include "../Link/mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;
using json = nlohmann::json;

// ─── C++ Template Private Member Access Hack ─────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct CommandManagerSendMissionItemTag {
    typedef void (CommandManager::*type)(uint16_t);
    friend type get(CommandManagerSendMissionItemTag);
};
template struct PrivateAccessor<CommandManagerSendMissionItemTag, &CommandManager::send_mission_item>;

class CommandManagerTest : public ::testing::Test {
protected:
    asio::io_context io_;
    LinkManager link_manager_;
    std::shared_ptr<MockTransport> mock_transport_ = std::make_shared<MockTransport>();
    int link_id_ = 0;

    void SetUp() override {
        link_id_ = link_manager_.add_link(mock_transport_, io_);
    }
};

// Helper to construct a mavlink heartbeat packet
static mavlink_message_t make_heartbeat(uint8_t sysid, uint8_t compid) {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(sysid, compid, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    return msg;
}

// UT-CMD-001: Happy Path - Mode A Command Execution (ARM/DISARM)
TEST_F(CommandManagerTest, ModeA_ArmDisarmCommands) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    // Catch the message sent via transport
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    // Act
    cmd_mgr.add_command(1, "ARM");
    cmd_mgr.process();

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t msg = sent_msg_future.get();
    EXPECT_EQ(msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);

    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_COMPONENT_ARM_DISARM);
    EXPECT_FLOAT_EQ(cmd.param1, 1.0f); // 1 = arm
}

// UT-CMD-002: Happy Path - Mode A Command Execution (TAKEOFF)
TEST_F(CommandManagerTest, ModeA_TakeoffCommand) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    // Act
    cmd_mgr.add_command(2, "TAKEOFF", 15.5f); // 15.5 meters takeoff
    cmd_mgr.process();

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t msg = sent_msg_future.get();
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_NAV_TAKEOFF);
    EXPECT_FLOAT_EQ(cmd.param7, 15.5f); // param7 = altitude
}

// UT-CMD-003: Happy Path - Mode A Custom Mode Mapping
TEST_F(CommandManagerTest, ModeA_SetModeCommand) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    // Act
    cmd_mgr.add_command(3, "SET_MODE", 0, 0, "GUIDED");
    cmd_mgr.process();

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t msg = sent_msg_future.get();
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&msg, &cmd);
    EXPECT_EQ(cmd.command, MAV_CMD_DO_SET_MODE);
    EXPECT_FLOAT_EQ(cmd.param2, 4.0f); // 4 = GUIDED in ArduCopter
}

// UT-CMD-004: Happy Path - Mode B Command Execution via VehicleManager
TEST_F(CommandManagerTest, ModeB_ResolveActiveVehicle) {
    // Arrange
    VehicleManager vm(&link_manager_);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_manager(&vm);

    // Simulate vehicle discovery by sending a heartbeat
    mavlink_message_t hb = make_heartbeat(42, 1);
    vm.handle_message(hb, link_id_);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    // Act
    cmd_mgr.add_command(4, "DISARM");
    cmd_mgr.process();

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t msg = sent_msg_future.get();
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(&msg, &cmd);
    EXPECT_EQ(cmd.target_system, 42); // Check that the resolved vehicle sysid is correct
}

// UT-CMD-005: Happy Path - Stateful Mission Upload Handshake
TEST_F(CommandManagerTest, MissionUpload_StatefulHandshake) {
    // Arrange
    CommandManager cmd_mgr;
    cmd_mgr.set_transport(mock_transport_);

    std::vector<WaypointItem> wps = {
        {0, 12.34f, 56.78f, 10.0f, 16, 3, 0.0f, true},
        {1, 12.35f, 56.79f, 20.0f, 16, 3, 5.0f, true}
    };

    std::promise<mavlink_message_t> count_promise;
    auto count_future = count_promise.get_future();

    std::promise<mavlink_message_t> item_promise;
    auto item_future = item_promise.get_future();

    // Expecting 1: MISSION_COUNT, 2: MISSION_ITEM_INT
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .Times(2)
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    count_promise.set_value(msg);
                    break;
                }
            }
        }))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    item_promise.set_value(msg);
                    break;
                }
            }
        }));

    std::promise<std::string> ack_promise;
    auto ack_future = ack_promise.get_future();
    cmd_mgr.set_response_callback([&](const std::string& resp) {
        ack_promise.set_value(resp);
    });

    // Act & Assert 1: Start upload (sends mission count)
    cmd_mgr.upload_mission(100, wps, 1, 1, nullptr);
    ASSERT_TRUE(count_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    
    mavlink_message_t count_msg = count_future.get();
    EXPECT_EQ(count_msg.msgid, MAVLINK_MSG_ID_MISSION_COUNT);
    
    mavlink_mission_count_t mc;
    mavlink_msg_mission_count_decode(&count_msg, &mc);
    EXPECT_EQ(mc.count, 2);

    // Act & Assert 2: Request first item (seq = 0)
    cmd_mgr.on_mission_request(0);
    ASSERT_TRUE(item_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    
    mavlink_message_t item_msg = item_future.get();
    EXPECT_EQ(item_msg.msgid, MAVLINK_MSG_ID_MISSION_ITEM_INT);
    
    mavlink_mission_item_int_t mi;
    mavlink_msg_mission_item_int_decode(&item_msg, &mi);
    EXPECT_EQ(mi.seq, 0);
    EXPECT_EQ(mi.x, static_cast<int32_t>(12.34f * 1e7f));

    // Act & Assert 3: Acknowledge completion
    cmd_mgr.on_mission_ack(MAV_MISSION_ACCEPTED);
    ASSERT_TRUE(ack_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    
    std::string ack_json_str = ack_future.get();
    json ack_json = json::parse(ack_json_str);
    EXPECT_EQ(ack_json["type"], "mission_ack");
    EXPECT_EQ(ack_json["status"], "success");
    EXPECT_EQ(ack_json["id"], 100);
}

// UT-CMD-006: Boundary - Empty or Unknown commands
TEST_F(CommandManagerTest, Boundary_EmptyOrUnknownCommands) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    // Expect no transmissions
    EXPECT_CALL(*mock_transport_, async_send(_, _)).Times(0);

    // Act
    cmd_mgr.add_command(1, ""); // empty name
    cmd_mgr.add_command(2, "INVALID_COMMAND"); // unknown command
    cmd_mgr.process();

    SUCCEED();
}

// UT-CMD-007: Command execution of LAND, RTL, FORCE_ARM
TEST_F(CommandManagerTest, LandRtlForceArmCommands) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    std::vector<mavlink_message_t> sent_msgs;
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .Times(3)
        .WillRepeatedly(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msgs.push_back(msg);
                    break;
                }
            }
        }));

    // Act
    cmd_mgr.add_command(1, "LAND");
    cmd_mgr.add_command(2, "RTL");
    cmd_mgr.add_command(3, "FORCE_ARM");
    cmd_mgr.process();

    // Assert
    ASSERT_EQ(sent_msgs.size(), 3u);

    // Verify LAND (maps to DO_SET_MODE with custom mode 9)
    mavlink_command_long_t land_cmd;
    mavlink_msg_command_long_decode(&sent_msgs[0], &land_cmd);
    EXPECT_EQ(land_cmd.command, MAV_CMD_DO_SET_MODE);
    EXPECT_FLOAT_EQ(land_cmd.param2, 9.0f);

    // Verify RTL (maps to DO_SET_MODE with custom mode 6)
    mavlink_command_long_t rtl_cmd;
    mavlink_msg_command_long_decode(&sent_msgs[1], &rtl_cmd);
    EXPECT_EQ(rtl_cmd.command, MAV_CMD_DO_SET_MODE);
    EXPECT_FLOAT_EQ(rtl_cmd.param2, 6.0f);

    // Verify FORCE_ARM (maps to COMPONENT_ARM_DISARM with magic param2)
    mavlink_command_long_t fa_cmd;
    mavlink_msg_command_long_decode(&sent_msgs[2], &fa_cmd);
    EXPECT_EQ(fa_cmd.command, MAV_CMD_COMPONENT_ARM_DISARM);
    EXPECT_FLOAT_EQ(fa_cmd.param2, 21196.0f);
}

// UT-CMD-008: SET_MODE other modes and unknown mode mapping
TEST_F(CommandManagerTest, SetMode_VariousModes) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    std::vector<mavlink_message_t> sent_msgs;
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .Times(3)
        .WillRepeatedly(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msgs.push_back(msg);
                    break;
                }
            }
        }));

    // Act
    cmd_mgr.add_command(1, "SET_MODE", 0, 0, "ALT_HOLD");
    cmd_mgr.add_command(2, "SET_MODE", 0, 0, "POSHOLD");
    cmd_mgr.add_command(3, "SET_MODE", 0, 0, "UNKNOWN_MODE_XYZ");
    cmd_mgr.process();

    // Assert
    ASSERT_EQ(sent_msgs.size(), 3u);

    // ALT_HOLD is 2
    mavlink_command_long_t cmd1;
    mavlink_msg_command_long_decode(&sent_msgs[0], &cmd1);
    EXPECT_FLOAT_EQ(cmd1.param2, 2.0f);

    // POSHOLD is 16
    mavlink_command_long_t cmd2;
    mavlink_msg_command_long_decode(&sent_msgs[1], &cmd2);
    EXPECT_FLOAT_EQ(cmd2.param2, 16.0f);

    // UNKNOWN_MODE_XYZ maps to 0 (STABILIZE)
    mavlink_command_long_t cmd3;
    mavlink_msg_command_long_decode(&sent_msgs[2], &cmd3);
    EXPECT_FLOAT_EQ(cmd3.param2, 0.0f);
}

// UT-CMD-009: resolve_vehicle error branches
TEST_F(CommandManagerTest, ResolveVehicle_ErrorBranches) {
    CommandManager cmd_mgr;

    // 1. No routing configured
    cmd_mgr.add_command(1, "ARM");
    // This should print error and return early without crashing
    EXPECT_NO_THROW({
        cmd_mgr.process();
    });

    // 2. VehicleManager set, but no active vehicle
    LinkManager lm;
    VehicleManager vm(&lm);
    cmd_mgr.set_vehicle_manager(&vm);
    cmd_mgr.add_command(2, "ARM");
    EXPECT_NO_THROW({
        cmd_mgr.process();
    });
}

// UT-CMD-010: Mission upload error branches
TEST_F(CommandManagerTest, MissionUpload_ErrorBranches) {
    CommandManager cmd_mgr;
    std::vector<WaypointItem> wps = {
        {0, 1.0f, 2.0f, 10.0f, 16, 3, 0.f, true}
    };

    // 1. No active transport and no vehicle
    bool got_error = false;
    cmd_mgr.set_response_callback([&](const std::string& resp) {
        json j = json::parse(resp);
        if (j["type"] == "mission_ack" && j["status"] == "error") {
            got_error = true;
        }
    });

    cmd_mgr.upload_mission(1, wps, 1, 1, nullptr);
    EXPECT_TRUE(got_error);

    // Set transport to allow progress
    cmd_mgr.set_transport(mock_transport_);

    // 2. Upload already in progress
    std::vector<uint8_t> sent_bytes;
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t*, std::size_t) {})); // only gets called once for the first upload

    cmd_mgr.upload_mission(2, wps, 1, 1, nullptr);
    
    // Call upload_mission again while in progress; should print warning and ignore
    cmd_mgr.upload_mission(3, wps, 1, 1, nullptr);

    // 3. on_mission_request when not in progress (simulate ignore)
    CommandManager cmd_mgr2;
    cmd_mgr2.on_mission_request(0); // should return early without sending anything

    // 4. send_mission_item index out of range
    auto send_mission_item_fn = get(CommandManagerSendMissionItemTag{});
    (cmd_mgr.*send_mission_item_fn)(99); // seq >= pending_mission_.size(), should do nothing

    // 5. on_mission_ack error status
    bool got_ack_error = false;
    cmd_mgr.set_response_callback([&](const std::string& resp) {
        json j = json::parse(resp);
        if (j["type"] == "mission_ack" && j["status"] == "error" && j["id"] == 2) {
            got_ack_error = true;
        }
    });
    cmd_mgr.on_mission_ack(MAV_MISSION_DENIED);
    EXPECT_TRUE(got_ack_error);
}

// UT-CMD-011: Mission upload via target vehicle route (Multi-vehicle)
TEST_F(CommandManagerTest, MissionUpload_MultiVehicleRoute) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    // Don't set active_transport, we will pass vehicle directly

    std::vector<WaypointItem> wps = {
        {0, 10.0f, 20.0f, 15.0f, 16, 3, 0.f, true}
    };

    std::vector<mavlink_message_t> sent_msgs;
    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .Times(2)
        .WillRepeatedly(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msgs.push_back(msg);
                    break;
                }
            }
        }));

    // Act 1: upload_mission with vehicle
    cmd_mgr.upload_mission(10, wps, 1, 1, &vehicle);

    // Assert 1: Sent mission count through vehicle link
    ASSERT_EQ(sent_msgs.size(), 1u);
    EXPECT_EQ(sent_msgs[0].msgid, MAVLINK_MSG_ID_MISSION_COUNT);

    // Act 2: send mission item through vehicle link
    cmd_mgr.on_mission_request(0);

    // Assert 2: Sent item through vehicle link
    ASSERT_EQ(sent_msgs.size(), 2u);
    EXPECT_EQ(sent_msgs[1].msgid, MAVLINK_MSG_ID_MISSION_ITEM_INT);

    // Clean up
    cmd_mgr.on_mission_ack(MAV_MISSION_ACCEPTED);
}

// UT-CMD-012: Command Specific Vehicle Override
TEST_F(CommandManagerTest, CommandSpecificVehicleOverride) {
    auto vehicle = std::make_shared<Vehicle>(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillOnce(Invoke([&](const uint8_t* data, std::size_t len) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (std::size_t i = 0; i < len; ++i) {
                if (mavlink_parse_char(MAVLINK_COMM_0, data[i], &msg, &status)) {
                    sent_msg_promise.set_value(msg);
                    break;
                }
            }
        }));

    cmd_mgr.add_command(1, "ARM", 0.0f, 0.0f, "", vehicle);
    cmd_mgr.process();

    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t msg = sent_msg_future.get();
    EXPECT_EQ(msg.msgid, MAVLINK_MSG_ID_COMMAND_LONG);
}

// UT-CMD-013: SetMode All Modes
TEST_F(CommandManagerTest, SetMode_AllModes) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillRepeatedly(Invoke([](const uint8_t*, std::size_t) {}));

    std::vector<std::string> modes = {
        "STABILIZE", "Stabilize", "ACRO", "Acro", "ALT_HOLD", "Altitude Hold", "Alt Hold",
        "AUTO", "Auto", "GUIDED", "Guided", "LOITER", "Loiter", "RTL", "CIRCLE", "Circle",
        "LAND", "Land", "DRIFT", "Drift", "SPORT", "Sport", "FLIP", "Flip", "AUTOTUNE", "AutoTune",
        "POSHOLD", "Position Hold", "Position", "Pos Hold", "BRAKE", "Brake", "THROW", "Throw",
        "AVOID_ADSB", "Avoid ADSB", "GUIDED_NOGPS", "Guided No GPS", "SMART_RTL", "Smart RTL",
        "FLOWHOLD", "Flow Hold", "FOLLOW", "Follow", "Follow Me", "ZIGZAG", "Zigzag", "ZigZag",
        "SYSTEMID", "System ID", "AUTOROTATE", "Heli Autorotate", "AUTO_RTL", "Auto RTL"
    };

    int id = 1;
    for (const auto& mode : modes) {
        cmd_mgr.add_command(id++, "SET_MODE", 0, 0, mode);
    }
    cmd_mgr.process();
}

// UT-CMD-014: Response Callback for normal command and takeoff
TEST_F(CommandManagerTest, ResponseCallback_NormalAndTakeoff) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    CommandManager cmd_mgr;
    cmd_mgr.set_vehicle_direct(&vehicle);

    EXPECT_CALL(*mock_transport_, async_send(_, _))
        .WillRepeatedly(Invoke([](const uint8_t*, std::size_t) {}));

    std::vector<std::string> responses;
    cmd_mgr.set_response_callback([&](const std::string& resp) {
        responses.push_back(resp);
    });

    // 1. Normal command (ARM)
    cmd_mgr.add_command(1, "ARM");
    cmd_mgr.process();
    ASSERT_EQ(responses.size(), 1u);
    json res1 = json::parse(responses[0]);
    EXPECT_EQ(res1["type"], "response");
    EXPECT_EQ(res1["command"], "ARM");
    EXPECT_EQ(res1["status"], "success");

    // 2. Takeoff with altitude > 0
    responses.clear();
    cmd_mgr.add_command(2, "TAKEOFF", 15.0f);
    cmd_mgr.process();
    ASSERT_EQ(responses.size(), 1u);
    json res2 = json::parse(responses[0]);
    EXPECT_EQ(res2["command"], "TAKEOFF");
    EXPECT_FLOAT_EQ(res2["altitude"], 15.0f);

    // 3. Takeoff with altitude <= 0
    responses.clear();
    cmd_mgr.add_command(3, "TAKEOFF", 0.0f);
    cmd_mgr.process();
    ASSERT_EQ(responses.size(), 1u);
    json res3 = json::parse(responses[0]);
    EXPECT_EQ(res3["command"], "TAKEOFF");
    EXPECT_FLOAT_EQ(res3["altitude"], 10.0f);
}

