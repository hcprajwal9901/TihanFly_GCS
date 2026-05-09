#pragma once
#include <asio.hpp>
#include <stdint.h>

class serial_port: public std::enable_shared_from_this<serial_port>
{
public:
    serial_port(asio::io_context& io, const std::string& port_name, unsigned int baud_rate);
    ~serial_port();

    void send(const uint8_t* data, size_t len);
    void start_receive();

public:
    asio::serial_port serial_;
    
};