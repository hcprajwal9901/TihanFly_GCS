/**
 * Waypoint Menu Updates
 * Handles waypoint actions from the Plan Flight menu
 */

// ========================================================================
// MENU ACTION HANDLER
// ========================================================================

PlanFlightMode.prototype.handleWaypointActions = function(action) {
    console.log(`🎯 Waypoint action triggered: ${action}`);
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        return;
    }

    // If polygon is actively being drawn, cancel it before switching to waypoint mode
    if (window.PolygonManager && window.PolygonManager.isDrawing) {
        console.log('🛑 Cancelling active polygon draw — switching to waypoint mode');
        window.PolygonManager.cancelDrawing();
    }
    
    switch(action) {
        case 'add-waypoint':
            window.WaypointManager.startAddingWaypoint();
            break;
            
        case 'delete-waypoint':
            window.WaypointManager.startDeletingWaypoint();
            break;
            
        case 'clear-all':
            window.WaypointManager.clearAllWaypoints();
            break;

        // NOTE: 'send-markers' is intentionally NOT handled here.
        // It is routed via missionActions → handleMissionSendActions()
        // in plan-flight-menu-router.js → sendMarkersToDrone() in
        // plan-flight-mission-send.js which sends the full JSON flight
        // plan over WebSocket to the backend.
            
        default:
            console.warn(`Unknown waypoint action: ${action}`);
    }
};

// ========================================================================
// LOG MARKERS TO CONSOLE  (kept as a debug utility — not called by the
// Send Markers button anymore, but can be invoked manually from console:
//   window.PlanFlight.logMarkersToConsole()
// ========================================================================

PlanFlightMode.prototype.logMarkersToConsole = function() {
    console.log('\n--- 📊 EXTRACTING WAYPOINT DATA ---');
    
    const waypoints = window.WaypointManager.getWaypoints();
    
    if (!waypoints || waypoints.length === 0) {
        console.warn('⚠️ No waypoints found.');
        return;
    }

    const formattedWaypoints = waypoints.map((wp, index) => {
        return {
            id:       String(wp.id || (index + 1)),
            lat:      Number(wp.lat),
            lng:      Number(wp.lng),
            altitude: Number(wp.altitude || 50),
            speed:    Number(wp.speed    || 10)
        };
    });

    console.log('📦 WAYPOINTS DATA (JSON):');
    console.log(JSON.stringify(formattedWaypoints, null, 4));
    console.table(formattedWaypoints);

    if (window.MsgConsole) {
        window.MsgConsole.success(`✅ ${formattedWaypoints.length} waypoints logged to console`);
    }
};