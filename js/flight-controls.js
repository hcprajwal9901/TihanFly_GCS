/**
 * flight-controls.js
 * TiHANFly GCS — Flight control UI buttons (ARM, TAKEOFF, LAND, RTL, MODE)
 *
 * IMPORTANT: This file does NOT manage the WebSocket connection.
 * websocket.js owns the connection and defines window.sendCommand.
 * Load websocket.js BEFORE this file in your HTML.
 *
 * Button click flow:
 *   UI button → window.sendCommand(name, params)   ← defined in websocket.js
 *     → { type:"command", command:<n>, id:<n>, sysid:<selectedSysId>, params:{…} }
 *       → C++ CommandManager → Vehicle(sysid) → LinkManager → Transport → Drone
 *
 * [Multi-vehicle] sysid injection is handled entirely inside websocket.js
 * sendCommand().  This file does NOT need to know about selectedSysId at all —
 * it just calls window.sendCommand() and websocket.js stamps the right sysid.
 */

/* ============================================================================
   FLIGHT CONTROL BUTTONS  (Takeoff · Land · RTL)
   ============================================================================ */

class FlightControlButtons {
    constructor() {
        this.takeoffBtn      = null;
        this.landBtn         = null;
        this.rtlBtn          = null;
        this.modal           = null;

        this.isExecuting    = false;
        this.currentCommand = null;

        this.takeoffSettings = { altitude: 10, speed: 2 };
        this.callbacks = { onTakeoff: null, onLand: null, onRTL: null };

        this.initialize();
    }

    initialize() {
        this.takeoffBtn      = document.getElementById('takeoffBtn');
        this.landBtn         = document.getElementById('landBtn');
        this.rtlBtn          = document.getElementById('rtlBtn');
        this.modal           = document.getElementById('takeoffModal');

        if (!this.takeoffBtn || !this.landBtn || !this.rtlBtn) {
            console.error('❌ Flight control buttons not found in DOM');
            return;
        }
        if (!this.modal) {
            console.error('❌ Takeoff modal not found in DOM');
            return;
        }

        this.attachEventListeners();
        this.attachModalListeners();

        // Clear executing state when backend confirms the command succeeded
        window.addEventListener('calibration_ws_message', (e) => {
            const msg = e.detail;
            if (msg.type === 'response' && msg.command === this.currentCommand) {
                this.clearExecutingState();
            }
        });

        console.log('✅ Flight Control Buttons initialized');
    }

    attachEventListeners() {
        this.takeoffBtn.addEventListener('click', () => {
            if (!this.isExecuting) this.showTakeoffModal();
        });
        this.landBtn.addEventListener('click', () => {
            if (!this.isExecuting) this.executeLand();
        });
        this.rtlBtn.addEventListener('click', () => {
            if (!this.isExecuting) this.executeRTL();
        });
    }

    attachModalListeners() {
        const closeBtn       = document.getElementById('modalCloseBtn');
        const cancelBtn      = document.getElementById('modalCancelBtn');
        const confirmBtn     = document.getElementById('modalConfirmBtn');
        const altitudeInput = document.getElementById('altitudeInput');
        const speedInput    = document.getElementById('speedInput');

        if (!closeBtn || !cancelBtn || !confirmBtn) {
            console.error('❌ Modal buttons not found');
            return;
        }

        closeBtn.addEventListener('click',   () => this.hideTakeoffModal());
        cancelBtn.addEventListener('click',  () => this.hideTakeoffModal());
        confirmBtn.addEventListener('click', () => this.confirmTakeoff());

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hideTakeoffModal();
        });

        if (altitudeInput) {
            altitudeInput.addEventListener('input', (e) => {
                this.takeoffSettings.altitude = parseFloat(e.target.value);
            });
        }
        if (speedInput) {
            speedInput.addEventListener('input', (e) => {
                this.takeoffSettings.speed = parseFloat(e.target.value);
            });
        }
    }

    showTakeoffModal() {
        this.modal.classList.add('active');
        document.getElementById('modalActions').style.display = 'flex';

        const altitudeInput = document.getElementById('altitudeInput');
        const speedInput    = document.getElementById('speedInput');

        if (altitudeInput) {
            altitudeInput.value = this.takeoffSettings.altitude;
        }
        if (speedInput) {
            speedInput.value = this.takeoffSettings.speed;
        }
    }

    hideTakeoffModal() {
        if (!this.isExecuting) this.modal.classList.remove('active');
    }

    confirmTakeoff() {
        this.setExecutingState(this.takeoffBtn, 'TAKEOFF');
        if (this.callbacks.onTakeoff) this.callbacks.onTakeoff(this.takeoffSettings);
        this.modal.classList.remove('active'); // forcefully close modal
        setTimeout(() => this.clearExecutingState(), 6000);
    }

    executeLand() {
        this.setExecutingState(this.landBtn, 'LAND');
        if (this.callbacks.onLand) this.callbacks.onLand();
        setTimeout(() => this.clearExecutingState(), 6000);
    }

    executeRTL() {
        this.setExecutingState(this.rtlBtn, 'RTL');
        if (this.callbacks.onRTL) this.callbacks.onRTL();
        setTimeout(() => this.clearExecutingState(), 6000);
    }

    setExecutingState(button, command) {
        this.isExecuting    = true;
        this.currentCommand = command;
        button.classList.add('executing');
        this.disableAllButtons();
    }

    clearExecutingState() {
        this.isExecuting    = false;
        this.currentCommand = null;
        this.takeoffBtn.classList.remove('executing');
        this.landBtn.classList.remove('executing');
        this.rtlBtn.classList.remove('executing');
        this.enableAllButtons();
    }

    disableAllButtons() {
        this.takeoffBtn.disabled = true;
        this.landBtn.disabled    = true;
        this.rtlBtn.disabled     = true;
    }

    enableAllButtons() {
        this.takeoffBtn.disabled = false;
        this.landBtn.disabled    = false;
        this.rtlBtn.disabled     = false;
    }

    onTakeoff(cb) { this.callbacks.onTakeoff = cb; }
    onLand(cb)    { this.callbacks.onLand    = cb; }
    onRTL(cb)     { this.callbacks.onRTL     = cb; }

    show() { const c = document.querySelector('.flight-controls-strip'); if (c) c.style.display = 'flex'; }
    hide() { const c = document.querySelector('.flight-controls-strip'); if (c) c.style.display = 'none'; }
    isCommandExecuting() { return this.isExecuting; }
    getCurrentCommand()  { return this.currentCommand; }
    getTakeoffSettings() { return { ...this.takeoffSettings }; }
}

/* ============================================================================
   FLIGHT MODE SELECTOR
   Opens panel to the RIGHT of the strip so it never covers console messages.
   ============================================================================ */

class FlightModeSelector {
    constructor() {
        this.currentMode = 'STABILIZE';
        this.panel       = null;
        this.btn         = null;
        this.badge       = null;
        this.isOpen      = false;
        this.init();
    }

    init() {
        this.btn   = document.getElementById('flightModeBtn');
        this.panel = document.getElementById('flightModePanel');
        this.badge = document.getElementById('activeModeDisplay');

        if (!this.btn || !this.panel) {
            console.error('❌ FlightModeSelector: elements not found');
            return;
        }

        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isOpen ? this.close() : this.open();
        });

        this.panel.querySelectorAll('.mode-item').forEach(item => {
            item.addEventListener('click', () => this.select(item.dataset.mode, item));
        });

        document.addEventListener('click', (e) => {
            if (!this.btn.contains(e.target) && !this.panel.contains(e.target)) this.close();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
        });

        console.log('✅ FlightModeSelector initialized');
    }

    open() {
        const rect        = this.btn.getBoundingClientRect();
        const panelHeight = this.panel.offsetHeight || 380;

        this.panel.style.left = (rect.right + 8) + 'px';
        let topPos = rect.bottom - panelHeight;
        if (topPos < 10) topPos = 10;
        this.panel.style.top = topPos + 'px';

        this.panel.classList.add('open');
        this.isOpen = true;
    }

    close() {
        this.panel.classList.remove('open');
        this.isOpen = false;
    }

    /** User tapped a mode row in the panel */
    select(mode, el) {
        this.currentMode = mode;

        this.panel.querySelectorAll('.mode-item').forEach(i => i.classList.remove('active-mode'));
        el.classList.add('active-mode');

        if (this.badge) this.badge.textContent = mode.toUpperCase();

        console.log('✈️ Flight Mode selected:', mode);

        // Dispatch so the flightModeChanged listener can call sendCommand
        window.dispatchEvent(new CustomEvent('flightModeChanged', { detail: { mode } }));

        setTimeout(() => this.close(), 180);
    }

    /** Called from websocket.js flight_mode_status / flight_mode_changed handler */
    setMode(mode) {
        if (!mode) return;
        this.currentMode = mode;
        if (this.badge) this.badge.textContent = mode.toUpperCase();

        const item = this.panel?.querySelector(`[data-mode="${mode}"]`);
        if (item) {
            this.panel.querySelectorAll('.mode-item').forEach(i => i.classList.remove('active-mode'));
            item.classList.add('active-mode');
        }
    }

    getCurrentMode() { return this.currentMode; }
}

/* ============================================================================
   ARM / DISARM TOGGLE
   ============================================================================ */

class ArmToggle {
    constructor() {
        this.isArmed = false;
        this.isPending = false;
        this.btn     = null;
        this.label   = null;
        this.icon    = null;
        this.callbacks = { onArm: null, onDisarm: null };
        this.init();
    }

    init() {
        this.btn   = document.getElementById('armBtn');
        this.label = document.getElementById('armBtnLabel');
        this.icon  = document.getElementById('armBtnIcon');

        if (!this.btn) { console.error('❌ ArmToggle: #armBtn not found'); return; }

        this.btn.addEventListener('click', () => this.toggle());

        // Listen for responses and timeouts to clear pending state
        window.addEventListener('calibration_ws_message', (e) => {
            const msg = e.detail;
            if (msg.type === 'response' && (msg.command === 'ARM' || msg.command === 'DISARM')) {
                this.clearPendingState();
            }
            if (msg.type === 'event' && (msg.event === 'armed' || msg.event === 'disarmed')) {
                this.clearPendingState();
            }
        });

        window.addEventListener('command_timeout', (e) => {
            const cmd = e.detail.command;
            if (cmd === 'ARM' || cmd === 'DISARM') {
                this.clearPendingState();
                // Reset visual state back
                this.setArmedState(cmd === 'DISARM'); // if DISARM timed out, stay armed. If ARM timed out, stay disarmed.
            }
        });

        console.log('✅ ArmToggle initialized');
    }

    toggle() {
        if (this.isPending) return;
        this.isPending = true;
        this.btn.disabled = true;
        this.btn.style.opacity = '0.5';
        this.isArmed ? this.disarm() : this.arm();
    }

    clearPendingState() {
        this.isPending = false;
        this.btn.disabled = false;
        this.btn.style.opacity = '';
    }

    setArmedState(isArmed) {
        if (this.isArmed === isArmed) return;
        this.isArmed = isArmed;
        if (isArmed) {
            this.btn.classList.add('armed');
            if (this.label) this.label.textContent = 'DISARM';
            if (this.icon)  this.icon.alt = 'Disarm';
            console.log('🔴 UI State: Drone ARMED');
        } else {
            this.btn.classList.remove('armed');
            if (this.label) this.label.textContent = 'ARM';
            if (this.icon)  this.icon.alt = 'Arm';
            console.log('🟢 UI State: Drone DISARMED');
        }
    }

    arm() {
        this.setArmedState(true);
        if (this.callbacks.onArm) this.callbacks.onArm();
    }

    disarm() {
        this.setArmedState(false);
        if (this.callbacks.onDisarm) this.callbacks.onDisarm();
    }

    onArm(cb)    { this.callbacks.onArm    = cb; }
    onDisarm(cb) { this.callbacks.onDisarm = cb; }
    getState()   { return this.isArmed; }
}

/* ============================================================================
   INIT ON DOM READY
   ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Flight Controls');

    // ── ARM / DISARM ───────────────────────────────────────────────────────
    const armToggle = new ArmToggle();

    armToggle.onArm(() => {
        console.log('📤 ARM → sysid=' + (window.selectedSysId ?? 1));
        window.sendCommand('ARM');
    });

    armToggle.onDisarm(() => {
        console.log('📤 DISARM → sysid=' + (window.selectedSysId ?? 1));
        window.sendCommand('DISARM');
    });

    // ── FORCE ARM ──────────────────────────────────────────────────────────
    const forceArmBtn = document.getElementById('forceArmBtn');
    if (forceArmBtn) {
        forceArmBtn.addEventListener('click', () => {
            console.log('📤 FORCE ARM → sysid=' + (window.selectedSysId ?? 1));
            window.sendCommand('FORCE_ARM');
            // Optimistically update the regular arm button state
            armToggle.setArmedState(true);
        });
    }

    // ── TAKEOFF / LAND / RTL ───────────────────────────────────────────────
    const flightControls = new FlightControlButtons();

    flightControls.onTakeoff((settings) => {
        console.log('📤 AUTO TAKEOFF SEQUENCE INITIATED → altitude:', settings.altitude, 'm');
        
        // Step 1: Change mode to GUIDED
        if (window.MsgConsole) window.MsgConsole.info('🔄 Step 1/3 — Setting mode → GUIDED…');
        window.sendCommand('SET_MODE', { mode: 'GUIDED' });

        // Step 2: Arm the motors after a delay
        setTimeout(() => {
            if (window.MsgConsole) window.MsgConsole.info('🔒 Step 2/3 — Arming drone…');
            window.sendCommand('ARM');
            if (window.ArmControl) window.ArmControl.setArmedState(true);
        }, 1200);

        // Step 3: Takeoff after arming settles
        setTimeout(() => {
            if (window.MsgConsole) window.MsgConsole.info(`🛫 Step 3/3 — Taking off to ${settings.altitude} m…`);
            window.sendCommand('TAKEOFF', { altitude: settings.altitude, speed: settings.speed });
        }, 3500);
    });

    flightControls.onLand(() => {
        console.log('📤 LAND →');
        window.sendCommand('LAND');
    });

    flightControls.onRTL(() => {
        console.log('📤 RTL →');
        window.sendCommand('RTL');
    });

    // ── FLIGHT MODE SELECTOR ───────────────────────────────────────────────
    const flightModeSelector = new FlightModeSelector();

    // User picked a mode → send to drone
    window.addEventListener('flightModeChanged', (e) => {
        const mode = e.detail.mode;
        console.log('📤 SET_MODE →', mode);
        window.sendCommand('SET_MODE', { mode });
    });

    // Backend reported active mode (via flight_mode_changed CustomEvent
    // dispatched by websocket.js flight_mode_status handler) → sync badge
    window.addEventListener('flight_mode_changed', (e) => {
        flightModeSelector.setMode(e.detail.mode);
    });

    // ── Expose globals ─────────────────────────────────────────────────────
    window.FlightControls     = flightControls;
    window.ArmControl         = armToggle;
    window.FlightModeSelector = flightModeSelector;

    console.log('✅ Flight Controls fully initialized');
});

console.log('%c🚁 Flight Control System Ready', 'color: #22c55e; font-size: 14px; font-weight: bold;');