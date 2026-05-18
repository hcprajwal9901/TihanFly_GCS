/**
 * settings-window.js
 * TiHANFly GCS — Vehicle Configuration Window
 * Sidebar routing only. Each panel is in its own file:
 *   calib-accel.js / calib-accel.css
 *   calib-compass.js / calib-compass.css
 *   calib-radio.js / calib-radio.css
 *   calib-esc.js / calib-esc.css
 *   param-switch.js / param-switch.css   ← RC Switch Options (RCx_OPTION params)
 *   param-full.js / param-full.css
 *   flight-modes.js / flight-modes.css
 *
 * Usage: SettingsWindow.open()  /  SettingsWindow.close()
 *
 * FIX SUMMARY (vs previous version):
 *   1. Removed inline <script>ParamSwitch.init();</script> from MainWindow.html —
 *      the #panel-param-switch element doesn't exist until SettingsWindow.open()
 *      builds the shell, so calling init() at page-load always found no host and
 *      silently returned. Lazy init here is the correct pattern.
 *   2. Sidebar label for param-switch corrected: "User Params" → "RC Switch Options".
 *   3. initPanel() now guards against double-init using the `initialised` Set that
 *      was already present — no change needed there, documenting for clarity.
 */
(function () {
    'use strict';

    // ── Map panel-id → module global name ─────────────────────────────────────
    // Each panel is initialised LAZILY on first click so missing scripts
    // don't silently break other panels, and load order doesn't matter.
    const PANEL_MODULES = {
        'calib-accel'   : 'CalibAccel',
        'calib-compass' : 'CalibCompass',
        'calib-radio'   : 'CalibRadio',
        'calib-esc'     : 'CalibESC',
        'param-switch'  : 'ParamSwitch',   // RC Switch Options (RC5–RC12 OPTION params)
        'param-full'    : 'ParamFull',
        'flight-modes'  : 'FlightModes',
        'failsafe'      : 'Failsafe',      // Battery + RC Failsafe configuration
        'geofence'      : 'Geofence',      // Geofence boundary configuration
        'servo-output'  : 'ServoOutput',   // Servo / Motor output channel config
        'motor-test'    : 'MotorTest',     // MAV_CMD_DO_MOTOR_TEST
        'frame-type'    : 'FrameType',     // FRAME_CLASS + FRAME_TYPE parameter writer
        'initial-tune'  : 'InitialTune',   // Initial tune: battery / prop parameter wizard
        'pid-tuning'    : 'PIDTuning',     // PID Tuning: Roll / Pitch / Yaw / Alt / Velocity
        'comm-link'     : 'CommLink',      // Communication Link manager (TCP/UDP/Serial)
    };

    // Track which panels have already been initialised
    const initialised = new Set();

    // ── Shell template ────────────────────────────────────────────────────────
    function buildShellHTML() {
        return `
<div class="settings-overlay" id="settingsOverlay">
  <div class="settings-window">

    <!-- HEADER -->
    <div class="settings-header">
      <div class="settings-header-left">
        <div class="settings-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <div>
          <div class="settings-header-title">Vehicle Configuration</div>
          <div class="settings-header-subtitle">TiHANFly Ground Control Station</div>
        </div>
      </div>
      <button class="settings-close-btn" id="settingsCloseBtn">×</button>
    </div>

    <!-- BODY -->
    <div class="settings-body">

      <!-- SIDEBAR -->
      <div class="settings-sidebar">
        <div class="settings-sidebar-label">Calibration</div>

        <button class="settings-nav-btn active" data-panel="calib-accel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Accelerometer
        </button>

        <button class="settings-nav-btn" data-panel="calib-compass">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
          </svg>
          Compass
        </button>

        <button class="settings-nav-btn" data-panel="calib-radio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 6l11 6 11-6M1 12l11 6 11-6" stroke-linecap="round"/>
          </svg>
          Radio
        </button>

        <button class="settings-nav-btn" data-panel="calib-esc">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
          </svg>
          ESC
        </button>

        <div class="settings-sidebar-label">Parameters</div>

        <!-- FIX: label was "User Params" — corrected to "RC Switch Options" -->
        <button class="settings-nav-btn" data-panel="param-switch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="14" rx="2"/>
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            <line x1="12" y1="12" x2="12" y2="16"/>
            <line x1="10" y1="14" x2="14" y2="14"/>
          </svg>
          RC Switch Options
        </button>

        <button class="settings-nav-btn" data-panel="param-full">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8"  y1="6"  x2="21" y2="6"/>
            <line x1="8"  y1="12" x2="21" y2="12"/>
            <line x1="8"  y1="18" x2="21" y2="18"/>
            <line x1="3"  y1="6"  x2="3.01" y2="6"  stroke-linecap="round"/>
            <line x1="3"  y1="12" x2="3.01" y2="12" stroke-linecap="round"/>
            <line x1="3"  y1="18" x2="3.01" y2="18" stroke-linecap="round"/>
          </svg>
          Full Params
        </button>

        <div class="settings-sidebar-label">Flight</div>

        <button class="settings-nav-btn" data-panel="flight-modes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Flight Modes
        </button>

        <div class="settings-sidebar-label">Safety</div>

        <button class="settings-nav-btn" data-panel="failsafe">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Failsafe
        </button>

        <button class="settings-nav-btn" data-panel="geofence">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Geofence
        </button>

        <div class="settings-sidebar-label">Outputs</div>

        <button class="settings-nav-btn" data-panel="servo-output">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="9" width="4" height="6" rx="1"/>
            <rect x="10" y="6" width="4" height="12" rx="1"/>
            <rect x="18" y="9" width="4" height="6" rx="1"/>
            <line x1="6" y1="12" x2="10" y2="12"/>
            <line x1="14" y1="12" x2="18" y2="12"/>
          </svg>
          Servo Output
        </button>

        <button class="settings-nav-btn" data-panel="motor-test">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83
                     M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
          </svg>
          Motor Test
        </button>

        <div class="settings-sidebar-label">Airframe</div>

        <button class="settings-nav-btn" data-panel="frame-type">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
            <line x1="12" y1="2" x2="12" y2="22"/>
            <line x1="2" y1="8.5" x2="22" y2="8.5"/>
            <line x1="2" y1="15.5" x2="22" y2="15.5"/>
          </svg>
          Frame Type
        </button>

        <button class="settings-nav-btn" data-panel="initial-tune">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <polyline points="7 8 12 13 17 8"/>
          </svg>
          Initial Tune
        </button>

        <div class="settings-sidebar-label">Tuning</div>

        <button class="settings-nav-btn" data-panel="pid-tuning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
            <rect x="15" y="10" width="6" height="4" rx="1"/>
            <rect x="9" y="4" width="6" height="4" rx="1"/>
            <rect x="3" y="14" width="6" height="4" rx="1"/>
          </svg>
          PID Tuning
        </button>

        <div class="settings-sidebar-label">Connection</div>

        <button class="settings-nav-btn" data-panel="comm-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            <line x1="12" y1="12" x2="12" y2="16"/>
            <line x1="10" y1="14" x2="14" y2="14"/>
          </svg>
          Comm Links
        </button>

      </div>

      <!-- PANEL HOST — each panel module renders into here -->
      <!-- FIX: these divs are created here at open() time, so ParamSwitch.init()
           must NOT be called from a bare <script> tag in MainWindow.html —
           the host div (#panel-param-switch) does not exist at page-load. -->
      <div class="settings-content" id="settingsContent">
        <div class="settings-panel active" id="panel-calib-accel"></div>
        <div class="settings-panel"        id="panel-calib-compass"></div>
        <div class="settings-panel"        id="panel-calib-radio"></div>
        <div class="settings-panel"        id="panel-calib-esc"></div>
        <div class="settings-panel"        id="panel-param-switch"></div>
        <div class="settings-panel"        id="panel-param-full"></div>
        <div class="settings-panel"        id="panel-flight-modes"></div>
        <div class="settings-panel"        id="panel-failsafe"></div>
        <div class="settings-panel"        id="panel-geofence"></div>
        <div class="settings-panel"        id="panel-servo-output"></div>
        <div class="settings-panel"        id="panel-motor-test"></div>
        <div class="settings-panel"        id="panel-frame-type"></div>
        <div class="settings-panel"        id="panel-initial-tune"></div>
        <div class="settings-panel"        id="panel-pid-tuning"></div>
        <div class="settings-panel"        id="panel-comm-link"></div>
      </div>

    </div><!-- /settings-body -->

    <!-- FOOTER -->
    <div class="settings-footer">
      <button class="settings-btn settings-btn-cancel" id="sw-cancelBtn">Close</button>
    </div>

  </div>
</div>
<div class="settings-toast" id="settingsToast"></div>`;
    }

    // ── Helpers (shared globally so panel modules can use them) ───────────────
    window.SwUtil = {
        q:  s => document.querySelector(s),
        qa: s => document.querySelectorAll(s),

        setStatus(id, text, cls) {
            const el = document.getElementById(id);
            if (el) { el.textContent = text; el.className = 'calib-status-value ' + cls; }
        },

        toast(msg, err) {
            const t = document.getElementById('settingsToast');
            if (!t) return;
            t.textContent = (err ? '✕  ' : '✓  ') + msg;
            t.className   = 'settings-toast ' + (err ? 'error' : 'success');
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2600);
        }
    };

    // ── Lazy init a single panel by its panel-id key ──────────────────────────
    function initPanel(panelKey) {
        if (initialised.has(panelKey)) return;   // already done — guard prevents double-init

        const globalName = PANEL_MODULES[panelKey];
        if (!globalName) return;

        const mod = window[globalName];
        if (mod && typeof mod.init === 'function') {
            try {
                mod.init();
                initialised.add(panelKey);
                console.log('✅ Panel initialised:', panelKey);
            } catch (e) {
                console.error('SettingsWindow: error initialising panel', panelKey, e);
                const host = document.getElementById('panel-' + panelKey);
                if (host) host.innerHTML = `
                    <div style="padding:40px 0;color:var(--bad);font-family:var(--mono);font-size:12px;">
                        ✕ Failed to load panel: <strong>${panelKey}</strong><br>
                        <span style="color:var(--text-muted);margin-top:8px;display:block">${e.message}</span>
                    </div>`;
            }
        } else {
            console.warn('SettingsWindow: module not loaded for panel', panelKey, '— expected window.' + globalName);
            const host = document.getElementById('panel-' + panelKey);
            if (host && !host.hasAttribute('data-missing-warned')) {
                host.setAttribute('data-missing-warned', '1');
                host.innerHTML = `
                    <div style="padding:40px 0;color:var(--text-muted);font-family:var(--mono);font-size:12px;text-align:center;">
                        <div style="font-size:28px;margin-bottom:16px;opacity:.3">⚠</div>
                        Panel script not loaded:<br>
                        <strong style="color:var(--text-secondary)">${panelKey}.js</strong><br><br>
                        <span style="font-size:11px">Add &lt;script src="${panelKey}.js"&gt;&lt;/script&gt; to your HTML.</span>
                    </div>`;
            }
        }
    }

    // ── Open / Close ──────────────────────────────────────────────────────────
    function open() {
        if (!document.getElementById('settingsOverlay')) {
            const wrap = document.createElement('div');
            wrap.innerHTML = buildShellHTML();
            while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
            bindSidebar();
            // Init the default visible panel (calib-accel) immediately
            initPanel('calib-accel');
            if (window.updateAllDroneSelectors) window.updateAllDroneSelectors();
        }
        const overlay = document.getElementById('settingsOverlay');
        overlay.style.display = 'flex';
        overlay.classList.remove('closing');
        console.log('⚙️ Vehicle Config window opened');
    }

    function close() {
        const overlay = document.getElementById('settingsOverlay');
        if (!overlay) return;
        overlay.classList.add('closing');
        setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('closing'); }, 160);
    }

    // ── Sidebar routing ───────────────────────────────────────────────────────
    function bindSidebar() {
        const { q, qa } = window.SwUtil;

        q('#settingsCloseBtn')?.addEventListener('click', close);
        q('#sw-cancelBtn')?.addEventListener('click', close);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                const o = document.getElementById('settingsOverlay');
                if (o && o.style.display !== 'none') close();
            }
        });

        qa('.settings-nav-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                // Update active sidebar button
                qa('.settings-nav-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Show the target panel
                qa('.settings-panel').forEach(p => p.classList.remove('active'));
                const panelKey = this.dataset.panel;
                const target   = document.getElementById('panel-' + panelKey);
                if (target) target.classList.add('active');

                // LAZY INIT: initialise the panel on first visit only
                // This is the correct place to call ParamSwitch.init() —
                // the host div exists in the DOM at this point.
                initPanel(panelKey);
                if (window.updateAllDroneSelectors) window.updateAllDroneSelectors();
            });
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window.SettingsWindow = { open, close };
    console.log('✅ SettingsWindow shell ready');

})();