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