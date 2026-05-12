/**
 * Plan Flight Mode - Return Actions Module
 * Handles: Return to Launch, Land Here
 *
 * Both actions send real MAVLink commands to the drone via sendCommand().
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
// RETURN TO LAUNCH - Send RTL MAVLink command
// ========================================================================

PlanFlightMode.prototype.returnToLaunch = function() {
    console.log('🔙 Return to Launch requested...');

    // Check connectivity
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        const msg = '❌ Not connected to drone. Cannot send RTL.';
        if (window.MsgConsole) window.MsgConsole.error(msg);
        alert(msg);
        return;
    }

    const confirmed = window.confirm(
        'Return to Launch?\n\nThe drone will switch to RTL mode and fly back to the home position.'
    );
    if (!confirmed) {
        console.log('🔙 RTL cancelled by user');
        return;
    }

    if (window.MsgConsole) window.MsgConsole.info('🔙 Sending Return to Launch command…');
    const sent = window.sendCommand('RTL');

    if (sent) {
        if (window.MsgConsole) window.MsgConsole.success('✅ RTL command sent');
        console.log('✅ RTL command sent');
    } else {
        if (window.MsgConsole) window.MsgConsole.error('❌ Failed to send RTL command');
        console.error('❌ RTL command send failed');
    }
};

// ========================================================================
// LAND HERE - Send LAND MAVLink command
// ========================================================================

PlanFlightMode.prototype.landHere = function() {
    console.log('🛬 Land Here requested...');

    // Check connectivity
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        const msg = '❌ Not connected to drone. Cannot send Land command.';
        if (window.MsgConsole) window.MsgConsole.error(msg);
        alert(msg);
        return;
    }

    const confirmed = window.confirm(
        'Land Here?\n\nThe drone will descend and land at its current position.'
    );
    if (!confirmed) {
        console.log('🛬 Land cancelled by user');
        return;
    }

    if (window.MsgConsole) window.MsgConsole.info('🛬 Sending Land command…');
    const sent = window.sendCommand('LAND');

    if (sent) {
        if (window.MsgConsole) window.MsgConsole.success('✅ Land command sent');
        console.log('✅ Land command sent');
    } else {
        if (window.MsgConsole) window.MsgConsole.error('❌ Failed to send Land command');
        console.error('❌ Land command send failed');
    }
};

console.log('✅ Plan Flight Return Actions Module Loaded');