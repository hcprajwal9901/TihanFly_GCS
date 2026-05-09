#pragma once

#include <functional>
#include <cstdint>

class Transport
{
public:
    using ReceiveCallback =
        std::function<void(const uint8_t*, std::size_t)>;

    virtual ~Transport() = default;

    virtual void start() = 0;

    virtual void async_send(const uint8_t* data,
                            std::size_t length) = 0;

    virtual void set_receive_callback(ReceiveCallback cb) = 0;
};
