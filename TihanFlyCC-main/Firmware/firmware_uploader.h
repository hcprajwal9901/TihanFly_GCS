#pragma once

/**
 * firmware_uploader.h
 * TiHANFly GCS — PX4 / Pixhawk STM32 Bootloader Upload Protocol
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Implements the same wire protocol used by Mission Planner, QGC, and
 * ArduPilot's uploader.py to flash firmware over a serial port.
 *
 * Protocol reference
 * ──────────────────
 *   PX4 Bootloader  github.com/PX4/Bootloader (doc/protocol.md)
 *   ArduPilot       Tools/scripts/uploader.py  (ground-truth reference)
 *
 * Flash sequence
 * ──────────────
 *   1. open_port()        — open serial at boot_baud (typically 115 200)
 *   2. enter_bootloader() — send GET_SYNC × N with DTR toggling.
 *                           Returns false if no bootloader found.
 *   3. get_device_info()  — query BL_REV, BOARD_ID, BOARD_REV, FLASH_SIZE.
 *                           Response order: 4-byte value FIRST, then INSYNC+OK.
 *   4. (caller validates board_id / image size)
 *   5. erase_chip()       — CHIP_ERASE; up to ~20 s; fires erase_progress_cb_
 *   6. program()          — PROG_MULTI in 252-byte chunks; fires write_progress_cb_
 *   7. verify_crc()       — GET_CRC; compare with locally computed CRC.
 *                           CRC algorithm: initial state=0, no final XOR (matches
 *                           uploader.py exactly).  Padding: 4 bytes of 0xFF per
 *                           iteration, looping from image.size() to flash_size-1.
 *   8. reboot()           — REBOOT; best-effort ACK read; flight controller starts
 *                           new firmware.
 *
 * Threading
 * ─────────
 *   All operations block the calling thread.  Call flash() from a
 *   dedicated std::thread — NEVER from the main ASIO event-loop thread.
 *
 * Abort
 * ─────
 *   Call abort() from any thread.  The flag is checked between each
 *   PROG_MULTI chunk so cancellation is near-immediate.
 */

#include <asio.hpp>
#include <cstdint>
#include <string>
#include <vector>
#include <functional>
#include <optional>
#include <atomic>
#include <chrono>

class FirmwareUploader
{
public:
    using ProgressCb = std::function<void(float /*0.0 – 1.0*/)>;
    using LogCb      = std::function<void(const std::string&)>;

    FirmwareUploader();
    ~FirmwareUploader();

    // ── Callbacks — set before calling flash() ───────────────────────────
    void set_log_callback   (LogCb      cb) { log_cb_            = std::move(cb); }
    void set_erase_progress (ProgressCb cb) { erase_progress_cb_ = std::move(cb); }
    void set_write_progress (ProgressCb cb) { write_progress_cb_ = std::move(cb); }

    /**
     * flash()
     * ───────
     * Opens the serial port, negotiates with the bootloader, erases flash,
     * writes the firmware image, verifies the CRC, and reboots.
     *
     * @param port              Path to serial device ("/dev/ttyACM0", "COM3")
     * @param boot_baud         Baud for bootloader negotiation (115200)
     * @param firmware_image    Raw binary firmware bytes (decoded from .apj)
     * @param expected_board_id Board-ID declared in the APJ file (0 = skip check)
     * @return true on success
     */
    bool flash(const std::string&          port,
               int                         boot_baud,
               const std::vector<uint8_t>& firmware_image,
               uint32_t                    expected_board_id = 0);

    /** Thread-safe cancel — checked between PROG_MULTI chunks. */
    void abort() { abort_.store(true); }
    bool is_aborted() const { return abort_.load(); }

private:
    // ── PX4 bootloader protocol constants ────────────────────────────────
    static constexpr uint8_t PROTO_EOC         = 0x20;
    static constexpr uint8_t PROTO_OK          = 0x10;
    static constexpr uint8_t PROTO_FAILED      = 0x11;
    static constexpr uint8_t PROTO_INSYNC      = 0x12;
    static constexpr uint8_t PROTO_INVALID     = 0x13;

    static constexpr uint8_t PROTO_GET_SYNC    = 0x21;
    static constexpr uint8_t PROTO_GET_DEVICE  = 0x22;
    static constexpr uint8_t PROTO_CHIP_ERASE  = 0x23;
    static constexpr uint8_t PROTO_PROG_MULTI  = 0x27;
    static constexpr uint8_t PROTO_GET_CRC     = 0x29;
    static constexpr uint8_t PROTO_REBOOT      = 0x30;

    // GET_DEVICE sub-parameters
    // ── Source of truth: ArduPilot Tools/scripts/uploader.py ──────────────
    static constexpr uint8_t INFO_BL_REV       = 0x01;  // bootloader revision
    static constexpr uint8_t INFO_BOARD_ID     = 0x02;  // board type
    static constexpr uint8_t INFO_BOARD_REV    = 0x03;  // board revision
    static constexpr uint8_t INFO_FLASH_SIZE   = 0x04;  // max firmware size in bytes
    // 0x05 is undefined — bootloader returns INSYNC+INVALID, causing timeout.
    static constexpr uint8_t INFO_EXTF_SIZE    = 0x06;  // external flash (unused here)

    // Protocol limits / timeouts
    static constexpr int     MAX_PROG_BYTES    = 252;   // max payload per PROG_MULTI
    static constexpr int     SYNC_RETRIES      = 12;
    static constexpr int     SYNC_TIMEOUT_MS   = 600;
    static constexpr int     ERASE_TIMEOUT_MS  = 20000; // erase can take up to 20 s
    static constexpr int     WRITE_TIMEOUT_MS  = 3000;
    static constexpr int     INFO_TIMEOUT_MS   = 1000;
    static constexpr int     REBOOT_TIMEOUT_MS = 500;

    // ── ASIO serial I/O helpers ───────────────────────────────────────────
    bool                   open_port(const std::string& port, int baud);
    void                   close_port();
    bool                   write_bytes(const uint8_t* data, size_t len);
    std::optional<uint8_t> read_byte(int timeout_ms);
    bool                   read_exact(uint8_t* buf, size_t len, int timeout_ms);
    void                   drain(int window_ms = 50, int max_total_ms = 2000);

    // ── Protocol helpers ──────────────────────────────────────────────────
    bool     get_sync(int timeout_ms = SYNC_TIMEOUT_MS);
    bool     enter_bootloader();
    bool     get_device_info(uint32_t& bl_rev,
                              uint32_t& board_id,
                              uint32_t& board_rev,
                              uint32_t& flash_size);

    /**
     * get_info_word()
     * ───────────────
     * Sends GET_DEVICE + param + EOC, then reads:
     *   1. 4-byte little-endian value  (matches Python __recv_int())
     *   2. INSYNC + OK                 (matches Python __getSync())
     *
     * WARNING: the response order is value-FIRST, sync-SECOND.
     * This is the opposite of what was previously implemented.
     */
    bool     get_info_word(uint8_t param, uint32_t& out, int timeout_ms);

    bool     erase_chip();
    bool     program(const std::vector<uint8_t>& image);
    bool     verify_crc(const std::vector<uint8_t>& image, uint32_t flash_size);
    bool     reboot();

    // ── CRC32 matching uploader.py exactly ───────────────────────────────
    //
    // Algorithm: ISO 3309 / PKZIP polynomial 0xEDB88320
    // Initial state: 0  (NOT 0xFFFFFFFF)
    // Final step:    none  (NOT ~crc)
    //
    // Padding: 4 bytes of 0xFF per iteration, looping from image.size()
    //          to (flash_size - 1), stepping 4 — identical to Python:
    //            for i in range(len(image), (padlen-1), 4):
    //                state = crc32(crcpad, state)
    static void     build_crc_table();
    static uint32_t crc32_accumulate(uint32_t crc,
                                     const uint8_t* data, size_t len);
    static uint32_t compute_padded_crc(const std::vector<uint8_t>& image,
                                        uint32_t padded_size);

    void log(const std::string& msg);

    // ── Members ───────────────────────────────────────────────────────────
    asio::io_context  io_ctx_;
    asio::serial_port port_;
    std::atomic<bool> abort_{false};

    LogCb      log_cb_;
    ProgressCb erase_progress_cb_;
    ProgressCb write_progress_cb_;

    static uint32_t crc_table_[256];
    static bool     crc_table_ready_;
};