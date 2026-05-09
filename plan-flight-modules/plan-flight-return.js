/**
 * Plan Flight Mode - Return Actions Module
 * Handles: Return to Launch, Land Here
 */

PlanFlightMode.prototype.handleReturnActions = function(action) {
    console.log(`🔙 Return action: ${action}`);
    
    switch(action) {
        case 'return-to-launch':
            this.returnToLaunch();
            break;
            
        case 'land-here':
            this.landHere();
            break;
            
        default:
            console.warn(`Unknown return action: ${action}`);
    }
};

// ========================================================================
// RETURN TO LAUNCH
// ========================================================================

PlanFlightMode.prototype.returnToLaunch = function() {
    console.log('🔙 Adding return to launch...');
    
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
            window.MsgConsole.warning('Set home position first');
        }
        alert('Please set a home position first before adding return to launch.');
        return;
    }
    
    // Add waypoint at home position
    window.WaypointManager.addWaypoint(home.lat, home.lng);
    
    if (window.MsgConsole) {
        window.MsgConsole.success('✅ Return to launch waypoint added');
    }
    
    console.log('✅ Return to launch added at:', home);
};

// ========================================================================
// LAND HERE
// ========================================================================

PlanFlightMode.prototype.landHere = function() {
    console.log('🛬 Setting landing position...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        return;
    }
    
    // Start land here mode - user clicks on map
    window.WaypointManager.startLandHere();
    
    if (window.MsgConsole) {
        window.MsgConsole.info('🛬 Click on map to set landing position');
    }
};

console.log('✅ Plan Flight Return Actions Module Loaded');