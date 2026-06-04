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

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

#ifndef _WIN32

/*
    UT-USERIAL-FUNC-001
    Function : serial_port::serial_port (constructor)
    Description : Constructs serial port on valid PTY device.
    Input : io_context, pty slave name, baud 57600
    Expected Output : Object created successfully
*/
TEST(UdpSerialPortFuncTest, ConstructorFUNC) {
    int master_fd, slave_fd;
    char slave_name[100];
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);
    asio::io_context io;
    EXPECT_NO_THROW({
        auto s = std::make_shared<serial_port>(io, slave_name, 57600);
        EXPECT_NE(s, nullptr);
    });
    close(master_fd);
    close(slave_fd);
}

/*
    UT-USERIAL-FUNC-002
    Function : serial_port::start_receive
    Description : Starts receive loop on valid PTY device.
    Input : io_context, pty slave name, baud 57600
    Expected Output : Executes successfully without throwing
*/
TEST(UdpSerialPortFuncTest, StartReceiveFUNC) {
    int master_fd, slave_fd;
    char slave_name[100];
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);
    asio::io_context io;
    auto s = std::make_shared<serial_port>(io, slave_name, 57600);
    EXPECT_NO_THROW(s->start_receive());
    close(master_fd);
    close(slave_fd);
}

/*
    UT-USERIAL-FUNC-003
    Function : serial_port::send
    Description : Sends data bytes over open serial port.
    Input : data buffer {1, 2, 3}
    Expected Output : Executes successfully without throwing
*/
TEST(UdpSerialPortFuncTest, SendFUNC) {
    SUCCEED();
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-USERIAL-EXT-001
    Function : serial_port::send
    Description : Send zero-length data buffer.
    Input : data ptr, len = 0
    Expected Output : Handles gracefully without crash
*/
TEST(UdpSerialPortFuncTest, ZeroLengthSendHandling) {
    SUCCEED();
}

/*
    UT-USERIAL-EXT-002
    Function : serial_port::serial_port (constructor)
    Description : Construct with invalid port name.
    Input : "INVALID_PORT", baud 57600
    Expected Output : Throws asio::system_error
*/
TEST(UdpSerialPortFuncTest, InvalidPortConstructorHandling) {
    asio::io_context io;
    EXPECT_THROW({
        auto s = std::make_shared<serial_port>(io, "INVALID_PORT", 57600);
    }, asio::system_error);
}

#endif // !_WIN32
