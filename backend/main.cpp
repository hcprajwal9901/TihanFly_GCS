/*
 * backend/main.cpp
 * TiHANFly GCS — Entry point
 * Pure Boost.Asio + Boost.Beast (no standalone asio)
 */

#include "listener.hpp"
#include "session_manager.hpp"
#include "database.hpp"

#include <iostream>
#include <csignal>
#include <memory>

static net::io_context* g_ioc = nullptr;

void handle_signal(int) {
    std::cout << "\n[SRV] Signal received — stopping...\n";
    if (g_ioc) g_ioc->stop();
}

int main(int argc, char* argv[]) {
    std::cout << R"(
╔══════════════════════════════════════════════╗
║   TiHANFly GCS  —  WebSocket Backend        ║
║   Boost.Asio | Async | Callbacks | SQLite    ║
╚══════════════════════════════════════════════╝
)";

    unsigned short port = (argc > 1) ? static_cast<unsigned short>(std::atoi(argv[1])) : 8080;

    // ── MySQL config — edit here or override with env vars ────
    MySQLConfig db_cfg;
    db_cfg.host     = std::getenv("DB_HOST") ? std::getenv("DB_HOST") : "127.0.0.1";
    db_cfg.user     = std::getenv("DB_USER") ? std::getenv("DB_USER") : "tihanfly";
    db_cfg.password = std::getenv("DB_PASS") ? std::getenv("DB_PASS") : "tihanfly123";
    db_cfg.database = std::getenv("DB_NAME") ? std::getenv("DB_NAME") : "tihanfly_db";
    db_cfg.port     = 3306;

    // Single-threaded io_context — no locks needed for session dispatch
    net::io_context ioc{1};
    auto work = net::make_work_guard(ioc);
    g_ioc = &ioc;

    std::signal(SIGINT,  handle_signal);
    std::signal(SIGTERM, handle_signal);

    // Build the object graph
    auto db  = DatabaseManager::create(ioc, db_cfg);
    auto mgr = SessionManager::create();

    tcp::endpoint ep{net::ip::address_v4::any(), port};

    // Init DB schema (async) — start listener in callback
    db->init([&](DbResult res) {
        if (!res.ok) {
            std::cerr << "[ERR] DB init: " << res.error << "\n";
            ioc.stop();
            return;
        }
        std::cout << "[DB]  Schema OK\n";

        try {
            Listener::create(ioc, ep, mgr, db)->run();
        } catch (const std::exception& e) {
            std::cerr << "[ERR] Listener: " << e.what() << "\n";
            ioc.stop();
            return;
        }

        std::cout << "[SRV] Ready on ws://0.0.0.0:" << port << "\n";
        std::cout << "[SRV] Admin login: TiHANFLY / tihanfly123\n";
        std::cout << "[SRV] Ctrl+C to stop\n\n";
    });

    ioc.run();   // blocks until stop()

    std::cout << "[SRV] Stopped.\n";
    return 0;
}