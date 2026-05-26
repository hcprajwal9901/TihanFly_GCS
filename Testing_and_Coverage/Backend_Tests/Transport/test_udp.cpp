#include <gtest/gtest.h>
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <vector>
#include "Transport/udp.h"

// Test Fixture to avoid code duplication
class UdpTransportTest : public ::testing::Test {
protected:
    asio::io_context io;
    std::shared_ptr<UdpTransport> udp;
    std::atomic<bool> received{false};
    std::atomic<int> receive_count{0};
    std::vector<uint8_t> received_data;
    std::thread io_thread;

    void SetUp() override {
        udp = std::make_shared<UdpTransport>(io, "127.0.0.1", 16001, "127.0.0.1", 16001);
        udp->set_receive_callback(
            [&](const uint8_t* data, std::size_t length) {
                received = true;
                receive_count++;
                received_data.assign(data, data + length);
            });
        udp->start();
        io_thread = std::thread([&]() { io.run(); });
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    void TearDown() override {
        udp->stop();
        io.stop();
        if (io_thread.joinable()) {
            io_thread.join();
        }
    }
    std::vector<uint8_t> send_buf;

    void SendPacketAndWait(const std::vector<uint8_t>& data) {
        send_buf = data;
        udp->async_send(send_buf.data(), send_buf.size());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
};

// 1 Assertion per test: Checks if data was physically received
TEST_F(UdpTransportTest, DataIsReceived) {
    SendPacketAndWait({1, 2, 3, 4});
    EXPECT_TRUE(received);
}

// 1 Assertion per test: Checks if the size matches
TEST_F(UdpTransportTest, ReceivedDataSizeIsCorrect) {
    SendPacketAndWait({1, 2, 3, 4});
    EXPECT_EQ(received_data.size(), 4);
}

// 1 Assertion per test: Checks if the first byte matches
TEST_F(UdpTransportTest, ReceivedDataFirstByteMatches) {
    SendPacketAndWait({1, 2, 3, 4});
    if(!received_data.empty()) {
        EXPECT_EQ(received_data[0], 1);
    }
}

// 1 Assertion per test: Checks if stop halts future receptions
TEST_F(UdpTransportTest, StopHaltsReceive) {
    SendPacketAndWait({1});
    udp->stop();
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    SendPacketAndWait({2});
    EXPECT_EQ(receive_count, 1);
}

// 1 Assertion per test: Checks for safe handling of invalid endpoints
TEST(UdpTransportTest_InvalidEndpoint, DoesNotCrash) {
    asio::io_context io;
    EXPECT_NO_THROW({
        auto udp = std::make_shared<UdpTransport>(io, "invalid_ip", 16002, "127.0.0.1", 16002);
        udp->start();
        udp->stop();
    });
}
