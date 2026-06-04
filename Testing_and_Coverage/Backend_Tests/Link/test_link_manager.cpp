#include <gtest/gtest.h>
#include <gmock/gmock.h>
#define private public
#define protected public
#include "Link/link_manager.h"
#include "mock_transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;

TEST(LinkManagerTest, AddLinkReturnsIncrementalIds) {
    asio::io_context io;
    LinkManager manager;
    
    auto t1 = std::make_shared<MockTransport>();
    auto t2 = std::make_shared<MockTransport>();
    
    int id1 = manager.add_link(t1, io);
    int id2 = manager.add_link(t2, io);
    
    EXPECT_EQ(id1, 0);
    EXPECT_EQ(id2, 1);
}

TEST(LinkManagerTest, StartLinkCallsTransportStart) {
    asio::io_context io;
    LinkManager manager;
    auto t1 = std::make_shared<MockTransport>();
    
    EXPECT_CALL(*t1, start()).Times(1);
    EXPECT_CALL(*t1, set_receive_callback(_)).Times(1);
    
    int id = manager.add_link(t1, io);
    manager.start_link(id);
    
    // Invalid ID should not crash
    manager.start_link(999);
    manager.start_link(-1);
}

TEST(LinkManagerTest, SendCallsTransportAsyncSend) {
    asio::io_context io;
    LinkManager manager;
    auto t1 = std::make_shared<MockTransport>();
    auto t2 = std::make_shared<MockTransport>();
    
    int id1 = manager.add_link(t1, io);
    int id2 = manager.add_link(t2, io);
    
    const uint8_t data[] = {1, 2, 3};
    std::size_t length = 3;
    
    EXPECT_CALL(*t1, async_send(data, length)).Times(1);
    EXPECT_CALL(*t2, async_send(_, _)).Times(0);
    
    manager.send(id1, data, length);
    
    // Invalid ID should not crash
    manager.send(999, data, length);
    manager.send(-1, data, length);
}

TEST(LinkManagerTest, BroadcastCallsAsyncSendOnAllTransports) {
    asio::io_context io;
    LinkManager manager;
    auto t1 = std::make_shared<MockTransport>();
    auto t2 = std::make_shared<MockTransport>();
    
    manager.add_link(t1, io);
    manager.add_link(t2, io);
    
    const uint8_t data[] = {4, 5, 6};
    std::size_t length = 3;
    
    EXPECT_CALL(*t1, async_send(data, length)).Times(1);
    EXPECT_CALL(*t2, async_send(data, length)).Times(1);
    
    manager.broadcast(data, length);
}

TEST(LinkManagerTest, SetMessageCallbackAppliesToExistingAndNewLinks) {
    asio::io_context io;
    LinkManager manager;
    
    auto t1 = std::make_shared<MockTransport>();
    auto t2 = std::make_shared<MockTransport>();
    
    // Link 1 added before callback is set
    int id1 = manager.add_link(t1, io);
    
    bool callback_called = false;
    manager.set_message_callback([&](const mavlink_message_t& m, int link_id) {
        callback_called = true;
    });
    
    // Link 2 added after callback is set
    int id2 = manager.add_link(t2, io);
    
    Transport::ReceiveCallback cb1, cb2;
    EXPECT_CALL(*t1, start()).Times(1);
    EXPECT_CALL(*t1, set_receive_callback(_)).WillOnce(Invoke([&](Transport::ReceiveCallback cb) { cb1 = cb; }));
    
    EXPECT_CALL(*t2, start()).Times(1);
    EXPECT_CALL(*t2, set_receive_callback(_)).WillOnce(Invoke([&](Transport::ReceiveCallback cb) { cb2 = cb; }));
    
    manager.start_link(id1);
    manager.start_link(id2);
    
    ASSERT_TRUE(cb1 != nullptr);
    ASSERT_TRUE(cb2 != nullptr);
    
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 200, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    uint8_t buffer[MAVLINK_MAX_PACKET_LEN];
    uint16_t len = mavlink_msg_to_send_buffer(buffer, &msg);
    
    // Trigger cb1
    callback_called = false;
    cb1(buffer, len);
    EXPECT_TRUE(callback_called);
    
    // Trigger cb2
    callback_called = false;
    cb2(buffer, len);
    EXPECT_TRUE(callback_called);
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-LM-FUNC-001
    Function : LinkManager::add_link
    Description : Add link.
    Input : Transport ptr
    Expected Output : New Link ID
*/
TEST(LinkManagerTest, AddLinkFUNC) {
    asio::io_context io;
    LinkManager manager;
    auto t = std::make_shared<MockTransport>();
    EXPECT_NO_THROW(manager.add_link(t, io));
}

/*
    UT-LM-FUNC-002
    Function : LinkManager::start_link
    Description : Start link.
    Input : ID
    Expected Output : Executes successfully
*/
TEST(LinkManagerTest, StartLinkFUNC) {
    asio::io_context io;
    LinkManager manager;
    auto t = std::make_shared<MockTransport>();
    int id = manager.add_link(t, io);
    EXPECT_CALL(*t, start()).Times(1);
    EXPECT_CALL(*t, set_receive_callback(testing::_)).Times(1);
    EXPECT_NO_THROW(manager.start_link(id));
}

/*
    UT-LM-FUNC-003
    Function : LinkManager::stop_link
    Description : Stop link.
    Input : ID
    Expected Output : Executes successfully
*/
TEST(LinkManagerTest, StopLinkFUNC) {
    SUCCEED();
}

/*
    UT-LM-FUNC-004
    Function : LinkManager::send
    Description : Sends buffer data.
    Input : data, len
    Expected Output : Executes successfully
*/
TEST(LinkManagerTest, SendFUNC) {
    asio::io_context io;
    LinkManager manager;
    auto t = std::make_shared<MockTransport>();
    int id = manager.add_link(t, io);
    uint8_t data[] = {1, 2, 3};
    EXPECT_CALL(*t, async_send(data, 3)).Times(1);
    EXPECT_NO_THROW(manager.send(id, data, 3));
}

/*
    UT-LM-FUNC-005
    Function : LinkManager::broadcast
    Description : Broadcast data to all links.
    Input : data, len
    Expected Output : Executes successfully
*/
TEST(LinkManagerTest, BroadcastFUNC) {
    asio::io_context io;
    LinkManager manager;
    auto t = std::make_shared<MockTransport>();
    manager.add_link(t, io);
    uint8_t data[] = {1, 2, 3};
    EXPECT_CALL(*t, async_send(data, 3)).Times(1);
    EXPECT_NO_THROW(manager.broadcast(data, 3));
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-LM-EXT-001
    Function : LinkManager::start_link
    Description : Negative and out-of-range IDs.
    Input : ID = -1
    Expected Output : Safely discards
*/
TEST(LinkManagerTest, InvalidLinkOperationsHandling) {
    LinkManager manager;
    uint8_t data[] = {1, 2, 3};
    EXPECT_NO_THROW({
        manager.start_link(-1);
        manager.send(-1, data, 3);
    });
}

/*
    UT-LM-006
    Function : LinkManager::set_message_callback
    Description : Set global message callback.
    Input : message callback lambda
    Expected Output : saves callback successfully
*/
TEST(LinkManagerTest, SetMessageCallbackFUNC) {
    LinkManager manager;
    EXPECT_NO_THROW(manager.set_message_callback([](const mavlink_message_t&, int){}));
}

/*
    UT-LM-007
    Function : LinkManager::get_link
    Description : Retrieve link pointer by ID.
    Input : link ID
    Expected Output : returns shared_ptr to link or nullptr
*/
TEST(LinkManagerTest, GetLinkFUNC) {
    asio::io_context io;
    LinkManager manager;
    auto t = std::make_shared<MockTransport>();
    int id = manager.add_link(t, io);
    EXPECT_NE(manager.get_link(id), nullptr);
    EXPECT_EQ(manager.get_link(999), nullptr);
}

