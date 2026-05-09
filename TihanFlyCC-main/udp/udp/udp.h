#pragma once 
#include "asio.hpp"
#include <stdint.h>

class udp_socket: public std::enable_shared_from_this<udp_socket>
{
public:
    udp_socket(asio::io_context& io, int port);
    ~udp_socket();
    
    void send(const uint8_t* data, size_t len);
    void start_receive();
private:
    asio::ip::udp::socket socket_;
    asio::ip::udp::endpoint local_endpoint_;//Where i am bound to
    asio::ip::udp::endpoint remote_endpoint_;//to whom i am talking
public:
    std::function<void(const std::error_code&, size_t, const uint8_t*)> on_data_recived_;
    std::function<void(const std::error_code& ec,std::size_t bytes_sent)> on_data_sent_;
    bool is_ready_tosend = false;
};