#pragma once

#include "camera_capture.h"

#include <asio.hpp>
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

// ────────────────────────────────────────────────────────────────────────────
//  MjpegServer
//  Lightweight single-threaded HTTP server (built on ASIO) that serves:
//
//    GET /video_feed  →  multipart/x-mixed-replace MJPEG stream
//                        consumed by <img src="/video_feed"> in video-stream.js
//
//    GET /status      →  JSON health blob
//                        consumed by UltraSmoothVideoManager.testServer()
//
//    GET /snapshot    →  single JPEG download
//
//  One TCP connection = one streaming client.
//  Multiple clients are supported simultaneously.
// ────────────────────────────────────────────────────────────────────────────
class MjpegServer
{
public:
    explicit MjpegServer(asio::io_context& io,
                         CameraCapture&    camera,
                         uint16_t          port = 5000);

    // Start accepting connections
    void start();

    // Stop accepting (does not destroy existing streams)
    void stop();

    int  active_clients() const;

private:
    // ── Per-connection session ──────────────────────────────────────────
    class Session : public std::enable_shared_from_this<Session>
    {
    public:
        Session(asio::ip::tcp::socket socket,
                CameraCapture&        camera,
                std::atomic<int>&     client_counter);

        void start();

    private:
        void read_request();
        void handle_request(const std::string& request_line);

        // Routes
        void serve_video_feed();
        void serve_status();
        void serve_snapshot();
        void serve_not_found();

        // MJPEG streaming loop
        void stream_next_frame();

        asio::ip::tcp::socket socket_;
        CameraCapture&        camera_;
        std::atomic<int>&     client_counter_;
        asio::streambuf       request_buf_;
        std::vector<uint8_t>  last_frame_;   // avoid re-sending identical frame
    };

    void do_accept();

    asio::io_context&        io_;
    CameraCapture&           camera_;
    asio::ip::tcp::acceptor  acceptor_;
    std::atomic<int>         active_clients_{ 0 };
};
