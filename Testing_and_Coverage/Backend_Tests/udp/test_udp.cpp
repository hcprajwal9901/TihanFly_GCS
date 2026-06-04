#include <gtest/gtest.h>
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <vector>
#include <memory>
#include "../../TihanFlyCC-main/udp/udp/udp.h"

class UdpSocketTest : public ::testing::Test {
protected:
    asio::io_context io;
    std::shared_ptr<udp_socket> target;
    std::thread io_thread;
    std::unique_ptr<asio::executor_work_guard<asio::io_context::executor_type>> work_guard;

    void SetUp() override {
        target = std::make_shared<udp_socket>(io, 17005);
        work_guard = std::make_unique<asio::executor_work_guard<asio::io_context::executor_type>>(asio::make_work_guard(io));
        io_thread = std::thread([this]() { io.run(); });
    }

    void TearDown() override {
        target.reset();
        if (work_guard) {
            work_guard->reset();
        }
        io.stop();
        if (io_thread.joinable()) {
            io_thread.join();
        }
    }
};

TEST_F(UdpSocketTest, Initialization) {
    EXPECT_NE(target, nullptr);
}

TEST_F(UdpSocketTest, ReceiveAndSendEcho) {
    std::atomic<bool> received{false};
    std::atomic<size_t> received_bytes{0};
    std::atomic<bool> sent{false};

    target->on_data_recived_ = [&](const std::error_code& ec, size_t len, const uint8_t* data) {
        if (!ec) {
            received = true;
            received_bytes = len;
            // Echo back what was received
            target->send(data, len);
        }
    };

    target->on_data_sent_ = [&](const std::error_code& ec, size_t bytes_sent) {
        if (!ec) sent = true;
    };

    target->start_receive();

    // Send a packet to target using a raw asio socket
    asio::ip::udp::socket sender(io, asio::ip::udp::v4());
    asio::ip::udp::endpoint target_ep(asio::ip::make_address("127.0.0.1"), 17005);
    std::vector<uint8_t> send_data = {0xDE, 0xAD, 0xBE, 0xEF};
    sender.send_to(asio::buffer(send_data), target_ep);

    // Wait for receive and send callbacks
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    EXPECT_TRUE(received);
    EXPECT_EQ(received_bytes, 4);
    EXPECT_TRUE(sent);

    // Verify echo
    std::vector<uint8_t> recv_data(1024);
    asio::ip::udp::endpoint sender_remote;
    sender.non_blocking(true);
    std::error_code ec;
    size_t len = sender.receive_from(asio::buffer(recv_data), sender_remote, 0, ec);
    
    EXPECT_FALSE(ec);
    EXPECT_EQ(len, 4);
    if (len >= 4) {
        EXPECT_EQ(recv_data[0], 0xDE);
    }
    
    sender.close();
}

TEST_F(UdpSocketTest, SendWithoutReceive) {
    std::atomic<bool> sent{false};

    target->on_data_sent_ = [&](const std::error_code& ec, size_t bytes_sent) {
        sent = true;
    };

    std::vector<uint8_t> send_data = {1, 2, 3};
    // Send should trigger callback, though it goes to 0.0.0.0:0
    target->send(send_data.data(), send_data.size());

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    EXPECT_TRUE(sent);
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-UDP-FUNC-001
    Function : udp_socket::udp_socket (constructor)
    Description : Constructs a UDP socket bound to the given port.
    Input : io_context, port 17010
    Expected Output : Object created successfully
*/
TEST(UdpSocketFuncTest, ConstructorFUNC) {
    asio::io_context io;
    EXPECT_NO_THROW({
        auto sock = std::make_shared<udp_socket>(io, 17010);
        EXPECT_NE(sock, nullptr);
    });
}

/*
    UT-UDP-FUNC-002
    Function : udp_socket::start_receive
    Description : Starts UDP receive loop.
    Input : None
    Expected Output : Executes successfully without throwing
*/
TEST(UdpSocketFuncTest, StartReceiveFUNC) {
    asio::io_context io;
    auto sock = std::make_shared<udp_socket>(io, 17011);
    EXPECT_NO_THROW(sock->start_receive());
}

/*
    UT-UDP-FUNC-003
    Function : udp_socket::send
    Description : Sends data bytes over UDP socket.
    Input : data buffer {0xAB, 0xCD}
    Expected Output : on_data_sent_ callback fires
*/
TEST(UdpSocketFuncTest, SendFUNC) {
    asio::io_context io;
    auto sock = std::make_shared<udp_socket>(io, 17012);
    bool sent = false;
    sock->on_data_sent_ = [&](const std::error_code& ec, std::size_t) {
        sent = true;
    };
    uint8_t data[] = {0xAB, 0xCD};
    EXPECT_NO_THROW(sock->send(data, sizeof(data)));
    auto work = asio::make_work_guard(io);
    std::thread t([&]() { io.run(); });
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    work.reset();
    io.stop();
    if (t.joinable()) t.join();
    EXPECT_TRUE(sent);
}

/*
    UT-UDP-FUNC-004
    Function : udp_socket::on_data_recived_ (callback)
    Description : Receive callback fires when data arrives on socket.
    Input : UDP packet sent to bound port
    Expected Output : on_data_recived_ fires with correct byte count
*/
TEST(UdpSocketFuncTest, OnDataReceivedCallbackFUNC) {
    asio::io_context io;
    auto sock = std::make_shared<udp_socket>(io, 17013);
    std::atomic<bool> received{false};
    std::atomic<size_t> received_len{0};
    sock->on_data_recived_ = [&](const std::error_code& ec, size_t len, const uint8_t*) {
        if (!ec) { received = true; received_len = len; }
    };
    sock->start_receive();

    auto work = asio::make_work_guard(io);
    std::thread t([&]() { io.run(); });

    asio::ip::udp::socket sender(io, asio::ip::udp::v4());
    asio::ip::udp::endpoint ep(asio::ip::make_address("127.0.0.1"), 17013);
    std::vector<uint8_t> pkt = {1, 2, 3, 4};
    sender.send_to(asio::buffer(pkt), ep);

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    sender.close();
    work.reset();
    io.stop();
    if (t.joinable()) t.join();

    EXPECT_TRUE(received);
    EXPECT_EQ(received_len, 4u);
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-UDP-EXT-001
    Function : udp_socket::send
    Description : Send zero-length data buffer.
    Input : data ptr, len = 0
    Expected Output : Handles gracefully (callback fires or no crash)
*/
TEST(UdpSocketFuncTest, ZeroLengthSendHandling) {
    asio::io_context io;
    auto sock = std::make_shared<udp_socket>(io, 17014);
    uint8_t data[] = {0};
    EXPECT_NO_THROW(sock->send(data, 0));
}

/*
    UT-UDP-EXT-002
    Function : udp_socket::start_receive
    Description : Call start_receive twice on same socket.
    Input : None
    Expected Output : Handles gracefully without crash
*/
TEST(UdpSocketFuncTest, DoubleStartReceiveHandling) {
    asio::io_context io;
    auto sock = std::make_shared<udp_socket>(io, 17015);
    EXPECT_NO_THROW({
        sock->start_receive();
        sock->start_receive();
    });
}