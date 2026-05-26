
#include "udp.h"
#include <iostream>

UdpTransport::UdpTransport(asio::io_context& io,
                           const std::string& local_ip,
                           int local_port,
                           const std::string& remote_ip,
                           int remote_port)
    : socket_(io),
      remote_endpoint_(asio::ip::make_address(remote_ip), remote_port)
{
    asio::ip::udp::endpoint local_endpoint(
        asio::ip::udp::v4(), local_port);

    socket_.open(asio::ip::udp::v4());
    socket_.set_option(asio::socket_base::reuse_address(true));
    
    // Set socket receive buffer size to 256 KB to absorb bursty MAVLink traffic without OS-level drops
    asio::socket_base::receive_buffer_size recv_buf_opt(262144);
    socket_.set_option(recv_buf_opt);

    socket_.bind(local_endpoint);

    std::cout << "[UDP] Bound to port " << local_port << std::endl;
}

void UdpTransport::start()
{
    std::cout << "[UDP] Started\n";
    do_receive();
}

void UdpTransport::set_receive_callback(ReceiveCallback cb)
{
    callback_ = cb;
}

void UdpTransport::do_receive()
{
    auto read_buf = std::make_shared<std::vector<uint8_t>>(2048);

    socket_.async_receive_from(
        asio::buffer(read_buf->data(), read_buf->size()),
        sender_endpoint_,
        [this, read_buf](std::error_code ec, std::size_t len)
        {
            if (ec)
            {
                if (ec == asio::error::operation_aborted) return;
                std::cout << "[UDP] Receive error: " << ec.message() << "\n";
                return;
            }

            // Immediately re-arm the next async read before calling the callback!
            // This ensures the OS-level UDP queue is continuously emptied even if the
            // callback takes time (e.g. processing MAVLink messages or WebSocket writes).
            do_receive();

            if (len > 0)
            {
                active_       = true;
                last_receive_ = std::chrono::steady_clock::now();

                // ✅ Always update reply address to whoever just sent us data.
                // mavproxy sends from a random high port (e.g. 55127), so we
                // must reply to that same address — not the hardcoded one.
                {
                    std::lock_guard<std::mutex> lock(endpoint_mutex_);
                    reply_endpoint_ = sender_endpoint_;
                }

                if (callback_)
                    callback_(read_buf->data(), len);
            }
        });
}

void UdpTransport::async_send(const uint8_t* data,
                              std::size_t length)
{
    // Use the dynamic reply endpoint if we've received from someone,
    // otherwise fall back to the configured remote endpoint.
    asio::ip::udp::endpoint target;
    {
        std::lock_guard<std::mutex> lock(endpoint_mutex_);
        target = (reply_endpoint_.port() != 0)
                     ? reply_endpoint_
                     : remote_endpoint_;
    }

    socket_.async_send_to(
        asio::buffer(data, length),
        target,
        [](std::error_code, std::size_t) {});
}

bool UdpTransport::is_active()
{
    if (!active_) return false;

    auto now  = std::chrono::steady_clock::now();
    auto diff = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - last_receive_).count();

    return diff < 2000;
}

void UdpTransport::stop()
{
    active_ = false;
    std::error_code ec;
    socket_.close(ec);
}
