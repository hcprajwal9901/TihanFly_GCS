#include <gtest/gtest.h>
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <vector>
#include "Transport/serial.h"

#ifndef _WIN32
#include <pty.h>
#include <unistd.h>

class SerialTransportTest : public ::testing::Test {
protected:
    int master_fd, slave_fd;
    char slave_name[100];
    asio::io_context io;
    std::shared_ptr<SerialTransport> serial;
    std::atomic<bool> received{false};
    std::vector<uint8_t> received_data;
    std::thread io_thread;

    void SetUp() override {
        ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);
        serial = std::make_shared<SerialTransport>(io, slave_name, 57600);
        serial->set_receive_callback(
            [&](const uint8_t* data, std::size_t length) {
                received = true;
                received_data.assign(data, data + length);
            });
        serial->start();
        io_thread = std::thread([&]() { io.run(); });
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    void TearDown() override {
        serial->stop();
        io.stop();
        if (io_thread.joinable()) {
            io_thread.join();
        }
        close(master_fd);
        close(slave_fd);
    }
    
    void SendPacketAndWait(const std::vector<uint8_t>& data) {
        write(master_fd, data.data(), data.size());
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
};

TEST_F(SerialTransportTest, DataIsReceived) {
    SendPacketAndWait({9, 8, 7});
    EXPECT_TRUE(received);
}

TEST_F(SerialTransportTest, ReceivedDataSizeIsCorrect) {
    SendPacketAndWait({9, 8, 7});
    EXPECT_EQ(received_data.size(), 3);
}

TEST_F(SerialTransportTest, ReceivedDataFirstByteMatches) {
    SendPacketAndWait({9, 8, 7});
    if(!received_data.empty()) {
        EXPECT_EQ(received_data[0], 9);
    }
}

TEST_F(SerialTransportTest, AsyncSendValidData) {
    std::vector<uint8_t> send_data = {10, 11, 12};
    serial->async_send(send_data.data(), send_data.size());
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    
    char buf[10];
    int n = read(master_fd, buf, sizeof(buf));
    EXPECT_EQ(n, 3);
    if(n == 3) {
        EXPECT_EQ(buf[0], 10);
        EXPECT_EQ(buf[1], 11);
        EXPECT_EQ(buf[2], 12);
    }
}
#endif

// This test runs on all platforms (including Windows)
// Split into multiple tests to adhere to Single-Assertion rule

TEST(SerialTransportInvalidPortTest, IsOpenIsFalse) {
    asio::io_context io;
    auto serial = std::make_shared<SerialTransport>(io, "INVALID_COM_PORT", 57600);
    EXPECT_FALSE(serial->is_open());
}

TEST(SerialTransportInvalidPortTest, IsActiveIsFalse) {
    asio::io_context io;
    auto serial = std::make_shared<SerialTransport>(io, "INVALID_COM_PORT", 57600);
    EXPECT_FALSE(serial->is_active());
}

TEST(SerialTransportInvalidPortTest, StartDoesNotCrash) {
    asio::io_context io;
    auto serial = std::make_shared<SerialTransport>(io, "INVALID_COM_PORT", 57600);
    EXPECT_NO_THROW({
        serial->start();
    });
}

TEST(SerialTransportInvalidPortTest, StopDoesNotCrash) {
    asio::io_context io;
    auto serial = std::make_shared<SerialTransport>(io, "INVALID_COM_PORT", 57600);
    EXPECT_NO_THROW({
        serial->stop();
    });
}

TEST(SerialTransportInvalidPortTest, AsyncSendDoesNotCrash) {
    asio::io_context io;
    auto serial = std::make_shared<SerialTransport>(io, "INVALID_COM_PORT", 57600);
    EXPECT_NO_THROW({
        std::vector<uint8_t> dummy = {1};
        serial->async_send(dummy.data(), dummy.size());
    });
}
