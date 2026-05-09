#include <gtest/gtest.h>
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <vector>
#include "udp.h"

TEST(UdpTransportTest, SendReceiveLoopback)
{
    asio::io_context io;

    std::atomic<bool> received{false};
    std::vector<uint8_t> received_data;

    
    auto udp = std::make_shared<UdpTransport>(io,
                     "127.0.0.1", 16000,
                     "127.0.0.1", 16000);

    udp->set_receive_callback(
        [&](const uint8_t* data, std::size_t length)
        {
            received = true;
            received_data.assign(data, data + length);
        });

    udp->start();

    std::thread io_thread([&]() {
        io.run();
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    uint8_t test_data[] = {1, 2, 3, 4};
    udp->async_send(test_data, sizeof(test_data));

    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    udp->stop();
    io.stop();
    io_thread.join();

    ASSERT_TRUE(received);
    ASSERT_EQ(received_data.size(), 4);
    EXPECT_EQ(received_data[0], 1);
    EXPECT_EQ(received_data[3], 4);
}
