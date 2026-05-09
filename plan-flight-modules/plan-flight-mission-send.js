/**
 * Plan Flight Mode - Mission Send Module
 *
 * TWO send paths:
 *
 *   1. sendMissionToDrone()  — MAVLink mission upload (existing behaviour)
 *      Sends: { type:"mission", id, waypoints:[{latitude,longitude,altitude,command,frame,...}] }
 *      Backend calls upload_mission() → MAVLink MISSION_COUNT / MISSION_ITEM handshake
 *
 *   2. sendMarkersToDrone()  — Rich JSON flight-plan format (NEW "Send Markers" button)
 *      Sends: { type:"flight_plan", id, data:{ drone_id, flight_plan:{...}, status } }
 *      Backend forwards the JSON to the drone as-is.
 *      Backend replies: { type:"flight_plan_ack", status:"success"|"error" }
 *
 * To trigger from HTML:
 *   <button onclick="window.PlanFlight?.handleMenuAction('send-markers')">📍 Send Markers</button>
 *   <button onclick="window.PlanFlight?.handleMenuAction('send-mission')">📡 Send Mission</button>
 *
 * Or from console:
 *   window.sendMarkersToDrone()
 *   window.sendMissionToDrone()
 */

console.log('🚀 Mission Send Module Loading...');

// ============================================================================
// ROUTER
// ============================================================================

PlanFlightMode.prototype.handleMissionSendActions = function(action) {
    console.log(`📡 Mission send action: ${action}`);
    switch (action) {
        case 'send-markers':
            this.sendMarkersToDrone();
            break;
        case 'send-mission':
        case 'write-to-drone':
            this.sendMissionToDrone();
            break;
        default:
            console.warn(`Unknown mission send action: ${action}`);
    }
};

// ============================================================================
// SEND MARKERS — Rich JSON flight-plan format (NEW)
// ============================================================================

PlanFlightMode.prototype.sendMarkersToDrone = function() {
    console.log('📍 Preparing Send Markers (rich JSON) upload...');

    // Guards
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.error('❌ WebSocket not connected');
        if (window.MsgConsole) window.MsgConsole.error('Not connected to backend');
        return;
    }
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) window.MsgConsole.error('WaypointManager not ready');
        return;
    }

    const rawWaypoints = window.WaypointManager.getWaypoints();

    if (!rawWaypoints || rawWaypoints.length === 0) {
        console.warn('⚠️ No waypoints to send');
        if (window.MsgConsole) window.MsgConsole.warning('No waypoints — add some on the map first');
        return;
    }

    // ── Time helpers ──────────────────────────────────────────────────────────
    const now       = new Date();
    const startTime = new Date(now);
    const MS_PER_WP = 5 * 60 * 1000;  // 5 minutes between waypoints

    function actionForWaypoint(wp, index, total) {
        // Use ONLY what the user explicitly set via the right-click context menu.
        // No position-based defaults — every waypoint is NAV_WAYPOINT (move)
        // unless the user changed it.
        if (wp.type === 'rtl'     || wp.command === 20) return 'return';  // MAV_CMD_NAV_RETURN_TO_LAUNCH
        if (wp.type === 'landing' || wp.command === 21) return 'land';    // MAV_CMD_NAV_LAND
        if (wp.type === 'hover'   || wp.command === 17) return 'hover';   // MAV_CMD_NAV_LOITER_UNLIM
        return 'move';  // default → NAV_WAYPOINT (16)
    }

    // ── Build waypoints array ─────────────────────────────────────────────────
    const flightWaypoints = rawWaypoints.map((wp, index) => {
        const estimatedTime = new Date(startTime.getTime() + (index + 1) * MS_PER_WP);
        return {
            waypoint_id:    wp.id,
            latitude:       parseFloat(wp.lat.toFixed(7)),
            longitude:      parseFloat(wp.lng.toFixed(7)),
            altitude:       wp.altitude || 50,
            action:         actionForWaypoint(wp, index, rawWaypoints.length),
            speed:          wp.speed    || 10,
            estimated_time: estimatedTime.toISOString()
        };
    });

    const endTime = new Date(startTime.getTime() + (rawWaypoints.length + 2) * MS_PER_WP);

    // ── Build the full flight-plan payload ────────────────────────────────────
    const flightPlan = {
        drone_id: 'Drone_001',
        flight_plan: {
            start_time: startTime.toISOString(),
            waypoints:  flightWaypoints,
            end_time:   endTime.toISOString()
        },
        status: 'active'
    };

    // WebSocket envelope
    const message = {
        id:   Date.now(),
        type: 'flight_plan',    // backend: else if (type == "flight_plan")
        data: flightPlan
    };

    console.log('📍 Send Markers payload:');
    console.log(JSON.stringify(flightPlan, null, 2));

    if (window.MsgConsole) {
        window.MsgConsole.info(`Sending ${flightWaypoints.length} markers to drone...`);
    }

    try {
        window.ws.send(JSON.stringify(message));
        console.log('✅ Send Markers message sent to backend');
        showSentPayloadOverlay(flightPlan);
    } catch (err) {
        console.error('❌ Failed to send markers:', err);
        if (window.MsgConsole) window.MsgConsole.error('Failed to send markers');
    }
};

// ============================================================================
// SEND MISSION — MAVLink mission-upload format
// Applies the SAME rules as the backend flight_plan path:
//   Rule 1 — seq=0 home/origin item (ArduPilot skips it, starts at seq=1)
//   Rule 2 — RTL: NAV_WAYPOINT (fly-to) + NAV_RETURN_TO_LAUNCH (trigger)
//   Rule 3 — Hover → MAV_CMD_NAV_LOITER_UNLIM (17)
//   Rule 4 — Land  → MAV_CMD_NAV_LAND (21)
//   Rule 5 — Move  → MAV_CMD_NAV_WAYPOINT (16)
// These rules apply to both regular waypoints AND polygon survey grids.
// ============================================================================

PlanFlightMode.prototype.sendMissionToDrone = function() {
    console.log('📡 Preparing mission upload...');

    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.error('❌ WebSocket not connected');
        if (window.MsgConsole) window.MsgConsole.error('Not connected to backend');
        return;
    }
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) window.MsgConsole.error('WaypointManager not ready');
        return;
    }

    let rawWaypoints = window.WaypointManager.getWaypoints();
    const homePosition = window.WaypointManager.getHomePosition();

    // ── Polygon survey fallback ───────────────────────────────────────────────
    // If WaypointManager is empty but PolygonManager has a generated survey
    // grid, use the grid directly so "Send to Drone" always works after
    // a polygon survey is created.
    if ((!rawWaypoints || rawWaypoints.length === 0) &&
        window.PolygonManager &&
        window.PolygonManager.surveyGrid &&
        window.PolygonManager.surveyGrid.length > 0) {

        const altitude = window.PolygonManager.surveySettings?.altitude || 50;
        rawWaypoints = window.PolygonManager.surveyGrid.map((pt, i) => ({
            id:       i + 1,
            lat:      pt.lat,
            lng:      pt.lng,
            altitude: altitude,
            speed:    window.PolygonManager.surveySettings?.speed || 10,
            type:     'waypoint'   // all survey grid points are plain NAV_WAYPOINT
        }));
        console.log(`📐 Polygon survey fallback: ${rawWaypoints.length} grid waypoints`);
        if (window.MsgConsole) {
            window.MsgConsole.info(`Using polygon survey grid (${rawWaypoints.length} waypoints)`);
        }
    }

    if (!rawWaypoints || rawWaypoints.length === 0) {
        console.warn('⚠️ No waypoints to send');
        if (window.MsgConsole) window.MsgConsole.warning('No waypoints — draw a polygon survey or add waypoints first');
        return;
    }

    // ── MAVLink command / frame constants ─────────────────────────────────────
    const FRAME   = 6;   // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
    const WP      = 16;  // MAV_CMD_NAV_WAYPOINT
    const LOITER  = 17;  // MAV_CMD_NAV_LOITER_UNLIM  (hover)
    const RTL_CMD = 20;  // MAV_CMD_NAV_RETURN_TO_LAUNCH
    const LAND    = 21;  // MAV_CMD_NAV_LAND

    const missionItems = [];
    let seq = 0;

    // ── Rule 1: Home item at seq=0 ────────────────────────────────────────────
    // ArduPilot skips seq=0 at runtime (home/origin placeholder) and begins
    // execution from seq=1. Without this, the first real waypoint sits at
    // seq=0 and is NEVER visited.
    // Use the explicit home position if set; otherwise clone the first WP coords.
    const homeCoords = homePosition || rawWaypoints[0];
    missionItems.push({
        seq:          seq++,
        latitude:     homeCoords.lat,
        longitude:    homeCoords.lng,
        altitude:     homeCoords.altitude || rawWaypoints[0].altitude || 20,
        command:      WP,      // home item uses NAV_WAYPOINT (not TAKEOFF)
        frame:        FRAME,
        param1:       0,       // hold_time
        autocontinue: true
    });

    // ── Rules 2-5: Real mission items starting at seq=1 ───────────────────────
    for (const wp of rawWaypoints) {
        const lat = wp.lat;
        const lng = wp.lng;
        const alt = wp.altitude || 50;

        // Resolve action — same logic as backend flight_plan path
        const action = (() => {
            if (wp.type === 'rtl'     || wp.command === RTL_CMD) return 'return';
            if (wp.type === 'landing' || wp.command === LAND)    return 'land';
            if (wp.type === 'hover'   || wp.command === LOITER)  return 'hover';
            return 'move';  // default: NAV_WAYPOINT
        })();

        if (action === 'return') {
            // ── Rule 2: RTL → fly-to NAV_WAYPOINT + RTL trigger ──────────────
            // NAV_RETURN_TO_LAUNCH ignores its own lat/lon — it fires RTL from
            // wherever the drone currently is. Without a preceding NAV_WAYPOINT
            // the drone RTLs from the previous waypoint, not the intended spot.
            missionItems.push({
                seq: seq++, latitude: lat, longitude: lng, altitude: alt,
                command: WP, frame: FRAME, param1: 0, autocontinue: true
            });
            missionItems.push({
                seq: seq++, latitude: lat, longitude: lng, altitude: alt,
                command: RTL_CMD, frame: FRAME, param1: 0, autocontinue: true
            });

        } else if (action === 'land') {
            // ── Rule 4: Land ──────────────────────────────────────────────────
            missionItems.push({
                seq: seq++, latitude: lat, longitude: lng, altitude: alt,
                command: LAND, frame: FRAME, param1: 0, autocontinue: true
            });

        } else if (action === 'hover') {
            // ── Rule 3: Hover → Loiter unlimited ─────────────────────────────
            missionItems.push({
                seq: seq++, latitude: lat, longitude: lng, altitude: alt,
                command: LOITER, frame: FRAME, param1: 0, autocontinue: true
            });

        } else {
            // ── Rule 5: Move → NAV_WAYPOINT (default for survey grid points) ─
            missionItems.push({
                seq: seq++, latitude: lat, longitude: lng, altitude: alt,
                command: WP, frame: FRAME,
                param1: wp.hold_time || 0,
                autocontinue: true
            });
        }
    }

    const realCount = missionItems.length - 1;  // exclude home
    const message = {
        id:        Date.now(),
        type:      'mission',
        waypoints: missionItems
    };

    console.log(`📡 Mission: ${missionItems.length} items (1 home + ${realCount} waypoints)`);
    console.log('📋 Payload:', JSON.stringify(missionItems, null, 2));
    if (window.MsgConsole) {
        window.MsgConsole.info(`Uploading mission: home + ${realCount} waypoints...`);
    }

    try {
        window.ws.send(JSON.stringify(message));
        console.log('✅ Mission sent to backend');

        // Show the same "Mission Uploaded" popup as the Send Markers button
        const summaryPayload = {
            total_items:   missionItems.length,
            home_item:     { lat: missionItems[0].latitude, lng: missionItems[0].longitude, altitude: missionItems[0].altitude },
            mission_items: missionItems.slice(1).map(item => ({
                seq:      item.seq,
                lat:      item.latitude,
                lng:      item.longitude,
                altitude: item.altitude,
                command:  item.command
            }))
        };
        showSentPayloadOverlay(summaryPayload, 'mission');
    } catch (err) {
        console.error('❌ Failed to send mission:', err);
        if (window.MsgConsole) window.MsgConsole.error('Failed to send mission');
    }
};


// ============================================================================
// ACK HANDLERS (called by websocket.js)
// ============================================================================

function handleMissionAck(message) {
    console.log('📋 Mission ACK received:', message);
    if (message.status === 'success') {
        if (window.MsgConsole) window.MsgConsole.success('Mission uploaded ✅');
    } else {
        if (window.MsgConsole) window.MsgConsole.error('Mission upload failed: ' + (message.message || 'unknown error'));
    }
}
window.handleMissionAck = handleMissionAck;

function handleFlightPlanAck(message) {
    console.log('📋 Flight Plan ACK received:', message);
    if (message.status === 'success') {
        console.log('✅ Markers received by drone');
        if (window.MsgConsole) window.MsgConsole.success('Markers delivered to drone ✅');
    } else {
        console.error('❌ Flight plan send failed:', message.message);
        if (window.MsgConsole) window.MsgConsole.error('Send markers failed: ' + (message.message || 'unknown error'));
    }
}
window.handleFlightPlanAck = handleFlightPlanAck;

// ============================================================================
// SENT PAYLOAD OVERLAY — shows the JSON that was sent
// ============================================================================

function showSentPayloadOverlay(payload, mode) {
    const old = document.getElementById('sentPayloadOverlay');
    if (old) old.remove();

    const isMission = (mode === 'mission');
    const title     = isMission ? '✅ Mission Uploaded to Drone' : '✅ Markers Sent to Drone';
    const copyLabel = isMission ? '📋 Copy Mission JSON'        : '📋 Copy JSON';

    const overlay = document.createElement('div');
    overlay.id = 'sentPayloadOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 20px 24px;
        max-width: 520px;
        width: 90vw;
        max-height: 70vh;
        overflow-y: auto;
        z-index: 10000;
        box-shadow: 0 8px 40px rgba(0,0,0,0.7);
        font-family: 'Segoe UI', sans-serif;
    `;

    overlay.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <span style="color:#22c55e;font-weight:700;font-size:15px;">
                ${title}
            </span>
            <span id="closePayloadX" style="color:#94a3b8;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;">✕</span>
        </div>
        <pre id="payloadContent" style="
            color:#e2e8f0;
            font-size:12px;
            line-height:1.6;
            background:#1e293b;
            border-radius:8px;
            padding:14px;
            white-space:pre-wrap;
            word-break:break-all;
            font-family: 'Courier New', monospace;
            margin:0;
        ">${JSON.stringify(payload, null, 2)}</pre>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
            <button id="copyPayloadBtn" style="
                background:#1d4ed8;color:#fff;border:none;border-radius:6px;
                padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;
            ">${copyLabel}</button>
            <button id="closePayloadBtn" style="
                background:#374151;color:#e2e8f0;border:none;border-radius:6px;
                padding:7px 16px;font-size:13px;cursor:pointer;
            ">Close</button>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('closePayloadX')?.addEventListener('click', close);
    document.getElementById('closePayloadBtn')?.addEventListener('click', close);

    document.getElementById('copyPayloadBtn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
            .then(() => {
                const btn = document.getElementById('copyPayloadBtn');
                if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { if (btn) btn.textContent = copyLabel; }, 2000); }
            })
            .catch(() => console.warn('Clipboard copy failed'));
    });

    setTimeout(() => overlay?.remove(), 20000);
}


// ============================================================================
// PATCH MENU ROUTER
// ============================================================================

(function patchMenuRouter() {
    const missionSendActions = ['send-mission', 'write-to-drone', 'send-markers'];
    const original = PlanFlightMode.prototype.handleMenuAction;

    PlanFlightMode.prototype.handleMenuAction = function(action) {
        if (missionSendActions.includes(action)) {
            this.handleMissionSendActions(action);
        } else {
            original.call(this, action);
        }
    };
    console.log('✅ Menu router patched (send-markers added)');
})();

// ============================================================================
// GLOBAL SHORTCUTS
// ============================================================================

window.sendMissionToDrone = () => {
    window.PlanFlight?.sendMissionToDrone() ?? console.error('❌ PlanFlight not initialized');
};

window.sendMarkersToDrone = () => {
    window.PlanFlight?.sendMarkersToDrone() ?? console.error('❌ PlanFlight not initialized');
};

console.log('✅ Mission Send Module Ready');
console.log('💡 window.sendMarkersToDrone()  → Rich JSON flight-plan (Send Markers button)');
console.log('💡 window.sendMissionToDrone()  → MAVLink mission upload');