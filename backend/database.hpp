#pragma once
/*
 * backend/database.hpp
 * Async MySQL wrapper — replaces SQLite.
 *   - Dedicated worker thread for all DB I/O (never blocks io_context)
 *   - Results posted back to io_context via net::post()
 *   - All public methods take a DbCallback and return immediately
 *
 * Requires: libmysqlclient-dev  (apt install default-libmysqlclient-dev)
 */

#include "websocket_stream.hpp"   // brings in boost::asio as net::

#include <mysql/mysql.h>
#include <nlohmann/json.hpp>

#include <string>
#include <functional>
#include <memory>
#include <thread>
#include <mutex>
#include <queue>
#include <condition_variable>
#include <ctime>
#include <iostream>
#include <stdexcept>

using json = nlohmann::json;

// ── MySQL connection config ────────────────────────────────────
struct MySQLConfig {
    std::string host     = "127.0.0.1";
    std::string user     = "tihanfly";
    std::string password = "tihanfly123";
    std::string database = "tihanfly_db";
    unsigned int port    = 3306;
};

struct DbResult {
    bool        ok    = true;
    std::string error;
    json        data;
};

using DbCallback = std::function<void(DbResult)>;

class DatabaseManager : public std::enable_shared_from_this<DatabaseManager> {
public:
    using Ptr = std::shared_ptr<DatabaseManager>;

    static Ptr create(net::io_context& ioc, const MySQLConfig& cfg) {
        return Ptr(new DatabaseManager(ioc, cfg));
    }

    ~DatabaseManager() {
        {
            std::lock_guard<std::mutex> lk(mu_);
            stop_ = true;
        }
        cv_.notify_all();
        if (worker_.joinable()) worker_.join();
        if (db_) mysql_close(db_);
        mysql_thread_end();
    }

    // ── Schema init ───────────────────────────────────────────
    void init(DbCallback cb) {
        post_work([self = shared_from_this(), cb]() {
            const char* sql_users = R"(
                CREATE TABLE IF NOT EXISTS users (
                    id              VARCHAR(64)  PRIMARY KEY,
                    first_name      VARCHAR(128) NOT NULL,
                    last_name       VARCHAR(128) NOT NULL,
                    email           VARCHAR(255) NOT NULL UNIQUE,
                    password        VARCHAR(255),
                    provider        VARCHAR(32)  DEFAULT 'email',
                    status          VARCHAR(32)  DEFAULT 'pending',
                    registered_at   VARCHAR(32),
                    last_login      VARCHAR(32),
                    google_id       VARCHAR(128),
                    avatar          TEXT,
                    pending_session VARCHAR(64)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            )";

            const char* sql_log = R"(
                CREATE TABLE IF NOT EXISTS approval_log (
                    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                    user_id     VARCHAR(64),
                    action      VARCHAR(32),
                    admin_note  TEXT,
                    actioned_at VARCHAR(32),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            )";

            DbResult res;
            if (mysql_query(self->db_, sql_users) != 0) {
                res.ok    = false;
                res.error = std::string("users table: ") + mysql_error(self->db_);
                self->dispatch(cb, std::move(res));
                return;
            }
            if (mysql_query(self->db_, sql_log) != 0) {
                res.ok    = false;
                res.error = std::string("approval_log table: ") + mysql_error(self->db_);
                self->dispatch(cb, std::move(res));
                return;
            }
            self->dispatch(cb, std::move(res));
        });
    }

    // ── Create user (status = 'pending') ──────────────────────
    void create_user(const std::string& uid,
                     const std::string& first,
                     const std::string& last,
                     const std::string& email,
                     const std::string& pass,
                     const std::string& session_id,
                     DbCallback cb)
    {
        post_work([=, self = shared_from_this()]() {
            // Check duplicate
            std::string chk_sql =
                "SELECT id FROM users WHERE LOWER(email)=LOWER('" + self->esc(email) + "')";
            DbResult res;
            if (mysql_query(self->db_, chk_sql.c_str()) != 0) {
                res = {false, mysql_error(self->db_), {}};
                self->dispatch(cb, std::move(res));
                return;
            }
            MYSQL_RES* result = mysql_store_result(self->db_);
            bool exists = (mysql_num_rows(result) > 0);
            mysql_free_result(result);

            if (exists) {
                self->dispatch(cb, {false, "An account with this email already exists.", {}});
                return;
            }

            std::string now = self->now_iso();
            std::string ins =
                "INSERT INTO users "
                "(id,first_name,last_name,email,password,provider,status,registered_at,pending_session) "
                "VALUES ('" + self->esc(uid)        + "','"
                            + self->esc(first)      + "','"
                            + self->esc(last)       + "','"
                            + self->esc(email)      + "','"
                            + self->esc(pass)       + "',"
                            "'email','pending','"
                            + self->esc(now)        + "','"
                            + self->esc(session_id) + "')";

            if (mysql_query(self->db_, ins.c_str()) != 0) {
                res = {false, mysql_error(self->db_), {}};
            } else {
                res.data = {{"userId", uid}, {"registeredAt", now}};
            }
            self->dispatch(cb, std::move(res));
        });
    }

    // ── Authenticate ──────────────────────────────────────────
    void authenticate(const std::string& email,
                      const std::string& pass,
                      DbCallback cb)
    {
        post_work([=, self = shared_from_this()]() {
            std::string sel =
                "SELECT id,first_name,last_name,status,password "
                "FROM users WHERE LOWER(email)=LOWER('" + self->esc(email) + "') LIMIT 1";

            DbResult res;
            if (mysql_query(self->db_, sel.c_str()) != 0) {
                res = {false, mysql_error(self->db_), {}};
                self->dispatch(cb, std::move(res));
                return;
            }

            MYSQL_RES* result = mysql_store_result(self->db_);
            MYSQL_ROW  row    = mysql_fetch_row(result);

            if (!row) {
                mysql_free_result(result);
                self->dispatch(cb, {false, "No account found. Please sign up first.", {}});
                return;
            }

            std::string uid     = row[0] ? row[0] : "";
            std::string first   = row[1] ? row[1] : "";
            std::string last    = row[2] ? row[2] : "";
            std::string status  = row[3] ? row[3] : "";
            std::string db_pass = row[4] ? row[4] : "";
            mysql_free_result(result);

            if (status == "pending") {
                res = {false, "Your account is pending admin approval. Please wait.", {}};
            } else if (status == "inactive" || status == "rejected") {
                res = {false, "Your account has been disabled. Contact admin.", {}};
            } else if (db_pass != pass) {
                res = {false, "Incorrect password.", {}};
            } else {
                std::string now = self->now_iso();
                std::string upd =
                    "UPDATE users SET last_login='" + self->esc(now) +
                    "' WHERE id='" + self->esc(uid) + "'";
                mysql_query(self->db_, upd.c_str());
                res.data = {{"userId",uid},{"firstName",first},{"lastName",last}};
            }
            self->dispatch(cb, std::move(res));
        });
    }

    // ── Set status (approve / reject / toggle) ────────────────
    void set_status(const std::string& uid,
                    const std::string& new_status,
                    const std::string& note,
                    DbCallback cb)
    {
        post_work([=, self = shared_from_this()]() {
            // Fetch pending_session + user details
            std::string sel =
                "SELECT pending_session,first_name,last_name,email "
                "FROM users WHERE id='" + self->esc(uid) + "' LIMIT 1";

            std::string sess, first, last, email;
            if (mysql_query(self->db_, sel.c_str()) == 0) {
                MYSQL_RES* r = mysql_store_result(self->db_);
                MYSQL_ROW  row = mysql_fetch_row(r);
                if (row) {
                    sess  = row[0] ? row[0] : "";
                    first = row[1] ? row[1] : "";
                    last  = row[2] ? row[2] : "";
                    email = row[3] ? row[3] : "";
                }
                mysql_free_result(r);
            }

            // Update status
            std::string upd =
                "UPDATE users SET status='" + self->esc(new_status) +
                "' WHERE id='" + self->esc(uid) + "'";
            mysql_query(self->db_, upd.c_str());

            // Log
            std::string now = self->now_iso();
            std::string log =
                "INSERT INTO approval_log(user_id,action,admin_note,actioned_at) VALUES ('"
                + self->esc(uid)        + "','"
                + self->esc(new_status) + "','"
                + self->esc(note)       + "','"
                + self->esc(now)        + "')";
            mysql_query(self->db_, log.c_str());

            DbResult res;
            res.data = {
                {"userId",    uid},
                {"newStatus", new_status},
                {"sessionId", sess},
                {"firstName", first},
                {"lastName",  last},
                {"email",     email}
            };
            self->dispatch(cb, std::move(res));
        });
    }

    // ── Delete user ───────────────────────────────────────────
    void delete_user(const std::string& uid, DbCallback cb) {
        post_work([=, self = shared_from_this()]() {
            std::string del =
                "DELETE FROM users WHERE id='" + self->esc(uid) + "'";
            mysql_query(self->db_, del.c_str());
            DbResult res;
            res.data = {{"userId", uid}};
            self->dispatch(cb, std::move(res));
        });
    }

    // ── Fetch all users ───────────────────────────────────────
    void get_all_users(DbCallback cb) {
        post_work([=, self = shared_from_this()]() {
            const char* sel =
                "SELECT id,first_name,last_name,email,status,provider,"
                "registered_at,last_login,pending_session "
                "FROM users ORDER BY registered_at DESC";

            DbResult res;
            if (mysql_query(self->db_, sel) != 0) {
                res = {false, mysql_error(self->db_), {}};
                self->dispatch(cb, std::move(res));
                return;
            }

            MYSQL_RES* result = mysql_store_result(self->db_);
            json users = json::array();
            MYSQL_ROW row;
            while ((row = mysql_fetch_row(result))) {
                users.push_back({
                    {"id",          row[0] ? row[0] : ""},
                    {"firstName",   row[1] ? row[1] : ""},
                    {"lastName",    row[2] ? row[2] : ""},
                    {"email",       row[3] ? row[3] : ""},
                    {"status",      row[4] ? row[4] : ""},
                    {"provider",    row[5] ? row[5] : ""},
                    {"registeredAt",row[6] ? row[6] : ""},
                    {"lastLogin",   row[7] ? row[7] : ""},
                    {"sessionId",   row[8] ? row[8] : ""}
                });
            }
            mysql_free_result(result);
            res.data = {{"users", users}};
            self->dispatch(cb, std::move(res));
        });
    }

private:
    DatabaseManager(net::io_context& ioc, const MySQLConfig& cfg)
        : ioc_(ioc), db_(nullptr), stop_(false)
    {
        // mysql_init must happen on the worker thread for thread safety,
        // but we need a handle now — use mysql_init(nullptr) on main then
        // reconnect on worker. Simpler: open synchronously in constructor
        // since it's called once at startup before ioc.run().
        db_ = mysql_init(nullptr);
        if (!db_) throw std::runtime_error("mysql_init failed");

        unsigned int timeout = 10;
        mysql_options(db_, MYSQL_OPT_CONNECT_TIMEOUT, &timeout);
        mysql_options(db_, MYSQL_OPT_RECONNECT,       "\x01"); // auto-reconnect

        if (!mysql_real_connect(db_,
                cfg.host.c_str(),
                cfg.user.c_str(),
                cfg.password.c_str(),
                cfg.database.c_str(),
                cfg.port, nullptr, 0))
        {
            std::string err = mysql_error(db_);
            mysql_close(db_);
            throw std::runtime_error("MySQL connect: " + err);
        }

        // UTF-8 everything
        mysql_set_character_set(db_, "utf8mb4");

        worker_ = std::thread([this]() { run_worker(); });
        std::cout << "[DB]  MySQL connected: "
                  << cfg.host << ":" << cfg.port
                  << " / " << cfg.database << "\n";
    }

    void run_worker() {
        mysql_thread_init();
        while (true) {
            std::function<void()> task;
            {
                std::unique_lock<std::mutex> lk(mu_);
                cv_.wait(lk, [this]{ return !tasks_.empty() || stop_; });
                if (stop_ && tasks_.empty()) break;
                task = std::move(tasks_.front());
                tasks_.pop();
            }
            task();
        }
        mysql_thread_end();
    }

    void post_work(std::function<void()> task) {
        {
            std::lock_guard<std::mutex> lk(mu_);
            tasks_.push(std::move(task));
        }
        cv_.notify_one();
    }

    void dispatch(DbCallback cb, DbResult res) {
        net::post(ioc_, [cb, res = std::move(res)]() mutable {
            cb(std::move(res));
        });
    }

    // Safe escape for SQL strings (uses mysql_real_escape_string)
    std::string esc(const std::string& s) {
        std::string out(s.size() * 2 + 1, '\0');
        unsigned long len = mysql_real_escape_string(
            db_, &out[0], s.c_str(), static_cast<unsigned long>(s.size()));
        out.resize(len);
        return out;
    }

    static std::string now_iso() {
        auto t  = std::time(nullptr);
        auto tm = *std::gmtime(&t);
        char buf[32];
        std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
        return buf;
    }

    net::io_context&                      ioc_;
    MYSQL*                                db_;
    std::thread                           worker_;
    std::queue<std::function<void()>>     tasks_;
    std::mutex                            mu_;
    std::condition_variable               cv_;
    bool                                  stop_;
};