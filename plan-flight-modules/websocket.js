/**
 * WebSocket Connection Manager
 *
 * Fixes applied:
 *  1. Duplicate GPS handling removed — GPS only routed via handleBackendMessage
 *  2. reconnectAttempts resets after MAX_RECONNECT_ATTEMPTS (recovery after server restart)
 *  3. Exponential backoff with jitter on reconnects (3s → 6s → 12s … cap 30s)
 *  4. requestTelemetry fires only after drone status confirms connected
 *  5. onopen correctly sets status to 'waiting' (not 'connecting')
 *  6. Heartbeat ping every 15s to detect silent drops
 *  7. safeSend() helper — all sends go through readyState check
 *  8. Map snap-back extracted to snapMapToHome() — no duplication
 *  9. Old socket handlers nulled before creating new socket on reconnect
 * 10. After MAX_RECONNECT_ATTEMPTS, waits 30s then resets counter and retries
 * 11. [NEW] telemetryRequested guard — requestTelemetry() fires only ONCE per
 *     connection; reset on disconnect so the next connect can request again.
 *     Eliminates the flood of repeated telemetry request messages visible in logs.
 * 12. [NEW] Firmware message queue — firmware_status/log/progress/result messages
 *     that arrive before vcHandleFirmwareMessage is registered are queued and
 *     replayed once the handler becomes available (fixes blank log + stuck bars).
 * 13. [NEW] Multi-vehicle support — status messages now carry a `vehicles` array
 *     ([ { sysid: 1 }, { sysid: 2 }, … ]) from the C++ backend.
 *     updateVehicleSelector() rebuilds the header dropdown on every tick.
 *     sendCommand() now injects `sysid: window.selectedSysId` into every
 *     outbound command payload so the backend can route to the correct drone.
 */

console.log('[WS] Initializing WebSocket connection manager...');

const WS_URL = 'ws://127.0.0.1:9002';

window.ws = null;

let reconnectAttempts     = 0;
let reconnectTimer        = null;
let heartbeatTimer        = null;
let isIntentionallyClosed = false;
let telemetryRequested    = false; // [FIX #11] guard against repeated requests
let _lastStatusKey        = null;  // dedup guard: only log on real state changes

// ── [FIX #13] Multi-vehicle selected sysid ───────────────────────────────────
// Default 1 (first/only drone in a single-vehicle setup).
// Updated by the header dropdown and by updateVehicleSelector() when the
// backend reports exactly one live vehicle.
window.selectedSysId = 1;

/**
 * Rebuild the vehicle dropdown from the `vehicles` array in every status
 * message: [ { sysid: 1 }, { sysid: 2 }, … ]
 *
 * - Preserves current selection if that sysid is still alive.
 * - Auto-selects first vehicle when the previous selection disappears.
 * - Hides the wrapper for single-drone setups; shows it when 2+ are live.
 */
function updateVehicleSelector(vehicles) {
    const wrap = document.getElementById('vehicleSelectorWrap');
    const sel  = document.getElementById('vehicleSelector');
    if (!sel || !wrap) return;

    const prevValue = sel.value;

    sel.innerHTML = '';
    vehicles.forEach(function (v) {
        const opt         = document.createElement('option');
        opt.value         = v.sysid;
        opt.textContent   = 'Drone ' + v.sysid;
        sel.appendChild(opt);
    });

    // Restore previous selection if still alive
    const stillAlive = Array.prototype.some.call(sel.options, o => o.value === prevValue);
    if (stillAlive && prevValue) {
        sel.value            = prevValue;
        window.selectedSysId = parseInt(prevValue, 10);
    } else if (sel.options.length > 0) {
        sel.value            = sel.options[0].value;
        window.selectedSysId = parseInt(sel.value, 10);
    }

    // Show wrapper only when 2+ drones — keeps single-drone UI clean
    wrap.style.display = (vehicles.length > 1) ? 'flex' : 'none';
}

// Wire up dropdown change handler once the DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    const sel = document.getElementById('vehicleSelector');
    if (!sel) return;
    sel.addEventListener('change', function () {
        window.selectedSysId = parseInt(this.value, 10);
        console.log('[WS] Active drone → sysid=' + window.selectedSysId);
        // Brief visual flash to confirm selection
        this.style.borderColor = '#4fc3f7';
        setTimeout(() => { this.style.borderColor = '#2e4a7a'; }, 600);
    });
});

// [FIX #12] Queue for firmware messages that arrive before the handler is ready
const _firmwareMsgQueue   = [];
let   _firmwareQueueTimer = null;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_MS      = 3000;
const MAX_RECONNECT_MS       = 30000;
const HEARTBEAT_INTERVAL_MS  = 15000;

// ─────────────────────────────────────────────────────────────────────────────
// [FIX #12] Firmware message delivery — queue + flush
// Messages sent by firmware_manager.cpp during a flash arrive in real-time.
// If vehicle-config.js hasn't finished its DOMContentLoaded registration yet,
// or if the VehicleConfig panel hasn't been opened yet, window.vcHandleFirmware
// Message will be undefined and those messages are silently dropped — leaving
// the flash log empty and the progress bars at 0%.
//
// Solution: buffer every firmware message.  On each delivery attempt, if the
// handler is present flush the entire queue immediately.  If not, poll every
// 50ms for up to 5s so messages are never lost.
// ─────────────────────────────────────────────────────────────────────────────

const FIRMWARE_MSG_TYPES = new Set([
    'firmware_status',
    'firmware_log',
    'firmware_progress',
    'firmware_result',
    'port_appeared',
    'port_disappeared'
]);

function deliverFirmwareMessage(msg) {
    _firmwareMsgQueue.push(msg);
    flushFirmwareQueue();
}

function flushFirmwareQueue() {
    if (_firmwareMsgQueue.length === 0) return;

    if (typeof window.vcHandleFirmwareMessage === 'function') {
        // Handler is ready — drain the queue
        if (_firmwareQueueTimer !== null) {
            clearInterval(_firmwareQueueTimer);
            _firmwareQueueTimer = null;
        }
        while (_firmwareMsgQueue.length > 0) {
            const queued = _firmwareMsgQueue.shift();
            try {
                window.vcHandleFirmwareMessage(queued);
            } catch (e) {
                console.error('[WS] vcHandleFirmwareMessage threw:', e);
            }
        }
        return;
    }

    // Handler not ready yet — start polling if not already doing so
    if (_firmwareQueueTimer !== null) return; // already polling

    let retries = 0;
    _firmwareQueueTimer = setInterval(() => {
        retries++;
        if (typeof window.vcHandleFirmwareMessage === 'function') {
            flushFirmwareQueue(); // will clear the interval inside
        } else if (retries >= 100) {
            // Give up after 5s — clear queue so stale messages don't replay
            // on a future flash session
            clearInterval(_firmwareQueueTimer);
            _firmwareQueueTimer = null;
            _firmwareMsgQueue.length = 0;
            console.warn('[WS] vcHandleFirmwareMessage never became available — firmware messages dropped.');
        }
    }, 50);
}

// Expose flush globally so vehicle-config.js can call it right after it
// registers window.vcHandleFirmwareMessage (optional, belt-and-suspenders)
window.flushFirmwareQueue = flushFirmwareQueue;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Snap the map view back to the home marker.
 * Extracted here to avoid copy-pasting in onclose and status handler.
 */
function snapMapToHome() {
    if (window.tmap && window.homeMarker) {
        window.tmap._droneSetViewInProgress = true;
        window.tmap.map.setView(
            [window.homeMarker.lat, window.homeMarker.lng],
            18,
            { animate: true }
        );
        window.tmap._droneSetViewInProgress = false;
        console.log('[WS] Map snapped back to home location');
        window.MsgConsole?.info('Map returned to home location');
    }
}

/**
 * Send a message only if the socket is open.
 * All internal and external sends must go through this.
 *
 * @param {object} payload  - Object to JSON-serialize and send
 * @returns {boolean}       - true if sent, false otherwise
 */
function safeSend(payload) {
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.warn('[WS] safeSend: socket not open, message dropped:', payload);
        return false;
    }
    window.ws.send(JSON.stringify(payload));
    return true;
}

window.safeSend = safeSend;

/**
 * Start the heartbeat ping loop.
 * Sends a lightweight ping every HEARTBEAT_INTERVAL_MS.
 * If the socket has silently died the send will throw/fail,
 * triggering the onerror → onclose → reconnect path.
 */
function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (window.ws?.readyState === WebSocket.OPEN) {
            safeSend({ type: 'ping', ts: Date.now() });
        }
    }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

/**
 * Null out all handlers on a socket instance so that a stale reference
 * held elsewhere (e.g. a module that captured window.ws before reconnect)
 * cannot fire callbacks after the socket has been replaced.
 */
function detachHandlers(sock) {
    if (!sock) return;
    sock.onopen    = null;
    sock.onmessage = null;
    sock.onerror   = null;
    sock.onclose   = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────────

function initWebSocket() {
    if (isIntentionallyClosed) return;

    // Detach and discard the old socket before creating a new one
    detachHandlers(window.ws);
    window.ws = null;

    console.log(`[WS] Connecting to: ${WS_URL} (attempt ${reconnectAttempts + 1})`);

    try {
        const sock = new WebSocket(WS_URL);

        // ── Connected ────────────────────────────────────────────────────────
        sock.onopen = function () {
            console.log('[WS] Connected');
            reconnectAttempts = 0;

            // Backend connected — but drone may not be online yet
            updateConnectionStatus('waiting');

            window.MsgConsole?.success('Backend connected');

            // Notify modules that need to re-subscribe after a reconnect.
            window.dispatchEvent(
                new CustomEvent('ws_connected', { detail: { ws: window.ws } })
            );

            startHeartbeat();

            // Re-request serial ports on every (re)connect so the list is
            // always fresh even if the panel was already open.
            safeSend({ type: 'list_serial_ports' });

            // Telemetry request is sent only once drone status confirms
            // connected (see 'status' handler below).
        };

        // ── Message received ─────────────────────────────────────────────────
        sock.onmessage = function (event) {
            if (typeof event.data !== 'string') {
                console.warn('[WS] Non-string frame ignored');
                return;
            }

            const trimmed = event.data.trim();
            if (!trimmed.startsWith('{')) {
                console.warn('[WS] Non-JSON frame ignored:', trimmed.slice(0, 80));
                return;
            }

            let message;
            try {
                message = JSON.parse(trimmed);
            } catch (err) {
                console.error('[WS] JSON parse error:', err, trimmed.slice(0, 80));
                return;
            }

            // Skip verbose log for high-frequency inspector broadcasts
            if (message.type !== 'mavlink_inspector') {
                console.log('[WS] Received:', message);
            }

            // Broadcast to modules that listen via CustomEvent
            window.dispatchEvent(
                new CustomEvent('calibration_ws_message', { detail: message })
            );

            handleBackendMessage(message);
        };

        // ── Error ────────────────────────────────────────────────────────────
        sock.onerror = function (err) {
            console.error('[WS] Socket error:', err);
            // onclose fires immediately after onerror; reconnect is handled there.
        };

        // ── Disconnected ─────────────────────────────────────────────────────
        sock.onclose = function () {
            console.log('[WS] Disconnected');
            stopHeartbeat();

            // [FIX #11] Reset so the next successful connection can request telemetry
            telemetryRequested = false;
            _lastStatusKey     = null; // reset so reconnect logs a fresh 'connected' message

            updateConnectionStatus('disconnected');
            window.MsgConsole?.warning('Connection lost');

            snapMapToHome();

            if (!isIntentionallyClosed) {
                scheduleReconnect();
            }
        };

        window.ws = sock;

    } catch (err) {
        console.error('[WS] Failed to construct WebSocket:', err);
        scheduleReconnect();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnection with exponential backoff + jitter
// ─────────────────────────────────────────────────────────────────────────────

function scheduleReconnect() {
    if (reconnectTimer !== null) return; // already scheduled

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('[WS] Max reconnect attempts reached. Pausing 30s then retrying.');
        window.MsgConsole?.warning('Connection lost — retrying in 30s…');
        reconnectAttempts = 0; // reset so the next batch of attempts works
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            initWebSocket();
        }, MAX_RECONNECT_MS);
        return;
    }

    // Exponential backoff: 3s, 6s, 12s … capped at MAX_RECONNECT_MS
    const base  = Math.min(BASE_RECONNECT_MS * Math.pow(2, reconnectAttempts), MAX_RECONNECT_MS);
    const delay = base + Math.random() * 1000; // add up to 1s jitter

    reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${(delay / 1000).toFixed(1)}s… (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initWebSocket();
    }, delay);
}

// ─────────────────────────────────────────────────────────────────────────────
// Message dispatch
// ─────────────────────────────────────────────────────────────────────────────

function handleBackendMessage(message) {
    switch (message.type) {

        // ── GPS position (direct MAVLink → backend → WS) ─────────────────────
        case 'gps': {
            const lat = message.latitude;
            const lng = message.longitude;
            const hdg = message.heading ?? 0;
            if (window.tmap?.updateDronePosition && lat !== undefined && lng !== undefined) {
                window.tmap.updateDronePosition(lat, lng, hdg);
                console.log(`[WS] GPS → ${lat.toFixed(6)}, ${lng.toFixed(6)}, hdg=${hdg.toFixed(1)}°`);
            }
            break;
        }

        // ── Telemetry bundle ─────────────────────────────────────────────────
        case 'telemetry':
            handleTelemetryUpdate(message.data);
            break;

        // ── Attitude (roll/pitch/yaw) ─────────────────────────────────────────
        case 'attitude': {
            const toDeg = (180 / Math.PI);
            if (window.TelemetryDisplay?.update) {
                window.TelemetryDisplay.update({
                    roll:  (message.roll  ?? 0) * toDeg,
                    pitch: (message.pitch ?? 0) * toDeg,
                    yaw:   (message.yaw   ?? 0) * toDeg
                });
            }
            if (window.compass?.updateTelemetry) {
                window.compass.updateTelemetry({ heading: (message.yaw ?? 0) * toDeg });
            }
            break;
        }

        // ── Drone / connection status ─────────────────────────────────────────
        case 'status': {
            if (message.ports) {
                updatePortStatus(message.ports);
            }

            // [FIX #13] Rebuild vehicle selector dropdown on every status tick.
            // The backend populates message.vehicles = [{ sysid:1 }, { sysid:2 }, …]
            // so the dropdown always reflects exactly which drones are alive.
            if (Array.isArray(message.vehicles)) {
                updateVehicleSelector(message.vehicles);
            }

            if (message.connected) {
                const link     = message.connection || 'Unknown';
                const stateKey = 'connected:' + link;

                updateConnectionStatus('connected', link);

                // Only log to console once per connection-type change,
                // not on every 1-second status heartbeat.
                if (stateKey !== _lastStatusKey) {
                    _lastStatusKey = stateKey;
                    window.MsgConsole?.success('🚁 Drone connected via ' + link);
                }

                // [FIX #11] Safe to request telemetry now — and only once per connection.
                requestTelemetry();
            } else {
                if (_lastStatusKey !== 'disconnected') {
                    _lastStatusKey = 'disconnected';
                }
                updateConnectionStatus('waiting');
                snapMapToHome();
            }
            break;
        }

        // ── Command ACK ───────────────────────────────────────────────────────
        case 'response':
            console.log('[WS] Command response:', message);
            if (message.status === 'success') {
                window.MsgConsole?.success(message.message);
            } else {
                window.MsgConsole?.error(message.message);
            }
            break;

        // ── Mission ACKs ──────────────────────────────────────────────────────
        case 'mission_ack':
            window.handleMissionAck?.(message);
            break;

        case 'mission_download_ack':
            window.handleMissionDownloadAck?.(message);
            break;

        case 'mission_clear_ack':
            window.handleMissionClearAck?.(message);
            break;

        // ── Arm/disarm/mode events ────────────────────────────────────────────
        case 'event': {
            const evt = message.event;
            if (evt === 'armed') {
                window.MsgConsole?.arm?.(message.message);
                window.ArmControl?.setArmedState?.(true);
            }
            else if (evt === 'disarmed') {
                window.MsgConsole?.disarm?.(message.message);
                window.ArmControl?.setArmedState?.(false);
            }
            else if (evt === 'mode_change') {
                window.MsgConsole?.info('\ud83d\udeeb\ufe0f ' + message.message);
                const modeText = document.getElementById('modeIndicatorText');
                if (modeText && message.mode) modeText.textContent = message.mode;
                const activeModeDisplay = document.getElementById('activeModeDisplay');
                if (activeModeDisplay && message.mode) activeModeDisplay.textContent = message.mode;
            }
            break;
        }

        // ── STATUSTEXT ────────────────────────────────────────────────────────
        case 'statustext': {
            if (message.level === 'error')        window.MsgConsole?.error(message.message);
            else if (message.level === 'warning') window.MsgConsole?.warning(message.message);
            else                                  window.MsgConsole?.info(message.message);
            break;
        }

        // ── Auto takeoff progress ─────────────────────────────────────────────
        case 'takeoff_progress': {
            if (message.step === 'complete') window.MsgConsole?.success('\ud83d\ude80 ' + message.message);
            else                             window.MsgConsole?.info('\ud83d\ude80 ' + message.message);
            break;
        }

        // ── \ud83d\udd0d MAVLink Inspector snapshots (250 ms from MavlinkInspector) ──────────
        case 'mavlink_inspector': {
            if (window.AnalyzeToolsPanel?._onInspectorData) {
                window.AnalyzeToolsPanel._onInspectorData(message.messages || []);
            }
            break;
        }

        // ── RC channel values (10 Hz from autopilot) ─────────────────────────
        case 'rc_channels': {
            // Broadcast to any module that wants raw RC values
            // (e.g. radio calibration widget, RC monitor)
            window.dispatchEvent(
                new CustomEvent('rc_channels_update', { detail: message.channels })
            );
            // Forward to RadioCalibration UI if present
            window.RCMonitor?.update?.(message.channels);
            break;
        }

        // ── Flight mode status (from FlightMode module) ───────────────────────
        // Payload: { type: "flight_mode_status", mode: "STABILIZE", pwm: 0, slot: 0 }
        case 'flight_mode_status': {
            const mode = message.mode;
            console.log('[WS] Flight mode:', mode);

            // Update the flight mode selector badge / highlight
            window.FlightModeSelector?.setMode?.(mode);

            // Update any HUD / telemetry display
            window.TelemetryDisplay?.setFlightMode?.(mode);

            // Broadcast so other modules can react
            window.dispatchEvent(
                new CustomEvent('flight_mode_changed', { detail: { mode, pwm: message.pwm, slot: message.slot } })
            );
            break;
        }

        // ── FlightMode event stream (module internal events) ──────────────────
        // Payload: { type: "flight_mode", event: "flight_mode_change", mode: "...", ... }
        case 'flight_mode': {
            const mode = message.mode;
            if (mode) {
                window.FlightModeSelector?.setMode?.(mode);
                window.TelemetryDisplay?.setFlightMode?.(mode);
                window.dispatchEvent(
                    new CustomEvent('flight_mode_changed', { detail: { mode } })
                );
            }
            break;
        }

        // ── Drone MAVProxy / STATUSTEXT messages ─────────────────────────────
        case 'drone_console': {
            const text     = message.text     || '';
            const severity = message.severity || 'info';
            if (text && window.MsgConsole) {
                window.MsgConsole.log(text, severity);
            }
            break;
        }

        // ── Pong (heartbeat response) — no action needed ──────────────────────
        case 'pong':
            break;

        // ── Backend error ─────────────────────────────────────────────────────
        case 'error':
            console.error('[WS] Backend error:', message.message);
            window.MsgConsole?.error(message.message);
            break;

        // ── Firmware status / log / progress / result ─────────────────────────
        // firmware_status is the current format from firmware_manager.cpp.
        // firmware_log / firmware_progress / firmware_result are legacy aliases
        // kept for backward compatibility.
        //
        // port_appeared / port_disappeared are pushed by start_serial_monitor()
        // in main.cpp whenever a board is plugged in or unplugged — routed here
        // so the VehicleConfig panel auto-updates the port table and log without
        // requiring a manual Refresh click.
        //
        // [FIX #12] Route through deliverFirmwareMessage() instead of calling
        // vcHandleFirmwareMessage directly.  Messages that arrive before the
        // VehicleConfig panel has registered its handler are queued and replayed
        // automatically — this is what caused the blank log and stuck progress
        // bars even though the backend was sending all the right messages.
        case 'firmware_status':
        case 'firmware_log':
        case 'firmware_progress':
        case 'firmware_result':
        case 'port_appeared':
        case 'port_disappeared': {
            deliverFirmwareMessage(message);
            break;
        }

        // ── serial_ports (Vehicle Configuration panel) ────────────────────────
        // Always cache the result. If the panel is open, populate immediately.
        // If vcPopulatePorts isn't ready yet (script still loading), retry every
        // 50 ms for up to 2 s so the rows always appear on first open.
        case 'serial_ports': {
            const ports = message.ports || [];
            // Always update the global cache so open() can render from it
            window._vcLastKnownPorts = ports;
            if (typeof window.vcPopulatePorts === 'function') {
                window.vcPopulatePorts(ports);
            } else {
                // vcPopulatePorts not registered yet — poll until it is
                let retries = 0;
                const poll = setInterval(() => {
                    retries++;
                    if (typeof window.vcPopulatePorts === 'function') {
                        clearInterval(poll);
                        window.vcPopulatePorts(window._vcLastKnownPorts || ports);
                    } else if (retries >= 40) { // give up after 2s
                        clearInterval(poll);
                    }
                }, 50);
            }
            console.log('[WS] serial_ports → VehicleConfig:', ports.length, 'port(s)');
            break;
        }

        // ── Video stream status (from video_server.py via C++ backend) ────────
        // Dispatched as a CustomEvent so video-stream.js can receive it even
        // after window.ws has been replaced by a reconnect.
        case 'video_status':
            window.dispatchEvent(new CustomEvent('video_status', { detail: message }));
            break;

        // ── Parameter value (from param manager) ─────────────────────────────
        case 'parameter':
        case 'param_value':
            window.dispatchEvent(new CustomEvent('param_value', { detail: message }));
            break;

        // ── Flight plan ACK ───────────────────────────────────────────────────
        case 'flight_plan_ack':
            window.handleFlightPlanAck?.(message);
            break;

        default:
            // Suppress noisy unknown-type logs for known-unhandled types
            if (!['ping', 'pong'].includes(message.type)) {
                console.log('[WS] Unhandled message type:', message.type);
            }

    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry helpers
// ─────────────────────────────────────────────────────────────────────────────

function handleTelemetryUpdate(data) {
    if (!data) return;

    if (window.TelemetryDisplay) {
        window.TelemetryDisplay.update(data);
    }

    // GPS inside a telemetry bundle — only update position if present.
    // Direct 'gps' messages (handled above) take the faster path.
    if (data.latitude && data.longitude && window.tmap?.updateDronePosition) {
        window.tmap.updateDronePosition(data.latitude, data.longitude, data.heading);
    }
}

/**
 * Request telemetry from the backend.
 * [FIX #11] Guards against being called more than once per connection.
 * The C++ backend broadcasts send_status() every second which repeatedly
 * triggers the 'status' handler — without this guard each status message
 * would fire another telemetry request, flooding the backend with hundreds
 * of { type: 'request' } frames per session (visible in the WS logs).
 */
function requestTelemetry() {
    if (telemetryRequested) return; // already requested this connection — do nothing
    telemetryRequested = true;
    safeSend({ id: Date.now(), type: 'request', request: 'telemetry' });
    console.log('[WS] Telemetry requested');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — sendCommand / sendMission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a named command with optional parameters.
 *
 * Payload shape expected by C++ main.cpp WebSocket handler:
 *   { type: "command", id: <number>, command: <string>, sysid: <number>, params: { ... } }
 *
 * [FIX #13] sysid is automatically injected from window.selectedSysId so that
 * every command is routed to the drone currently chosen in the header dropdown.
 * In single-drone setups selectedSysId stays at 1 and behaviour is identical
 * to before this change.
 *
 * NOTE: flight-controls.js also calls sendCommand() — it must NOT redefine
 * window.sendCommand because this file is the authoritative implementation.
 * Load websocket.js BEFORE flight-controls.js in your HTML.
 *
 * @param {string} command  — e.g. "ARM", "DISARM", "TAKEOFF", "LAND", "RTL", "SET_MODE"
 * @param {object} params   — e.g. { altitude: 10 } for TAKEOFF, { mode: "LOITER" } for SET_MODE
 * @returns {boolean}
 */
function sendCommand(command, params = {}) {
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.error('[WS] sendCommand: not connected —', command);
        window.MsgConsole?.error('Not connected to backend');
        return false;
    }
    const payload = {
        id:      Date.now(),
        type:    'command',
        command,
        sysid:   window.selectedSysId ?? 1,   // [FIX #13] route to selected drone
        params
    };
    console.log('[WS] sendCommand →', payload);
    return safeSend(payload);
}

window.sendCommand = sendCommand;

/**
 * Upload a mission waypoint list to the backend.
 * @param {Array} waypointItems
 * @returns {boolean}
 */
function sendMission(waypointItems) {
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.error('[WS] sendMission: not connected');
        window.MsgConsole?.error('Not connected to backend');
        return false;
    }

    if (!Array.isArray(waypointItems) || waypointItems.length === 0) {
        console.error('[WS] sendMission: no waypoints provided');
        window.MsgConsole?.error('No waypoints to send');
        return false;
    }

    const sent = safeSend({ id: Date.now(), type: 'mission', waypoints: waypointItems });
    if (sent) {
        console.log(`[WS] Mission upload: ${waypointItems.length} waypoints`);
        window.MsgConsole?.info(`Uploading ${waypointItems.length} waypoints…`);
    }
    return sent;
}

window.sendMission = sendMission;

// ─────────────────────────────────────────────────────────────────────────────
// UI status helpers
// ─────────────────────────────────────────────────────────────────────────────

function updateConnectionStatus(state, link) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;

    const labels = {
        connected:    { text: '🟢 Drone connected (' + (link || 'Unknown') + ')', color: '#22c55e' },
        waiting:      { text: '🟡 Waiting for drone…',                            color: '#facc15' },
        disconnected: { text: '⚫ Backend disconnected',                           color: '#6b7280' },
    };

    const entry = labels[state];
    if (entry) {
        el.textContent = entry.text;
        el.style.color = entry.color;
    }
}

function updatePortStatus(ports) {
    const udpEl = document.getElementById('portStatusUDP');
    if (udpEl) {
        if (ports.udp_available) {
            udpEl.textContent = '🟢 UDP :' + ports.udp_port;
            udpEl.style.color = '#22c55e';
        } else {
            udpEl.textContent = '🔴 UDP :' + ports.udp_port + ' (not bound)';
            udpEl.style.color = '#ef4444';
        }
    }

    const serialEl = document.getElementById('portStatusSerial');
    if (serialEl) {
        if (ports.serial_available) {
            serialEl.textContent = '🟢 Serial: ' + ports.serial_port;
            serialEl.style.color = '#22c55e';
        } else {
            serialEl.textContent = '🔴 Serial: not found';
            serialEl.style.color = '#ef4444';
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap — run once regardless of how many times this file is evaluated
// ─────────────────────────────────────────────────────────────────────────────

if (!window.wsInitialized) {
    window.wsInitialized = true;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWebSocket);
    } else {
        initWebSocket();
    }
}

console.log('[WS] Manager ready');