#pragma once
/*
 * backend/listener.hpp
 * Async TCP accept loop — pure Boost.Asio + Beast.
 */

#include "websocket_stream.hpp"
#include "session.hpp"
#include "session_manager.hpp"
#include "database.hpp"

#include <memory>
#include <iostream>

class Listener : public std::enable_shared_from_this<Listener> {
public:
    using Ptr = std::shared_ptr<Listener>;

    static Ptr create(net::io_context&     ioc,
                      tcp::endpoint        ep,
                      SessionManager::Ptr  mgr,
                      DatabaseManager::Ptr db)
    {
        return Ptr(new Listener(ioc, ep, mgr, db));
    }

    void run() { do_accept(); }

private:
    Listener(net::io_context&     ioc,
             tcp::endpoint        ep,
             SessionManager::Ptr  mgr,
             DatabaseManager::Ptr db)
        : ioc_(ioc)
        , acceptor_(net::make_strand(ioc))
        , mgr_(mgr)
        , db_(db)
    {
        error_code ec;

        acceptor_.open(ep.protocol(), ec);
        if (ec) throw std::runtime_error("open: "       + ec.message());

        acceptor_.set_option(net::socket_base::reuse_address(true), ec);
        if (ec) throw std::runtime_error("set_option: " + ec.message());

        acceptor_.bind(ep, ec);
        if (ec) throw std::runtime_error("bind: "       + ec.message());

        acceptor_.listen(net::socket_base::max_listen_connections, ec);
        if (ec) throw std::runtime_error("listen: "     + ec.message());

        std::cout << "[NET] Listening on "
                  << ep.address().to_string() << ":" << ep.port() << "\n";
    }

    void do_accept() {
        // Each accepted socket gets its own strand
        acceptor_.async_accept(
            net::make_strand(ioc_),
            [self = shared_from_this()](error_code ec, tcp::socket socket) {
                // Schedule next accept BEFORE processing this one
                self->do_accept();

                if (!ec) {
                    // Create Session — shared_ptr takes ownership of socket
                    Session::create(
                        std::move(socket),
                        self->mgr_,
                        self->db_
                    )->start();
                } else {
                    std::cerr << "[NET] Accept error: " << ec.message() << "\n";
                }
            });
    }

    net::io_context&     ioc_;
    tcp::acceptor        acceptor_;
    SessionManager::Ptr  mgr_;
    DatabaseManager::Ptr db_;
};