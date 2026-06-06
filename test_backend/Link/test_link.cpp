#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <atomic>
#include <thread>
#include <future>

#include "Link/link.h"
#include "mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;

class LinkTest : public ::testing::Test {
protected:
    asio::io_context io_;
    std::shared_ptr<MockTransport> mock_transport_ = std::make_shared<MockTransport>();
};

// Helper to generate a valid MAVLink heartbeat packet
std::vector<uint8_t> generate_heartbeat() {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 200, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    std::vector<uint8_t> buffer(MAVLINK_MAX_PACKET_LEN);
    uint16_t len = mavlink_msg_to_send_buffer(buffer.data(), &msg);
    buffer.resize(len);
    return buffer;
}

// UT-LINK-001: Happy Path - Construction and Getters
TEST_F(LinkTest, Construction_GettersReturnExpectedValues) {
    // Arrange & Act
    Link link(42, mock_transport_, io_);

    // Assert
    EXPECT_EQ(link.get_transport(), mock_transport_);
    EXPECT_EQ(link.get_valid_msg_count(), 0);
}

// UT-LINK-002: Happy Path - Start listens on transport
TEST_F(LinkTest, Start_CallsTransportStartAndSetCallback) {
    // Arrange
    Link link(1, mock_transport_, io_);

    // Expect
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_)).Times(1);

    // Act
    link.start();
}

// UT-LINK-003: Happy Path - MAVLink Parsing and Callback Trigger
TEST_F(LinkTest, StartReceive_ParsesMavlinkAndTriggersCallback) {
    // Arrange
    Transport::ReceiveCallback transport_cb = nullptr;
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb = cb;
        }));

    Link link(7, mock_transport_, io_);
    
    std::promise<mavlink_message_t> rx_promise;
    auto rx_future = rx_promise.get_future();
    std::atomic<int> callback_link_id{0};

    link.set_callback([&](const mavlink_message_t& m, int link_id) {
        callback_link_id = link_id;
        rx_promise.set_value(m);
    });

    link.start();
    ASSERT_NE(transport_cb, nullptr);

    std::vector<uint8_t> buffer = generate_heartbeat();

    // Act
    transport_cb(buffer.data(), buffer.size());

    // Assert
    ASSERT_TRUE(rx_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t parsed_msg = rx_future.get();
    EXPECT_EQ(parsed_msg.msgid, MAVLINK_MSG_ID_HEARTBEAT);
    EXPECT_EQ(callback_link_id.load(), 7);
    EXPECT_EQ(link.get_valid_msg_count(), 1);
}

// UT-LINK-004: Boundary - Zero-Length Data
TEST_F(LinkTest, Boundary_ZeroLengthDataIgnored) {
    // Arrange
    Transport::ReceiveCallback transport_cb = nullptr;
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb = cb;
        }));

    Link link(1, mock_transport_, io_);
    
    std::atomic<int> cb_count{0};
    link.set_callback([&](const mavlink_message_t&, int) {
        cb_count++;
    });

    link.start();

    // Act
    transport_cb(nullptr, 0);

    // Assert
    EXPECT_EQ(cb_count.load(), 0);
    EXPECT_EQ(link.get_valid_msg_count(), 0);
}

// UT-LINK-005: Error - Corrupted MAVLink Packets
TEST_F(LinkTest, Error_CorruptedPacketsIgnored) {
    // Arrange
    Transport::ReceiveCallback transport_cb = nullptr;
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb = cb;
        }));

    Link link(1, mock_transport_, io_);
    
    std::atomic<int> cb_count{0};
    link.set_callback([&](const mavlink_message_t&, int) {
        cb_count++;
    });

    link.start();

    // Act: Send random garbage bytes
    std::vector<uint8_t> garbage = { 0xFF, 0x00, 0xEE, 0xDD, 0xCC, 0xBB, 0xAA, 0x11, 0x22 };
    transport_cb(garbage.data(), garbage.size());

    // Assert
    EXPECT_EQ(cb_count.load(), 0);
    EXPECT_EQ(link.get_valid_msg_count(), 0);
}

// UT-LINK-006: Boundary - Partial Packet Streaming
TEST_F(LinkTest, Boundary_PartialPacketsAssembled) {
    // Arrange
    Transport::ReceiveCallback transport_cb = nullptr;
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb = cb;
        }));

    Link link(1, mock_transport_, io_);
    
    std::promise<bool> rx_promise;
    auto rx_future = rx_promise.get_future();
    link.set_callback([&](const mavlink_message_t& m, int) {
        rx_promise.set_value(true);
    });

    link.start();

    std::vector<uint8_t> buffer = generate_heartbeat();
    
    // Act: Stream the message in two parts
    transport_cb(buffer.data(), 5); // first 5 bytes
    
    // Assert: Not complete yet, callback should not fire
    EXPECT_FALSE(rx_future.wait_for(std::chrono::milliseconds(10)) == std::future_status::ready);

    // Send the remaining part
    transport_cb(buffer.data() + 5, buffer.size() - 5);

    // Assert: Complete, callback should be fired
    ASSERT_TRUE(rx_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    EXPECT_TRUE(rx_future.get());
    EXPECT_EQ(link.get_valid_msg_count(), 1);
}

// UT-LINK-007: State Verification - Multiple Packet Processing
TEST_F(LinkTest, StateVerification_MultiplePacketsInStream) {
    // Arrange
    Transport::ReceiveCallback transport_cb = nullptr;
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb = cb;
        }));

    Link link(1, mock_transport_, io_);
    
    std::atomic<int> cb_count{0};
    link.set_callback([&](const mavlink_message_t& m, int) {
        cb_count++;
    });

    link.start();

    // Act: Send 3 heartbeats back-to-back in a single buffer
    std::vector<uint8_t> packet = generate_heartbeat();
    std::vector<uint8_t> multi_packet;
    for (int i = 0; i < 3; ++i) {
        multi_packet.insert(multi_packet.end(), packet.begin(), packet.end());
    }

    transport_cb(multi_packet.data(), multi_packet.size());

    // Assert: 3 callbacks, valid message count is 3
    EXPECT_EQ(cb_count.load(), 3);
    EXPECT_EQ(link.get_valid_msg_count(), 3);
}

// UT-LINK-008: Concurrency - Thread Safety on Receipt
TEST_F(LinkTest, Concurrency_SafeConcurrentInbound) {
    // Arrange
    Transport::ReceiveCallback transport_cb = nullptr;
    EXPECT_CALL(*mock_transport_, start()).Times(1);
    EXPECT_CALL(*mock_transport_, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb = cb;
        }));

    Link link(1, mock_transport_, io_);
    
    std::atomic<int> cb_count{0};
    link.set_callback([&](const mavlink_message_t& m, int) {
        cb_count++;
    });

    link.start();

    std::vector<uint8_t> buffer = generate_heartbeat();

    // Act: concurrently trigger callbacks
    std::vector<std::thread> threads;
    for (int i = 0; i < 10; ++i) {
        threads.emplace_back([&]() {
            transport_cb(buffer.data(), buffer.size());
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    // Assert: 10 callbacks processed, count is 10
    EXPECT_EQ(cb_count.load(), 10);
    EXPECT_EQ(link.get_valid_msg_count(), 10);
}
