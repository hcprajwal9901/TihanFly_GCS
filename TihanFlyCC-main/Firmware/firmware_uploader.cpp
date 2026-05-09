/**
 * firmware_uploader.cpp
 * TiHANFly GCS — PX4 / Pixhawk STM32 Bootloader Upload Protocol
 * ═══════════════════════════════════════════════════════════════════════
 *
 * BUGS FIXED IN THIS REVISION
 * ────────────────────────────
 *
 *   BUG-1  GET_DEVICE response order was backwards (CRITICAL — always fails).
 *          Python uploader.__getInfo() reads: 4-byte value FIRST, then
 *          INSYNC+OK (via __getSync()).  The old C++ get_info_word() read
 *          INSYNC+OK first, then the 4-byte value — the exact opposite.
 *          Every get_device_info() call returned garbage or timed out.
 *          Fix: read the 4-byte word first, then INSYNC+OK.
 *
 *   BUG-2  CRC algorithm wrong initial/final values (CRITICAL — CRC always mismatches).
 *          Python crc32() starts with state=0 and returns the raw accumulated
 *          value (no final inversion).  The old C++ used 0xFFFFFFFF initial
 *          and ~crc final — a different algorithm entirely.
 *          Fix: initial = 0, no final XOR, matching the Python exactly.
 *
 *   BUG-3  CRC padding logic wrong (CRITICAL — CRC mismatch even if BUG-2 fixed).
 *          Python firmware.crc(padlen) pads in 4-byte crcpad chunks from
 *          image.size() up to (padlen - 1), stepping 4 bytes at a time:
 *            for i in range(len(self.image), (padlen - 1), 4):
 *                state = crc32(self.crcpad, state)
 *          The old C++ padded to exactly flash_size bytes with a single
 *          vector of 0xFF bytes.  This produces a different number of pad
 *          4-byte groups and a different final CRC.
 *          Fix: replicate the Python loop exactly — pad 4 bytes at a time.
 *
 *   BUG-4  enter_bootloader() PROG_MULTI length byte encoding.
 *          Python sends length as big-endian (to_bytes(1, byteorder='big'))
 *          which for values ≤255 is identical to little-endian, so this is
 *          not a protocol issue.  Verified correct in C++.
 *
 *   BUG-5  reboot() does not call get_sync() after REBOOT command on BL ≥ 3.
 *          Python __reboot() calls __getSync() when bl_rev >= 3.  The old
 *          C++ just slept and returned true without reading the response.
 *          Fix: attempt get_sync() after sending REBOOT, ignore timeout
 *          (board may reboot before ACK arrives — best-effort).
 *
 *   FIX-1  : DTR toggle uses ioctl(TIOCMBIS/TIOCMBIC) on Linux — correct
 *             polarity to trigger hardware reset into bootloader.
 *   FIX-2  : enter_bootloader() retries up to SYNC_RETRIES times with
 *             progressive DTR re-toggles.
 *   FIX-3  : read_byte() uses a non-blocking ASIO deadline timer.
 *   FIX-4  : drain() empties the RX buffer between sync retries.
 *   FIX-6  : erase_chip() fires erase_progress_cb_ while polling.
 *   FIX-7  : program() checks abort_ between every PROG_MULTI chunk.
 *   FIX-8  : flash() validates board_id and image size before flashing.
 *   FIX-9  : CRC padding uses 0xFF (NOR-flash erased state).
 *   FIX-10 : io_ctx_ is restarted before every run() call.
 */

#include "firmware_uploader.h"

#include <thread>
#include <chrono>
#include <cstring>
#include <cstdio>
#include <stdexcept>

// Platform DTR-toggle headers
#ifndef _WIN32
#   include <sys/ioctl.h>
#   include <termios.h>
#else
#   include <windows.h>
#endif

// ── Static member initialisation ──────────────────────────────────────
uint32_t FirmwareUploader::crc_table_[256] = {};
bool     FirmwareUploader::crc_table_ready_ = false;

// ── ctor / dtor ────────────────────────────────────────────────────────
FirmwareUploader::FirmwareUploader()
    : port_(io_ctx_)
{
    build_crc_table();
}

FirmwareUploader::~FirmwareUploader()
{
    close_port();
}

// ─────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────
void FirmwareUploader::log(const std::string& msg)
{
    if (log_cb_) log_cb_(msg);
}

static std::string hex8(uint8_t v)
{
    char buf[8];
    snprintf(buf, sizeof(buf), "0x%02X", v);
    return buf;
}
static std::string hex32(uint32_t v)
{
    char buf[12];
    snprintf(buf, sizeof(buf), "0x%08X", v);
    return buf;
}

// ─────────────────────────────────────────────────────────────────────
// Port management
// ─────────────────────────────────────────────────────────────────────

bool FirmwareUploader::open_port(const std::string& port_path, int baud)
{
    try {
        if (port_.is_open())
            port_.close();

        port_.open(port_path);

        using SP = asio::serial_port;
        port_.set_option(SP::baud_rate(static_cast<unsigned>(baud)));
        port_.set_option(SP::character_size(8));
        port_.set_option(SP::stop_bits(SP::stop_bits::one));
        port_.set_option(SP::parity(SP::parity::none));
        port_.set_option(SP::flow_control(SP::flow_control::none));

        log("→ Port " + port_path + " opened @ " + std::to_string(baud) + " baud");
        return true;
    }
    catch (const std::exception& e) {
        log("❌ Failed to open port '" + port_path + "': " + e.what());
        return false;
    }
}

void FirmwareUploader::close_port()
{
    try {
        if (port_.is_open())
            port_.close();
    }
    catch (...) { /* best-effort */ }
}

bool FirmwareUploader::write_bytes(const uint8_t* data, size_t len)
{
    try {
        size_t written = asio::write(port_, asio::buffer(data, len));
        return written == len;
    }
    catch (const std::exception& e) {
        log("❌ Serial write error: " + std::string(e.what()));
        return false;
    }
}

// FIX-3 / FIX-10: async read with a proper cancelling deadline timer.
// io_ctx_ must be restart()ed before each run() call.
std::optional<uint8_t> FirmwareUploader::read_byte(int timeout_ms)
{
    uint8_t  byte      = 0;
    bool     received  = false;
    bool     cancelled = false;

    io_ctx_.restart(); // FIX-10

    asio::steady_timer timer(io_ctx_);
    timer.expires_after(std::chrono::milliseconds(timeout_ms));

    timer.async_wait([&](const asio::error_code& ec) {
        if (!ec) {
            cancelled = true;
            port_.cancel(); // cancels the pending async_read
        }
    });

    asio::async_read(port_, asio::buffer(&byte, 1),
        [&](const asio::error_code& ec, std::size_t /*n*/) {
            if (!ec) {
                received = true;
            }
            timer.cancel(); // stop the timer (may already be expired)
        });

    io_ctx_.run();

    return received ? std::optional<uint8_t>(byte) : std::nullopt;
}

bool FirmwareUploader::read_exact(uint8_t* buf, size_t len, int timeout_ms)
{
    for (size_t i = 0; i < len; ++i) {
        auto b = read_byte(timeout_ms);
        if (!b) return false;
        buf[i] = *b;
    }
    return true;
}

// FIX-4: drain RX buffer — read until quiet for window_ms,
// but never spend more than max_total_ms total.
void FirmwareUploader::drain(int window_ms, int max_total_ms)
{
    auto start     = std::chrono::steady_clock::now();
    int  discarded = 0;

    while (true) {
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::steady_clock::now() - start).count();
        if (elapsed >= max_total_ms) break;

        auto b = read_byte(window_ms);
        if (!b) break;           // quiet for window_ms → done
        ++discarded;
    }

    if (discarded > 0)
        log("→ Drained " + std::to_string(discarded) + " stale RX byte(s)");
}

// ─────────────────────────────────────────────────────────────────────
// Protocol helpers
// ─────────────────────────────────────────────────────────────────────

bool FirmwareUploader::get_sync(int timeout_ms)
{
    const uint8_t cmd[2] = { PROTO_GET_SYNC, PROTO_EOC };
    if (!write_bytes(cmd, 2)) return false;

    uint8_t resp[2] = {};
    if (!read_exact(resp, 2, timeout_ms)) return false;

    return (resp[0] == PROTO_INSYNC && resp[1] == PROTO_OK);
}

bool FirmwareUploader::enter_bootloader()
{
    // ── Fast-path: board may already be in bootloader mode ────────────
    log("→ Checking if board is already in bootloader…");
    drain(30, 150);
    if (get_sync(200)) {
        log("✓ Board already in bootloader mode");
        return true;
    }

    // ── DTR toggle helper ─────────────────────────────────────────────
    auto toggle_dtr = [&]() {
#ifdef _WIN32
        HANDLE h = port_.native_handle();
        EscapeCommFunction(h, CLRDTR);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        EscapeCommFunction(h, SETDTR);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        EscapeCommFunction(h, CLRDTR);
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
#else
        int fd  = port_.native_handle();
        int dtr = TIOCM_DTR;
        ioctl(fd, TIOCMBIC, &dtr);   // de-assert first (start clean / HIGH)
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        ioctl(fd, TIOCMBIS, &dtr);   // assert = LOW = reset pulse
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        ioctl(fd, TIOCMBIC, &dtr);   // de-assert = HIGH = release
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
#endif
    };

    // ── Rapid sync burst ──────────────────────────────────────────────
    auto try_sync_burst = [&](int n, const char* ctx) -> bool {
        for (int i = 1; i <= n; ++i) {
            if (abort_.load()) return false;
            log("→ Sync attempt " + std::to_string(i) +
                "/" + std::to_string(n) + " (" + ctx + ")…");
            drain(20, 100);
            if (get_sync(SYNC_TIMEOUT_MS)) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        return false;
    };

    // ── Send 0x7F autopilot-sync byte ────────────────────────────────
    {
        const uint8_t sync_byte = 0x7F;
        write_bytes(&sync_byte, 1);
        log("→ Sent 0x7F autopilot-sync byte");
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    if (try_sync_burst(4, "post-0x7F")) {
        log("✓ Bootloader sync OK after 0x7F probe");
        return true;
    }

    // ── DTR reset loop ────────────────────────────────────────────────
    for (int reset = 1; reset <= 3; ++reset) {
        if (abort_.load()) return false;

        log("→ DTR reset #" + std::to_string(reset));
        toggle_dtr();

        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        drain(20, 200);

        const uint8_t sync_byte = 0x7F;
        write_bytes(&sync_byte, 1);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

        std::string ctx = "after reset #" + std::to_string(reset);
        if (try_sync_burst(SYNC_RETRIES / 3, ctx.c_str())) {
            log("✓ Bootloader sync OK on reset #" + std::to_string(reset));
            return true;
        }
    }

    log("❌ Bootloader not responding after 3 DTR resets");
    return false;
}

// ─────────────────────────────────────────────────────────────────────
// BUG-1 FIX: get_info_word — correct response order
//
// Python uploader.__getInfo():
//   self.__send(GET_DEVICE + param + EOC)
//   value = self.__recv_int()   ← 4-byte value FIRST
//   self.__getSync()            ← then INSYNC + OK
//
// The old C++ read INSYNC+OK first, then the 4-byte value — backwards.
// This caused every GET_DEVICE query to fail or return garbage.
// ─────────────────────────────────────────────────────────────────────
bool FirmwareUploader::get_info_word(uint8_t param, uint32_t& out, int timeout_ms)
{
    const uint8_t cmd[3] = { PROTO_GET_DEVICE, param, PROTO_EOC };
    if (!write_bytes(cmd, 3)) return false;

    // Step 1: read the 4-byte value FIRST (matches Python __recv_int())
    uint8_t word[4] = {};
    if (!read_exact(word, 4, timeout_ms)) {
        log("❌ GET_DEVICE timeout reading 4-byte value (param=" +
            std::to_string(param) + ")");
        return false;
    }

    out = static_cast<uint32_t>(word[0])
        | (static_cast<uint32_t>(word[1]) <<  8)
        | (static_cast<uint32_t>(word[2]) << 16)
        | (static_cast<uint32_t>(word[3]) << 24);

    // Step 2: read INSYNC + OK SECOND (matches Python __getSync())
    uint8_t resp[2] = {};
    if (!read_exact(resp, 2, timeout_ms)) {
        log("❌ GET_DEVICE timeout waiting for INSYNC+OK (param=" +
            std::to_string(param) + ")");
        return false;
    }
    if (resp[0] != PROTO_INSYNC) {
        log("❌ GET_DEVICE: expected INSYNC got " + hex8(resp[0]));
        return false;
    }
    if (resp[1] == PROTO_INVALID) {
        log("❌ GET_DEVICE: bootloader returned INVALID for param=" +
            std::to_string(param));
        return false;
    }
    if (resp[1] != PROTO_OK) {
        log("❌ GET_DEVICE: unexpected status " + hex8(resp[1]));
        return false;
    }

    return true;
}

bool FirmwareUploader::get_device_info(uint32_t& bl_rev,
                                        uint32_t& board_id,
                                        uint32_t& board_rev,
                                        uint32_t& flash_size)
{
    log("→ Reading device info…");

    if (!get_info_word(INFO_BL_REV,     bl_rev,     INFO_TIMEOUT_MS)) return false;
    if (!get_info_word(INFO_BOARD_ID,   board_id,   INFO_TIMEOUT_MS)) return false;
    if (!get_info_word(INFO_BOARD_REV,  board_rev,  INFO_TIMEOUT_MS)) return false;
    if (!get_info_word(INFO_FLASH_SIZE, flash_size, INFO_TIMEOUT_MS)) return false;
    // NOTE: param 0x05 is UNDEFINED — querying it causes INSYNC+INVALID.
    //       INFO_EXTF_SIZE (0x06) intentionally skipped — not needed here.

    log("→ BL_REV="    + std::to_string(bl_rev)    +
        "  BOARD_ID="  + std::to_string(board_id)  +
        "  BOARD_REV=" + std::to_string(board_rev) +
        "  FLASH="     + std::to_string(flash_size) + " B");
    return true;
}

// FIX-6: erase_chip fires erase_progress_cb while polling so the UI
// progress bar animates during the (up to 20 s) erase wait.
bool FirmwareUploader::erase_chip()
{
    log("→ Erasing flash — may take up to 20 s…");

    if (erase_progress_cb_) erase_progress_cb_(0.0f);

    const uint8_t cmd[2] = { PROTO_CHIP_ERASE, PROTO_EOC };
    if (!write_bytes(cmd, 2)) return false;

    const auto start    = std::chrono::steady_clock::now();
    const auto deadline = start + std::chrono::milliseconds(ERASE_TIMEOUT_MS);
    float last_pct      = 0.0f;

    while (std::chrono::steady_clock::now() < deadline) {
        if (abort_.load()) return false;

        auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::steady_clock::now() - start).count();
        float progress = std::min(0.95f,
                             static_cast<float>(elapsed_ms) /
                             static_cast<float>(ERASE_TIMEOUT_MS));

        if (progress - last_pct >= 0.05f) {
            if (erase_progress_cb_) erase_progress_cb_(progress);
            last_pct = progress;
        }

        auto b0 = read_byte(100);
        if (!b0) continue;

        auto b1 = read_byte(500);
        if (!b1) {
            log("❌ Erase: got first byte but second byte timed out");
            return false;
        }

        if (*b0 == PROTO_INSYNC && *b1 == PROTO_OK) {
            if (erase_progress_cb_) erase_progress_cb_(1.0f);
            log("✓ Flash erased");
            return true;
        }

        log("❌ Erase response: " + hex8(*b0) + " " + hex8(*b1));
        return false;
    }

    log("❌ Erase timed out (" + std::to_string(ERASE_TIMEOUT_MS / 1000) + " s)");
    return false;
}

// FIX-7: program checks abort_ between chunks and logs at 10 % intervals.
bool FirmwareUploader::program(const std::vector<uint8_t>& image)
{
    log("→ Programming " + std::to_string(image.size()) + " bytes…");

    if (write_progress_cb_) write_progress_cb_(0.0f);

    const size_t total        = image.size();
    size_t       offset       = 0;
    int          last_logged_pct = -1;

    while (offset < total) {
        if (abort_.load()) {
            log("⚠ Programming aborted by user");
            return false;
        }

        const size_t chunk =
            std::min(static_cast<size_t>(MAX_PROG_BYTES), total - offset);

        // PROG_MULTI frame: [CMD, len, data…, EOC]
        std::vector<uint8_t> frame;
        frame.reserve(3 + chunk);
        frame.push_back(PROTO_PROG_MULTI);
        frame.push_back(static_cast<uint8_t>(chunk));
        frame.insert(frame.end(),
                     image.begin() + static_cast<std::ptrdiff_t>(offset),
                     image.begin() + static_cast<std::ptrdiff_t>(offset + chunk));
        frame.push_back(PROTO_EOC);

        if (!write_bytes(frame.data(), frame.size())) return false;

        uint8_t resp[2] = {};
        if (!read_exact(resp, 2, WRITE_TIMEOUT_MS)) {
            log("❌ Write timeout at offset " + std::to_string(offset));
            return false;
        }
        if (resp[0] != PROTO_INSYNC || resp[1] != PROTO_OK) {
            log("❌ Write NACK at offset " + std::to_string(offset) +
                " (" + hex8(resp[0]) + " " + hex8(resp[1]) + ")");
            return false;
        }

        offset += chunk;

        const float progress = static_cast<float>(offset) /
                               static_cast<float>(total);
        if (write_progress_cb_) write_progress_cb_(progress);

        const int pct = static_cast<int>(progress * 100.f);
        if (pct / 10 != last_logged_pct / 10) {
            log("→ Write: " + std::to_string(pct) + " %");
            last_logged_pct = pct;
        }
    }

    log("✓ Programming complete");
    return true;
}

// ─────────────────────────────────────────────────────────────────────
// BUG-2 + BUG-3 FIX: verify_crc — correct algorithm and padding
//
// Python firmware.crc(padlen):
//   state = crc32(self.image, int(0))    ← initial state = 0, NOT 0xFFFFFFFF
//   for i in range(len(self.image), (padlen - 1), 4):
//       state = crc32(self.crcpad, state) ← pad 4 bytes at a time
//   return state                          ← no final XOR / inversion
//
// Python crc32(bytes, state=0):
//   for byte in bytes:
//       index = (state ^ byte) & 0xff
//       state = crctab[index] ^ (state >> 8)
//   return state
//
// The old C++ used 0xFFFFFFFF initial and ~crc final — completely wrong.
// ─────────────────────────────────────────────────────────────────────
bool FirmwareUploader::verify_crc(const std::vector<uint8_t>& image,
                                   uint32_t flash_size)
{
    log("→ Verifying CRC…");

    const uint8_t cmd[2] = { PROTO_GET_CRC, PROTO_EOC };
    if (!write_bytes(cmd, 2)) return false;

    // Python __verify_v3: recv_int() first, then __getSync()
    uint8_t crc_bytes[4] = {};
    if (!read_exact(crc_bytes, 4, INFO_TIMEOUT_MS)) {
        log("❌ CRC: data timeout");
        return false;
    }

    const uint32_t board_crc =
        static_cast<uint32_t>(crc_bytes[0])
        | (static_cast<uint32_t>(crc_bytes[1]) <<  8)
        | (static_cast<uint32_t>(crc_bytes[2]) << 16)
        | (static_cast<uint32_t>(crc_bytes[3]) << 24);

    // Read INSYNC + OK after the CRC word (matches Python __getSync())
    uint8_t resp[2] = {};
    if (!read_exact(resp, 2, INFO_TIMEOUT_MS)) {
        log("❌ CRC: INSYNC+OK timeout");
        return false;
    }
    if (resp[0] != PROTO_INSYNC || resp[1] != PROTO_OK) {
        log("❌ CRC command rejected: " + hex8(resp[0]) + " " + hex8(resp[1]));
        return false;
    }

    const uint32_t local_crc = compute_padded_crc(image, flash_size);

    if (board_crc != local_crc) {
        log("❌ CRC mismatch — board=" + hex32(board_crc) +
            "  local=" + hex32(local_crc));
        return false;
    }

    log("✓ CRC verified: " + hex32(board_crc));
    return true;
}

// BUG-5 FIX: reboot() — attempt get_sync() after sending REBOOT (BL ≥ 3).
// Python __reboot(): if self.bl_rev >= 3: self.__getSync()
// We don't track bl_rev separately, so always attempt and ignore timeout.
bool FirmwareUploader::reboot()
{
    log("Rebooting board");
    const uint8_t cmd[2] = { PROTO_REBOOT, PROTO_EOC };
    write_bytes(cmd, 2);  // best-effort send

    // Best-effort ACK read — board may reboot before the ACK arrives.
    // Ignore result; a timeout here is normal and not a failure.
    uint8_t resp[2] = {};
    read_exact(resp, 2, REBOOT_TIMEOUT_MS);  // result intentionally ignored

    std::this_thread::sleep_for(std::chrono::milliseconds(REBOOT_TIMEOUT_MS));
    return true;
}

// ─────────────────────────────────────────────────────────────────────
// BUG-2 + BUG-3 FIX: CRC32 matching uploader.py exactly
//
// Python crc32 table (crctab) uses polynomial 0xEDB88320 — identical to
// the standard ISO 3309 / PKZIP table.  That part was correct.
//
// What was wrong:
//   - Initial state must be 0 (not 0xFFFFFFFF).
//   - No final XOR/inversion (not ~crc).
//   - Padding must be done in 4-byte crcpad chunks, looping from
//     image.size() to (flash_size - 1), stepping 4 each iteration —
//     matching Python:  range(len(self.image), (padlen - 1), 4)
// ─────────────────────────────────────────────────────────────────────
void FirmwareUploader::build_crc_table()
{
    if (crc_table_ready_) return;
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j)
            crc = (crc >> 1) ^ ((crc & 1u) ? 0xEDB88320u : 0u);
        crc_table_[i] = crc;
    }
    crc_table_ready_ = true;
}

uint32_t FirmwareUploader::crc32_accumulate(uint32_t crc,
                                             const uint8_t* data,
                                             size_t len)
{
    for (size_t i = 0; i < len; ++i) {
        // Python: index = (state ^ byte) & 0xff
        //         state = crctab[index] ^ (state >> 8)
        crc = (crc >> 8) ^ crc_table_[(crc ^ data[i]) & 0xFFu];
    }
    return crc;
}

// BUG-2 + BUG-3 FIX: compute_padded_crc matching Python firmware.crc(padlen).
//
// Python:
//   state = crc32(self.image, int(0))          ← start with state=0
//   for i in range(len(self.image), (padlen-1), 4):
//       state = crc32(self.crcpad, state)       ← 4 bytes of 0xFF per iteration
//   return state                                ← no inversion
uint32_t FirmwareUploader::compute_padded_crc(const std::vector<uint8_t>& image,
                                               uint32_t padded_size)
{
    // BUG-2 fix: initial state = 0 (not 0xFFFFFFFF)
    uint32_t state = 0;
    state = crc32_accumulate(state, image.data(), image.size());

    // BUG-3 fix: replicate Python loop exactly.
    // range(len(image), (padded_size - 1), 4) iterates:
    //   i = len(image), len(image)+4, len(image)+8, ...
    //   stopping when i >= (padded_size - 1)
    // Each iteration feeds 4 bytes of 0xFF (crcpad).
    const uint8_t crcpad[4] = { 0xFF, 0xFF, 0xFF, 0xFF };
    for (size_t i = image.size(); i < (static_cast<size_t>(padded_size) - 1); i += 4) {
        state = crc32_accumulate(state, crcpad, 4);
    }

    // BUG-2 fix: no final XOR/inversion — return raw state
    return state;
}

// ─────────────────────────────────────────────────────────────────────
// flash() — public entry point
// ─────────────────────────────────────────────────────────────────────
bool FirmwareUploader::flash(const std::string&          port_path,
                              int                         boot_baud,
                              const std::vector<uint8_t>& firmware_image,
                              uint32_t                    expected_board_id)
{
    abort_.store(false);

    if (firmware_image.empty()) {
        log("❌ Firmware image is empty");
        return false;
    }

    // ── 1. Open port ──────────────────────────────────────────────────
    if (!open_port(port_path, boot_baud)) return false;

    // ── 2. Enter bootloader ───────────────────────────────────────────
    if (!enter_bootloader()) {
        close_port();
        return false;
    }

    // QGC line 1: "Connected to bootloader:"
    log("Connected to bootloader:");

    // ── 3. Get device info ────────────────────────────────────────────
    uint32_t bl_rev    = 0;
    uint32_t board_id  = 0;
    uint32_t board_rev = 0;
    uint32_t flash_size = 0;

    if (!get_device_info(bl_rev, board_id, board_rev, flash_size)) {
        log("❌ Device identification failed");
        close_port();
        return false;
    }

    // QGC lines 2-4
    log("Version: "    + std::to_string(bl_rev));
    log("Board ID: "   + std::to_string(board_id));
    log("Flash size: " + std::to_string(flash_size));

    // ── 4. Validate board and image ───────────────────────────────────
    if (expected_board_id != 0 && board_id != expected_board_id) {
        log("❌ Board ID mismatch: expected=" +
            std::to_string(expected_board_id) +
            "  device=" + std::to_string(board_id));
        close_port();
        return false;
    }
    if (firmware_image.size() > flash_size) {
        log("❌ Firmware too large: " + std::to_string(firmware_image.size()) +
            " B > flash " + std::to_string(flash_size) + " B");
        close_port();
        return false;
    }

    // ── 5. Erase ──────────────────────────────────────────────────────
    if (!erase_chip()) { close_port(); return false; }
    if (abort_.load())  { close_port(); return false; }

    // ── 6. Program ────────────────────────────────────────────────────
    if (!program(firmware_image)) { close_port(); return false; }
    if (abort_.load())             { close_port(); return false; }

    // ── 7. Verify CRC ─────────────────────────────────────────────────
    if (!verify_crc(firmware_image, flash_size)) {
        close_port();
        return false;
    }

    // ── 8. Reboot ─────────────────────────────────────────────────────
    reboot();
    close_port();

    log("✓ ════════════ Firmware flash successful! ════════════ ✓");
    return true;
}