/**
 * servo-output.js — TiHANFly GCS
 * Servo / Motor Output Configuration Panel — QGC-style
 *
 * Reads and writes ArduPilot SERVOn_* parameters for channels 1–16:
 *   SERVOn_FUNCTION   — output function (Motor1, Disabled, RCPassThru, …)
 *   SERVOn_REVERSED   — 0 = normal, 1 = reversed
 *   SERVOn_MIN        — minimum PWM (µs)
 *   SERVOn_TRIM       — trim/centre PWM (µs)
 *   SERVOn_MAX        — maximum PWM (µs)
 *
 * Live position bar is updated from servo_output_raw telemetry messages.
 *
 * WebSocket (frontend → backend):
 *   { type: "param_request_one", name: "SERVO1_FUNCTION" }
 *   { type: "param_set", param_id: "SERVO1_FUNCTION", value: 33 }
 *   { type: "command", command: "save_eeprom" }
 *
 * WebSocket (backend → frontend) via calibration_ws_message event:
 *   { type: "param_value",      param_id: "SERVO1_FUNCTION", value: 33 }
 *   { type: "param_set_sent",   param_id: "SERVO1_FUNCTION", value: 33 }
 *   { type: "servo_output_raw", ch1: 1500, ch2: 1500, … }
 *   { type: "param_error",      message: "…" }
 */

(function () {
    'use strict';

    // ── Constants ────────────────────────────────────────────────────────────
    const NUM_CHANNELS = 16;

    // ArduPilot SERVOn_FUNCTION enum (most common values)
    const SERVO_FUNCTIONS = [
        { v: 0,   label: 'Disabled' },
        { v: 1,   label: 'RCPassThru' },
        { v: 6,   label: 'Mount Pitch' },
        { v: 7,   label: 'Mount Roll' },
        { v: 8,   label: 'Mount Yaw' },
        { v: 22,  label: 'Flap' },
        { v: 23,  label: 'Flap Auto' },
        { v: 24,  label: 'Aileron' },
        { v: 25,  label: 'Rudder' },
        { v: 26,  label: 'Elevator' },
        { v: 27,  label: 'Throttle' },
        { v: 33,  label: 'Motor1' },
        { v: 34,  label: 'Motor2' },
        { v: 35,  label: 'Motor3' },
        { v: 36,  label: 'Motor4' },
        { v: 37,  label: 'Motor5' },
        { v: 38,  label: 'Motor6' },
        { v: 39,  label: 'Motor7' },
        { v: 40,  label: 'Motor8' },
        { v: 51,  label: 'RCIN1' },
        { v: 52,  label: 'RCIN2' },
        { v: 53,  label: 'RCIN3' },
        { v: 54,  label: 'RCIN4' },
        { v: 55,  label: 'RCIN5' },
        { v: 56,  label: 'RCIN6' },
        { v: 57,  label: 'RCIN7' },
        { v: 58,  label: 'RCIN8' },
        { v: 59,  label: 'Camera Trigger' },
        { v: 62,  label: 'Throttle Left' },
        { v: 63,  label: 'Throttle Right' },
        { v: 64,  label: 'Tilt Motor Front' },
        { v: 65,  label: 'Tilt Motor Rear' },
        { v: 73,  label: 'Throttle Motor Boost' },
        { v: 94,  label: 'Script 1' },
        { v: 95,  label: 'Script 2' },
        { v: 96,  label: 'Script 3' },
        { v: 97,  label: 'Script 4' },
    ];

    // ── State ────────────────────────────────────────────────────────────────
    // channels[n] — n is 1-indexed (channel 1..16)
    let channels = {};
    for (let n = 1; n <= NUM_CHANNELS; n++) {
        channels[n] = {
            function:  null,
            reversed:  null,
            min:       null,
            trim:      null,
            max:       null,
            loaded:    0,  // count of params received
        };
    }

    let liveOutputs = {};   // { ch1: 1500, ch2: 1100, … } from servo_output_raw
    let pendingSaves = {};  // param_id → value, cleared on param_set_sent
    let initialised  = false;
    let wsListener   = null;

    // ── Param name helpers ───────────────────────────────────────────────────
    function pName(n, suffix) { return `SERVO${n}_${suffix}`; }

    // Given a param_id like "SERVO3_MIN", return { n:3, suffix:"MIN" } or null
    function parseParam(paramId) {
        const m = /^SERVO(\d+)_(\w+)$/.exec(paramId);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        if (n < 1 || n > NUM_CHANNELS) return null;
        return { n, suffix: m[2] };
    }

    // ── WebSocket helpers ────────────────────────────────────────────────────
    function requestParam(name) {
        if (typeof window.safeSend !== 'function') return;
        window.safeSend({ type: 'param_request_one', name });
    }

    function setParam(paramId, value) {
        if (typeof window.safeSend !== 'function') return false;
        window.safeSend({ type: 'param_set', param_id: paramId, value: parseFloat(value) });
        pendingSaves[paramId] = value;
        return true;
    }

    // ── Fetch all channel params from the FC ─────────────────────────────────
    function refreshParams() {
        setBadge('so-conn-badge', 'loading', '⟳ Fetching from FC…');
        for (let n = 1; n <= NUM_CHANNELS; n++) {
            channels[n].loaded = 0;
            requestParam(pName(n, 'FUNCTION'));
            requestParam(pName(n, 'REVERSED'));
            requestParam(pName(n, 'MIN'));
            requestParam(pName(n, 'TRIM'));
            requestParam(pName(n, 'MAX'));
        }
    }

    // ── Incoming message handler ─────────────────────────────────────────────
    function handleWsMessage(evt) {
        let msg;
        try { msg = evt.detail; } catch (e) { return; }
        if (!msg || !msg.type) return;

        if (msg.type === 'param_value') {
            const parsed = parseParam(msg.param_id);
            if (!parsed) return;
            const { n, suffix } = parsed;
            const val = parseFloat(msg.value);

            switch (suffix) {
                case 'FUNCTION': channels[n].function = val; break;
                case 'REVERSED': channels[n].reversed = val; break;
                case 'MIN':      channels[n].min      = val; break;
                case 'TRIM':     channels[n].trim     = val; break;
                case 'MAX':      channels[n].max      = val; break;
                default: return;
            }
            channels[n].loaded++;
            applyChannelToUI(n);
            checkAllLoaded();
        }

        if (msg.type === 'param_set_sent') {
            const id = msg.param_id;
            if (id in pendingSaves) {
                delete pendingSaves[id];
                flashRowSaved(id);
                checkAllSaved();
            }
        }

        if (msg.type === 'servo_output_raw') {
            liveOutputs = msg;
            updatePositionBars();
        }

        if (msg.type === 'param_error') {
            setBadge('so-conn-badge', 'error', '✕ FC error');
            window.SwUtil?.toast?.('Servo param error: ' + (msg.message || '?'), true);
        }
    }

    // ── Apply fetched channel values to the row UI ───────────────────────────
    function applyChannelToUI(n) {
        const ch = channels[n];

        const fnSel = document.getElementById(`so-fn-${n}`);
        if (fnSel && ch.function !== null) fnSel.value = String(Math.round(ch.function));

        const revCk = document.getElementById(`so-rev-${n}`);
        if (revCk && ch.reversed !== null) revCk.checked = Math.round(ch.reversed) === 1;

        const minEl  = document.getElementById(`so-min-${n}`);
        const trimEl = document.getElementById(`so-trim-${n}`);
        const maxEl  = document.getElementById(`so-max-${n}`);
        if (minEl  && ch.min  !== null) minEl.value  = Math.round(ch.min);
        if (trimEl && ch.trim !== null) trimEl.value = Math.round(ch.trim);
        if (maxEl  && ch.max  !== null) maxEl.value  = Math.round(ch.max);

        // Update LED to "active" once we have the function
        const led = document.getElementById(`so-led-${n}`);
        if (led && ch.function !== null) {
            const isActive = Math.round(ch.function) !== 0;
            led.classList.toggle('so-led-active', isActive);
            led.classList.toggle('so-led-motor', ch.function >= 33 && ch.function <= 40);
        }

        updatePositionBar(n);
    }

    // ── Live position bars ───────────────────────────────────────────────────
    function updatePositionBars() {
        for (let n = 1; n <= NUM_CHANNELS; n++) updatePositionBar(n);
    }

    function updatePositionBar(n) {
        const bar = document.getElementById(`so-pos-fill-${n}`);
        const lbl = document.getElementById(`so-pos-lbl-${n}`);
        if (!bar) return;

        const raw = liveOutputs[`ch${n}`];
        const ch  = channels[n];
        const min  = (ch.min  !== null) ? ch.min  : 1000;
        const max  = (ch.max  !== null) ? ch.max  : 2000;
        const trim = (ch.trim !== null) ? ch.trim : 1500;

        let pwm = (raw !== undefined) ? raw : trim;
        const pct = Math.min(100, Math.max(0, ((pwm - min) / (max - min)) * 100));

        bar.style.width = pct.toFixed(1) + '%';
        if (lbl) lbl.textContent = Math.round(pwm) + ' µs';
    }

    // ── Status badges ────────────────────────────────────────────────────────
    function checkAllLoaded() {
        const total = NUM_CHANNELS * 5;
        let got = 0;
        for (let n = 1; n <= NUM_CHANNELS; n++) got += channels[n].loaded;
        if (got >= total) setBadge('so-conn-badge', 'ok', '✓ Synced with FC');
    }

    function checkAllSaved() {
        if (Object.keys(pendingSaves).length === 0) {
            setBadge('so-save-badge', 'ok', '✓ Written to FC');
            window.SwUtil?.toast?.('Servo output settings written to flight controller', false);
            setTimeout(() => setBadge('so-save-badge', 'idle', ''), 3000);
        }
    }

    function setBadge(id, state, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.className   = 'fs-badge fs-badge-' + state;
    }

    function flashRowSaved(paramId) {
        const parsed = parseParam(paramId);
        if (!parsed) return;
        const row = document.getElementById(`so-row-${parsed.n}`);
        if (row) {
            row.classList.add('so-row-saved');
            setTimeout(() => row.classList.remove('so-row-saved'), 1800);
        }
    }

    // ── Mark a row as pending (unsaved change) ───────────────────────────────
    function markRowPending(n) {
        const row = document.getElementById(`so-row-${n}`);
        if (row) {
            row.classList.remove('so-row-saved');
            row.classList.add('so-row-pending');
        }
    }

    // ── Build option HTML ────────────────────────────────────────────────────
    function buildFunctionOptions() {
        return SERVO_FUNCTIONS.map(f =>
            `<option value="${f.v}">${f.label}</option>`
        ).join('');
    }

    // ── Panel HTML ───────────────────────────────────────────────────────────
    function buildPanelHTML() {
        const fnOpts = buildFunctionOptions();

        let rows = '';
        for (let n = 1; n <= NUM_CHANNELS; n++) {
            rows += `
<tr class="so-row" id="so-row-${n}">
  <td class="so-cell so-cell-ch">
    <span class="so-led" id="so-led-${n}"></span>
    <span class="so-ch-num">${n}</span>
  </td>
  <td class="so-cell so-cell-pos">
    <div class="so-pos-bar">
      <div class="so-pos-fill" id="so-pos-fill-${n}"></div>
    </div>
    <span class="so-pos-lbl" id="so-pos-lbl-${n}">-- µs</span>
  </td>
  <td class="so-cell so-cell-rev">
    <label class="so-rev-wrap">
      <input type="checkbox" class="so-rev-chk" id="so-rev-${n}" data-ch="${n}">
      <span class="so-rev-box"></span>
    </label>
  </td>
  <td class="so-cell so-cell-fn">
    <select class="so-fn-sel" id="so-fn-${n}" data-ch="${n}">${fnOpts}</select>
  </td>
  <td class="so-cell so-cell-pwm">
    <input type="number" class="so-pwm-input" id="so-min-${n}" data-ch="${n}" data-field="MIN"
           min="800" max="2200" step="1" value="1100" placeholder="Min">
  </td>
  <td class="so-cell so-cell-pwm">
    <input type="number" class="so-pwm-input" id="so-trim-${n}" data-ch="${n}" data-field="TRIM"
           min="800" max="2200" step="1" value="1500" placeholder="Trim">
  </td>
  <td class="so-cell so-cell-pwm">
    <input type="number" class="so-pwm-input" id="so-max-${n}" data-ch="${n}" data-field="MAX"
           min="800" max="2200" step="1" value="1900" placeholder="Max">
  </td>
</tr>`;
        }

        return `
<div class="settings-panel-title">Servo Output</div>

<!-- Sync status strip -->
<div class="fs-sync-strip">
  <div class="fs-sync-info">
    <span class="fs-badge fs-badge-idle" id="so-conn-badge">Not connected</span>
    <span class="fs-sync-label">Parameters are read from and written directly to the flight controller (SERVOn_*).</span>
  </div>
  <button class="calib-btn calib-btn-secondary fs-refresh-btn" id="so-refresh-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
      <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5"/>
      <path d="M21 10V4M21 10H15"/>
    </svg>
    Refresh from FC
  </button>
</div>

<!-- Channel table -->
<div class="so-table-wrap">
  <table class="so-table">
    <thead>
      <tr class="so-thead-row">
        <th class="so-th so-th-ch">#</th>
        <th class="so-th so-th-pos">Position</th>
        <th class="so-th so-th-rev">Reverse</th>
        <th class="so-th so-th-fn">Function</th>
        <th class="so-th so-th-pwm">Min</th>
        <th class="so-th so-th-pwm">Trim</th>
        <th class="so-th so-th-pwm">Max</th>
      </tr>
    </thead>
    <tbody id="so-tbody">
      ${rows}
    </tbody>
  </table>
</div>

<!-- Save strip -->
<div class="fs-save-strip so-save-strip">
  <span class="fs-badge fs-badge-idle" id="so-save-badge"></span>
  <button class="calib-btn calib-btn-secondary" id="so-eeprom-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <rect x="7" y="2" width="10" height="7" rx="1"/>
      <rect x="9" y="14" width="6" height="8" rx="1"/>
    </svg>
    Save to EEPROM
  </button>
  <button class="calib-btn calib-btn-primary" id="so-save-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    Write to FC
  </button>
</div>`;
    }

    // ── Wire up controls ─────────────────────────────────────────────────────
    function wirePanel() {
        // Function select changes
        document.querySelectorAll('.so-fn-sel').forEach(sel => {
            sel.addEventListener('change', function () {
                const n = parseInt(this.dataset.ch, 10);
                channels[n].function = parseInt(this.value, 10);
                applyChannelToUI(n);
                markRowPending(n);
            });
        });

        // Reversed checkboxes
        document.querySelectorAll('.so-rev-chk').forEach(ck => {
            ck.addEventListener('change', function () {
                const n = parseInt(this.dataset.ch, 10);
                channels[n].reversed = this.checked ? 1 : 0;
                markRowPending(n);
            });
        });

        // Min / Trim / Max inputs
        document.querySelectorAll('.so-pwm-input').forEach(inp => {
            inp.addEventListener('change', function () {
                const n     = parseInt(this.dataset.ch, 10);
                const field = this.dataset.field.toLowerCase(); // 'min' | 'trim' | 'max'
                channels[n][field] = parseFloat(this.value);
                markRowPending(n);
                updatePositionBar(n);
            });
        });

        // Refresh button
        document.getElementById('so-refresh-btn')?.addEventListener('click', () => {
            for (let n = 1; n <= NUM_CHANNELS; n++) {
                channels[n] = { function: null, reversed: null, min: null, trim: null, max: null, loaded: 0 };
            }
            refreshParams();
        });

        // Write to FC button — sends param_set for every channel
        document.getElementById('so-save-btn')?.addEventListener('click', () => {
            let anyOk = false;
            let connected = typeof window.safeSend === 'function';

            if (!connected) {
                setBadge('so-save-badge', 'error', '✕ Not connected');
                window.SwUtil?.toast?.('Not connected — cannot write parameters', true);
                return;
            }

            for (let n = 1; n <= NUM_CHANNELS; n++) {
                const ch = channels[n];
                const row = document.getElementById(`so-row-${n}`);
                if (!row || !row.classList.contains('so-row-pending')) continue;

                // Collect current UI values (in case JS state drifted)
                const fnVal  = document.getElementById(`so-fn-${n}`)?.value;
                const revVal = document.getElementById(`so-rev-${n}`)?.checked ? 1 : 0;
                const minVal = document.getElementById(`so-min-${n}`)?.value;
                const trimVal= document.getElementById(`so-trim-${n}`)?.value;
                const maxVal = document.getElementById(`so-max-${n}`)?.value;

                if (fnVal  !== undefined) setParam(pName(n, 'FUNCTION'), fnVal);
                setParam(pName(n, 'REVERSED'), revVal);
                if (minVal  !== undefined) setParam(pName(n, 'MIN'),  minVal);
                if (trimVal !== undefined) setParam(pName(n, 'TRIM'), trimVal);
                if (maxVal  !== undefined) setParam(pName(n, 'MAX'),  maxVal);

                row.classList.remove('so-row-pending');
                anyOk = true;
            }

            if (anyOk) {
                setBadge('so-save-badge', 'loading', '⟳ Writing to FC…');
            } else {
                setBadge('so-save-badge', 'idle', '');
                window.SwUtil?.toast?.('No pending changes to write', false);
            }
        });

        // Save to EEPROM button
        document.getElementById('so-eeprom-btn')?.addEventListener('click', () => {
            if (typeof window.safeSend !== 'function') {
                window.SwUtil?.toast?.('Not connected', true);
                return;
            }
            window.safeSend({ type: 'command', command: 'save_eeprom' });
            setBadge('so-save-badge', 'ok', '✓ EEPROM save requested');
            window.SwUtil?.toast?.('EEPROM save command sent to flight controller', false);
            setTimeout(() => setBadge('so-save-badge', 'idle', ''), 3000);
        });

        // Listen for WebSocket events
        wsListener = handleWsMessage.bind(null);
        window.addEventListener('calibration_ws_message', wsListener);
    }

    // ── Public API ───────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-servo-output');
        if (!host) {
            console.error('[ServoOutput] Host element #panel-servo-output not found');
            return;
        }

        host.innerHTML = buildPanelHTML();
        wirePanel();

        // Auto-fetch
        setTimeout(refreshParams, 200);
        console.log('✅ ServoOutput panel initialised');
    }

    window.ServoOutput = { init };
    console.log('✅ ServoOutput module loaded');

})();
