#pragma once

#include <memory>
#include <functional>
#include <asio.hpp>

#include "Transport/transport.h"
#include "mavlink/ardupilotmega/mavlink.h"

class Link
{
public:
    using Callback =
        std::function<void(const mavlink_message_t&, int)>;

    Link(int id,
         std::shared_ptr<Transport> transport,
         asio::io_context& io);

    void start();

    void set_callback(Callback cb);

    std::shared_ptr<Transport> get_transport();
    uint64_t get_valid_msg_count() const;

private:
    int id_;
    std::shared_ptr<Transport> transport_;
    asio::io_context& io_;
    Callback callback_;
    std::atomic<uint64_t> valid_msg_count_{0};
};