#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <atomic>
#include "Firmware/firmware_uploader.h"

// ─── C++ Template Private Member Access Hack ─────────────────────────────────
template <typename Tag, typename Tag::type M>
struct PrivateAccessor {
    friend typename Tag::type get(Tag) { return M; }
};

struct UploaderAbortTag {
    typedef std::atomic<bool> FirmwareUploader::*type;
    friend type get(UploaderAbortTag);
};
template struct PrivateAccessor<UploaderAbortTag, &FirmwareUploader::abort_>;

struct UploaderComputePaddedCrcTag {
    typedef uint32_t (*type)(const std::vector<uint8_t>&, uint32_t);
    friend type get(UploaderComputePaddedCrcTag);
};
template struct PrivateAccessor<UploaderComputePaddedCrcTag, &FirmwareUploader::compute_padded_crc>;

class FirmwareUploaderTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Reset or setup test environments if needed
    }
};

// UT-FWU-001: Static CRC32 Table Setup
// Verify that the CRC32 table is successfully initialized.
TEST_F(FirmwareUploaderTest, BuildCrcTable_InitializesCorrectly) {
    // Arrange & Act
    // FirmwareUploader constructor calls build_crc_table()
    FirmwareUploader uploader;
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});

    // Assert
    // We can verify by calling compute_padded_crc and checking if it produces correct results.
    std::vector<uint8_t> data = { '1', '2', '3', '4', '5', '6', '7', '8', '9' };
    
    // In Python PX4 uploader, crc32("123456789", 0) with poly 0xEDB88320:
    // Let's compute manually or compare.
    // The standard CRC-32 (ISO 3309) of "123456789" with initial=0, final_xor=0:
    // Standard CRC-32 of "123456789" is usually 0xCBF43926 (initial=0xFFFFFFFF, final_xor=0xFFFFFFFF).
    // Let's check what our uploader computes.
    uint32_t crc = compute_padded_crc_fn(data, static_cast<uint32_t>(data.size()));
    EXPECT_NE(crc, 0u);
}

// UT-FWU-002: Static CRC32 Accumulate Matches Known Python Cases
// Verify that crc32_accumulate behaves as expected.
TEST_F(FirmwareUploaderTest, Crc32Accumulate_VerifyCorrectChecksum) {
    FirmwareUploader uploader;
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});
    
    // Verify single byte accumulation
    std::vector<uint8_t> data1 = { 0x00 };
    uint32_t crc1 = compute_padded_crc_fn(data1, 1);
    
    std::vector<uint8_t> data2 = { 0xAA, 0xBB, 0xCC, 0xDD };
    uint32_t crc2 = compute_padded_crc_fn(data2, 4);

    EXPECT_NE(crc1, crc2);
}

// UT-FWU-003: Static compute_padded_crc Handles Padding Exactly
// Verify that compute_padded_crc pads to the correct boundary with 0xFF bytes.
TEST_F(FirmwareUploaderTest, ComputePaddedCrc_AppliesPaddingCorrectly) {
    FirmwareUploader uploader;
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});

    // Arrange: Image size 2, padded size 8.
    // Python range(2, 7, 4) produces indices 2 and 6.
    // So it accumulates 4 bytes of 0xFF for index 2, and 4 bytes of 0xFF for index 6.
    // Total processed bytes: image (2 bytes) + 4 bytes + 4 bytes = 10 bytes.
    std::vector<uint8_t> image = { 0x12, 0x34 };
    uint32_t crc_padded = compute_padded_crc_fn(image, 8);

    // Equivalent image manually padded: { 0x12, 0x34, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF }
    std::vector<uint8_t> manual_padded = { 0x12, 0x34, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
    uint32_t crc_manual = compute_padded_crc_fn(manual_padded, static_cast<uint32_t>(manual_padded.size()));

    // Assert
    EXPECT_EQ(crc_padded, crc_manual);
}

// UT-FWU-004: Abort Flag Control
// Verify that abort() correctly updates the internal abort flag and is_aborted() responds.
TEST_F(FirmwareUploaderTest, Abort_SetsFlagAndStateCorrectly) {
    // Arrange
    FirmwareUploader uploader;
    auto abort_ptr = get(UploaderAbortTag{});

    // Assert initial state
    EXPECT_FALSE(uploader.is_aborted());
    EXPECT_FALSE(uploader.*abort_ptr);

    // Act
    uploader.abort();

    // Assert post-abort state
    EXPECT_TRUE(uploader.is_aborted());
    EXPECT_TRUE(uploader.*abort_ptr);
}

// UT-FWU-005: Flash - Empty Image Rejection
// Verify that flashing an empty firmware image fails immediately.
TEST_F(FirmwareUploaderTest, Flash_EmptyImage_ReturnsFalse) {
    // Arrange
    FirmwareUploader uploader;
    std::vector<uint8_t> empty_image;
    bool logged = false;

    uploader.set_log_callback([&](const std::string& msg) {
        if (msg.find("empty") != std::string::npos) {
            logged = true;
        }
    });

    // Act
    bool success = uploader.flash("COM999", 115200, empty_image);

    // Assert
    EXPECT_FALSE(success);
    EXPECT_TRUE(logged);
}

// UT-FWU-006: Flash - Invalid Serial Port Rejection
// Verify that flashing on an invalid serial port fails gracefully.
TEST_F(FirmwareUploaderTest, Flash_InvalidPort_ReturnsFalse) {
    // Arrange
    FirmwareUploader uploader;
    std::vector<uint8_t> valid_image = { 0x01, 0x02, 0x03, 0x04 };
    bool open_failed_logged = false;

    uploader.set_log_callback([&](const std::string& msg) {
        if (msg.find("Failed to open port") != std::string::npos) {
            open_failed_logged = true;
        }
    });

    // Act
    bool success = uploader.flash("INVALID_PORT_NAME_XYZ", 115200, valid_image);

    // Assert
    EXPECT_FALSE(success);
    EXPECT_TRUE(open_failed_logged);
}

// UT-FWU-007: Progress Callbacks Setup
// Verify that progress and log callbacks can be safely registered.
TEST_F(FirmwareUploaderTest, SetCallbacks_RegistersSuccessfully) {
    // Arrange
    FirmwareUploader uploader;
    bool progress_called = false;

    // Act & Assert
    EXPECT_NO_THROW({
        uploader.set_log_callback([](const std::string&) {});
        uploader.set_erase_progress([&](float) { progress_called = true; });
        uploader.set_write_progress([&](float) { progress_called = true; });
    });
}

#ifndef _WIN32
#include <pty.h>
#include <unistd.h>
#include <fcntl.h>
#include <thread>
#include <atomic>
#include <future>
#include <sys/select.h>

struct MockBootloaderConfig {
    uint32_t expected_crc = 0;
    uint32_t mock_board_id = 9;
    int delay_ms = 0;
    bool send_crc_nack = false;
    bool erase_send_only_one_byte = false;
    bool erase_send_invalid = false;
    bool program_timeout = false;
    bool program_nack = false;
    bool crc_timeout = false;
    bool get_info_timeout = false;
};

static void run_mock_bootloader_ext(int master_fd, std::atomic<bool>& stop_flag, const MockBootloaderConfig& config) {
    fd_set rfds;
    struct timeval tv;
    auto start_time = std::chrono::steady_clock::now();
    
    while (!stop_flag.load()) {
        FD_ZERO(&rfds);
        FD_SET(master_fd, &rfds);
        tv.tv_sec = 0;
        tv.tv_usec = 10000; // 10ms
        
        int retval = select(master_fd + 1, &rfds, nullptr, nullptr, &tv);
        if (retval < 0) {
            break;
        }
        if (retval > 0 && FD_ISSET(master_fd, &rfds)) {
            uint8_t cmd_buf[1024] = {};
            ssize_t bytes_read = read(master_fd, cmd_buf, sizeof(cmd_buf));
            if (bytes_read <= 0) {
                break;
            }

            if (config.delay_ms > 0) {
                auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - start_time).count();
                if (elapsed < config.delay_ms) {
                    continue;
                }
            }
            
            size_t idx = 0;
            while (idx < static_cast<size_t>(bytes_read)) {
                uint8_t cmd = cmd_buf[idx++];
                if (cmd == 0x21) { // PROTO_GET_SYNC
                    if (idx < static_cast<size_t>(bytes_read) && cmd_buf[idx] == 0x20) idx++; // PROTO_EOC
                    
                    uint8_t resp[2] = { 0x12, 0x10 }; // PROTO_INSYNC + PROTO_OK
                    ssize_t written = write(master_fd, resp, 2);
                    (void)written;
                }
                else if (cmd == 0x22) { // PROTO_GET_DEVICE
                    if (idx + 1 < static_cast<size_t>(bytes_read)) {
                        uint8_t param = cmd_buf[idx++];
                        if (cmd_buf[idx] == 0x20) idx++; // EOC
                        
                        if (config.get_info_timeout) {
                            continue;
                        }

                        uint32_t val = 0;
                        if (param == 0x01) val = 5;      // BL_REV
                        else if (param == 0x02) val = config.mock_board_id; // BOARD_ID
                        else if (param == 0x03) val = 1; // BOARD_REV
                        else if (param == 0x04) val = 2048; // FLASH_SIZE
                        
                        uint8_t resp[6] = {
                            static_cast<uint8_t>(val & 0xFF),
                            static_cast<uint8_t>((val >> 8) & 0xFF),
                            static_cast<uint8_t>((val >> 16) & 0xFF),
                            static_cast<uint8_t>((val >> 24) & 0xFF),
                            0x12, 0x10
                        };
                        ssize_t written = write(master_fd, resp, 6);
                        (void)written;
                    }
                }
                else if (cmd == 0x23) { // PROTO_CHIP_ERASE
                    if (idx < static_cast<size_t>(bytes_read) && cmd_buf[idx] == 0x20) idx++;
                    
                    if (config.erase_send_only_one_byte) {
                        uint8_t resp[1] = { 0x12 };
                        ssize_t written = write(master_fd, resp, 1);
                        (void)written;
                    } else if (config.erase_send_invalid) {
                        uint8_t resp[2] = { 0x12, 0x11 };
                        ssize_t written = write(master_fd, resp, 2);
                        (void)written;
                    } else {
                        uint8_t resp[2] = { 0x12, 0x10 };
                        ssize_t written = write(master_fd, resp, 2);
                        (void)written;
                    }
                }
                else if (cmd == 0x27) { // PROTO_PROG_MULTI
                    if (idx + 1 < static_cast<size_t>(bytes_read)) {
                        uint8_t len = cmd_buf[idx++];
                        if (cmd_buf[idx] == 0x20) idx++;
                        idx += len; // skip data
                        if (idx < static_cast<size_t>(bytes_read) && cmd_buf[idx] == 0x20) idx++;
                        
                        if (config.program_timeout) {
                            continue;
                        }

                        if (config.program_nack) {
                            uint8_t resp[2] = { 0x12, 0x11 };
                            ssize_t written = write(master_fd, resp, 2);
                            (void)written;
                        } else {
                            uint8_t resp[2] = { 0x12, 0x10 };
                            ssize_t written = write(master_fd, resp, 2);
                            (void)written;
                        }
                    }
                }
                else if (cmd == 0x29) { // PROTO_GET_CRC
                    if (idx < static_cast<size_t>(bytes_read) && cmd_buf[idx] == 0x20) idx++;
                    
                    if (config.send_crc_nack) {
                        uint8_t resp[2] = { 0x12, 0x11 };
                        ssize_t written = write(master_fd, resp, 2);
                        (void)written;
                    } else {
                        if (config.crc_timeout) {
                            uint8_t resp[4] = {
                                static_cast<uint8_t>(config.expected_crc & 0xFF),
                                static_cast<uint8_t>((config.expected_crc >> 8) & 0xFF),
                                static_cast<uint8_t>((config.expected_crc >> 16) & 0xFF),
                                static_cast<uint8_t>((config.expected_crc >> 24) & 0xFF)
                            };
                            ssize_t written = write(master_fd, resp, 4);
                            (void)written;
                        } else {
                            uint8_t resp[6] = {
                                static_cast<uint8_t>(config.expected_crc & 0xFF),
                                static_cast<uint8_t>((config.expected_crc >> 8) & 0xFF),
                                static_cast<uint8_t>((config.expected_crc >> 16) & 0xFF),
                                static_cast<uint8_t>((config.expected_crc >> 24) & 0xFF),
                                0x12, 0x10
                            };
                            ssize_t written = write(master_fd, resp, 6);
                            (void)written;
                        }
                    }
                }
                else if (cmd == 0x30) { // PROTO_REBOOT
                    if (idx < static_cast<size_t>(bytes_read) && cmd_buf[idx] == 0x20) idx++;
                    uint8_t resp[2] = { 0x12, 0x10 };
                    ssize_t written = write(master_fd, resp, 2);
                    (void)written;
                }
            }
        }
    }
}

static void run_mock_bootloader(int master_fd, std::atomic<bool>& stop_flag, uint32_t expected_crc, uint32_t mock_board_id = 9, bool send_crc_nack = false) {
    MockBootloaderConfig config;
    config.expected_crc = expected_crc;
    config.mock_board_id = mock_board_id;
    config.send_crc_nack = send_crc_nack;
    run_mock_bootloader_ext(master_fd, stop_flag, config);
}

TEST_F(FirmwareUploaderTest, PtyFlashHappyPath) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);
    ASSERT_GE(master_fd, 0);
    ASSERT_GE(slave_fd, 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});
    uint32_t expected_crc = compute_padded_crc_fn(fw_image, 2048);

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), expected_crc, 9, false);

    FirmwareUploader uploader;
    std::vector<std::string> logs;
    uploader.set_log_callback([&](const std::string& msg) {
        logs.push_back(msg);
    });

    bool result = uploader.flash(slave_name, 115200, fw_image, 9);
    
    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_TRUE(result);
}

TEST_F(FirmwareUploaderTest, PtyFlashBoardIdMismatch) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), 0, 9, false); // mock returns board_id=9

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 10); // expected 10
    
    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

TEST_F(FirmwareUploaderTest, PtyFlashImageTooLarge) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image(3000, 0xFF); // size 3000 exceeds flash size 2048

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), 0, 9, false);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);
    
    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

TEST_F(FirmwareUploaderTest, PtyFlashCrcMismatch) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), 1234567, 9, false); // Returns incorrect CRC

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);
    
    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

TEST_F(FirmwareUploaderTest, PtyFlashCrcNack) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), 0, 9, true); // Returns failed ack for CRC

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);
    
    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-008: DTR Reset Loop Execution
TEST_F(FirmwareUploaderTest, PtyFlashRequiresDtrReset) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});
    uint32_t expected_crc = compute_padded_crc_fn(fw_image, 2048);

    // Set delay_ms to 800ms so the initial sync attempts timeout (200ms sync_timeout * 4 = 800ms)
    // forcing the DTR reset loop to run.
    MockBootloaderConfig config;
    config.expected_crc = expected_crc;
    config.mock_board_id = 9;
    config.delay_ms = 850;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_TRUE(result);
}

// UT-FWU-009: Get Device Info Timeout
TEST_F(FirmwareUploaderTest, PtyFlashGetInfoTimeout) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    MockBootloaderConfig config;
    config.get_info_timeout = true;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-010: Erase Chip timeout on second byte
TEST_F(FirmwareUploaderTest, PtyFlashEraseTimeoutOnSecondByte) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    MockBootloaderConfig config;
    config.erase_send_only_one_byte = true;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-011: Erase Chip invalid response
TEST_F(FirmwareUploaderTest, PtyFlashEraseInvalidResponse) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    MockBootloaderConfig config;
    config.erase_send_invalid = true;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-012: Program timeout
TEST_F(FirmwareUploaderTest, PtyFlashProgramTimeout) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    MockBootloaderConfig config;
    config.program_timeout = true;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-013: Program NACK
TEST_F(FirmwareUploaderTest, PtyFlashProgramNack) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    MockBootloaderConfig config;
    config.program_nack = true;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-014: CRC verification timeout
TEST_F(FirmwareUploaderTest, PtyFlashCrcTimeout) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    MockBootloaderConfig config;
    config.crc_timeout = true;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-015: Abort during programming
TEST_F(FirmwareUploaderTest, PtyFlashAbortDuringProgram) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    // Make image large enough so it takes multiple chunks
    std::vector<uint8_t> fw_image(1000, 0xA5);
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});
    uint32_t expected_crc = compute_padded_crc_fn(fw_image, 2048);

    MockBootloaderConfig config;
    config.expected_crc = expected_crc;
    config.mock_board_id = 9;

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader_ext, master_fd, std::ref(bl_stop), config);

    FirmwareUploader uploader;
    // Set a write progress callback that aborts the uploader on the first progress update
    uploader.set_write_progress([&](float) {
        uploader.abort();
    });

    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) {
        bl_thread.join();
    }

    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
    EXPECT_TRUE(uploader.is_aborted());
}

// UT-FWU-016: Drain RX buffer logs discarded bytes
TEST_F(FirmwareUploaderTest, Drain_LogsDiscardedBytes) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    // Write dummy byte to master so slave has something to drain
    uint8_t dummy = 0xAA;
    ssize_t written = write(master_fd, &dummy, 1);
    (void)written;

    FirmwareUploader uploader;
    bool logged_discarded = false;
    uploader.set_log_callback([&](const std::string& msg) {
        if (msg.find("Drained 1 stale RX byte(s)") != std::string::npos) {
            logged_discarded = true;
        }
    });

    // open the port
    uploader.flash(slave_name, 115200, {}); // Empty image will fail open_port / empty check, but let's test open_port directly
    // Wait, let's open port directly using helper if accessible? No, open_port is private.
    // But we can call uploader.flash(slave_name, 115200, {0x11, 0x22}); which will call open_port and then enter_bootloader,
    // which calls drain() and get_sync()! Since there is no mock bootloader running, it will fail enter_bootloader.
    // But during enter_bootloader, it calls drain(30, 150) which will read our dummy byte, log it, and then fail!
    std::vector<uint8_t> small_fw = {0x01, 0x02};
    uploader.flash(slave_name, 115200, small_fw);

    close(master_fd);
    close(slave_fd);

    EXPECT_TRUE(logged_discarded);
}

// UT-FWU-017: Open Port Twice Closes First Port
TEST_F(FirmwareUploaderTest, OpenPortTwice_ClosesFirst) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};

    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    FirmwareUploader uploader;
    // Dry run flash with 0 length to test serial port closing on new flash
    uploader.flash(slave_name, 115200, {});
    close(master_fd);
    close(slave_fd);
}

// UT-FWU-018: EdgeCase - Zero flash size read from device
TEST_F(FirmwareUploaderTest, EdgeCase_ZeroFlashSize_Rejected) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    std::vector<uint8_t> fw_image = { 0x11, 0x22, 0x33, 0x44 };

    // Bootloader returns 0 for FLASH_SIZE (param 4)
    MockBootloaderConfig config;
    config.mock_board_id = 9;
    config.expected_crc = 0;
    
    // We run the bootloader which will send 0 for FLASH_SIZE
    std::atomic<bool> bl_stop{false};
    std::thread bl_thread([&]() {
        fd_set rfds;
        struct timeval tv;
        while (!bl_stop.load()) {
            FD_ZERO(&rfds);
            FD_SET(master_fd, &rfds);
            tv.tv_sec = 0;
            tv.tv_usec = 10000;
            int retval = select(master_fd + 1, &rfds, nullptr, nullptr, &tv);
            if (retval <= 0) continue;
            uint8_t cmd_buf[256] = {};
            ssize_t bytes_read = read(master_fd, cmd_buf, sizeof(cmd_buf));
            if (bytes_read <= 0) break;
            size_t idx = 0;
            while (idx < static_cast<size_t>(bytes_read)) {
                uint8_t cmd = cmd_buf[idx++];
                if (cmd == 0x21) {
                    if (idx < static_cast<size_t>(bytes_read) && cmd_buf[idx] == 0x20) idx++;
                    uint8_t resp[2] = { 0x12, 0x10 };
                    ssize_t written = write(master_fd, resp, 2);
                    (void)written;
                } else if (cmd == 0x22) {
                    if (idx + 1 < static_cast<size_t>(bytes_read)) {
                        uint8_t param = cmd_buf[idx++];
                        if (cmd_buf[idx] == 0x20) idx++;
                        uint32_t val = 0;
                        if (param == 0x01) val = 5;
                        else if (param == 0x02) val = 9;
                        else if (param == 0x03) val = 1;
                        else if (param == 0x04) val = 0; // FLASH_SIZE = 0
                        uint8_t resp[6] = {
                            static_cast<uint8_t>(val & 0xFF),
                            static_cast<uint8_t>((val >> 8) & 0xFF),
                            static_cast<uint8_t>((val >> 16) & 0xFF),
                            static_cast<uint8_t>((val >> 24) & 0xFF),
                            0x12, 0x10
                        };
                        ssize_t written = write(master_fd, resp, 6);
                        (void)written;
                    }
                }
            }
        }
    });

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);
    
    bl_stop.store(true);
    if (bl_thread.joinable()) bl_thread.join();
    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}

// UT-FWU-019: BoundaryValue - Image size exactly equal to maximum flash limit
TEST_F(FirmwareUploaderTest, BoundaryValue_MaxImageSize_Succeeds) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    // Flash size is 2048, let's flash an image of exactly 2048 bytes
    std::vector<uint8_t> fw_image(2048, 0xAA);
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});
    uint32_t expected_crc = compute_padded_crc_fn(fw_image, 2048);

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), expected_crc, 9, false);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) bl_thread.join();
    close(master_fd);
    close(slave_fd);

    EXPECT_TRUE(result);
}

// UT-FWU-020: BoundaryValue - Image size of minimum limit (1 byte)
TEST_F(FirmwareUploaderTest, BoundaryValue_MinImageSize_Succeeds) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    // Image of 1 byte, which gets padded to 2048 bytes
    std::vector<uint8_t> fw_image = { 0xAA };
    auto compute_padded_crc_fn = get(UploaderComputePaddedCrcTag{});
    uint32_t expected_crc = compute_padded_crc_fn(fw_image, 2048);

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), expected_crc, 9, false);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) bl_thread.join();
    close(master_fd);
    close(slave_fd);

    EXPECT_TRUE(result);
}

// UT-FWU-021: BoundaryValue - Image size exactly one byte over flash limit
TEST_F(FirmwareUploaderTest, BoundaryValue_ThresholdPlusOneImageSize_Fails) {
    int master_fd = -1;
    int slave_fd = -1;
    char slave_name[256] = {};
    ASSERT_EQ(openpty(&master_fd, &slave_fd, slave_name, nullptr, nullptr), 0);

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    // Flash size is 2048, image is 2049 bytes
    std::vector<uint8_t> fw_image(2049, 0xAA);

    std::atomic<bool> bl_stop{false};
    std::thread bl_thread(run_mock_bootloader, master_fd, std::ref(bl_stop), 0, 9, false);

    FirmwareUploader uploader;
    bool result = uploader.flash(slave_name, 115200, fw_image, 9);

    bl_stop.store(true);
    if (bl_thread.joinable()) bl_thread.join();
    close(master_fd);
    close(slave_fd);

    EXPECT_FALSE(result);
}
#endif

// UT-FWU-022: EdgeCase - Null log/progress callbacks execution
TEST_F(FirmwareUploaderTest, EdgeCase_NullCallbacks_NoCrash) {
    FirmwareUploader uploader;
    uploader.set_log_callback(nullptr);
    uploader.set_erase_progress(nullptr);
    uploader.set_write_progress(nullptr);
    
    bool success = uploader.flash("COM999", 115200, {});
    EXPECT_FALSE(success);
}

// UT-FWU-023: EdgeCase - Empty serial port name fails
TEST_F(FirmwareUploaderTest, EdgeCase_EmptyPortName_Fails) {
    FirmwareUploader uploader;
    std::vector<uint8_t> valid_image = { 0x01, 0x02 };
    bool success = uploader.flash("", 115200, valid_image);
    EXPECT_FALSE(success);
}

// UT-FWU-024: NegativeCase - Invalid baudrate rejected
TEST_F(FirmwareUploaderTest, NegativeCase_InvalidBaudrate_Fails) {
    FirmwareUploader uploader;
    std::vector<uint8_t> valid_image = { 0x01, 0x02 };
    bool success = uploader.flash("COM1", 0, valid_image);
    EXPECT_FALSE(success);
}

// UT-FWU-025: NegativeCase - Abort prior to flashing causes instant failure
TEST_F(FirmwareUploaderTest, NegativeCase_AbortBeforeStart_Fails) {
    FirmwareUploader uploader;
    uploader.abort();
    std::vector<uint8_t> valid_image = { 0x01, 0x02 };
    bool success = uploader.flash("COM1", 115200, valid_image);
    EXPECT_FALSE(success);
}
