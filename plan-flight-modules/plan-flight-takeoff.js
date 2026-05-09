/**
 * Plan Flight Mode - Takeoff Actions Module
 * Handles: Takeoff Here, Set Home Position, Clear Home
 */

PlanFlightMode.prototype.handleTakeoffActions = function(action) {
    console.log(`🛫 Takeoff action: ${action}`);
    
    switch(action) {
        case 'takeoff-here':
            this.takeoffHere();
            break;
            
        case 'set-home-position':
            this.setHomePosition();
            break;
            
        case 'clear-home':
            this.clearHome();
            break;
            
        default:
            console.warn(`Unknown takeoff action: ${action}`);
    }
};

// ========================================================================
// TAKEOFF HERE - User clicks map to set takeoff position
// ========================================================================

PlanFlightMode.prototype.takeoffHere = function() {
    console.log('🛫 Starting takeoff position mode...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        return;
    }
    
    window.WaypointManager.startTakeoffHere();
    
    if (window.MsgConsole) {
        window.MsgConsole.info('🛫 Click on map to set takeoff position');
    }
};

// ========================================================================
// SET HOME POSITION - User clicks map to set home/RTL position
// ========================================================================

PlanFlightMode.prototype.setHomePosition = function() {
    console.log('🏠 Starting home position mode...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        return;
    }
    
    window.WaypointManager.startTakeoffHere();
    
    if (window.MsgConsole) {
        window.MsgConsole.info('🏠 Click on map to set home position');
    }
};

// ========================================================================
// CLEAR HOME - Remove home position
// ========================================================================

PlanFlightMode.prototype.clearHome = function() {
    console.log('🗑️ Clearing home position...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        return;
    }
    
    const currentHome = window.WaypointManager.getHomePosition();
    
    if (!currentHome) {
        if (window.MsgConsole) {
            window.MsgConsole.warning('No home position to clear');
        }
        return;
    }
    
    const confirm = window.confirm('Clear home position?');
    if (!confirm) {
        console.log('❌ Clear home cancelled');
        return;
    }
    
    window.WaypointManager.clearHomePosition();
    
    if (window.MsgConsole) {
        window.MsgConsole.success('✅ Home position cleared');
    }
    
    console.log('✅ Home position cleared');
};

console.log('✅ Plan Flight Takeoff Actions Module Loaded');