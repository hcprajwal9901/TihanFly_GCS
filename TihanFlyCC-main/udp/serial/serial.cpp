#include "serial.h"

serial_port::serial_port(asio::io_context& io, const std::string& port_name, unsigned int baud_rate)
    : serial_(io, port_name)
{
    serial_.set_option(asio::serial_port_base::baud_rate(baud_rate));
    serial_.set_option(asio::serial_port_base::character_size(8));
    serial_.set_option(asio::serial_port_base::parity(asio::serial_port_base::parity::none));
    serial_.set_option(asio::serial_port_base::stop_bits(asio::serial_port_base::stop_bits::one));
    serial_.set_option(asio::serial_port_base::flow_control(asio::serial_port_base::flow_control::none));
}

serial_port::~serial_port()
{
    serial_.cancel();
    serial_.close();
}

void serial_port::start_receive()
{
    // Implementation for starting asynchronous receive can be added here
    std::shared_ptr<serial_port> self = shared_from_this();
    std::shared_ptr<std::array<uint8_t, 512>> recive_buffer_ = std::make_shared<std::array<uint8_t, 512>>();//adjust size as needed
    
}