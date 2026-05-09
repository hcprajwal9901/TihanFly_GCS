#include "mjpeg_server.h"

#include <iostream>
#include <sstream>
#include <string>

// ── MJPEG multipart boundary ─────────────────────────────────────────────────
static const std::string BOUNDARY      = "--frame";
static const std::string CONTENT_TYPE  = "image/jpeg";

// ────────────────────────────────────────────────────────────────────────────
//  MjpegServer
// ────────────────────────────────────────────────────────────────────────────

MjpegServer::MjpegServer(asio::io_context& io,
                         CameraCapture&    camera,
                         uint16_t          port)
    : io_(io)
    , camera_(camera)
    , acceptor_(io,
                asio::ip::tcp::endpoint(asio::ip::tcp::v4(), port))
{
    // Allow quick restart after crash
    acceptor_.set_option(asio::socket_base::reuse_address(true));
    std::cout << "[MjpegServer] Listening on port " << port << "\n";
}

void MjpegServer::start()
{
    do_accept();
}

void MjpegServer::stop()
{
    std::error_code ec;
    acceptor_.close(ec);
}

int MjpegServer::active_clients() const
{
    return active_clients_.load();
}

void MjpegServer::do_accept()
{
    acceptor_.async_accept(
        [this](std::error_code ec, asio::ip::tcp::socket socket)
        {
            if (!ec)
            {
                std::cout << "[MjpegServer] Client connected: "
                          << socket.remote_endpoint() << "\n";
                std::make_shared<Session>(
                    std::move(socket), camera_, active_clients_)->start();
            }
            if (acceptor_.is_open())
                do_accept();
        });
}

// ────────────────────────────────────────────────────────────────────────────
//  Session
// ────────────────────────────────────────────────────────────────────────────

MjpegServer::Session::Session(asio::ip::tcp::socket socket,
                               CameraCapture&        camera,
                               std::atomic<int>&     client_counter)
    : socket_(std::move(socket))
    , camera_(camera)
    , client_counter_(client_counter)
{}

void MjpegServer::Session::start()
{
    read_request();
}

// ── Read the first line of the HTTP request ───────────────────────────────

void MjpegServer::Session::read_request()
{
    auto self = shared_from_this();
    asio::async_read_until(
        socket_, request_buf_, "\r\n",
        [this, self](std::error_code ec, std::size_t /*len*/)
        {
            if (ec) return;

            std::istream stream(&request_buf_);
            std::string  line;
            std::getline(stream, line);
            if (!line.empty() && line.back() == '\r')
                line.pop_back();

            handle_request(line);
        });
}

// ── Route dispatcher ─────────────────────────────────────────────────────

void MjpegServer::Session::handle_request(const std::string& request_line)
{
    // "GET /video_feed HTTP/1.1"
    std::istringstream iss(request_line);
    std::string method, path;
    iss >> method >> path;

    std::cout << "[MjpegServer] " << method << " " << path << "\n";

    if (path == "/video_feed")
        serve_video_feed();
    else if (path == "/status")
        serve_status();
    else if (path == "/snapshot")
        serve_snapshot();
    else
        serve_not_found();
}

// ── /video_feed ──────────────────────────────────────────────────────────

void MjpegServer::Session::serve_video_feed()
{
    ++client_counter_;

    // HTTP response header for MJPEG
    const std::string header =
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
        "Cache-Control: no-cache, no-store, must-revalidate\r\n"
        "Pragma: no-cache\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Connection: keep-alive\r\n\r\n";

    auto self = shared_from_this();
    asio::async_write(socket_, asio::buffer(header),
        [this, self](std::error_code ec, std::size_t)
        {
            if (!ec)
                stream_next_frame();
            else
                --client_counter_;
        });
}

void MjpegServer::Session::stream_next_frame()
{
    auto self = shared_from_this();
    auto frame = camera_.read_frame();

    // If camera has no frame yet, wait 33ms and retry
    if (frame.empty())
    {
        auto timer = std::make_shared<asio::steady_timer>(
            socket_.get_executor(), std::chrono::milliseconds(33));
        timer->async_wait([this, self, timer](std::error_code)
        {
            stream_next_frame();
        });
        return;
    }

    // Skip identical frames to save bandwidth
    if (frame == last_frame_)
    {
        auto timer = std::make_shared<asio::steady_timer>(
            socket_.get_executor(), std::chrono::milliseconds(16));
        timer->async_wait([this, self, timer](std::error_code)
        {
            stream_next_frame();
        });
        return;
    }
    last_frame_ = frame;

    // Build multipart chunk
    std::ostringstream part_header;
    part_header << BOUNDARY << "\r\n"
                << "Content-Type: " << CONTENT_TYPE << "\r\n"
                << "Content-Length: " << frame.size() << "\r\n\r\n";

    const std::string ph = part_header.str();

    // We need the header and the JPEG body to stay alive until async_write completes.
    // Pack them into a shared buffer.
    auto buf = std::make_shared<std::vector<uint8_t>>();
    buf->insert(buf->end(), ph.begin(), ph.end());
    buf->insert(buf->end(), frame.begin(), frame.end());
    buf->insert(buf->end(), '\r');
    buf->insert(buf->end(), '\n');

    asio::async_write(socket_, asio::buffer(*buf),
        [this, self, buf](std::error_code ec, std::size_t)
        {
            if (!ec)
                stream_next_frame();
            else
            {
                --client_counter_;
                std::cout << "[MjpegServer] Client disconnected\n";
            }
        });
}

// ── /status ──────────────────────────────────────────────────────────────

void MjpegServer::Session::serve_status()
{
    bool active = camera_.is_active();
    uint64_t fc = camera_.frame_count();
    const auto& cfg = camera_.config();

    std::ostringstream json;
    json << "{"
         << "\"camera_active\":" << (active ? "true" : "false") << ","
         << "\"frame_count\":"   << fc << ","
         << "\"source\":\""      << cfg.source << "\","
         << "\"width\":"         << cfg.width << ","
         << "\"height\":"        << cfg.height << ","
         << "\"fps\":"           << cfg.fps
         << "}";

    const std::string body = json.str();
    std::ostringstream response;
    response << "HTTP/1.1 200 OK\r\n"
             << "Content-Type: application/json\r\n"
             << "Content-Length: " << body.size() << "\r\n"
             << "Access-Control-Allow-Origin: *\r\n"
             << "Cache-Control: no-cache\r\n\r\n"
             << body;

    const std::string resp = response.str();
    auto self = shared_from_this();
    asio::async_write(socket_, asio::buffer(resp),
        [self](std::error_code, std::size_t) {});
}

// ── /snapshot ────────────────────────────────────────────────────────────

void MjpegServer::Session::serve_snapshot()
{
    auto frame = camera_.read_frame();

    if (frame.empty())
    {
        serve_not_found();
        return;
    }

    std::ostringstream response;
    response << "HTTP/1.1 200 OK\r\n"
             << "Content-Type: image/jpeg\r\n"
             << "Content-Length: " << frame.size() << "\r\n"
             << "Content-Disposition: attachment; filename=\"snapshot.jpg\"\r\n"
             << "Access-Control-Allow-Origin: *\r\n\r\n";

    const std::string header = response.str();
    auto buf = std::make_shared<std::vector<uint8_t>>();
    buf->insert(buf->end(), header.begin(), header.end());
    buf->insert(buf->end(), frame.begin(), frame.end());

    auto self = shared_from_this();
    asio::async_write(socket_, asio::buffer(*buf),
        [self, buf](std::error_code, std::size_t) {});
}

// ── 404 ──────────────────────────────────────────────────────────────────

void MjpegServer::Session::serve_not_found()
{
    const std::string resp =
        "HTTP/1.1 404 Not Found\r\n"
        "Content-Length: 0\r\n"
        "Access-Control-Allow-Origin: *\r\n\r\n";

    auto self = shared_from_this();
    asio::async_write(socket_, asio::buffer(resp),
        [self](std::error_code, std::size_t) {});
}
