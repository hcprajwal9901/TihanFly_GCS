#pragma once

#include <asio.hpp>
#include <functional>
#include <string>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <deque>

#include <mavlink/ardupilotmega/mavlink.h>

/**
 * MavlinkInspector
 *
 * Receives every decoded mavlink_message_t, maintains per-message statistics
 * (count, rate, last field values) and periodically broadcasts a JSON snapshot
 * to a registered WebSocket callback.
 *
 * The broadcast timer runs on the provided asio::io_context so it is fully
 * async – no blocking calls, no extra threads.
 */
class MavlinkInspector
{
public:
    using WsCallback = std::function<void(const std::string&)>;

    explicit MavlinkInspector(asio::io_context& io);

    /** Feed a decoded MAVLink message. Thread-safe. */
    void on_message(const mavlink_message_t& msg);

    /** Set the function that will be called with the JSON snapshot string. */
    void set_ws_callback(WsCallback cb);

    /** Start the periodic broadcast timer (call once after set_ws_callback). */
    void start();

    /** Stop the timer gracefully. */
    void stop();

private:
    struct MessageEntry
    {
        std::string  name;
        uint32_t     count{0};

        // Sliding window of receive timestamps for rate calculation
        std::deque<std::chrono::steady_clock::time_point> timestamps;

        // Latest decoded field values  (field_name → value_string)
        std::unordered_map<std::string, std::string> fields;

        float rate_hz() const;
    };

    void schedule_timer();
    void on_timer(const std::error_code& ec);
    void broadcast_snapshot();

    /** Decode all payload fields of a message using the MAVLink reflection API. */
    static void decode_fields(const mavlink_message_t& msg,
                              std::unordered_map<std::string, std::string>& out);

    /** Return the human-readable name for a message id. */
    static std::string message_name(uint32_t msgid);

    asio::io_context&             io_;
    asio::steady_timer            timer_;

    std::mutex                                          mutex_;
    std::unordered_map<uint32_t, MessageEntry>          entries_;

    WsCallback  ws_callback_;
    bool        running_{false};

    static constexpr int BROADCAST_INTERVAL_MS = 250;   ///< broadcast every 250 ms
    static constexpr int RATE_WINDOW_SEC       = 5;     ///< sliding window for Hz
};
