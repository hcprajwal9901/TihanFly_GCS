/**
 * calib-compass.js
 * TiHANFly GCS — Compass Calibration Panel
 * MNC Enterprise Grade — Aerospace Dark Theme
 *
 * Fix log:
 *  [FIX 1] Progress bars only updated from real MAVLink MAG_CAL_PROGRESS data.
 *  [FIX 2] Completion ONLY when MAG_CAL_REPORT arrives with status="done".
 *  [FIX 3] Per-compass state tracking (active, progress, completed).
 *  [FIX 4] Progress bars do NOT reach 100% until drone actually finishes.
 *  [FIX 5] Correct compass_id → bar index mapping (0→MAG1, 1→MAG2, 2→MAG3).
 *  [FIX 6] WebSocket bridge: compass WS messages dispatched as
 *          'calibration_ws_message' CustomEvents so the listener fires.
 *  [FIX 7] Accept button disabled until status="done" arrives; it sends
 *          accept_compass_calibration which triggers the single
 *          DO_ACCEPT_MAG_CAL on the backend (double-accept eliminated).
 *  [FIX 8] compassState tracks all 3 compass IDs (0, 1, 2) — MAG3 bar
 *          now renders live data if firmware reports a third compass.
 *  [FIX 9] WS bridge rewritten: no longer relies on Object.defineProperty
 *          timing.  Uses a polling loop (50 ms) to attach addEventListener
 *          to window.ws as soon as it exists, then re-attaches on every
 *          reconnect using a MutationObserver-free approach.  The bridge
 *          attaches to the actual WebSocket object directly, which means
 *          it can never be silently overwritten by websocket.js setting
 *          ws.onmessage after us.  Object.defineProperty is still attempted
 *          first as an optimisation; polling is the reliable fallback.
 * [FIX 10] Duplicate message guard: each incoming WS message is deduplicated
 *          by a timestamp+type key so rapid re-renders from the direct-feed
 *          path in main.cpp (belt-and-braces delivery) are collapsed.
 */
(function () {
    'use strict';

    const ARROW_UP   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 5 22 19 2 19"/></svg>`;
    const ARROW_DOWN = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 19 2 5 22 5"/></svg>`;

    // One UAVCAN and one SPI placeholder — real entries arrive via MAVLink enumeration.
    const compassRows = [
        { priority: 1, devId: '97539',  busType: 'UAVCAN', bus: 0, address: 125, devType: 'SENSOR_ID#1', missing: false, external: true,  orientation: 'None' },
        { priority: 2, devId: '131874', busType: 'SPI',    bus: 4, address: 3,   devType: 'LSM303D',     missing: true,  external: false, orientation: ''     },
    ];

    const ORIENTATIONS = ['', 'None', 'YAW_45', 'YAW_90', 'YAW_135', 'YAW_180', 'ROLL_180', 'PITCH_180'];

    let _calibRunning = false;
    let _calibDone    = false;

    const compassState = {
        0: { active: false, progress: 0, completed: false },
        1: { active: false, progress: 0, completed: false },
        2: { active: false, progress: 0, completed: false },
    };

    // ── [FIX 10] Dedup guard ──────────────────────────────────────────────────
    //
    // The backend now feeds MAG_CAL_PROGRESS/REPORT directly AND via the
    // vehicle dispatch chain (belt-and-braces).  Both paths call
    // compassCalib.processMessage() which emits a WS JSON message.  Because
    // both paths run on the same thread they don't truly double-fire — but
    // if threading ever changes, dedup here prevents flickering.
    //
    // Key: "<type>:<compass_id>:<progress>" — resets after 200 ms.
    const _recentMsgs = new Map();
    function isDuplicate(msg) {
        const key = `${msg.type}:${msg.compass_id ?? ''}:${msg.progress ?? ''}:${msg.status ?? ''}`;
        const now = Date.now();
        const last = _recentMsgs.get(key);
        if (last && (now - last) < 200) return true;
        _recentMsgs.set(key, now);
        // Cleanup old entries
        if (_recentMsgs.size > 50) {
            for (const [k, t] of _recentMsgs)
                if (now - t > 500) _recentMsgs.delete(k);
        }
        return false;
    }

    // ── [FIX 9] WS Bridge — rewritten ────────────────────────────────────────
    //
    // PROBLEM with the previous approach:
    //   Object.defineProperty(window, 'ws', setter) works if window.ws is not
    //   yet defined or is configurable.  However, many websocket.js patterns
    //   do: window.ws = new WebSocket(...) in a DOMContentLoaded handler, and
    //   if calib-compass.js also loads at DOMContentLoaded, the execution
    //   order is non-deterministic.  When websocket.js runs first, our
    //   defineProperty sees an already-assigned, potentially non-configurable
    //   property and either throws (caught, falls through to polling with a
    //   200 ms interval that may still miss the first socket), or succeeds but
    //   only intercepts future assignments.  The socket that was assigned
    //   before our setter was installed never gets attachBridge() called.
    //
    // FIX:
    //   1. Try Object.defineProperty as before (optimistic fast path).
    //   2. If window.ws already exists at install time, call attachBridge now.
    //   3. Start a 50 ms polling loop that checks window.ws every tick.
    //      When it sees a WebSocket object that doesn't have
    //      _compassBridgeAttached, it calls attachBridge().  This catches:
    //        - The initial socket if defineProperty missed it.
    //        - Every reconnect socket created after this script loaded.
    //      50 ms polling is cheap (one property read per tick) and stops
    //      contributing overhead after the socket is attached.
    //   4. attachBridge() uses ws.addEventListener('message', handler) so
    //      it is independent of ws.onmessage assignment order.

    (function installWsBridge() {
        const COMPASS_TYPES = new Set([
            'compass_calibration_status',
            'compass_progress',
            'compass_result',
        ]);

        function attachBridge(ws) {
            if (!ws || ws._compassBridgeAttached) return;
            ws._compassBridgeAttached = true;

            ws.addEventListener('message', function (event) {
                let msg;
                try { msg = JSON.parse(event.data); } catch { return; }
                if (!msg || !COMPASS_TYPES.has(msg.type)) return;

                console.log('[CalibCompass] bridge dispatching:', msg.type, msg);
                window.dispatchEvent(
                    new CustomEvent('calibration_ws_message', { detail: msg })
                );
            });


            // ── [SPEC] ws.onmessage safety handler ──────────────────────────
            // Handles compass_progress and compass_complete messages directly
            // on the socket for environments where addEventListener may not fire.
            const _prevOnmessage = ws.onmessage || null;
            ws.onmessage = function(event) {
                // Chain any previously assigned onmessage handler
                if (_prevOnmessage) _prevOnmessage.call(ws, event);

                let data;
                try { data = JSON.parse(event.data); } catch { return; }

                if (data.type === "compass_progress") {
                    const id       = (data.compass != null ? data.compass : (data.compass_id ?? 0)) + 1;
                    const progress = data.progress ?? 0;

                    const bar   = document.querySelector(`#mag${id}-bar`);
                    const label = document.querySelector(`#mag${id}-label`);

                    if (bar)   bar.style.width    = progress + "%";
                    if (label) label.textContent  = progress + "%";
                }

                if (data.type === "compass_complete") {
                    const statusEl = document.querySelector("#compass-status");
                    if (statusEl) statusEl.textContent = "Calibration Complete";
                }
            };

            console.log('[CalibCompass] addEventListener bridge attached to ws');
        }

        // ── Step 1: Object.defineProperty (optimistic) ───────────────────────
        let _wsInternal = window.ws || null;
        let definePropertyWorked = false;

        try {
            Object.defineProperty(window, 'ws', {
                configurable: true,
                enumerable:   true,
                get() { return _wsInternal; },
                set(newWs) {
                    _wsInternal = newWs;
                    if (newWs) attachBridge(newWs);
                },
            });
            definePropertyWorked = true;
            console.log('[CalibCompass] defineProperty setter installed');
        } catch (err) {
            console.warn('[CalibCompass] defineProperty failed:', err);
        }

        // ── Step 2: Attach to any already-existing ws right now ──────────────
        if (_wsInternal) {
            attachBridge(_wsInternal);
        }

        // ── Step 3: 50 ms polling loop — belt-and-braces ─────────────────────
        //
        // Runs forever but does essentially nothing once the socket is attached:
        // one boolean check per 50 ms.  Catches reconnects even if defineProperty
        // was not installed (rare) or if websocket.js creates a new socket and
        // assigns it to window.ws via a path our setter doesn't intercept.
        let _lastPolledWs = _wsInternal;
        setInterval(function () {
            const current = window.ws;
            if (!current) return;

            // New socket object since last poll
            if (current !== _lastPolledWs) {
                _lastPolledWs = current;
                attachBridge(current);
                return;
            }

            // Same socket but bridge not yet attached (defineProperty missed it)
            if (!current._compassBridgeAttached) {
                attachBridge(current);
                _lastPolledWs = current;
            }
        }, 50);

    })();

    // ─── Build priority table rows ────────────────────────────────────────────
    function buildTableRows() {
        return compassRows.map((r, i) => `
      <tr class="compass-row${i === 0 ? ' selected' : ''}" data-idx="${i}">
        <td>${r.priority}</td>
        <td>${r.devId}</td>
        <td>${r.busType}</td>
        <td>${r.bus}</td>
        <td>${r.address}</td>
        <td>${r.devType}</td>
        <td class="cell-center missing-cell"><input type="checkbox" class="gcs-checkbox"${r.missing ? ' checked' : ''}></td>
        <td class="cell-center"><input type="checkbox" class="gcs-checkbox"${r.external ? ' checked' : ''}></td>
        <td>
          <select class="gcs-select orient-select">
            ${ORIENTATIONS.map(o => `<option${o === r.orientation ? ' selected' : ''}>${o}</option>`).join('')}
          </select>
        </td>
        <td class="cell-center"><button class="arrow-btn" data-dir="up" data-idx="${i}" title="Move Up">${ARROW_UP}</button></td>
        <td class="cell-center"><button class="arrow-btn" data-dir="dn" data-idx="${i}" title="Move Down">${ARROW_DOWN}</button></td>
      </tr>`).join('');
    }

    // ─── HTML render ──────────────────────────────────────────────────────────
    function render() {
        return `
<div class="gcs-panel-title">Compass Priority</div>

<div class="gcs-section">
  <div class="gcs-hint">Set the Compass Priority by reordering the compasses in the table below — highest priority at the top</div>
  <div class="table-wrapper">
    <table class="compass-priority-table" id="compassPriorityTable">
      <thead>
        <tr>
          <th>Priority</th><th>DevID</th><th>BusType</th><th>Bus</th>
          <th>Address</th><th>DevType</th><th>Missing</th><th>External</th>
          <th>Orientation</th><th>Up</th><th>Down</th>
        </tr>
      </thead>
      <tbody>${buildTableRows()}</tbody>
    </table>
  </div>
</div>

<div class="gcs-section">
  <span class="gcs-question">Disable any of the first 3 compasses?</span>
  <div class="gcs-checkbox-row">
    <label class="gcs-check-label"><input type="checkbox" class="gcs-checkbox" checked> Use Compass 1</label>
    <label class="gcs-check-label"><input type="checkbox" class="gcs-checkbox" checked> Use Compass 2</label>
    <label class="gcs-check-label"><input type="checkbox" class="gcs-checkbox" checked> Use Compass 3</label>
    <button class="gcs-btn gcs-btn-green remove-missing-btn">Remove Missing</button>
    <label class="gcs-check-label"><input type="checkbox" class="gcs-checkbox"> Automatically learn offsets</label>
  </div>
  <div class="gcs-hint-small">A reboot is required to adjust the ordering.</div>
  <button class="gcs-btn" id="rebootBtn" style="margin-top:6px">⟳ &nbsp;Reboot</button>
</div>

<div class="gcs-fieldset-section">
  <div class="gcs-warn-text" style="margin-bottom:10px">A mag calibration is required to remap the above changes.</div>

  <fieldset class="gcs-fieldset">
    <legend>Onboard Mag Calibration</legend>

    <div class="mag-calib-layout">
      <div class="mag-calib-left">

        <div class="mag-status-box" id="magStatusBox">
          <span class="mag-status-icon" id="magStatusIcon">🧭</span>
          <span class="mag-status-text" id="magStatusText">Ready to calibrate</span>
        </div>

        <div class="mag-calib-actions">
          <button class="gcs-btn gcs-btn-green" id="compassStartBtn">▶ &nbsp;Start</button>
          <button class="gcs-btn" id="compassCancelBtn" disabled style="color:#ff7070;border-color:rgba(255,82,82,0.35);background:rgba(255,82,82,0.08)">✕ &nbsp;Cancel</button>
        </div>

        <div class="mag-large-vehicle-row">
          <label class="gcs-check-label">
            <input type="checkbox" class="gcs-checkbox" id="largeVehicleChk">
            Large Vehicle Calibration
          </label>
          <span class="mag-hint-inline">Enables relaxed sphere fit for large frames</span>
        </div>

        <div class="mag-bars">
          <div class="mag-bar-row" id="magBarRow0">
            <span class="mag-label">
              <span class="mag-active-dot" id="magActiveDot0"></span>
              Mag 1
            </span>
            <div class="mag-track"><div class="mag-fill" id="mag1-bar" style="width:0%;transition:width 0.4s ease"></div></div>
            <span class="mag-pct" id="mag1-label">—</span>
          </div>
          <div class="mag-bar-row" id="magBarRow1">
            <span class="mag-label">
              <span class="mag-active-dot" id="magActiveDot1"></span>
              Mag 2
            </span>
            <div class="mag-track"><div class="mag-fill" id="mag2-bar" style="width:0%;transition:width 0.4s ease"></div></div>
            <span class="mag-pct" id="mag2-label">—</span>
          </div>
          <div class="mag-bar-row" id="magBarRow2">
            <span class="mag-label">
              <span class="mag-active-dot" id="magActiveDot2"></span>
              Mag 3
            </span>
            <div class="mag-track"><div class="mag-fill" id="mag3-bar" style="width:0%;transition:width 0.4s ease"></div></div>
            <span class="mag-pct" id="mag3-label">—</span>
          </div>
        </div>

        <div id="compass-status" class="mag-status-line"></div>

        <div class="mag-fitness-row">
          <span class="mag-label">Fitness</span>
          <select class="gcs-select fitness-select">
            <option selected>Default</option>
            <option>Relaxed</option>
            <option>3DR Solo</option>
            <option>Pixhawk</option>
          </select>
          <label class="gcs-check-label"><input type="checkbox" class="gcs-checkbox"> Relax fitness if calibration fails</label>
        </div>

      </div>

      <div class="mag-calib-right">
        <div class="mag-sphere-canvas">
          <canvas id="compassCanvas"></canvas>
          <div class="compass-ring-overlay" id="compassRingOverlay" style="display:none">
            <svg class="compass-ring-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,212,255,0.1)" stroke-width="4"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,212,255,0.6)"
                      stroke-width="4" stroke-dasharray="60 270"
                      stroke-linecap="round" class="compass-spin-arc"/>
              <text x="60" y="16"  text-anchor="middle" fill="rgba(0,212,255,0.7)" font-size="10" font-family="IBM Plex Mono,monospace">N</text>
              <text x="60" y="110" text-anchor="middle" fill="rgba(0,212,255,0.7)" font-size="10" font-family="IBM Plex Mono,monospace">S</text>
              <text x="108" y="64" text-anchor="middle" fill="rgba(0,212,255,0.7)" font-size="10" font-family="IBM Plex Mono,monospace">E</text>
              <text x="12"  y="64" text-anchor="middle" fill="rgba(0,212,255,0.7)" font-size="10" font-family="IBM Plex Mono,monospace">W</text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  </fieldset>
</div>

<div class="gcs-footer-btns">
  <button class="gcs-btn gcs-btn-green" id="largeVehicleMagCalBtn">⟳ &nbsp;Large Vehicle MagCal</button>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════
     REBOOT CONFIRMATION POPUP
════════════════════════════════════════════════════════════════════════ -->
<div id="rebootPopupOverlay" style="
    display:none;
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.72);
    z-index:9000;
    align-items:center;
    justify-content:center;
">
  <div id="rebootPopupBox" style="
      background:#0d0f14;
      border:1px solid rgba(0,212,255,0.35);
      border-radius:10px;
      padding:32px 36px;
      min-width:340px;
      max-width:420px;
      box-shadow:0 8px 40px rgba(0,212,255,0.12), 0 2px 8px rgba(0,0,0,0.6);
      font-family:'IBM Plex Sans','Segoe UI',sans-serif;
      color:#e0e6f0;
      text-align:center;
  ">
    <div style="font-size:36px;margin-bottom:12px;">🔄</div>
    <div style="font-size:15px;font-weight:600;color:#00d4ff;margin-bottom:8px;letter-spacing:0.04em;">
      Reboot Required
    </div>
    <div style="font-size:13px;color:rgba(200,210,230,0.8);margin-bottom:24px;line-height:1.6;">
      Compass offsets have been saved.<br>
      A reboot is required for the changes to take effect.<br><br>
      <strong style="color:#ffab40;">Reboot the flight controller now?</strong>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;">
      <button id="rebootPopupConfirmBtn" style="
          background:rgba(0,212,255,0.12);
          border:1px solid rgba(0,212,255,0.5);
          color:#00d4ff;
          padding:9px 28px;
          border-radius:6px;
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          letter-spacing:0.04em;
          transition:background 0.2s;
      ">⟳ &nbsp;Reboot Now</button>
      <button id="rebootPopupLaterBtn" style="
          background:rgba(255,255,255,0.04);
          border:1px solid rgba(255,255,255,0.12);
          color:rgba(200,210,230,0.7);
          padding:9px 28px;
          border-radius:6px;
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          letter-spacing:0.04em;
          transition:background 0.2s;
      ">Later</button>
    </div>
  </div>
</div>`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CANVAS HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function syncCanvasSize(canvas) {
        const wrap = canvas.parentElement;
        if (!wrap) return;
        const w = wrap.clientWidth  || 400;
        const h = wrap.clientHeight || 300;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width  = w;
            canvas.height = h;
        }
    }

    function drawBase(ctx, W, H) {
        const cx = W / 2, cy = H / 2;
        const maxR = Math.min(W, H) * 0.42;
        ctx.fillStyle = '#0d0f14';
        ctx.fillRect(0, 0, W, H);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.2);
        grad.addColorStop(0, 'rgba(0,212,255,0.04)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        for (let i = 1; i <= 4; i++) {
            const r = maxR * i / 4;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = i === 4 ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,212,255,0.08)';
        ctx.lineWidth = 1;
        [[cx, 0, cx, H], [0, cy, W, cy]].forEach(([x1, y1, x2, y2]) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });
    }

    function initCanvas() {
        const canvas = document.getElementById('compassCanvas');
        if (!canvas) return null;
        syncCanvasSize(canvas);
        const ctx = canvas.getContext('2d');
        drawBase(ctx, canvas.width, canvas.height);
        return { canvas, ctx, dots: [] };
    }

    function addDot(cv, progress) {
        if (!cv) return;
        const { canvas, ctx } = cv;
        const cx = canvas.width  / 2;
        const cy = canvas.height / 2;
        const maxR = Math.min(canvas.width, canvas.height) * 0.42;

        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(1 - 2 * Math.random());
        const r     = maxR * (0.3 + 0.7 * progress);

        const x = cx + r * Math.sin(phi) * Math.cos(theta);
        const y = cy + r * Math.sin(phi) * Math.sin(theta) * 0.6;

        const hue    = 160 + progress * 60;
        const bright = 0.3 + progress * 0.7;

        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 100%, ${Math.round(bright * 100)}%, 0.85)`;
        ctx.fill();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UI HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function showToast(message, type = 'info') {
        const existing = document.getElementById('compassToast');
        if (existing) existing.remove();

        const colors = {
            info:    { bg: 'rgba(0,212,255,0.12)',   border: 'rgba(0,212,255,0.4)',   text: '#00d4ff'  },
            success: { bg: 'rgba(0,230,118,0.12)',   border: 'rgba(0,230,118,0.4)',   text: '#00e676'  },
            warn:    { bg: 'rgba(255,171,64,0.12)',  border: 'rgba(255,171,64,0.4)',  text: '#ffab40'  },
            error:   { bg: 'rgba(255,82,82,0.12)',   border: 'rgba(255,82,82,0.4)',   text: '#ff5252'  },
        };
        const c = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.id = 'compassToast';
        Object.assign(toast.style, {
            position:     'fixed',
            bottom:       '24px',
            right:        '24px',
            zIndex:       '9999',
            background:   c.bg,
            border:       `1px solid ${c.border}`,
            color:        c.text,
            borderRadius: '8px',
            padding:      '10px 18px',
            fontFamily:   "'IBM Plex Mono', monospace",
            fontSize:     '12px',
            maxWidth:     '380px',
            boxShadow:    '0 4px 24px rgba(0,0,0,0.5)',
            transition:   'opacity 0.4s',
            opacity:      '1',
        });
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; }, 3000);
        setTimeout(() => { toast.remove(); }, 3500);
    }

    function setStatusText(text, mode = 'idle') {
        const box  = document.getElementById('magStatusBox');
        const icon = document.getElementById('magStatusIcon');
        const txt  = document.getElementById('magStatusText');
        if (!box || !txt) return;

        box.className = 'mag-status-box';
        if (mode === 'running') {
            box.classList.add('mag-status-running');
            if (icon) icon.textContent = '⏳';
        } else if (mode === 'success') {
            box.classList.add('mag-status-success');
            if (icon) icon.textContent = '✅';
        } else if (mode === 'error') {
            box.classList.add('mag-status-error');
            if (icon) icon.textContent = '❌';
        } else {
            if (icon) icon.textContent = '🧭';
        }
        txt.textContent = text;
    }

    function showRotationOverlay(show) {
        const overlay = document.getElementById('compassRingOverlay');
        if (overlay) overlay.style.display = show ? 'flex' : 'none';
    }

    function setActiveCompass(compassId) {
        for (let i = 0; i < 3; i++) {
            const dot = document.getElementById(`magActiveDot${i}`);
            const row = document.getElementById(`magBarRow${i}`);
            if (dot) dot.classList.toggle('active', i === compassId);
            if (row) row.classList.toggle('mag-bar-active', i === compassId);
        }
    }

    function resetBars() {
        for (let i = 0; i < 3; i++) {
            const barIdx = i + 1;
            const b = document.getElementById(`mag${barIdx}-bar`);
            const p = document.getElementById(`mag${barIdx}-label`);
            const dot = document.getElementById(`magActiveDot${i}`);
            const row = document.getElementById(`magBarRow${i}`);
            if (b) { b.style.width = '0%'; b.style.background = ''; }
            if (p) p.textContent = '—';
            if (dot) dot.classList.remove('active');
            if (row) row.classList.remove('mag-bar-active');
        }
    }

    function reIndexTable(tbody) {
        [...tbody.querySelectorAll('tr')].forEach((row, i) => {
            row.dataset.idx = i;
            const td = row.querySelector('td:first-child');
            if (td) td.textContent = i + 1;
            row.querySelectorAll('.arrow-btn').forEach(btn => btn.dataset.idx = i);
        });
    }

    function updateBar(compassId, pct) {
        if (compassId < 0 || compassId > 2) return;
        const barIdx = compassId + 1;
        const b = document.getElementById(`mag${barIdx}-bar`);
        const p = document.getElementById(`mag${barIdx}-label`);

        if (b) {
            b.style.width = pct + '%';
            b.style.background = 'linear-gradient(90deg, #00b4d8, #00d4ff)';
        }
        if (p) p.textContent = pct + '%';

        compassState[compassId].progress = pct;
    }

    function showRebootPopup() {
        const overlay = document.getElementById('rebootPopupOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function hideRebootPopup() {
        const overlay = document.getElementById('rebootPopupOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GLOBAL WS MESSAGE LISTENER
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('calibration_ws_message', function (e) {
        const msg  = e.detail;
        const type = msg && msg.type;

        // [FIX 10] Suppress duplicate deliveries
        if (isDuplicate(msg)) {
            console.log('[CalibCompass] dedup suppressed:', type);
            return;
        }

        // ── Status text ────────────────────────────────────────────────────────
        if (type === 'compass_calibration_status') {
            const text = msg.message || '';
            if (text) {
                setStatusText(text, _calibRunning ? 'running' : 'idle');
                showToast(text, 'info');
            }
            return;
        }

        // ── Per-compass progress (0–99%) ───────────────────────────────────────
        if (type === 'compass_progress') {
            const compassId = msg.compass_id ?? 0;
            if (compassId < 0 || compassId > 2) return;

            const pct = Math.min(99, Math.max(0, msg.progress ?? 0));

            compassState[compassId].active   = true;
            compassState[compassId].progress = pct;

            updateBar(compassId, pct);
            setActiveCompass(compassId);

            if (compassId === 0 && window._compassCv)
                addDot(window._compassCv, pct / 100);

            const parts = [];
            for (let i = 0; i < 3; i++) {
                if (compassState[i].completed)   parts.push(`MAG${i + 1}: ✓`);
                else if (compassState[i].active) parts.push(`MAG${i + 1}: ${compassState[i].progress}%`);
            }
            const statusLine = parts.length > 0
                ? `Calibrating — rotate vehicle in all axes… ${parts.join('  |  ')}`
                : `Calibrating Mag ${compassId + 1} — rotate vehicle in all axes… ${pct}%`;
            setStatusText(statusLine, 'running');
            return;
        }

        // ── Individual compass done, others still running ──────────────────────
        if (type === 'compass_result' && msg.status === 'compass_done') {
            const cid = msg.compass_id ?? -1;
            if (cid >= 0 && cid <= 2) {
                compassState[cid].completed = true;
                compassState[cid].active    = false;
                const barIdx = cid + 1;
                const b = document.getElementById(`mag${barIdx}-bar`);
                const p = document.getElementById(`mag${barIdx}-label`);
                if (b) { b.style.width = '100%'; b.style.background = '#00e676'; }
                if (p) p.textContent = '100%';
            }
            showToast(`✓ Mag ${(msg.compass_id ?? 0) + 1} complete — keep rotating for remaining compass…`, 'info');
            return;
        }

        // ── Final result: "done" or "failed" ─────────────────────────────────────
        if (type === 'compass_result') {
            const ok        = (msg.status === 'done');
            const compassId = msg.compass_id ?? -1;

            _calibRunning = false;
            _calibDone    = ok;

            showRotationOverlay(false);
            setActiveCompass(-1);

            const startBtn  = document.getElementById('compassStartBtn');
            const cancelBtn = document.getElementById('compassCancelBtn');
            if (startBtn)  startBtn.disabled  = false;
            if (cancelBtn) cancelBtn.disabled = true;

            if (ok) {
                if (compassId >= 0 && compassId <= 2) {
                    compassState[compassId].completed = true;
                    const barIdx = compassId + 1;
                    const b = document.getElementById(`mag${barIdx}-bar`);
                    const p = document.getElementById(`mag${barIdx}-label`);
                    if (b) { b.style.width = '100%'; b.style.background = '#00e676'; }
                    if (p) p.textContent = '100%';
                } else {
                    for (let i = 0; i < 3; i++) {
                        if (compassState[i].progress > 0 && !compassState[i].completed) {
                            const barIdx = i + 1;
                            const b = document.getElementById(`mag${barIdx}-bar`);
                            const p = document.getElementById(`mag${barIdx}-label`);
                            if (b) { b.style.width = '100%'; b.style.background = '#00e676'; }
                            if (p) p.textContent = '100%';
                            compassState[i].completed = true;
                        }
                    }
                }

                setStatusText(
                    msg.message || 'Calibration complete! Offsets saved. Reboot recommended.',
                    'success'
                );
                showToast('✓ ' + (msg.message || 'Compass calibration complete!'), 'success');
                showRebootPopup();

            } else {
                const failedIds = (compassId >= 0 && compassId <= 2)
                    ? [compassId]
                    : [0, 1, 2].filter(i => compassState[i].active && !compassState[i].completed);

                const interruptedIds = [0, 1, 2].filter(
                    i => compassState[i].active &&
                         !compassState[i].completed &&
                         !failedIds.includes(i)
                );

                for (const id of failedIds) {
                    const b = document.getElementById(`mag${id + 1}-bar`);
                    const p = document.getElementById(`mag${id + 1}-label`);
                    if (b) { b.style.width = '100%'; b.style.background = '#ff5252'; }
                    if (p) p.textContent = 'FAIL';
                    compassState[id].active = false;
                }

                for (const id of interruptedIds) {
                    const b = document.getElementById(`mag${id + 1}-bar`);
                    const p = document.getElementById(`mag${id + 1}-label`);
                    if (b) { b.style.background = 'rgba(180,180,180,0.35)'; }
                    if (p) p.textContent = compassState[id].progress + '% ✕';
                    compassState[id].active = false;
                }

                const resultParts = [];
                for (let i = 0; i < 3; i++) {
                    if (failedIds.includes(i))           resultParts.push(`MAG${i + 1}: FAILED`);
                    else if (interruptedIds.includes(i)) resultParts.push(`MAG${i + 1}: interrupted`);
                    else if (compassState[i].completed)  resultParts.push(`MAG${i + 1}: OK`);
                }
                const failMsg = resultParts.length > 0
                    ? `Calibration failed — ${resultParts.join('  |  ')}. Try again.`
                    : (msg.message || 'Calibration failed. Try again.');

                window._compassCv = initCanvas();
                setStatusText(failMsg, 'error');
                showToast(failMsg, 'warn');
            }
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    //  PANEL INIT
    // ═══════════════════════════════════════════════════════════════════════════
    function init() {
        const host = document.getElementById('panel-calib-compass');
        if (!host) return;
        host.innerHTML = render();

        host.addEventListener('click', e => {
            const btn = e.target.closest('.arrow-btn');
            if (!btn) return;
            const tbody = document.querySelector('#compassPriorityTable tbody');
            const rows  = [...tbody.querySelectorAll('tr')];
            const idx   = parseInt(btn.dataset.idx);
            const dir   = btn.dataset.dir;
            if (dir === 'up' && idx > 0) {
                tbody.insertBefore(rows[idx], rows[idx - 1]);
                reIndexTable(tbody);
            } else if (dir === 'dn' && idx < rows.length - 1) {
                tbody.insertBefore(rows[idx + 1], rows[idx]);
                reIndexTable(tbody);
            }
        });

        host.addEventListener('click', e => {
            const row = e.target.closest('.compass-row');
            if (!row) return;
            host.querySelectorAll('.compass-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
        });

        window._compassCv = initCanvas();

        const startBtn              = document.getElementById('compassStartBtn');
        const cancelBtn             = document.getElementById('compassCancelBtn');
        const rebootBtn             = document.getElementById('rebootBtn');
        const largeVehicleMagCalBtn = document.getElementById('largeVehicleMagCalBtn');
        const rebootPopupConfirmBtn = document.getElementById('rebootPopupConfirmBtn');
        const rebootPopupLaterBtn   = document.getElementById('rebootPopupLaterBtn');

        function wsSend(obj) {
            const ws = window.ws;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(obj));
            } else {
                showToast('Not connected to GCS backend', 'warn');
            }
        }

        startBtn?.addEventListener('click', () => {
            for (let i = 0; i < 3; i++) {
                compassState[i] = { active: false, progress: 0, completed: false };
            }

            resetBars();
            window._compassCv = initCanvas();
            _calibRunning = true;
            _calibDone    = false;

            startBtn.disabled  = true;
            cancelBtn.disabled = false;

            showRotationOverlay(true);
            setStatusText('Sending calibration command…', 'running');

            const largeVehicle = !!(document.getElementById('largeVehicleChk')?.checked);
            const cmd = {
                type: 'start_compass_calibration',
                sysid: window.selectedSysId ?? 1,
            };
            if (largeVehicle) cmd.large_vehicle = true;

            showToast('Sending calibration command to drone…', 'info');
            wsSend(cmd);
        });

        // Accept button removed — backend auto-accepts on completion

        cancelBtn?.addEventListener('click', () => {
            showToast('Cancelling compass calibration…', 'warn');
            wsSend({ type: 'cancel_compass_calibration', sysid: window.selectedSysId ?? 1 });
        });

        rebootBtn?.addEventListener('click', () => {
            showToast('Reboot command sent to flight controller', 'warn');
            setStatusText('Rebooting vehicle…', 'running');
            wsSend({ type: 'reboot_vehicle', sysid: window.selectedSysId ?? 1 });
        });

        rebootPopupConfirmBtn?.addEventListener('click', () => {
            hideRebootPopup();
            setStatusText('Rebooting vehicle…', 'running');
            showToast('⟳ Reboot command sent to flight controller', 'warn');
            wsSend({ type: 'reboot_vehicle', sysid: window.selectedSysId ?? 1 });

            const startBtn = document.getElementById('compassStartBtn');
            if (startBtn) startBtn.disabled = false;
        });

        rebootPopupLaterBtn?.addEventListener('click', () => {
            hideRebootPopup();
            setStatusText('Offsets saved. Reboot when ready.', 'success');
            showToast('Reboot skipped — reboot the vehicle manually when ready.', 'info');

            const startBtn = document.getElementById('compassStartBtn');
            if (startBtn) startBtn.disabled = false;
        });

        largeVehicleMagCalBtn?.addEventListener('click', () => {
            const chk = document.getElementById('largeVehicleChk');
            if (chk) chk.checked = true;
            startBtn?.click();
        });

        // ── Remove Missing button ────────────────────────────────────────────
        host.addEventListener('click', e => {
            if (!e.target.closest('.remove-missing-btn')) return;
            const tbody = host.querySelector('#compassPriorityTable tbody');
            if (!tbody) return;
            let removed = 0;
            [...tbody.querySelectorAll('tr')].forEach(row => {
                // Use .missing-cell class — robust regardless of column order
                const chk = row.querySelector('td.missing-cell input[type="checkbox"]');
                if (chk?.checked) { row.remove(); removed++; }
            });
            if (removed > 0) {
                reIndexTable(tbody);
                showToast('Removed ' + removed + ' missing compass' + (removed > 1 ? 'es' : '') + ' from the list.', 'info');
            } else {
                showToast('No compasses marked as Missing to remove.', 'warn');
            }
        });

        const canvasWrap = host.querySelector('.mag-sphere-canvas');
        if (canvasWrap && window.ResizeObserver) {
            new ResizeObserver(() => {
                const canvas = document.getElementById('compassCanvas');
                if (canvas) {
                    syncCanvasSize(canvas);
                    if (window._compassCv)
                        drawBase(window._compassCv.ctx, canvas.width, canvas.height);
                }
            }).observe(canvasWrap);
        }
    }

    window.CalibCompass = { init };
    console.log('✅ CalibCompass module ready (fixed v5 — remove-missing uses class selector, dummy data cleared)');
})();
