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
            
            // Use a unique channel for this link. MAVLINK_COMM_NUM_BUFFERS is usually 16.
            uint8_t chan = static_cast<uint8_t>(id_ % MAVLINK_COMM_NUM_BUFFERS);

            for (size_t i = 0; i < len; i++)
            {
                if (mavlink_parse_char(chan,
                                       data[i],
                                       &msg,
                                       &status))
                {
                    valid_msg_count_.fetch_add(1, std::memory_order_relaxed);
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

uint64_t Link::get_valid_msg_count() const
{
    return valid_msg_count_.load(std::memory_order_relaxed);
}