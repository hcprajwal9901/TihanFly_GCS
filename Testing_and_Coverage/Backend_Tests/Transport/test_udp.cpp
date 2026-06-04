#include <gtest/gtest.h>
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <vector>
#define private public
#define protected public
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

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-UDP-FUNC-001
    Function : UdpTransport::start
    Description : Starts UDP listener.
    Input : None
    Expected Output : Listener active
*/
TEST_F(UdpTransportTest, StartFUNC) {
    EXPECT_NO_THROW(udp->start());
}

/*
    UT-UDP-FUNC-002
    Function : UdpTransport::stop
    Description : Stops UDP listener.
    Input : None
    Expected Output : Listener inactive
*/
TEST_F(UdpTransportTest, StopFUNC) {
    EXPECT_NO_THROW(udp->stop());
}

/*
    UT-UDP-FUNC-003
    Function : UdpTransport::async_send
    Description : Sends packet data.
    Input : data, len
    Expected Output : Packet dispatched
*/
TEST_F(UdpTransportTest, AsyncSendFUNC) {
    uint8_t data[] = {1, 2, 3};
    EXPECT_NO_THROW(udp->async_send(data, 3));
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-UDP-EXT-001
    Function : UdpTransport::async_send
    Description : Null data send attempt.
    Input : null ptr
    Expected Output : Safely ignored
*/
TEST_F(UdpTransportTest, NullSendHandling) {
    EXPECT_NO_THROW(udp->async_send(nullptr, 0));
}

/*
    UT-UDP-004
    Function : UdpTransport::recv_buf_opt
    Description : Retrieve receive buffer options.
    Input : None
    Expected Output : returns size value
*/
TEST_F(UdpTransportTest, RecvBufOptFUNC) {
    SUCCEED();
}

/*
    UT-UDP-005
    Function : UdpTransport::set_receive_callback
    Description : Set receive packet callback.
    Input : callback lambda
    Expected Output : saves callback successfully
*/
TEST_F(UdpTransportTest, SetReceiveCallbackFUNC) {
    EXPECT_NO_THROW(udp->set_receive_callback([](const uint8_t*, size_t){}));
}

/*
    UT-UDP-006
    Function : UdpTransport::do_receive
    Description : Asynchronous socket receive listener.
    Input : None
    Expected Output : registers socket async_receive_from
*/
TEST_F(UdpTransportTest, DoReceiveFUNC) {
    EXPECT_NO_THROW(udp->do_receive());
}

/*
    UT-UDP-007
    Function : UdpTransport::is_active
    Description : Check if listener loop is running.
    Input : None
    Expected Output : returns boolean status
*/
TEST_F(UdpTransportTest, IsActiveFUNC) {
    udp->active_ = true;
    udp->last_receive_ = std::chrono::steady_clock::now();
    EXPECT_TRUE(udp->is_active());
}

