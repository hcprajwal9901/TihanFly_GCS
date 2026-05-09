#include <gtest/gtest.h>
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <vector>
#include <pty.h>
#include <unistd.h>
#include "serial.h"

TEST(SerialTransportTest, PseudoTerminalTest)
{
    int master_fd, slave_fd;
    char slave_name[100];

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    asio::io_context io;

    std::atomic<bool> received{false};
    std::vector<uint8_t> received_data;

    auto serial = std::make_shared<SerialTransport>(io, slave_name, 57600);
    

    serial->set_receive_callback(
        [&](const uint8_t* data, std::size_t length)
        {
            received = true;
            received_data.assign(data, data + length);
        });

    serial->start();

    std::thread io_thread([&]() {
        io.run();
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    uint8_t test_data[] = {9, 8, 7};
    write(master_fd, test_data, sizeof(test_data));

    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    serial->stop();
    io.stop();
    io_thread.join();

    close(master_fd);
    close(slave_fd);

    ASSERT_TRUE(received);
    ASSERT_EQ(received_data.size(), 3);
    EXPECT_EQ(received_data[0], 9);
    EXPECT_EQ(received_data[2], 7);
}
