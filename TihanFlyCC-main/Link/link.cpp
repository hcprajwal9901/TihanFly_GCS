#include "link.h"
#include <iostream>

Link::Link(int id,
           std::shared_ptr<Transport> transport,
           asio::io_context& io)
    : id_(id), transport_(transport), io_(io)
{
}

void Link::start()
{
    std::cout << "[Link] Listening..." << std::endl;

    // Start UDP/Serial transport
    transport_->start();

    // Set receive callback (IMPORTANT FIX)
    transport_->set_receive_callback(
        [this](const uint8_t* data, std::size_t len)
        {
            mavlink_message_t msg;
            mavlink_status_t status;

            for (size_t i = 0; i < len; i++)
            {
                if (mavlink_parse_char(MAVLINK_COMM_0,
                                       data[i],
                                       &msg,
                                       &status))
                {
                    if (callback_)
                        callback_(msg, id_);
                }
            }
        });
}

void Link::set_callback(Callback cb)
{
    callback_ = cb;
}

std::shared_ptr<Transport> Link::get_transport()
{
    return transport_;
}