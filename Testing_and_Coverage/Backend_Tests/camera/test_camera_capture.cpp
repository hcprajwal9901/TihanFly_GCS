#include <gtest/gtest.h>
#include "Camera/camera_capture.h"

class CameraCaptureTest : public ::testing::Test {
protected:
    void SetUp() override {
    }

    void TearDown() override {
    }
};

// Test initialization with default config
TEST_F(CameraCaptureTest, DefaultInitialization) {
    CameraCapture capture;
    const auto& config = capture.config();
    EXPECT_EQ(config.source, "0");
    EXPECT_EQ(config.width, 1280);
    EXPECT_EQ(config.height, 720);
    EXPECT_EQ(config.fps, 30);
    EXPECT_EQ(config.quality, 80);
    EXPECT_TRUE(config.overlay);
    EXPECT_FALSE(capture.is_active());
    EXPECT_EQ(capture.frame_count(), 0);
}

// Test initialization with custom config
TEST_F(CameraCaptureTest, CustomInitialization) {
    CameraCapture::Config config;
    config.source = "dummy_invalid_source";
    config.width = 640;
    config.height = 480;
    config.fps = 15;
    config.quality = 50;
    config.overlay = false;

    CameraCapture capture(config);
    const auto& actual_config = capture.config();
    
    EXPECT_EQ(actual_config.source, "dummy_invalid_source");
    EXPECT_EQ(actual_config.width, 640);
    EXPECT_EQ(actual_config.height, 480);
    EXPECT_EQ(actual_config.fps, 15);
    EXPECT_EQ(actual_config.quality, 50);
    EXPECT_FALSE(actual_config.overlay);
    EXPECT_FALSE(capture.is_active());
    EXPECT_EQ(capture.frame_count(), 0);
}

// Test start with invalid source
TEST_F(CameraCaptureTest, StartInvalidSource) {
    CameraCapture::Config config;
    config.source = "invalid_path_that_does_not_exist";
    CameraCapture capture(config);

    // It should try to start but fail to open camera, returning false
    bool started = capture.start();
    EXPECT_FALSE(started);
    EXPECT_FALSE(capture.is_active());
}

// Test read_frame on an inactive camera returns empty
TEST_F(CameraCaptureTest, ReadFrameInactive) {
    CameraCapture capture;
    auto frame = capture.read_frame();
    EXPECT_TRUE(frame.empty());
}

// Test capture loop with a dummy image sequence
TEST_F(CameraCaptureTest, StartDummyImage) {
    // Generate a dummy image first
    system("python3 -c \"import cv2; import numpy as np; img = np.zeros((720, 1280, 3), dtype=np.uint8); cv2.imwrite('dummy.jpg', img)\"");

    CameraCapture::Config config;
    config.source = "dummy.jpg"; // OpenCV can open images as video source
    config.reconnect_delay = 0.1; // Fast reconnect for testing
    config.fps = 10;
    
    CameraCapture capture(config);
    
    // Start should succeed
    bool started = capture.start();
    EXPECT_TRUE(started);
    
    // Starting again should just return true and print "Already running"
    EXPECT_TRUE(capture.start());
    
    // Let it run to capture at least one frame
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    
    EXPECT_TRUE(capture.is_active());
    EXPECT_GT(capture.frame_count(), 0);
    
    auto frame = capture.read_frame();
    EXPECT_FALSE(frame.empty()); // Should have a JPEG frame
    
    capture.stop();
    EXPECT_FALSE(capture.is_active());
}
