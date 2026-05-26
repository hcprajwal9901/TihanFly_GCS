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

    int get_baudrate() const override;

    // ✅ IMPORTANT
    bool is_open() const;
    bool is_active();

private:
    void do_receive();

    asio::serial_port serial_;
    int baudrate_ = 115200;

    // 64 KB read buffer: absorbs a full ArduPilot parameter burst (~30 KB)
    // without stalling even if the io_context thread is briefly busy.
    // Previously 2048 bytes (~140 ms at 115200 baud) caused 40+ dropped params.
    static constexpr std::size_t RECV_BUF_SIZE = 65536;
    uint8_t buffer_[RECV_BUF_SIZE]{};

    ReceiveCallback callback_;

    std::atomic<bool> active_{false};
    std::chrono::steady_clock::time_point last_receive_;
};
