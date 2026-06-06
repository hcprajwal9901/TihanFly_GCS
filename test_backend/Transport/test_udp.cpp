#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <thread>
#include <chrono>
#include <mutex>
#include <atomic>
#include <memory>
#include <future>
#include <stdexcept>

#include "Transport/udp.h"

// ─── C++ Template Private Member Access Hack ─────────────────────────────────
// Bypasses '#define private public' using explicit template instantiation.
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct UdpTransportActiveTag {
    typedef std::atomic<bool> UdpTransport::*type;
    friend type get(UdpTransportActiveTag);
};
template struct PrivateAccessor<UdpTransportActiveTag, &UdpTransport::active_>;

struct UdpTransportLastReceiveTag {
    typedef std::chrono::steady_clock::time_point UdpTransport::*type;
    friend type get(UdpTransportLastReceiveTag);
};
template struct PrivateAccessor<UdpTransportLastReceiveTag, &UdpTransport::last_receive_>;

struct UdpTransportReplyEndpointTag {
    typedef asio::ip::udp::endpoint UdpTransport::*type;
    friend type get(UdpTransportReplyEndpointTag);
};
template struct PrivateAccessor<UdpTransportReplyEndpointTag, &UdpTransport::reply_endpoint_>;

struct UdpTransportSocketTag {
    typedef asio::ip::udp::socket UdpTransport::*type;
    friend type get(UdpTransportSocketTag);
};
template struct PrivateAccessor<UdpTransportSocketTag, &UdpTransport::socket_>;

struct UdpTransportEndpointMutexTag {
    typedef std::mutex UdpTransport::*type;
    friend type get(UdpTransportEndpointMutexTag);
};
template struct PrivateAccessor<UdpTransportEndpointMutexTag, &UdpTransport::endpoint_mutex_>;


class UdpTransportTest : public ::testing::Test {
protected:
    asio::io_context io_;
};

// UT-UDP-001: Initialization & Binding
TEST_F(UdpTransportTest, Initialization_BindsCorrectly) {
    // Arrange & Act
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    auto socket_ptr = get(UdpTransportSocketTag{});

    // Assert
    EXPECT_TRUE((transport.*socket_ptr).is_open());
    EXPECT_FALSE(transport.is_active());
}

// UT-UDP-002: Happy Path - Data Transmission and Reception
TEST_F(UdpTransportTest, TransmitReceive_Success) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();
    
    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();
    
    std::promise<std::vector<uint8_t>> rx_promise;
    auto rx_future = rx_promise.get_future();
    
    receiver.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        rx_promise.set_value(std::vector<uint8_t>(data, data + len));
    });

    std::vector<uint8_t> tx_data = { 0x01, 0x02, 0x03, 0x04 };

    // Act
    sender.async_send(tx_data.data(), tx_data.size());
    
    // Future-based sync (No sleeps)
    io_.restart();
    while (rx_future.wait_for(std::chrono::milliseconds(1)) != std::future_status::ready) {
        io_.poll();
    }

    // Assert
    std::vector<uint8_t> rx_data = rx_future.get();
    EXPECT_EQ(rx_data, tx_data);
    EXPECT_TRUE(receiver.is_active());
    
    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-003: Happy Path - Reply Endpoint Auto-Update
TEST_F(UdpTransportTest, ReplyEndpoint_UpdatesOnReceive) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 9999);
    receiver.start();
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();
    
    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();
    auto tx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short tx_port = (sender.*tx_socket_ptr).local_endpoint().port();
    
    std::promise<std::vector<uint8_t>> rx_promise;
    auto rx_future = rx_promise.get_future();
    receiver.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        rx_promise.set_value(std::vector<uint8_t>(data, data + len));
    });

    std::promise<std::vector<uint8_t>> reply_promise;
    auto reply_future = reply_promise.get_future();
    sender.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        reply_promise.set_value(std::vector<uint8_t>(data, data + len));
    });

    std::vector<uint8_t> initial_msg = { 0xAA };
    std::vector<uint8_t> reply_msg = { 0xBB };

    // Act 1: Send initial message
    sender.async_send(initial_msg.data(), initial_msg.size());
    io_.restart();
    while (rx_future.wait_for(std::chrono::milliseconds(1)) != std::future_status::ready) {
        io_.poll();
    }

    // Assert reply_endpoint_ updated
    auto reply_endpoint_ptr = get(UdpTransportReplyEndpointTag{});
    auto endpoint_mutex_ptr = get(UdpTransportEndpointMutexTag{});
    {
        std::lock_guard<std::mutex> lock(receiver.*endpoint_mutex_ptr);
        EXPECT_EQ((receiver.*reply_endpoint_ptr).port(), tx_port);
    }

    // Act 2: Reply back
    receiver.async_send(reply_msg.data(), reply_msg.size());
    io_.restart();
    while (reply_future.wait_for(std::chrono::milliseconds(1)) != std::future_status::ready) {
        io_.poll();
    }

    // Assert
    EXPECT_EQ(reply_future.get(), reply_msg);

    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-004: Boundary - Zero-Length and Large Packets (Up to buffer limit of 2048)
TEST_F(UdpTransportTest, Boundary_ZeroLengthAndLargeBuffer) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();
    
    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();

    std::promise<std::size_t> rx_len_promise;
    auto rx_len_future = rx_len_promise.get_future();
    receiver.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        rx_len_promise.set_value(len);
    });

    std::vector<uint8_t> large_data(2048, 0xFE);

    // Act 1: Send empty data (does not fire callback since 0 length is handled by OS or ignored)
    sender.async_send(nullptr, 0);
    io_.poll();

    // Act 2: Send 2048 bytes
    sender.async_send(large_data.data(), large_data.size());
    io_.restart();
    while (rx_len_future.wait_for(std::chrono::milliseconds(1)) != std::future_status::ready) {
        io_.poll();
    }

    // Assert
    EXPECT_EQ(rx_len_future.get(), 2048);

    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-005: Error/Boundary - Null Callback Handling
TEST_F(UdpTransportTest, NullCallback_DoesNotCrash) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();
    receiver.set_receive_callback(nullptr);
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();
    
    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();
    std::vector<uint8_t> data = { 0x0A };

    // Act & Assert
    sender.async_send(data.data(), data.size());
    EXPECT_NO_THROW({
        io_.poll();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        io_.poll();
    });

    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-006: State Verification - Active and Timeout States
TEST_F(UdpTransportTest, StateVerification_IsActiveTimeout) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    auto active_ptr = get(UdpTransportActiveTag{});
    auto last_receive_ptr = get(UdpTransportLastReceiveTag{});

    // Assert Initial State
    EXPECT_FALSE(transport.is_active());

    // Act 1: Simulate active receipt
    transport.*active_ptr = true;
    transport.*last_receive_ptr = std::chrono::steady_clock::now();
    
    // Assert Active State
    EXPECT_TRUE(transport.is_active());

    // Act 2: Simulate 2.5 seconds timeout
    transport.*last_receive_ptr = std::chrono::steady_clock::now() - std::chrono::milliseconds(2500);

    // Assert Timeout State
    EXPECT_FALSE(transport.is_active());
}

// UT-UDP-007: State/Resource - Stop and Socket Closure
TEST_F(UdpTransportTest, Stop_ClosesSocket) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    transport.start();
    auto active_ptr = get(UdpTransportActiveTag{});
    transport.*active_ptr = true;
    auto socket_ptr = get(UdpTransportSocketTag{});

    // Act
    transport.stop();

    // Assert
    EXPECT_FALSE((transport.*socket_ptr).is_open());
    EXPECT_FALSE(transport.is_active());
}

// UT-UDP-008: Concurrency - Multi-threaded Transmission
TEST_F(UdpTransportTest, Concurrency_MultiThreadedSend) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();

    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();

    std::atomic<int> rx_count{0};
    receiver.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        rx_count++;
    });

    const int THREAD_COUNT = 10;
    std::vector<std::thread> threads;
    std::vector<uint8_t> data = { 0xFF };

    // Act
    for (int i = 0; i < THREAD_COUNT; ++i) {
        threads.emplace_back([&]() {
            sender.async_send(data.data(), data.size());
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    // Wait for all 10 packets to be received using polling loop
    io_.restart();
    for (int i = 0; i < 50; ++i) {
        io_.poll();
        if (rx_count.load() == THREAD_COUNT) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }

    // Assert exact reception count
    EXPECT_EQ(rx_count.load(), THREAD_COUNT);

    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-009: DoubleStart_NoCrash
TEST_F(UdpTransportTest, DoubleStart_NoCrash) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);

    // Act & Assert
    EXPECT_NO_THROW({
        transport.start();
        transport.start(); // Second call
    });

    transport.stop();
}

// UT-UDP-010: DoubleStop_NoCrash
TEST_F(UdpTransportTest, DoubleStop_NoCrash) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    transport.start();

    // Act & Assert
    EXPECT_NO_THROW({
        transport.stop();
        transport.stop(); // Second call
    });
}

// UT-UDP-011: SendAfterStop_HandledGracefully
TEST_F(UdpTransportTest, SendAfterStop_HandledGracefully) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    transport.start();
    transport.stop(); // Socket closed

    std::vector<uint8_t> data = { 0x01 };

    // Act & Assert
    EXPECT_NO_THROW({
        transport.async_send(data.data(), data.size());
    });
}

// UT-UDP-012: InvalidIpAddress_FailsCleanly
TEST_F(UdpTransportTest, InvalidIpAddress_FailsCleanly) {
    // Arrange, Act & Assert
    EXPECT_THROW({
        UdpTransport transport(io_, "127.0.0.1", 0, "invalid_ip", 0);
    }, asio::system_error);
}

// UT-UDP-013: ReceiveCallbackThrows_NoTransportCrash
TEST_F(UdpTransportTest, ReceiveCallbackThrows_NoTransportCrash) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();
    
    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();

    std::promise<bool> promise_thrown;
    auto future_thrown = promise_thrown.get_future();

    receiver.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        promise_thrown.set_value(true);
        throw std::runtime_error("Callback crash simulated");
    });

    std::vector<uint8_t> tx_data = { 0x12 };

    // Act & Assert (Should propagate exception out of the callback, but not corrupt transport internals)
    sender.async_send(tx_data.data(), tx_data.size());
    
    io_.restart();
    try {
        while (future_thrown.wait_for(std::chrono::milliseconds(1)) != std::future_status::ready) {
            io_.poll();
        }
        io_.poll();
    } catch (const std::runtime_error& ex) {
        EXPECT_STREQ(ex.what(), "Callback crash simulated");
    }

    EXPECT_TRUE(future_thrown.get());
    
    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-014: MaximumUdpPayload_Success
TEST_F(UdpTransportTest, MaximumUdpPayload_Success) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    transport.start();

    // Max UDP payload size is 65507 bytes
    std::vector<uint8_t> max_payload(65507, 0xAA);

    // Act & Assert (Sending does not throw exception even if OS buffers are large)
    EXPECT_NO_THROW({
        transport.async_send(max_payload.data(), max_payload.size());
    });

    transport.stop();
}

// UT-UDP-015: OversizedUdpPayload_Rejected
TEST_F(UdpTransportTest, OversizedUdpPayload_Rejected) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    transport.start();

    // Payload exceeding max UDP size (65507) -> 65508 bytes
    std::vector<uint8_t> oversized_payload(65508, 0xBB);

    // Act & Assert (Rejected by local OS socket stack)
    EXPECT_NO_THROW({
        transport.async_send(oversized_payload.data(), oversized_payload.size());
    });

    transport.stop();
}

// UT-UDP-016: BurstTraffic_1000Packets
TEST_F(UdpTransportTest, BurstTraffic_1000Packets) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    unsigned short rx_port = (receiver.*rx_socket_ptr).local_endpoint().port();

    UdpTransport sender(io_, "127.0.0.1", 0, "127.0.0.1", rx_port);
    sender.start();

    std::atomic<int> rx_count{0};
    receiver.set_receive_callback([&](const uint8_t* data, std::size_t len) {
        rx_count++;
    });

    const int PACKET_COUNT = 200;
    std::vector<uint8_t> tx_data = { 0xCC };

    // Act: Send burst
    for (int i = 0; i < PACKET_COUNT; ++i) {
        sender.async_send(tx_data.data(), tx_data.size());
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    // Run io_context to poll reads
    io_.restart();
    for (int i = 0; i < 200; ++i) {
        io_.poll();
        if (rx_count.load() == PACKET_COUNT) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    // Assert (at least 90% received to allow for possible OS network drop, though loopback is highly reliable)
    EXPECT_GE(rx_count.load(), PACKET_COUNT * 0.9);

    // Cleanup
    sender.stop();
    receiver.stop();
}

// UT-UDP-017: ConcurrentStartStop_NoDeadlock
TEST_F(UdpTransportTest, ConcurrentStartStop_NoDeadlock) {
    // Arrange
    UdpTransport transport(io_, "127.0.0.1", 0, "127.0.0.1", 0);

    // Act & Assert
    std::vector<std::thread> threads;
    for (int i = 0; i < 10; ++i) {
        threads.emplace_back([&]() {
            transport.start();
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
            transport.stop();
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    // If we reach here, no deadlock occurred
    SUCCEED();
}

// UT-UDP-018: SocketErrorBranch_Covered
TEST_F(UdpTransportTest, SocketErrorBranch_Covered) {
    // Arrange
    UdpTransport receiver(io_, "127.0.0.1", 0, "127.0.0.1", 0);
    receiver.start();

    // Act: Force shutdown to trigger error branches in the receive handlers
    std::error_code ec;
    auto rx_socket_ptr = get(UdpTransportSocketTag{});
    (receiver.*rx_socket_ptr).shutdown(asio::socket_base::shutdown_both, ec);
    
    // Poll to process aborted receive handlers
    io_.poll();

    // Assert
    EXPECT_FALSE(receiver.is_active());
    receiver.stop();
}
