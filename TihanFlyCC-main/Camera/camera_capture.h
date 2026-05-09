#pragma once

#include <opencv2/opencv.hpp>
#include <atomic>
#include <mutex>
#include <thread>
#include <string>
#include <vector>
#include <chrono>

// ────────────────────────────────────────────────────────────────────────────
//  CameraCapture
//  Continuously grabs frames from a V4L2 / USB / CSI / GStreamer source.
//  Frames are stored in a double-buffer; callers use read_frame() to get
//  the latest JPEG-encoded bytes ready for MJPEG streaming.
// ────────────────────────────────────────────────────────────────────────────
class CameraCapture
{
public:
    struct Config
    {
        // Camera source: device index (0,1,…) or GStreamer/RTSP pipeline string
        std::string source   = "0";
        int         width    = 1280;
        int         height   = 720;
        int         fps      = 30;
        int         quality  = 80;   // JPEG quality 1–100
        bool        overlay  = true; // draw HUD overlay on each frame
        double      reconnect_delay = 3.0; // seconds before retrying a dead camera
    };

    // GCC bug 88165: cannot use Config{} as a default argument inside the same
    // class that defines Config with default member initializers.
    // Workaround: explicit no-arg overload delegates to the Config constructor.
    CameraCapture();
    explicit CameraCapture(const Config& cfg);
    ~CameraCapture();

    // Open the camera and start the capture thread
    bool start();

    // Stop the capture thread and close the device
    void stop();

    // Return the latest frame encoded as JPEG bytes.
    // Returns an empty vector if no frame is available yet.
    std::vector<uint8_t> read_frame();

    // True if the camera is open and has delivered a frame recently
    bool is_active() const;

    uint64_t frame_count() const { return frame_count_; }

    const Config& config() const { return cfg_; }

private:
    void capture_loop();
    void draw_overlay(cv::Mat& frame);
    bool open_camera();
    void release_camera();

    Config      cfg_;
    cv::VideoCapture cap_;

    // Double-buffer: capture thread writes to back_, read_frame() swaps
    std::vector<uint8_t> front_;
    std::vector<uint8_t> back_;
    mutable std::mutex   buf_mutex_;

    std::thread          thread_;
    std::atomic<bool>    running_{ false };
    std::atomic<uint64_t> frame_count_{ 0 };
    std::chrono::steady_clock::time_point last_frame_time_;
    mutable std::mutex   time_mutex_;
};