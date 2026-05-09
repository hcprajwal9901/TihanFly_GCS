#pragma once
/**
 * firmware_manager.h
 * TiHANFly GCS – firmware installation subsystem
 *
 * -- Design philosophy --------------------------------------------------------
 *
 * Mirrors Mission Planner / QGroundControl exactly:
 *
 *   detect port -> open port -> DTR toggle (bootloader entry) -> sync -> flash
 *
 * NO MAVLink required.  NO VehicleManager.  NO heartbeat.  A board with
 * completely dead or missing firmware can be flashed because we talk
 * directly to the STM32 / PX4 bootloader over serial – bypassing ArduPilot
 * entirely.
 *
 * -- Two trigger paths --------------------------------------------------------
 *
 *  Path A – port already open when UI requests install:
 *    install_firmware WS  ->  handle_ws_message()
 *                         ->  suspend_cb_()           (release MAVLink FD)
 *                         ->  do_flash(port, image)   (uploader takes over)
 *                         ->  reconnect_cb_()         (clear flashing flag)
 *
 *  Path B – board not yet plugged in when UI requests install:
 *    install_firmware WS  ->  handle_ws_message()
 *                         ->  pending_image_ = decoded bytes   (store)
 *    "board plugged in"
 *    serial monitor       ->  install_from_port(port)
 *                         ->  do_flash(port, image)
 *                         ->  reconnect_cb_()
 *
 * -- WebSocket protocol for install_firmware_custom ---------------------------
 *
 * Browsers cannot supply filesystem paths. Send the APJ file content instead:
 *
 *   { "type":  "install_firmware_custom",
 *     "apj":   { <full APJ JSON object from FileReader.readAsText()> },
 *     "port":  "/dev/ttyACM0"  <- optional }
 *
 * If the server already has the file on disk (e.g. downloaded earlier):
 *
 *   { "type":  "install_firmware_custom",
 *     "path":  "/absolute/path/to/firmware.apj",
 *     "port":  "/dev/ttyACM0"  <- optional }
 *
 * -- Thread safety ------------------------------------------------------------
 *
 * do_flash() always runs in a detached thread.
 * pending_image_ and pending_label_ are guarded by pending_mtx_.
 * flashing_ and abort_requested_ are std::atomic<bool>.
 */

#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <functional>
#include <atomic>
#include <mutex>
#include <thread>
#include <cstdint>

class FirmwareManager
{
public:
    // -- Callback type aliases -------------------------------------------------

    // Sends a JSON string to all WebSocket clients.
    using WsSendCb = std::function<void(const std::string&)>;

    // Called before flashing starts: must stop and release the MAVLink serial
    // transport so FirmwareUploader can open the same port.
    using SuspendSerialCb = std::function<void()>;

    // Called after flashing completes (success, failure, or abort): clears the
    // firmware_flashing flag so the serial monitor can reconnect normally.
    using ReconnectCb = std::function<void()>;

    // Called to request the flight controller reboot into bootloader via MAVLink
    // before the serial port is released (optional – skip if board already in BL).
    using RebootToBootloaderCb = std::function<void()>;

    // Called to get the currently active serial port, if any.
    using GetActivePortCb = std::function<std::string()>;

    // -- Construction / destruction --------------------------------------------

    // firmware_dir : directory that holds pre-built .apj / .px4 images.
    //                Example: "resources/firmware/"
    // ws_send      : callback that broadcasts JSON strings to all WS clients.
    FirmwareManager(const std::string& firmware_dir, WsSendCb ws_send);
    ~FirmwareManager();

    FirmwareManager(const FirmwareManager&)            = delete;
    FirmwareManager& operator=(const FirmwareManager&) = delete;

    // -- Callback setters (called once from main.cpp) --------------------------

    void set_suspend_serial_callback(SuspendSerialCb cb);
    void set_reconnect_callback(ReconnectCb cb);
    void set_reboot_to_bootloader_callback(RebootToBootloaderCb cb);
    void set_get_active_port_callback(GetActivePortCb cb);

    // -- WebSocket message handler ---------------------------------------------
    //
    // Recognised types:
    //   "install_firmware"        – board-specific image from firmware_dir_
    //   "install_firmware_custom" – APJ JSON inline ("apj" key) or file path ("path" key)
    //   "abort_firmware"          – abort an in-progress or pending flash
    bool handle_ws_message(const std::string& payload);

    // -- Auto-trigger from serial monitor -------------------------------------
    //
    // Call whenever a new serial port appears.  No-op if no install is pending.
    void install_from_port(const std::string& port);

    // -- Status queries --------------------------------------------------------

    bool is_flashing()        const;
    bool has_pending_install() const;
    void abort();

private:
    // -- Internal helpers ------------------------------------------------------

    // Decode an APJ JSON object to a raw firmware binary.
    // APJ images are base64-encoded AND zlib-compressed (matching uploader.py).
    // Returns an empty vector on failure (error logged internally).
    static std::vector<uint8_t> decode_apj(const std::string& label,
                                            const nlohmann::json& apj);

    // Load an APJ file from disk and decode it.
    std::vector<uint8_t> load_apj_file(const std::string& path);

    // Pre-flight checks (mirror FirmwareFlasherWorker in Python).
    // Returns false and sends a status error if the check fails.
    bool verify_port_access(const std::string& port);
    bool verify_firmware_file(const std::string& path);

    // Warns if ModemManager is active (Linux only – no-op on Windows).
    // Returns true if ModemManager is running.
    bool check_modem_manager();

    // Core flash sequence – always runs in a background thread.
    //   label : human-readable name shown in status messages (filename / summary)
    void do_flash(const std::string&          port,
                  const std::vector<uint8_t>& image,
                  const std::string&          label);

    void send_status(const std::string& stage,
                     const std::string& message,
                     int  progress = -1,
                     bool error    = false);

    // Send the troubleshooting checklist to the WS clients on flash failure.
    // Mirrors FirmwareFlasher._onFinished() from Python.
    void send_troubleshooting_checklist(const std::string& port);

    // -- Member variables ------------------------------------------------------

    std::string firmware_dir_;
    WsSendCb    ws_send_;

    SuspendSerialCb      suspend_cb_;
    ReconnectCb          reconnect_cb_;
    RebootToBootloaderCb reboot_to_bootloader_cb_;
    GetActivePortCb      get_active_port_cb_;

    // Pending install stored as decoded bytes so no file path is required.
    std::vector<uint8_t> pending_image_;
    std::string          pending_label_;   // for display / logging only
    mutable std::mutex   pending_mtx_;

    std::atomic<bool> flashing_{false};
    std::atomic<bool> abort_requested_{false};
};
