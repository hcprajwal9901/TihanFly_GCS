#include "mavlink_parser.h"

MAVLinkParser::MAVLinkParser()
{
    reset();
}

void MAVLinkParser::reset()
{
    status_ = {};
}

void MAVLinkParser::set_message_callback(MessageCallback cb)
{
    message_callback_ = std::move(cb);
}

void MAVLinkParser::parse_bytes(const uint8_t* data,
                                std::size_t length)
{
    for (std::size_t i = 0; i < length; ++i)
    {
        if (mavlink_parse_char(
                MAVLINK_COMM_0,
                data[i],
                &message_,
                &status_))
        {
            if (message_callback_)
            {
                message_callback_(message_);
            }
        }
    }
}
