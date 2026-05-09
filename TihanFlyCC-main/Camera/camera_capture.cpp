#include "camera_capture.h"

#include <iostream>
#include <sstream>
#include <iomanip>
#include <ctime>

// ────────────────────────────────────────────────────────────────────────────

CameraCapture::CameraCapture() : CameraCapture(Config{}) {}

CameraCapture::CameraCapture(const Config& cfg)
    : cfg_(cfg)
{
    last_frame_time_ = std::chrono::steady_clock::now();
}

CameraCapture::~CameraCapture()
{
    stop();
}

// ── Public API ───────────────────────────────────────────────────────────────

bool CameraCapture::start()
{
    if (running_)
    {
        std::cout << "[Camera] Already running\n";
        return true;
    }

    if (!open_camera())
        return false;

    running_ = true;
    thread_ = std::thread(&CameraCapture::capture_loop, this);

    std::cout << "[Camera] Capture started  source=" << cfg_.source
              << "  " << cfg_.width << "x" << cfg_.height
              << " @ " << cfg_.fps << "fps\n";
    return true;
}

void CameraCapture::stop()
{
    running_ = false;
    if (thread_.joinable())
        thread_.join();
    release_camera();
    std::cout << "[Camera] Capture stopped\n";
}

std::vector<uint8_t> CameraCapture::read_frame()
{
    std::lock_guard<std::mutex> lock(buf_mutex_);
    return front_; // copy of latest encoded frame
}

bool CameraCapture::is_active() const
{
    if (!running_) return false;

    std::lock_guard<std::mutex> lock(time_mutex_);
    auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::steady_clock::now() - last_frame_time_).count();
    return elapsed < 5;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

bool CameraCapture::open_camera()
{
    release_camera();

    // Detect if source is a number (device index) or a pipeline/URL string
    bool is_index = true;
    for (char c : cfg_.source)
        if (!std::isdigit(c)) { is_index = false; break; }

    if (is_index)
    {
        int idx = std::stoi(cfg_.source);
        cap_.open(idx);
    }
    else
    {
        // GStreamer pipeline or RTSP URL
        cap_.open(cfg_.source, cv::CAP_GSTREAMER);
        if (!cap_.isOpened())
            cap_.open(cfg_.source); // fallback to default backend
    }

    if (!cap_.isOpened())
    {
        std::cerr << "[Camera] ERROR: Cannot open source: " << cfg_.source << "\n";
        return false;
    }

    cap_.set(cv::CAP_PROP_FRAME_WIDTH,  cfg_.width);
    cap_.set(cv::CAP_PROP_FRAME_HEIGHT, cfg_.height);
    cap_.set(cv::CAP_PROP_FPS,          cfg_.fps);

    // Read back actual resolution negotiated by the driver
    cfg_.width  = static_cast<int>(cap_.get(cv::CAP_PROP_FRAME_WIDTH));
    cfg_.height = static_cast<int>(cap_.get(cv::CAP_PROP_FRAME_HEIGHT));

    std::cout << "[Camera] Opened: " << cfg_.width << "x" << cfg_.height << "\n";
    return true;
}

void CameraCapture::release_camera()
{
    if (cap_.isOpened())
        cap_.release();
}

void CameraCapture::capture_loop()
{
    cv::Mat frame;
    std::vector<int> enc_params = { cv::IMWRITE_JPEG_QUALITY, cfg_.quality };

    while (running_)
    {
        if (!cap_.isOpened())
        {
            std::cerr << "[Camera] Disconnected – retrying in "
                      << cfg_.reconnect_delay << "s\n";
            std::this_thread::sleep_for(
                std::chrono::duration<double>(cfg_.reconnect_delay));
            open_camera();
            continue;
        }

        if (!cap_.read(frame) || frame.empty())
        {
            std::cerr << "[Camera] Frame read failed – reconnecting…\n";
            release_camera();
            std::this_thread::sleep_for(
                std::chrono::duration<double>(cfg_.reconnect_delay));
            open_camera();
            continue;
        }

        if (cfg_.overlay)
            draw_overlay(frame);

        // Encode to JPEG into back-buffer
        cv::imencode(".jpg", frame, back_, enc_params);

        // Swap buffers so readers always see a complete frame
        {
            std::lock_guard<std::mutex> lock(buf_mutex_);
            std::swap(front_, back_);
        }

        ++frame_count_;

        {
            std::lock_guard<std::mutex> lock(time_mutex_);
            last_frame_time_ = std::chrono::steady_clock::now();
        }
    }
}

void CameraCapture::draw_overlay(cv::Mat& frame)
{
    // Timestamp
    std::time_t t = std::time(nullptr);
    char ts[64];
    std::strftime(ts, sizeof(ts), "%Y-%m-%d  %H:%M:%S", std::localtime(&t));

    // Frame counter
    std::ostringstream fc;
    fc << "Frame: " << frame_count_.load();

    const std::string lines[] = { ts, fc.str() };
    const int pad   = 6;
    const int line_h = 18;
    const int ov_w  = 220;
    const int ov_h  = 2 * line_h + pad * 2;

    double scale = 0.45 * (frame.cols / 640.0);
    int    thick = 1;

    // Semi-transparent dark background
    cv::Mat roi = frame(cv::Rect(0, 0, ov_w, ov_h));
    cv::Mat dark = cv::Mat::zeros(roi.size(), roi.type());
    cv::addWeighted(dark, 0.5, roi, 0.5, 0, roi);

    for (int i = 0; i < 2; ++i)
    {
        int y = pad + (i + 1) * line_h;
        cv::putText(frame, lines[i], { pad, y },
                    cv::FONT_HERSHEY_SIMPLEX, scale,
                    { 0, 255, 0 }, thick, cv::LINE_AA);
    }
}