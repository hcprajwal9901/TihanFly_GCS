#pragma once

#include <vector>
#include <memory>
#include <functional>

#include "link.h"
#include "../Transport/transport.h"

class LinkManager
{
public:
    using MessageCallback =
        std::function<void(const mavlink_message_t&, int)>;

    // Add a transport as a new link. Returns the link ID.
    int add_link(std::shared_ptr<Transport> transport,
                 asio::io_context& io);

    // Start receiving on a link by ID.
    void start_link(int id);

    // Send to a specific link by ID.
    void send(int id, const uint8_t* data, std::size_t length);

    // Send to all links.
    void broadcast(const uint8_t* data, std::size_t length);

    // Set the MAVLink message callback.
    // ✅ Also retroactively applies to any links already added.
    void set_message_callback(MessageCallback cb);

private:
    std::vector<std::shared_ptr<Link>> links_;
    MessageCallback callback_;
};