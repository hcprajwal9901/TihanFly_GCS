#pragma once
/*
 * backend/session.hpp
 * One WebSocket client connection = one Session.
 *
 * Fixes applied vs previous version:
 *   - Use boost::asio throughout (no standalone asio clash)
 *   - beast::tcp_stream socket (matches WebSocketStream type)
 *   - net::post() with executor (correct 2-arg form for Boost)
 *   - Timer constructed with executor correctly
 *   - Buffer read via beast::buffers_to_string() (no buffer_cast)
 *   - async_write uses net::buffer(*msg) — string buffer, not mutable_buffer
 *   - async_accept() called with no extra arg (just the callback)
 *   - Error check uses beast::websocket::error::closed (boost version)
 *   - ws_.close() uses beast::error_code (boost::system::error_code)
 *   - Removed unused buf_placeholder_ member
 */

#include "websocket_stream.hpp"
#include "session_manager.hpp"
#include "database.hpp"

#include <nlohmann/json.hpp>
#include <memory>
#include <string>
#include <deque>
#include <atomic>
#include <iostream>

using json = nlohmann::json;

class Session : public std::enable_shared_from_this<Session> {
public:
    using Ptr = std::shared_ptr<Session>;

    static Ptr create(tcp::socket           socket,
                      SessionManager::Ptr   mgr,
                      DatabaseManager::Ptr  db)
    {
        return Ptr(new Session(std::move(socket), mgr, db));
    }

    // ── Entry point ───────────────────────────────────────────
    void start() {
        // async_accept — no extra buffer arg, just the callback
        ws_.async_accept(
            [self = shared_from_this()](error_code ec) {
                if (ec) { self->on_error("accept", ec); return; }
                self->mgr_->add(self->id_, self);
                std::cout << "[WS]  Connected  " << self->id_ << "\n";
                self->schedule_heartbeat();
                self->do_read();
            });
    }

    // ── Send JSON (enqueue, serialised write pump) ────────────
    void send(const json& payload) {
        // Capture the message as a shared string so it stays alive
        // through the async_write callback
        auto msg = std::make_shared<std::string>(payload.dump());

        // net::post with executor — correct Boost.Asio 2-arg form
        net::post(ws_.get_executor(),
            [self = shared_from_this(), msg]() mutable {
                bool idle = self->write_queue_.empty();
                self->write_queue_.push_back(std::move(msg));
                if (idle) self->do_write();
            });
    }

    const std::string& id()        const { return id_; }
    bool               is_admin()  const { return is_admin_; }
    void               set_admin(bool v) { is_admin_ = v; }

private:
    Session(tcp::socket           socket,
            SessionManager::Ptr   mgr,
            DatabaseManager::Ptr  db)
        : ws_(std::move(socket))
        , mgr_(mgr)
        , db_(db)
        , id_(make_id())
        , is_admin_(false)
        // Timer takes executor (Boost.Asio any_io_executor) — single arg
        , heartbeat_timer_(ws_.get_executor())
    {}

    // ── Async read loop ───────────────────────────────────────
    void do_read() {
        ws_.async_read(buf_,
            [self = shared_from_this()](error_code ec, std::size_t) {
                if (ec) { self->on_error("read", ec); return; }

                // beast::buffers_to_string — correct way to extract text
                std::string msg = beast::buffers_to_string(self->buf_.data());
                self->buf_.consume(self->buf_.size());

                self->on_message(msg);
                self->do_read();   // loop
            });
    }

    // ── Write pump — one async_write in flight at a time ──────
    void do_write() {
        if (write_queue_.empty()) return;

        // Keep shared_ptr to msg alive through async_write
        auto msg = write_queue_.front();

        ws_.async_write(
            net::buffer(*msg),    // net::buffer(std::string&) → ConstBufferSequence
            [self = shared_from_this(), msg](error_code ec, std::size_t) {
                self->write_queue_.pop_front();
                if (ec) { self->on_error("write", ec); return; }
                if (!self->write_queue_.empty()) self->do_write();
            });
    }

    // ── Heartbeat every 30 s ──────────────────────────────────
    void schedule_heartbeat() {
        heartbeat_timer_.expires_after(std::chrono::seconds(30));
        heartbeat_timer_.async_wait(
            [self = shared_from_this()](error_code ec) {
                if (ec) return;  // cancelled = session closing
                self->send({{"type","ping"}});
                self->schedule_heartbeat();
            });
    }

    // ── Error / close ─────────────────────────────────────────
    void on_error(const std::string& where, error_code ec) {
        if (ec == websocket::error::closed ||
            ec == net::error::eof         ||
            ec == net::error::connection_reset) {
            std::cout << "[WS]  Closed     " << id_ << "\n";
        } else {
            std::cerr << "[WS]  Error [" << where << "] "
                      << id_ << ": " << ec.message() << "\n";
        }
        heartbeat_timer_.cancel();
        mgr_->remove(id_);
    }

    // ─────────────────────────────────────────────────────────
    //  MESSAGE DISPATCH
    // ─────────────────────────────────────────────────────────
    void on_message(const std::string& raw) {
        json msg;
        try { msg = json::parse(raw); }
        catch (...) {
            send({{"type","error"},{"message","Invalid JSON"}});
            return;
        }

        std::string type = msg.value("type","");
        std::cout << "[MSG] " << type << "  ← " << id_ << "\n";

        if      (type == "signup")              on_signup(msg);
        else if (type == "login")               on_login(msg);
        else if (type == "admin_login")         on_admin_login(msg);
        else if (type == "admin_approve")       on_admin_approve(msg);
        else if (type == "admin_reject")        on_admin_reject(msg);
        else if (type == "admin_get_users")     on_get_users();
        else if (type == "admin_toggle_status") on_toggle_status(msg);
        else if (type == "admin_delete_user")   on_delete_user(msg);
        else if (type == "pong")                { /* server's heartbeat reply — ok */ }
        else if (type == "ping")                { send({{"type","pong"}}); }
        else send({{"type","error"},{"message","Unknown type: " + type}});
    }

    // ─────────────────────────────────────────────────────────
    //  HANDLERS — each fires an async DB call with a callback
    //  Lambda captures shared_from_this() → session stays alive
    //  until callback runs.
    // ─────────────────────────────────────────────────────────

    void on_signup(const json& msg) {
        std::string first = msg.value("firstName","");
        std::string last  = msg.value("lastName","");
        std::string email = msg.value("email","");
        std::string pass  = msg.value("password","");

        if (first.empty()||last.empty()||email.empty()||pass.empty()) {
            send({{"type","signup_error"},{"message","All fields are required."}});
            return;
        }

        // Unique ID from epoch nanoseconds
        std::string uid = "USR-" + std::to_string(
            std::chrono::system_clock::now().time_since_epoch().count());

        db_->create_user(uid, first, last, email, pass, id_,
            [self = shared_from_this(), first, last, email, uid](DbResult res) {
                if (!res.ok) {
                    self->send({{"type","signup_error"},{"message",res.error}});
                    return;
                }

                // Tell user: waiting
                self->send({
                    {"type",    "signup_pending"},
                    {"message", "Registration received! Waiting for admin approval."},
                    {"userId",  uid}
                });

                // Push to ALL connected admins in real-time
                self->mgr_->broadcast_admins({
                    {"type",      "new_signup"},
                    {"userId",    uid},
                    {"firstName", first},
                    {"lastName",  last},
                    {"email",     email},
                    {"sessionId", self->id_}
                });

                std::cout << "[SIGNUP] " << first << " " << last
                          << " <" << email << ">  PENDING\n";
            });
    }

    void on_login(const json& msg) {
        std::string email = msg.value("email","");
        std::string pass  = msg.value("password","");

        db_->authenticate(email, pass,
            [self = shared_from_this()](DbResult res) {
                if (!res.ok) {
                    self->send({{"type","login_error"},{"message",res.error}});
                    return;
                }
                self->send({
                    {"type",      "login_success"},
                    {"message",   "Authentication successful. Loading GCS..."},
                    {"userId",    res.data["userId"]},
                    {"firstName", res.data["firstName"]},
                    {"lastName",  res.data["lastName"]},
                    {"redirect",  "MainWindow.html"}
                });
            });
    }

    void on_admin_login(const json& msg) {
        std::string user = msg.value("username","");
        std::string pass = msg.value("password","");

        if (user == "TiHANFLY" && pass == "tihanfly123") {
            is_admin_ = true;
            mgr_->mark_admin(id_);
            send({{"type","admin_login_success"},{"message","Admin access granted."}});
            std::cout << "[ADMIN] Login: " << id_ << "\n";
        } else {
            send({{"type","admin_login_error"},{"message","Invalid admin credentials."}});
        }
    }

    void on_admin_approve(const json& msg) {
        if (!is_admin_) { send({{"type","error"},{"message","Unauthorized."}}); return; }
        std::string uid  = msg.value("userId","");
        std::string note = msg.value("note","Approved by TiHAN admin.");

        db_->set_status(uid, "active", note,
            [self = shared_from_this()](DbResult res) {
                if (!res.ok) { self->send({{"type","error"},{"message",res.error}}); return; }

                self->send({{"type","admin_action_done"},
                             {"action","approved"},
                             {"userId",res.data["userId"]}});

                // Real-time push to user
                self->mgr_->send_to(res.data.value("sessionId",""), {
                    {"type",    "account_approved"},
                    {"message", "Your account has been approved! You can now log in."},
                    {"userId",  res.data["userId"]}
                });
                std::cout << "[ADMIN] Approved: " << res.data["userId"] << "\n";
            });
    }

    void on_admin_reject(const json& msg) {
        if (!is_admin_) { send({{"type","error"},{"message","Unauthorized."}}); return; }
        std::string uid    = msg.value("userId","");
        std::string reason = msg.value("reason","Not authorized.");

        db_->set_status(uid, "rejected", reason,
            [self = shared_from_this(), reason](DbResult res) {
                if (!res.ok) { self->send({{"type","error"},{"message",res.error}}); return; }

                self->send({{"type","admin_action_done"},
                             {"action","rejected"},
                             {"userId",res.data["userId"]}});

                self->mgr_->send_to(res.data.value("sessionId",""), {
                    {"type",    "account_rejected"},
                    {"message", "Registration rejected: " + reason},
                    {"userId",  res.data["userId"]}
                });
                std::cout << "[ADMIN] Rejected: " << res.data["userId"] << "\n";
            });
    }

    void on_get_users() {
        if (!is_admin_) { send({{"type","error"},{"message","Unauthorized."}}); return; }
        db_->get_all_users(
            [self = shared_from_this()](DbResult res) {
                self->send({{"type","users_list"},{"users",res.data["users"]}});
            });
    }

    void on_toggle_status(const json& msg) {
        if (!is_admin_) { send({{"type","error"},{"message","Unauthorized."}}); return; }
        std::string uid = msg.value("userId","");

        // Fetch current status then flip
        db_->get_all_users(
            [self = shared_from_this(), uid](DbResult res) {
                for (auto& u : res.data["users"]) {
                    if (u["id"] == uid) {
                        std::string cur  = u.value("status","active");
                        std::string next = (cur == "active") ? "inactive" : "active";
                        self->db_->set_status(uid, next, "toggled by admin",
                            [self, uid, next](DbResult /*r2*/) {
                                self->send({{"type","toggle_done"},
                                            {"userId",uid},{"newStatus",next}});
                            });
                        return;
                    }
                }
                self->send({{"type","error"},{"message","User not found."}});
            });
    }

    void on_delete_user(const json& msg) {
        if (!is_admin_) { send({{"type","error"},{"message","Unauthorized."}}); return; }
        std::string uid = msg.value("userId","");
        db_->delete_user(uid,
            [self = shared_from_this()](DbResult res) {
                self->send({{"type","delete_done"},{"userId",res.data["userId"]}});
            });
    }

    // ── helpers ───────────────────────────────────────────────
    static std::string make_id() {
        static std::atomic<uint64_t> ctr{1};
        return "S" + std::to_string(ctr.fetch_add(1));
    }

    // Members
    WebSocketStream                          ws_;
    SessionManager::Ptr                      mgr_;
    DatabaseManager::Ptr                     db_;
    std::string                              id_;
    bool                                     is_admin_;
    beast::flat_buffer                       buf_;
    std::deque<std::shared_ptr<std::string>> write_queue_;
    net::steady_timer                        heartbeat_timer_;
};

// ── SessionManager::send_to defined here (after Session is complete) ──
inline void SessionManager::send_to(const std::string& sid, const json& payload) {
    auto it = sessions_.find(sid);
    if (it == sessions_.end()) return;
    if (auto sess = it->second.lock()) {
        sess->send(payload);
    } else {
        sessions_.erase(it);   // stale weak_ptr — clean up
    }
}