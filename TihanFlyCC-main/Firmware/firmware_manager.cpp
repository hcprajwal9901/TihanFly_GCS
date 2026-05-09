/**
 * firmware_manager.cpp
 * TiHANFly GCS – firmware installation subsystem
 *
 * Flash sequence (identical to Mission Planner / QGroundControl):
 *
 *   1. Pre-flight checks        – port access, firmware file, ModemManager
 *   2. Suspend MAVLink serial   – releases the OS file descriptor
 *   3. FirmwareUploader opens the port at 115200 baud
 *   4. DTR toggle               – forces bootloader entry on PX4 / ChibiOS boards
 *   5. STK500v2 sync (retried)  – confirms bootloader is responding
 *   6. Erase -> Program -> Verify – write the new firmware image
 *   7. Bootloader reboot command – jump to application
 *   8. Re-enable serial monitor  – MAVLink reconnects naturally
 *
 * No MAVLink, no VehicleManager, no heartbeat required at any step.
 *
 * -- APJ image format ---------------------------------------------------------
 *
 * The "image" field inside an APJ JSON file is base64-encoded AND
 * zlib-compressed (see uploader.py / firmware.__init__):
 *
 *   self.image = bytearray(zlib.decompress(base64.b64decode(self.desc['image'])))
 *
 * decode_apj() performs both steps so the raw binary is ready for the uploader.
 *
 * -- Browser / WebSocket note -------------------------------------------------
 *
 * Browsers cannot supply server-side filesystem paths.  For custom firmware
 * the frontend must read the .apj file with FileReader and send its parsed
 * JSON content in the "apj" key:
 *
 *   const reader = new FileReader();
 *   reader.onload = e => {
 *     const apj = JSON.parse(e.target.result);
 *     ws.send(JSON.stringify({
 *       type: "install_firmware_custom",
 *       apj:  apj,
 *       port: selectedPort   // optional
 *     }));
 *   };
 *   reader.readAsText(file);
 */

#include "firmware_manager.h"
#include "firmware_uploader.h"

#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <thread>
#include <chrono>
#include <zlib.h>

// Platform-specific port-access headers
#ifndef _WIN32
#   include <unistd.h>   // access()
#   include <cstdio>     // popen() / pclose()
#else
#   include <windows.h>
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;

// -----------------------------------------------------------------------------
//  wait_for_bootloader_port()
//
//  When ArduPilot reboots into the bootloader the USB device node changes
//  (e.g. /dev/ttyACM0 → /dev/ttyACM1).  This helper:
//    1. Waits up to disappear_ms for the original port to vanish.
//    2. Waits up to appear_ms for a new ttyACM*/ttyUSB*/COM* to appear.
//    3. Adds a 500 ms settling delay so the bootloader is ready for GET_SYNC.
//  Returns the new port, or the original if the board didn't re-enumerate.
// -----------------------------------------------------------------------------
static std::string wait_for_bootloader_port(const std::string& old_port,
                                             int disappear_ms = 4000,
                                             int appear_ms    = 8000)
{
    auto scan_ports = []() -> std::vector<std::string> {
        std::vector<std::string> found;
#ifdef _WIN32
        for (int i = 0; i <= 255; ++i) {
            std::string p = "COM" + std::to_string(i);
            if (fs::exists(p)) found.push_back(p);
        }
#else
        try {
            for (auto& e : fs::directory_iterator("/dev")) {
                const auto name = e.path().filename().string();
                if (name.rfind("ttyACM", 0) == 0 ||
                    name.rfind("ttyUSB", 0) == 0)
                    found.push_back(e.path().string());
            }
        } catch (...) {}
#endif
        return found;
    };

    // Phase 1: wait for old port to disappear
    std::cout << "[FirmwareManager] Waiting for " << old_port
              << " to disappear (bootloader re-enum)…\n";
    const auto t0 = std::chrono::steady_clock::now();
    while (fs::exists(old_port)) {
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::steady_clock::now() - t0).count();
        if (elapsed >= disappear_ms) {
            std::cout << "[FirmwareManager] " << old_port
                      << " still present — assuming board already in bootloader.\n";
            return old_port;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    std::cout << "[FirmwareManager] " << old_port << " disappeared.\n";

    // Phase 2: wait for new port to appear
    std::cout << "[FirmwareManager] Waiting for bootloader port to appear…\n";
    const auto t1 = std::chrono::steady_clock::now();
    while (true) {
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::steady_clock::now() - t1).count();
        if (elapsed >= appear_ms) {
            std::cout << "[FirmwareManager] Bootloader port did not appear — "
                         "falling back to " << old_port << "\n";
            return old_port;
        }
        for (auto& p : scan_ports()) {
            if (p != old_port) {
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                std::cout << "[FirmwareManager] Bootloader port: " << p << "\n";
                return p;
            }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

// -----------------------------------------------------------------------------
//  Base64 decoder
// -----------------------------------------------------------------------------

static std::vector<uint8_t> base64_decode(const std::string& in)
{
    static const std::string chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::vector<uint8_t> out;
    out.reserve((in.size() / 4) * 3);

    int val = 0, valb = -8;
    for (unsigned char c : in)
    {
        if (c == '=') break;
        auto pos = chars.find(static_cast<char>(c));
        if (pos == std::string::npos) continue;
        val  = (val << 6) + static_cast<int>(pos);
        valb += 6;
        if (valb >= 0)
        {
            out.push_back(static_cast<uint8_t>((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

// -----------------------------------------------------------------------------
//  zlib inflate helper
// -----------------------------------------------------------------------------

static std::vector<uint8_t> zlib_decompress(const std::vector<uint8_t>& compressed)
{
    // Initial output buffer – firmware images are usually < 2 MB.
    std::vector<uint8_t> out(compressed.size() * 4);

    z_stream zs{};
    zs.next_in   = const_cast<Bytef*>(compressed.data());
    zs.avail_in  = static_cast<uInt>(compressed.size());

    if (inflateInit(&zs) != Z_OK)
        return {};

    int ret = Z_OK;
    while (ret == Z_OK)
    {
        zs.next_out  = out.data() + zs.total_out;
        zs.avail_out = static_cast<uInt>(out.size() - zs.total_out);

        ret = inflate(&zs, Z_NO_FLUSH);

        if (ret == Z_BUF_ERROR || zs.avail_out == 0)
        {
            // Grow buffer and retry
            out.resize(out.size() * 2);
        }
    }

    inflateEnd(&zs);

    if (ret != Z_STREAM_END)
        return {};

    out.resize(zs.total_out);
    return out;
}

// -----------------------------------------------------------------------------
//  Construction / destruction
// -----------------------------------------------------------------------------

FirmwareManager::FirmwareManager(const std::string& firmware_dir,
                                 WsSendCb           ws_send)
    : firmware_dir_(firmware_dir),
      ws_send_(std::move(ws_send))
{
    if (!firmware_dir_.empty() && firmware_dir_.back() != '/')
        firmware_dir_ += '/';

    std::cout << "[FirmwareManager] Initialised, firmware_dir="
              << firmware_dir_ << "\n";
}

FirmwareManager::~FirmwareManager()
{
    abort_requested_ = true;
}

// -----------------------------------------------------------------------------
//  Callback setters
// -----------------------------------------------------------------------------

void FirmwareManager::set_suspend_serial_callback(SuspendSerialCb cb)
{
    suspend_cb_ = std::move(cb);
}

void FirmwareManager::set_reconnect_callback(ReconnectCb cb)
{
    reconnect_cb_ = std::move(cb);
}

void FirmwareManager::set_reboot_to_bootloader_callback(RebootToBootloaderCb cb)
{
    reboot_to_bootloader_cb_ = std::move(cb);
}

void FirmwareManager::set_get_active_port_callback(GetActivePortCb cb)
{
    get_active_port_cb_ = std::move(cb);
}

// -----------------------------------------------------------------------------
//  APJ decoding helpers
// -----------------------------------------------------------------------------

// static – decodes an already-parsed APJ JSON object to raw firmware bytes.
//
// APJ images are stored as base64(zlib(raw_binary)), matching uploader.py:
//   self.image = bytearray(zlib.decompress(base64.b64decode(self.desc['image'])))
std::vector<uint8_t>
FirmwareManager::decode_apj(const std::string& label, const json& apj)
{
    std::cout << "[DEBUG] Decoding APJ JSON for: " << label << "\n" << apj.dump(2) << std::endl;

    if (!apj.is_object() || !apj.contains("image"))
    {
        std::cout << "[FirmwareManager] APJ JSON is not an object or missing 'image' field: " << label << "\n";
        return {};
    }

    const auto& image_field = apj["image"];

    // The 'image' field must be a string containing the base64-encoded firmware.
    if (!image_field.is_string())
    {
        std::cout << "[FirmwareManager] APJ missing 'image' field: " << label << "\n";
        return {};
    }

    const std::string b64 = apj["image"].get<std::string>();
    if (b64.empty())
    {
        std::cout << "[FirmwareManager] APJ 'image' is empty: " << label << "\n";
        return {};
    }

    // Step 1: base64 decode
    std::vector<uint8_t> compressed = base64_decode(b64);
    if (compressed.empty())
    {
        std::cout << "[FirmwareManager] base64 decode produced zero bytes: "
                  << label << "\n";
        return {};
    }

    // Step 2: zlib decompress (matches uploader.py zlib.decompress())
    std::vector<uint8_t> image = zlib_decompress(compressed);
    if (image.empty())
    {
        std::cout << "[FirmwareManager] zlib decompress failed for: " << label << "\n";
        return {};
    }

    // Pad to 4-byte boundary with 0xFF (NOR-flash erased state), matching uploader.py:
    //   while ((len(self.image) % 4) != 0): self.image += bytes(0xFF)
    while (image.size() % 4 != 0)
        image.push_back(0xFF);

    std::cout << "[FirmwareManager] Decoded " << image.size()
              << " bytes from " << label << "\n";
    return image;
}

// Load an APJ file from disk and decode it.
std::vector<uint8_t>
FirmwareManager::load_apj_file(const std::string& path)
{
    std::ifstream f(path);
    if (!f)
    {
        std::cout << "[FirmwareManager] Cannot open file: " << path << "\n";
        return {};
    }

    json apj;
    try { apj = json::parse(f); }
    catch (const std::exception& ex)
    {
        std::cout << "[FirmwareManager] JSON parse error in " << path
                  << ": " << ex.what() << "\n";
        return {};
    }

    return decode_apj(path, apj);
}

// -----------------------------------------------------------------------------
//  Pre-flight checks (mirrors FirmwareFlasherWorker in Python)
// -----------------------------------------------------------------------------

bool FirmwareManager::verify_port_access(const std::string& port)
{
#ifdef _WIN32
    // On Windows, just validate that it looks like a COM port.
    if (port.find("COM") == std::string::npos)
    {
        send_status("error", "❌ Invalid Windows port: " + port, -1, true);
        return false;
    }
#else
    // On Linux, check device exists and is readable/writable.
    if (!fs::exists(port))
    {
        send_status("error", "❌ Port " + port + " does not exist!", -1, true);
        return false;
    }
    if (::access(port.c_str(), R_OK | W_OK) != 0)
    {
        send_status("error",
            "❌ No read/write access to " + port + "\n"
            "   Run:  sudo chmod 666 " + port + "\n"
            "   Or:   sudo usermod -aG dialout $USER  (then re-login)",
            -1, true);
        return false;
    }
#endif
    return true;
}

bool FirmwareManager::verify_firmware_file(const std::string& path)
{
    if (!fs::exists(path))
    {
        send_status("error", "❌ Firmware file not found: " + path, -1, true);
        return false;
    }

#ifndef _WIN32
    if (::access(path.c_str(), R_OK) != 0)
    {
        send_status("error", "❌ Cannot read firmware file: " + path, -1, true);
        return false;
    }
#endif

    // Warn (but don't fail) if the extension is unexpected.
    if (path.size() < 4 || path.substr(path.size() - 4) != ".apj")
    {
        std::cout << "[FirmwareManager] ⚠️  WARNING: file doesn't have .apj extension: "
                  << path << "\n";
        send_status("warning",
            "⚠️  File does not have a .apj extension – proceeding anyway.");
    }

    return true;
}

bool FirmwareManager::check_modem_manager()
{
#ifndef _WIN32
    FILE* pipe = popen("systemctl is-active ModemManager 2>/dev/null", "r");
    if (!pipe) return false;

    char buf[64] = {};
    if (fgets(buf, sizeof(buf), pipe)) { /* read result */ }
    pclose(pipe);

    // Strip trailing newline.
    std::string result(buf);
    while (!result.empty() &&
           (result.back() == '\n' || result.back() == '\r' || result.back() == ' '))
        result.pop_back();

    if (result == "active")
    {
        send_status("warning",
            "⚠️  WARNING: ModemManager is running and may interfere with flashing.\n"
            "   Stop it first:  sudo systemctl stop ModemManager.service");
        std::cout << "[FirmwareManager] ⚠️  ModemManager is active!\n";
        return true;
    }
#endif
    return false;
}

// -----------------------------------------------------------------------------
//  Failure troubleshooting checklist
//  Mirrors FirmwareFlasher._onFinished() from firmware_flasher_qml.py
// -----------------------------------------------------------------------------

void FirmwareManager::send_troubleshooting_checklist(const std::string& port)
{
    std::string msg =
        "\n📋 Troubleshooting checklist:\n"
#ifndef _WIN32
        "\n   1. Is ModemManager running?  Stop it:\n"
        "      sudo systemctl stop ModemManager.service\n"
#endif
        "\n   2. Is the board in bootloader mode?\n"
        "      - No GPS light should be visible\n"
        "      - Try power cycling the board\n"
        "\n   3. Does the firmware match your board?\n"
        "      - Check board ID in firmware vs device\n"
        "      - CubeOrange+ should use 0x2dae firmware\n"
        "\n   4. Try using 115200 baud for both rates\n";

#ifndef _WIN32
    msg +=
        "\n   5. Check port permissions:\n"
        "      sudo chmod 666 " + port + "\n"
        "      OR:  sudo usermod -aG dialout $USER\n";
#endif

    send_status("troubleshoot", msg, -1, true);
}

// -----------------------------------------------------------------------------
//  WebSocket message handler
// -----------------------------------------------------------------------------

bool FirmwareManager::handle_ws_message(const std::string& payload)
{
    json j;
    try
    {
        j = json::parse(payload);
    }
    catch (const json::parse_error& e)
    {
        std::cout << "[FirmwareManager] WebSocket JSON parse error: " << e.what() << "\n";
        return false; // Not a firmware manager message if it's not valid JSON
    }

    // Safely get the message type.
    const std::string type = j.value("type", "");
    if (type.empty()) return false;
    
    // -- install_firmware -----------------------------------------------------
    //
    // Payload:
    //   { "type":    "install_firmware",
    //     "vehicle": "copter" | "plane" | "rover" | ...,
    //     "fw_type": "stable" | "beta" | "dev",
    //     "port":    "/dev/ttyACM0"  <- optional }
    if (type == "install_firmware")
    {
        if (flashing_.load())
        {
            send_status("busy",
                        "Firmware flash already in progress – "
                        "please wait or abort first.",
                        -1, true);
            return true;
        }

        const std::string vehicle = j.value("vehicle", "copter");
        const std::string fw_type = j.value("fw_type", "stable");
        const std::string filename = vehicle + "_" + fw_type + ".apj";
        const std::string path     = firmware_dir_ + filename;

        if (!fs::exists(path))
        {
            send_status("error", "Firmware file not found: " + path, -1, true);
            return true;
        }

        std::vector<uint8_t> image = load_apj_file(path);
        if (image.empty())
        {
            send_status("error",
                        "Failed to decode firmware file: " + filename,
                        -1, true);
            return true;
        }

        const std::string port = j.value("port", ""); // Port is optional

        // If a port is specified by the UI, start the flash immediately ("hot flash").
        // This implies the MAVLink transport is active and must be suspended.
        if (!port.empty())
        {
            std::cout << "[FirmwareManager] install_firmware: "
                      << filename << " on " << port << "\n";
            std::thread([this, port, image, filename]() {
                if (reboot_to_bootloader_cb_) {
                    reboot_to_bootloader_cb_();
                }
                // Board re-enumerates under a new device node after reboot.
                // Wait for the new port before flashing.
                const std::string bl_port = wait_for_bootloader_port(port);
                do_flash(bl_port, image, filename);
            }).detach();
        }
        else
        {
            std::lock_guard<std::mutex> lock(pending_mtx_);
            pending_image_ = std::move(image);
            pending_label_ = filename;
            std::cout << "[FirmwareManager] install_firmware: queued "
                      << filename << ", waiting for board\n";
            send_status("waiting",
                        "Plug in your flight controller now to begin flashing.");
        }

        return true;
    }

    // -- install_firmware_custom ----------------------------------------------
    //
    // Mode A – browser sends APJ JSON inline (no filesystem path needed):
    //   { "type": "install_firmware_custom",
    //     "apj":  { <full APJ JSON object from FileReader.readAsText()> },
    //     "port": "/dev/ttyACM0"  <- optional }
    //
    // Mode B – server-side file path (e.g. pre-downloaded image):
    //   { "type": "install_firmware_custom",
    //     "path": "/absolute/path/to/firmware.apj",
    //     "port": "/dev/ttyACM0"  <- optional }
    if (type == "install_firmware_custom")
    {
        if (flashing_.load())
        {
            send_status("busy",
                        "Firmware flash already in progress – "
                        "please wait or abort first.",
                        -1, true);
            return true;
        }

        std::vector<uint8_t> image;
        std::string          label;

        // Safely check for the "apj" object.
        if (j.contains("apj"))
        {
            if (j["apj"].is_object())
            {
                // Mode A: inline APJ JSON
                const json& apj = j["apj"];
                label = apj.value("summary", "custom"); // "summary" is the user-facing name
                image = decode_apj(label, apj);
                if (image.empty())
                {
                    send_status("error",
                                "Failed to decode inline APJ firmware.",
                                -1, true);
                    return true;
                }
            }
            else
            {
                send_status("error", "Invalid 'apj' field: expected a JSON object.", -1, true);
                std::cout << "[FirmwareManager] 'apj' field was not an object.\n";
                return true;
            }
        }
        else if (j.contains("path") && j["path"].is_string())
        {
            // Mode B: server-side file path
            const std::string path = j["path"].get<std::string>();

            if (path.empty() || !fs::exists(path))
            {
                send_status("error",
                            "Firmware file not found: " +
                            (path.empty() ? std::string("<empty>") : path),
                            -1, true);
                return true;
            }

            label = fs::path(path).filename().string();
            image = load_apj_file(path);

            if (image.empty())
            {
                send_status("error",
                            "Failed to decode firmware file: " + label,
                            -1, true);
                return true;
            }
        }
        else
        {
            send_status("error",
                        "install_firmware_custom requires either:\n"
                        "  \"apj\": { <APJ JSON object> }   for browser file uploads\n"
                        "  \"path\": \"/path/to/file.apj\"  for server-side files",
                        -1, true);
            return true;
        }

        const std::string port = j.value("port", ""); // Port is optional

        // If a port is specified by the UI, start the flash immediately ("hot flash").
        if (!port.empty())
        {
            std::cout << "[FirmwareManager] install_firmware_custom: "
                      << label << " on " << port << "\n";
            std::thread([this, port, image, label]() {
                if (reboot_to_bootloader_cb_) {
                    reboot_to_bootloader_cb_();
                }
                // Board re-enumerates under a new device node after reboot.
                // Wait for the new port before flashing.
                const std::string bl_port = wait_for_bootloader_port(port);
                do_flash(bl_port, image, label);
            }).detach();
        }
        else
        {
            std::lock_guard<std::mutex> lock(pending_mtx_);
            pending_image_ = std::move(image);
            pending_label_ = label;
            std::cout << "[FirmwareManager] install_firmware_custom: queued "
                      << label << ", waiting for port\n";
            send_status("waiting",
                        "Plug in your flight controller now to begin flashing.");
        }

        return true;
    }

    // -- abort_firmware -------------------------------------------------------
    if (type == "abort_firmware")
    {
        abort();
        return true;
    }

    return false;
}

// -----------------------------------------------------------------------------
//  Auto-trigger from serial hotplug monitor
// -----------------------------------------------------------------------------

void FirmwareManager::install_from_port(const std::string& port)
{
    std::vector<uint8_t> image;
    std::string          label;

    {
        std::lock_guard<std::mutex> lock(pending_mtx_);
        if (pending_image_.empty())
            return;

        image = std::move(pending_image_);
        label = std::move(pending_label_);
        pending_image_.clear();
        pending_label_.clear();
    }

    std::cout << "[FirmwareManager] Port appeared (" << port
              << ") – starting queued flash of " << label << "\n";

    std::thread([this, port, image, label]() {
        do_flash(port, image, label);
    }).detach();
}

// -----------------------------------------------------------------------------
//  Status queries
// -----------------------------------------------------------------------------

bool FirmwareManager::is_flashing() const { return flashing_.load(); }

bool FirmwareManager::has_pending_install() const
{
    std::lock_guard<std::mutex> lock(pending_mtx_);
    return !pending_image_.empty();
}

void FirmwareManager::abort()
{
    if (flashing_.load())
    {
        abort_requested_ = true;
        send_status("abort", "Aborting firmware flash – please wait...");
        std::cout << "[FirmwareManager] Abort requested\n";
    }
    else
    {
        std::lock_guard<std::mutex> lock(pending_mtx_);
        if (!pending_image_.empty())
        {
            pending_image_.clear();
            pending_label_.clear();
            send_status("abort", "Pending firmware install cancelled.");
            std::cout << "[FirmwareManager] Pending install cancelled\n";
        }
    }
}

// -----------------------------------------------------------------------------
//  Core flash sequence
// -----------------------------------------------------------------------------

void FirmwareManager::do_flash(const std::string&          port,
                                const std::vector<uint8_t>& image,
                                const std::string&          label)
{
    abort_requested_ = false;
    flashing_        = true;

    std::cout << "[FirmwareManager] -- Flash start --------------------------\n";
    std::cout << "[FirmwareManager]   port    : " << port         << "\n";
    std::cout << "[FirmwareManager]   firmware: " << label        << "\n";
    std::cout << "[FirmwareManager]   size    : " << image.size() << " bytes\n";

    // ─── Step 1: Pre-flight checks ────────────────────────────────────────
    // Mirrors FirmwareFlasherWorker.run() from firmware_flasher_qml.py.
    send_status("preflight", "🔍 Running pre-flight checks...", 0);

    if (!verify_port_access(port))
    {
        flashing_        = false;
        abort_requested_ = false;
        if (reconnect_cb_) reconnect_cb_();
        return;
    }

    // Warn about ModemManager on Linux (does not abort the flash).
#ifndef _WIN32
    check_modem_manager();
#endif

    // Small stabilisation delay – matches time.sleep(0.5) in Python.
    std::this_thread::sleep_for(std::chrono::milliseconds(500));

    // ─── Step 2: Release the MAVLink serial transport ─────────────────────
    if (suspend_cb_)
    {
        std::cout << "[FirmwareManager] Suspending MAVLink serial transport\n";
        suspend_cb_();
    }

    // Give the OS time to fully release the FD before FirmwareUploader opens it.
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));

    send_status("start",
        "🚀 Starting firmware flash on " + port + "…\n"
        "📦 Firmware: " + label + "\n"
        "📡 Port:     " + port,
        0);

    // ─── Step 3: Run the uploader ─────────────────────────────────────────
    bool success = false;

    try
    {
        FirmwareUploader uploader;

        uploader.set_log_callback([this](const std::string& msg) {
            std::cout << "[FirmwareUploader] " << msg << "\n";
            // Forward uploader log lines to the WebSocket as progress messages.
            send_status("log", msg);
        });

        // Each callback tracks the last sent integer % to suppress duplicate
        // WebSocket messages — the uploader fires after every ~252-byte chunk,
        // producing hundreds of identical messages at the same integer percent.
        auto erase_last = std::make_shared<int>(-1);
        auto write_last = std::make_shared<int>(-1);

        uploader.set_erase_progress([this, erase_last](float p) {
            // Send 0–100 for the erase stage (not 0–30).
            const int pct = static_cast<int>(p * 100.0f);
            if (pct != *erase_last) {
                *erase_last = pct;
                send_status("erase", "Erasing flash...", pct);
            }
        });

        uploader.set_write_progress([this, write_last](float p) {
            // Send 0–100 for the program stage (not 30–90).
            const int pct = static_cast<int>(p * 100.0f);
            if (pct != *write_last) {
                *write_last = pct;
                send_status("program", "Programming firmware...", pct);
            }
        });

        // Watcher thread: polls abort_requested_ and forwards to uploader.abort().
        std::atomic<bool> watching{true};
        std::thread abort_watcher([&]() {
            while (watching.load()) {
                if (abort_requested_.load())
                    uploader.abort();
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        });

        success = uploader.flash(port, 115200, image);

        watching = false;
        abort_watcher.join();
    }
    catch (const std::exception& ex)
    {
        std::cout << "[FirmwareManager] Exception during flash: "
                  << ex.what() << "\n";
        send_status("error", std::string("❌ Flash failed: ") + ex.what(), -1, true);
    }
    catch (...)
    {
        std::cout << "[FirmwareManager] Unknown exception during flash\n";
        send_status("error", "❌ Flash failed: unknown error", -1, true);
    }

    // ─── Step 4: Final status ─────────────────────────────────────────────
    if (abort_requested_)
    {
        send_status("abort", "ℹ️  Flash cancelled by user.");
        std::cout << "[FirmwareManager] Flash aborted by user\n";
    }
    else if (success)
    {
        std::string ok =
            std::string(60, '=') + "\n"
            "✅ FLASH COMPLETED SUCCESSFULLY!\n" +
            std::string(60, '=');
        send_status("complete", ok, 100);
        std::cout << "[FirmwareManager] Flash complete OK\n";
    }
    else
    {
        // Failure – print the same troubleshooting checklist as Python's _onFinished().
        std::string fail =
            std::string(60, '=') + "\n"
            "❌ FLASH FAILED\n" +
            std::string(60, '=');
        send_status("error", fail, -1, true);
        send_troubleshooting_checklist(port);
    }

    // ─── Step 5: Re-enable the serial hotplug monitor ─────────────────────
    flashing_        = false;
    abort_requested_ = false;

    if (reconnect_cb_)
    {
        std::cout << "[FirmwareManager] Re-enabling serial monitor\n";
        reconnect_cb_();
    }

    std::cout << "[FirmwareManager] -- Flash end ----------------------------\n";
}

// -----------------------------------------------------------------------------
//  Internal: broadcast firmware_status JSON to all WS clients
// -----------------------------------------------------------------------------

void FirmwareManager::send_status(const std::string& stage,
                                   const std::string& message,
                                   int  progress,
                                   bool error)
{
    json j;
    j["type"]    = "firmware_status";
    j["stage"]   = stage;
    j["message"] = message;
    j["error"]   = error;
    if (progress >= 0)
        j["progress"] = progress;

    if (ws_send_)
        ws_send_(j.dump());

    std::cout << "[FirmwareManager] [" << stage << "] " << message;
    if (progress >= 0) std::cout << " (" << progress << "%)";
    std::cout << "\n";
}