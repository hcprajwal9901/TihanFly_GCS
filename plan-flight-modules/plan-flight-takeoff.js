/**
 * Plan Flight Mode - Takeoff Actions Module
 * Handles: Takeoff Here, Set Home Position, Clear Home
 *
 * TAKEOFF sequence (per user requirement):
 *   1. Confirm altitude with the user via a modal/prompt
 *   2. SET_MODE → GUIDED
 *   3. Send TAKEOFF command with chosen altitude
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
// TAKEOFF HERE - Switch to GUIDED mode then take off
// ========================================================================

PlanFlightMode.prototype.takeoffHere = function() {
    console.log('🛫 Takeoff requested from Plan menu...');

    // Check connectivity
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        const msg = '❌ Not connected to drone. Cannot take off.';
        if (window.MsgConsole) window.MsgConsole.error(msg);
        alert(msg);
        return;
    }

    // Show a lightweight altitude prompt
    this._showTakeoffDialog(function(altitude) {
        if (altitude === null) {
            console.log('🛫 Takeoff cancelled by user');
            return;
        }

        console.log(`🛫 Takeoff sequence: GUIDED → ARM → TAKEOFF at ${altitude} m`);

        // Step 1 – switch to GUIDED
        if (window.MsgConsole) window.MsgConsole.info('🔄 Step 1/3 — Setting mode → GUIDED…');
        window.sendCommand('SET_MODE', { mode: 'GUIDED' });

        // Step 2 – ARM after mode change settles
        setTimeout(function() {
            if (window.MsgConsole) window.MsgConsole.info('🔒 Step 2/3 — Arming drone…');
            window.sendCommand('ARM');
        }, 1200);

        // Step 3 – TAKEOFF after arming settles
        setTimeout(function() {
            if (window.MsgConsole) window.MsgConsole.info(`🛫 Step 3/3 — Taking off to ${altitude} m…`);
            window.sendCommand('TAKEOFF', { altitude: altitude });
        }, 3500);
    });
};

// ========================================================================
// TAKEOFF ALTITUDE DIALOG
// Reuses existing #takeoffModal if present, otherwise falls back to prompt()
// ========================================================================

PlanFlightMode.prototype._showTakeoffDialog = function(callback) {
    // Prefer the existing flight-controls modal if it's in the DOM
    const modal       = document.getElementById('takeoffModal');
    const altInput    = document.getElementById('altitudeInput');
    const confirmBtn  = document.getElementById('modalConfirmBtn');
    const cancelBtn   = document.getElementById('modalCancelBtn');
    const closeBtn    = document.getElementById('modalCloseBtn');

    if (modal && altInput && confirmBtn) {
        // Reuse the modal already defined for the flight-controls strip
        modal.classList.add('active');

        // Default altitude
        if (!altInput.value) altInput.value = 10;

        // One-shot confirm handler
        function onConfirm() {
            const alt = parseFloat(altInput.value);
            cleanup();
            if (!isNaN(alt) && alt > 0) {
                callback(alt);
            } else {
                if (window.MsgConsole) window.MsgConsole.error('Invalid altitude value');
                callback(null);
            }
        }

        function onCancel() {
            cleanup();
            callback(null);
        }

        function cleanup() {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
            if (closeBtn)  closeBtn.removeEventListener('click', onCancel);
        }

        confirmBtn.addEventListener('click', onConfirm);
        if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
        if (closeBtn)  closeBtn.addEventListener('click', onCancel);

    } else {
        // Fallback: native prompt
        const raw = window.prompt('Enter takeoff altitude (metres):', '10');
        if (raw === null) { callback(null); return; }
        const alt = parseFloat(raw);
        if (isNaN(alt) || alt <= 0) {
            alert('Invalid altitude. Please enter a positive number.');
            callback(null);
            return;
        }
        callback(alt);
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