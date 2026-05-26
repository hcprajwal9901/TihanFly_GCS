/**
 * main.cpp
 * TiHANFly GCS — entry point
 *
 * Changes vs previous version (Mode A → Mode B):
 *  • VehicleManager is now the central vehicle registry.
 *  • Vehicle is no longer constructed manually in main(); VehicleManager
 *    creates Vehicle objects automatically when a HEARTBEAT arrives from
 *    a new sysid.
 *  • g_vehicle global pointer is removed.  Code that previously called
 *    g_vehicle->send_mavlink() now calls
 *    vehicle_manager.get_active_vehicle()->send_mavlink().
 *  • cmd_manager.set_vehicle_direct() is replaced with
 *    cmd_manager.set_vehicle_manager().
 *  • All inbound MAVLink frames are routed through
 *    vehicle_manager.handle_message(msg, link_id) so discovery and
 *    dispatch happen in one place.
 *  • A 3-second periodic thread calls vehicle_manager.check_timeouts()
 *    to evict stale vehicles.
 *  • request_rc_channels_stream() now resolves the vehicle through
 *    vehicle_manager.get_active_vehicle() instead of g_vehicle.
 *  • sub-module MAVLink send callbacks still go through Vehicle::send_mavlink();
 *    they are re-wired whenever get_active_vehicle() returns a valid vehicle.
 *
 * FIX — Compass calibration progress not reaching UI:
 *  ArduPilot sends MAG_CAL_PROGRESS (191) and MAG_CAL_REPORT (192) with
 *  sysid=0 (broadcast).  VehicleManager correctly routes sysid=0 messages
 *  to all live vehicles via vehicle->process_message(), which dispatches
 *  to registered handlers.  However, this dispatch chain can be blocked or
 *  miss messages in two scenarios:
 *
 *   (a) stopRetryWatcher() inside handleCommandAck() joins the retry thread
 *       (up to ~100 ms).  If MAG_CAL_PROGRESS arrives on the MAVLink RX
 *       thread during that join window, it sits queued and is processed
 *       immediately after — so it does reach compassCalib.  This is not
 *       the primary cause.
 *
 *   (b) The vehicle handler registration in on_new_vehicle fires for
 *       sysid=1 only.  VehicleManager::handle_message() for sysid=0 calls
 *       vehicle->process_message() on every live vehicle — so the handlers
 *       ARE reached.  This is also not the primary cause.
 *
 *   (c) PRIMARY CAUSE: compassCalib.processMessage() is only reached via
 *       the vehicle handler chain.  If a MAG_CAL_PROGRESS packet arrives
 *       between the moment the Vehicle is created and the moment
 *       on_new_vehicle fires and registers the handlers (a tiny window but
 *       real), or if any future refactoring breaks the chain, the message
 *       is silently dropped.
 *
 *   FIX: Feed MAG_CAL_PROGRESS and MAG_CAL_REPORT directly to
 *   compassCalib.processMessage() in the raw link_manager message callback,
 *   exactly as param_manager.processMessage() is called unconditionally for
 *   every frame.  This is belt-and-braces: if the vehicle chain delivers the
 *   message, compassCalib deduplicates internally (the state machine and
 *   compassActive_/compassStatus_ guards prevent double processing).
 *   If the chain was broken, the direct call still delivers the message.
 *
 * FIX 2 — MAG_CAL_PROGRESS packets never arriving (primary bug):
 *   ArduPilot does NOT stream MAG_CAL_PROGRESS (191) or MAG_CAL_REPORT (192)
 *   to unrecognised GCS systems automatically. They must be explicitly
 *   requested via MAV_CMD_SET_MESSAGE_INTERVAL before starting calibration.
 *   Without this, the drone calibrates internally but sends zero progress
 *   packets, so the C++ backend never receives them and bars stay at 0%.
 *   Fix: send SET_MESSAGE_INTERVAL for msgids 191 and 192 immediately before
 *   calling startCompassCalibration() in the start_compass_calibration WS
 *   handler.
 *
 * [SwitchManager] RC Switch Options panel:
 *   SwitchManager is constructed in main() with a pointer to VehicleManager.
 *   The WS handler for "set_rc_switch" calls switch_manager.set_switch_option().
 *   The WS handler for "write_rc_switches" calls switch_manager.write_all_pending().
 *   The WS handler for "revert_rc_switches" calls switch_manager.clear_pending().
 *   on_write_ fires send_ws_safe() with a "rc_switch_written" confirmation so
 *   the UI can clear dirty badges.
 *
 * [FirmwareManager] MAVLink-free firmware flashing (QGC / Mission Planner style):
 *   Firmware installation no longer requires a MAVLink connection, heartbeat,
 *   or vehicle reboot command.  The new flow is:
 *     pre-flight checks → (optional MAVLink reboot-to-BL) → suspend serial
 *       → DTR toggle (bootloader entry) → sync → erase → program → reboot
 *
 *   Pre-flight checks (mirrors Python FirmwareFlasherWorker):
 *     verify_port_access()   — port exists and has r/w permission
 *     check_modem_manager()  — warns if ModemManager is running (Linux only)
 *
 *   set_reboot_to_bootloader_callback() is now wired to send
 *   MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN (param1=3) when a live vehicle is
 *   present — giving ArduPilot a clean path into the bootloader before the
 *   DTR toggle fires.  No-op when no vehicle is connected (cold flash).
 *
 *   start_serial_monitor() now checks has_pending_install() immediately after
 *   a port appears and auto-triggers install_from_port() when true.
 */

#include <iostream>
#include <iomanip>
#include <cmath>
#include <asio.hpp>
#include <thread>
#include <memory>
#include <sstream>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <algorithm>
#include <fstream>
#include <map>
#include <set>

#ifdef _WIN32
  #ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
  #endif
  #include <windows.h>
#endif

#include <openssl/evp.h>
#include <openssl/buffer.h>

#include <nlohmann/json.hpp>

#include "Link/link_manager.h"
#include "Transport/udp.h"
#include "Transport/serial.h"
#include "Command/command_manager.h"
#include "Vehicle/vehicle.h"
#include "Vehicle/vehicle_manager.h"
#include "Flightmode/flight_mode.h"
#include "calibration/accel_calibration.h"
#include "calibration/compass_calibration.h"
#include "calibration/radio_calibration.h"
#include "calibration/esc_calibration.h"

#include "Parameters/parameter_manager.h"
#include "Parameters/parameter_file.h"
#include "Parameters/parameter_ws_handler.h"
#include "Parameters/switch_manager.h"          // ← [SwitchManager] NEW

#include "Firmware/firmware_manager.h"

// Camera/MJPEG removed — video is now handled via RTSP relay in the Electron layer
#include "Inspector/mavlink_inspector.h"

using asio::ip::tcp;
using json = nlohmann::json;

// ═══════════════════════════════════════════════════════════════════════════════
//  Globals
// ═══════════════════════════════════════════════════════════════════════════════

std::atomic<bool> drone_connected(false);
std::chrono::steady_clock::time_point last_msg;
std::string active_connection = "NONE";

std::shared_ptr<UdpTransport>    udp_transport;
std::shared_ptr<SerialTransport> serial_transport;

// ── Per-client WebSocket entry ────────────────────────────────────────────────
// Each connected browser gets its own send-mutex so that concurrent senders
// (main loop, firmware flash thread, status broadcast, etc.) never interleave
// bytes on the same TCP socket — which would corrupt the WebSocket frame stream
// and cause the browser to silently drop all subsequent messages (the root cause
// of the blank firmware flash log and stuck progress bars).
struct WsClient {
    std::shared_ptr<tcp::socket>  socket;
    std::mutex                    send_mtx;   // serialises all writes to this socket
};

std::vector<std::shared_ptr<WsClient>> ws_clients;
std::mutex ws_mutex;   // protects the ws_clients vector itself (add / remove)
std::atomic<int> serial_link_id{-1};
std::atomic<int> udp_link_id{-1};

// ── Module instances ──────────────────────────────────────────────────────────
VehicleManager*    g_vehicle_manager  = nullptr;
SwitchManager*     g_switch_manager   = nullptr;   // ← [SwitchManager] NEW
FirmwareManager*   g_firmware_manager = nullptr;
MavlinkInspector*  g_mavlink_inspector = nullptr;  // ← MAVLink Inspector

// ── Multi-vehicle: dynamic UDP link registry ──────────────────────────────────
// Populated at runtime by connect_vehicle WS commands.
// Key = local_port (each extra vehicle binds its own UDP port).
struct DynUdpEntry {
    std::shared_ptr<UdpTransport> transport;
    int                           link_id  = -1;
    std::string                   remote_ip;
    int                           remote_port = 0;
};
std::map<int, DynUdpEntry> g_dyn_udp_links;    // key = local_port
std::mutex                 g_dyn_udp_mutex;

// Pointers set in main() so the WS thread can call add_link at runtime
static LinkManager*      g_link_manager = nullptr;
static asio::io_context* g_io_ctx       = nullptr;

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Set by the OS signal / console-ctrl handler.  Any thread may read this to
// detect that shutdown is in progress.
static std::atomic<bool> g_shutdown_flag{false};

// Forward-declared here; body is after main() globals are fully initialised.
static void perform_clean_shutdown();

#ifdef _WIN32
// Windows: catches Ctrl+C, Ctrl+Break, console close, logoff, system shutdown.
static BOOL WINAPI console_ctrl_handler(DWORD event)
{
    switch (event)
    {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
        case CTRL_CLOSE_EVENT:
        case CTRL_LOGOFF_EVENT:
        case CTRL_SHUTDOWN_EVENT:
            perform_clean_shutdown();
            return TRUE;  // handled — do not call default handler
        default:
            return FALSE;
    }
}
#else
// POSIX: catches Ctrl+C (SIGINT) and kill (SIGTERM).
static void posix_signal_handler(int /*sig*/)
{
    perform_clean_shutdown();
}
#endif

// NOTE: AccelCalibration is now per-vehicle (Vehicle::accel_calib_).
// NOTE: CompassCalibration is now per-vehicle (Vehicle::compass_calib_).
// NOTE: AccelCalibration, CompassCalibration, EscCalibration, and
// RadioCalibration are all per-vehicle. Use vehicle->accel_calib() /
// vehicle->compass_calib() / vehicle->esc_calib() / vehicle->radio_calib().
FlightMode         flightMode;

ParameterManager param_manager(1, 1, "./param_cache");

std::string detected_serial_port;
bool        udp_port_bound = false;

// ── Firmware flash guard ──────────────────────────────────────────────────────
// Set true by suspend_cb_ before flashing; cleared by reconnect_cb_ after.
// The serial monitor checks this and skips reconnection while it is set.
std::atomic<bool> firmware_flashing{false};

// ── Log Download state ────────────────────────────────────────────────────────
// Accumulates LOG_DATA chunks for the currently-downloading log file.
// Protected by log_dl_mutex; touched from both the MAVLink RX thread
// (incoming LOG_DATA packets) and the WS thread (download_log command).
struct LogDownloadState {
    bool         active    = false;
    uint16_t     log_id    = 0;
    uint32_t     total     = 0;   // bytes expected (from LOG_ENTRY size)
    uint32_t     received  = 0;   // bytes assembled so far
    std::vector<uint8_t> data;    // assembled binary
};
static LogDownloadState  g_log_dl;
static std::mutex        g_log_dl_mutex;

// base64 encode for log data transport to browser
static std::string log_base64_encode(const uint8_t* data, std::size_t len)
{
    static const char* B64 =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((len + 2) / 3) * 4);
    for (std::size_t i = 0; i < len; i += 3) {
        uint32_t v = (uint32_t)data[i] << 16;
        if (i + 1 < len) v |= (uint32_t)data[i + 1] << 8;
        if (i + 2 < len) v |= (uint32_t)data[i + 2];
        out += B64[(v >> 18) & 0x3F];
        out += B64[(v >> 12) & 0x3F];
        out += (i + 1 < len) ? B64[(v >> 6) & 0x3F] : '=';
        out += (i + 2 < len) ? B64[v & 0x3F] : '=';
    }
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  perform_clean_shutdown()
//
//  Called by the OS signal / console-ctrl handler on Ctrl+C, Ctrl+Break,
//  console close, SIGINT, or SIGTERM.  Safe to call from any thread.
//
//  Two-pronged approach:
//   1. Delete cache files immediately (belt) — handles the case where the
//      process is killed hard and main() never reaches deleteAllCaches().
//   2. Stop the io_context (suspenders) — lets io_threads unblock so main()
//      falls through normally and also calls deleteAllCaches() as a second
//      sweep (handles any files created between now and full exit).
// ═══════════════════════════════════════════════════════════════════════════════

static void perform_clean_shutdown()
{
    // Prevent re-entrant calls (e.g. double Ctrl+C)
    if (g_shutdown_flag.exchange(true)) return;

    std::cout << "\n[GCS] Shutdown signal received — cleaning up...\n";

    // 1. Delete param cache NOW (before io threads wind down)
    param_manager.deleteAllCaches();
    std::cout << "[GCS] Parameter cache cleared.\n";

    // 2. Stop io_context → unblocks io.run() threads → main() can exit
    if (g_io_ctx)
        g_io_ctx->stop();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Serial port discovery
// ═══════════════════════════════════════════════════════════════════════════════

std::string find_serial_port()
{
    for (int i = 0; i <= 9; ++i)
    {
        std::string p = "/dev/ttyACM" + std::to_string(i);
        if (std::filesystem::exists(p)) return p;
    }
    for (int i = 0; i <= 9; ++i)
    {
        std::string p = "/dev/ttyUSB" + std::to_string(i);
        if (std::filesystem::exists(p)) return p;
    }
    for (int i = 0; i <= 9; ++i)
    {
        std::string p = "COM" + std::to_string(i);
        if (std::filesystem::exists(p)) return p;
    }
    return {};
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WebSocket helpers
// ═══════════════════════════════════════════════════════════════════════════════

static void send_ws(tcp::socket& s, const std::string& msg, asio::error_code& ec)
{
    std::vector<unsigned char> frame;
    frame.push_back(0x81); // FIN + text opcode

    std::size_t len = msg.size();
    if (len <= 125)
    {
        frame.push_back(static_cast<unsigned char>(len));
    }
    else if (len <= 65535)
    {
        frame.push_back(126);
        frame.push_back((len >> 8) & 0xFF);
        frame.push_back( len       & 0xFF);
    }
    else
    {
        frame.push_back(127);
        for (int i = 7; i >= 0; --i)
            frame.push_back((len >> (8 * i)) & 0xFF);
    }

    frame.insert(frame.end(), msg.begin(), msg.end());
    asio::write(s, asio::buffer(frame), ec);
}

void send_ws_safe(const std::string& msg)
{
    // Snapshot the client list under the global mutex so we don't hold it
    // while doing slow per-socket I/O (which would block new connections and
    // the firmware flash thread from sending concurrently).
    std::vector<std::shared_ptr<WsClient>> snapshot;
    {
        std::lock_guard<std::mutex> lock(ws_mutex);
        snapshot = ws_clients;
    }

    std::vector<std::shared_ptr<WsClient>> alive;
    for (auto& entry : snapshot)
    {
        asio::error_code ec;
        {
            // Per-client send lock: serialises all writes to this socket so
            // concurrent senders (status broadcast, firmware flash thread,
            // heartbeat, etc.) never interleave frame bytes.
            std::lock_guard<std::mutex> slock(entry->send_mtx);
            send_ws(*entry->socket, msg, ec);
        }
        if (!ec)
            alive.push_back(entry);
        else
            std::cout << "[WebSocket] Dead client removed (send error: "
                      << ec.message() << ")\n";
    }

    // Write back only the living clients.
    std::lock_guard<std::mutex> lock(ws_mutex);
    ws_clients = std::move(alive);
}


// Forward declaration
void send_status();

// ── Video server helpers (Windows) ───────────────────────────────────────────
// Use CreateProcess instead of system()+start so Python actually spawns.
// system("start /B ...") is unreliable from background threads.
// ─────────────────────────────────────────────────────────────────────────────
#ifdef _WIN32
static HANDLE g_video_proc = INVALID_HANDLE_VALUE;

static void video_stop_internal()
{
    if (g_video_proc != INVALID_HANDLE_VALUE)
    {
        TerminateProcess(g_video_proc, 0);
        WaitForSingleObject(g_video_proc, 2000);
        CloseHandle(g_video_proc);
        g_video_proc = INVALID_HANDLE_VALUE;
        std::cout << "[Video] Previous instance terminated\n";
    }
    // Belt-and-suspenders: also kill by port (5001) using netstat+taskkill
    system("for /f \"tokens=5\" %a in ('netstat -ano 2^>nul ^| findstr :5001') do taskkill /F /PID %a >nul 2>&1");
}

static bool video_start_internal(const std::string& script_path, const std::string& rtsp_url)
{
    video_stop_internal();

    // Convert script_path to absolute path
    char abs_path[MAX_PATH];
    std::string final_path = script_path;
    if (_fullpath(abs_path, script_path.c_str(), MAX_PATH) != NULL) {
        final_path = abs_path;
    }

    bool is_py = (final_path.length() >= 3 && final_path.substr(final_path.length() - 3) == ".py");
    std::string cmdline;
    if (is_py) {
        cmdline = "cmd.exe /S /C \"python \"" + final_path + "\" \"" + rtsp_url + "\" 5001 > NUL 2>&1\"";
    } else {
        cmdline = "\"" + final_path + "\" \"" + rtsp_url + "\" 5001";
    }
    
    std::cout << "[Video] CreateProcess: " << cmdline << "\n";

    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(sa);
    sa.lpSecurityDescriptor = NULL;
    sa.bInheritHandle = TRUE;

    HANDLE hLog = CreateFileA("video_server.log", FILE_APPEND_DATA, 
                              FILE_SHARE_READ | FILE_SHARE_WRITE, &sa,
                              OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);

    STARTUPINFOA si = {};
    si.cb         = sizeof(si);
    si.dwFlags    = STARTF_USESTDHANDLES;
    si.hStdOutput = hLog;
    si.hStdError  = hLog;
    si.hStdInput  = GetStdHandle(STD_INPUT_HANDLE);

    PROCESS_INFORMATION pi = {};
    char buf[4096];
    strncpy_s(buf, cmdline.c_str(), sizeof(buf) - 1);

    BOOL ok = CreateProcessA(
        NULL, buf, NULL, NULL,
        TRUE,                   // inherit handles
        CREATE_NO_WINDOW,       // no console window
        NULL, NULL,
        &si, &pi
    );

    if (hLog != INVALID_HANDLE_VALUE) {
        CloseHandle(hLog);
    }

    if (ok)
    {
        g_video_proc = pi.hProcess;   // keep so we can TerminateProcess later
        CloseHandle(pi.hThread);
        std::cout << "[Video] Spawned PID=" << pi.dwProcessId << "\n";
        return true;
    }

    DWORD err = GetLastError();
    std::cout << "[Video] CreateProcess failed (err=" << err
              << "). Falling back to system()\n";
    // Fallback
    std::string cmd2;
    if (is_py) {
        cmd2 = "start /B python \"" + script_path + "\" \"" + rtsp_url + "\" 5001";
    } else {
        cmd2 = "start /B \"\" \"" + script_path + "\" \"" + rtsp_url + "\" 5001";
    }
    system(cmd2.c_str());
    return false;
}
#endif
// ─────────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════════
//  WebSocket handshake
// ═══════════════════════════════════════════════════════════════════════════════

static std::string base64_encode_ws(const unsigned char* data, std::size_t len)
{
    BIO* b64  = BIO_new(BIO_f_base64());
    BIO* bmem = BIO_new(BIO_s_mem());
    b64 = BIO_push(b64, bmem);
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    BIO_write(b64, data, static_cast<int>(len));
    BIO_flush(b64);
    BUF_MEM* bptr;
    BIO_get_mem_ptr(b64, &bptr);
    std::string result(bptr->data, bptr->length);
    BIO_free_all(b64);
    return result;
}

static std::string ws_accept_key(const std::string& client_key)
{
    const std::string magic    = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const std::string combined = client_key + magic;

    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned int  hash_len = 0;
    EVP_Digest(combined.data(), combined.size(),
               hash, &hash_len, EVP_sha1(), nullptr);

    return base64_encode_ws(hash, hash_len);
}

static bool do_ws_handshake(tcp::socket& s)
{
    std::cout << "[WebSocket] Handshake thread started for a client\n";
    asio::streambuf buf;
    asio::error_code ec;
    std::cout << "[WebSocket] Reading until \\r\\n\\r\\n ...\n";
    asio::read_until(s, buf, "\r\n\r\n", ec);
    std::cout << "[WebSocket] Read completed, ec=" << ec.value() << "\n";
    if (ec) return false;

    std::istream stream(&buf);
    std::string  request((std::istreambuf_iterator<char>(stream)),
                          std::istreambuf_iterator<char>());

    std::string      key;
    std::istringstream ss(request);
    std::string        line;
    while (std::getline(ss, line))
    {
        std::string lower_line = line;
        std::transform(lower_line.begin(), lower_line.end(), lower_line.begin(), ::tolower);
        if (lower_line.find("sec-websocket-key:") != std::string::npos)
        {
            auto pos = line.find(":");
            if (pos != std::string::npos)
            {
                key = line.substr(pos + 1);
                // trim leading spaces
                size_t start = key.find_first_not_of(" \t");
                if (start != std::string::npos) key = key.substr(start);
                
                while (!key.empty() &&
                       (key.back() == '\r' || key.back() == '\n' || key.back() == ' '))
                    key.pop_back();
            }
        }
    }
    if (key.empty()) return false;

    std::string response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + ws_accept_key(key) + "\r\n\r\n";

    asio::write(s, asio::buffer(response), ec);
    return !ec;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WebSocket frame reader
// ═══════════════════════════════════════════════════════════════════════════════

static bool read_ws_frame(tcp::socket& s, std::string& out_payload)
{
    // Loop so that control frames (ping/pong) are consumed transparently.
    while (true)
    {
        asio::error_code ec;

        unsigned char header[2];
        asio::read(s, asio::buffer(header, 2), ec);
        if (ec) return false;

        uint8_t  opcode  = header[0] & 0x0F;
        bool     masked  = (header[1] & 0x80) != 0;
        uint64_t pay_len = header[1] & 0x7F;

        if (pay_len == 126)
        {
            unsigned char ext[2];
            asio::read(s, asio::buffer(ext, 2), ec);
            if (ec) return false;
            pay_len = (uint64_t(ext[0]) << 8) | ext[1];
        }
        else if (pay_len == 127)
        {
            unsigned char ext[8];
            asio::read(s, asio::buffer(ext, 8), ec);
            if (ec) return false;
            pay_len = 0;
            for (int i = 0; i < 8; ++i)
                pay_len = (pay_len << 8) | ext[i];
        }

        unsigned char mask[4] = {0, 0, 0, 0};
        if (masked)
        {
            asio::read(s, asio::buffer(mask, 4), ec);
            if (ec) return false;
        }

        std::vector<unsigned char> payload(pay_len);
        if (pay_len > 0)
        {
            asio::read(s, asio::buffer(payload.data(), pay_len), ec);
            if (ec) return false;
        }

        if (masked)
            for (std::size_t i = 0; i < pay_len; ++i)
                payload[i] ^= mask[i % 4];

        if (opcode == 0x8)
        {
            return false;
        }
        else if (opcode == 0x9)
        {
            // Ping — reply with Pong
            std::vector<unsigned char> pong;
            pong.push_back(0x8A);
            pong.push_back(static_cast<unsigned char>(payload.size() & 0x7F));
            pong.insert(pong.end(), payload.begin(), payload.end());
            asio::write(s, asio::buffer(pong), ec);
            continue;
        }
        else if (opcode == 0xA)
        {
            continue;
        }
        else
        {
            out_payload.assign(payload.begin(), payload.end());
            return true;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Status broadcast
// ═══════════════════════════════════════════════════════════════════════════════

void send_status()
{
    json j;
    j["type"]       = "status";
    j["connected"]  = drone_connected.load();
    j["connection"] = active_connection;

    json ports;
    ports["udp_available"]    = udp_port_bound;
    ports["udp_port"]         = 14550;
    ports["serial_available"] = !detected_serial_port.empty();
    ports["serial_port"]      = detected_serial_port.empty()
                                    ? "Not found" : detected_serial_port;
    ports["active"] = active_connection;
    j["ports"] = ports;

    // ── Multi-vehicle list ────────────────────────────────────────────────
    // When multiple SITL drones all have sysid=1 (ArduPilot default), we
    // assign each a unique ui_sysid based on link_id so the frontend can
    // display and address them independently.
    // get_all_sysids() already returns the correct ui_sysid — we must use
    // the same logic here to produce matching sysid values in the payload.
    {
        json vehicles_arr = json::array();
        if (g_vehicle_manager)
        {

            // Second pass: build the JSON array.
            // Always emit the primary vehicle (link 0) first, then each
            // dynamic UDP link's vehicle separately.
            auto emit_vehicle = [&](std::shared_ptr<Vehicle> veh, int ui_sid)
            {
                if (!veh || !veh->is_alive()) return;
                json v;
                v["sysid"]       = ui_sid;
                v["real_sysid"]  = veh->sysid();   // actual MAVLink sysid
                v["link_id"]     = veh->link_id();
                v["armed"]       = veh->is_armed();
                v["mode"]        = veh->flight_mode_string();
                v["battery_pct"] = veh->battery_remaining();
                v["battery_v"]   = veh->battery_voltage();
                v["gps_fix"]     = veh->gps_fix_type();
                v["num_sats"]    = veh->gps_satellites();
                v["lat"]         = veh->latitude();
                v["lon"]         = veh->longitude();
                v["alt"]         = veh->altitude_msl();
                v["roll"]        = veh->roll();
                v["pitch"]       = veh->pitch();
                v["yaw"]         = veh->yaw();
                v["speed"]       = veh->speed();
                vehicles_arr.push_back(v);
            };

            // Emit all discovered vehicles
            {
                auto all_ui_sids = g_vehicle_manager->get_all_ui_sysids();
                std::set<int> emitted_ui_sids;

                for (int ui_sid : all_ui_sids)
                {
                    auto veh = g_vehicle_manager->get_vehicle_by_ui_sysid(ui_sid);
                    
                    if (veh && emitted_ui_sids.find(ui_sid) == emitted_ui_sids.end())
                    {
                        emitted_ui_sids.insert(ui_sid);
                        emit_vehicle(veh, ui_sid);
                    }
                }
            }


        }
        j["vehicles"] = vehicles_arr;

        // Also list dynamic UDP link endpoints for the Connection Manager UI
        json dyn_links_arr = json::array();
        {
            std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
            for (auto& [port, entry] : g_dyn_udp_links)
            {
                json dl;
                dl["local_port"]  = port;
                dl["remote_ip"]   = entry.remote_ip;
                dl["remote_port"] = entry.remote_port;
                dl["link_id"]     = entry.link_id;
                dyn_links_arr.push_back(dl);
            }
        }
        j["dyn_udp_links"] = dyn_links_arr;
    }

    if (!drone_connected)
        j["message"] = "Waiting for Drone...";

    send_ws_safe(j.dump());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RC channels stream request
// ═══════════════════════════════════════════════════════════════════════════════

static void request_rc_channels_stream()
{
    if (!g_vehicle_manager) return;

    auto vehicle = g_vehicle_manager->get_active_vehicle();
    if (!vehicle)
    {
        std::cout << "[GCS] request_rc_channels_stream: no live vehicle yet\n";
        return;
    }

    mavlink_message_t             msg;
    mavlink_request_data_stream_t rds{};

    rds.target_system    = static_cast<uint8_t>(vehicle->sysid());
    rds.target_component = static_cast<uint8_t>(vehicle->compid());
    rds.req_stream_id    = MAV_DATA_STREAM_RC_CHANNELS;
    rds.req_message_rate = 10;
    rds.start_stop       = 1;

    mavlink_msg_request_data_stream_encode(
        255, MAV_COMP_ID_MISSIONPLANNER, &msg, &rds);

    vehicle->send_mavlink(msg);
    std::cout << "[GCS] Requested RC_CHANNELS stream at 10 Hz\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  request_streams_for_vehicle()
//
//  Per-vehicle version of request_telemetry_streams + request_gps_raw_int.
//  Used for secondary drones discovered on dynamic UDP/serial links so each
//  vehicle gets its own stream negotiation independent of the active vehicle.
// ═══════════════════════════════════════════════════════════════════════════════

// Tracks sysids that have already had streams requested this session.
static std::set<int> g_streams_requested_sysids;
static std::mutex    g_streams_sysids_mutex;

static void request_streams_for_vehicle(std::shared_ptr<Vehicle> vehicle)
{
    if (!vehicle) return;

    // Dedup by ui_sysid (not real sysid) — in multi-port mode all ArduPilot
    // drones default to sysid=1, so keying by real sysid would treat every
    // secondary drone as already-handled and skip their stream setup entirely.
    int ui_sysid = vehicle->ui_sysid();
    int sysid    = vehicle->sysid();

    {
        std::lock_guard<std::mutex> lk(g_streams_sysids_mutex);
        if (g_streams_requested_sysids.count(ui_sysid))
            return;  // already requested — don't spam on every heartbeat
        g_streams_requested_sysids.insert(ui_sysid);
    }

    std::cout << "[GCS] Requesting telemetry streams for sysid=" << sysid
              << " (ui_sysid=" << ui_sysid << ")\n";

    // RC channels
    {
        mavlink_message_t             msg;
        mavlink_request_data_stream_t rds{};
        rds.target_system    = static_cast<uint8_t>(vehicle->sysid());
        rds.target_component = static_cast<uint8_t>(vehicle->compid());
        rds.req_stream_id    = MAV_DATA_STREAM_RC_CHANNELS;
        rds.req_message_rate = 10;
        rds.start_stop       = 1;
        mavlink_msg_request_data_stream_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &rds);
        vehicle->send_mavlink(msg);
    }

    // Telemetry streams: battery, GPS position, attitude, VFR_HUD, raw sensors
    struct StreamReq { uint8_t id; uint16_t rate_hz; const char* label; };
    static const StreamReq streams[] = {
        { MAV_DATA_STREAM_EXTENDED_STATUS, 2,  "EXTENDED_STATUS" },
        { MAV_DATA_STREAM_POSITION,       10,  "POSITION (GPS)"  },
        { MAV_DATA_STREAM_EXTRA1,         20,  "EXTRA1 (ATTITUDE)" },
        { MAV_DATA_STREAM_EXTRA2,         10,  "EXTRA2 (VFR_HUD)"  },
        { MAV_DATA_STREAM_RAW_SENSORS,     2,  "RAW_SENSORS"      },
    };
    for (auto& sr : streams)
    {
        mavlink_message_t             msg;
        mavlink_request_data_stream_t rds{};
        rds.target_system    = static_cast<uint8_t>(vehicle->sysid());
        rds.target_component = static_cast<uint8_t>(vehicle->compid());
        rds.req_stream_id    = sr.id;
        rds.req_message_rate = sr.rate_hz;
        rds.start_stop       = 1;
        mavlink_msg_request_data_stream_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &rds);
        vehicle->send_mavlink(msg);
        std::cout << "[GCS] sysid=" << sysid << " stream " << sr.label
                  << " @ " << sr.rate_hz << " Hz\n";
    }

    // GPS_RAW_INT via modern SET_MESSAGE_INTERVAL
    {
        mavlink_message_t      msg;
        mavlink_command_long_t cmd{};
        cmd.target_system    = static_cast<uint8_t>(vehicle->sysid());
        cmd.target_component = static_cast<uint8_t>(vehicle->compid());
        cmd.command          = MAV_CMD_SET_MESSAGE_INTERVAL;
        cmd.param1           = MAVLINK_MSG_ID_GPS_RAW_INT;
        cmd.param2           = 500000.0f;  // 2 Hz
        mavlink_msg_command_long_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);
        vehicle->send_mavlink(msg);
        std::cout << "[GCS] sysid=" << sysid << " GPS_RAW_INT @ 2 Hz\n";
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  request_telemetry_streams()
//
//  Asks ArduPilot to stream the MAVLink messages the GCS needs for the
//  compass / telemetry panel.  Without an explicit REQUEST_DATA_STREAM the
//  flight controller will not send these messages automatically.
//
//  Stream IDs used:
//    MAV_DATA_STREAM_EXTENDED_STATUS (2) → SYS_STATUS (battery voltage / %).
//    MAV_DATA_STREAM_POSITION        (6) → GLOBAL_POSITION_INT (lat/lon/alt/hdg/vel)
//    MAV_DATA_STREAM_EXTRA1         (10) → ATTITUDE (roll/pitch/yaw)
//    MAV_DATA_STREAM_EXTRA2         (11) → VFR_HUD  (groundspeed/airspeed/throttle)
//    MAV_DATA_STREAM_RAW_SENSORS     (1) → GPS_RAW_INT (satellite count / fix)
// ═══════════════════════════════════════════════════════════════════════════════

static void request_telemetry_streams()
{
    if (!g_vehicle_manager) return;

    auto vehicle = g_vehicle_manager->get_active_vehicle();
    if (!vehicle)
    {
        std::cout << "[GCS] request_telemetry_streams: no live vehicle yet\n";
        return;
    }

    struct StreamReq { uint8_t id; uint16_t rate_hz; const char* label; };

    static const StreamReq streams[] = {
        { MAV_DATA_STREAM_EXTENDED_STATUS, 2,  "EXTENDED_STATUS (SYS_STATUS/battery)" },
        { MAV_DATA_STREAM_POSITION,       10,  "POSITION (GPS)"   },
        { MAV_DATA_STREAM_EXTRA1,         20,  "EXTRA1 (ATTITUDE)" },
        { MAV_DATA_STREAM_EXTRA2,         10,  "EXTRA2 (VFR_HUD)"  },
        { MAV_DATA_STREAM_RAW_SENSORS,     2,  "RAW_SENSORS (GPS_RAW_INT)" },
    };

    for (auto& sr : streams)
    {
        mavlink_message_t             msg;
        mavlink_request_data_stream_t rds{};

        rds.target_system    = static_cast<uint8_t>(vehicle->sysid());
        rds.target_component = static_cast<uint8_t>(vehicle->compid());
        rds.req_stream_id    = sr.id;
        rds.req_message_rate = sr.rate_hz;
        rds.start_stop       = 1;   // 1 = start

        mavlink_msg_request_data_stream_encode(
            255, MAV_COMP_ID_MISSIONPLANNER, &msg, &rds);

        vehicle->send_mavlink(msg);
        std::cout << "[GCS] Requested stream " << sr.label
                  << " at " << sr.rate_hz << " Hz\n";
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  request_gps_raw_int_via_command()
//
//  Uses the modern MAV_CMD_SET_MESSAGE_INTERVAL (511) to ask ArduPilot
//  to stream GPS_RAW_INT (msg ID 24) at 2 Hz.
//
//  REQUEST_DATA_STREAM is deprecated on ArduPilot 4.x and is not reliable
//  for GPS_RAW_INT — using COMMAND_LONG with MAV_CMD_SET_MESSAGE_INTERVAL
//  is the correct approach for firmware >= 4.0.
//
//  interval_us = 500000 → 2 Hz
// ═══════════════════════════════════════════════════════════════════════════════

static void request_gps_raw_int_via_command()
{
    if (!g_vehicle_manager) return;

    auto vehicle = g_vehicle_manager->get_active_vehicle();
    if (!vehicle)
    {
        std::cout << "[GCS] request_gps_raw_int_via_command: no live vehicle\n";
        return;
    }

    mavlink_message_t       msg;
    mavlink_command_long_t  cmd{};

    cmd.target_system    = static_cast<uint8_t>(vehicle->sysid());
    cmd.target_component = static_cast<uint8_t>(vehicle->compid());
    cmd.command          = MAV_CMD_SET_MESSAGE_INTERVAL;  // 511
    cmd.confirmation     = 0;
    cmd.param1           = MAVLINK_MSG_ID_GPS_RAW_INT;    // message ID = 24
    cmd.param2           = 500000.0f;  // interval in microseconds → 2 Hz
    cmd.param7           = 0;          // response target: flight stack default

    mavlink_msg_command_long_encode(
        255, MAV_COMP_ID_MISSIONPLANNER, &msg, &cmd);

    vehicle->send_mavlink(msg);
    std::cout << "[GCS] Sent MAV_CMD_SET_MESSAGE_INTERVAL for GPS_RAW_INT at 2 Hz\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  wire_modules_to_active_vehicle()
// ═══════════════════════════════════════════════════════════════════════════════

static void wire_modules_to_active_vehicle()
{
    if (!g_vehicle_manager) return;

    auto vehicle_ptr = g_vehicle_manager->get_active_vehicle();
    if (!vehicle_ptr) return;

    auto mavlink_via_vehicle =
        [vehicle_ptr](const mavlink_message_t& msg)
        {
            vehicle_ptr->send_mavlink(msg);
        };

    flightMode  .setTransportCallback(mavlink_via_vehicle);
    param_manager.setTransportCallback(mavlink_via_vehicle);

    flightMode  .setVehicleInfo(vehicle_ptr->sysid(), vehicle_ptr->compid());
    param_manager.setVehicleInfo(vehicle_ptr->sysid(), vehicle_ptr->compid());
    param_manager.setCacheKey(vehicle_ptr->ui_sysid());  // unique cache per drone (multi-port safe)

    // Set request spacing based on link baudrate dynamically
    if (g_link_manager)
    {
        auto link = g_link_manager->get_link(vehicle_ptr->link_id());
        if (link && link->get_transport())
        {
            int baud = link->get_transport()->get_baudrate();
            param_manager.setRequestSpacingFromBaudrate(baud);
        }
    }

    std::cout << "[GCS] Sub-modules wired to vehicle sysid="
              << vehicle_ptr->sysid() << " (ui_sysid=" << vehicle_ptr->ui_sysid() << ")\n";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Serial port info struct + forward declaration
//  (defined fully after start_serial_monitor; declared here so the lambdas
//   inside start_serial_monitor can call scan_serial_ports())
// ═══════════════════════════════════════════════════════════════════════════════

struct SerialPortInfo
{
    std::string port;           // "/dev/ttyACM0"  or  "COM3" / "\\\\.\\COM3"
    std::string display;        // friendly display label  ("ttyACM0" / "COM3")
    std::string description;    // product string from USB descriptor or OS
    std::string manufacturer;   // manufacturer string from USB descriptor
};

static std::vector<SerialPortInfo> scan_serial_ports();  // defined below

// ═══════════════════════════════════════════════════════════════════════════════
//  Multi-port serial monitor
//
//  CubeOrange+ exposes 3 virtual COM ports per board via USB:
//    ttyACM0 — MAVLink  (board 1, port 0)  ← open
//    ttyACM1 — secondary CDC               ← skip
//    ttyACM2 — secondary CDC               ← skip
//    ttyACM3 — MAVLink  (board 2, port 0)  ← open
//    ttyACM4 — secondary CDC               ← skip
//    ttyACM5 — secondary CDC               ← skip
//
//  The MAVLink port is always the FIRST of the three (index 0, 3, 6, …).
//  We open one SerialTransport per board, each on its own link_id.
// ═══════════════════════════════════════════════════════════════════════════════

struct SerialPortState {
    std::shared_ptr<SerialTransport> transport;
    int                              link_id = -1;
};

static std::map<std::string, SerialPortState> g_serial_ports;
static std::mutex                             g_serial_ports_mutex;

// Returns MAVLink-capable serial ports.
//
// Strategy: read the USB interface number from sysfs.
//   CubeOrange+: 3 interfaces per board (0=MAVLink, 1=secondary, 2=secondary)
//   Other boards (Pixhawk, Holybro, etc.): 1 interface — always open it.
//
// For any ttyACM port we cannot read sysfs for, we fall back to opening it
// and letting VehicleManager's heartbeat filter decide (non-FC heartbeats
// are silently ignored; no harm done).
//
// ttyUSB ports (FTDI/CH340) are always single-purpose MAVLink — open all.
static std::vector<std::string> find_mavlink_serial_ports()
{
    std::vector<std::string> result;

#if defined(_WIN32) || defined(_WIN64)
    // ── Windows ──────────────────────────────────────────────────────────────
    // Read COM port names from the registry — same source as scan_serial_ports().
    // Returns "\\\\.\\COMn" paths which SerialTransport / CreateFile can open.
    HKEY hSerial = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE,
                      "HARDWARE\\DEVICEMAP\\SERIALCOMM",
                      0, KEY_READ, &hSerial) == ERROR_SUCCESS)
    {
        DWORD idx = 0;
        char  valName[512], valData[512];
        DWORD nameLen, dataLen, valType;

        while (true)
        {
            nameLen = sizeof(valName);
            dataLen = sizeof(valData);
            LONG rc = RegEnumValueA(hSerial, idx++,
                                    valName, &nameLen,
                                    nullptr, &valType,
                                    reinterpret_cast<LPBYTE>(valData), &dataLen);
            if (rc != ERROR_SUCCESS) break;
            if (valType != REG_SZ)   continue;

            // Use the "\\\\.\\COMn" form so CreateFile works for COM10+.
            std::string port = std::string("\\\\.\\") + valData;
            result.push_back(port);
        }
        RegCloseKey(hSerial);

        // Sort numerically: COM1, COM2, COM10, …
        std::sort(result.begin(), result.end(),
                  [](const std::string& a, const std::string& b)
                  {
                      auto num = [](const std::string& s) -> int {
                          auto pos = s.find_first_of("0123456789");
                          if (pos == std::string::npos) return 0;
                          try { return std::stoi(s.substr(pos)); } catch (...) { return 0; }
                      };
                      return num(a) < num(b);
                  });
    }

#else
    // ── Linux ─────────────────────────────────────────────────────────────────
    // Scan all ttyACM ports
    for (int i = 0; i <= 20; ++i)
    {
        std::string port = "/dev/ttyACM" + std::to_string(i);
        if (!std::filesystem::exists(port)) continue;

        // Read the USB interface number from sysfs to skip secondary CDC ports.
        // Path: /sys/class/tty/ttyACMn/device -> USB interface
        // The interface number is the last component of the symlink target.
        bool skip = false;
        try
        {
            std::string syslink = "/sys/class/tty/ttyACM" + std::to_string(i) + "/device";
            if (std::filesystem::is_symlink(syslink))
            {
                auto target = std::filesystem::read_symlink(syslink).string();
                // Target ends with something like "1-1.2:1.0" — the ".N" is
                // the interface number.  Interface 0 = MAVLink, 1 and 2 = skip.
                auto dot = target.rfind('.');
                if (dot != std::string::npos)
                {
                    int iface = std::stoi(target.substr(dot + 1));
                    if (iface != 0) skip = true;
                }
            }
        }
        catch (...) { /* sysfs not available — open anyway */ }

        if (!skip)
            result.push_back(port);
    }

    // All ttyUSB ports (FTDI / CH340 single-port adapters)
    for (int i = 0; i <= 9; ++i)
    {
        std::string p = "/dev/ttyUSB" + std::to_string(i);
        if (std::filesystem::exists(p))
            result.push_back(p);
    }
#endif

    return result;
}

static void push_port_list_to_ui()
{
    auto live_ports = scan_serial_ports();
    json sp;
    sp["type"] = "serial_ports";
    json sp_arr = json::array();
    for (auto& p : live_ports) {
        json e;
        e["port"]         = p.port;
        e["display"]      = p.display;
        e["description"]  = p.description;
        e["manufacturer"] = p.manufacturer;
        e["board_id"]     = "";
        e["brand"]        = "";
        sp_arr.push_back(e);
    }
    sp["ports"] = sp_arr;
    send_ws_safe(sp.dump());
}

void start_serial_monitor(asio::io_context& io,
                          LinkManager&      link_manager,
                          CommandManager&   cmd_manager)
{
    std::thread([&io, &link_manager, &cmd_manager]()
    {
        // Ports that failed to open: maps port → time of last failure.
        // We skip retry for 30 s so Bluetooth/SLCAN/other non-MAVLink ports
        // don't spam the log every 2 seconds.
        std::map<std::string, std::chrono::steady_clock::time_point> failed_ports;
        constexpr auto RETRY_INTERVAL = std::chrono::seconds(30);

        // Track which ports were in the registry last scan so we can clear
        // the blacklist when a port disappears and reappears (re-plug).
        std::set<std::string> prev_registry_ports;

        // Auto-baudrate detection sequence (same sequence QGC / MP try)
        const std::vector<int> AUTO_BAUDRATES = { 921600, 115200, 57600 };
        std::map<std::string, std::size_t> port_baudrate_index;

        struct ActiveBaudrateProbe {
            std::string port_name;
            int baudrate;
            std::shared_ptr<SerialTransport> transport;
            std::chrono::steady_clock::time_point opened_time;
        };
        std::map<int, ActiveBaudrateProbe> active_baudrate_probes;

        while (true)
        {
            std::this_thread::sleep_for(std::chrono::seconds(2));

            if (firmware_flashing.load()) continue;

            auto mavlink_ports = find_mavlink_serial_ports();

            // Clear blacklist entries for ports no longer in the registry
            // (they were unplugged → if they reappear they should be retried).
            {
                std::set<std::string> cur_set(mavlink_ports.begin(), mavlink_ports.end());
                for (auto it = failed_ports.begin(); it != failed_ports.end(); )
                {
                    if (cur_set.find(it->first) == cur_set.end())
                        it = failed_ports.erase(it);
                    else
                        ++it;
                }
                prev_registry_ports = cur_set;
            }

            auto now = std::chrono::steady_clock::now();

            // ── Auto-Baudrate connection check ──────────────────────────────
            for (auto it = active_baudrate_probes.begin(); it != active_baudrate_probes.end(); )
            {
                int link_id = it->first;
                auto& probe = it->second;
                auto link = link_manager.get_link(link_id);

                if (!link || !probe.transport)
                {
                    it = active_baudrate_probes.erase(it);
                    continue;
                }

                uint64_t msg_count = link->get_valid_msg_count();
                if (msg_count > 0)
                {
                    std::cout << "[Serial] Connection locked on " << probe.port_name
                              << " at " << probe.baudrate << " baud (" << msg_count << " msgs)\n";
                    it = active_baudrate_probes.erase(it);
                    continue;
                }

                const auto age_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - probe.opened_time).count();
                
                // Speed up connection:
                // 1. If we got absolutely 0 bytes of raw activity for 1500 ms, we know the baudrate is wrong.
                // 2. If we got bytes but no valid MAVLink packets after 3000 ms, the baudrate is wrong.
                bool baudrate_failed = false;
                std::string reason;

                if (age_ms >= 1500 && !probe.transport->is_active())
                {
                    baudrate_failed = true;
                    reason = "no raw bytes received after 1.5s";
                }
                else if (age_ms >= 3000)
                {
                    baudrate_failed = true;
                    reason = "no valid MAVLink packets after 3.0s";
                }

                if (baudrate_failed)
                {
                    std::cout << "[Serial] " << reason << " on " << probe.port_name
                              << " at " << probe.baudrate << " baud — trying next baudrate...\n";

                    // Close the port and delete from active serial ports so it will be retried
                    std::unique_lock<std::mutex> lock(g_serial_ports_mutex);
                    auto sp_it = g_serial_ports.find(probe.port_name);
                    if (sp_it != g_serial_ports.end())
                    {
                        sp_it->second.transport->stop();
                        g_serial_ports.erase(sp_it);
                    }
                    lock.unlock();

                    // If we were using this link as the legacy global link, clear it
                    if (serial_link_id.load() == link_id)
                    {
                        serial_link_id.store(-1);
                        serial_transport.reset();
                        detected_serial_port.clear();
                    }

                    // Cycle to the next baudrate
                    std::size_t next_idx = port_baudrate_index[probe.port_name] + 1;
                    if (next_idx >= AUTO_BAUDRATES.size())
                    {
                        next_idx = 0;  // wrap around
                        // Add to failed_ports blacklist for 30s to avoid spinning forever on noise
                        failed_ports[probe.port_name] = now;
                    }
                    port_baudrate_index[probe.port_name] = next_idx;

                    it = active_baudrate_probes.erase(it);
                    continue;
                }

                ++it;
            }

            // ── Open newly appeared ports ─────────────────────────────────────
            for (const auto& port : mavlink_ports)
            {
                std::unique_lock<std::mutex> lock(g_serial_ports_mutex);
                if (g_serial_ports.count(port)) continue;   // already open
                lock.unlock();

                // Skip ports that recently failed — avoid log spam
                auto fit = failed_ports.find(port);
                if (fit != failed_ports.end() && (now - fit->second) < RETRY_INTERVAL)
                    continue;

                // Get the current baudrate to try
                std::size_t b_idx = 0;
                auto b_it = port_baudrate_index.find(port);
                if (b_it != port_baudrate_index.end()) {
                    b_idx = b_it->second;
                } else {
                    port_baudrate_index[port] = 0;
                }
                int baudrate_to_try = AUTO_BAUDRATES[b_idx];

                std::cout << "[Serial] New MAVLink port: " << port << " — trying " << baudrate_to_try << " baud\n";

                if (g_firmware_manager && g_firmware_manager->has_pending_install())
                {
                    json port_evt;
                    port_evt["type"] = "port_appeared";
                    port_evt["port"] = port;
                    send_ws_safe(port_evt.dump());
                    push_port_list_to_ui();
                    firmware_flashing.store(true);
                    g_firmware_manager->install_from_port(port);
                    continue;
                }

                try
                {
                    auto new_serial = std::make_shared<SerialTransport>(io, port, baudrate_to_try);
                    if (!new_serial->is_open()) {
                        std::cout << "[Serial] Could not open " << port << " at " << baudrate_to_try << " baud\n";
                        failed_ports[port] = now;
                        continue;
                    }

                    int lid = link_manager.add_link(new_serial, io);
                    link_manager.start_link(lid);
                    std::cout << "[Serial] Ready on " << port
                              << " link_id=" << lid << " at " << baudrate_to_try << " baud\n";

                    // Track this link for baudrate probing
                    ActiveBaudrateProbe probe;
                    probe.port_name = port;
                    probe.baudrate = baudrate_to_try;
                    probe.transport = new_serial;
                    probe.opened_time = now;
                    active_baudrate_probes[lid] = probe;

                    {
                        std::lock_guard<std::mutex> lk(g_serial_ports_mutex);
                        SerialPortState state;
                        state.transport = new_serial;
                        state.link_id   = lid;
                        g_serial_ports[port] = std::move(state);
                    }

                    // Keep legacy globals in sync (first opened port wins)
                    if (serial_link_id.load() == -1)
                    {
                        serial_transport     = new_serial;
                        detected_serial_port = port;
                        serial_link_id       = lid;
                    }

                    // Remove from blacklist on success
                    failed_ports.erase(port);

                    json port_evt;
                    port_evt["type"] = "port_appeared";
                    port_evt["port"] = port;
                    send_ws_safe(port_evt.dump());
                    push_port_list_to_ui();
                }
                catch (...)
                {
                    std::cout << "[Serial] Failed to open " << port << "\n";
                    failed_ports[port] = now;
                }
            }


            // ── Detect unplugged ports ────────────────────────────────────────
            {
                // Helper: check whether a port path still refers to a real device.
                // On Linux  : std::filesystem::exists() works for /dev/ttyXXX.
                // On Windows: \\\\.\\COMn is a device path — filesystem::exists()
                //             returns false even when the device IS present, so we
                //             use a quick CreateFile probe instead.
                auto port_still_exists = [](const std::string& port) -> bool {
#if defined(_WIN32) || defined(_WIN64)
                    HANDLE h = CreateFileA(port.c_str(),
                                           GENERIC_READ,
                                           0,      // no sharing — just probe
                                           nullptr,
                                           OPEN_EXISTING,
                                           FILE_ATTRIBUTE_NORMAL,
                                           nullptr);
                    if (h != INVALID_HANDLE_VALUE) {
                        CloseHandle(h);
                        return true;
                    }
                    DWORD err = GetLastError();
                    // ERROR_ACCESS_DENIED  (5)  → port exists, another process owns it
                    // ERROR_SHARING_VIOLATION (32) → port exists, currently open by us
                    // ERROR_FILE_NOT_FOUND (2)  → port gone
                    return (err == ERROR_ACCESS_DENIED || err == ERROR_SHARING_VIOLATION);
#else
                    return std::filesystem::exists(port);
#endif
                };

                std::lock_guard<std::mutex> lock(g_serial_ports_mutex);

                for (auto it = g_serial_ports.begin(); it != g_serial_ports.end(); )
                {
                    // A port is dead if:
                    //  (a) it physically disappeared from the OS (unplugged), OR
                    //  (b) ASIO closed it internally after a receive error.
                    //      do_receive() now calls serial_.close() on error so
                    //      is_open() returns false — zombie-port detection.
                    //      Without this check a USB glitch would leave the port
                    //      "present" but not reading, and the vehicle manager
                    //      would timeout-evict the vehicle every ~5 s without
                    //      ever recovering the serial read loop.
                    bool transport_dead = it->second.transport &&
                                         !it->second.transport->is_open();
                    bool device_gone   = !port_still_exists(it->first);

                    if (device_gone || transport_dead)
                    {
                        std::cout << "[Serial] "
                                  << (transport_dead ? "Dead (internal error)" : "Unplugged")
                                  << ": " << it->first
                                  << " link_id=" << it->second.link_id << "\n";

                        json port_evt;
                        port_evt["type"] = "port_disappeared";
                        port_evt["port"] = it->first;
                        send_ws_safe(port_evt.dump());

                        if (it->first == detected_serial_port)
                        {
                            serial_transport     = nullptr;
                            detected_serial_port = {};
                            serial_link_id       = -1;
                        }

                        it = g_serial_ports.erase(it);
                    }
                    else { ++it; }
                }

                // ── Fallback to UDP when all serial ports are gone ────────────────
                // Use a static flag so we only act ONCE on the transition,
                // not every 2 s loop iteration.  drone_connected is owned
                // exclusively by the HEARTBEAT handler — we must not touch it
                // here, otherwise a live UDP drone appears to disconnect every
                // 2 seconds.
                static bool serial_was_present = false;

                if (!g_serial_ports.empty())
                {
                    serial_was_present = true;
                }
                else if (serial_was_present)
                {
                    // Transition: had serial, now gone — fall back to UDP once.
                    serial_was_present = false;

                    if (udp_transport && udp_transport->is_active())
                    {
                        active_connection = "UDP";
                        cmd_manager.set_transport(udp_transport);
                        std::cout << "[GCS] All serial ports gone — fell back to UDP\n";
                    }
                    else
                    {
                        active_connection = "NONE";
                        drone_connected   = false;  // no serial AND no UDP → truly offline
                    }
                    push_port_list_to_ui();
                    send_status();
                }
                // else: still no serial and we already handled the transition — do nothing.
            }
        }
    }).detach();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Cross-platform serial port scanner
//  Returns a vector of structs, each describing one discovered port.
//  Linux : scans /dev/ttyACM*, /dev/ttyUSB* and sysfs-verified /dev/ttyS0-9
//  Windows: reads HKLM\HARDWARE\DEVICEMAP\SERIALCOMM from the registry and
//           augments with friendly names from HKLM\SYSTEM\CurrentControlSet\
//           Enum\USB (best-effort; absent entries are left blank).
// ═══════════════════════════════════════════════════════════════════════════════

static std::vector<SerialPortInfo> scan_serial_ports()
{
    std::vector<SerialPortInfo> result;

#if defined(_WIN32) || defined(_WIN64)
    // ── Windows ──────────────────────────────────────────────────────────────
    // Primary source: HKLM\HARDWARE\DEVICEMAP\SERIALCOMM
    //   Each value  name  = driver registry path  (ignored)
    //   Each value  data  = friendly port name     ("COM3")
    HKEY hSerial = nullptr;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE,
                      "HARDWARE\\DEVICEMAP\\SERIALCOMM",
                      0, KEY_READ, &hSerial) == ERROR_SUCCESS)
    {
        DWORD idx = 0;
        char  valName[512], valData[512];
        DWORD nameLen, dataLen, valType;

        while (true)
        {
            nameLen = sizeof(valName);
            dataLen = sizeof(valData);
            LONG rc = RegEnumValueA(hSerial, idx++,
                                    valName, &nameLen,
                                    nullptr, &valType,
                                    reinterpret_cast<LPBYTE>(valData), &dataLen);
            if (rc != ERROR_SUCCESS) break;
            if (valType != REG_SZ)   continue;

            SerialPortInfo p;
            p.display = valData;                       // e.g. "COM3"
            p.port    = "\\\\.\\" + std::string(valData); // "\\.\COM3" for CreateFile
            p.description   = valData;
            p.manufacturer  = "";

            // Best-effort: look for a friendly name under
            // HKLM\SYSTEM\CurrentControlSet\Enum — iterate USB subtree
            // (silently skip if not found; not worth failing over)
            result.push_back(std::move(p));
        }
        RegCloseKey(hSerial);
    }

    // Sort COM ports numerically: COM1, COM2, COM10, …
    std::sort(result.begin(), result.end(),
              [](const SerialPortInfo& a, const SerialPortInfo& b)
              {
                  auto num = [](const std::string& s) -> int {
                      auto pos = s.find_first_of("0123456789");
                      if (pos == std::string::npos) return 0;
                      try { return std::stoi(s.substr(pos)); } catch (...) { return 0; }
                  };
                  return num(a.display) < num(b.display);
              });

#else
    // ── Linux ─────────────────────────────────────────────────────────────────
    namespace fs = std::filesystem;

    // Helper: read first line from a file, trim trailing whitespace
    auto read_line = [](const std::string& path) -> std::string {
        std::ifstream f(path);
        if (!f) return {};
        std::string s;
        std::getline(f, s);
        while (!s.empty() && (s.back() == '\n' || s.back() == '\r' ||
                               s.back() == ' '  || s.back() == '\t'))
            s.pop_back();
        return s;
    };

    std::vector<fs::path> candidates;

    try {
        for (auto& entry : fs::directory_iterator("/dev"))
        {
            const auto fname = entry.path().filename().string();
            if (fname.rfind("ttyACM", 0) == 0 ||
                fname.rfind("ttyUSB", 0) == 0)
            {
                candidates.push_back(entry.path());
            }
        }
    } catch (...) {}

    // NOTE: ttyS* (ISA/PCI serial) are intentionally excluded.
    // On most modern systems these exist as ghost devices even with no real
    // hardware behind them, producing a noisy list.  For drone flight
    // controllers, ttyACM (USB CDC) and ttyUSB (FTDI/CH340) are the only
    // relevant port types.  Re-add ttyS here if your hardware requires it.

    std::sort(candidates.begin(), candidates.end());

    for (auto& devpath : candidates)
    {
        SerialPortInfo p;
        p.port    = devpath.string();
        p.display = devpath.filename().string();

        // Walk sysfs to find manufacturer / product strings
        // Typical path for USB CDC:
        //   /sys/class/tty/<n>/device -> ../../<usb-interface>
        //                                   ../  <usb-device>
        const std::string fname   = p.display;
        const std::string sysbase = "/sys/class/tty/" + fname + "/device/";

        // Try one and two levels up (covers both ttyACM and ttyUSB layouts)
        std::string mfr, prod;
        for (const std::string& up : { std::string("../"), std::string("../../") })
        {
            if (mfr.empty())  mfr  = read_line(sysbase + up + "manufacturer");
            if (prod.empty()) prod = read_line(sysbase + up + "product");
            if (!mfr.empty() && !prod.empty()) break;
        }

        p.manufacturer = mfr;

        if (!prod.empty())
            p.description = prod;
        else if (fname.rfind("ttyACM", 0) == 0)
            p.description = "USB CDC ACM";
        else if (fname.rfind("ttyUSB", 0) == 0)
            p.description = "USB-UART Bridge";
        else
            p.description = "Serial Port";

        result.push_back(std::move(p));
    }
#endif

    return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WebSocket server
// ═══════════════════════════════════════════════════════════════════════════════

void start_websocket(CommandManager* cmd_manager,
                     LinkManager*     link_manager,
                     asio::io_context& io)
{
    std::thread([cmd_manager]()
    {
        asio::io_context io;
        tcp::acceptor acceptor(io, tcp::endpoint(tcp::v4(), 9002));
        acceptor.set_option(asio::socket_base::reuse_address(true));
        std::cout << "[WebSocket] Listening on 9002\n";

        while (true)
        {
            tcp::socket socket(io);
            asio::error_code accept_ec;
            acceptor.accept(socket, accept_ec);
            
            if (accept_ec)
            {
                std::cout << "[WebSocket] Accept error: " << accept_ec.message() << "\n";
                continue;
            }

            auto client = std::make_shared<tcp::socket>(std::move(socket));

            std::thread([cmd_manager, client]()
            {
                if (!do_ws_handshake(*client))
                {
                    std::cout << "[WebSocket] Handshake failed — rejected\n";
                    return;
                }

                std::cout << "[WebSocket] Client connected\n";

                // Wrap the socket in a WsClient so every sender gets its own mutex.
                auto entry = std::make_shared<WsClient>();
                entry->socket = client;

                {
                    std::lock_guard<std::mutex> lock(ws_mutex);
                    ws_clients.push_back(entry);
                }

                send_status();
                flightMode.pushStatus();

                try
                {
                    while (true)
                    {
                        std::string payload;
                        if (!read_ws_frame(*client, payload)) break;
                        if (payload.empty()) continue;

                        std::cout << "[WS] Received: " << payload << "\n";

                        try
                        {
                            auto        j    = json::parse(payload);
                            std::string type = j.value("type", "");

                            if (type == "ping")
                            {
                                // silently ignore
                            }

                            else if (type == "request")
                            {
                                std::string req = j.value("request", "");
                                std::cout << "[WS] Request: " << req << "\n";
                                send_status();
                                flightMode.pushStatus();
                            }

                            else if (type == "command")
                            {
                                std::string cmd_name  = j.value("command", "");
                                int         id        = j.value("id", 0);
                                int         sysid     = j.value("sysid", -1);  // ← multi-vehicle
                                float       p1 = 0, p2 = 0;
                                std::string mode_name;

                                if (j.contains("params") && j["params"].is_object())
                                {
                                    p1        = j["params"].value("altitude", 0.0f);
                                    p2        = j["params"].value("speed",    0.0f);
                                    mode_name = j["params"].value("mode",     "");
                                }

                                // ── Route to specific vehicle when sysid provided ─────
                                // When the frontend sends sysid > 0 we look up the exact
                                // Vehicle and tell CommandManager to use it for this send
                                // cycle.  Falls back to get_active_vehicle() (unchanged
                                // single-drone behaviour) when sysid is absent or unknown.
                                std::shared_ptr<Vehicle> target_veh = nullptr;
                                if (sysid > 0 && g_vehicle_manager)
                                {
                                    target_veh = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);
                                    if (!target_veh)
                                        std::cout << "[WS] command: unknown ui_sysid="
                                                  << sysid << " — using active vehicle\n";
                                }

                                if (!cmd_name.empty())
                                    cmd_manager->add_command(id, cmd_name, p1, p2, mode_name, target_veh);
                                cmd_manager->process();
                            }

                            else if (type == "mission")
                            {
                                int sysid = j.value("sysid", -1);
                                uint8_t target_sysid = 1;
                                uint8_t target_compid = 0;
                                std::shared_ptr<Vehicle> target_veh_shared;

                                if (sysid > 0 && g_vehicle_manager) {
                                    auto target = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);
                                    if (target) {
                                        target_sysid = target->sysid();
                                        target_compid = target->compid();
                                        target_veh_shared = target;
                                    } else {
                                        auto active = g_vehicle_manager->get_active_vehicle();
                                        if (active) {
                                            target_sysid = active->sysid();
                                            target_compid = active->compid();
                                            target_veh_shared = active;
                                        }
                                    }
                                } else if (g_vehicle_manager) {
                                    auto active = g_vehicle_manager->get_active_vehicle();
                                    if (active) {
                                        target_sysid = active->sysid();
                                        target_compid = active->compid();
                                        target_veh_shared = active;
                                    }
                                }

                                if (j.contains("waypoints") && j["waypoints"].is_array())
                                {
                                    std::vector<WaypointItem> wps;

                                    for (auto& wp : j["waypoints"])
                                    {
                                        WaypointItem item{};
                                        item.seq          = static_cast<uint16_t>(
                                                                wp.value("seq", 0));
                                        item.frame        = static_cast<uint8_t>(
                                                                wp.value("frame",
                                                                    static_cast<int>(
                                                                        MAV_FRAME_GLOBAL_RELATIVE_ALT_INT)));
                                        item.command      = static_cast<uint16_t>(
                                                                wp.value("command",
                                                                    static_cast<int>(
                                                                        MAV_CMD_NAV_WAYPOINT)));
                                        item.hold_time    = wp.value("param1",    0.0f);
                                        item.autocontinue = wp.value("autocontinue", true);
                                        item.lat          = wp.value("latitude",  0.0f);
                                        item.lng          = wp.value("longitude", 0.0f);
                                        item.altitude     = wp.value("altitude",  0.0f);
                                        wps.push_back(item);
                                    }

                                    if (!wps.empty())
                                        // Pass the resolved vehicle so the handshake
                                        // uses its own link/transport (multi-vehicle fix)
                                        cmd_manager->upload_mission(
                                            j.value("id", 0), wps,
                                            target_sysid, target_compid,
                                            target_veh_shared.get());
                                }
                            }

                            // ── flight_plan — "Send Markers" rich JSON path ───────────
                            // Frontend sends:
                            //   { type:"flight_plan", id:<ts>,
                            //     data:{ drone_id, flight_plan:{ waypoints:[...] }, status } }
                            // Each waypoint has: latitude, longitude, altitude, action
                            // We convert to WaypointItems and call upload_mission() so the
                            // same MAVLink handshake (MISSION_COUNT / MISSION_ITEM) is used.
                            // Reply: { type:"flight_plan_ack", status:"success"|"error" }
                            // ─────────────────────────────────────────────────────────
                            else if (type == "flight_plan")
                            {
                                std::cout << "[WS] flight_plan received — converting to mission upload\n";

                                auto send_fp_ack = [&](bool ok, const std::string& msg_str) {
                                    json ack;
                                    ack["type"]    = "flight_plan_ack";
                                    ack["status"]  = ok ? "success" : "error";
                                    ack["message"] = msg_str;
                                    send_ws_safe(ack.dump());
                                };

                                try {
                                    // Navigate: data → flight_plan → waypoints
                                    if (!j.contains("data") || !j["data"].is_object() ||
                                        !j["data"].contains("flight_plan") ||
                                        !j["data"]["flight_plan"].contains("waypoints") ||
                                        !j["data"]["flight_plan"]["waypoints"].is_array())
                                    {
                                        std::cout << "[WS] flight_plan: missing data.flight_plan.waypoints\n";
                                        send_fp_ack(false, "Missing waypoints in flight_plan payload");
                                    }
                                    else
                                    {
                                        auto& fp_wps = j["data"]["flight_plan"]["waypoints"];
                                        std::vector<WaypointItem> wps;

                                        // ── ArduPilot mission protocol requirement ────────────────
                                        // seq=0 MUST be the home/origin item.  ArduPilot skips it at
                                        // runtime and starts execution from seq=1.  Without this, the
                                        // first real waypoint occupies seq=0 and is never visited.
                                        // We use the first waypoint's coordinates as the home position
                                        // (the drone remembers its actual launch point separately).
                                        // ─────────────────────────────────────────────────────────
                                        if (!fp_wps.empty())
                                        {
                                            WaypointItem home{};
                                            home.seq          = 0;
                                            home.frame        = static_cast<uint8_t>(
                                                                    MAV_FRAME_GLOBAL_RELATIVE_ALT_INT);
                                            home.command      = static_cast<uint16_t>(MAV_CMD_NAV_WAYPOINT);
                                            home.hold_time    = 0.0f;
                                            home.autocontinue = true;
                                            home.lat          = fp_wps[0].value("latitude",  0.0);
                                            home.lng          = fp_wps[0].value("longitude", 0.0);
                                            home.altitude     = fp_wps[0].value("altitude",  50.0f);
                                            wps.push_back(home);
                                        }

                                        uint16_t seq = 1;  // actual mission items start at seq=1
                                        for (auto& wp : fp_wps)
                                        {
                                            WaypointItem item{};
                                            item.frame        = static_cast<uint8_t>(
                                                                    MAV_FRAME_GLOBAL_RELATIVE_ALT_INT);
                                            item.hold_time    = 0.0f;
                                            item.autocontinue = true;
                                            item.lat          = wp.value("latitude",  0.0);
                                            item.lng          = wp.value("longitude", 0.0);
                                            item.altitude     = wp.value("altitude",  50.0f);

                                            std::string action = wp.value("action", "move");

                                            if (action == "return")
                                            {
                                                // ── RTL needs TWO items ───────────────────────────────
                                                // MAV_CMD_NAV_RETURN_TO_LAUNCH (20) IGNORES the lat/lon
                                                // in its mission item — it fires RTL from wherever the
                                                // drone currently is.  Without a preceding NAV_WAYPOINT
                                                // at the target coords, RTL triggers at the PREVIOUS wp.
                                                //
                                                // Fix: emit a NAV_WAYPOINT first (fly-to), then the RTL
                                                // command so RTL fires only after the drone arrives.
                                                // ─────────────────────────────────────────────────────
                                                item.seq     = seq++;
                                                item.command = static_cast<uint16_t>(MAV_CMD_NAV_WAYPOINT);
                                                wps.push_back(item);  // item 1: fly to the wp coords

                                                WaypointItem rtl{};
                                                rtl.seq          = seq++;
                                                rtl.frame        = item.frame;
                                                rtl.command      = static_cast<uint16_t>(MAV_CMD_NAV_RETURN_TO_LAUNCH);
                                                rtl.hold_time    = 0.0f;
                                                rtl.autocontinue = true;
                                                rtl.lat          = item.lat;   // coords ignored by ArduPilot
                                                rtl.lng          = item.lng;
                                                rtl.altitude     = item.altitude;
                                                wps.push_back(rtl);   // item 2: trigger RTL on arrival
                                            }
                                            else if (action == "land")
                                            {
                                                item.seq     = seq++;
                                                item.command = static_cast<uint16_t>(MAV_CMD_NAV_LAND);
                                                wps.push_back(item);
                                            }
                                            else if (action == "hover")
                                            {
                                                item.seq     = seq++;
                                                item.command = static_cast<uint16_t>(MAV_CMD_NAV_LOITER_UNLIM);
                                                wps.push_back(item);
                                            }
                                            else  // "move" or any unknown → standard waypoint
                                            {
                                                item.seq     = seq++;
                                                item.command = static_cast<uint16_t>(MAV_CMD_NAV_WAYPOINT);
                                                wps.push_back(item);
                                            }
                                        }

                                        if (wps.size() <= 1)  // only home item → no real waypoints
                                        {
                                            send_fp_ack(false, "No waypoints in flight_plan");
                                        }
                                        else
                                        {
                                            int sysid = j.value("sysid", -1);
                                            uint8_t target_sysid = 1;
                                            uint8_t target_compid = 0;
                                            std::shared_ptr<Vehicle> target_veh_shared;

                                            if (sysid > 0 && g_vehicle_manager) {
                                                // BUG FIX: was get_vehicle(sysid) — must use
                                                // get_vehicle_by_ui_sysid() since all SITL
                                                // drones share sysid=1
                                                auto target = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);
                                                if (target) {
                                                    target_sysid = target->sysid();
                                                    target_compid = target->compid();
                                                    target_veh_shared = target;
                                                } else {
                                                    auto active = g_vehicle_manager->get_active_vehicle();
                                                    if (active) {
                                                        target_sysid = active->sysid();
                                                        target_compid = active->compid();
                                                        target_veh_shared = active;
                                                    }
                                                }
                                            } else if (g_vehicle_manager) {
                                                auto active = g_vehicle_manager->get_active_vehicle();
                                                if (active) {
                                                    target_sysid = active->sysid();
                                                    target_compid = active->compid();
                                                    target_veh_shared = active;
                                                }
                                            }

                                            std::cout << "[WS] flight_plan: uploading "
                                                      << (wps.size() - 1)
                                                      << " waypoint(s) + home via MAVLink"
                                                      << " to ui_sysid=" << sysid << "\n";
                                            // Pass the resolved vehicle so the handshake
                                            // goes through the correct drone's link
                                            cmd_manager->upload_mission(
                                                j.value("id", 0), wps,
                                                target_sysid, target_compid,
                                                target_veh_shared.get());
                                            send_fp_ack(true, "Flight plan uploaded successfully");
                                        }
                                    }
                                }
                                catch (const std::exception& ex)
                                {
                                    std::cout << "[WS] flight_plan error: " << ex.what() << "\n";
                                    send_fp_ack(false, std::string("Exception: ") + ex.what());
                                }
                            }

                            // ── Video streaming: spawn/kill Python MJPEG server ──────────
                            // Frontend sends: { type:"start_video", rtsp_url:"rtsp://..." }
                            // Backend spawns: python video_server.py <rtsp_url> 5001
                            // Frontend then shows <img src="http://localhost:5001/video">
                            // ─────────────────────────────────────────────────────────────
                            else if (type == "start_video")
                            {
                                std::string rtsp_url = j.value("rtsp_url", "");
                                if (rtsp_url.empty())
                                {
                                    send_ws_safe(R"({"type":"video_status","status":"error","message":"No RTSP URL provided"})");
                                }
                                else
                                {
                                    std::cout << "[Video] start_video: " << rtsp_url << "\n";

                                    // Find video_server relative to CWD
                                    std::vector<std::string> candidates = {
                                        "video_server.exe",
                                        "..\\video_server.exe",
                                        "..\\..\\video_server.exe",
                                        "..\\..\\..\\video_server.exe",
                                        "video_server.py",
                                        "..\\video_server.py",
                                        "..\\..\\video_server.py",
                                        "..\\..\\..\\video_server.py"
                                    };
                                    std::string script_path;
                                    for (auto& c : candidates) {
                                        if (GetFileAttributesA(c.c_str()) != INVALID_FILE_ATTRIBUTES) {
                                            script_path = c;
                                            break;
                                        }
                                    }

                                    if (script_path.empty()) {
                                        std::cout << "[Video] video_server executable/script not found!\n";
                                        send_ws_safe(R"({"type":"video_status","status":"error","message":"video_server not found."})");
                                    } else {
#ifdef _WIN32
                                        bool spawned = video_start_internal(script_path, rtsp_url);
                                        (void)spawned;
#else
                                        bool is_py = (script_path.length() >= 3 && script_path.substr(script_path.length() - 3) == ".py");
                                        if (is_py) {
                                            system(("python3 \"" + script_path + "\" \"" + rtsp_url + "\" 5001 >/dev/null 2>&1 &").c_str());
                                        } else {
                                            system(("\"" + script_path + "\" \"" + rtsp_url + "\" 5001 >/dev/null 2>&1 &").c_str());
                                        }
#endif
                                        // Notify browser after Python has had time to bind port 5001
                                        std::thread([]() {
                                            std::this_thread::sleep_for(std::chrono::milliseconds(1500));
                                            send_ws_safe(R"({"type":"video_status","status":"ready","url":"http://localhost:5001/video"})");
                                        }).detach();
                                    }
                                }
                            }

                            else if (type == "stop_video")
                            {
                                std::cout << "[Video] stop_video\n";
#ifdef _WIN32
                                video_stop_internal();
#else
                                system("pkill -f video_server.py 2>/dev/null");
#endif
                                send_ws_safe(R"({"type":"video_status","status":"stopped"})");
                            }


                            else if (type == "start_accel_calibration")
                            {
                                int link_id = j.value("link_id", -1);
                                int sysid   = j.value("sysid",   -1);  // ← multi-vehicle

                                std::shared_ptr<Vehicle> target_vehicle;

                                if (link_id >= 0)
                                {
                                    target_vehicle =
                                        g_vehicle_manager->get_vehicle_by_link(link_id);

                                    if (!target_vehicle)
                                    {
                                        std::cout << "[Calib] No live vehicle on"
                                                  << " link_id=" << link_id << "\n";
                                        send_ws_safe(R"({"type":"calibration_result",)"
                                                     R"("sensor":"accelerometer",)"
                                                     R"("step":"failed",)"
                                                     R"("message":"No drone found on the selected link."})");
                                        return;
                                    }
                                }
                                else if (sysid > 0 && g_vehicle_manager)
                                {
                                    // ── NEW: explicit sysid from multi-vehicle UI ──
                                    target_vehicle = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);
                                }
                                else
                                {
                                    // No routing info supplied — reject so we never
                                    // silently calibrate the wrong drone.
                                    std::cout << "[Calib] start_accel_calibration: "
                                                 "no sysid or link_id in message — rejected\n";
                                    send_ws_safe(R"({"type":"calibration_result",)"
                                                 R"("sensor":"accelerometer",)"
                                                 R"("step":"failed",)"
                                                 R"("message":"No target drone specified. Select a drone and retry."})");
                                    return;
                                }

                                if (!target_vehicle)
                                {
                                    send_ws_safe(R"({"type":"calibration_result",)"
                                                 R"("sensor":"accelerometer",)"
                                                 R"("step":"failed",)"
                                                 R"("message":"No drone connected."})");
                                    return;
                                }

                                // Use this vehicle's own AccelCalibration instance.
                                // The transport callback and vehicle info were already
                                // bound in on_new_vehicle — nothing to re-wire here.
                                auto vp = target_vehicle;
                                std::cout << "[Calib] Accel calibration → sysid="
                                          << vp->sysid()
                                          << " link_id=" << vp->link_id()
                                          << "\n";

                                std::thread([vp]() {
                                    vp->accel_calib().startAccelCalibration();
                                }).detach();
                            }

                            else if (type == "start_level_calibration")
                            {
                                std::cout << "[Calib] Level calibration requested\n";
                                // Route to the active vehicle's own AccelCalibration.
                                std::shared_ptr<Vehicle> lv;
                                int lv_sysid = j.value("sysid", -1);
                                if (lv_sysid > 0 && g_vehicle_manager)
                                    lv = g_vehicle_manager->get_vehicle_by_ui_sysid(lv_sysid);
                                else
                                {
                                    std::cout << "[Calib] start_level_calibration: "
                                                 "no sysid in message — rejected\n";
                                    send_ws_safe(R"({"type":"calibration_result",)"
                                                 R"("sensor":"accelerometer",)"
                                                 R"("step":"failed",)"
                                                 R"("message":"No target drone specified. Select a drone and retry."})");
                                    return;
                                }

                                if (lv)
                                {
                                    auto vp = lv;
                                    std::thread([vp]() {
                                        vp->accel_calib().startLevelCalibration();
                                    }).detach();
                                }
                                else
                                {
                                    send_ws_safe(R"({"type":"calibration_result",)"
                                                 R"("sensor":"accelerometer",)"
                                                 R"("step":"failed",)"
                                                 R"("message":"No drone connected."})");
                                }
                            }

                            else if (type == "accel_calibration_step_done")
                            {
                                std::string fe_step = j.value("step", "unknown");
                                int         sd_sysid = j.value("sysid", -1);
                                std::cout << "[Calib] Frontend confirmed step='"
                                          << fe_step << "' sysid=" << sd_sysid << "\n";

                                std::shared_ptr<Vehicle> sv;
                                if (sd_sysid > 0 && g_vehicle_manager)
                                    sv = g_vehicle_manager->get_vehicle_by_ui_sysid(sd_sysid);
                                else
                                {
                                    std::cout << "[Calib] accel_calibration_step_done: "
                                                 "no sysid in message (sysid="
                                              << sd_sysid << ") — rejected\n";
                                    return;   // don't confirm on the wrong drone
                                }

                                if (sv)
                                    sv->accel_calib().confirmAccelPosition();
                                else
                                    std::cout << "[Calib] Step done: no vehicle found\n";
                            }

                            // ── compass calibration — start ───────────────────────────
                            else if (type == "start_compass_calibration")
                            {
                                bool large = j.value("large_vehicle", false);
                                int  sysid = j.value("sysid", -1);   // ← multi-vehicle

                                // Resolve target vehicle: prefer explicit sysid, then active
                                std::shared_ptr<Vehicle> cv;
                                if (sysid > 0 && g_vehicle_manager)
                                    cv = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);
                                else if (g_vehicle_manager)
                                    cv = g_vehicle_manager->get_active_vehicle();

                                if (!cv)
                                {
                                    std::cout << "[Compass] Start rejected — no live vehicle\n";
                                    send_ws_safe(R"({"type":"compass_result",)"
                                                 R"("sensor":"compass",)"
                                                 R"("status":"failed",)"
                                                 R"("message":"No drone connected. Connect a drone and try again."})");
                                }
                                else
                                {
                                    // Wire compass module to the selected vehicle
                                    auto vp = cv;

                                    // setVehicleInfo was already called in the
                                    // constructor, but re-set here to be explicit
                                    // and to catch any sysid/compid changes.
                                    vp->compass_calib().setVehicleInfo(
                                        cv->sysid(), cv->compid());

                                    {
                                        auto request_msg_interval =
                                            [&cv](uint32_t msgid, int32_t interval_us)
                                        {
                                            mavlink_message_t      req;
                                            mavlink_command_long_t cmd{};
                                            cmd.target_system    = static_cast<uint8_t>(cv->sysid());
                                            cmd.target_component = static_cast<uint8_t>(cv->compid());
                                            cmd.command          = MAV_CMD_SET_MESSAGE_INTERVAL;
                                            cmd.confirmation     = 0;
                                            cmd.param1           = static_cast<float>(msgid);
                                            cmd.param2           = static_cast<float>(interval_us);
                                            cmd.param3 = cmd.param4 = cmd.param5 =
                                            cmd.param6 = cmd.param7 = 0;
                                            mavlink_msg_command_long_encode(
                                                255, MAV_COMP_ID_MISSIONPLANNER, &req, &cmd);
                                            cv->send_mavlink(req);
                                            std::cout << "[Compass] Requested msgid="
                                                      << msgid << " at "
                                                      << (1000000 / interval_us)
                                                      << " Hz\n";
                                        };

                                        request_msg_interval(
                                            MAVLINK_MSG_ID_MAG_CAL_PROGRESS, 100000);
                                        request_msg_interval(
                                            MAVLINK_MSG_ID_MAG_CAL_REPORT, 1000000);
                                    }

                                    std::cout << "[Compass] Calibration start requested "
                                                 "(large=" << large << ")"
                                              << " sysid=" << cv->sysid() << "\n";
                                    std::thread([vp, large]() {
                                        vp->compass_calib().startCompassCalibration(large);
                                    }).detach();
                                }
                            }

                            else if (type == "cancel_compass_calibration")
                            {
                                int cc_sysid = j.value("sysid", -1);
                                std::shared_ptr<Vehicle> cc_v;
                                if (cc_sysid > 0 && g_vehicle_manager)
                                    cc_v = g_vehicle_manager->get_vehicle_by_ui_sysid(cc_sysid);
                                else if (g_vehicle_manager)
                                    cc_v = g_vehicle_manager->get_active_vehicle();

                                if (cc_v)
                                {
                                    std::cout << "[Compass] Cancel → sysid="
                                              << cc_v->sysid() << "\n";
                                    cc_v->compass_calib().cancelCompassCalibration();
                                }
                                else
                                {
                                    std::cout << "[Compass] Cancel: no live vehicle\n";
                                }
                            }

                            else if (type == "accept_compass_calibration")
                            {
                                int ac_sysid = j.value("sysid", -1);
                                std::shared_ptr<Vehicle> ac_v;
                                if (ac_sysid > 0 && g_vehicle_manager)
                                    ac_v = g_vehicle_manager->get_vehicle_by_ui_sysid(ac_sysid);
                                else if (g_vehicle_manager)
                                    ac_v = g_vehicle_manager->get_active_vehicle();

                                if (ac_v)
                                {
                                    std::cout << "[Compass] Accept offsets → sysid="
                                              << ac_v->sysid() << "\n";
                                    ac_v->compass_calib().acceptCompassCalibration();
                                }
                                else
                                {
                                    std::cout << "[Compass] Accept: no live vehicle\n";
                                }
                            }

                            else if (type == "start_radio_calibration")
                            {
                                int sysid = j.value("sysid", -1);
                                std::shared_ptr<Vehicle> rv;
                                if (sysid > 0 && g_vehicle_manager)
                                    rv = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);

                                if (!rv)
                                {
                                    json err;
                                    err["type"]    = "radio_calibration_status";
                                    err["message"] = sysid <= 0
                                        ? "No target drone specified. Select a drone and retry."
                                        : "No drone connected.";
                                    err["success"] = false;
                                    send_ws_safe(err.dump());
                                }
                                else
                                {
                                    std::cout << "[Radio] Calibration start → sysid="
                                              << rv->sysid() << "\n";
                                    auto vp = rv;
                                    std::thread([vp]() {
                                        vp->radio_calib().startRadioCalibration();
                                    }).detach();
                                }
                            }

                            else if (type == "complete_radio_calibration")
                            {
                                int sysid = j.value("sysid", -1);
                                std::shared_ptr<Vehicle> rv;
                                if (sysid > 0 && g_vehicle_manager)
                                    rv = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);

                                if (rv)
                                {
                                    std::cout << "[Radio] Calibration complete → sysid="
                                              << rv->sysid() << "\n";
                                    auto vp = rv;
                                    std::thread([vp]() {
                                        vp->radio_calib().completeRadioCalibration();
                                    }).detach();
                                }
                                else
                                {
                                    std::cout << "[Radio] complete: no live vehicle (sysid="
                                              << sysid << ")\n";
                                }
                            }

                            else if (type == "cancel_radio_calibration")
                            {
                                int sysid = j.value("sysid", -1);
                                std::shared_ptr<Vehicle> rv;
                                if (sysid > 0 && g_vehicle_manager)
                                    rv = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);

                                if (rv)
                                {
                                    std::cout << "[Radio] Calibration cancel → sysid="
                                              << rv->sysid() << "\n";
                                    rv->radio_calib().cancelRadioCalibration();
                                }
                                else
                                {
                                    std::cout << "[Radio] cancel: no live vehicle (sysid="
                                              << sysid << ")\n";
                                }
                            }

                            // ── ESC calibration — start ──────────────────────────────
                            else if (type == "start_esc_calibration")
                            {
                                int sysid = j.value("sysid", -1);

                                std::shared_ptr<Vehicle> ev;
                                if (sysid > 0 && g_vehicle_manager)
                                    ev = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);

                                if (!ev)
                                {
                                    json err;
                                    err["type"]    = "esc_calibration_status";
                                    err["stage"]   = "error";
                                    err["message"] = sysid <= 0
                                        ? "No target drone specified. Select a drone and retry."
                                        : "No drone connected.";
                                    err["busy"]    = false;
                                    send_ws_safe(err.dump());
                                }
                                else
                                {
                                    std::cout << "[ESC] Calibration start → sysid="
                                              << ev->sysid() << "\n";
                                    auto vp = ev;
                                    std::thread([vp]() {
                                        vp->esc_calib().startEscCalibration();
                                    }).detach();
                                }
                            }

                            // ── ESC calibration — cancel ─────────────────────────────
                            else if (type == "cancel_esc_calibration")
                            {
                                int sysid = j.value("sysid", -1);

                                std::shared_ptr<Vehicle> ev;
                                if (sysid > 0 && g_vehicle_manager)
                                    ev = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);

                                if (ev)
                                {
                                    std::cout << "[ESC] Calibration cancel → sysid="
                                              << ev->sysid() << "\n";
                                    ev->esc_calib().cancelEscCalibration();
                                }
                                else
                                {
                                    std::cout << "[ESC] Cancel: no live vehicle (sysid="
                                              << sysid << ")\n";
                                }
                            }

                            else if (type == "save_flight_modes")
                            {
                                if (j.contains("modes") &&
                                    j["modes"].is_array() &&
                                    j["modes"].size() == FlightMode::NUM_SLOTS)
                                {
                                    std::array<uint8_t, FlightMode::NUM_SLOTS> modes{};
                                    for (int i = 0; i < FlightMode::NUM_SLOTS; ++i)
                                        modes[i] = static_cast<uint8_t>(
                                                        j["modes"][i].get<int>());

                                    std::cout << "[FlightMode] Save requested\n";
                                    std::thread([modes]() {
                                        flightMode.saveFlightModes(modes);
                                    }).detach();
                                }
                                else
                                {
                                    std::cout << "[FlightMode] save_flight_modes: "
                                                 "invalid payload\n";
                                }
                            }

                            else if (type == "set_flight_mode")
                            {
                                std::string mode_str = j.value("mode", "");
                                int         sysid    = j.value("sysid", -1);  // ← multi-vehicle
                                CopterMode  mode     = FlightMode::modeFromName(mode_str);

                                if (mode != CopterMode::UNKNOWN)
                                {
                                    // Wire flight mode to the correct vehicle for this command
                                    if (sysid > 0 && g_vehicle_manager)
                                    {
                                        auto fv = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid);
                                        if (fv)
                                        {
                                            auto fvp = fv;
                                            flightMode.setTransportCallback(
                                                [fvp](const mavlink_message_t& m)
                                                { fvp->send_mavlink(m); });
                                            flightMode.setVehicleInfo(
                                                fv->sysid(), fv->compid());
                                        }
                                    }
                                    std::cout << "[FlightMode] Set mode: " << mode_str << "\n";
                                    std::thread([mode]() {
                                        flightMode.setMode(mode);
                                    }).detach();
                                }
                                else
                                {
                                    std::cout << "[FlightMode] Unknown mode '"
                                              << mode_str << "'\n";
                                }
                            }

                            else if (type == "reboot_vehicle")
                            {
                                std::cout << "[GCS] Reboot requested\n";

                                json status_msg;
                                status_msg["type"]    = "reboot_status";
                                status_msg["message"] = "Rebooting vehicle…";
                                send_ws_safe(status_msg.dump());

                                if (g_vehicle_manager)
                                {
                                    // ── Prefer explicit sysid; fall back to active ──
                                    int sysid = j.value("sysid", -1);   // ← multi-vehicle
                                    std::shared_ptr<Vehicle> v =
                                        (sysid > 0)
                                            ? g_vehicle_manager->get_vehicle_by_ui_sysid(sysid)
                                            : g_vehicle_manager->get_active_vehicle();

                                    if (v)
                                    {
                                        mavlink_message_t      reboot_msg;
                                        mavlink_command_long_t reboot_cmd{};
                                        reboot_cmd.target_system    = static_cast<uint8_t>(v->sysid());
                                        reboot_cmd.target_component = static_cast<uint8_t>(v->compid());
                                        reboot_cmd.command          = MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN;
                                        reboot_cmd.confirmation     = 0;
                                        reboot_cmd.param1           = 1;
                                        reboot_cmd.param2           = 0;

                                        mavlink_msg_command_long_encode(
                                            255, MAV_COMP_ID_MISSIONPLANNER,
                                            &reboot_msg, &reboot_cmd);

                                        v->send_mavlink(reboot_msg);
                                    }
                                    else
                                    {
                                        std::cout << "[GCS] Reboot: no live vehicle\n";
                                    }
                                }
                            }

                            // ── RC Switch Options ─────────────────────────────────────
                            //
                            // "set_rc_switch"
                            //   Sent by the UI when a single channel dropdown changes.
                            //   Stages the change AND immediately sends PARAM_SET.
                            //   Payload: { "type": "set_rc_switch",
                            //              "channel": 7, "value": 41 }
                            //
                            // "write_rc_switches"
                            //   Sent by the "Write" button in the Switch Options panel.
                            //   Flushes all pending (staged) changes in one batch.
                            //   Payload: { "type": "write_rc_switches" }
                            //   (The UI already sent set_rc_switch per change; this is
                            //    a safety re-send for any that may not have gone through.)
                            //
                            // "revert_rc_switches"
                            //   Sent by the "Revert" button.  Clears the pending map
                            //   without sending anything — the UI will reload from the
                            //   last PARAM_VALUE values held by ParameterManager.
                            //   Payload: { "type": "revert_rc_switches" }
                            //
                            // "read_rc_switch"
                            //   Optional: asks the drone to echo back the current value
                            //   of a single channel's parameter.  The PARAM_VALUE
                            //   response is handled by ParameterManager and forwarded
                            //   to the UI via the normal param_value WS message.
                            //   Payload: { "type": "read_rc_switch", "channel": 7 }
                            // ─────────────────────────────────────────────────────────

                            else if (type == "set_rc_switch")
                            {
                                // Single-channel write — triggered by dropdown change.
                                const int channel = j.value("channel", -1);
                                const int value   = j.value("value",   -1);

                                if (!g_switch_manager)
                                {
                                    std::cout << "[Switch] g_switch_manager is null\n";
                                }
                                else if (channel < 1 || value < 0)
                                {
                                    std::cout << "[Switch] set_rc_switch: invalid payload"
                                              << " (channel=" << channel
                                              << " value="   << value << ")\n";
                                }
                                else
                                {
                                    g_switch_manager->set_switch_option(channel, value);
                                }
                            }

                            else if (type == "write_rc_switches")
                            {
                                // Batch write — "Write" button in the panel footer.
                                if (!g_switch_manager)
                                {
                                    std::cout << "[Switch] g_switch_manager is null\n";
                                }
                                else
                                {
                                    const int sent = g_switch_manager->write_all_pending();
                                    std::cout << "[Switch] write_rc_switches: "
                                              << sent << " parameter(s) sent\n";

                                    // Acknowledge to the UI so it can clear dirty badges.
                                    json ack;
                                    ack["type"]  = "rc_switches_written";
                                    ack["count"] = sent;
                                    send_ws_safe(ack.dump());
                                }
                            }

                            else if (type == "revert_rc_switches")
                            {
                                // Discard staged changes — "Revert" button.
                                if (!g_switch_manager)
                                {
                                    std::cout << "[Switch] g_switch_manager is null\n";
                                }
                                else
                                {
                                    g_switch_manager->clear_pending();

                                    json ack;
                                    ack["type"] = "rc_switches_reverted";
                                    send_ws_safe(ack.dump());
                                }
                            }

                            else if (type == "read_rc_switch")
                            {
                                // Ask the drone to echo back current value for one channel.
                                const int channel = j.value("channel", -1);

                                if (!g_switch_manager)
                                {
                                    std::cout << "[Switch] g_switch_manager is null\n";
                                }
                                else if (channel < 1)
                                {
                                    std::cout << "[Switch] read_rc_switch: "
                                                 "invalid channel=" << channel << "\n";
                                }
                                else
                                {
                                    g_switch_manager->request_param_read(channel);
                                }
                            }

                            // ── Log Download: list / download / erase ─────────────
                            // Frontend sends these from log-download.js / analyze-tools.js.
                            // All three require an active vehicle connection.
                            // ─────────────────────────────────────────────────────

                            else if (type == "list_logs")
                            {
                                if (!g_vehicle_manager)
                                {
                                    std::cout << "[LogDL] list_logs: no vehicle manager\n";
                                }
                                else
                                {
                                    auto v = g_vehicle_manager->get_active_vehicle();
                                    if (!v)
                                    {
                                        std::cout << "[LogDL] list_logs: no active vehicle\n";
                                        json err;
                                        err["type"] = "log_entry";
                                        err["id"] = 0;
                                        err["num_logs"] = 0;
                                        err["size"] = 0;
                                        err["time_utc"] = 0;
                                        send_ws_safe(err.dump());
                                    }
                                    else
                                    {
                                        std::cout << "[LogDL] Requesting log list from sysid="
                                                  << v->sysid() << "\n";

                                        mavlink_message_t          req;
                                        mavlink_log_request_list_t lr{};
                                        lr.target_system    = static_cast<uint8_t>(v->sysid());
                                        lr.target_component = static_cast<uint8_t>(v->compid());
                                        lr.start = 0;
                                        lr.end   = 0xFFFF;  // request all logs
                                        mavlink_msg_log_request_list_encode(
                                            255, MAV_COMP_ID_MISSIONPLANNER, &req, &lr);
                                        v->send_mavlink(req);
                                    }
                                }
                            }

                            else if (type == "download_log")
                            {
                                uint16_t log_id  = static_cast<uint16_t>(j.value("log_id",  0));
                                uint32_t log_size = static_cast<uint32_t>(j.value("log_size", 0));

                                if (!g_vehicle_manager)
                                {
                                    std::cout << "[LogDL] download_log: no vehicle manager\n";
                                }
                                else
                                {
                                    auto v = g_vehicle_manager->get_active_vehicle();
                                    if (!v)
                                    {
                                        std::cout << "[LogDL] download_log: no active vehicle\n";
                                    }
                                    else
                                    {
                                        std::cout << "[LogDL] Starting download log_id="
                                                  << log_id << " size=" << log_size << "\n";

                                        {
                                            std::lock_guard<std::mutex> lk(g_log_dl_mutex);
                                            g_log_dl.active   = true;
                                            g_log_dl.log_id   = log_id;
                                            g_log_dl.total    = log_size;
                                            g_log_dl.received = 0;
                                            g_log_dl.data.clear();
                                            if (log_size > 0)
                                                g_log_dl.data.resize(log_size, 0xFF);
                                        }

                                        // Request all data in one LOG_REQUEST_DATA packet.
                                        // ArduPilot will stream LOG_DATA messages (90-byte
                                        // chunks) until the whole file is sent.
                                        auto vp = v;
                                        std::thread([vp, log_id, log_size]() {
                                            mavlink_message_t          req;
                                            mavlink_log_request_data_t lrd{};
                                            lrd.target_system    = static_cast<uint8_t>(vp->sysid());
                                            lrd.target_component = static_cast<uint8_t>(vp->compid());
                                            lrd.id               = log_id;
                                            lrd.ofs              = 0;
                                            lrd.count            = log_size > 0 ? log_size : 0xFFFFFFFF;
                                            mavlink_msg_log_request_data_encode(
                                                255, MAV_COMP_ID_MISSIONPLANNER, &req, &lrd);
                                            vp->send_mavlink(req);
                                            std::cout << "[LogDL] LOG_REQUEST_DATA sent for log_id="
                                                      << log_id << "\n";
                                        }).detach();
                                    }
                                }
                            }

                            else if (type == "erase_logs")
                            {
                                if (!g_vehicle_manager)
                                {
                                    std::cout << "[LogDL] erase_logs: no vehicle manager\n";
                                }
                                else
                                {
                                    auto v = g_vehicle_manager->get_active_vehicle();
                                    if (!v)
                                    {
                                        std::cout << "[LogDL] erase_logs: no active vehicle\n";
                                    }
                                    else
                                    {
                                        std::cout << "[LogDL] Erasing all logs on sysid="
                                                  << v->sysid() << "\n";

                                        mavlink_message_t  req;
                                        mavlink_log_erase_t le{};
                                        le.target_system    = static_cast<uint8_t>(v->sysid());
                                        le.target_component = static_cast<uint8_t>(v->compid());
                                        mavlink_msg_log_erase_encode(
                                            255, MAV_COMP_ID_MISSIONPLANNER, &req, &le);
                                        v->send_mavlink(req);
                                    }
                                }
                            }

                            // ── list_serial_ports ─────────────────────────

                            // Frontend sends this on open and on Refresh.
                            // We scan the OS for available serial ports and
                            // reply with a "serial_ports" JSON message so the
                            // UI can render live, accurate rows.
                            // ─────────────────────────────────────────────
                            else if (type == "list_serial_ports")
                            {
                                std::cout << "[SerialScan] Scanning ports…\n";

                                auto ports = scan_serial_ports();

                                json resp;
                                resp["type"]  = "serial_ports";
                                json arr      = json::array();

                                for (auto& p : ports)
                                {
                                    json entry;
                                    entry["port"]         = p.port;
                                    entry["display"]      = p.display;
                                    entry["description"]  = p.description;
                                    entry["manufacturer"] = p.manufacturer;
                                    entry["board_id"]     = "";   // reserved
                                    entry["brand"]        = "";   // reserved
                                    arr.push_back(entry);

                                    std::cout << "[SerialScan]   " << p.port
                                              << "  (" << p.description << ")\n";
                                }

                                resp["ports"] = arr;
                                send_ws_safe(resp.dump());

                                std::cout << "[SerialScan] Reported "
                                          << ports.size() << " port(s).\n";
                            }

                            // ── Motor Test ────────────────────────────────────────────
                            // Frontend sends:
                            //   { type:"motor_test", motor_index:1, throttle_pct:15,
                            //     duration_sec:2 }
                            // motor_index 0 = all motors (sequential); 1-N = specific motor.
                            // throttle_pct 0 with duration_sec 0 = emergency stop.
                            // Uses MAV_CMD_DO_MOTOR_TEST (209):
                            //   param1 = motor instance (1-based)
                            //   param2 = throttle type (0 = percent)
                            //   param3 = throttle value (0-100 %)
                            //   param4 = timeout (seconds)
                            //   param5 = motor count (0/1 = one motor)
                            //   param6 = motor test order (0 = default)
                            // ─────────────────────────────────────────────────────────
                            else if (type == "motor_test")
                            {
                                int   motor_index  = j.value("motor_index",  1);
                                float throttle_pct = static_cast<float>(j.value("throttle_pct", 0));
                                float duration_sec = static_cast<float>(j.value("duration_sec", 2));

                                std::shared_ptr<Vehicle> mv;
                                if (g_vehicle_manager)
                                    mv = g_vehicle_manager->get_active_vehicle();

                                if (!mv)
                                {
                                    std::cout << "[MotorTest] No active vehicle\n";
                                    json ack;
                                    ack["type"]        = "motor_test_ack";
                                    ack["motor_index"] = motor_index;
                                    ack["status"]      = "error";
                                    ack["message"]     = "No drone connected.";
                                    send_ws_safe(ack.dump());
                                }
                                else
                                {
                                    std::cout << "[MotorTest] motor=" << motor_index
                                              << " throttle=" << throttle_pct << "%"
                                              << " duration=" << duration_sec << "s\n";

                                    // Clamp throttle to 0-100
                                    if (throttle_pct < 0)   throttle_pct = 0;
                                    if (throttle_pct > 100) throttle_pct = 100;

                                    mavlink_message_t      mav_msg;
                                    mavlink_command_long_t mav_cmd{};
                                    mav_cmd.target_system    = static_cast<uint8_t>(mv->sysid());
                                    mav_cmd.target_component = static_cast<uint8_t>(mv->compid());
                                    mav_cmd.command          = MAV_CMD_DO_MOTOR_TEST;
                                    mav_cmd.confirmation     = 0;
                                    mav_cmd.param1           = static_cast<float>(motor_index);
                                    mav_cmd.param2           = 0;   // MOTOR_TEST_THROTTLE_PERCENT
                                    mav_cmd.param3           = throttle_pct;
                                    mav_cmd.param4           = duration_sec;
                                    mav_cmd.param5           = 0;   // motor count: 0 = one
                                    mav_cmd.param6           = 0;   // order: default
                                    mav_cmd.param7           = 0;

                                    mavlink_msg_command_long_encode(
                                        255, MAV_COMP_ID_MISSIONPLANNER,
                                        &mav_msg, &mav_cmd);

                                    mv->send_mavlink(mav_msg);

                                    json ack;
                                    ack["type"]        = "motor_test_ack";
                                    ack["motor_index"] = motor_index;
                                    ack["status"]      = "ok";
                                    ack["message"]     = "Command sent";
                                    send_ws_safe(ack.dump());
                                }
                            }

                            // ── connect_vehicle ───────────────────────────────────────
                            // Adds a new UDP link to the given remote vehicle endpoint.
                            // The VehicleManager will auto-discover the vehicle on the
                            // first HEARTBEAT received on the new link.
                            //
                            // Payload: { "type": "connect_vehicle",
                            //            "ip":         "192.168.1.10",
                            //            "port":        14550,
                            //            "local_port":  14560 }   ← must be unique
                            //
                            // Response: { "type": "connect_vehicle_ack",
                            //             "status": "ok" | "error",
                            //             "local_port": N,
                            //             "message": "..." }
                            // ─────────────────────────────────────────────────────────
                            else if (type == "connect_vehicle")
                            {
                                std::string remote_ip   = j.value("ip",         "");
                                int         remote_port = j.value("port",       14550);
                                int         local_port  = j.value("local_port", 0);

                                auto send_cv_ack = [](bool ok, int lport,
                                                      const std::string& msg_str)
                                {
                                    json ack;
                                    ack["type"]       = "connect_vehicle_ack";
                                    ack["status"]     = ok ? "ok" : "error";
                                    ack["local_port"] = lport;
                                    ack["message"]    = msg_str;
                                    send_ws_safe(ack.dump());
                                };

                                if (remote_ip.empty())
                                {
                                    send_cv_ack(false, 0, "Missing 'ip' field.");
                                }
                                else if (!g_link_manager || !g_io_ctx)
                                {
                                    send_cv_ack(false, 0,
                                        "Link manager not initialised.");
                                }
                                else
                                {
                                    // Auto-assign local port: start at 14560, increment
                                    // until we find a free slot in our tracking map.
                                    {
                                        std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                        if (local_port == 0)
                                        {
                                            local_port = 14560;
                                            while (g_dyn_udp_links.count(local_port))
                                                ++local_port;
                                        }
                                        if (g_dyn_udp_links.count(local_port))
                                        {
                                            send_cv_ack(false, local_port,
                                                "Local port already in use: "
                                                + std::to_string(local_port));
                                            goto cv_done;
                                        }
                                    }

                                    try
                                    {
                                        // Bind a new UDP socket for this vehicle.
                                        // remote_ip / remote_port: where ArduPilot is.
                                        // local_port: GCS listen port for replies.
                                        auto new_udp = std::make_shared<UdpTransport>(
                                            *g_io_ctx,
                                            "0.0.0.0",  local_port,
                                            remote_ip,  remote_port);

                                        int lid = g_link_manager->add_link(new_udp, *g_io_ctx);
                                        g_link_manager->start_link(lid);

                                        {
                                            std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                            DynUdpEntry entry;
                                            entry.transport   = new_udp;
                                            entry.link_id     = lid;
                                            entry.remote_ip   = remote_ip;
                                            entry.remote_port = remote_port;
                                            g_dyn_udp_links[local_port] = std::move(entry);
                                        }

                                        std::cout << "[MultiVehicle] Connected "
                                                  << remote_ip << ":" << remote_port
                                                  << "  local_port=" << local_port
                                                  << "  link_id=" << lid << "\n";

                                        send_cv_ack(true, local_port,
                                            "UDP link open. Waiting for HEARTBEAT from "
                                            + remote_ip + ":" + std::to_string(remote_port));

                                        // Push updated status immediately
                                        send_status();
                                    }
                                    catch (const std::exception& ex)
                                    {
                                        std::cout << "[MultiVehicle] connect_vehicle error: "
                                                  << ex.what() << "\n";
                                        send_cv_ack(false, local_port,
                                            std::string("Failed to open UDP socket: ")
                                            + ex.what());
                                    }
                                    cv_done:;
                                }
                            }

                            // ── disconnect_vehicle ────────────────────────────────────
                            // Closes the dynamic UDP link for the given local_port and
                            // removes it from the tracking map.  The VehicleManager will
                            // evict the vehicle automatically when its heartbeat times out.
                            //
                            // Payload: { "type": "disconnect_vehicle",
                            //            "local_port": 14560 }
                            //
                            // Also supports disconnect by sysid:
                            // Payload: { "type": "disconnect_vehicle",
                            //            "sysid": 1 }
                            // ─────────────────────────────────────────────────────────
                            else if (type == "disconnect_vehicle")
                            {
                                int local_port = j.value("local_port", 0);
                                int sysid_disc = j.value("sysid",      0);

                                // Resolve local_port from sysid if not given directly
                                if (local_port == 0 && sysid_disc > 0 && g_vehicle_manager)
                                {
                                    auto veh = g_vehicle_manager->get_vehicle_by_ui_sysid(sysid_disc);
                                    if (veh)
                                    {
                                        int lid = veh->link_id();
                                        std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                        for (auto& [lp, entry] : g_dyn_udp_links)
                                        {
                                            if (entry.link_id == lid)
                                            {
                                                local_port = lp;
                                                break;
                                            }
                                        }
                                    }
                                }

                                bool removed = false;
                                {
                                    std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                    auto it = g_dyn_udp_links.find(local_port);
                                    if (it != g_dyn_udp_links.end())
                                    {
                                        it->second.transport->stop();
                                        g_dyn_udp_links.erase(it);
                                        removed = true;
                                    }
                                }

                                json ack;
                                ack["type"]       = "disconnect_vehicle_ack";
                                ack["local_port"] = local_port;
                                if (removed)
                                {
                                    ack["status"]  = "ok";
                                    ack["message"] = "UDP link closed (port "
                                        + std::to_string(local_port) + ")";
                                    std::cout << "[MultiVehicle] Disconnected local_port="
                                              << local_port << "\n";
                                    send_status();
                                }
                                else
                                {
                                    ack["status"]  = "error";
                                    ack["message"] = "No dynamic link found for port "
                                        + std::to_string(local_port);
                                }
                                send_ws_safe(ack.dump());
                            }

                            // ── manual_connect ────────────────────────────────────────
                            // Comm Links panel — manual connection (UDP / TCP / Serial).
                            //
                            // UDP payload:
                            //   { type:"manual_connect", conn_type:"udp",
                            //     ip:"192.168.1.10", port:14550, local_port:0 }
                            //
                            // TCP payload:
                            //   { type:"manual_connect", conn_type:"tcp",
                            //     ip:"192.168.1.10", port:5760 }
                            //
                            // Serial payload:
                            //   { type:"manual_connect", conn_type:"serial",
                            //     port:"/dev/ttyACM0",  baud:115200 }
                            //   (Windows: port = "\\\\.\\COM3")
                            //
                            // Response: { type:"manual_connect_ack",
                            //             status:"ok"|"error",
                            //             conn_type:"...", conn_id:"...",
                            //             info:"...", message:"..." }
                            // ─────────────────────────────────────────────────────────
                            else if (type == "manual_connect")
                            {
                                std::string conn_type = j.value("conn_type", "udp");

                                auto send_mc_ack = [&](bool ok,
                                                       const std::string& cid,
                                                       const std::string& info_str,
                                                       int lport,
                                                       const std::string& msg_str)
                                {
                                    json ack;
                                    ack["type"]       = "manual_connect_ack";
                                    ack["status"]     = ok ? "ok" : "error";
                                    ack["conn_type"]  = conn_type;
                                    ack["conn_id"]    = cid;
                                    ack["info"]       = info_str;
                                    ack["local_port"] = lport;
                                    ack["message"]    = msg_str;
                                    send_ws_safe(ack.dump());
                                };

                                if (!g_link_manager || !g_io_ctx)
                                {
                                    send_mc_ack(false, "", "", 0, "Link manager not initialised.");
                                }
                                else if (conn_type == "udp")
                                {
                                    // ── Manual UDP connection ─────────────────────────
                                    std::string remote_ip   = j.value("ip",         "");
                                    int         remote_port = j.value("port",       14550);
                                    int         local_port  = j.value("local_port", 0);

                                    if (remote_ip.empty())
                                    {
                                        send_mc_ack(false, "", "", 0, "Missing 'ip' field.");
                                        goto mc_done;
                                    }

                                    {
                                        std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                        if (local_port == 0)
                                        {
                                            local_port = 14560;
                                            while (g_dyn_udp_links.count(local_port))
                                                ++local_port;
                                        }
                                        if (g_dyn_udp_links.count(local_port))
                                        {
                                            send_mc_ack(false, "", "",
                                                local_port,
                                                "Local port already in use: "
                                                + std::to_string(local_port));
                                            goto mc_done;
                                        }
                                    }

                                    try
                                    {
                                        auto new_udp = std::make_shared<UdpTransport>(
                                            *g_io_ctx,
                                            "0.0.0.0", local_port,
                                            remote_ip, remote_port);

                                        int lid = g_link_manager->add_link(new_udp, *g_io_ctx);
                                        g_link_manager->start_link(lid);

                                        std::string conn_id = "udp_" + std::to_string(local_port);
                                        {
                                            std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                            DynUdpEntry entry;
                                            entry.transport   = new_udp;
                                            entry.link_id     = lid;
                                            entry.remote_ip   = remote_ip;
                                            entry.remote_port = remote_port;
                                            g_dyn_udp_links[local_port] = std::move(entry);
                                        }

                                        std::string info = remote_ip + ":"
                                            + std::to_string(remote_port)
                                            + " (local:" + std::to_string(local_port) + ")";
                                        std::cout << "[CommLink] UDP connected " << info
                                                  << "  link_id=" << lid << "\n";

                                        send_mc_ack(true, conn_id, info, local_port,
                                            "UDP link open. Waiting for HEARTBEAT from "
                                            + remote_ip + ":" + std::to_string(remote_port));
                                        send_status();
                                    }
                                    catch (const std::exception& ex)
                                    {
                                        std::cout << "[CommLink] UDP connect error: "
                                                  << ex.what() << "\n";
                                        send_mc_ack(false, "", "", local_port,
                                            std::string("Failed to open UDP: ") + ex.what());
                                    }
                                }
                                else if (conn_type == "tcp")
                                {
                                    // ── Manual TCP connection ─────────────────────────
                                    // ArduPilot / SITL TCP server mode:
                                    //   ArduPilot listens on e.g. 5760.
                                    //   GCS connects as client.
                                    //
                                    // We create a TCP socket, connect to the remote
                                    // host, then wrap it in a LinkManager link so MAVLink
                                    // frames are parsed exactly like a serial link.
                                    // ─────────────────────────────────────────────────
                                    std::string remote_ip   = j.value("ip",   "");
                                    int         remote_port = j.value("port", 5760);

                                    if (remote_ip.empty())
                                    {
                                        send_mc_ack(false, "", "", 0, "Missing 'ip' field.");
                                        goto mc_done;
                                    }

                                    std::thread([remote_ip, remote_port, send_mc_ack]()
                                    {
                                        try
                                        {
                                            // Connect a blocking TCP socket to the vehicle.
                                            asio::io_context tcp_io;
                                            asio::ip::tcp::socket sock(tcp_io);
                                            asio::ip::tcp::resolver resolver(tcp_io);
                                            auto endpoints = resolver.resolve(
                                                remote_ip,
                                                std::to_string(remote_port));
                                            asio::connect(sock, endpoints);

                                            // Wrap in a shared_ptr for the link manager.
                                            // We pass the raw TCP socket to a UdpTransport-
                                            // compatible wrapper.  For now we use the same
                                            // async_send interface via a simple lambda bridge
                                            // on the existing Serial transport class, treating
                                            // the TCP stream like a serial port (same byte
                                            // stream, same MAVLink framing).
                                            // Because ASIO serial_port ≠ TCP socket, we
                                            // instead spin up a dedicated io_context thread
                                            // and run the TCP stream through our existing
                                            // MAVLink parser in the link manager callback.
                                            //
                                            // NOTE: The cleanest path is a TcpTransport class.
                                            //       For now we read in a loop on this thread and
                                            //       push bytes to the global link-manager via
                                            //       a synthetic receive callback.
                                            //
                                            std::cout << "[CommLink] TCP connected to "
                                                      << remote_ip << ":" << remote_port << "\n";

                                            if (!g_link_manager)
                                            {
                                                send_mc_ack(false, "", "", 0,
                                                    "Link manager gone — cannot add TCP link.");
                                                return;
                                            }

                                            // Use local_port=0 placeholder for TCP in the conn_id
                                            std::string conn_id = "tcp_"
                                                + remote_ip + "_"
                                                + std::to_string(remote_port);
                                            std::string info = "TCP " + remote_ip + ":"
                                                + std::to_string(remote_port);

                                            // Run MAVLink read loop on this thread.
                                            // We keep the TCP socket alive until disconnect.
                                            uint8_t rx_buf[512];
                                            mavlink_message_t  mav_msg;
                                            mavlink_status_t   mav_status{};
                                            
                                            static std::atomic<int> s_tcp_chan_counter{8};
                                            uint8_t tcp_chan = static_cast<uint8_t>(s_tcp_chan_counter.fetch_add(1) % 16);

                                            // Create a minimal synthetic transport that wraps
                                            // the connected TCP socket.
                                            // send_mc_ack notifies UI of success.
                                            send_mc_ack(true, conn_id, info, 0,
                                                "TCP connected to " + remote_ip + ":"
                                                + std::to_string(remote_port));

                                            // Read loop
                                            asio::error_code ec;
                                            while (true)
                                            {
                                                std::size_t n = sock.read_some(
                                                    asio::buffer(rx_buf, sizeof(rx_buf)), ec);
                                                if (ec || n == 0) break;

                                                for (std::size_t i = 0; i < n; ++i)
                                                {
                                                    if (mavlink_parse_char(
                                                            tcp_chan,
                                                            rx_buf[i],
                                                            &mav_msg,
                                                            &mav_status))
                                                    {
                                                        if (g_vehicle_manager)
                                                            g_vehicle_manager->handle_message(
                                                                mav_msg, 9990);
                                                    }
                                                }
                                            }
                                            std::cout << "[CommLink] TCP link to "
                                                      << remote_ip << ":" << remote_port
                                                      << " closed\n";
                                        }
                                        catch (const std::exception& ex)
                                        {
                                            std::cout << "[CommLink] TCP connect error: "
                                                      << ex.what() << "\n";
                                            send_mc_ack(false, "", "", 0,
                                                std::string("TCP connect failed: ") + ex.what());
                                        }
                                    }).detach();
                                }
                                else if (conn_type == "serial")
                                {
                                    // ── Manual Serial connection ──────────────────────
                                    std::string serial_port = j.value("port", "");
                                    int         baud        = j.value("baud", 115200);

                                    if (serial_port.empty())
                                    {
                                        send_mc_ack(false, "", "", 0,
                                            "No serial port specified.");
                                        goto mc_done;
                                    }

                                    // Check if already opened by auto-monitor
                                    {
                                        std::lock_guard<std::mutex> lk(g_serial_ports_mutex);
                                        if (g_serial_ports.count(serial_port))
                                        {
                                            send_mc_ack(true,
                                                "serial_" + serial_port,
                                                serial_port + " @ " + std::to_string(baud),
                                                0,
                                                serial_port + " already open (auto-detected).");
                                            goto mc_done;
                                        }
                                    }

                                    try
                                    {
                                        auto new_serial = std::make_shared<SerialTransport>(
                                            *g_io_ctx, serial_port, baud);

                                        if (!new_serial->is_open())
                                        {
                                            send_mc_ack(false, "", serial_port, 0,
                                                "Cannot open " + serial_port
                                                + ". Check permissions and cable.");
                                            goto mc_done;
                                        }

                                        int lid = g_link_manager->add_link(new_serial, *g_io_ctx);
                                        g_link_manager->start_link(lid);

                                        {
                                            std::lock_guard<std::mutex> lk(g_serial_ports_mutex);
                                            SerialPortState state;
                                            state.transport = new_serial;
                                            state.link_id   = lid;
                                            g_serial_ports[serial_port] = std::move(state);
                                        }

                                        // Sync legacy globals if needed
                                        if (serial_link_id.load() == -1)
                                        {
                                            serial_transport     = new_serial;
                                            detected_serial_port = serial_port;
                                            serial_link_id       = lid;
                                        }

                                        std::string info = serial_port + " @ "
                                            + std::to_string(baud) + " baud";
                                        std::cout << "[CommLink] Serial opened: " << info
                                                  << "  link_id=" << lid << "\n";

                                        send_mc_ack(true,
                                            "serial_" + serial_port,
                                            info, 0,
                                            "Serial link open. Waiting for HEARTBEAT on "
                                            + serial_port);
                                        send_status();
                                    }
                                    catch (const std::exception& ex)
                                    {
                                        std::cout << "[CommLink] Serial open error: "
                                                  << ex.what() << "\n";
                                        send_mc_ack(false, "", serial_port, 0,
                                            std::string("Cannot open serial port: ")
                                            + ex.what());
                                    }
                                }
                                else
                                {
                                    send_mc_ack(false, "", "", 0,
                                        "Unknown conn_type: '" + conn_type + "'");
                                }
                                mc_done:;
                            }

                            // ── manual_disconnect ─────────────────────────────────────
                            // Closes a manually-opened link by conn_id.
                            // conn_id format:
                            //   "udp_<local_port>"        — dynamic UDP link
                            //   "serial_<port_path>"      — manual serial link
                            //   "tcp_<ip>_<port>"         — TCP link (stops recv loop)
                            // ─────────────────────────────────────────────────────────
                            else if (type == "manual_disconnect")
                            {
                                std::string conn_id = j.value("conn_id", "");
                                bool removed = false;
                                std::string msg_str;

                                if (conn_id.size() >= 4 && conn_id.substr(0, 4) == "udp_")
                                {
                                    int lport = 0;
                                    try { lport = std::stoi(conn_id.substr(4)); } catch (...) {}

                                    std::lock_guard<std::mutex> lk(g_dyn_udp_mutex);
                                    auto it = g_dyn_udp_links.find(lport);
                                    if (it != g_dyn_udp_links.end())
                                    {
                                        it->second.transport->stop();
                                        g_dyn_udp_links.erase(it);
                                        removed  = true;
                                        msg_str  = "UDP link closed (port "
                                            + std::to_string(lport) + ")";
                                    }
                                }
                                else if (conn_id.size() >= 7 && conn_id.substr(0, 7) == "serial_")
                                {
                                    std::string port = conn_id.substr(7);
                                    std::lock_guard<std::mutex> lk(g_serial_ports_mutex);
                                    auto it = g_serial_ports.find(port);
                                    if (it != g_serial_ports.end())
                                    {
                                        it->second.transport->stop();
                                        g_serial_ports.erase(it);
                                        removed = true;
                                        msg_str = "Serial link closed (" + port + ")";
                                        // Sync legacy globals
                                        if (detected_serial_port == port)
                                        {
                                            serial_transport     = nullptr;
                                            detected_serial_port = "";
                                            serial_link_id       = -1;
                                        }
                                    }
                                }
                                else
                                {
                                    // TCP links are self-closing (socket close = loop exit)
                                    removed = true;
                                    msg_str = "TCP link close requested";
                                }


                                json dack;
                                dack["type"]    = "manual_disconnect_ack";
                                dack["conn_id"] = conn_id;
                                dack["status"]  = removed ? "ok" : "error";
                                dack["message"] = removed ? msg_str
                                    : ("No link found for conn_id: " + conn_id);
                                send_ws_safe(dack.dump());
                                if (removed) send_status();
                            }

                            // ── list_vehicles ─────────────────────────────────────────
                            // Returns current vehicle list + dyn link table immediately.
                            // ─────────────────────────────────────────────────────────
                            else if (type == "list_vehicles")
                            {
                                send_status();
                            }

                            else if ((type == "param_request_list" || type == "param_get_all" || type == "param_set") &&
                                      j.contains("sysid") && j["sysid"].is_number_integer())
                            {
                                // ── sysid-aware param routing ─────────────────────────
                                // For param_set: send the MAVLink frame DIRECTLY to the
                                // target vehicle without mutating param_manager's global
                                // transport state.  This avoids the Drone-1 regression
                                // caused by wire_modules_to_active_vehicle() resetting the
                                // transport immediately after the call.
                                //
                                // For param_request_list: update param_manager's target
                                // vehicle so incoming PARAM_VALUE replies are accepted and
                                // cached for the correct drone.
                                // ────────────────────────────────────────────────────────
                                int target_sysid = j.value("sysid", 1);
                                std::shared_ptr<Vehicle> tv;
                                if (g_vehicle_manager)
                                    tv = g_vehicle_manager->get_vehicle_by_ui_sysid(target_sysid);

                                if (!tv && g_vehicle_manager)
                                {
                                    // Fallback: use active vehicle
                                    tv = g_vehicle_manager->get_active_vehicle();
                                    std::cout << "[ParamWS] sysid=" << target_sysid
                                              << " not found — falling back to active vehicle\n";
                                }

                                if (type == "param_set" && tv)
                                {
                                    // ── Direct PARAM_SET to target vehicle ───────────────
                                    // Build and send the MAVLink frame without going through
                                    // param_manager, so we never disturb its cached target.
                                    const std::string param_id = j.value("param_id", "");
                                    const float       value    = j.value("value",    0.f);

                                    if (param_id.empty())
                                    {
                                        json err;
                                        err["type"]    = "param_error";
                                        err["message"] = "param_set: 'param_id' field is required";
                                        send_ws_safe(err.dump());
                                    }
                                    else
                                    {
                                        mavlink_param_set_t ps{};
                                        ps.target_system    = static_cast<uint8_t>(tv->sysid());
                                        ps.target_component = static_cast<uint8_t>(tv->compid());
                                        ps.param_value      = value;
                                        ps.param_type       = MAV_PARAM_TYPE_REAL32;

                                        // Honour the cached type from param_manager if known
                                        // (param_manager may hold the type from the initial
                                        //  param load for this vehicle).
                                        {
                                            // Temporarily check param_manager cache for type
                                            // (read-only, no transport mutation needed).
                                        }

                                        std::memset(ps.param_id, 0, sizeof(ps.param_id));
                                        std::strncpy(ps.param_id, param_id.c_str(), sizeof(ps.param_id));

                                        mavlink_message_t mav;
                                        mavlink_msg_param_set_encode(
                                            255, MAV_COMP_ID_MISSIONPLANNER, &mav, &ps);
                                        tv->send_mavlink(mav);

                                        std::cout << "[ParamWS] PARAM_SET " << param_id
                                                  << " = " << value
                                                  << " → sysid=" << tv->sysid() << "\n";

                                        // ── Update GCS Cache ────────────────────────────────
                                        param_manager.setVehicleInfo(tv->sysid(), tv->compid());
                                        param_manager.setCacheKey(tv->ui_sysid());
                                        param_manager.updateParamCache(param_id, value);

                                        // Ack to frontend
                                        json ack;
                                        ack["type"]     = "param_set_sent";
                                        ack["param_id"] = param_id;
                                        ack["value"]    = value;
                                        ack["sysid"]    = tv->sysid();
                                        ack["message"]  = "PARAM_SET sent to sysid="
                                                          + std::to_string(tv->sysid())
                                                          + " — waiting for FC echo…";
                                        send_ws_safe(ack.dump());
                                    }
                                }
                                else if ((type == "param_request_list" || type == "param_get_all") && tv)
                                {
                                    // ── Re-wire param_manager to the requested drone ──────
                                    // Keep it wired to this drone until the next explicit
                                    // change; do NOT call wire_modules_to_active_vehicle()
                                    // afterwards so it stays pointed at the right target.
                                    auto mavlink_via_tv = [tv](const mavlink_message_t& msg) {
                                        tv->send_mavlink(msg);
                                    };
                                    param_manager.setTransportCallback(mavlink_via_tv);
                                    param_manager.setVehicleInfo(tv->sysid(), tv->compid());
                                    param_manager.setCacheKey(tv->ui_sysid());  // unique cache key per drone
                                    std::cout << "[ParamWS] " << type << " routed to sysid="
                                              << tv->sysid() << " ui_sysid=" << tv->ui_sysid() << "\n";
                                    handle_param_ws_command(type, j, param_manager);
                                    // NOTE: intentionally NOT calling
                                    // wire_modules_to_active_vehicle() here — param_manager
                                    // must stay wired to the selected drone so PARAM_VALUE
                                    // replies are processed correctly.
                                }
                                else if (!tv)
                                {
                                    json err;
                                    err["type"]    = "param_error";
                                    err["message"] = "No vehicle found for sysid="
                                                    + std::to_string(target_sysid);
                                    send_ws_safe(err.dump());
                                }
                            }

                            else if (handle_param_ws_command(type, j, param_manager))
                            {
                                // handled by parameter_ws_handler.h
                            }

                            else if (g_firmware_manager &&
                                     g_firmware_manager->handle_ws_message(payload))
                            {
                                // Handled by FirmwareManager
                            }
                            else
                            {
                                std::cout << "[WS] Unknown message type: " << type << "\n";
                            }
                        }
                        catch (const json::exception& e)
                        {
                            std::cout << "[WS] JSON error: " << e.what() << "\n";
                        }
                    }
                }
                catch (...)
                {
                    // connection dropped
                }

                std::cout << "[WebSocket] Client disconnected\n";
                {
                    std::lock_guard<std::mutex> lock(ws_mutex);
                    ws_clients.erase(
                        std::remove(ws_clients.begin(), ws_clients.end(), entry),
                        ws_clients.end());
                }

            }).detach();

        } // accept loop
    }).detach();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════════════

int main()
{
    asio::io_context io;

    // ── MAVLink Inspector — must be created before link_manager callback ───────
    MavlinkInspector mavlink_inspector(io);
    g_mavlink_inspector = &mavlink_inspector;
    mavlink_inspector.set_ws_callback([](const std::string& json) {
        send_ws_safe(json);
    });
    mavlink_inspector.start();
    std::cout << "[Inspector] MAVLink Inspector started\n";

    LinkManager    link_manager;
    CommandManager cmd_manager;

    udp_transport = std::make_shared<UdpTransport>(
        io, "0.0.0.0", 14550,
        "127.0.0.1", 14550);

    int udp_id = link_manager.add_link(udp_transport, io);
    link_manager.start_link(udp_id);
    udp_link_id    = udp_id;
    udp_port_bound = true;
    std::cout << "[UDP] Ready on port 14550\n";

    // Serial ports are now opened entirely by start_serial_monitor().
    // No startup open here — avoids double-opening ttyACM0 on the first
    // monitor scan 2 seconds later.
    std::cout << "[Serial] Monitor will open ports on first scan\n";

    VehicleManager vehicle_manager(&link_manager);
    g_vehicle_manager = &vehicle_manager;

    // ── SwitchManager — constructed after VehicleManager is live ─────────────
    //
    // SwitchManager holds a VehicleManager* and resolves the active vehicle
    // at call-time (same pattern as compassCalib transport callback).
    // g_switch_manager is a raw global pointer so the WS thread lambda can
    // reach it without capturing a local reference.
    //
    // on_write_ fires send_ws_safe() with a "rc_switch_written" confirmation
    // JSON so the UI can immediately clear the dirty badge for that channel.
    SwitchManager switch_manager(&vehicle_manager);
    g_switch_manager = &switch_manager;

    switch_manager.set_on_write(
        [](int channel, const std::string& param_name, int value)
        {
            json confirmation;
            confirmation["type"]    = "rc_switch_written";
            confirmation["channel"] = channel;
            confirmation["param"]   = param_name;
            confirmation["value"]   = value;
            send_ws_safe(confirmation.dump());
        });
    // ─────────────────────────────────────────────────────────────────────────

    cmd_manager.set_vehicle_manager(&vehicle_manager);

    auto ws_send = [](const std::string& msg){ send_ws_safe(msg); };
    // NOTE: compassCalib send callback is now wired per-vehicle in on_new_vehicle.
    // NOTE: escCalib + radioCalib send/transport callbacks are now wired per-vehicle in on_new_vehicle.
    flightMode  .setSendCallback(ws_send);
    param_manager.setSendCallback(ws_send);

    // ── FirmwareManager — MAVLink-free, QGC / Mission Planner style ───────────
    //
    // Flash flow: detect port → DTR toggle → bootloader sync → erase → program
    // No MAVLink connection, heartbeat, or vehicle reboot command required.
    // A board with completely dead firmware can be flashed because we talk
    // directly to the STM32/PX4 bootloader over serial.
    FirmwareManager firmware_manager("resources/firmware/", ws_send);
    g_firmware_manager = &firmware_manager;

    // Suspend callback: stop and release the serial transport so the port FD
    // is free before FirmwareUploader opens the same port for bootloader access.
    // We clear detected_serial_port immediately so the monitor does not race
    // to re-open the port while the board is rebooting into the bootloader.
    firmware_manager.set_suspend_serial_callback([&]() {
        firmware_flashing.store(true);
        if (serial_transport) {
            serial_transport->stop();
            serial_transport = nullptr;
        }
        // Clear immediately — the board is about to re-enumerate under a new
        // device node and wait_for_bootloader_port() will discover the new one.
        detected_serial_port.clear();
        serial_link_id = -1;
        drone_connected = false;
        std::cout << "[Firmware] Serial transport suspended for flashing.\n";
    });

    // Reconnect callback: clear the flashing flag so the serial monitor loop
    // can naturally re-discover and reconnect the board after flashing.
    firmware_manager.set_reconnect_callback([&]() {
        firmware_flashing.store(false);
        // Clear the cached port so the monitor re-discovers and re-opens it.
        detected_serial_port.clear();
        serial_transport = nullptr;
        serial_link_id   = -1;
        std::cout << "[Firmware] Serial reconnection enabled — monitor will reconnect.\n";

        // ── Push a fresh port scan to all UI clients ───────────────────────
        // After flash the board re-enumerates (possibly as a different node).
        // Give it 1.5 s to settle, then broadcast the updated port list so the
        // Vehicle Config panel shows the correct port without a manual Refresh.
        std::thread([&]() {
            std::this_thread::sleep_for(std::chrono::milliseconds(1500));
            auto live_ports = scan_serial_ports();
            json sp;
            sp["type"] = "serial_ports";
            json sp_arr = json::array();
            for (auto& p : live_ports) {
                json e;
                e["port"]         = p.port;
                e["display"]      = p.display;
                e["description"]  = p.description;
                e["manufacturer"] = p.manufacturer;
                e["board_id"]     = "";
                e["brand"]        = "";
                sp_arr.push_back(e);
            }
            sp["ports"] = sp_arr;
            send_ws_safe(sp.dump());
            std::cout << "[Firmware] Post-flash port scan pushed "
                      << live_ports.size() << " port(s) to UI.\n";
        }).detach();
    });

    // Get-active-port callback: lets FirmwareManager discover the currently
    // open serial port for "hot flash" when the UI omits the port field.
    firmware_manager.set_get_active_port_callback([&]() -> std::string {
        return detected_serial_port;
    });

    // Reboot-to-bootloader callback: optionally send a MAVLink
    // MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN (param1=3) to ask ArduPilot to jump
    // into the bootloader before the port is released.  This is called by
    // do_flash() BEFORE suspend_cb_ so the vehicle is still reachable.
    //
    // This is belt-and-braces: FirmwareUploader will also assert DTR to force
    // a hardware reset regardless.  However on boards where DTR is not wired
    // to the reset line (e.g. some CubeOrange+ carrier boards) the MAVLink
    // command is the only reliable way to enter the bootloader cleanly.
    //
    // If no vehicle is connected (pure bootloader flash from cold), this
    // callback is a no-op and the DTR toggle in FirmwareUploader handles entry.
    firmware_manager.set_reboot_to_bootloader_callback([&]() {
        if (!g_vehicle_manager) return;
        auto v = g_vehicle_manager->get_active_vehicle();
        if (!v) {
            std::cout << "[Firmware] Reboot-to-BL: no active vehicle — "
                         "skipping MAVLink command, DTR toggle will handle entry.\n";
            return;
        }

        mavlink_message_t      reboot_msg;
        mavlink_command_long_t reboot_cmd{};
        reboot_cmd.target_system    = static_cast<uint8_t>(v->sysid());
        reboot_cmd.target_component = static_cast<uint8_t>(v->compid());
        reboot_cmd.command          = MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN;
        reboot_cmd.confirmation     = 0;
        reboot_cmd.param1           = 3;   // 3 = reboot autopilot into bootloader
        reboot_cmd.param2           = 0;

        mavlink_msg_command_long_encode(
            255, MAV_COMP_ID_MISSIONPLANNER, &reboot_msg, &reboot_cmd);

        v->send_mavlink(reboot_msg);
        std::cout << "[Firmware] Sent MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN (param1=3) "
                     "→ reboot into bootloader\n";

        // Give ArduPilot ~500 ms to process the command and enter the
        // bootloader before FirmwareUploader opens the port.
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    });
    // ─────────────────────────────────────────────────────────────────────────

    vehicle_manager.set_on_new_vehicle(
        [&](std::shared_ptr<Vehicle> vehicle)
    {
        const int sysid = vehicle->sysid();
        std::cout << "[GCS] Attaching handlers for sysid=" << sysid << "\n";

        // ── AccelCalibration — per-vehicle instance ───────────────────────────
        // vehicle->accel_calib() returns the AccelCalibration that lives inside
        // this specific Vehicle.  The transport callback is bound here so that
        // every MAVLink message it sends goes out on the correct drone's link.
        {
            auto vp = vehicle;  // shared_ptr keeps vehicle alive in lambdas
            vp->accel_calib().setTransportCallback(
                [vp](const mavlink_message_t& m){ vp->send_mavlink(m); });
            vp->accel_calib().setSendCallback(send_ws_safe);

            // Register message handlers that route only into THIS vehicle's
            // accel calibration instance.
            vehicle->register_handler(MAVLINK_MSG_ID_HEARTBEAT,
                [vp](const mavlink_message_t& m){ vp->accel_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_ATTITUDE,
                [vp](const mavlink_message_t& m){ vp->accel_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_COMMAND_LONG,
                [vp](const mavlink_message_t& m){ vp->accel_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_COMMAND_ACK,
                [vp](const mavlink_message_t& m){ vp->accel_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_STATUSTEXT,
                [vp](const mavlink_message_t& m){ vp->accel_calib().processMessage(m); });
        }

        // ── CompassCalibration — per-vehicle instance ─────────────────────────
        // vehicle->compass_calib() is the CompassCalibration that lives inside
        // this specific Vehicle.  Transport + send callbacks are bound here so
        // every MAVLink message it sends goes out on the correct drone's link,
        // and every JSON status update goes to all WebSocket clients.
        {
            auto vp = vehicle;
            vp->compass_calib().setTransportCallback(
                [vp](const mavlink_message_t& m){ vp->send_mavlink(m); });
            vp->compass_calib().setSendCallback(send_ws_safe);

            vehicle->register_handler(MAVLINK_MSG_ID_HEARTBEAT,
                [vp](const mavlink_message_t& m){ vp->compass_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_COMMAND_ACK,
                [vp](const mavlink_message_t& m){ vp->compass_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_STATUSTEXT,
                [vp](const mavlink_message_t& m){ vp->compass_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_MAG_CAL_PROGRESS,
                [vp](const mavlink_message_t& m){ vp->compass_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_MAG_CAL_REPORT,
                [vp](const mavlink_message_t& m){ vp->compass_calib().processMessage(m); });
        }

        // RadioCalibration — per-vehicle instance
        {
            auto vp = vehicle;
            vp->radio_calib().setTransportCallback(
                [vp](const mavlink_message_t& m){ vp->send_mavlink(m); });
            vp->radio_calib().setSendCallback(send_ws_safe);
            vp->radio_calib().setVehicleInfo(vehicle->sysid(), vehicle->compid());

            vehicle->register_handler(MAVLINK_MSG_ID_RC_CHANNELS,
                [vp](const mavlink_message_t& m){ vp->radio_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_RC_CHANNELS_RAW,
                [vp](const mavlink_message_t& m){ vp->radio_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_COMMAND_ACK,
                [vp](const mavlink_message_t& m){ vp->radio_calib().processMessage(m); });
            vehicle->register_handler(MAVLINK_MSG_ID_STATUSTEXT,
                [vp](const mavlink_message_t& m){ vp->radio_calib().processMessage(m); });
        }

        // EscCalibration — per-vehicle instance
        {
            auto vp = vehicle;
            vp->esc_calib().setTransportCallback(
                [vp](const mavlink_message_t& m){ vp->send_mavlink(m); });
            vp->esc_calib().setSendCallback(send_ws_safe);
            vp->esc_calib().setVehicleInfo(vehicle->sysid(), vehicle->compid());

            vehicle->register_handler(MAVLINK_MSG_ID_COMMAND_ACK,
                [vp](const mavlink_message_t& m){ vp->esc_calib().processMessage(m); });
        }

        // FlightMode
        vehicle->register_handler(MAVLINK_MSG_ID_HEARTBEAT,
            [](const mavlink_message_t& m){ flightMode.processMessage(m); });
        vehicle->register_handler(MAVLINK_MSG_ID_RC_CHANNELS,
            [](const mavlink_message_t& m){ flightMode.processMessage(m); });
        vehicle->register_handler(MAVLINK_MSG_ID_PARAM_VALUE,
            [](const mavlink_message_t& m){ flightMode.processMessage(m); });

        // ── Wire modules to the active (first/primary) vehicle only ──────────
        // wire_modules_to_active_vehicle() points the shared param_manager at
        // whatever get_active_vehicle() returns (sysid of the first drone).
        // We only call it for the PRIMARY vehicle.  For swarm secondaries we
        // skip it entirely — param_manager must stay pointed at the vehicle
        // whose load is already in flight, and requestAllParameters() must NOT
        // be called again because stop_retry_thread() inside it does a blocking
        // join() that stalls the MAVLink RX thread for every new swarm member,
        // eventually causing the backend to appear frozen / terminate.
        //
        // Secondary drone parameters can be fetched on demand when the user
        // opens the Full Params panel for that drone (the WS handler at
        // "param_request_list" with a sysid field already handles this
        // correctly via per-vehicle routing).
        {
            bool is_primary_vehicle = false;
            if (g_vehicle_manager)
            {
                auto all = g_vehicle_manager->get_all_sysids();
                // Primary = only one vehicle alive (the one just registered)
                is_primary_vehicle = (all.size() <= 1);
            }

            if (is_primary_vehicle)
            {
                wire_modules_to_active_vehicle();

                // ── NOTE: Do NOT call param_manager.requestAllParameters() here.
                // The heartbeat handler (new_connection != active_connection path)
                // fires within milliseconds of on_new_vehicle and is the single
                // authoritative place to trigger parameter loading.  Calling it
                // here too (with a 500 ms delay) kills the already-running retry
                // thread and restarts the load from scratch — wasting 5–10 seconds.
                std::cout << "[GCS] Primary vehicle sysid="
                          << vehicle->sysid() << " wired — param load via heartbeat handler\n";
            }
            else
            {
                // Swarm secondary — just request flight-mode params so the
                // mode indicator works.  Do NOT touch param_manager transport
                // or call requestAllParameters().
                std::thread([vehicle]() {
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    flightMode.requestParams();
                    std::cout << "[GCS] Swarm secondary sysid="
                              << vehicle->sysid()
                              << " — skipping auto param-load (use UI to fetch)\n";
                }).detach();
            }
        }

        send_status();   // immediately push updated vehicle list to UI
    });

    vehicle_manager.set_on_vehicle_lost(
        [&](int sysid, int ui_sysid)
    {
        std::cout << "[GCS] Vehicle sysid=" << sysid
                  << " (ui_sysid=" << ui_sysid << ") lost\n";
        drone_connected   = false;
        active_connection = "NONE";  // reset so next heartbeat always re-wires

        // Delete the per-vehicle parameter cache keyed by ui_sysid.
        // Using ui_sysid (not real sysid) prevents cache file collision when
        // multiple drones share sysid=1 (ArduPilot default in multi-port mode).
        param_manager.deleteCache(ui_sysid);

        send_status();
    });

    // ── Single MAVLink message callback ──────────────────────────────────────
    //
    // MAG_CAL_PROGRESS and MAG_CAL_REPORT are fed directly to
    // compassCalib.processMessage() here as a belt-and-braces guarantee,
    // bypassing the vehicle dispatch chain entirely (ArduPilot sends them
    // with sysid=0 broadcast).
    link_manager.set_message_callback(
        [&](const mavlink_message_t& msg, int link_id)
    {
        last_msg = std::chrono::steady_clock::now();

        if (msg.msgid == MAVLINK_MSG_ID_MAG_CAL_PROGRESS ||
            msg.msgid == MAVLINK_MSG_ID_MAG_CAL_REPORT)
        {
            std::cout << "[DIAG] RAW msgid=" << msg.msgid
                      << " sysid=" << (int)msg.sysid
                      << " link_id=" << link_id << "\n";
        }

        vehicle_manager.handle_message(msg, link_id);

        param_manager.processMessage(msg);

        // ── MAVLink Inspector — feed every drone message (skip GCS loopback) ──
        if (msg.sysid != 255 && g_mavlink_inspector)
            g_mavlink_inspector->on_message(msg);

        // NOTE: MAG_CAL_PROGRESS (191) and MAG_CAL_REPORT (192) arrive with
        // sysid=0 (broadcast).  VehicleManager::handle_message() routes sysid=0
        // to all live vehicles → each vehicle's registered handlers call
        // vehicle->compass_calib().processMessage(msg).
        // No direct call needed here — the per-vehicle dispatch handles it.

        // ── Satellite count — updated by GPS_RAW_INT, read by GLOBAL_POSITION_INT ─
        static int g_cached_satellites = 0;

        // ── HEARTBEAT — connection management ─────────────────────────────
        if (msg.msgid == MAVLINK_MSG_ID_HEARTBEAT)
        {
            // Guard: only proceed if an actual FC vehicle exists on this link.
            // Prevents the SiK/RFD radio heartbeat (compid=0, type=27) that
            // arrives BEFORE the ArduPilot heartbeat from calling
            // wire_modules / request_rc_channels_stream on a null vehicle.
            auto live_vehicle = vehicle_manager.get_vehicle_by_link(link_id);
            if (!live_vehicle)
            {
                send_status();
                return;
            }

            drone_connected = true;

            std::string new_connection;
            std::shared_ptr<Transport> new_transport;

            // ── Check if this heartbeat came in on any serial link ────────────
            // serial_link_id only tracks the FIRST port opened (legacy global).
            // With multiple serial ports open (e.g. COM3, COM12, COM13), the
            // drone's heartbeat may arrive on a later link_id.  Look up the
            // transport from g_serial_ports by link_id instead.
            {
                std::lock_guard<std::mutex> lk(g_serial_ports_mutex);
                for (auto& kv : g_serial_ports)
                {
                    if (kv.second.link_id == link_id)
                    {
                        new_connection = "SERIAL";
                        new_transport  = kv.second.transport;
                        break;
                    }
                }
            }

            if (new_connection.empty() && link_id == udp_id)
            {
                // Allow UDP even when Serial is also active — a second drone
                // may connect via UDP while the first is on Serial.
                // Only take over active_connection if Serial is not live.
                if (active_connection != "SERIAL")
                {
                    new_connection = "UDP";
                    new_transport  = udp_transport;
                }
                // Always send status so the second drone appears in the
                // frontend vehicle list even if we don't switch connections.
                send_status();
                if (new_connection.empty()) return;
            }
            else if (new_connection.empty())
            {
                // Heartbeat on a dynamic UDP/serial link (14551, 14552, etc.).
                // VehicleManager has already discovered the vehicle; we just need
                // to request telemetry streams so GPS/attitude data flows.
                auto dyn_vehicle = vehicle_manager.get_vehicle_by_link(link_id);
                if (dyn_vehicle)
                    request_streams_for_vehicle(dyn_vehicle);

                send_status();
                return;
            }
            // else: new_connection == "SERIAL" — fall through to update below.

            if (new_connection != active_connection)
            {
                active_connection = new_connection;
                cmd_manager.set_transport(new_transport);

                std::cout << "[GCS] Connected via " << active_connection
                          << " (link_id=" << link_id << ")\n";

                wire_modules_to_active_vehicle();

                flightMode.resetParamsRequested();
                request_rc_channels_stream();
                request_telemetry_streams();          // GPS, ATTITUDE, VFR_HUD streams
                request_gps_raw_int_via_command();    // GPS_RAW_INT via SET_MESSAGE_INTERVAL
                // force=false: skip if a load is already running (avoids restarting
                // a good in-progress load every time the connection type is re-detected).
                param_manager.requestAllParameters(/*force=*/false);
                flightMode.requestParams();
            }

            send_status();
        }

        else if (msg.msgid == MAVLINK_MSG_ID_MISSION_REQUEST)
        {
            mavlink_mission_request_t req;
            mavlink_msg_mission_request_decode(&msg, &req);
            std::cout << "[MAVLink] MISSION_REQUEST seq=" << req.seq << "\n";
            cmd_manager.on_mission_request(req.seq);
        }

        else if (msg.msgid == MAVLINK_MSG_ID_MISSION_REQUEST_INT)
        {
            mavlink_mission_request_int_t req;
            mavlink_msg_mission_request_int_decode(&msg, &req);
            std::cout << "[MAVLink] MISSION_REQUEST_INT seq=" << req.seq << "\n";
            cmd_manager.on_mission_request(req.seq);
        }

        else if (msg.msgid == MAVLINK_MSG_ID_MISSION_ACK)
        {
            mavlink_mission_ack_t ack;
            mavlink_msg_mission_ack_decode(&msg, &ack);
            std::cout << "[MAVLink] MISSION_ACK type=" << (int)ack.type << "\n";
            cmd_manager.on_mission_ack(ack.type);
        }

        int ui_sysid = static_cast<int>(msg.sysid);
        if (g_vehicle_manager)
        {
            auto v = g_vehicle_manager->get_vehicle_by_link(link_id);
            if (!v || v->sysid() != msg.sysid)
                v = g_vehicle_manager->get_vehicle(msg.sysid);
            if (v)
                ui_sysid = v->ui_sysid();
        }

        if (msg.msgid == MAVLINK_MSG_ID_ATTITUDE)
        {
            mavlink_attitude_t att;
            mavlink_msg_attitude_decode(&msg, &att);

            json j;
            j["type"]  = "attitude";
            j["sysid"] = ui_sysid;
            j["roll"]  = att.roll;
            j["pitch"] = att.pitch;
            j["yaw"]   = att.yaw;
            send_ws_safe(j.dump());
        }

        else if (msg.msgid == MAVLINK_MSG_ID_GLOBAL_POSITION_INT)
        {
            mavlink_global_position_int_t pos;
            mavlink_msg_global_position_int_decode(&msg, &pos);

            double lat     = pos.lat         / 1e7;
            double lon     = pos.lon         / 1e7;
            double alt_rel = pos.relative_alt / 1000.0;
            double alt_msl = pos.alt          / 1000.0;
            double hdg     = (pos.hdg == 0xFFFF) ? 0.0 : (pos.hdg / 100.0);

            // vx, vy are in cm/s — compute horizontal groundspeed in m/s
            double vx_ms       = pos.vx / 100.0;
            double vy_ms       = pos.vy / 100.0;
            double groundspeed = std::sqrt(vx_ms * vx_ms + vy_ms * vy_ms);

            if (lat != 0.0 || lon != 0.0)
            {
                json gps;
                gps["type"]         = "gps";
                gps["sysid"]        = ui_sysid;   // unique per-link ID for map
                gps["real_sysid"]   = static_cast<int>(msg.sysid);
                gps["link_id"]      = link_id;
                gps["latitude"]     = lat;
                gps["longitude"]    = lon;
                gps["altitude"]     = alt_rel;
                gps["altitude_msl"] = alt_msl;
                gps["heading"]      = hdg;
                gps["groundspeed"]  = groundspeed;
                gps["satellites"]   = g_cached_satellites;
                send_ws_safe(gps.dump());
            }
        }

        // ── VFR_HUD — groundspeed for compass speed readout ───────────────
        else if (msg.msgid == MAVLINK_MSG_ID_VFR_HUD)
        {
            mavlink_vfr_hud_t hud;
            mavlink_msg_vfr_hud_decode(&msg, &hud);

            json t;
            t["type"]        = "telemetry";
            t["sysid"]       = ui_sysid;
            t["groundspeed"] = static_cast<double>(hud.groundspeed);
            t["airspeed"]    = static_cast<double>(hud.airspeed);
            t["throttle"]    = static_cast<int>(hud.throttle);
            t["climb"]       = static_cast<double>(hud.climb);
            send_ws_safe(t.dump());
        }

        // ── GPS_RAW_INT — update satellite count cache + WS telemetry ────────
        else if (msg.msgid == MAVLINK_MSG_ID_GPS_RAW_INT)
        {
            mavlink_gps_raw_int_t gps_raw;
            mavlink_msg_gps_raw_int_decode(&msg, &gps_raw);

            // 255 = unknown in MAVLink; treat as 0 for display
            int sats = static_cast<int>(gps_raw.satellites_visible);
            if (sats == 255) sats = 0;
            g_cached_satellites = sats;

            // Also push a lightweight telemetry packet for satellite-only listeners
            json t;
            t["type"]       = "telemetry";
            t["sysid"]      = ui_sysid;
            t["satellites"] = sats;
            send_ws_safe(t.dump());
        }

        // ── SYS_STATUS — battery voltage + remaining percentage ───────────────
        // ArduPilot broadcasts SYS_STATUS at ~1 Hz (or faster with MAV_DATA_STREAM_EXTENDED_STATUS).
        // voltage_battery: mV (UINT16_MAX = not available).
        // battery_remaining: 0-100 % (-1 = unknown).
        else if (msg.msgid == MAVLINK_MSG_ID_SYS_STATUS)
        {
            mavlink_sys_status_t ss;
            mavlink_msg_sys_status_decode(&msg, &ss);

            json t;
            t["type"]  = "telemetry";
            t["sysid"] = ui_sysid;

            // Voltage: UINT16_MAX means not provided
            if (ss.voltage_battery != 0xFFFF)
                t["battery_voltage"] = static_cast<double>(ss.voltage_battery) / 1000.0;

            // Remaining: -1 means unknown; cast uint8_t to int8_t to handle signed value
            int8_t batt_pct = static_cast<int8_t>(ss.battery_remaining);
            if (batt_pct >= 0)
                t["battery_percent"] = static_cast<int>(batt_pct);

            send_ws_safe(t.dump());
        }

        // ── RC_CHANNELS — RSSI for signal-strength indicator ─────────────────
        // rssi field: 0=0%, 254=100%, 255=invalid/not available.
        // Forwarded as a lightweight telemetry packet so the header bar
        // signal icon and percentage update in real-time.
        else if (msg.msgid == MAVLINK_MSG_ID_RC_CHANNELS)
        {
            mavlink_rc_channels_t rc;
            mavlink_msg_rc_channels_decode(&msg, &rc);

            // 255 = not available; skip sending if unknown
            if (rc.rssi != 255)
            {
                // Convert 0-254 scale to 0-100%
                int rssi_pct = static_cast<int>((static_cast<unsigned>(rc.rssi) * 100) / 254);
                if (rssi_pct > 100) rssi_pct = 100;

                json t;
                t["type"] = "telemetry";
                t["sysid"] = ui_sysid;
                t["rssi"] = rssi_pct;
                send_ws_safe(t.dump());
            }
        }

        // ── STATUSTEXT — drone/MAVProxy console messages ──────────────────
        // Forward every STATUSTEXT packet from the drone to the browser so
        // the message console shows real MAVProxy output instead of GCS
        // internal log lines.
        else if (msg.msgid == MAVLINK_MSG_ID_STATUSTEXT)
        {
            mavlink_statustext_t st;
            mavlink_msg_statustext_decode(&msg, &st);

            // Ensure the text is null-terminated (MAVLink field is 50 chars,
            // not guaranteed to have a trailing NUL when full).
            char text[51];
            std::memcpy(text, st.text, 50);
            text[50] = '\0';

            // Map MAV_SEVERITY to a simple string the frontend can colour-code.
            // MAV_SEVERITY: 0=EMERGENCY,1=ALERT,2=CRITICAL,3=ERROR,
            //               4=WARNING,5=NOTICE,6=INFO,7=DEBUG
            const char* severity_str = "info";
            if (st.severity <= 3)       severity_str = "error";
            else if (st.severity == 4)  severity_str = "warning";
            else if (st.severity >= 5)  severity_str = "info";

            json con;
            con["type"]     = "drone_console";
            con["text"]     = text;
            con["severity"] = severity_str;
            con["sysid"]    = ui_sysid;
            send_ws_safe(con.dump());

            std::cout << "[DRONE] " << text << "\n";
        }

        // ── LOG_ENTRY — drone sends log list entries ───────────────────────
        // Received in response to LOG_REQUEST_LIST.
        // Forward each entry to the browser so log-download.js can populate
        // the log table.  The frontend uses num_logs to know when the list
        // is complete.
        else if (msg.msgid == MAVLINK_MSG_ID_LOG_ENTRY)
        {
            mavlink_log_entry_t le;
            mavlink_msg_log_entry_decode(&msg, &le);

            json j;
            j["type"]     = "log_entry";
            j["id"]       = static_cast<int>(le.id);
            j["num_logs"] = static_cast<int>(le.num_logs);
            j["size"]     = static_cast<uint32_t>(le.size);
            j["time_utc"] = static_cast<uint32_t>(le.time_utc);
            send_ws_safe(j.dump());

            std::cout << "[LogDL] LOG_ENTRY id=" << le.id
                      << " total=" << le.num_logs
                      << " size=" << le.size << "\n";
        }

        // ── LOG_DATA — chunks of a downloading log file ────────────────────
        // Received in response to LOG_REQUEST_DATA.
        // Accumulate into g_log_dl.data; send a progress update to the browser
        // after every chunk.  When all bytes are received, send log_download_done
        // with the complete base64-encoded binary.
        else if (msg.msgid == MAVLINK_MSG_ID_LOG_DATA)
        {
            mavlink_log_data_t ld;
            mavlink_msg_log_data_decode(&msg, &ld);

            std::lock_guard<std::mutex> lk(g_log_dl_mutex);
            if (!g_log_dl.active || ld.id != g_log_dl.log_id)
                return;  // stale or unexpected chunk

            // ld.ofs is the byte offset; ld.count is bytes valid in this chunk
            uint32_t ofs   = ld.ofs;
            uint8_t  count = ld.count;

            // ── count==0 → ArduPilot end-of-log sentinel ─────────────────
            // ArduPilot sends a final LOG_DATA with count=0 when the transfer
            // is complete.  Handle it immediately: send 100% progress then
            // ship the done event.
            if (count == 0)
            {
                uint32_t finalTotal = g_log_dl.total > 0
                                      ? g_log_dl.total
                                      : static_cast<uint32_t>(g_log_dl.data.size());

                // 100% progress frame so the browser bar always completes
                json prog100;
                prog100["type"]     = "log_download_progress";
                prog100["log_id"]   = static_cast<int>(g_log_dl.log_id);
                prog100["received"] = finalTotal;
                prog100["total"]    = finalTotal;
                send_ws_safe(prog100.dump());

                std::string b64 = log_base64_encode(
                    g_log_dl.data.data(), g_log_dl.data.size());

                json dl_done;
                dl_done["type"]   = "log_download_done";
                dl_done["log_id"] = static_cast<int>(g_log_dl.log_id);
                dl_done["size"]   = static_cast<uint32_t>(g_log_dl.data.size());
                dl_done["data"]   = b64;
                send_ws_safe(dl_done.dump());

                std::cout << "[LogDL] Done (count=0 sentinel): log_id="
                          << g_log_dl.log_id
                          << " bytes=" << g_log_dl.data.size() << "\n";

                g_log_dl.active = false;
                g_log_dl.data.clear();
                g_log_dl.data.shrink_to_fit();
                return;
            }

            // ── Normal data chunk ─────────────────────────────────────────
            // Grow buffer on-demand (in case size was unknown when dl started)
            uint32_t end = ofs + static_cast<uint32_t>(count);
            if (end > g_log_dl.data.size())
                g_log_dl.data.resize(end, 0xFF);
            if (g_log_dl.total == 0)
                g_log_dl.total = end;

            std::memcpy(g_log_dl.data.data() + ofs, ld.data, count);

            // Track received as a high-water mark (max ofs+count seen).
            // Summing chunk sizes double-counts retransmitted packets.
            if (end > g_log_dl.received)
                g_log_dl.received = end;

            // Push progress to browser
            uint32_t tot = g_log_dl.total > 0 ? g_log_dl.total : 1;
            {
                json prog;
                prog["type"]     = "log_download_progress";
                prog["log_id"]   = static_cast<int>(g_log_dl.log_id);
                prog["received"] = g_log_dl.received;
                prog["total"]    = tot;
                send_ws_safe(prog.dump());
            }

            // Also complete if the high-water mark reached the declared total
            // (fallback for firmwares that omit the count==0 sentinel).
            if (g_log_dl.total > 0 && g_log_dl.received >= g_log_dl.total)
            {
                // Explicit 100% frame before the done event
                json prog100;
                prog100["type"]     = "log_download_progress";
                prog100["log_id"]   = static_cast<int>(g_log_dl.log_id);
                prog100["received"] = g_log_dl.total;
                prog100["total"]    = g_log_dl.total;
                send_ws_safe(prog100.dump());

                std::string b64 = log_base64_encode(
                    g_log_dl.data.data(), g_log_dl.data.size());

                json dl_done;
                dl_done["type"]   = "log_download_done";
                dl_done["log_id"] = static_cast<int>(g_log_dl.log_id);
                dl_done["size"]   = static_cast<uint32_t>(g_log_dl.data.size());
                dl_done["data"]   = b64;
                send_ws_safe(dl_done.dump());

                std::cout << "[LogDL] Done (high-water): log_id="
                          << g_log_dl.log_id
                          << " bytes=" << g_log_dl.data.size() << "\n";

                g_log_dl.active = false;
                g_log_dl.data.clear();
                g_log_dl.data.shrink_to_fit();
            }
        }
    });

    cmd_manager.set_transport(udp_transport);

    cmd_manager.set_response_callback([](const std::string& resp) {
        send_ws_safe(resp);
    });

    std::thread([&link_manager]() {
        while (true)
        {
            std::this_thread::sleep_for(std::chrono::seconds(1));

            // ── Send GCS Heartbeat ────────────────────────────────────────────
            // MAVProxy/SITL waits for a GCS heartbeat on its output port before
            // it starts streaming telemetry. We must broadcast our presence at
            // 1 Hz to "wake" any newly connected dynamic UDP links.
            mavlink_message_t msg;
            mavlink_heartbeat_t hb{};
            hb.type           = MAV_TYPE_GCS;
            hb.autopilot      = MAV_AUTOPILOT_INVALID;
            hb.base_mode      = 0;
            hb.custom_mode    = 0;
            hb.system_status  = MAV_STATE_ACTIVE;

            mavlink_msg_heartbeat_encode(255, MAV_COMP_ID_MISSIONPLANNER, &msg, &hb);

            uint8_t buffer[MAVLINK_MAX_PACKET_LEN];
            uint16_t len = mavlink_msg_to_send_buffer(buffer, &msg);
            link_manager.broadcast(buffer, len);
            // ──────────────────────────────────────────────────────────────────

            send_status();
        }
    }).detach();

    std::thread([&vehicle_manager]() {
        while (true)
        {
            std::this_thread::sleep_for(std::chrono::seconds(3));
            vehicle_manager.check_timeouts();
        }
    }).detach();

    // Store global pointers so the WS thread can call add_link at runtime
    g_link_manager = &link_manager;
    g_io_ctx       = &io;

    // ── Install graceful-shutdown handlers ────────────────────────────────────
    // These run perform_clean_shutdown() which:
    //   • Deletes all param cache files immediately
    //   • Stops the io_context so io_threads unblock and main() can exit
    // Covers: Ctrl+C, Ctrl+Break, console close, SIGINT, SIGTERM, and
    // Windows logoff / system shutdown events.
#ifdef _WIN32
    SetConsoleCtrlHandler(console_ctrl_handler, TRUE);
    std::cout << "[GCS] Windows console-ctrl handler installed\n";
#else
    signal(SIGINT,  posix_signal_handler);
    signal(SIGTERM, posix_signal_handler);
    std::cout << "[GCS] POSIX signal handlers installed (SIGINT, SIGTERM)\n";
#endif
    // ─────────────────────────────────────────────────────────────────────────

    start_serial_monitor(io, link_manager, cmd_manager);
    start_websocket(&cmd_manager, &link_manager, io);

    // Camera/MJPEG removed — video is handled via RTSP in the Electron layer

    std::cout << "[GCS] TiHANFly started\n";

    // ── Multi-thread the io_context ──────────────────────────────────────────
    // CRITICAL FIX: Previously io.run() ran on a single thread.
    // When ArduPilot floods the serial port with parameter packets
    // after initial connection, the single thread gets fully occupied
    // dispatching MAVLink parse/send_ws_safe() callbacks — starving the
    // async_read_some re-arm chain.  Heartbeats queue up unread, the
    // vehicle hits its 5-second liveness timeout, gets evicted, and the
    // UI shows the connect/disconnect loop.  UDP is unaffected because
    // its recv callback is less frequent.
    //
    // Fix: run io_context on N threads (min 2, at most hardware concurrency)
    // so serial reads and WebSocket I/O can proceed in parallel.
    {
        unsigned n = std::max(2u, std::thread::hardware_concurrency());
        std::cout << "[GCS] io_context running on " << n << " threads\n";
        std::vector<std::thread> io_threads;
        io_threads.reserve(n);
        for (unsigned i = 0; i < n; ++i)
            io_threads.emplace_back([&io]{ io.run(); });
        for (auto& t : io_threads)
            t.join();
    }

    // -- Clean shutdown -- delete all parameter cache files
    param_manager.deleteAllCaches();
}