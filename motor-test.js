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

        send({
            type:         'motor_test',
            motor_index:  motorIndex,
            throttle_pct: throttle,
            duration_sec: duration,
        });

        setStatus('running', `▶ Motor ${motorIndex === 0 ? 'All' : motorIndex} testing at ${throttle}% for ${duration}s…`);
        markRunning(motorIndex);
        scheduleAutoStop(duration);
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

        const lock    = document.getElementById('mt-lock');
        const content = document.getElementById('mt-content');
        if (lock)    lock.style.display    = 'none';
        if (content) content.classList.remove('mt-locked');

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
        if (!msg || msg.type !== 'motor_test_ack') return;

        if (msg.status === 'error') {
            clearRunning();
            if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
            setStatus('error', '✕ ' + (msg.message || 'Motor test rejected by FC'));
            window.SwUtil?.toast?.('Motor test: ' + (msg.message || 'rejected'), true);
        }
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
<div class="settings-panel-title">Motor Test</div>

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

<!-- Controls (throttle / duration) — locked until acknowledged -->
<div class="mt-content mt-locked" id="mt-content">
  <div class="mt-controls">
    <div class="mt-control-card">
      <div class="mt-control-label">Throttle</div>
      <div class="mt-slider-row">
        <input type="range" class="mt-slider" id="mt-throttle"
               min="0" max="100" step="1" value="${DEFAULT_THROTTLE}"
               style="--slider-pct:${DEFAULT_THROTTLE}%">
        <span class="mt-slider-val" id="mt-throttle-val">${DEFAULT_THROTTLE}%</span>
      </div>
    </div>

    <div class="mt-control-card">
      <div class="mt-control-label">Test Duration</div>
      <div class="mt-duration-row">
        <input type="number" class="mt-duration-input" id="mt-duration"
               min="0.5" max="30" step="0.5" value="${DEFAULT_DURATION}">
        <span class="mt-duration-unit">seconds</span>
      </div>
    </div>
  </div>

  <!-- Individual motor buttons -->
  <div class="mt-section-label">Individual Motors</div>
  <div class="mt-motor-grid">
    ${motorBtns}
  </div>

  <!-- Test All / Stop buttons -->
  <div class="mt-action-row">
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
            // Enable all buttons
            document.querySelectorAll('.mt-motor-btn, #mt-btn-all').forEach(b => {
                b.disabled = false;
            });
        });

        // Throttle slider
        document.getElementById('mt-throttle')?.addEventListener('input', updateSliderFill);

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
        console.log('✅ MotorTest panel initialised');
    }

    window.MotorTest = { init };
    console.log('✅ MotorTest module loaded');

})();
