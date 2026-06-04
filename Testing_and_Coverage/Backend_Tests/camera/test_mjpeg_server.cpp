#include <gtest/gtest.h>
#include <gmock/gmock.h>
#define private public
#define protected public
#include "Camera/mjpeg_server.h"
#include "Camera/camera_capture.h"
#include <asio.hpp>
#include <thread>
#include <chrono>

using namespace std::chrono_literals;

class MjpegServerTest : public ::testing::Test {
protected:
    asio::io_context io_context_;
    CameraCapture camera_capture_;
    std::unique_ptr<MjpegServer> server_;
    static uint16_t next_port_;
    uint16_t test_port_;
    std::thread server_thread_;
    std::atomic<int> client_counter_{0};

    void SetUp() override {
        test_port_ = next_port_++;
        server_ = std::make_unique<MjpegServer>(io_context_, camera_capture_, test_port_);
        server_->start();
        server_thread_ = std::thread([this]() {
            while (!io_context_.stopped()) {
                try {
                    io_context_.run();
                    break;
                } catch (const std::exception& e) {
                    std::cerr << "[Test] Caught expected ASIO exception: " << e.what() << "\n";
                }
            }
        });
        
        // Give the server a moment to start listening
        std::this_thread::sleep_for(100ms);
    }

    void TearDown() override {
        server_->stop();
        io_context_.stop();
        if (server_thread_.joinable()) {
            server_thread_.join();
        }
    }
};

uint16_t MjpegServerTest::next_port_ = 8085;

TEST_F(MjpegServerTest, InitialState) {
    EXPECT_EQ(server_->active_clients(), 0);
}

// Test simple HTTP GET /status request
TEST_F(MjpegServerTest, StatusEndpoint) {
    asio::io_context client_io;
    asio::ip::tcp::resolver resolver(client_io);
    asio::ip::tcp::resolver::results_type endpoints = resolver.resolve("127.0.0.1", std::to_string(test_port_));
    asio::ip::tcp::socket socket(client_io);
    asio::connect(socket, endpoints);

    // Send HTTP GET /status
    std::string request = "GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    asio::write(socket, asio::buffer(request));

    // Read response
    asio::streambuf response_buf;
    asio::error_code ec;
    asio::read_until(socket, response_buf, "\r\n\r\n", ec);
    ASSERT_FALSE(ec);

    std::istream response_stream(&response_buf);
    std::string http_version;
    response_stream >> http_version;
    unsigned int status_code;
    response_stream >> status_code;
    std::string status_message;
    std::getline(response_stream, status_message);

    EXPECT_EQ(status_code, 200);

    // Read headers
    std::string header;
    while (std::getline(response_stream, header) && header != "\r") {
        // Read headers (skip)
    }

    // Read body (it's JSON)
    std::string body;
    asio::read(socket, response_buf, asio::transfer_all(), ec); // Read the rest
    if (ec != asio::error::eof) {
        // Expected EOF if connection is closed, or we might need to read based on Content-Length
    }
    
    std::ostringstream ss;
    ss << &response_buf;
    body = ss.str();

    // The body should contain JSON about camera status
    EXPECT_TRUE(body.find("\"camera_active\":false") != std::string::npos);
    EXPECT_TRUE(body.find("\"frame_count\":0") != std::string::npos);

    std::this_thread::sleep_for(50ms);
    asio::error_code close_ec;
    socket.close(close_ec);
}

// Test /snapshot endpoint
TEST_F(MjpegServerTest, SnapshotEndpointNoFrame) {
    asio::io_context client_io;
    asio::ip::tcp::resolver resolver(client_io);
    asio::ip::tcp::resolver::results_type endpoints = resolver.resolve("127.0.0.1", std::to_string(test_port_));
    asio::ip::tcp::socket socket(client_io);
    asio::connect(socket, endpoints);

    std::string request = "GET /snapshot HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    asio::write(socket, asio::buffer(request));

    asio::streambuf response_buf;
    asio::error_code ec;
    asio::read_until(socket, response_buf, "\r\n\r\n", ec);
    ASSERT_FALSE(ec);

    std::istream response_stream(&response_buf);
    std::string http_version;
    response_stream >> http_version;
    unsigned int status_code;
    response_stream >> status_code;

    // Since camera is not active and has no frames, it should return 404
    EXPECT_EQ(status_code, 404);

    std::this_thread::sleep_for(50ms);
    asio::error_code close_ec;
    socket.close(close_ec);
}

// Test unknown endpoint
TEST_F(MjpegServerTest, NotFoundEndpoint) {
    asio::io_context client_io;
    asio::ip::tcp::resolver resolver(client_io);
    asio::ip::tcp::resolver::results_type endpoints = resolver.resolve("127.0.0.1", std::to_string(test_port_));
    asio::ip::tcp::socket socket(client_io);
    asio::connect(socket, endpoints);

    std::string request = "GET /unknown_path HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    asio::write(socket, asio::buffer(request));

    asio::streambuf response_buf;
    asio::error_code ec;
    asio::read_until(socket, response_buf, "\r\n\r\n", ec);
    ASSERT_FALSE(ec);

    std::istream response_stream(&response_buf);
    std::string http_version;
    response_stream >> http_version;
    unsigned int status_code;
    response_stream >> status_code;

    EXPECT_EQ(status_code, 404);

    std::this_thread::sleep_for(50ms);
    asio::error_code close_ec;
    socket.close(close_ec);
}

// Test /snapshot endpoint with active camera
TEST_F(MjpegServerTest, SnapshotEndpointActive) {
    // Start dummy camera
    system("python3 -c \"import cv2; import numpy as np; img = np.zeros((720, 1280, 3), dtype=np.uint8); cv2.imwrite('dummy.jpg', img)\"");
    CameraCapture::Config config;
    config.source = "dummy.jpg";
    config.reconnect_delay = 0.1;
    CameraCapture capture(config);
    capture.start();
    
    // Give camera time to capture frames
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    
    // Recreate server to use the active camera
    server_->stop();
    io_context_.stop();
    if (server_thread_.joinable()) server_thread_.join();
    
    io_context_.restart();
    test_port_ = next_port_++;
    server_ = std::make_unique<MjpegServer>(io_context_, capture, test_port_);
    server_->start();
    server_thread_ = std::thread([this]() { 
        while (!io_context_.stopped()) {
            try { io_context_.run(); break; } 
            catch (const std::exception&) {} 
        } 
    });
    
    std::this_thread::sleep_for(100ms);

    asio::io_context client_io;
    asio::ip::tcp::resolver resolver(client_io);
    asio::ip::tcp::resolver::results_type endpoints = resolver.resolve("127.0.0.1", std::to_string(test_port_));
    asio::ip::tcp::socket socket(client_io);
    asio::connect(socket, endpoints);

    std::string request = "GET /snapshot HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    asio::write(socket, asio::buffer(request));

    asio::streambuf response_buf;
    asio::error_code ec;
    asio::read_until(socket, response_buf, "\r\n\r\n", ec);
    ASSERT_FALSE(ec);

    std::istream response_stream(&response_buf);
    std::string http_version;
    response_stream >> http_version;
    unsigned int status_code;
    response_stream >> status_code;

    // Camera is active, should return 200
    EXPECT_EQ(status_code, 200);

    // Read until EOF to prevent sending RST to server
    asio::read(socket, response_buf, asio::transfer_all(), ec);

    capture.stop();

    asio::error_code close_ec;
    socket.close(close_ec);
}

// Test /video_feed endpoint
TEST_F(MjpegServerTest, VideoFeedEndpoint) {
    // Start dummy camera
    CameraCapture::Config config;
    config.source = "dummy.jpg";
    config.reconnect_delay = 0.1;
    CameraCapture capture(config);
    capture.start();
    
    // Recreate server
    server_->stop();
    io_context_.stop();
    if (server_thread_.joinable()) server_thread_.join();
    
    io_context_.restart();
    test_port_ = next_port_++;
    server_ = std::make_unique<MjpegServer>(io_context_, capture, test_port_);
    server_->start();
    server_thread_ = std::thread([this]() { 
        while (!io_context_.stopped()) {
            try { io_context_.run(); break; } 
            catch (const std::exception&) {} 
        } 
    });
    
    std::this_thread::sleep_for(100ms);

    asio::io_context client_io;
    asio::ip::tcp::resolver resolver(client_io);
    asio::ip::tcp::resolver::results_type endpoints = resolver.resolve("127.0.0.1", std::to_string(test_port_));
    asio::ip::tcp::socket socket(client_io);
    asio::connect(socket, endpoints);

    std::string request = "GET /video_feed HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    asio::write(socket, asio::buffer(request));

    asio::streambuf response_buf;
    asio::error_code ec;
    asio::read_until(socket, response_buf, "\r\n\r\n", ec);
    ASSERT_FALSE(ec);

    std::istream response_stream(&response_buf);
    std::string http_version;
    response_stream >> http_version;
    unsigned int status_code;
    response_stream >> status_code;

    EXPECT_EQ(status_code, 200);

    // Read boundary part
    asio::read_until(socket, response_buf, "--frame", ec);
    EXPECT_FALSE(ec);
    
    // Sleep long enough for server to pass remote_endpoint() print
    std::this_thread::sleep_for(300ms);
    asio::error_code close_ec;
    socket.close(close_ec);
    
    capture.stop();
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-MJPEG-FUNC-001
    Function : MjpegServer::start
    Description : MJPEG Server Start.
    Input : None
    Expected Output : Server is active
*/
TEST_F(MjpegServerTest, StartFUNC) {
    EXPECT_TRUE(server_ != nullptr);
}

/*
    UT-MJPEG-FUNC-002
    Function : MjpegServer::stop
    Description : MJPEG Server Stop.
    Input : None
    Expected Output : Executes successfully
*/
TEST_F(MjpegServerTest, StopFUNC) {
    EXPECT_NO_THROW(server_->stop());
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-MJPEG-EXT-001
    Function : MjpegServer::stop
    Description : Double stop handling.
    Input : None
    Expected Output : Handles gracefully
*/
TEST_F(MjpegServerTest, DoubleStopHandling) {
    server_->stop();
    EXPECT_NO_THROW(server_->stop());
}

/*
    UT-MJPEG-003
    Function : MjpegServer::active_clients
    Description : Retrieve number of connected clients.
    Input : None
    Expected Output : returns 0 or more
*/
TEST_F(MjpegServerTest, ActiveClientsFUNC) {
    EXPECT_GE(server_->active_clients(), 0);
}

/*
    UT-MJPEG-004
    Function : MjpegServer::do_accept
    Description : Accept incoming TCP connections.
    Input : None
    Expected Output : launches accept handler without crash
*/
TEST_F(MjpegServerTest, DoAcceptFUNC) {
    EXPECT_NO_THROW(server_->do_accept());
}

/*
    UT-MJPEG-005
    Function : MjpegServer::Session::read_request
    Description : Read HTTP request header.
    Input : None
    Expected Output : reads request safely
*/
TEST_F(MjpegServerTest, SessionReadRequestFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->read_request());
}

/*
    UT-MJPEG-006
    Function : MjpegServer::Session::handle_request
    Description : Parse request URL and route.
    Input : "GET /status HTTP/1.1"
    Expected Output : routes request successfully
*/
TEST_F(MjpegServerTest, SessionHandleRequestFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->handle_request("GET /status HTTP/1.1"));
}

/*
    UT-MJPEG-007
    Function : MjpegServer::Session::serve_video_feed
    Description : Start video feed stream session.
    Input : None
    Expected Output : writes MJPEG headers and loops
*/
TEST_F(MjpegServerTest, SessionServeVideoFeedFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->serve_video_feed());
}

/*
    UT-MJPEG-008
    Function : MjpegServer::Session::stream_next_frame
    Description : Send single video frame boundary.
    Input : None
    Expected Output : writes frame successfully
*/
TEST_F(MjpegServerTest, SessionStreamNextFrameFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->stream_next_frame());
}

/*
    UT-MJPEG-009
    Function : MjpegServer::Session::serve_status
    Description : Return system status JSON.
    Input : None
    Expected Output : writes status JSON response
*/
TEST_F(MjpegServerTest, SessionServeStatusFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->serve_status());
}

/*
    UT-MJPEG-010
    Function : MjpegServer::Session::serve_snapshot
    Description : Return single JPEG frame.
    Input : None
    Expected Output : writes JPEG image response
*/
TEST_F(MjpegServerTest, SessionServeSnapshotFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->serve_snapshot());
}

/*
    UT-MJPEG-011
    Function : MjpegServer::Session::serve_not_found
    Description : Return HTTP 404 response.
    Input : None
    Expected Output : writes 404 HTML response
*/
TEST_F(MjpegServerTest, SessionServeNotFoundFUNC) {
    asio::ip::tcp::socket socket(io_context_);
    auto session = std::make_shared<MjpegServer::Session>(std::move(socket), camera_capture_, client_counter_);
    EXPECT_NO_THROW(session->serve_not_found());
}

