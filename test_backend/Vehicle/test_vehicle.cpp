#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <thread>
#include <chrono>
#include <mutex>
#include <atomic>
#include <memory>
#include <future>

#include "Vehicle/vehicle.h"
#include "Link/link_manager.h"
#include "../Link/mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;

// ─── C++ Template Private Member Access Hack ─────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct VehicleLastHeartbeatTag {
    typedef std::chrono::steady_clock::time_point Vehicle::*type;
    friend type get(VehicleLastHeartbeatTag);
};
template struct PrivateAccessor<VehicleLastHeartbeatTag, &Vehicle::last_heartbeat_>;

struct VehicleCreatedAtTag {
    typedef std::chrono::steady_clock::time_point Vehicle::*type;
    friend type get(VehicleCreatedAtTag);
};
template struct PrivateAccessor<VehicleCreatedAtTag, &Vehicle::created_at_>;

struct VehicleRebootedTag {
    typedef std::atomic<bool> Vehicle::*type;
    friend type get(VehicleRebootedTag);
};
template struct PrivateAccessor<VehicleRebootedTag, &Vehicle::rebooted_>;


class VehicleTest : public ::testing::Test {
protected:
    asio::io_context io_;
    LinkManager link_manager_;
    std::shared_ptr<MockTransport> mock_transport_ = std::make_shared<MockTransport>();
    int link_id_ = 0;

    void SetUp() override {
        link_id_ = link_manager_.add_link(mock_transport_, io_);
    }
};

// UT-VEH-001: Happy Path - Construction and Identity Getters
TEST_F(VehicleTest, Construction_PropertiesCorrect) {
    // Arrange & Act
    Vehicle vehicle(42, 1, link_id_, &link_manager_, 2);

    // Assert
    EXPECT_EQ(vehicle.sysid(), 42);
    EXPECT_EQ(vehicle.compid(), 1);
    EXPECT_EQ(vehicle.link_id(), link_id_);
    EXPECT_EQ(vehicle.ui_sysid(), 2);
}

// UT-VEH-002: Happy Path - Link Switching
TEST_F(VehicleTest, SetLinkId_UpdatesLinkProperty) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    // Act
    vehicle.set_link_id(99);

    // Assert
    EXPECT_EQ(vehicle.link_id(), 99);
}

// UT-VEH-003: Happy Path - Send MAVLink Message
TEST_F(VehicleTest, SendMavlink_RoutesToLinkManagerAndTransport) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    
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

    mavlink_message_t test_msg;
    mavlink_msg_ping_pack(1, 200, &test_msg, 123456, 1, 1, 1);

    // Act
    vehicle.send_mavlink(test_msg);

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_PING);
}

// UT-VEH-004: Happy Path - Handlers Dispatching
TEST_F(VehicleTest, ProcessMessage_DispatchesToRegisteredHandlers) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    
    std::atomic<int> handler_calls{0};
    vehicle.register_handler(MAVLINK_MSG_ID_HEARTBEAT, [&](const mavlink_message_t& m) {
        handler_calls++;
    });

    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);

    // Act
    vehicle.process_message(msg);

    // Assert
    EXPECT_EQ(handler_calls.load(), 1);
}

// UT-VEH-005: Happy Path - Telemetry Cache Parsing (Heartbeat, Armed, Mode)
TEST_F(VehicleTest, ProcessMessage_DecodesHeartbeatTelemetry) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    
    // Heartbeat armed guided mode
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 
                               MAV_MODE_FLAG_SAFETY_ARMED | MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 
                               4, // GUIDED
                               MAV_STATE_ACTIVE);

    // Act
    vehicle.process_message(msg);

    // Assert
    EXPECT_TRUE(vehicle.is_armed());
    EXPECT_EQ(vehicle.flight_mode_string(), "GUIDED");
}

// Helper to construct a mavlink heartbeat packet
static mavlink_message_t make_heartbeat(uint8_t sysid, uint8_t compid) {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(sysid, compid, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    return msg;
}

// UT-VEH-006: Happy Path - Telemetry Cache Parsing (GPS & MSL altitude)
TEST_F(VehicleTest, ProcessMessage_DecodesGPSTelemetry) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    mavlink_message_t msg;
    mavlink_msg_gps_raw_int_pack(1, 1, &msg, 0, 3, 123456780, 876543210, 15000, 9999, 9999, 100, 36000, 12, 0, 0, 0, 0, 0, 0);

    // Act
    vehicle.process_message(msg);

    // Assert
    EXPECT_DOUBLE_EQ(vehicle.latitude(), 12.345678);
    EXPECT_DOUBLE_EQ(vehicle.longitude(), 87.654321);
    EXPECT_FLOAT_EQ(vehicle.altitude_msl(), 15.0f); // 15000mm = 15m
    EXPECT_EQ(vehicle.gps_satellites(), 12);
}

// UT-VEH-007: Happy Path - Telemetry Cache Parsing (Battery Status)
TEST_F(VehicleTest, ProcessMessage_DecodesBatteryTelemetry) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    // MAVLink battery_status packet
    mavlink_message_t msg;
    uint16_t voltages[10] = {12000, 0, 0, 0, 0, 0, 0, 0, 0, 0}; // 12V
    uint16_t voltages_ext[4] = {0, 0, 0, 0};
    mavlink_msg_battery_status_pack(1, 1, &msg, 0, MAV_BATTERY_FUNCTION_ALL, MAV_BATTERY_TYPE_LIPO, 25, voltages, -1, -1, -1, 85, 0, 0, voltages_ext, 0, 0);

    // Act
    vehicle.process_message(msg);

    // Assert
    EXPECT_EQ(vehicle.battery_remaining(), 85);
    EXPECT_FLOAT_EQ(vehicle.battery_voltage(), 12.0f); // 12000mV = 12.0V
}

// UT-VEH-008: State Verification - Liveness Check (Boot Grace vs Timeout)
TEST_F(VehicleTest, LivenessCheck_BootGrace_And_Timeout) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    auto created_at_ptr = get(VehicleCreatedAtTag{});
    auto last_hb_ptr = get(VehicleLastHeartbeatTag{});

    // Assert 1: Alive within first 15 seconds boot grace period, even if last heartbeat is ancient
    vehicle.*created_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(5);
    vehicle.*last_hb_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(100);
    EXPECT_TRUE(vehicle.is_alive());

    // Assert 2: Boot grace passed, last heartbeat is fresh (<10s) -> alive
    vehicle.*created_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(20);
    vehicle.*last_hb_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(5);
    EXPECT_TRUE(vehicle.is_alive());

    // Assert 3: Boot grace passed, last heartbeat is old (>10s) -> timed out/dead
    vehicle.*last_hb_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(11);
    EXPECT_FALSE(vehicle.is_alive());
}

// UT-VEH-009: State Verification - Reboot Detection
TEST_F(VehicleTest, RebootDetection_GapTriggeredOnce) {
    // Arrange
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    auto created_at_ptr = get(VehicleCreatedAtTag{});
    auto last_hb_ptr = get(VehicleLastHeartbeatTag{});

    // We need to be outside the 15-second grace window to test reboot detection
    vehicle.*created_at_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(20);
    vehicle.*last_hb_ptr = std::chrono::steady_clock::now() - std::chrono::seconds(10); // 10 seconds ago

    // Act 1: Send a new heartbeat (gap was 10s, which is > 5s)
    mavlink_message_t hb = make_heartbeat(1, 1);
    vehicle.process_message(hb);

    // Assert 1: reboot flag is set
    EXPECT_TRUE(vehicle.check_and_clear_reboot());
    
    // Assert 2: reading again returns false (cleared after reading)
    EXPECT_FALSE(vehicle.check_and_clear_reboot());
}

// UT-VEH-010: Construction with null LinkManager throws invalid_argument
TEST_F(VehicleTest, Construction_NullLinkManagerThrows) {
    EXPECT_THROW(Vehicle(1, 1, link_id_, nullptr, 1), std::invalid_argument);
}

// UT-VEH-011: Out-of-bounds custom mode name maps to UNKNOWN
TEST_F(VehicleTest, ProcessMessage_CopterModeNameOutOfBounds) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);
    
    // Custom mode 99 (out of bounds)
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 
                               MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 
                               99, 
                               MAV_STATE_ACTIVE);

    vehicle.process_message(msg);
    EXPECT_EQ(vehicle.flight_mode_string(), "UNKNOWN");
}

// UT-VEH-012: Ingest MAVLINK_MSG_ID_SYS_STATUS
TEST_F(VehicleTest, ProcessMessage_DecodesSysStatusTelemetry) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    mavlink_message_t msg;
    mavlink_msg_sys_status_pack(1, 1, &msg, 0, 0, 0, 500, 12600, -1, 75, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    vehicle.process_message(msg);

    EXPECT_FLOAT_EQ(vehicle.battery_voltage(), 12.6f); // 12600mV = 12.6V
    EXPECT_EQ(vehicle.battery_remaining(), 75);
}

// UT-VEH-013: Ingest MAVLINK_MSG_ID_ATTITUDE
TEST_F(VehicleTest, ProcessMessage_DecodesAttitudeTelemetry) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    mavlink_message_t msg;
    mavlink_msg_attitude_pack(1, 1, &msg, 0, 0.123f, -0.456f, 1.789f, 0, 0, 0);

    vehicle.process_message(msg);

    EXPECT_FLOAT_EQ(vehicle.roll(), 0.123f);
    EXPECT_FLOAT_EQ(vehicle.pitch(), -0.456f);
    EXPECT_FLOAT_EQ(vehicle.yaw(), 1.789f);
}

// UT-VEH-014: Ingest MAVLINK_MSG_ID_GLOBAL_POSITION_INT
TEST_F(VehicleTest, ProcessMessage_DecodesGlobalPositionTelemetry) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    mavlink_message_t msg;
    mavlink_msg_global_position_int_pack(1, 1, &msg, 0, 123456780, 876543210, 25000, 0, 0, 0, 0, 0);

    vehicle.process_message(msg);

    EXPECT_DOUBLE_EQ(vehicle.latitude(), 12.345678);
    EXPECT_DOUBLE_EQ(vehicle.longitude(), 87.654321);
    EXPECT_FLOAT_EQ(vehicle.altitude_msl(), 25.0f); // 25000mm = 25m
}

// UT-VEH-015: Ingest MAVLINK_MSG_ID_VFR_HUD
TEST_F(VehicleTest, ProcessMessage_DecodesVfrHudTelemetry) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    mavlink_message_t msg;
    mavlink_msg_vfr_hud_pack(1, 1, &msg, 0.0f, 15.5f, 180, 50, 32.5f, 0.0f);

    vehicle.process_message(msg);

    EXPECT_FLOAT_EQ(vehicle.altitude_msl(), 32.5f); // hud.alt
    EXPECT_FLOAT_EQ(vehicle.speed(), 15.5f); // hud.groundspeed
}

// UT-VEH-016: Get GPS fix type
TEST_F(VehicleTest, Getters_GpsFixType) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    mavlink_message_t msg;
    mavlink_msg_gps_raw_int_pack(1, 1, &msg, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    vehicle.process_message(msg);
    EXPECT_EQ(vehicle.gps_fix_type(), 3);
}

// UT-VEH-017: Getters for sub-calibration modules
TEST_F(VehicleTest, Getters_CalibrationModules) {
    Vehicle vehicle(1, 1, link_id_, &link_manager_, 1);

    // Call getters to ensure they return valid references
    EXPECT_NO_THROW({
        auto& accel = vehicle.accel_calib();
        auto& compass = vehicle.compass_calib();
        auto& esc = vehicle.esc_calib();
        auto& radio = vehicle.radio_calib();
        
        (void)accel;
        (void)compass;
        (void)esc;
        (void)radio;
    });
}

