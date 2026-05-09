/**
 * Plan Flight Mode - Center Actions Module
 * Handles: Center Mission, Center Vehicle, Center Home
 */

PlanFlightMode.prototype.handleCenterActions = function(action) {
    console.log(`🎯 Center action: ${action}`);
    
    switch(action) {
        case 'center-mission':
            this.centerMission();
            break;
            
        case 'center-vehicle':
            this.centerVehicle();
            break;
            
        case 'center-home':
            this.centerHome();
            break;
            
        default:
            console.warn(`Unknown center action: ${action}`);
    }
};

// ========================================================================
// CENTER MISSION
// ========================================================================

PlanFlightMode.prototype.centerMission = function() {
    console.log('🎯 Centering mission...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        return;
    }
    
    const waypoints = window.WaypointManager.getWaypoints();
    
    if (!waypoints || waypoints.length === 0) {
        if (window.MsgConsole) {
            window.MsgConsole.warning('No waypoints to center on');
        }
        alert('No waypoints to center on.\nPlease add waypoints first.');
        return;
    }
    
    window.WaypointManager.centerMission();
    
    if (window.MsgConsole) {
        window.MsgConsole.success('✅ Mission centered');
    }
};

// ========================================================================
// CENTER VEHICLE
// ========================================================================

PlanFlightMode.prototype.centerVehicle = function() {
    console.log('🚁 Centering vehicle...');
    
    if (!window.tmap || !window.tmap.droneMarker) {
        if (window.MsgConsole) {
            window.MsgConsole.warning('Vehicle position not available');
        }
        alert('Vehicle position not available.\nConnect to vehicle to use this feature.');
        return;
    }
    
    const gps = window.tmap.droneMarker.getLatLng();
    
    if (!gps || !gps.lat || !gps.lng) {
        if (window.MsgConsole) {
            window.MsgConsole.warning('Vehicle GPS position not available');
        }
        alert('Vehicle GPS position not available.\nWait for GPS lock.');
        return;
    }
    
    if (window.tmap && window.tmap.map) {
        window.tmap.map.setView([gps.lat, gps.lng], 16);
        
        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Map centered on vehicle');
        }
        
        console.log('✅ Map centered on vehicle:', gps);
    } else {
        console.error('❌ Map not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('Map not initialized');
        }
    }
};

// ========================================================================
// CENTER HOME
// ========================================================================

PlanFlightMode.prototype.centerHome = function() {
    console.log('🏠 Centering home...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        return;
    }
    
    const home = window.WaypointManager.getHomePosition();
    
    if (!home) {
        if (window.MsgConsole) {
            window.MsgConsole.warning('Home position not set');
        }
        alert('Home position not set.\nSet home position first.');
        return;
    }
    
    window.WaypointManager.centerHome();
    
    if (window.MsgConsole) {
        window.MsgConsole.success('✅ Map centered on home');
    }
    
    console.log('✅ Map centered on home:', home);
};

console.log('✅ Plan Flight Center Actions Module Loaded');