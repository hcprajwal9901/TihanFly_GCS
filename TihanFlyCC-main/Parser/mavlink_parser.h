#ifndef MAVLINK_PARSER_H
#define MAVLINK_PARSER_H

#include <functional>
#include <cstdint>
#include <mavlink/ardupilotmega/mavlink.h>

class MAVLinkParser
{
public:
    using MessageCallback =
        std::function<void(const mavlink_message_t&)>;

    MAVLinkParser();

    // Feed raw bytes (can be partial)
    void parse_bytes(const uint8_t* data, std::size_t length);

    // Set callback for decoded messages
    void set_message_callback(MessageCallback cb);

    // Reset parser state (optional use)
    void reset();

private:
    mavlink_message_t message_;
    mavlink_status_t status_;

    MessageCallback message_callback_;
};

#endif // MAVLINK_PARSER_H
