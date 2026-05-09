#pragma once

#include <asio.hpp>
#include <functional>
#include <atomic>
#include <chrono>
#include <iostream>

#include "transport.h"

class SerialTransport : public Transport
{
public:
    SerialTransport(asio::io_context& io,
                    const std::string& port,
                    int baudrate);

    void start() override;

    void async_send(const uint8_t* data,
                    std::size_t length) override;

    void set_receive_callback(ReceiveCallback cb) override;

    void stop();

    // ✅ IMPORTANT
    bool is_open() const;
    bool is_active();

private:
    void do_receive();

    asio::serial_port serial_;
    uint8_t buffer_[2048];

    ReceiveCallback callback_;

    std::atomic<bool> active_{false};
    std::chrono::steady_clock::time_point last_receive_;
};
