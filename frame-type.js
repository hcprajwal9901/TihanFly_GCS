/**
 * frame-type.js — TiHANFly GCS
 * Frame Type Selection Panel
 *
 * Writes FRAME_CLASS and FRAME_TYPE ArduPilot parameters via WebSocket.
 *
 * WebSocket (frontend → backend):
 *   { type: "param_set", param_id: "FRAME_CLASS", value: <number> }
 *   { type: "param_set", param_id: "FRAME_TYPE",  value: <number> }
 *
 * WebSocket (backend → frontend):
 *   { type: "param_value", param_id: "FRAME_CLASS", value: <number> }
 *   { type: "param_value", param_id: "FRAME_TYPE",  value: <number> }
 *
 * After writing, a reboot is required for the changes to take effect.
 */

(function () {
    'use strict';

    // ── ArduPilot FRAME_CLASS options ─────────────────────────────────────────
    const FRAME_CLASSES = [
        { value: 0,  label: 'Undefined',      icon: '❓' },
        { value: 1,  label: 'Quad',           icon: '🚁' },
        { value: 2,  label: 'Hexa',           icon: '🔷' },
        { value: 3,  label: 'Octa',           icon: '⭕' },
        { value: 4,  label: 'OctaQuad',       icon: '🔶' },
        { value: 5,  label: 'Y6',             icon: '✈️'  },
        { value: 6,  label: 'Heli',           icon: '🚂' },
        { value: 7,  label: 'Tri',            icon: '🔺' },
        { value: 8,  label: 'SingleCopter',   icon: '🔁' },
        { value: 9,  label: 'CoaxCopter',     icon: '🔃' },
        { value: 10, label: 'BiCopter',       icon: '✌️'  },
        { value: 12, label: 'DodecaHexa',     icon: '🔢' },
        { value: 14, label: 'Deca',           icon: '🔟' },
    ];

    // ── ArduPilot FRAME_TYPE options ──────────────────────────────────────────
    const FRAME_TYPES = [
        { value: 0,  label: 'Plus (+)' },
        { value: 1,  label: 'X' },
        { value: 2,  label: 'V' },
        { value: 3,  label: 'H' },
        { value: 4,  label: 'V-Tail' },
        { value: 5,  label: 'A-Tail' },
        { value: 10, label: 'Y6B' },
        { value: 11, label: 'Y6F (Firefly)' },
        { value: 12, label: 'BetaFlightX' },
        { value: 13, label: 'DJIX' },
        { value: 14, label: 'ClockwiseX' },
        { value: 15, label: 'I (Motor Tilt)' },
    ];

    // ── State ─────────────────────────────────────────────────────────────────
    let initialised  = false;
    let wsListener   = null;
    let pendingParam = null; // which param we're waiting to confirm

    // Current values (populated when the panel reads params from FC)
    let currentFrameClass = null;
    let currentFrameType  = null;

    // ── WebSocket helper ──────────────────────────────────────────────────────
    function send(obj) {
        if (typeof window.safeSend === 'function') window.safeSend(obj);
    }

    /**
     * Read FRAME_CLASS and FRAME_TYPE from the backend.
     *
     * Strategy (matches how the C++ backend works):
     *  1. Ask for the full in-memory cache via param_get_all — instant, no
     *     MAVLink round-trip needed.  The cache is already populated because
     *     the backend auto-runs requestAllParameters() on first drone connect.
     *  2. If the two params are found in the cache we are done.
     *  3. If NOT found (cache empty / drone not yet loaded), fall back to
     *     param_request_list which triggers a full MAVLink refresh.
     */
    function readParamsFromDrone() {
        setStatus('running', 'Reading parameters from drone cache…');

        // Step 1: query the backend's in-memory cache (no MAVLink needed)
        send({ type: 'param_get_all' });

        // Step 2: after 800 ms, if values still null, fall back to full refresh
        setTimeout(() => {
            if (currentFrameClass === null || currentFrameType === null) {
                console.log('[FrameType] Cache miss — triggering full param_request_list');
                setStatus('running', 'Cache empty — requesting full parameter load from drone…');
                send({ type: 'param_request_list' });
            }
        }, 800);
    }

    function setParam(paramId, value) {
        send({ type: 'param_set', param_id: paramId, value: parseFloat(value) });
    }

    // ── Status bar helpers ────────────────────────────────────────────────────
    function setStatus(state, text) {
        const dot = document.getElementById('ft-status-dot');
        const msg = document.getElementById('ft-status-msg');
        if (!dot || !msg) return;
        dot.className   = `ft-status-dot ft-dot-${state}`;
        msg.textContent = text;
    }

    // ── Refresh displayed "current" values ────────────────────────────────────
    function updateCurrentDisplay() {
        const fcEl = document.getElementById('ft-current-class');
        const ftEl = document.getElementById('ft-current-type');

        if (fcEl) {
            if (currentFrameClass !== null) {
                const found = FRAME_CLASSES.find(c => c.value === currentFrameClass);
                fcEl.textContent = found ? `${found.icon} ${found.label} (${currentFrameClass})` : `Unknown (${currentFrameClass})`;
            } else {
                fcEl.textContent = '— (not read)';
            }
        }

        if (ftEl) {
            if (currentFrameType !== null) {
                const found = FRAME_TYPES.find(t => t.value === currentFrameType);
                ftEl.textContent = found ? `${found.label} (${currentFrameType})` : `Unknown (${currentFrameType})`;
            } else {
                ftEl.textContent = '— (not read)';
            }
        }
    }

    // ── WebSocket response handler ────────────────────────────────────────────
    function handleWsMessage(evt) {
        const msg = evt.detail;
        if (!msg) return;

        // ── param_all: response to param_get_all (in-memory cache dump) ───────
        // This is the fastest path — no MAVLink round-trip required.
        if (msg.type === 'param_all' && Array.isArray(msg.params)) {
            let foundClass = false, foundType = false;

            msg.params.forEach(p => {
                const id  = (p.param_id || p.name || '').toUpperCase();
                const val = parseFloat(p.value);
                if (isNaN(val)) return;

                if (id === 'FRAME_CLASS') {
                    currentFrameClass = Math.round(val);
                    foundClass = true;
                    const sel = document.getElementById('ft-class-select');
                    if (sel) sel.value = currentFrameClass;
                }
                if (id === 'FRAME_TYPE') {
                    currentFrameType = Math.round(val);
                    foundType = true;
                    const sel = document.getElementById('ft-type-select');
                    if (sel) sel.value = currentFrameType;
                }
            });

            updateCurrentDisplay();

            if (foundClass || foundType) {
                setStatus('ok', `✓ Values read from drone cache — FRAME_CLASS=${currentFrameClass}, FRAME_TYPE=${currentFrameType}`);
            } else {
                // params were in the cache but not FRAME_CLASS/FRAME_TYPE — trigger MAVLink request
                console.log('[FrameType] FRAME_CLASS/TYPE not in cache, falling back to MAVLink request');
                send({ type: 'param_request_one', name: 'FRAME_CLASS' });
                setTimeout(() => send({ type: 'param_request_one', name: 'FRAME_TYPE' }), 200);
            }
            return;
        }

        // ── param_value: individual parameter update (from param_request_one or FC echo) ─
        if (msg.type === 'param_value' || msg.type === 'parameter') {
            const id  = (msg.param_id || msg.name || '').toUpperCase();
            const val = parseFloat(msg.value ?? msg.param_value ?? NaN);

            if (id === 'FRAME_CLASS' && !isNaN(val)) {
                currentFrameClass = Math.round(val);
                updateCurrentDisplay();
                const sel = document.getElementById('ft-class-select');
                if (sel) sel.value = currentFrameClass;

                if (pendingParam === 'FRAME_CLASS') {
                    pendingParam = null;
                    setStatus('ok', `✓ FRAME_CLASS set to ${currentFrameClass}. Reboot required.`);
                    window.SwUtil?.toast?.(`Frame Class written (${currentFrameClass}). Reboot to apply.`);
                } else {
                    setStatus('ok', `✓ FRAME_CLASS = ${currentFrameClass} read from drone.`);
                }
            }

            if (id === 'FRAME_TYPE' && !isNaN(val)) {
                currentFrameType = Math.round(val);
                updateCurrentDisplay();
                const sel = document.getElementById('ft-type-select');
                if (sel) sel.value = currentFrameType;

                if (pendingParam === 'FRAME_TYPE') {
                    pendingParam = null;
                    setStatus('ok', `✓ FRAME_TYPE set to ${currentFrameType}. Reboot required.`);
                    window.SwUtil?.toast?.(`Frame Type written (${currentFrameType}). Reboot to apply.`);
                } else {
                    setStatus('ok', `✓ FRAME_TYPE = ${currentFrameType} read from drone.`);
                }
            }
        }

        // ── param_set_sent: FC acknowledged the PARAM_SET ────────────────────
        if (msg.type === 'param_set_sent') {
            const id = (msg.param_id || '').toUpperCase();
            if (id === 'FRAME_CLASS' || id === 'FRAME_TYPE') {
                setStatus('running', `Waiting for FC echo of ${id}…`);
            }
        }

        // ── param_load_complete: full load finished ───────────────────────────
        if (msg.type === 'param_load_complete') {
            if (currentFrameClass === null || currentFrameType === null) {
                // Try to extract from whatever just loaded by re-querying cache
                send({ type: 'param_get_all' });
            }
        }

        // ── param_error: backend reported a problem ───────────────────────────
        if (msg.type === 'param_error') {
            setStatus('error', `✕ ${msg.message || 'Parameter error'}`);
        }
    }

    // ── Build panel HTML ──────────────────────────────────────────────────────
    function buildPanelHTML() {
        // Build FRAME_CLASS dropdown options
        let classOptions = FRAME_CLASSES.map(c =>
            `<option value="${c.value}">${c.icon} ${c.label}</option>`
        ).join('\n');

        // Build FRAME_TYPE dropdown options
        let typeOptions = FRAME_TYPES.map(t =>
            `<option value="${t.value}">${t.label}</option>`
        ).join('\n');

        return `
<div class="settings-panel-title" style="display:flex; justify-content:space-between; align-items:center;"><span>Frame Type</span><div class="drone-selector-wrap-container"></div></div>

<!-- Info banner -->
<div class="ft-info-banner">
  <div class="ft-info-icon">ℹ️</div>
  <div class="ft-info-text">
    <div class="ft-info-title">Frame Configuration</div>
    <div class="ft-info-body">
      Select the airframe class and motor layout for your vehicle.<br>
      Changes require a <strong>reboot</strong> of the flight controller to take effect.
    </div>
  </div>
</div>

<!-- Current values (read from FC) -->
<div class="ft-current-card">
  <div class="ft-current-row">
    <span class="ft-current-label">Current Frame Class</span>
    <span class="ft-current-value" id="ft-current-class">— (not read)</span>
  </div>
  <div class="ft-current-row">
    <span class="ft-current-label">Current Frame Type</span>
    <span class="ft-current-value" id="ft-current-type">— (not read)</span>
  </div>
  <button class="ft-read-btn" id="ft-read-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5M21 10V4M21 10H15" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Read from Drone
  </button>
</div>

<!-- Selection area -->
<div class="ft-selectors">

  <!-- FRAME_CLASS -->
  <div class="ft-selector-card">
    <div class="ft-selector-header">
      <div class="ft-selector-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <div class="ft-selector-title">Frame Class</div>
        <div class="ft-selector-param">FRAME_CLASS</div>
      </div>
    </div>
    <select class="ft-select" id="ft-class-select">
      ${classOptions}
    </select>
    <div class="ft-select-desc" id="ft-class-desc">Select the physical airframe configuration</div>
    <button class="ft-write-btn" id="ft-write-class">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Write FRAME_CLASS
    </button>
  </div>

  <!-- FRAME_TYPE -->
  <div class="ft-selector-card">
    <div class="ft-selector-header">
      <div class="ft-selector-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
        </svg>
      </div>
      <div>
        <div class="ft-selector-title">Frame Type</div>
        <div class="ft-selector-param">FRAME_TYPE</div>
      </div>
    </div>
    <select class="ft-select" id="ft-type-select">
      ${typeOptions}
    </select>
    <div class="ft-select-desc" id="ft-type-desc">Select the motor arm layout geometry</div>
    <button class="ft-write-btn ft-write-btn-type" id="ft-write-type">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Write FRAME_TYPE
    </button>
  </div>

</div>

<!-- Write Both row -->
<div class="ft-write-both-row">
  <button class="ft-write-both-btn" id="ft-write-both">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    Write Both Parameters
  </button>
</div>

<!-- Reboot notice -->
<div class="ft-reboot-notice">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
    <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  Reboot the flight controller after writing parameters for changes to take effect.
</div>

<!-- Status strip -->
<div class="ft-status-strip">
  <div class="ft-status-dot ft-dot-idle" id="ft-status-dot"></div>
  <div class="ft-status-text" id="ft-status-msg">Select frame class and type, then click Write.</div>
</div>`;
    }

    // ── Class descriptions ────────────────────────────────────────────────────
    const CLASS_DESCRIPTIONS = {
        0:  'No frame class defined — configure before arming.',
        1:  'Quadcopter — 4 motors in a square/X/plus layout.',
        2:  'Hexacopter — 6 motors for increased redundancy.',
        3:  'Octacopter — 8 motors, maximum redundancy.',
        4:  'OctaQuad — 8 motors in a quad-redundant layout.',
        5:  'Y6 — Tri-copter with coaxial motor pairs.',
        6:  'Traditional Helicopter — single main rotor + tail rotor.',
        7:  'Tricopter — 3 motors, rear motor on a tilt servo.',
        8:  'SingleCopter — single motor + 4 control vanes.',
        9:  'CoaxCopter — two coaxial counter-rotating motors.',
        10: 'BiCopter — two motors on tilt servos.',
        12: 'DodecaHexa — 12 motors in a hexagonal layout.',
        14: 'Deca — 10 motors.',
    };

    const TYPE_DESCRIPTIONS = {
        0:  'Plus (+) layout — front/back/left/right arms aligned with compass.',
        1:  'X layout — arms at 45° from compass headings (most common).',
        2:  'V layout — V-tail or inverted V motor placement.',
        3:  'H layout — motors on a rectangular frame.',
        4:  'V-Tail — two rear motors angled in a V shape.',
        5:  'A-Tail — two rear motors angled outward.',
        10: 'Y6B — bottom motors point forward.',
        11: 'Y6F (Firefly) — Y6 Firefly configuration.',
        12: 'BetaFlight X — BF-style X layout.',
        13: 'DJI X — DJI-style X motor numbering.',
        14: 'Clockwise X — X layout with clockwise front-right motor.',
        15: 'I (Motor Tilt) — motors on a straight line.',
    };

    // ── Wire controls ─────────────────────────────────────────────────────────
    function wirePanel() {
        // Read button
        document.getElementById('ft-read-btn')?.addEventListener('click', () => {
            readParamsFromDrone();
        });

        // Class selector change → update description
        const classSel = document.getElementById('ft-class-select');
        const classDesc = document.getElementById('ft-class-desc');
        if (classSel) {
            classSel.addEventListener('change', () => {
                const v = parseInt(classSel.value, 10);
                if (classDesc) classDesc.textContent = CLASS_DESCRIPTIONS[v] || '';
            });
            // Set initial description
            if (classDesc) classDesc.textContent = CLASS_DESCRIPTIONS[parseInt(classSel.value, 10)] || '';
        }

        // Type selector change → update description
        const typeSel = document.getElementById('ft-type-select');
        const typeDesc = document.getElementById('ft-type-desc');
        if (typeSel) {
            typeSel.addEventListener('change', () => {
                const v = parseInt(typeSel.value, 10);
                if (typeDesc) typeDesc.textContent = TYPE_DESCRIPTIONS[v] || '';
            });
            if (typeDesc) typeDesc.textContent = TYPE_DESCRIPTIONS[parseInt(typeSel.value, 10)] || '';
        }

        // Write FRAME_CLASS
        document.getElementById('ft-write-class')?.addEventListener('click', () => {
            const val = parseInt(document.getElementById('ft-class-select').value, 10);
            const label = FRAME_CLASSES.find(c => c.value === val)?.label || val;
            setStatus('running', `Writing FRAME_CLASS = ${val} (${label})…`);
            pendingParam = 'FRAME_CLASS';
            setParam('FRAME_CLASS', val);
            // Poll for confirmation after 1.5s if no param_value received
            setTimeout(() => {
                if (pendingParam === 'FRAME_CLASS') {
                    pendingParam = null;
                    setStatus('ok', `FRAME_CLASS = ${val} sent. Reboot to apply.`);
                }
            }, 1500);
        });

        // Write FRAME_TYPE
        document.getElementById('ft-write-type')?.addEventListener('click', () => {
            const val = parseInt(document.getElementById('ft-type-select').value, 10);
            const label = FRAME_TYPES.find(t => t.value === val)?.label || val;
            setStatus('running', `Writing FRAME_TYPE = ${val} (${label})…`);
            pendingParam = 'FRAME_TYPE';
            setParam('FRAME_TYPE', val);
            setTimeout(() => {
                if (pendingParam === 'FRAME_TYPE') {
                    pendingParam = null;
                    setStatus('ok', `FRAME_TYPE = ${val} sent. Reboot to apply.`);
                }
            }, 1500);
        });

        // Write Both
        document.getElementById('ft-write-both')?.addEventListener('click', () => {
            const classVal = parseInt(document.getElementById('ft-class-select').value, 10);
            const typeVal  = parseInt(document.getElementById('ft-type-select').value, 10);
            const classLabel = FRAME_CLASSES.find(c => c.value === classVal)?.label || classVal;
            const typeLabel  = FRAME_TYPES.find(t => t.value === typeVal)?.label || typeVal;

            setStatus('running', `Writing FRAME_CLASS=${classVal} (${classLabel}), FRAME_TYPE=${typeVal} (${typeLabel})…`);
            setParam('FRAME_CLASS', classVal);

            // Stagger the second write by 300ms to avoid flooding
            setTimeout(() => {
                setParam('FRAME_TYPE', typeVal);
                setTimeout(() => {
                    setStatus('ok', `✓ Both parameters written. Reboot required.`);
                    window.SwUtil?.toast?.(`Frame Class + Type written. Reboot to apply.`);
                }, 1200);
            }, 300);
        });

        // Listen for param_value responses
        wsListener = handleWsMessage;
        window.addEventListener('calibration_ws_message', wsListener);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-frame-type');
        if (!host) {
            console.error('[FrameType] Host element #panel-frame-type not found');
            return;
        }

        host.innerHTML = buildPanelHTML();
        wirePanel();
        console.log('✅ FrameType panel initialised');
    }

    window.FrameType = { init };
    console.log('✅ FrameType module loaded');

})();
