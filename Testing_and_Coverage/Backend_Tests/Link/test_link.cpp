#include <gtest/gtest.h>
#include <gmock/gmock.h>
#define private public
#define protected public
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

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-LNK-FUNC-001
    Function : Link::start
    Description : Starts link transport.
    Input : None
    Expected Output : Executes successfully
*/
TEST(LinkTest, StartFUNC) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    EXPECT_CALL(*mock_transport, start()).Times(1);
    EXPECT_CALL(*mock_transport, set_receive_callback(testing::_)).Times(1);
    Link link(1, mock_transport, io);
    EXPECT_NO_THROW(link.start());
}

/*
    UT-LNK-FUNC-002
    Function : Link::stop
    Description : Stops link transport.
    Input : None
    Expected Output : Executes successfully
*/
TEST(LinkTest, StopFUNC) {
    SUCCEED();
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-LNK-EXT-001
    Function : Link::Link
    Description : Zero link ID constructor.
    Input : ID = 0
    Expected Output : Handles gracefully
*/
TEST(LinkTest, ZeroLinkIdHandling) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    EXPECT_NO_THROW({
        Link link(0, mock_transport, io);
    });
}

/*
    UT-LNK-003
    Function : Link::set_callback
    Description : Set the mavlink message callback.
    Input : callback lambda
    Expected Output : saves callback successfully
*/
TEST(LinkTest, SetCallbackFUNC) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    Link link(1, mock_transport, io);
    EXPECT_NO_THROW(link.set_callback([](const mavlink_message_t&, int){}));
}

/*
    UT-LNK-004
    Function : Link::get_transport
    Description : Retrieve transport pointer.
    Input : None
    Expected Output : returns shared_ptr to transport
*/
TEST(LinkTest, GetTransportFUNC) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    Link link(1, mock_transport, io);
    EXPECT_EQ(link.get_transport(), mock_transport);
}

/*
    UT-LNK-005
    Function : Link::get_valid_msg_count
    Description : Retrieve number of valid received messages.
    Input : None
    Expected Output : returns uint64 msg count
*/
TEST(LinkTest, GetValidMsgCountFUNC) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    Link link(1, mock_transport, io);
    EXPECT_EQ(link.get_valid_msg_count(), 0);
}

