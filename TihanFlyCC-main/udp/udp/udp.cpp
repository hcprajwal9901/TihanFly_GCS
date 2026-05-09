#include "udp.h"
#include <iostream> //needed for debug prints
//Who ever wants the data must own it 
//Who ever want to create the udp socket must use a shared pointer to keep object alive until async operations are done
udp_socket::udp_socket(asio::io_context& io, int port)
    : socket_(io),
      local_endpoint_(asio::ip::udp::v4(), port)
{
    socket_.open(local_endpoint_.protocol());
    socket_.bind(local_endpoint_);
}


udp_socket::~udp_socket()
{
    socket_.cancel();
    socket_.close();

};


void udp_socket::send(const uint8_t* data, size_t len)
{
    if(!socket_.is_open())
        return;
    std::shared_ptr<udp_socket> self = shared_from_this();
    std::shared_ptr<std::vector<uint8_t>> send_buffer_ = std::make_shared<std::vector<uint8_t>>(data, data + len);//to keep data alive until send is done
    socket_.async_send_to(
        asio::buffer(send_buffer_->data(),send_buffer_->size()), remote_endpoint_,
        [self](const std::error_code& ec, std::size_t bytes_sent)
        {
            if(self->on_data_sent_)
                self->on_data_sent_(ec, bytes_sent);
            if (ec == asio::error::operation_aborted) return;
        });
};

void udp_socket::start_receive()
{
    std::shared_ptr<udp_socket> self = shared_from_this();
    
    std::shared_ptr<std::array<uint8_t,512>> recive_buffer_ = std::make_shared<std::array<uint8_t,512>>();//adjust size as needed

    socket_.async_receive_from(
        asio::buffer(recive_buffer_->data(),recive_buffer_->size()), remote_endpoint_,
        [self, recive_buffer_](const std::error_code& ec, std::size_t bytes_recvd)
        {
            if(self->on_data_recived_)
                self->on_data_recived_(ec, bytes_recvd,recive_buffer_->data());
            if(!ec)
                self->start_receive();
            if (ec == asio::error::operation_aborted) return;
        });
};