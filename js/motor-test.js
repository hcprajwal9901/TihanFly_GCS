/**
 * motor-test.js — TiHANFly GCS
 * Motor Test Panel — QGC-style
 *
 * Sends MAV_CMD_DO_MOTOR_TEST (209) via WebSocket to the backend.
 *
 * WebSocket (frontend → backend):
 *   {
 *     type:         "motor_test",
 *     motor_index:  1,           // 1-based motor number; 0 = all
 *     throttle_pct: 15,          // 0–100
 *     duration_sec: 2,           // seconds the motor should spin
 *   }
 *
 * WebSocket (backend → frontend) via calibration_ws_message:
 *   { type: "motor_test_ack", motor_index: 1, status: "ok"|"error", message: "…" }
 *
 * Safety: user must click "I Understand – Propellers Removed" before controls
 *         are enabled.  This UI-level lock is backed by the autopilot itself
 *         which will reject MAV_CMD_DO_MOTOR_TEST while armed.
 */

(function () {
    'use strict';

    // ── Constants ─────────────────────────────────────────────────────────────
    const NUM_MOTORS      = 8;
    const DEFAULT_THROTTLE = 15;   // %
    const DEFAULT_DURATION = 2;    // seconds

    // ── State ─────────────────────────────────────────────────────────────────
    let safetyAcknowledged = false;
    let initialised        = false;
    let wsListener         = null;
    let runningMotor       = null;   // null | motor index (1-based) | 'all'
    let stopTimer          = null;
    let currentFrameClass  = 1;      // Default to Quad
    let currentFrameType   = 1;      // Default to X

    const FRAME_CONFIGS = {
        // Quadcopter (Class 1)
        '1_1': { // Quad X
            name: 'Quad X',
            motors: {
                1: { seq: 1, letter: 'A', dir: 'CCW', label: 'FR' },
                2: { seq: 3, letter: 'C', dir: 'CCW', label: 'BL' },
                3: { seq: 4, letter: 'D', dir: 'CW',  label: 'FL' },
                4: { seq: 2, letter: 'B', dir: 'CW',  label: 'BR' }
            }
        },
        '1_0': { // Quad Plus
            name: 'Quad Plus',
            motors: {
                1: { seq: 1, letter: 'A', dir: 'CCW', label: 'F' },
                2: { seq: 4, letter: 'D', dir: 'CCW', label: 'L' },
                3: { seq: 3, letter: 'C', dir: 'CW',  label: 'B' },
                4: { seq: 2, letter: 'B', dir: 'CW',  label: 'R' }
            }
        },
        // Hexacopter (Class 2)
        '2_1': { // Hexa X
            name: 'Hexa X',
            motors: {
                1: { seq: 1, letter: 'A', dir: 'CCW', label: 'FR' },
                2: { seq: 4, letter: 'D', dir: 'CCW', label: 'BL' },
                3: { seq: 6, letter: 'F', dir: 'CW',  label: 'FL' },
                4: { seq: 3, letter: 'C', dir: 'CW',  label: 'BR' },
                5: { seq: 2, letter: 'B', dir: 'CCW', label: 'R' },
                6: { seq: 5, letter: 'E', dir: 'CW',  label: 'L' }
            }
        },
        '2_0': { // Hexa Plus
            name: 'Hexa Plus',
            motors: {
                1: { seq: 1, letter: 'A', dir: 'CCW', label: 'F' },
                2: { seq: 4, letter: 'D', dir: 'CCW', label: 'B' },
                3: { seq: 6, letter: 'F', dir: 'CW',  label: 'FL' },
                4: { seq: 3, letter: 'C', dir: 'CW',  label: 'BR' },
                5: { seq: 2, letter: 'B', dir: 'CCW', label: 'FR' },
                6: { seq: 5, letter: 'E', dir: 'CW',  label: 'BL' }
            }
        },
        // Octacopter (Class 3)
        '3_1': { // Octa X
            name: 'Octa X',
            motors: {
                1: { seq: 1, letter: 'A', dir: 'CCW', label: 'FR' },
                2: { seq: 5, letter: 'E', dir: 'CCW', label: 'BL' },
                3: { seq: 8, letter: 'H', dir: 'CW',  label: 'FL' },
                4: { seq: 4, letter: 'D', dir: 'CW',  label: 'BR' },
                5: { seq: 2, letter: 'B', dir: 'CW',  label: 'RFR' },
                6: { seq: 6, letter: 'F', dir: 'CW',  label: 'LBL' },
                7: { seq: 7, letter: 'G', dir: 'CCW', label: 'LFL' },
                8: { seq: 3, letter: 'C', dir: 'CCW', label: 'RBR' }
            }
        },
        // OctaQuad (Class 4)
        '4_1': { // OctaQuad X
            name: 'OctaQuad X',
            motors: {
                1: { seq: 1, letter: 'A', dir: 'CCW', label: 'FR Top' },
                2: { seq: 8, letter: 'H', dir: 'CCW', label: 'FL Bot' },
                3: { seq: 7, letter: 'G', dir: 'CW',  label: 'FL Top' },
                4: { seq: 6, letter: 'F', dir: 'CW',  label: 'BL Bot' },
                5: { seq: 5, letter: 'E', dir: 'CCW', label: 'BL Top' },
                6: { seq: 4, letter: 'D', dir: 'CCW', label: 'BR Bot' },
                7: { seq: 3, letter: 'C', dir: 'CW',  label: 'BR Top' },
                8: { seq: 2, letter: 'B', dir: 'CW',  label: 'FR Bot' }
            }
        },
        // Y6 (Class 5)
        '5_10': { // Y6B
            name: 'Y6B',
            motors: {
                1: { seq: 4, letter: 'D', dir: 'CW',  label: 'FR Bot' },
                2: { seq: 1, letter: 'A', dir: 'CCW', label: 'FR Top' },
                3: { seq: 5, letter: 'E', dir: 'CW',  label: 'B Bot' },
                4: { seq: 2, letter: 'B', dir: 'CCW', label: 'B Top' },
                5: { seq: 6, letter: 'F', dir: 'CW',  label: 'FL Bot' },
                6: { seq: 3, letter: 'C', dir: 'CCW', label: 'FL Top' }
            }
        }
    };


    // ── Helpers ───────────────────────────────────────────────────────────────
    function send(obj) {
        if (typeof window.safeSend === 'function') window.safeSend(obj);
    }

    function getThrottle() {
        return parseInt(document.getElementById('mt-throttle')?.value ?? DEFAULT_THROTTLE, 10);
    }

    function getDuration() {
        return parseFloat(document.getElementById('mt-duration')?.value ?? DEFAULT_DURATION);
    }

    // ── Send a motor test command ──────────────────────────────────────────────
    // motor_index: 1-8 for individual, 0 = all motors sequentially
    function sendMotorTest(motorIndex) {
        if (!safetyAcknowledged) return;

        const throttle = getThrottle();
        const duration = getDuration();

        let targetIndex = motorIndex;
        let motorCount = 0;
        let numMotors = 4; // default

        if (currentFrameClass === 2 || currentFrameClass === 5) { // Hexa, Y6
            numMotors = 6;
        } else if (currentFrameClass === 3 || currentFrameClass === 4) { // Octa, OctaQuad
            numMotors = 8;
        }

        if (motorIndex === 0) {
            targetIndex = 1; // Start at motor A (1)
            motorCount = numMotors; // Test all motors sequentially
        } else {
            const configKey = `${currentFrameClass}_${currentFrameType}`;
            let config = FRAME_CONFIGS[configKey];
            // Fallbacks
            if (!config && currentFrameClass === 1) config = FRAME_CONFIGS['1_1'];
            if (!config && currentFrameClass === 2) config = FRAME_CONFIGS['2_1'];

            const motorInfo = config?.motors?.[motorIndex];
            if (motorInfo) {
                targetIndex = motorInfo.seq;
            }
        }

        send({
            type:         'motor_test',
            motor_index:  targetIndex,
            throttle_pct: throttle,
            duration_sec: duration,
            test_order:   0, // Use default sequence order (0) as we map physical indexes to sequence indexes on the GCS
            motor_count:  motorCount
        });

        setStatus('running', `▶ Motor ${motorIndex === 0 ? 'All' : motorIndex} testing at ${throttle}% for ${duration}s…`);
        markRunning(motorIndex);

        const totalDuration = motorIndex === 0 ? ((duration + 0.5) * numMotors) : duration;
        scheduleAutoStop(totalDuration);
    }

    // ── Send stop command (throttle 0%) ───────────────────────────────────────
    function sendStop() {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }

        // Send 0% throttle to all motors to signal stop
        send({
            type:         'motor_test',
            motor_index:  0,
            throttle_pct: 0,
            duration_sec: 0,
        });

        clearRunning();
        setStatus('idle', 'Stopped.');
    }

    // ── Auto-stop after duration ───────────────────────────────────────────────
    function scheduleAutoStop(duration) {
        if (stopTimer) clearTimeout(stopTimer);
        stopTimer = setTimeout(() => {
            clearRunning();
            setStatus('ok', '✓ Test complete.');
        }, (duration + 0.4) * 1000);   // small buffer
    }

    // ── Running state UI ──────────────────────────────────────────────────────
    function markRunning(motorIndex) {
        runningMotor = motorIndex;
        document.querySelectorAll('.mt-motor-btn').forEach(btn => {
            btn.classList.remove('mt-running');
            const idx = parseInt(btn.dataset.motor, 10);
            if (motorIndex === 0 || idx === motorIndex) btn.classList.add('mt-running');
        });
    }

    function clearRunning() {
        runningMotor = null;
        document.querySelectorAll('.mt-motor-btn').forEach(btn => btn.classList.remove('mt-running'));
    }

    // ── Status strip ──────────────────────────────────────────────────────────
    function setStatus(state, text) {
        const dot  = document.getElementById('mt-status-dot');
        const msg  = document.getElementById('mt-status-msg');
        if (!dot || !msg) return;

        dot.className = `mt-status-dot mt-dot-${state}`;
        msg.textContent = text;
    }

    // ── Safety acknowledge ────────────────────────────────────────────────────
    function acknowledge() {
        safetyAcknowledged = true;

        const lock = document.getElementById('mt-lock');
        if (lock) lock.style.display = 'none';

        // Unlock all locked sections
        document.querySelectorAll('.mt-locked').forEach(el => {
            el.classList.remove('mt-locked');
        });

        setStatus('idle', 'Ready — select a motor or test all.');
    }

    // ── Update slider fill track ───────────────────────────────────────────────
    function updateSliderFill() {
        const slider = document.getElementById('mt-throttle');
        const valEl  = document.getElementById('mt-throttle-val');
        if (!slider) return;

        const pct = slider.value;
        slider.style.setProperty('--slider-pct', pct + '%');
        if (valEl) valEl.textContent = pct + '%';
    }

    // ── WebSocket response handler ────────────────────────────────────────────
    function handleWsMessage(evt) {
        const msg = evt.detail;
        if (!msg) return;

        if (msg.type === 'motor_test_ack') {
            if (msg.status === 'error') {
                clearRunning();
                if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
                setStatus('error', '✕ ' + (msg.message || 'Motor test rejected by FC'));
                window.SwUtil?.toast?.('Motor test: ' + (msg.message || 'rejected'), true);
            }
        } else if (msg.type === 'param_all' && Array.isArray(msg.params)) {
            msg.params.forEach(p => {
                const id  = (p.param_id || p.name || '').toUpperCase();
                const val = parseFloat(p.value);
                if (isNaN(val)) return;

                if (id === 'FRAME_CLASS') {
                    currentFrameClass = Math.round(val);
                    applyFrameMapping();
                } else if (id === 'FRAME_TYPE') {
                    currentFrameType = Math.round(val);
                    applyFrameMapping();
                } else if (id === 'MOT_SPIN_ARM') {
                    updateSpinLabel('arm', val);
                } else if (id === 'MOT_SPIN_MIN') {
                    updateSpinLabel('min', val);
                }
            });
        } else if (msg.type === 'param_load_complete') {
            send({ type: 'param_get_all' });
        } else if (msg.type === 'param_value' || msg.type === 'parameter') {
            const id = (msg.param_id || msg.name || '').toUpperCase();
            const val = parseFloat(msg.value ?? msg.param_value ?? NaN);
            if (isNaN(val)) return;

            if (id === 'FRAME_CLASS') {
                currentFrameClass = Math.round(val);
                applyFrameMapping();
            } else if (id === 'FRAME_TYPE') {
                currentFrameType = Math.round(val);
                applyFrameMapping();
            } else if (id === 'MOT_SPIN_ARM') {
                updateSpinLabel('arm', val);
            } else if (id === 'MOT_SPIN_MIN') {
                updateSpinLabel('min', val);
            }
        }
    }

    // ── Apply Frame Mapping ──────────────────────────────────────────────────
    function applyFrameMapping() {
        const configKey = `${currentFrameClass}_${currentFrameType}`;
        let config = FRAME_CONFIGS[configKey];
        // Fallbacks
        if (!config && currentFrameClass === 1) config = FRAME_CONFIGS['1_1'];
        if (!config && currentFrameClass === 2) config = FRAME_CONFIGS['2_1'];

        const classNameDisplay = document.getElementById('mt-frame-class-type');
        if (classNameDisplay) {
            if (config) {
                classNameDisplay.textContent = `(${config.name})`;
            } else {
                classNameDisplay.textContent = `(Class: ${currentFrameClass}, Type: ${currentFrameType})`;
            }
        }

        for (let m = 1; m <= NUM_MOTORS; m++) {
            const btn = document.getElementById(`mt-motor-${m}`);
            if (!btn) continue;

            const motorInfo = config?.motors?.[m];
            if (motorInfo) {
                btn.style.display = 'flex';
                btn.innerHTML = `
                    <span class="mt-motor-num">${m}</span>
                    <span class="mt-motor-label">Motor ${motorInfo.letter}</span>
                    <span class="mt-motor-desc" style="font-size: 9px; opacity: 0.6; margin-top: 2px;">${motorInfo.label} (${motorInfo.dir})</span>
                `;
                btn.title = `Test Motor ${m} (Motor ${motorInfo.letter} — ${motorInfo.label} ${motorInfo.dir})`;
            } else {
                if (config) {
                    btn.style.display = 'none'; // hide unused motors for this frame class
                } else {
                    btn.style.display = 'flex';
                    btn.innerHTML = `
                        <span class="mt-motor-num">${m}</span>
                        <span class="mt-motor-label">Motor</span>
                    `;
                    btn.title = `Test Motor ${m}`;
                }
            }
        }
    }

    // ── Update spin label display ─────────────────────────────────────────────
    function updateSpinLabel(type, val) {
        const pct = Math.round(val * 100);
        const input = document.getElementById(`mt-input-spin-${type}`);
        if (input) {
            input.value = pct;
        }
    }

    // ── Read parameters from drone cache and FC ──────────────────────────────
    function readParamsFromDrone() {
        send({ type: 'param_get_all' });
        send({ type: 'param_request_one', name: 'FRAME_CLASS' });
        setTimeout(() => send({ type: 'param_request_one', name: 'FRAME_TYPE' }), 100);
        setTimeout(() => send({ type: 'param_request_one', name: 'MOT_SPIN_ARM' }), 200);
        setTimeout(() => send({ type: 'param_request_one', name: 'MOT_SPIN_MIN' }), 300);
    }

    // ── Build panel HTML ──────────────────────────────────────────────────────
    function buildPanelHTML() {
        let motorBtns = '';
        for (let m = 1; m <= NUM_MOTORS; m++) {
            motorBtns += `
<button class="mt-motor-btn" id="mt-motor-${m}" data-motor="${m}" disabled
        title="Test Motor ${m}">
  <span class="mt-motor-num">${m}</span>
  <span class="mt-motor-label">Motor</span>
</button>`;
        }

        return `
<div class="settings-panel-title" style="display:flex; justify-content:space-between; align-items:center;">
  <span>Motor Test <small id="mt-frame-class-type" style="font-size: 0.65em; opacity: 0.7; margin-left: 10px;">Detecting frame…</small></span>
  <div class="drone-selector-wrap-container"></div>
</div>

<!-- Safety warning banner -->
<div class="mt-warning-banner">
  <div class="mt-warning-icon">⚠️</div>
  <div class="mt-warning-text">
    <div class="mt-warning-title">Safety Warning</div>
    <div class="mt-warning-body">
      Remove all propellers before testing motors.<br>
      Keep hands and objects clear of rotating parts.<br>
      Motors will spin at the selected throttle percentage.
    </div>
  </div>
</div>

<!-- Safety lock overlay (shown until user acknowledges) -->
<div class="mt-lock-overlay" id="mt-lock">
  <div class="mt-lock-icon">🔒</div>
  <div class="mt-lock-msg">
    Motor testing is locked.<br>
    Confirm that propellers have been removed before proceeding.
  </div>
  <button class="mt-acknowledge-btn" id="mt-ack-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    I Understand – Propellers Removed
  </button>
</div>

<!-- Controls (throttle / duration / spin parameters) — selectively locked until acknowledged -->
<div class="mt-content" id="mt-content">
  <div class="mt-controls">
    <div class="mt-control-card mt-locked" id="mt-throttle-card">
      <div class="mt-control-label">Throttle</div>
      <div class="mt-slider-row">
        <input type="range" class="mt-slider" id="mt-throttle"
               min="0" max="100" step="1" value="${DEFAULT_THROTTLE}"
               style="--slider-pct:${DEFAULT_THROTTLE}%">
        <span class="mt-slider-val" id="mt-throttle-val">${DEFAULT_THROTTLE}%</span>
      </div>
    </div>

    <div class="mt-control-card mt-locked" id="mt-duration-card">
      <div class="mt-control-label">Test Duration</div>
      <div class="mt-duration-row">
        <input type="number" class="mt-duration-input" id="mt-duration"
               min="0.5" max="30" step="0.5" value="${DEFAULT_DURATION}">
        <span class="mt-duration-unit">seconds</span>
      </div>
    </div>

    <div class="mt-control-card" id="mt-spin-settings-card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 6px;">
      <div class="mt-control-label">Spin Settings (%)</div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 11px; width: 60px; opacity: 0.9; color: var(--text-secondary, #a0aec0);">Spin Arm:</span>
        <input type="number" class="mt-duration-input" id="mt-input-spin-arm"
               min="0" max="100" step="1" placeholder="Read..." style="flex: 1; width: 50px; font-size: 11px; padding: 4px 6px; height: 26px;">
        <button class="mt-btn-action" id="mt-btn-spin-arm" style="padding: 4px 8px; font-size: 11px; height: 26px;" title="Set MOT_SPIN_ARM">
          Set
        </button>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 11px; width: 60px; opacity: 0.9; color: var(--text-secondary, #a0aec0);">Spin Min:</span>
        <input type="number" class="mt-duration-input" id="mt-input-spin-min"
               min="0" max="100" step="1" placeholder="Read..." style="flex: 1; width: 50px; font-size: 11px; padding: 4px 6px; height: 26px;">
        <button class="mt-btn-action" id="mt-btn-spin-min" style="padding: 4px 8px; font-size: 11px; height: 26px;" title="Set MOT_SPIN_MIN">
          Set
        </button>
      </div>
    </div>
  </div>

  <!-- Individual motor buttons -->
  <div class="mt-section-label mt-locked" id="mt-motors-label">Individual Motors</div>
  <div class="mt-motor-grid mt-locked" id="mt-motor-grid">
    ${motorBtns}
  </div>

  <!-- Test All / Stop buttons -->
  <div class="mt-action-row mt-locked" id="mt-action-row">
    <button class="mt-btn-all" id="mt-btn-all" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Test All Motors
    </button>
    <button class="mt-btn-stop" id="mt-btn-stop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
      </svg>
      Stop
    </button>
  </div>

  <!-- Status strip -->
  <div class="mt-status-strip">
    <div class="mt-status-dot mt-dot-idle" id="mt-status-dot"></div>
    <div class="mt-status-text" id="mt-status-msg">Acknowledge safety warning to enable testing.</div>
  </div>
</div>`;
    }

    // ── Wire controls ─────────────────────────────────────────────────────────
    function wirePanel() {
        // Safety acknowledge
        document.getElementById('mt-ack-btn')?.addEventListener('click', () => {
            acknowledge();
            // Enable individual motor buttons and Test All button
            document.querySelectorAll('.mt-motor-btn, #mt-btn-all').forEach(b => {
                b.disabled = false;
            });
        });

        // Throttle slider
        document.getElementById('mt-throttle')?.addEventListener('input', updateSliderFill);

        // Set Motor Spin Arm
        document.getElementById('mt-btn-spin-arm')?.addEventListener('click', () => {
            const input = document.getElementById('mt-input-spin-arm');
            if (!input) return;
            const pct = parseInt(input.value, 10);
            if (isNaN(pct) || pct < 0 || pct > 100) {
                window.SwUtil?.toast?.("Please enter a value between 0 and 100", true);
                return;
            }
            const val = pct / 100.0;
            send({
                type: 'param_set',
                param_id: 'MOT_SPIN_ARM',
                value: val
            });
            window.SwUtil?.toast?.(`Sent MOT_SPIN_ARM = ${val.toFixed(2)} (${pct}%)`);
            setStatus('ok', `Sent MOT_SPIN_ARM = ${val.toFixed(2)}…`);
        });

        // Set Motor Spin Min
        document.getElementById('mt-btn-spin-min')?.addEventListener('click', () => {
            const input = document.getElementById('mt-input-spin-min');
            if (!input) return;
            const pct = parseInt(input.value, 10);
            if (isNaN(pct) || pct < 0 || pct > 100) {
                window.SwUtil?.toast?.("Please enter a value between 0 and 100", true);
                return;
            }
            const val = pct / 100.0;
            send({
                type: 'param_set',
                param_id: 'MOT_SPIN_MIN',
                value: val
            });
            window.SwUtil?.toast?.(`Sent MOT_SPIN_MIN = ${val.toFixed(2)} (${pct}%)`);
            setStatus('ok', `Sent MOT_SPIN_MIN = ${val.toFixed(2)}…`);
        });

        // Individual motor buttons
        document.querySelectorAll('.mt-motor-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                if (!safetyAcknowledged) return;
                sendMotorTest(parseInt(this.dataset.motor, 10));
            });
        });

        // Test All button
        document.getElementById('mt-btn-all')?.addEventListener('click', () => {
            if (!safetyAcknowledged) return;
            sendMotorTest(0);
        });

        // Stop button
        document.getElementById('mt-btn-stop')?.addEventListener('click', sendStop);

        // Listen for WS responses
        wsListener = handleWsMessage.bind(null);
        window.addEventListener('calibration_ws_message', wsListener);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-motor-test');
        if (!host) {
            console.error('[MotorTest] Host element #panel-motor-test not found');
            return;
        }

        host.innerHTML = buildPanelHTML();
        wirePanel();

        // Request frame parameters from drone/backend cache
        readParamsFromDrone();

        console.log('✅ MotorTest panel initialised');
    }

    window.MotorTest = { init };
    console.log('✅ MotorTest module loaded');

})();
