/**
 * failsafe.js — TiHANFly GCS
 * Failsafe Configuration Panel — QGC-style parameter-based approach
 *
 * Like QGroundControl, this panel writes ArduPilot parameters directly.
 * The FC firmware handles all failsafe logic — no GCS-side polling.
 *
 * Parameters written:
 *   Battery Low Failsafe:      BATT_FS_LOW_ACT  (0=None,1=Land,2=RTL,3=SmartRTL,4=SmartRTLOrLand)
 *   Battery Critical Failsafe: BATT_FS_CRT_ACT  (same enum)
 *   RC / Throttle Failsafe:    FS_THR_ENABLE    (0=Disabled,1=AlwaysLand,2=AltHoldLand,3=AlwaysRTL,4=SmartRTLOrLand)
 *
 * Parameters read on panel open:
 *   BATT_FS_LOW_ACT, BATT_FS_CRT_ACT, FS_THR_ENABLE
 *
 * WebSocket protocol (backend → frontend):
 *   { type: "param_value", param_id: "BATT_FS_LOW_ACT", value: 2 }
 *   { type: "param_set_sent", param_id: "BATT_FS_LOW_ACT", value: 2 }
 *   { type: "param_error", message: "…" }
 *
 * WebSocket protocol (frontend → backend):
 *   { type: "param_request_one", name: "BATT_FS_LOW_ACT" }
 *   { type: "param_set", param_id: "BATT_FS_LOW_ACT", value: 2 }
 */

(function () {
    'use strict';

    // ── ArduPilot parameter names ───────────────────────────────────────────
    const PARAM = {
        BATT_LOW:  'BATT_FS_LOW_ACT',
        BATT_CRT:  'BATT_FS_CRT_ACT',
        RC_FS:     'FS_THR_ENABLE',
    };

    // ── Enum mappings (value → human label) ────────────────────────────────
    const BATT_ACTIONS = [
        { v: 0, label: 'None (Disabled)' },
        { v: 1, label: 'Land' },
        { v: 2, label: 'RTL' },
        { v: 3, label: 'SmartRTL' },
        { v: 4, label: 'SmartRTL or Land' },
    ];

    const RC_ACTIONS = [
        { v: 0, label: 'Disabled' },
        { v: 1, label: 'Always Land' },
        { v: 2, label: 'AltHold then Land' },
        { v: 3, label: 'Always RTL' },
        { v: 4, label: 'SmartRTL or Land' },
    ];

    // ── In-memory state — updated when param_value arrives ─────────────────
    let currentValues = {
        BATT_FS_LOW_ACT: null,
        BATT_FS_CRT_ACT: null,
        FS_THR_ENABLE:   null,
    };

    let pendingSaves = {};   // tracks which params we sent param_set for
    let initialised  = false;
    let wsListener   = null; // reference so we can remove it on destroy

    // ── WebSocket helpers ───────────────────────────────────────────────────
    function requestParam(name) {
        if (typeof window.safeSend !== 'function') {
            console.warn('[Failsafe] safeSend not available, cannot request', name);
            return;
        }
        window.safeSend({ type: 'param_request_one', name });
        console.log('[Failsafe] Requested param:', name);
    }

    function setParam(paramId, value) {
        if (typeof window.safeSend !== 'function') {
            console.warn('[Failsafe] safeSend not available, cannot set', paramId);
            return false;
        }
        window.safeSend({ type: 'param_set', param_id: paramId, value: parseFloat(value) });
        console.log('[Failsafe] Setting param:', paramId, '=', value);
        pendingSaves[paramId] = value;
        return true;
    }

    // ── Request all failsafe params from the FC ─────────────────────────────
    function refreshParams() {
        setBadge('fs-conn-badge', 'loading', '⟳ Fetching from FC…');
        requestParam(PARAM.BATT_LOW);
        requestParam(PARAM.BATT_CRT);
        requestParam(PARAM.RC_FS);
    }

    // ── Handle incoming param_value / param_set_sent / param_error messages ─
    function handleWsMessage(evt) {
        let msg;
        try { msg = evt.detail; } catch(e) { return; }
        if (!msg || !msg.type) return;

        if (msg.type === 'param_value') {
            const id  = msg.param_id;
            const val = parseFloat(msg.value);
            if (id in currentValues) {
                currentValues[id] = val;
                applyValueToUI(id, val);
                console.log('[Failsafe] Received param', id, '=', val);
                checkAllLoaded();
            }
        }

        if (msg.type === 'param_set_sent') {
            const id = msg.param_id;
            if (id in pendingSaves) {
                currentValues[id] = parseFloat(msg.value);
                delete pendingSaves[id];
                markParamSaved(id);
                checkAllSaved();
            }
        }

        if (msg.type === 'param_error') {
            setBadge('fs-conn-badge', 'error', '✕ FC error');
            window.SwUtil?.toast?.('Failsafe param error: ' + (msg.message || '?'), true);
        }
    }

    // ── Apply fetched value to the correct select element ──────────────────
    function applyValueToUI(paramId, value) {
        const map = {
            'BATT_FS_LOW_ACT': 'fs-batt-low-sel',
            'BATT_FS_CRT_ACT': 'fs-batt-crt-sel',
            'FS_THR_ENABLE':   'fs-rc-sel',
        };
        const selId = map[paramId];
        const sel = document.getElementById(selId);
        if (sel) {
            sel.value = String(Math.round(value));
            updateRowHint(sel);
        }
    }

    function checkAllLoaded() {
        const all = Object.values(currentValues).every(v => v !== null);
        if (all) {
            setBadge('fs-conn-badge', 'ok', '✓ Synced with FC');
        }
    }

    function checkAllSaved() {
        if (Object.keys(pendingSaves).length === 0) {
            setBadge('fs-save-badge', 'ok', '✓ Saved to FC');
            window.SwUtil?.toast?.('Failsafe settings written to flight controller', false);
            setTimeout(() => setBadge('fs-save-badge', 'idle', ''), 3000);
        }
    }

    function markParamSaved(paramId) {
        // flash the row to show it was accepted
        const rowMap = {
            'BATT_FS_LOW_ACT': 'fs-batt-low-row',
            'BATT_FS_CRT_ACT': 'fs-batt-crt-row',
            'FS_THR_ENABLE':   'fs-rc-row',
        };
        const row = document.getElementById(rowMap[paramId]);
        if (row) {
            row.classList.add('fs-row-saved');
            setTimeout(() => row.classList.remove('fs-row-saved'), 1800);
        }
    }

    // ── UI badge helper ─────────────────────────────────────────────────────
    function setBadge(id, state, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.className   = 'fs-badge fs-badge-' + state;
    }

    // ── Update hint text when a select changes ──────────────────────────────
    function updateRowHint(sel) {
        const hintId = sel.dataset.hint;
        const hint   = document.getElementById(hintId);
        const opt    = sel.options[sel.selectedIndex];
        if (hint && opt) {
            hint.textContent = opt.dataset.hint || '';
        }
    }

    // ── Build option HTML for a select ─────────────────────────────────────
    function buildOptions(actions) {
        const HINTS = {
            'None (Disabled)':       'No action taken. FC continues normally.',
            'Land':                  'Drone descends and lands immediately.',
            'RTL':                   'Drone returns to the launch point.',
            'SmartRTL':              'Returns via the recorded flight path.',
            'SmartRTL or Land':      'SmartRTL if path available, otherwise Land.',
            'Disabled':              'RC failsafe is off. Not recommended.',
            'Always Land':           'Drone lands immediately regardless of mode.',
            'AltHold then Land':     'Holds altitude briefly, then descends.',
            'Always RTL':            'Drone returns to launch on signal loss.',
        };
        return actions.map(a =>
            `<option value="${a.v}" data-hint="${HINTS[a.label] || ''}">${a.label}</option>`
        ).join('');
    }

    // ── Panel HTML ──────────────────────────────────────────────────────────
    function buildPanelHTML() {
        return `
<div class="settings-panel-title">Failsafe</div>

<!-- Sync status strip -->
<div class="fs-sync-strip">
  <div class="fs-sync-info">
    <span class="fs-badge fs-badge-idle" id="fs-conn-badge">Not connected</span>
    <span class="fs-sync-label">Parameters are read from and written directly to the flight controller.</span>
  </div>
  <button class="calib-btn calib-btn-secondary fs-refresh-btn" id="fs-refresh-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
      <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5"/>
      <path d="M21 10V4M21 10H15"/>
    </svg>
    Refresh from FC
  </button>
</div>

<!-- ════════ Battery Failsafe ════════ -->
<div class="calib-card" style="margin-bottom:20px;">
  <div class="calib-visual">
    <div class="calib-icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="16" height="10" rx="2"/>
        <path d="M22 11v2"/>
        <path d="M6 11l4-4v4h4l-4 4v-4H6z" fill="currentColor" stroke="none"/>
      </svg>
    </div>
    <div class="calib-meta">
      <h4>Battery Failsafe</h4>
      <p>The flight controller triggers these actions autonomously when voltage/capacity thresholds are crossed. Thresholds are set via <strong>BATT_LOW_VOLT</strong> and <strong>BATT_CRT_VOLT</strong> in Full Params.</p>
    </div>
  </div>

  <!-- Low -->
  <div class="fs-param-row" id="fs-batt-low-row">
    <div class="fs-param-info">
      <span class="fs-param-name">BATT_FS_LOW_ACT</span>
      <span class="fs-param-desc">Battery 1 low failsafe action</span>
    </div>
    <div class="fs-param-control">
      <select class="settings-input fs-select" id="fs-batt-low-sel"
              data-param="BATT_FS_LOW_ACT" data-hint="fs-batt-low-hint">
        ${buildOptions(BATT_ACTIONS)}
      </select>
      <div class="fs-row-hint" id="fs-batt-low-hint"></div>
    </div>
  </div>

  <!-- Critical -->
  <div class="fs-param-row" id="fs-batt-crt-row" style="margin-top:14px;">
    <div class="fs-param-info">
      <span class="fs-param-name">BATT_FS_CRT_ACT</span>
      <span class="fs-param-desc">Battery 1 critical failsafe action</span>
    </div>
    <div class="fs-param-control">
      <select class="settings-input fs-select" id="fs-batt-crt-sel"
              data-param="BATT_FS_CRT_ACT" data-hint="fs-batt-crt-hint">
        ${buildOptions(BATT_ACTIONS)}
      </select>
      <div class="fs-row-hint" id="fs-batt-crt-hint"></div>
    </div>
  </div>

  <div class="calib-warning" style="margin-top:18px;margin-bottom:0;">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    Voltage thresholds are set in <strong>Full Params → BATT_LOW_VOLT</strong> and <strong>BATT_CRT_VOLT</strong>.
    The FC triggers failsafe independently — the GCS does not need to be connected.
  </div>
</div>

<!-- ════════ RC / Throttle Failsafe ════════ -->
<div class="calib-card" style="margin-bottom:20px;">
  <div class="calib-visual">
    <div class="calib-icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12.55a11 11 0 0114.08 0"/>
        <path d="M1.42 9a16 16 0 0121.16 0"/>
        <path d="M8.53 16.11a6 6 0 016.95 0"/>
        <circle cx="12" cy="20" r="1" fill="currentColor"/>
      </svg>
    </div>
    <div class="calib-meta">
      <h4>RC / Throttle Failsafe</h4>
      <p>Action taken when the RC transmitter signal is lost. The FC detects signal loss when throttle PWM drops below <strong>FS_THR_VALUE</strong>.</p>
    </div>
  </div>

  <div class="fs-param-row" id="fs-rc-row">
    <div class="fs-param-info">
      <span class="fs-param-name">FS_THR_ENABLE</span>
      <span class="fs-param-desc">RC throttle failsafe enable / action</span>
    </div>
    <div class="fs-param-control">
      <select class="settings-input fs-select" id="fs-rc-sel"
              data-param="FS_THR_ENABLE" data-hint="fs-rc-hint">
        ${buildOptions(RC_ACTIONS)}
      </select>
      <div class="fs-row-hint" id="fs-rc-hint"></div>
    </div>
  </div>

  <div class="calib-warning" style="margin-top:18px;margin-bottom:0;">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    Set the throttle PWM threshold via <strong>FS_THR_VALUE</strong> in Full Params.
    Recommended: set your radio's failsafe output below the minimum stick position (~975 µs).
  </div>
</div>

<!-- ════════ Save / status ════════ -->
<div class="fs-save-strip">
  <span class="fs-badge fs-badge-idle" id="fs-save-badge"></span>
  <button class="calib-btn calib-btn-primary" id="fs-save-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    Write to Flight Controller
  </button>
</div>`;
    }

    // ── Wire up controls ────────────────────────────────────────────────────
    function wirePanel() {
        // All selects — show hint on change
        document.querySelectorAll('.fs-select').forEach(sel => {
            sel.addEventListener('change', () => {
                updateRowHint(sel);
                // Mark the row as "pending save"
                const rowId = sel.closest('.fs-param-row')?.id;
                const row   = rowId ? document.getElementById(rowId) : null;
                if (row) { row.classList.remove('fs-row-saved'); row.classList.add('fs-row-pending'); }
            });
            // Set initial hint
            updateRowHint(sel);
        });

        // Refresh button
        document.getElementById('fs-refresh-btn')?.addEventListener('click', () => {
            // Reset state so we re-fetch
            Object.keys(currentValues).forEach(k => { currentValues[k] = null; });
            refreshParams();
        });

        // Save button — write all 3 params
        document.getElementById('fs-save-btn')?.addEventListener('click', () => {
            const lowSel = document.getElementById('fs-batt-low-sel');
            const crtSel = document.getElementById('fs-batt-crt-sel');
            const rcSel  = document.getElementById('fs-rc-sel');

            if (!lowSel || !crtSel || !rcSel) return;

            const allOk = [
                setParam(PARAM.BATT_LOW, lowSel.value),
                setParam(PARAM.BATT_CRT, crtSel.value),
                setParam(PARAM.RC_FS,    rcSel.value),
            ].every(Boolean);

            if (allOk) {
                setBadge('fs-save-badge', 'loading', '⟳ Writing to FC…');
                // Remove pending style from all rows
                document.querySelectorAll('.fs-param-row').forEach(r => r.classList.remove('fs-row-pending'));
            } else {
                setBadge('fs-save-badge', 'error', '✕ Not connected');
                window.SwUtil?.toast?.('Not connected — cannot write parameters', true);
            }
        });

        // Listen for param_value / param_set_sent events from the WS layer
        wsListener = handleWsMessage.bind(null);
        window.addEventListener('calibration_ws_message', wsListener);
    }

    // ── Public API ──────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-failsafe');
        if (!host) {
            console.error('[Failsafe] Host element #panel-failsafe not found');
            return;
        }

        host.innerHTML = buildPanelHTML();
        wirePanel();

        // Auto-fetch current values from the FC
        setTimeout(refreshParams, 200);
        console.log('✅ Failsafe panel initialised (parameter-based)');
    }

    window.Failsafe = { init };
    console.log('✅ Failsafe module loaded');

})();
