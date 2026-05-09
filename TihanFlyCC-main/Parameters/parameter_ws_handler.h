#pragma once
/**
 * parameter_ws_handler.h
 * TiHANFly GCS — Parameter WebSocket Command Handler
 *
 * Drop-in dispatcher for the WebSocket message loop in websocket_server.cpp
 * (or main.cpp).  One call to handle_param_ws_command() covers all parameter
 * related JSON messages from the frontend.
 *
 * ── Quick-start integration (websocket_server.cpp) ────────────────────────────
 *
 *  1.  Add headers near the top of the translation unit that owns the WS loop:
 *
 *        #include "Parameters/parameter_manager.h"
 *        #include "Parameters/parameter_file.h"
 *        #include "Parameters/parameter_ws_handler.h"
 *
 *  2.  Declare a global (or shared_ptr) instance:
 *
 *        ParameterManager g_param_manager(1, 1);  // sysid=1, compid=1
 *
 *  3.  After the WebSocket server is set up, wire the send callback:
 *
 *        g_param_manager.setSendCallback([](const std::string& json_msg) {
 *            send_ws_safe(json_msg);   // broadcast to all connected clients
 *        });
 *
 *  4.  Wire the transport callback (reuse your existing serial/UDP send path):
 *
 *        g_param_manager.setTransportCallback([](const mavlink_message_t& mav) {
 *            uint8_t buf[MAVLINK_MAX_PACKET_LEN];
 *            std::size_t len = mavlink_msg_to_send_buffer(buf, &mav);
 *            // forward buf/len to your serial or UDP transport
 *        });
 *
 *  5.  In your MAVLink receive callback (link_manager), forward every message:
 *
 *        link_manager.set_message_callback([](const mavlink_message_t& msg, int) {
 *            g_param_manager.processMessage(msg);
 *            // ... other handlers ...
 *        });
 *
 *  6.  In the WebSocket message_handler, call this function BEFORE the generic
 *      fallthrough:
 *
 *        ws_server.set_message_handler(
 *            [](websocketpp::connection_hdl hdl, websocket_server::message_ptr msg) {
 *                auto j    = json::parse(msg->get_payload());
 *                auto type = j.value("type", "");
 *
 *                if (handle_param_ws_command(type, j, g_param_manager)) return;
 *
 *                // ... rest of your message routing ...
 *            });
 *
 * ── WebSocket message protocol (frontend → backend) ──────────────────────────
 *
 *   { "type": "param_request_list" }
 *       → Sends MAVLink PARAM_REQUEST_LIST; clears cache; streams all params.
 *
 *   { "type": "param_set", "param_id": "BATT_LOW_VOLT", "value": 10.5 }
 *       → Sends MAVLink PARAM_SET for one parameter.
 *
 *   { "type": "param_request_one", "name": "ARMING_CHECK" }
 *       → Sends MAVLink PARAM_REQUEST_READ (name-based, index=-1).
 *
 *   { "type": "param_get_all" }
 *       → Returns the in-memory cache as a JSON array (no MAVLink round-trip).
 *
 *   { "type": "param_save_file", "path": "optional_name.param" }
 *       → Saves cache to an ArduPilot-format .param file.
 *
 *   { "type": "param_load_file", "path": "my_params.param" }
 *       → Reads .param file and sends PARAM_SET for every entry.
 *
 * ── WebSocket message protocol (backend → frontend) ──────────────────────────
 *
 *   { "type": "param_value",         "param_id":"…", "value": 1.0, "default": 1.0, "index": N, "count": M }
 *   { "type": "param_load_start",    "message": "…" }
 *   { "type": "param_load_progress", "received": N, "total": M, "percent": P }
 *   { "type": "param_load_complete", "count": N, "elapsed_ms": T, "message": "…" }
 *   { "type": "param_set_sent",      "param_id": "…", "value": 1.0 }
 *   { "type": "param_all",           "params": [{param_id, value, default, type, index}, …] }
 *   { "type": "param_file_saved",    "path": "…", "count": N }
 *   { "type": "param_file_loaded",   "path": "…", "count": N }
 *   { "type": "param_error",         "message": "…" }
 */

#include "parameter_manager.h"
#include "parameter_file.h"
#include <nlohmann/json.hpp>
#include <string>
#include <ctime>
#include <iomanip>
#include <sstream>

using json = nlohmann::json;

// Forward declaration — implemented in websocket_server.cpp / main.cpp
void send_ws_safe(const std::string& msg);

// ─────────────────────────────────────────────────────────────────────────────
// handle_param_ws_command
//
// Call this from the WebSocket message dispatcher.
// Returns true  if the message was handled here (caller should not process further).
// Returns false if the message is not a param message (caller continues routing).
// ─────────────────────────────────────────────────────────────────────────────
inline bool handle_param_ws_command(const std::string& type,
                                    const json&         j,
                                    ParameterManager&   pm)
{
    // ── Request all parameters from the FC (PARAM_REQUEST_LIST) ──────────────
    if (type == "param_request_list")
    {
        std::cout << "[ParamWS] Full parameter refresh requested\n";
        pm.requestAllParameters();
        return true;
    }

    // ── Set a single parameter (PARAM_SET) ────────────────────────────────────
    if (type == "param_set")
    {
        // Frontend uses "param_id" to match the MAVLink field name
        const std::string name  = j.value("param_id", "");
        const float       value = j.value("value",    0.f);

        if (name.empty())
        {
            json err;
            err["type"]    = "param_error";
            err["message"] = "param_set: 'param_id' field is required";
            send_ws_safe(err.dump());
            return true;
        }

        std::cout << "[ParamWS] Set " << name << " = " << value << "\n";
        pm.setParameter(name, value);
        return true;
    }

    // ── Request a single parameter by name (PARAM_REQUEST_READ) ──────────────
    if (type == "param_request_one")
    {
        const std::string name = j.value("name", "");
        if (name.empty())
        {
            json err;
            err["type"]    = "param_error";
            err["message"] = "param_request_one: 'name' field is required";
            send_ws_safe(err.dump());
            return true;
        }

        std::cout << "[ParamWS] Requesting single param: " << name << "\n";
        pm.requestParameter(name);
        return true;
    }

    // ── Return in-memory cache to the frontend (no MAVLink round-trip) ────────
    if (type == "param_get_all")
    {
        std::cout << "[ParamWS] Returning cached parameter snapshot\n";
        json resp;
        resp["type"]   = "param_all";
        resp["params"] = pm.getAllParametersJson();
        send_ws_safe(resp.dump());
        return true;
    }

    // ── Save parameter cache to an ArduPilot .param file ─────────────────────
    if (type == "param_save_file")
    {
        std::string path = j.value("path", "");
        if (path.empty())
        {
            // Auto-generate timestamped filename
            const auto t  = std::time(nullptr);
            const auto tm = *std::localtime(&t);
            std::ostringstream oss;
            oss << "params_" << std::put_time(&tm, "%Y-%m-%d_%H-%M-%S") << ".param";
            path = oss.str();
        }

        try
        {
            json all_params = pm.getAllParametersJson();
            save_param_file(path, all_params);

            json resp;
            resp["type"]    = "param_file_saved";
            resp["path"]    = path;
            resp["count"]   = static_cast<int>(all_params.size());
            resp["message"] = std::to_string(all_params.size())
                              + " parameters saved to " + path;
            send_ws_safe(resp.dump());
        }
        catch (const std::exception& ex)
        {
            json err;
            err["type"]    = "param_error";
            err["message"] = std::string("Save failed: ") + ex.what();
            send_ws_safe(err.dump());
        }
        return true;
    }

    // ── Load .param file and write each entry to the FC (PARAM_SET × N) ───────
    if (type == "param_load_file")
    {
        const std::string path = j.value("path", "");
        if (path.empty())
        {
            json err;
            err["type"]    = "param_error";
            err["message"] = "param_load_file: 'path' field is required";
            send_ws_safe(err.dump());
            return true;
        }

        const auto entries = load_param_file(path);
        if (entries.empty())
        {
            json err;
            err["type"]    = "param_error";
            err["message"] = "No parameters loaded from '" + path + "'";
            send_ws_safe(err.dump());
            return true;
        }

        std::cout << "[ParamWS] Writing " << entries.size()
                  << " parameters from file: " << path << "\n";

        for (const auto& e : entries)
            pm.setParameter(e.name, e.value);

        json resp;
        resp["type"]    = "param_file_loaded";
        resp["path"]    = path;
        resp["count"]   = static_cast<int>(entries.size());
        resp["message"] = std::to_string(entries.size())
                          + " parameters written from " + path;
        send_ws_safe(resp.dump());
        return true;
    }

    return false;  // not a param message — let the caller continue its chain
}