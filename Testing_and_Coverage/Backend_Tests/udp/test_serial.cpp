#include <gtest/gtest.h>
#include <asio.hpp>
#include <memory>
#include "../../TihanFlyCC-main/udp/serial/serial.h"

#ifndef _WIN32
#include <pty.h>
#include <unistd.h>

class UdpSerialPortTest : public ::testing::Test {
protected:
    int master_fd, slave_fd;
    char slave_name[100];
    asio::io_context io;
    std::shared_ptr<serial_port> serial;

    void SetUp() override {
        ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);
    }

    void TearDown() override {
        if (serial) {
            serial.reset();
        }
        close(master_fd);
        close(slave_fd);
    }
};

TEST_F(UdpSerialPortTest, InitializationSuccess) {
    EXPECT_NO_THROW({
        serial = std::make_shared<serial_port>(io, slave_name, 57600);
    });
    EXPECT_NE(serial, nullptr);
}

TEST_F(UdpSerialPortTest, StartReceive) {
    serial = std::make_shared<serial_port>(io, slave_name, 57600);
    EXPECT_NO_THROW({
        serial->start_receive();
    });
}
#endif

TEST(UdpSerialPortTest_Invalid, ThrowsOnInvalidPort) {
    asio::io_context io;
    EXPECT_THROW({
        auto serial = std::make_shared<serial_port>(io, "INVALID_COM_PORT", 57600);
    }, asio::system_error);
}
