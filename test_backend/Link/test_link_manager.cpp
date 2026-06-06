#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <memory>
#include <atomic>

#include "Link/link_manager.h"
#include "mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;

class LinkManagerTest : public ::testing::Test {
protected:
    asio::io_context io_;
    LinkManager manager_;
};

// Helper to generate a valid MAVLink heartbeat packet
static std::vector<uint8_t> generate_heartbeat_packet() {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 200, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    std::vector<uint8_t> buffer(MAVLINK_MAX_PACKET_LEN);
    uint16_t len = mavlink_msg_to_send_buffer(buffer.data(), &msg);
    buffer.resize(len);
    return buffer;
}

// UT-LINKMGR-001: Happy Path - Add Link and Get Link
TEST_F(LinkManagerTest, AddLink_IncrementsIdAndStoresLink) {
    // Arrange
    auto transport1 = std::make_shared<MockTransport>();
    auto transport2 = std::make_shared<MockTransport>();

    // Act
    int id1 = manager_.add_link(transport1, io_);
    int id2 = manager_.add_link(transport2, io_);

    // Assert
    EXPECT_EQ(id1, 0);
    EXPECT_EQ(id2, 1);
    
    auto link1 = manager_.get_link(id1);
    auto link2 = manager_.get_link(id2);
    
    ASSERT_NE(link1, nullptr);
    ASSERT_NE(link2, nullptr);
    EXPECT_EQ(link1->get_transport(), transport1);
    EXPECT_EQ(link2->get_transport(), transport2);
}

// UT-LINKMGR-002: Happy Path - Retroactive callback attachment
TEST_F(LinkManagerTest, SetMessageCallback_AppliesToExistingAndNewLinks) {
    // Arrange
    auto transport1 = std::make_shared<MockTransport>();
    Transport::ReceiveCallback transport_cb1 = nullptr;
    EXPECT_CALL(*transport1, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb1 = cb;
        }));
    EXPECT_CALL(*transport1, start()).Times(1);

    int id1 = manager_.add_link(transport1, io_);
    manager_.start_link(id1);

    std::atomic<int> cb_trigger_count{0};
    auto callback = [&](const mavlink_message_t&, int link_id) {
        cb_trigger_count++;
    };

    // Act: Set callback AFTER adding link1
    manager_.set_message_callback(callback);

    // Assert: trigger link1 transport packet
    std::vector<uint8_t> pkt = generate_heartbeat_packet();
    ASSERT_NE(transport_cb1, nullptr);
    transport_cb1(pkt.data(), pkt.size());
    EXPECT_EQ(cb_trigger_count.load(), 1);

    // Arrange for new link
    auto transport2 = std::make_shared<MockTransport>();
    Transport::ReceiveCallback transport_cb2 = nullptr;
    EXPECT_CALL(*transport2, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            transport_cb2 = cb;
        }));
    EXPECT_CALL(*transport2, start()).Times(1);

    // Act: Add link2 AFTER setting callback
    int id2 = manager_.add_link(transport2, io_);
    manager_.start_link(id2);

    // Assert: trigger link2 transport packet
    ASSERT_NE(transport_cb2, nullptr);
    transport_cb2(pkt.data(), pkt.size());
    EXPECT_EQ(cb_trigger_count.load(), 2);
}

// UT-LINKMGR-003: Happy Path - Send data via Link ID
TEST_F(LinkManagerTest, Send_DelegatesToCorrectTransport) {
    // Arrange
    auto transport1 = std::make_shared<MockTransport>();
    auto transport2 = std::make_shared<MockTransport>();
    
    int id1 = manager_.add_link(transport1, io_);
    int id2 = manager_.add_link(transport2, io_);

    std::vector<uint8_t> payload = {0x01, 0x02, 0x03};

    // Expect send on link 2, but NOT link 1
    EXPECT_CALL(*transport1, async_send(_, _)).Times(0);
    EXPECT_CALL(*transport2, async_send(payload.data(), payload.size())).Times(1);

    // Act
    manager_.send(id2, payload.data(), payload.size());
}

// UT-LINKMGR-004: Happy Path - Broadcast data
TEST_F(LinkManagerTest, Broadcast_SendsToAllLinks) {
    // Arrange
    auto transport1 = std::make_shared<MockTransport>();
    auto transport2 = std::make_shared<MockTransport>();
    
    manager_.add_link(transport1, io_);
    manager_.add_link(transport2, io_);

    std::vector<uint8_t> payload = {0xAA, 0xBB};

    // Expect broadcast to send on both
    EXPECT_CALL(*transport1, async_send(payload.data(), payload.size())).Times(1);
    EXPECT_CALL(*transport2, async_send(payload.data(), payload.size())).Times(1);

    // Act
    manager_.broadcast(payload.data(), payload.size());
}

// UT-LINKMGR-005: Boundary - Invalid Link IDs
TEST_F(LinkManagerTest, InvalidLinkIds_SafelyIgnored) {
    // Arrange
    auto transport = std::make_shared<MockTransport>();
    manager_.add_link(transport, io_);

    // Act & Assert (Should not crash or call transport)
    EXPECT_CALL(*transport, start()).Times(0);
    EXPECT_CALL(*transport, async_send(_, _)).Times(0);

    manager_.start_link(-1);
    manager_.start_link(5);
    
    uint8_t data[] = {1, 2};
    manager_.send(-1, data, sizeof(data));
    manager_.send(5, data, sizeof(data));

    EXPECT_EQ(manager_.get_link(-1), nullptr);
    EXPECT_EQ(manager_.get_link(5), nullptr);
}
