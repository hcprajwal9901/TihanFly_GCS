#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "Command/command_manager.h"
#include "Vehicle/vehicle.h"
#include "Vehicle/vehicle_manager.h"
#include "Link/link_manager.h"
#include "Transport/transport.h"
#include <nlohmann/json.hpp>
#include <mavlink/ardupilotmega/mavlink.h>

using namespace testing;
using json = nlohmann::json;

// Mock Transport for testing mission uploads
class MockTransport : public Transport {
public:
    MOCK_METHOD(void, start, (), (override));
    MOCK_METHOD(void, async_send, (const uint8_t* data, size_t length), (override));
    MOCK_METHOD(void, set_receive_callback, (std::function<void(const uint8_t*, size_t)> cb), (override));
};

class CommandManagerTest : public Test {
protected:
    std::unique_ptr<LinkManager> link_manager;
    std::unique_ptr<VehicleManager> vehicle_manager;
    std::shared_ptr<Vehicle> direct_vehicle;
    std::unique_ptr<CommandManager> cmd_manager;
    std::shared_ptr<MockTransport> mock_transport;

    void SetUp() override {
        link_manager = std::make_unique<LinkManager>();
        vehicle_manager = std::make_unique<VehicleManager>(link_manager.get());
        direct_vehicle = std::make_shared<Vehicle>(1, 1, 0, link_manager.get(), 1);
        cmd_manager = std::make_unique<CommandManager>();
        mock_transport = std::make_shared<MockTransport>();
    }
};

// UT-CMD-001: Initialization & Empty State
TEST_F(CommandManagerTest, InitializationAndEmptyState) {
    // Should not crash when processing an empty queue
    EXPECT_NO_THROW(cmd_manager->process());
}

// UT-CMD-002: Mode Configuration (Direct vs Manager)
TEST_F(CommandManagerTest, ModeConfiguration) {
    // Mode A: Direct
    cmd_manager->set_vehicle_direct(direct_vehicle.get());
    
    // We can't directly check private pointers, but we can verify behavior
    // by adding a command and checking if it gets processed without error.
    cmd_manager->add_command(1, "ARM");
    EXPECT_NO_THROW(cmd_manager->process());

    // Mode B: Manager
    cmd_manager->set_vehicle_manager(vehicle_manager.get());
    // Simulate finding a vehicle
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(42, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    vehicle_manager->handle_message(msg, 0);

    cmd_manager->add_command(2, "DISARM");
    EXPECT_NO_THROW(cmd_manager->process());
}

// UT-CMD-003: Command Queueing & Processing
TEST_F(CommandManagerTest, CommandQueueingProcessing) {
    cmd_manager->set_vehicle_direct(direct_vehicle.get());
    
    int cb_count = 0;
    std::string last_response;
    cmd_manager->set_response_callback([&](const std::string& res) {
        cb_count++;
        last_response = res;
    });

    cmd_manager->add_command(1, "TAKEOFF", 20.0f);
    cmd_manager->add_command(2, "LAND");
    
    // Nothing should happen until process is called
    EXPECT_EQ(cb_count, 0);

    cmd_manager->process();

    EXPECT_EQ(cb_count, 2);
    auto j = json::parse(last_response);
    EXPECT_EQ(j["command"], "LAND");
    EXPECT_EQ(j["status"], "success");
}

// UT-CMD-004: Specific Commands Translation
TEST_F(CommandManagerTest, SpecificCommandsTranslation) {
    cmd_manager->set_vehicle_direct(direct_vehicle.get());
    
    int cb_count = 0;
    std::string last_response;
    cmd_manager->set_response_callback([&](const std::string& res) {
        cb_count++;
        last_response = res;
    });

    // Test SET_MODE
    cmd_manager->add_command(1, "SET_MODE", 0, 0, "GUIDED");
    cmd_manager->process();
    EXPECT_EQ(cb_count, 1);
    
    auto j = json::parse(last_response);
    EXPECT_EQ(j["command"], "SET_MODE");

    // Test unknown command
    cmd_manager->add_command(2, "UNKNOWN_CMD");
    cmd_manager->process();
    // Callback should not be fired for unknown commands
    EXPECT_EQ(cb_count, 1); 

    // Test unknown mode
    cmd_manager->add_command(3, "SET_MODE", 0, 0, "UNKNOWN_MODE");
    cmd_manager->process();
    // Callback is fired even if mode mapping fails (it defaults to 0)
    EXPECT_EQ(cb_count, 2); 
}

// UT-CMD-005: Mission Upload & Handshake
TEST_F(CommandManagerTest, MissionUploadHandshake) {
    cmd_manager->set_transport(mock_transport);

    std::vector<WaypointItem> wps;
    WaypointItem wp1;
    wp1.seq = 0; wp1.lat = 40.0; wp1.lng = -73.0; wp1.altitude = 10.0;
    wps.push_back(wp1);
    
    // Expect MISSION_COUNT to be sent
    EXPECT_CALL(*mock_transport, async_send(NotNull(), Gt(0))).Times(1);
    
    cmd_manager->upload_mission(100, wps, 1, 0, nullptr);
    
    // Simulate receiving MISSION_REQUEST for seq 0
    // Expect MISSION_ITEM_INT to be sent
    EXPECT_CALL(*mock_transport, async_send(NotNull(), Gt(0))).Times(1);
    cmd_manager->on_mission_request(0);

    // Simulate receiving MISSION_ACK
    bool cb_fired = false;
    cmd_manager->set_response_callback([&](const std::string& res) {
        auto j = json::parse(res);
        if (j["type"] == "mission_ack" && j["status"] == "success") {
            cb_fired = true;
        }
    });
    cmd_manager->on_mission_ack(MAV_MISSION_ACCEPTED);
    EXPECT_TRUE(cb_fired);
}

// UT-CMD-006: Mission Upload Error Handling
TEST_F(CommandManagerTest, MissionUploadErrorHandling) {
    bool cb_fired = false;
    cmd_manager->set_response_callback([&](const std::string& res) {
        auto j = json::parse(res);
        if (j["type"] == "mission_ack" && j["status"] == "error") {
            cb_fired = true;
        }
    });

    std::vector<WaypointItem> wps;
    // Attempt upload without transport or vehicle
    cmd_manager->upload_mission(101, wps, 1, 0, nullptr);
    EXPECT_TRUE(cb_fired);
}
