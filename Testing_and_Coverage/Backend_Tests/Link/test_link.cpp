#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "Link/link.h"
#include "mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;

TEST(LinkTest, StartCallsTransportStart) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    
    EXPECT_CALL(*mock_transport, start()).Times(1);
    EXPECT_CALL(*mock_transport, set_receive_callback(_)).Times(1);
    
    Link link(1, mock_transport, io);
    link.start();
}

TEST(LinkTest, GetTransportReturnsCorrectTransport) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    Link link(1, mock_transport, io);
    EXPECT_EQ(link.get_transport(), mock_transport);
}

TEST(LinkTest, ReceiveCallbackParsesMavlinkAndTriggersCallback) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    
    Transport::ReceiveCallback captured_cb;
    EXPECT_CALL(*mock_transport, start()).Times(1);
    EXPECT_CALL(*mock_transport, set_receive_callback(_))
        .WillOnce(Invoke([&](Transport::ReceiveCallback cb) {
            captured_cb = cb;
        }));
    
    Link link(1, mock_transport, io);
    
    bool callback_called = false;
    link.set_callback([&](const mavlink_message_t& m, int link_id) {
        callback_called = true;
        EXPECT_EQ(m.msgid, MAVLINK_MSG_ID_HEARTBEAT);
        EXPECT_EQ(link_id, 1);
    });
    
    link.start();
    ASSERT_TRUE(captured_cb != nullptr);
    
    // Create a valid MAVLink heartbeat message
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 200, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    uint8_t buffer[MAVLINK_MAX_PACKET_LEN];
    uint16_t len = mavlink_msg_to_send_buffer(buffer, &msg);
    
    // Simulate receiving data
    captured_cb(buffer, len);
    
    EXPECT_TRUE(callback_called);
}
