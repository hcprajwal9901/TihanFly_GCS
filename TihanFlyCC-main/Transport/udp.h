#pragma once

#include "transport.h"
#include <asio.hpp>
#include <atomic>
#include <chrono>
#include <mutex>

class UdpTransport : public Transport
{
public:
    UdpTransport(asio::io_context& io,
                 const std::string& local_ip,
                 int local_port,
                 const std::string& remote_ip,
                 int remote_port);

    void start() override;

    void async_send(const uint8_t* data,
                    std::size_t length) override;

    void set_receive_callback(ReceiveCallback cb) override;

    bool is_active();
    void stop();

private:
    void do_receive();

    asio::ip::udp::socket   socket_;

    // Configured fallback target (used until first packet arrives)
    asio::ip::udp::endpoint remote_endpoint_;

    // Actual sender of the last received packet — we reply here
    asio::ip::udp::endpoint sender_endpoint_;
    asio::ip::udp::endpoint reply_endpoint_;   // updated on every receive
    std::mutex              endpoint_mutex_;

    uint8_t buffer_[2048]{};

    ReceiveCallback callback_;

    std::atomic<bool> active_{false};
    std::atomic<bool> running_{false};
    std::chrono::steady_clock::time_point last_receive_;
};
