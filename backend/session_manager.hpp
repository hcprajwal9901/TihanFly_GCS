#pragma once
/*
 * backend/session_manager.hpp
 * Tracks all live WebSocket sessions.
 * Thread-safe: only accessed from the single io_context thread.
 */

#include "websocket_stream.hpp"
#include <nlohmann/json.hpp>
#include <unordered_map>
#include <unordered_set>
#include <memory>
#include <string>
#include <iostream>

using json = nlohmann::json;

// Forward-declare Session
class Session;

class SessionManager {
public:
    using SessionPtr = std::shared_ptr<Session>;
    using Ptr        = std::shared_ptr<SessionManager>;

    static Ptr create() { return std::make_shared<SessionManager>(); }

    void add(const std::string& sid, SessionPtr sess) {
        sessions_[sid] = sess;
        std::cout << "[SM]  + " << sid
                  << "  (total: " << sessions_.size() << ")\n";
    }

    void remove(const std::string& sid) {
        sessions_.erase(sid);
        admins_.erase(sid);
        std::cout << "[SM]  - " << sid
                  << "  (total: " << sessions_.size() << ")\n";
    }

    void mark_admin(const std::string& sid)   { admins_.insert(sid); }
    void unmark_admin(const std::string& sid) { admins_.erase(sid);  }
    bool is_admin(const std::string& sid) const { return admins_.count(sid) > 0; }

    // Defined after Session is complete (bottom of session.hpp)
    void send_to(const std::string& sid, const json& payload);

    void broadcast_admins(const json& payload) {
        for (auto& sid : admins_) send_to(sid, payload);
    }

    std::size_t count()       const { return sessions_.size(); }
    std::size_t admin_count() const { return admins_.size();   }

private:
    // weak_ptr: SessionManager never prolongs session lifetime
    std::unordered_map<std::string, std::weak_ptr<Session>> sessions_;
    std::unordered_set<std::string>                          admins_;
};