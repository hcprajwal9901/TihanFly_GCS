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

#include "Transport/serial.h"

// ─── C++ Template Private Member Access Hack ─────────────────────────────────
// Bypasses '#define private public' using explicit template instantiation.
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct SerialTransportActiveTag {
    typedef std::atomic<bool> SerialTransport::*type;
    friend type get(SerialTransportActiveTag);
};
template struct PrivateAccessor<SerialTransportActiveTag, &SerialTransport::active_>;

struct SerialTransportLastReceiveTag {
    typedef std::chrono::steady_clock::time_point SerialTransport::*type;
    friend type get(SerialTransportLastReceiveTag);
};
template struct PrivateAccessor<SerialTransportLastReceiveTag, &SerialTransport::last_receive_>;

struct SerialTransportSerialTag {
    typedef asio::serial_port SerialTransport::*type;
    friend type get(SerialTransportSerialTag);
};
template struct PrivateAccessor<SerialTransportSerialTag, &SerialTransport::serial_>;


class SerialTransportTest : public ::testing::Test {
protected:
    asio::io_context io_;
};

// UT-SER-001: Initialization & Getters
// Verify that construction is successful, values are set, and get_baudrate returns correctly.
TEST_F(SerialTransportTest, Initialization_BaudrateGetterCorrect) {
    // Arrange & Act
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);

    // Assert
    EXPECT_EQ(transport.get_baudrate(), 115200);
    EXPECT_FALSE(transport.is_open());
    EXPECT_FALSE(transport.is_active());
}

// UT-SER-002: State Verification - Active and Timeout States
// Verify is_active() behavior and timeout transitions.
TEST_F(SerialTransportTest, StateVerification_IsActiveTimeout) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 57600);
    auto active_ptr = get(SerialTransportActiveTag{});
    auto last_receive_ptr = get(SerialTransportLastReceiveTag{});

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

// UT-SER-003: Error - Invalid Port Construction
// Verify that invalid port names are caught internally without throwing exceptions out of the constructor.
TEST_F(SerialTransportTest, InvalidPort_HandlesExceptionsCleanly) {
    // Arrange, Act & Assert
    EXPECT_NO_THROW({
        SerialTransport transport(io_, "INVALID_PORT_ABC_123", 9600);
        EXPECT_FALSE(transport.is_open());
    });
}

// UT-SER-004: State Verification - Start on Closed Port
// Verify that calling start() on a closed/invalid port does not throw synchronously and leaves it closed.
TEST_F(SerialTransportTest, Start_OnClosedPortGraceful) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);

    // Act & Assert
    EXPECT_NO_THROW({
        transport.start();
    });
    EXPECT_FALSE(transport.is_open());
}

// UT-SER-005: Boundary - Send on Closed Port
// Verify that calling async_send on a closed port returns immediately and does not crash or throw.
TEST_F(SerialTransportTest, Send_OnClosedPortDoesNotCrash) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);
    std::vector<uint8_t> data = { 0xAA, 0xBB };

    // Act & Assert
    EXPECT_NO_THROW({
        transport.async_send(data.data(), data.size());
    });
}

// UT-SER-006: DoubleStart_NoCrash
// Verify start() called twice does not crash.
TEST_F(SerialTransportTest, DoubleStart_NoCrash) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);

    // Act & Assert
    EXPECT_NO_THROW({
        transport.start();
        transport.start();
    });
}

// UT-SER-007: DoubleStop_NoCrash
// Verify stop() called twice consecutively is safe.
TEST_F(SerialTransportTest, DoubleStop_NoCrash) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);

    // Act & Assert
    EXPECT_NO_THROW({
        transport.stop();
        transport.stop();
    });
}

// UT-SER-008: Concurrency - Concurrent Start and Stop
// Verify that start() and stop() can be executed concurrently without deadlock.
TEST_F(SerialTransportTest, Concurrency_ConcurrentStartStop) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);

    // Act & Assert
    std::vector<std::thread> threads;
    for (int i = 0; i < 5; ++i) {
        threads.emplace_back([&]() {
            try {
                transport.start();
            } catch (...) {}
        });
        threads.emplace_back([&]() {
            transport.stop();
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    SUCCEED();
}

// UT-SER-009: Callback Registration
// Verify callback registration and update.
TEST_F(SerialTransportTest, SetCallback_Succeeds) {
    // Arrange
    SerialTransport transport(io_, "INVALID_PORT_NAME", 115200);
    bool called = false;

    // Act
    transport.set_receive_callback([&](const uint8_t*, std::size_t) {
        called = true;
    });

    // Assert (no throw, callback is set)
    SUCCEED();
}

#ifndef _WIN32
#include <pty.h>
#include <unistd.h>
#include <fcntl.h>
#include <future>

TEST_F(SerialTransportTest, PtyLoopbackTransmitReceive) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    // Create a pseudo-terminal pair
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);
    ASSERT_GE(master_fd, 0);
    ASSERT_GE(slave_fd, 0);

    // Make master non-blocking so we don't block tests on read/write
    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    {
        // Act: Create transport and point it to the slave name
        SerialTransport transport(io_, slave_name, 115200);
        EXPECT_TRUE(transport.is_open());

        // Register receive callback
        std::promise<std::string> rx_promise;
        auto rx_future = rx_promise.get_future();
        transport.set_receive_callback([&](const uint8_t* data, std::size_t len) {
            rx_promise.set_value(std::string(reinterpret_cast<const char*>(data), len));
        });

        transport.start(); // Start reading

        // Start io_context in a thread
        std::thread io_thread([&]() {
            io_.run();
        });

        // Write from master end to simulate incoming data
        std::string test_data = "Hello Autopilot";
        ssize_t written = write(master_fd, test_data.data(), test_data.size());
        ASSERT_EQ(written, static_cast<ssize_t>(test_data.size()));

        // Assert: Verify callback was invoked
        ASSERT_TRUE(rx_future.wait_for(std::chrono::milliseconds(500)) == std::future_status::ready);
        EXPECT_EQ(rx_future.get(), test_data);

        // Verify active state
        EXPECT_TRUE(transport.is_active());

        // Test transmitting (async_send)
        std::vector<uint8_t> tx_data = { 'T', 'e', 's', 't', '\n' };
        transport.async_send(tx_data.data(), tx_data.size());

        // Wait a bit and read from master end to verify
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        char read_buf[256] = {};
        ssize_t read_bytes = read(master_fd, read_buf, sizeof(read_buf));
        ASSERT_GE(read_bytes, 0);
        EXPECT_EQ(std::string(read_buf, read_bytes), "Test\n");

        // Stop transport
        transport.stop();
        io_.stop();
        if (io_thread.joinable()) {
            io_thread.join();
        }
    }

    close(master_fd);
    close(slave_fd);
}

TEST_F(SerialTransportTest, PtyReceiveErrorHandling) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    {
        SerialTransport transport(io_, slave_name, 9600);
        transport.start();

        std::thread io_thread([&]() {
            io_.run();
        });

        // Close master_fd to force a receive error in read loop
        close(master_fd);
        master_fd = -1;

        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        // The transport should have closed its serial port on error
        EXPECT_FALSE(transport.is_open());

        io_.stop();
        if (io_thread.joinable()) {
            io_thread.join();
        }
    }
    if (slave_fd >= 0) close(slave_fd);
}
#endif

