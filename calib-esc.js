/**
 * calib-esc.js
 * TiHANFly GCS — ESC Calibration Panel
 * QGroundControl method (COMMAND_LONG + RC_CHANNELS_OVERRIDE)
 */
(function () {
    'use strict';

    // ── ESC protocol label map (matches MOT_PWM_TYPE values) ──────────────
    const ESC_TYPES = [
        { label: 'Normal',      value: 0 },
        { label: 'Oneshot125',  value: 1 },
        { label: 'Oneshot42',   value: 2 },
        { label: 'Multishot',   value: 3 },
        { label: 'DShot150',    value: 4 },
        { label: 'DShot300',    value: 5 },
        { label: 'DShot600',    value: 6 },
    ];

    // ── Stage → human-readable label ──────────────────────────────────────
    const STAGE_LABELS = {
        preflight:    '① Writing Calibration Flag',
        accepted:     '① FC Acknowledged',
        timeout:      '① No ACK — Proceeding',
        retrying:     '① Retrying…',
        power_cycle:  '② Power Cycle Required',
        cancelled:    'Cancelled',
        error:        'Error',
        busy:         'Already Running',
    };

    // ── Steps shown in the status stepper (2-step, no power cycle) ────────
    const STEPS = [
        { key: 'preflight',  label: 'Write Cal Flag' },
        { key: 'safety_btn', label: 'Press Safety Button' },
    ];

    // ── Stage → stepper step key mapping ──────────────────────────────────
    const STAGE_TO_STEP = {
        preflight:   'preflight',
        accepted:    'preflight',
        timeout:     'preflight',
        retrying:    'preflight',
        power_cycle: 'safety_btn',   // advance straight to next visible step
        cancelled:   null,
        error:       null,
        busy:        null,
    };

    // ── State ──────────────────────────────────────────────────────────────
    let currentStage = null;
    let isBusy       = false;
    let wsHooked     = false;

    // ── Sysid resolver ────────────────────────────────────────────────────
    // Returns the sysid of the currently selected drone.
    //
    // Resolution order (first match wins):
    //  1. window.getActiveSysid()   — explicit helper if defined by app shell
    //  2. window.activeSysid        — simple global variable if set
    //  3. Last sysid seen in a backend "status" broadcast (auto-populated)
    //  4. 1  — ArduPilot factory default; safe for single-drone setups
    let _cachedSysid = -1;

    function _onStatusMessage(data) {
        if (Array.isArray(data.vehicles) && data.vehicles.length > 0) {
            const first = data.vehicles[0].sysid;
            if (typeof first === 'number' && first > 0)
                _cachedSysid = first;
        }
    }

    function _getActiveSysid() {
        if (typeof window.getActiveSysid === 'function') {
            const v = window.getActiveSysid();
            if (v > 0) return v;
        }
        if (typeof window.activeSysid === 'number' && window.activeSysid > 0)
            return window.activeSysid;
        if (_cachedSysid > 0)
            return _cachedSysid;
        return 1;   // ArduPilot default — safe fallback for single-drone
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Render
    // ═══════════════════════════════════════════════════════════════════════
    function render() {
        const escOptions = ESC_TYPES
            .map(e => `<option value="${e.value}">${e.label}</option>`)
            .join('');

        const stepDots = STEPS.map(s =>
            `<div class="mp-step-dot" id="step-${s.key}" title="${s.label}">
               <span class="mp-step-dot-inner"></span>
               <span class="mp-step-label">${s.label}</span>
             </div>`
        ).join('<div class="mp-step-line"></div>');

        return `
<div class="mp-esc-panel">

  <!-- Title bar -->
  <div class="mp-esc-title">
    <span class="mp-esc-title-text">ESC Calibration</span>
    <span class="mp-esc-title-badge">AC 4.0+</span>
  </div>

  <!-- Top: buttons + instructions -->
  <div class="mp-esc-top">
    <div class="mp-esc-top-left">
      <button class="mp-btn-calibrate" id="escCalibrateBtn">
        <span class="btn-icon">⚡</span>
        Calibrate ESCs
      </button>
      <button class="mp-btn-cancel" id="escCancelBtn" style="display:none;">
        <span class="btn-icon">✕</span>
        Cancel
      </button>
    </div>

    <!-- Instructions -->
    <div class="mp-esc-instructions">
      <span class="warning-tag">⚠ Remove Props Before Starting</span>
      <ol>
        <li><strong>Remove all propellers</strong> before continuing</li>
        <li>Click <strong>Calibrate ESCs</strong> — GCS writes the calibration flag to the FC</li>
        <li><strong>Disconnect</strong> the drone battery</li>
        <li><strong>Reconnect</strong> the battery</li>
        <li>Press and hold the <strong>safety button for ≥2 seconds</strong></li>
        <li>ESCs will beep max throttle → then min throttle → FC reboots automatically</li>
      </ol>
    </div>
  </div>

  <!-- Progress stepper -->
  <div class="mp-step-track" id="escStepTrack" style="display:none;">
    ${stepDots}
  </div>

  <div class="mp-esc-divider"></div>

  <!-- Section label -->
  <div class="mp-section-header">
    <span class="mp-section-header-text">Motor Output Parameters</span>
  </div>

  <!-- Form fields -->
  <div class="mp-esc-form">

    <div class="mp-field-row">
      <label class="mp-field-label">ESC Protocol</label>
      <div class="mp-field-control">
        <select class="mp-select" id="escType">${escOptions}</select>
      </div>
      <span class="mp-field-hint"></span>
    </div>

    <div class="mp-field-row">
      <label class="mp-field-label">PWM Out Min</label>
      <div class="mp-field-control">
        <input type="number" class="mp-spinbox" id="pwmMin"
               value="0" min="0" max="2000" step="1">
      </div>
      <span class="mp-field-hint">// 0 → use RX input range</span>
    </div>

    <div class="mp-field-row">
      <label class="mp-field-label">PWM Out Max</label>
      <div class="mp-field-control">
        <input type="number" class="mp-spinbox" id="pwmMax"
               value="0" min="0" max="2000" step="1">
      </div>
      <span class="mp-field-hint">// 0 → use RX input range</span>
    </div>

    <div class="mp-field-row">
      <label class="mp-field-label">Spin When Armed</label>
      <div class="mp-field-control">
        <input type="number" class="mp-spinbox" id="spinArmed"
               value="0.100" min="0" max="1" step="0.001">
      </div>
      <span class="mp-field-hint">// speed at zero throttle while armed</span>
    </div>

    <div class="mp-field-row">
      <label class="mp-field-label">Spin Minimum</label>
      <div class="mp-field-control">
        <input type="number" class="mp-spinbox" id="spinMin"
               value="0.150" min="0" max="1" step="0.001">
      </div>
      <span class="mp-field-hint">// min in-flight RPM (> spin when armed)</span>
    </div>

    <div class="mp-field-row">
      <label class="mp-field-label">Spin Maximum</label>
      <div class="mp-field-control">
        <input type="number" class="mp-spinbox" id="spinMax"
               value="0.950" min="0" max="1" step="0.001">
      </div>
      <span class="mp-field-hint">// max in-flight RPM</span>
    </div>

  </div>

  <!-- Status bar -->
  <div class="mp-status-bar" id="escStatusBar">
    <span class="mp-status-dot"></span>
    <span class="mp-status-msg" id="escStatusMsg">Ready</span>
    <span class="mp-status-brand">TiHANFly GCS</span>
  </div>

</div>`;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Status helpers
    // ═══════════════════════════════════════════════════════════════════════

    function setStatus(msg, busy) {
        const bar = document.getElementById('escStatusBar');
        const txt = document.getElementById('escStatusMsg');
        if (txt) txt.textContent = msg;
        if (bar) {
            bar.classList.toggle('busy',   busy);
            bar.classList.toggle('failed',
                currentStage === 'failed' || currentStage === 'error');
        }
        isBusy = busy;
    }

    function updateStepper(stage) {
        const track = document.getElementById('escStepTrack');
        if (!track) return;

        const activeKey = STAGE_TO_STEP[stage] || null;
        const STEP_KEYS  = STEPS.map(s => s.key);
        const activeIdx  = activeKey ? STEP_KEYS.indexOf(activeKey) : -1;

        STEPS.forEach((step, idx) => {
            const dot = document.getElementById('step-' + step.key);
            if (!dot) return;
            dot.classList.remove('active', 'done', 'failed');

            if (stage === 'failed' || stage === 'error') {
                if (idx < activeIdx)  dot.classList.add('done');
                if (idx === activeIdx) dot.classList.add('failed');
            } else {
                if (idx < activeIdx)  dot.classList.add('done');
                if (idx === activeIdx) dot.classList.add('active');
            }
        });

        const terminalStage = (stage === 'done'      ||
                                stage === 'cancelled' ||
                                stage === 'error'     ||
                                stage === 'failed');

        if (!terminalStage) {
            track.style.display = 'flex';
        } else if (stage === 'done') {
            track.style.display = 'flex';
        } else {
            track.style.display = 'none';
        }
    }

    function setButtonState(calibrating) {
        const calibBtn  = document.getElementById('escCalibrateBtn');
        const cancelBtn = document.getElementById('escCancelBtn');
        if (!calibBtn) return;

        if (calibrating) {
            calibBtn.innerHTML = `<span class="btn-icon">⏳</span>Calibrating…`;
            calibBtn.disabled  = true;
            calibBtn.style.display = 'inline-flex';
            if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        } else {
            calibBtn.innerHTML = `<span class="btn-icon">⚡</span>Calibrate ESCs`;
            calibBtn.disabled  = false;
            calibBtn.style.display = 'inline-flex';
            if (cancelBtn) cancelBtn.style.display = 'none';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Handle inbound backend status message
    // ═══════════════════════════════════════════════════════════════════════

    function handleBackendStatus(data) {
        const stage   = data.stage   || 'error';
        const message = data.message || '';
        const busy    = !!data.busy;

        currentStage = stage;

        const label = STAGE_LABELS[stage] || stage;
        setStatus(`${label} — ${message}`, busy);
        updateStepper(stage);
        setButtonState(busy);

        const isTerminal = (stage === 'done'      || stage === 'cancelled' ||
                            stage === 'error'     || stage === 'failed'    ||
                            stage === 'busy');
        if (isTerminal) setButtonState(false);

        // Toast notifications
        if (window.SwUtil?.toast) {
            if (stage === 'power_cycle')
                window.SwUtil.toast('✓ Flag written — disconnect battery, reconnect, then press safety button');
            if (stage === 'error')
                window.SwUtil.toast('ESC calibration error: ' + message);
            if (stage === 'cancelled')
                window.SwUtil.toast('ESC calibration cancelled');
        }

        console.log('[CalibESC] Stage:', stage, '|', message);
    }

    // ── WebSocket resolver — tries all common global socket names ──────────
    function getWs() {
        return window.gcsSocket  ||
               window.socket     ||
               window.ws         ||
               window.mavSocket  ||
               null;
    }

    // ── Hook the WebSocket onmessage (chains onto any existing handler) ────
    function hookWs(ws) {
        if (!ws || wsHooked) return;

        const prev = ws.onmessage || null;

        ws.onmessage = function (event) {
            if (prev) prev.call(this, event);
            try {
                const msg = JSON.parse(event.data);
                if (!msg) return;
                if (msg.type === 'status')
                    _onStatusMessage(msg);
                if (msg.type === 'esc_calibration_status')
                    handleBackendStatus(msg);
            } catch (_) {
                // non-JSON frame — ignore
            }
        };

        wsHooked = true;
        console.log('[CalibESC] WebSocket onmessage hooked successfully');
    }

    function tryHookWs() {
        const ws = getWs();
        if (ws) { hookWs(ws); return; }

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const ws2 = getWs();
            if (ws2) {
                hookWs(ws2);
                clearInterval(timer);
            } else if (attempts >= 60) {
                clearInterval(timer);
                console.warn('[CalibESC] Could not find WebSocket after 30 s. ' +
                    'Call CalibESC.handleStatus(msg) manually from your WS dispatcher.');
            }
        }, 500);
    }

    // ── WebSocket send helper ──────────────────────────────────────────────
    function wsSend(obj) {
        const ws = getWs();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('[CalibESC] WebSocket not open — cannot send', obj);
            setStatus('Error — WebSocket not connected', false);
            setButtonState(false);
            return false;
        }
        ws.send(JSON.stringify(obj));
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Init — mount panel and attach button listeners
    // ═══════════════════════════════════════════════════════════════════════

    function init() {
        const host = document.getElementById('panel-calib-esc');
        if (!host) return;

        // Avoid double-rendering
        if (host.querySelector('.mp-esc-panel')) return;

        host.innerHTML = render();

        // ── Calibrate button ───────────────────────────────────────────────
        document.getElementById('escCalibrateBtn')?.addEventListener('click', () => {
            const sysid = _getActiveSysid();
            if (!wsSend({ type: 'start_esc_calibration', sysid })) return;

            setButtonState(true);
            setStatus('Starting ESC calibration sequence…', true);
            document.getElementById('escStepTrack').style.display = 'flex';

            if (window.SwUtil?.toast)
                window.SwUtil.toast('ESC calibration initiated — remove props and follow the steps');
        });

        // ── Cancel button ──────────────────────────────────────────────────
        document.getElementById('escCancelBtn')?.addEventListener('click', () => {
            const sysid = _getActiveSysid();
            wsSend({ type: 'cancel_esc_calibration', sysid });

            if (window.SwUtil?.toast)
                window.SwUtil.toast('ESC calibration cancel sent…');
        });
    }

    // ── Auto-init on DOMContentLoaded + re-init when panel becomes visible ─
    function autoInit() {
        init();

        const host = document.getElementById('panel-calib-esc');
        if (host && typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver(() => {
                if (host.offsetParent !== null) init();
            });
            observer.observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
            if (host.parentElement) {
                observer.observe(host.parentElement,
                    { attributes: true, attributeFilter: ['style', 'class'] });
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

    tryHookWs();

    // ── Public API ─────────────────────────────────────────────────────────
    window.CalibESC = {
        init,
        handleStatus: handleBackendStatus,
    };

    console.log('✅ CalibESC module ready (live WebSocket mode)');
})();