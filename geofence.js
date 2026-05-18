/**
 * geofence.js — TiHANFly GCS
 * Geofence Configuration Panel — QGC-style, parameter-based.
 *
 * ArduPilot params managed:
 *   FENCE_ENABLE   0=Disabled, 1=Enabled
 *   FENCE_TYPE     bitmask: 1=Max Alt, 2=Circle, 4=Polygon, 7=All
 *   FENCE_ACTION   0=Report, 1=RTL or Land, 2=Always Land, 3=SmartRTL or Land
 *   FENCE_ALT_MAX  meters (10–1000)
 *   FENCE_RADIUS   meters (30–10000)
 *   FENCE_MARGIN   meters (1–10)
 *
 * Telemetry monitored for live breach detection:
 *   window.TelemetryStore.altitude  (meters, AGL)
 *   window.TelemetryStore.distFromHome (meters, horizontal)
 */

(function () {
    'use strict';

    // ── ArduPilot parameter names ─────────────────────────────────────────────
    const PARAM = {
        ENABLE  : 'FENCE_ENABLE',
        TYPE    : 'FENCE_TYPE',
        ACTION  : 'FENCE_ACTION',
        ALT_MAX : 'FENCE_ALT_MAX',
        RADIUS  : 'FENCE_RADIUS',
        MARGIN  : 'FENCE_MARGIN',
    };

    // ── Enum maps ─────────────────────────────────────────────────────────────
    const TYPE_OPTS = [
        { v: 1, label: 'Altitude Only' },
        { v: 2, label: 'Circle Only' },
        { v: 3, label: 'Altitude + Circle' },
        { v: 7, label: 'All (Alt + Circle + Polygon)' },
    ];

    const ACTION_OPTS = [
        { v: 0, label: 'Report Only',            hint: 'Log breach — no autonomous action taken.' },
        { v: 1, label: 'RTL or Land',            hint: 'RTL if GPS available, otherwise Land.' },
        { v: 2, label: 'Always Land',            hint: 'Drone descends and lands immediately.' },
        { v: 3, label: 'SmartRTL or Land',       hint: 'SmartRTL via recorded path, or Land.' },
        { v: 4, label: 'Brake or Land',          hint: 'Brake to a stop, or Land.' },
    ];

    // ── In-memory state ───────────────────────────────────────────────────────
    let state = {
        FENCE_ENABLE  : null,
        FENCE_TYPE    : null,
        FENCE_ACTION  : null,
        FENCE_ALT_MAX : null,
        FENCE_RADIUS  : null,
        FENCE_MARGIN  : null,
    };

    let pendingSaves  = {};
    let initialised   = false;
    let wsListener    = null;
    let telemTimer    = null;
    let breachState   = { alt: false, radius: false };

    // ── WebSocket helpers ─────────────────────────────────────────────────────
    function safeSendWrap(obj) {
        if (typeof window.safeSend === 'function') {
            window.safeSend(obj);
            return true;
        }
        console.warn('[Geofence] safeSend not available');
        return false;
    }

    function requestParam(name) {
        safeSendWrap({ type: 'param_request_one', name });
        console.log('[Geofence] Requested param:', name);
    }

    function setParam(paramId, value) {
        const ok = safeSendWrap({ type: 'param_set', param_id: paramId, value: parseFloat(value) });
        if (ok) {
            console.log('[Geofence] Setting param:', paramId, '=', value);
            pendingSaves[paramId] = value;
        }
        return ok;
    }

    function refreshParams() {
        setBadge('gf-conn-badge', 'loading', '⟳ Fetching from FC…');
        Object.values(PARAM).forEach(requestParam);
    }

    // ── Incoming WS message handler ───────────────────────────────────────────
    function handleWsMessage(evt) {
        let msg;
        try { msg = evt.detail; } catch (e) { return; }
        if (!msg || !msg.type) return;

        if (msg.type === 'param_value') {
            const id  = msg.param_id;
            const val = parseFloat(msg.value);
            if (id in state) {
                state[id] = val;
                applyToUI(id, val);
                checkAllLoaded();
                console.log('[Geofence] Param received:', id, '=', val);
            }
        }

        if (msg.type === 'param_set_sent') {
            const id = msg.param_id;
            if (id in pendingSaves) {
                state[id] = parseFloat(msg.value);
                delete pendingSaves[id];
                flashRowSaved(id);
                checkAllSaved();
            }
        }

        if (msg.type === 'param_error') {
            setBadge('gf-conn-badge', 'error', '✕ FC error');
            window.SwUtil?.toast?.('Geofence param error: ' + (msg.message || '?'), true);
        }
    }

    // ── Apply received value to UI ────────────────────────────────────────────
    function applyToUI(paramId, value) {
        const round = Math.round(value);
        switch (paramId) {
            case 'FENCE_ENABLE': {
                const chk = document.getElementById('gf-enable-chk');
                if (chk) chk.checked = (round === 1);
                syncEnableState(round === 1);
                break;
            }
            case 'FENCE_TYPE': {
                const sel = document.getElementById('gf-type-sel');
                if (sel) sel.value = String(round);
                syncTypeVisibility(round);
                break;
            }
            case 'FENCE_ACTION': {
                const sel = document.getElementById('gf-action-sel');
                if (sel) { sel.value = String(round); updateActionHint(round); }
                break;
            }
            case 'FENCE_ALT_MAX': {
                const inp = document.getElementById('gf-altmax-inp');
                if (inp) inp.value = round;
                break;
            }
            case 'FENCE_RADIUS': {
                const inp = document.getElementById('gf-radius-inp');
                if (inp) inp.value = round;
                break;
            }
            case 'FENCE_MARGIN': {
                const inp = document.getElementById('gf-margin-inp');
                if (inp) inp.value = value.toFixed(1);
                break;
            }
        }
    }

    function checkAllLoaded() {
        if (Object.values(state).every(v => v !== null))
            setBadge('gf-conn-badge', 'ok', '✓ Synced with FC');
    }

    function checkAllSaved() {
        if (Object.keys(pendingSaves).length === 0) {
            setBadge('gf-save-badge', 'ok', '✓ Saved to FC');
            window.SwUtil?.toast?.('Geofence settings written to flight controller', false);
            setTimeout(() => setBadge('gf-save-badge', 'idle', ''), 3000);
        }
    }

    const ROW_MAP = {
        FENCE_ENABLE  : 'gf-row-enable',
        FENCE_TYPE    : 'gf-row-type',
        FENCE_ACTION  : 'gf-row-action',
        FENCE_ALT_MAX : 'gf-row-altmax',
        FENCE_RADIUS  : 'gf-row-radius',
        FENCE_MARGIN  : 'gf-row-margin',
    };

    function flashRowSaved(paramId) {
        const row = document.getElementById(ROW_MAP[paramId]);
        if (!row) return;
        row.classList.add('gf-row-saved');
        setTimeout(() => row.classList.remove('gf-row-saved'), 1800);
    }

    // ── UI helpers ────────────────────────────────────────────────────────────
    function setBadge(id, state, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.className   = 'gf-badge gf-badge-' + state;
    }

    function markPending(row) {
        if (!row) return;
        row.classList.remove('gf-row-saved');
        row.classList.add('gf-row-pending');
    }

    function syncEnableState(enabled) {
        const card   = document.getElementById('gf-enable-card');
        const wrap   = document.getElementById('gf-params-wrap');
        const lbl    = document.getElementById('gf-toggle-lbl');
        if (card)  card.classList.toggle('gf-active', enabled);
        if (wrap)  wrap.classList.toggle('gf-disabled', !enabled);
        if (lbl)  { lbl.textContent = enabled ? 'ENABLED' : 'OFF'; lbl.classList.toggle('on', enabled); }
    }

    function syncTypeVisibility(type) {
        // 1=Alt, 2=Circle, 3=Alt+Circle, 7=All
        const hasAlt    = (type & 1) !== 0;
        const hasCircle = (type & 2) !== 0;
        const rowAlt    = document.getElementById('gf-row-altmax');
        const rowRad    = document.getElementById('gf-row-radius');
        if (rowAlt) rowAlt.style.display = hasAlt    ? '' : 'none';
        if (rowRad) rowRad.style.display = hasCircle ? '' : 'none';
    }

    function updateActionHint(val) {
        const hint = document.getElementById('gf-action-hint');
        if (!hint) return;
        const opt = ACTION_OPTS.find(o => o.v === Math.round(val));
        hint.textContent = opt ? opt.hint : '';
    }

    // ── Live breach monitoring (GCS-side visual indicator only) ───────────────
    function startTelemMonitor() {
        if (telemTimer) return;
        telemTimer = setInterval(() => {
            if (!state.FENCE_ENABLE || state.FENCE_ENABLE !== 1) return;

            const ts      = window.TelemetryStore || {};
            const alt     = parseFloat(ts.altitude)      || 0;
            const dist    = parseFloat(ts.distFromHome)  || 0;
            const maxAlt  = state.FENCE_ALT_MAX || 0;
            const maxRad  = state.FENCE_RADIUS  || 0;
            const margin  = state.FENCE_MARGIN  || 2;
            const type    = state.FENCE_TYPE    || 0;

            const hasAlt    = (type & 1) !== 0;
            const hasCircle = (type & 2) !== 0;

            const altBreach = hasAlt    && maxAlt > 0  && alt  >= (maxAlt  - margin);
            const radBreach = hasCircle && maxRad > 0  && dist >= (maxRad  - margin);

            // Update live chips
            updateChip('gf-chip-alt',  alt,  maxAlt,  margin, hasAlt,    'm');
            updateChip('gf-chip-dist', dist, maxRad,  margin, hasCircle, 'm');

            // Show breach banner
            const breached = altBreach || radBreach;
            const banner   = document.getElementById('gf-breach-banner');
            if (banner) banner.classList.toggle('visible', breached);

            const sub = document.getElementById('gf-breach-sub');
            if (sub) {
                const parts = [];
                if (altBreach) parts.push(`Alt ${alt.toFixed(1)} m / ${maxAlt} m limit`);
                if (radBreach) parts.push(`Radius ${dist.toFixed(1)} m / ${maxRad} m limit`);
                sub.textContent = parts.join('  •  ');
            }
        }, 500);
    }

    function updateChip(id, current, max, margin, active, unit) {
        const chip = document.getElementById(id);
        if (!chip) return;
        const valEl = chip.querySelector('.gf-telem-chip-value');
        if (!valEl) return;
        valEl.textContent = active ? current.toFixed(1) : '--';
        valEl.className = 'gf-telem-chip-value';
        if (active && max > 0) {
            const ratio = current / max;
            if (ratio >= 1.0)         valEl.classList.add('gf-bad');
            else if (ratio >= (1 - margin / max)) valEl.classList.add('gf-warn');
            else                      valEl.classList.add('gf-ok');
        }
    }

    // ── Build panel HTML ──────────────────────────────────────────────────────
    function buildPanelHTML() {
        const typeOpts   = TYPE_OPTS.map(o   => `<option value="${o.v}">${o.label}</option>`).join('');
        const actionOpts = ACTION_OPTS.map(o => `<option value="${o.v}">${o.label}</option>`).join('');

        return `
<div class="settings-panel-title" style="display:flex; justify-content:space-between; align-items:center;"><span>Geofence</span><div class="drone-selector-wrap-container"></div></div>

<!-- ── Enable toggle ── -->
<div class="gf-enable-card" id="gf-enable-card">
  <div class="gf-enable-info">
    <div class="gf-enable-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </div>
    <div class="gf-enable-text">
      <span class="gf-enable-title">Geofence</span>
      <span class="gf-enable-subtitle">FENCE_ENABLE — When breached, the selected action triggers on the FC.</span>
    </div>
  </div>
  <div class="gf-toggle-wrap">
    <span class="gf-toggle-label" id="gf-toggle-lbl">OFF</span>
    <label class="gf-toggle" title="Enable / Disable Geofence">
      <input type="checkbox" id="gf-enable-chk">
      <span class="gf-slider"></span>
    </label>
  </div>
</div>

<!-- ── Sync strip ── -->
<div class="gf-sync-strip">
  <div class="gf-sync-info">
    <span class="gf-badge gf-badge-idle" id="gf-conn-badge">Not connected</span>
    <span class="gf-sync-label">Parameters are read from and written directly to the flight controller.</span>
  </div>
  <button class="calib-btn calib-btn-secondary gf-refresh-btn" id="gf-refresh-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
      <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5"/>
      <path d="M21 10V4M21 10H15"/>
    </svg>
    Refresh from FC
  </button>
</div>

<!-- ── Parameters (disabled overlay when fence off) ── -->
<div id="gf-params-wrap" class="gf-params-wrap gf-disabled">

  <!-- Breach banner -->
  <div class="gf-breach-banner" id="gf-breach-banner">
    <svg class="gf-breach-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <div class="gf-breach-text">
      ⚠ GEOFENCE BREACH DETECTED
      <span class="gf-breach-sub" id="gf-breach-sub"></span>
    </div>
  </div>

  <!-- Live telemetry chips -->
  <div class="gf-telemetry-strip">
    <div class="gf-telem-chip" id="gf-chip-alt">
      <span class="gf-telem-chip-label">ALTITUDE</span>
      <span class="gf-telem-chip-value">--</span>
      <span class="gf-telem-chip-unit">m</span>
    </div>
    <div class="gf-telem-chip" id="gf-chip-dist">
      <span class="gf-telem-chip-label">RADIUS</span>
      <span class="gf-telem-chip-value">--</span>
      <span class="gf-telem-chip-unit">m</span>
    </div>
  </div>

  <!-- ════ Config card ════ -->
  <div class="calib-card gf-section" style="margin-top:18px;">

    <!-- Type -->
    <div class="gf-param-row" id="gf-row-type">
      <div class="gf-param-info">
        <span class="gf-param-name">FENCE_TYPE</span>
        <span class="gf-param-desc">Which boundary types are active</span>
      </div>
      <div class="gf-param-control">
        <select class="settings-input gf-select" id="gf-type-sel">${typeOpts}</select>
      </div>
    </div>

    <!-- Action -->
    <div class="gf-param-row" id="gf-row-action">
      <div class="gf-param-info">
        <span class="gf-param-name">FENCE_ACTION</span>
        <span class="gf-param-desc">Action taken when fence is breached</span>
      </div>
      <div class="gf-param-control">
        <select class="settings-input gf-select" id="gf-action-sel">${actionOpts}</select>
        <div class="gf-row-hint" id="gf-action-hint"></div>
      </div>
    </div>

    <!-- Max Altitude -->
    <div class="gf-param-row" id="gf-row-altmax">
      <div class="gf-param-info">
        <span class="gf-param-name">FENCE_ALT_MAX</span>
        <span class="gf-param-desc">Maximum altitude — fence breaches above this</span>
      </div>
      <div class="gf-param-control">
        <input type="number" class="settings-input gf-number-input" id="gf-altmax-inp"
               min="10" max="1000" step="1" value="100">
        <span class="gf-input-unit">meters &nbsp;(range 10 – 1000)</span>
      </div>
    </div>

    <!-- Radius -->
    <div class="gf-param-row" id="gf-row-radius">
      <div class="gf-param-info">
        <span class="gf-param-name">FENCE_RADIUS</span>
        <span class="gf-param-desc">Maximum horizontal distance from home</span>
      </div>
      <div class="gf-param-control">
        <input type="number" class="settings-input gf-number-input" id="gf-radius-inp"
               min="30" max="10000" step="1" value="150">
        <span class="gf-input-unit">meters &nbsp;(range 30 – 10000)</span>
      </div>
    </div>

    <!-- Margin -->
    <div class="gf-param-row" id="gf-row-margin">
      <div class="gf-param-info">
        <span class="gf-param-name">FENCE_MARGIN</span>
        <span class="gf-param-desc">Early-warning margin inside the fence boundary</span>
      </div>
      <div class="gf-param-control">
        <input type="number" class="settings-input gf-number-input" id="gf-margin-inp"
               min="1" max="10" step="0.5" value="2">
        <span class="gf-input-unit">meters &nbsp;(range 1 – 10)</span>
      </div>
    </div>

  </div><!-- /calib-card -->

  <div class="gf-note">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    The fence is enforced by the flight controller firmware — actions trigger autonomously even without GCS connection.
    Polygon fences must be uploaded separately via the Plan screen. The GCS live indicator above is a visual aid only.
  </div>

</div><!-- /gf-params-wrap -->

<!-- ── Save strip ── -->
<div class="gf-save-strip">
  <span class="gf-badge gf-badge-idle" id="gf-save-badge"></span>
  <button class="calib-btn calib-btn-primary" id="gf-save-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    Write to Flight Controller
  </button>
</div>`;
    }

    // ── Wire controls ─────────────────────────────────────────────────────────
    function wirePanel() {
        // Enable toggle
        const chk = document.getElementById('gf-enable-chk');
        chk?.addEventListener('change', () => {
            syncEnableState(chk.checked);
            markPending(document.getElementById('gf-row-enable'));
        });

        // Type select → show/hide alt / radius rows
        const typeSel = document.getElementById('gf-type-sel');
        typeSel?.addEventListener('change', () => {
            syncTypeVisibility(parseInt(typeSel.value, 10));
            markPending(document.getElementById('gf-row-type'));
        });

        // Action select → hint
        const actSel = document.getElementById('gf-action-sel');
        actSel?.addEventListener('change', () => {
            updateActionHint(parseInt(actSel.value, 10));
            markPending(document.getElementById('gf-row-action'));
        });

        // Number inputs → mark pending on change
        ['gf-altmax-inp', 'gf-radius-inp', 'gf-margin-inp'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', function () {
                const rowIds = {
                    'gf-altmax-inp': 'gf-row-altmax',
                    'gf-radius-inp': 'gf-row-radius',
                    'gf-margin-inp': 'gf-row-margin',
                };
                markPending(document.getElementById(rowIds[id]));
            });
        });

        // Refresh button
        document.getElementById('gf-refresh-btn')?.addEventListener('click', () => {
            Object.keys(state).forEach(k => { state[k] = null; });
            refreshParams();
        });

        // Save button
        document.getElementById('gf-save-btn')?.addEventListener('click', () => {
            const chkEl   = document.getElementById('gf-enable-chk');
            const typEl   = document.getElementById('gf-type-sel');
            const actEl   = document.getElementById('gf-action-sel');
            const altEl   = document.getElementById('gf-altmax-inp');
            const radEl   = document.getElementById('gf-radius-inp');
            const marEl   = document.getElementById('gf-margin-inp');

            // Validate ranges
            const altVal = parseFloat(altEl?.value);
            const radVal = parseFloat(radEl?.value);
            const marVal = parseFloat(marEl?.value);

            if (altVal < 10 || altVal > 1000)   { window.SwUtil?.toast?.('FENCE_ALT_MAX must be 10–1000 m', true); return; }
            if (radVal < 30 || radVal > 10000)  { window.SwUtil?.toast?.('FENCE_RADIUS must be 30–10000 m', true); return; }
            if (marVal < 1  || marVal > 10)     { window.SwUtil?.toast?.('FENCE_MARGIN must be 1–10 m', true); return; }

            const results = [
                setParam(PARAM.ENABLE,  chkEl?.checked ? 1 : 0),
                setParam(PARAM.TYPE,    parseInt(typEl?.value, 10)),
                setParam(PARAM.ACTION,  parseInt(actEl?.value, 10)),
                setParam(PARAM.ALT_MAX, altVal),
                setParam(PARAM.RADIUS,  radVal),
                setParam(PARAM.MARGIN,  marVal),
            ];

            if (results.every(Boolean)) {
                setBadge('gf-save-badge', 'loading', '⟳ Writing to FC…');
                document.querySelectorAll('[id^="gf-row-"]').forEach(r => r.classList.remove('gf-row-pending'));
            } else {
                setBadge('gf-save-badge', 'error', '✕ Not connected');
                window.SwUtil?.toast?.('Not connected — cannot write parameters', true);
            }
        });

        // WS listener
        wsListener = handleWsMessage;
        window.addEventListener('calibration_ws_message', wsListener);

        // Start live telemetry monitoring
        startTelemMonitor();
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-geofence');
        if (!host) { console.error('[Geofence] Host element #panel-geofence not found'); return; }

        host.innerHTML = buildPanelHTML();
        wirePanel();

        setTimeout(refreshParams, 200);
        console.log('✅ Geofence panel initialised');
    }

    window.Geofence = { init };
    console.log('✅ Geofence module loaded');

})();
