#pragma once
/*
 * backend/websocket_stream.hpp
 * Single place that defines ALL namespace aliases and the WS stream type.
 * Everything uses Boost — no standalone asio conflict.
 */

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <boost/asio/steady_timer.hpp>

// ── Namespace aliases (used everywhere) ──────────────────────
namespace net       = boost::asio;
namespace beast     = boost::beast;
namespace websocket = beast::websocket;
using     tcp       = net::ip::tcp;
using     error_code= boost::system::error_code;

// ── Our WebSocket stream type ─────────────────────────────────
//   beast::tcp_stream already wraps a tcp::socket with a strand
using WebSocketStream = websocket::stream<beast::tcp_stream>;