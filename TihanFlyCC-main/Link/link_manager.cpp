#include "link_manager.h"
#include <iostream>

// ======================================================
// Add a transport as a new link
// ======================================================
int LinkManager::add_link(std::shared_ptr<Transport> transport,
                          asio::io_context& io)
{
    int id = static_cast<int>(links_.size());

    auto link = std::make_shared<Link>(id, transport, io);

    // ✅ If callback was already set before add_link, attach it now
    if (callback_)
        link->set_callback(callback_);

    links_.push_back(link);

    std::cout << "[Link] Added link " << id << std::endl;
    return id;
}

// ======================================================
// Start receiving on a link
// ======================================================
void LinkManager::start_link(int id)
{
    if (id >= 0 && id < static_cast<int>(links_.size()))
    {
        links_[id]->start();
        std::cout << "[Link] Started link " << id << std::endl;
    }
    else
    {
        std::cout << "[Link] start_link: invalid id " << id << std::endl;
    }
}

// ======================================================
// Send to a specific link
// ======================================================
void LinkManager::send(int id, const uint8_t* data, std::size_t length)
{
    if (id >= 0 && id < static_cast<int>(links_.size()))
        links_[id]->get_transport()->async_send(data, length);
}

// ======================================================
// Broadcast to all links
// ======================================================
void LinkManager::broadcast(const uint8_t* data, std::size_t length)
{
    for (auto& link : links_)
        link->get_transport()->async_send(data, length);
}

// ======================================================
// Set MAVLink message callback
// ✅ Retroactively applies to links already added
// ======================================================
void LinkManager::set_message_callback(MessageCallback cb)
{
    callback_ = cb;

    // Apply to any links that were added before this call
    for (auto& link : links_)
        link->set_callback(cb);
}