/**
 * calib-radio.js
 * TiHANFly GCS — Radio Calibration Panel
 *
 * REQUIREMENT: #panel-calib-radio must have:
 *   display: flex; flex-direction: column; flex: 1; overflow: hidden;
 *
 * WebSocket messages sent to backend:
 *   { type: "start_radio_calibration" }
 *   { type: "complete_radio_calibration" }
 *   { type: "cancel_radio_calibration" }
 *
 * WebSocket messages received from backend:
 *   { type: "rc_channels",                channels: [{channel, raw}, ...] }
 *   { type: "radio_calibration_status",   message, success }
 *   { type: "radio_calibration_complete", success, channels: [{channel,min,max,trim}] }
 */
(function () {
    'use strict';

    const PWM_MIN = 1000;
    const PWM_MAX = 2000;

    // ── Sysid resolver ────────────────────────────────────────────────────
    // Same four-tier resolution used by calib-esc.js:
    //  1. window.getActiveSysid()   — explicit helper if defined by app shell
    //  2. window.activeSysid        — simple global variable if set
    //  3. _cachedSysid              — populated by listening to "status" broadcasts
    //  4. 1                         — ArduPilot factory default (single-drone safe)
    let _cachedSysid = -1;

    function _onStatusMsg(data) {
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
        if (_cachedSysid > 0) return _cachedSysid;
        return 1;   // ArduPilot default sysid — safe for single-drone
    }

    function pwmToPct(raw) {
        return Math.max(0, Math.min(100, ((raw - PWM_MIN) / (PWM_MAX - PWM_MIN)) * 100));
    }

    /* ── Templates ── */

    function hbar(id, label, pct) {
        const pwm = Math.round(PWM_MIN + pct * 10);
        return `
        <div class="mp-hbar-wrap">
          <div class="mp-hbar-outer">
            <div class="mp-hbar-fill" id="hbar-fill-${id}" style="width:${pct}%"></div>
            <div class="mp-marker-min-h" id="hbar-min-${id}" style="left:${pct}%"></div>
            <div class="mp-marker-max-h" id="hbar-max-${id}" style="left:${pct}%"></div>
            <span class="mp-hbar-label">${label}</span>
            <span class="mp-hbar-val"  id="hbar-val-${id}">${pwm}</span>
          </div>
          <label class="mp-reverse-label">
            <input type="checkbox" class="mp-reverse-cb" data-ch="${id}"> Reverse
          </label>
        </div>`;
    }

    function vStick(id, label, pct) {
        const pwm = Math.round(PWM_MIN + pct * 10);
        return `
        <div class="mp-stick-wrap">
          <div class="mp-stick-outer" id="stick-outer-${id}">
            <div class="mp-stick-fill" id="stick-fill-${id}" style="height:${pct}%"></div>
            <div class="mp-marker-min-v" id="stick-min-${id}" style="bottom:${pct}%"></div>
            <div class="mp-marker-max-v" id="stick-max-${id}" style="bottom:${pct}%"></div>
            <div class="mp-stick-label">${label}</div>
            <div class="mp-stick-val"  id="stick-val-${id}">${pwm}</div>
          </div>
          <div class="mp-stick-meta">
            <label class="mp-reverse-label">
              <input type="checkbox" class="mp-reverse-cb" data-ch="${id}"> Reverse
            </label>
          </div>
        </div>`;
    }

    function radioBox(ch, value, pct) {
        return `
        <div class="mp-radio-box" id="rbox-${ch}">
          <div class="mp-radio-bar" id="rbar-${ch}" style="width:${pct}%"></div>
          <div class="mp-marker-min-h" id="rbar-min-${ch}" style="left:${pct}%"></div>
          <div class="mp-marker-max-h" id="rbar-max-${ch}" style="left:${pct}%"></div>
          <span class="mp-radio-label">Radio ${ch}</span>
          <span class="mp-radio-val"  id="rval-${ch}">${value}</span>
        </div>`;
    }

    function render() {
        const L = [[5, 0, 0], [6, 0, 0], [7, 0, 0], [8, 0, 0], [9, 0, 0]];
        const R = [[10, 0, 0], [11, 0, 0], [12, 0, 0], [13, 0, 0], [14, 0, 0]];

        return `
<div class="mp-radio-root">

  <!-- ROW 1: Roll (ch1) -->
  <div class="mp-top-row">
    ${hbar('roll', 'Roll', 50.0)}
  </div>

  <!-- ROW 2: Sticks + Radio boxes -->
  <div class="mp-main-row">

    <div class="mp-sticks-section">
      ${vStick('pitch', 'Pitch', 50)}
      ${vStick('throttle', 'Throttle', 50)}
    </div>

    <div class="mp-boxes-section">
      <div class="mp-boxes-grid">
        <div class="mp-boxes-col">${L.map(([n, v, p]) => radioBox(n, v, p)).join('')}</div>
        <div class="mp-boxes-col">${R.map(([n, v, p]) => radioBox(n, v, p)).join('')}</div>
      </div>

      <!-- Status message bar -->
      <div id="radio-status-bar" style="
          display:none; padding:6px 10px; border-radius:2px; font-size:11px;
          font-weight:600; margin-bottom:4px; flex-shrink:0;">
      </div>

      <div class="mp-calib-row">
        <button class="mp-calib-btn" id="radioStartBtn">Calibrate Radio</button>
      </div>
      <div class="mp-bind-group">
        <span class="mp-bind-legend">Spektrum Bind</span>
        <div class="mp-bind-btns">
          <button class="mp-bind-btn">Bind DSM2</button>
          <button class="mp-bind-btn">Bind DSMX</button>
          <button class="mp-bind-btn">Bind DSM8</button>
        </div>
      </div>
    </div>

  </div>

  <!-- ROW 3: Yaw (ch4) -->
  <div class="mp-bottom-row">
    ${hbar('yaw', 'Yaw', 50.0)}
  </div>

</div>`;
    }

    /* ── Min/Max tracking state ── */
    const _minMax = {};  // key → { min: pct, max: pct }

    function _mm(key, pct) {
        if (!_minMax[key]) _minMax[key] = { min: pct, max: pct };
        else {
            if (pct < _minMax[key].min) _minMax[key].min = pct;
            if (pct > _minMax[key].max) _minMax[key].max = pct;
        }
        return _minMax[key];
    }

    function resetMinMax() {
        Object.keys(_minMax).forEach(k => delete _minMax[k]);
    }

    /* ── DOM update helpers ── */

    function setHbar(id, raw) {
        const pct = pwmToPct(raw);
        const fill = document.getElementById(`hbar-fill-${id}`);
        const val = document.getElementById(`hbar-val-${id}`);
        if (fill) fill.style.width = pct.toFixed(1) + '%';
        if (val) val.textContent = raw;

        const mm = _mm(`hbar-${id}`, pct);
        const minEl = document.getElementById(`hbar-min-${id}`);
        const maxEl = document.getElementById(`hbar-max-${id}`);
        if (minEl) minEl.style.left = mm.min.toFixed(1) + '%';
        if (maxEl) maxEl.style.left = mm.max.toFixed(1) + '%';
    }

    function setVstick(id, raw) {
        const pct = pwmToPct(raw);
        const fill = document.getElementById(`stick-fill-${id}`);
        const val = document.getElementById(`stick-val-${id}`);
        if (fill) fill.style.height = pct.toFixed(1) + '%';
        if (val) val.textContent = raw;

        const mm = _mm(`vstick-${id}`, pct);
        const minEl = document.getElementById(`stick-min-${id}`);
        const maxEl = document.getElementById(`stick-max-${id}`);
        if (minEl) minEl.style.bottom = mm.min.toFixed(1) + '%';
        if (maxEl) maxEl.style.bottom = mm.max.toFixed(1) + '%';
    }

    function setRbox(ch, raw) {
        const pct = pwmToPct(raw);
        const bar = document.getElementById(`rbar-${ch}`);
        const lbl = document.getElementById(`rval-${ch}`);
        if (bar) bar.style.width = pct.toFixed(1) + '%';
        if (lbl) lbl.textContent = raw || 0;

        const mm = _mm(`rbox-${ch}`, pct);
        const minEl = document.getElementById(`rbar-min-${ch}`);
        const maxEl = document.getElementById(`rbar-max-${ch}`);
        if (minEl) minEl.style.left = mm.min.toFixed(1) + '%';
        if (maxEl) maxEl.style.left = mm.max.toFixed(1) + '%';
    }

    /* ── Calibration Complete Popup ─────────────────────────────────────────
     * Matches the Mission Planner-style popup shown in Image 2:
     *   Title bar: "Radio"
     *   Body:  "Here are the detected radio options"
     *          "NOTE Channels not connected are displayed as 1500 +-2"
     *          "Normal values are around 1100 | 1900"
     *          blank line
     *          CHx  <min> | <max>   (one row per active channel)
     *   Footer: [OK] button (right-aligned)
     */
    function showCalibCompletePopup(channels) {
        const existing = document.getElementById('mp-calib-popup-overlay');
        if (existing) existing.remove();

        // Build channel rows — format: "CH1  1114 | 1910"  (Image 2 style)
        const rowsHtml = channels.map(({ channel, min, max, moved }) => {
            const minVal = (min != null && min !== 65535) ? min : '—';
            const maxVal = (max != null && max !== 0) ? max : '—';

            // `moved` is set by the backend (Fix 3 in radio_calibration.cpp).
            // Fallback: detect locally from the range in case an older backend
            // is in use that doesn't send the flag yet.
            const didMove = (moved !== undefined)
                ? !!moved
                : (typeof min === 'number' && typeof max === 'number' && (max - min) > 4);

            const rowStyle = didMove ? '' : 'color:#999;';
            const notMovedBadge = didMove
                ? ''
                : ' <span style="font-size:10px;color:#aaa;font-weight:400"> (not moved)</span>';

            return `<div class="mp-rc-row" style="${rowStyle}">
                      <span class="mp-rc-ch">CH${channel}${notMovedBadge}</span>
                      <span class="mp-rc-vals">${minVal} | ${maxVal}</span>
                    </div>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'mp-calib-popup-overlay';
        overlay.className = 'mp-calib-overlay';
        overlay.innerHTML = `
          <div class="mp-calib-popup" role="dialog" aria-modal="true">
            <div class="mp-calib-popup-titlebar">
              <span>Radio</span>
              <button class="mp-calib-popup-close" id="mp-popup-close-x" title="Close">✕</button>
            </div>
            <div class="mp-calib-popup-body">
              <p class="mp-rc-intro">Here are the detected radio options</p>
              <p class="mp-rc-note">NOTE Channels not connected are displayed as 1500 +&#8209;2</p>
              <p class="mp-rc-note">Normal values are around 1100 | 1900</p>
              <div class="mp-rc-divider"></div>
              <p class="mp-rc-note" style="font-weight:700;color:#333;margin-bottom:4px;">Channel:Min | Max</p>
              <div class="mp-rc-list">
                ${rowsHtml || '<div class="mp-rc-row" style="color:#888">No channel data received</div>'}
              </div>
            </div>
            <div class="mp-calib-popup-footer">
              <button class="mp-calib-popup-ok" id="mp-popup-ok-btn">OK</button>
            </div>
          </div>`;

        // Scope the popup to the radio calibration panel only, not the whole screen.
        const panelHost = document.getElementById('panel-calib-radio') || document.body;
        panelHost.appendChild(overlay);

        const close = () => {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.15s';
            setTimeout(() => overlay.remove(), 150);
        };

        document.getElementById('mp-popup-ok-btn')?.addEventListener('click', close);
        document.getElementById('mp-popup-close-x')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    }

    /* ── Collect current live channel values straight from the DOM bars ──
     * Used as fallback when radio_calibration_complete never arrives.
     * Reads the value spans that setHbar / setVstick / setRbox write to.
     */
    function collectLiveChannelData() {
        const result = [];
        const read = id => {
            const el = document.getElementById(`hbar-val-${id}`) ||
                document.getElementById(`stick-val-${id}`);
            return el ? parseInt(el.textContent, 10) || 0 : 0;
        };

        const chMap = [
            { channel: 1, id: 'roll' },
            { channel: 2, id: 'pitch' },
            { channel: 3, id: 'throttle' },
            { channel: 4, id: 'yaw' },
        ];
        chMap.forEach(({ channel, id }) => {
            const raw = read(id);
            if (raw > 0) result.push({ channel, min: raw, max: raw });
        });

        for (let ch = 5; ch <= 14; ch++) {
            const valEl = document.getElementById(`rval-${ch}`);
            const raw = valEl ? parseInt(valEl.textContent, 10) || 0 : 0;
            if (raw > 0) result.push({ channel: ch, min: raw, max: raw });
        }

        return result;
    }

    function showStatus(msg, success) {
        const bar = document.getElementById('radio-status-bar');
        if (!bar) return;
        bar.textContent = msg;
        bar.style.display = 'block';
        bar.style.background = success ? '#1a3a0a' : '#3a2000';
        bar.style.color = success ? '#9aff5a' : '#ffaa00';
        bar.style.border = `1px solid ${success ? '#5ccc00' : '#ffaa00'}`;
    }

    /* ── Map rc_channels array onto UI ──
     * ch1=Roll  ch2=Pitch  ch3=Throttle  ch4=Yaw  ch5-14=aux boxes
     */
    function applyChannels(channels) {
        channels.forEach(({ channel, raw }) => {
            if (!raw || raw === 0) return;
            switch (channel) {
                case 1: setHbar('roll', raw); break;
                case 2: setVstick('pitch', raw); break;
                case 3: setVstick('throttle', raw); break;
                case 4: setHbar('yaw', raw); break;
                default:
                    if (channel >= 5 && channel <= 14)
                        setRbox(channel, raw);
                    break;
            }
        });
    }

    // /* ── Mock animation — only while no drone is connected ── */
    // function startMockAnimation() {
    //     return setInterval(() => {
    //         ['pitch', 'throttle'].forEach(id => {
    //             setVstick(id, Math.round(PWM_MIN + Math.random() * 1000));
    //         });
    //         ['roll', 'yaw'].forEach(id => {
    //             setHbar(id, Math.round(PWM_MIN + Math.random() * 1000));
    //         });
    //         for (let ch = 5; ch <= 14; ch++) {
    //             const active = ch <= 9 && Math.random() > 0.25;
    //             setRbox(ch, active ? Math.round(PWM_MIN + Math.random() * 1000) : 0);
    //         }
    //     }, 80);
    // }

    /* ── Resolve the shared GCS WebSocket ──────────────────────────────────
     *
     * websocket.js is the central WS bus. It logs unhandled types but doesn't
     * forward them to other modules.  We patch into it by:
     *  1. Listening on the same socket object it uses (window.socket / window.ws)
     *  2. Also intercepting via the gcs-ws-message custom event if the shell fires it
     *  3. Monkey-patching websocket.js's handler table if it exposes one
     */
    function resolveSocket(injected) {
        if (injected && injected.readyState !== undefined) return injected;

        const candidates = [
            window.gcsSocket,
            window.socket,
            window.ws,
            window.SwUtil && window.SwUtil.ws,
            window.gcsWs,
            window.appSocket,
        ];
        for (const s of candidates) {
            if (s && s.readyState !== undefined) return s;
        }

        console.warn('[CalibRadio] No shared GCS socket found — opening own ws://127.0.0.1:9002/');
        const ws = new WebSocket('ws://127.0.0.1:9002/');
        window.gcsSocket = ws;
        return ws;
    }

    /**
     * Patch into websocket.js's central message handler so our messages
     * are never "unhandled".  websocket.js typically stores handlers in a map
     * like: window.wsHandlers, window.messageHandlers, or calls a dispatch fn.
     * We try all known patterns.
     */
    function patchWebsocketJs(onMsg) {
        // Pattern 1: websocket.js exposes window.wsHandlers = { type: fn, ... }
        if (window.wsHandlers && typeof window.wsHandlers === 'object') {
            window.wsHandlers['rc_channels'] = onMsg;
            window.wsHandlers['radio_calibration_complete'] = onMsg;
            window.wsHandlers['radio_calibration_status'] = onMsg;
            console.log('[CalibRadio] Patched into window.wsHandlers');
            return;
        }

        // Pattern 2: websocket.js exposes window.registerWsHandler(type, fn)
        if (typeof window.registerWsHandler === 'function') {
            window.registerWsHandler('rc_channels', onMsg);
            window.registerWsHandler('radio_calibration_complete', onMsg);
            window.registerWsHandler('radio_calibration_status', onMsg);
            console.log('[CalibRadio] Registered via window.registerWsHandler');
            return;
        }

        // Pattern 3: websocket.js exposes window.addWsListener(fn) for all messages
        if (typeof window.addWsListener === 'function') {
            window.addWsListener(onMsg);
            console.log('[CalibRadio] Registered via window.addWsListener');
            return;
        }

        // Pattern 4: websocket.js fires CustomEvent 'ws-message' or 'gcs-message' on window/document
        // (already handled by the gcs-ws-message listener in init — nothing more needed)
        console.log('[CalibRadio] No websocket.js patch point found — relying on direct socket + DOM events');
    }

    function wsSend(socket, obj) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    /* ── Init ── */
    function init(injectedSocket) {
        const host = document.getElementById('panel-calib-radio');
        if (!host) return;
        host.innerHTML = render();

        const { toast } = window.SwUtil || {};
        let mockTimer = null;
        let running = false;
        const btn = document.getElementById('radioStartBtn');

        // Resolve socket — may be in CONNECTING state, that's fine
        let socket = resolveSocket(injectedSocket);

        /* ── Incoming WS message handler ── */
        function onWsMessage(evt) {
            const raw = evt.data ?? evt.detail;
            if (!raw) return;
            let msg;
            try { msg = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); }
            catch { return; }

            switch (msg.type) {

                case 'status':
                    _onStatusMsg(msg);
                    break;

                // Live RC channel data from drone — stops mock automatically
                case 'rc_channels':
                    if (Array.isArray(msg.channels)) {
                        applyChannels(msg.channels);
                        if (mockTimer) {
                            clearInterval(mockTimer);
                            mockTimer = null;
                        }
                    }
                    break;

                // Status text from backend / flight controller
                case 'radio_calibration_status':
                    showStatus(msg.message, !!msg.success);
                    // Only show a global toast for positive outcomes.
                    // A "rejected" toast that fires mid-calibration (ArduPilot
                    // often sends TEMPORARILY_REJECTED then proceeds anyway) would
                    // linger on screen even after successful completion — confusing.
                    if (msg.message && msg.success) toast?.(msg.message);
                    break;

                // Calibration finished — reset button, apply trim values
                case 'radio_calibration_complete':
                    // Cancel the fallback timer — real data arrived
                    if (window._calibRadioFallbackTimer) {
                        clearTimeout(window._calibRadioFallbackTimer);
                        window._calibRadioFallbackTimer = null;
                    }
                    if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
                    running = false;
                    btn.textContent = 'Calibrate Radio';
                    btn.classList.remove('running');

                    // Coerce success to boolean — backend may send string "true"
                    if (msg.success === true || msg.success === 'true' || msg.success === 1) {
                        showStatus('Radio calibration successful!', true);
                        toast?.('Radio calibration complete');

                        const chans = Array.isArray(msg.channels) ? msg.channels : [];

                        chans.forEach(({ channel, trim }) => {
                            const raw = trim ?? 1500;
                            switch (channel) {
                                case 1: setHbar('roll', raw); break;
                                case 2: setVstick('pitch', raw); break;
                                case 3: setVstick('throttle', raw); break;
                                case 4: setHbar('yaw', raw); break;
                                default:
                                    if (channel >= 5 && channel <= 14)
                                        setRbox(channel, raw);
                                    break;
                            }
                        });

                        // Always show the popup with whatever data we received
                        console.log('[CalibRadio] Showing complete popup with', chans.length, 'channels');
                        showCalibCompletePopup(chans);
                    } else {
                        showStatus('Radio calibration failed.', false);
                        // Still show popup even on failure so user sees what was captured
                        const chans = Array.isArray(msg.channels) ? msg.channels : [];
                        if (chans.length > 0) showCalibCompletePopup(chans);
                    }
                    break;
            }
        }

        // Attach to raw socket for messages that bypass websocket.js
        socket.addEventListener('message', onWsMessage);

        // Try to patch into websocket.js's central handler table
        patchWebsocketJs(onMsg => {
            // websocket.js gives us the parsed object directly (not a MessageEvent)
            const synthetic = { data: JSON.stringify(onMsg), detail: onMsg };
            onWsMessage(synthetic);
        });

        // Catch ALL custom DOM event names the GCS shell might use
        ['gcs-ws-message', 'ws-message', 'gcs-message', 'mavlink-message'].forEach(evtName => {
            window.addEventListener(evtName, onWsMessage);
        });

        /* ── Button ── */
        btn?.addEventListener('click', () => {
            // Re-resolve every click in case socket connected after init()
            socket = resolveSocket(socket);

            // Use button label as source of truth — the drone may have put us into
            // calibration mode (PreArm: RC calibrating) without the JS running flag
            // being set, so checking btn text is more reliable than `running`.
            const isRunning = running || btn.classList.contains('running');

            if (isRunning) {
                // ── Complete calibration ──────────────────────────────────
                const sysid = _getActiveSysid();
                const sent = wsSend(socket, { type: 'complete_radio_calibration', sysid });

                if (sent) {
                    // Backend will respond with radio_calibration_complete JSON.
                    // Give it 2 seconds — if no response arrives, show popup
                    // with whatever live channel values are currently on screen.
                    const fallbackTimer = setTimeout(() => {
                        console.warn('[CalibRadio] No radio_calibration_complete response — using live channel values');
                        const liveChannels = collectLiveChannelData();
                        showCalibCompletePopup(liveChannels);
                    }, 2000);

                    // Store timer so onWsMessage can cancel it when real response arrives
                    window._calibRadioFallbackTimer = fallbackTimer;
                } else {
                    // No live drone — show popup immediately with live bar values
                    console.warn('[CalibRadio] complete — no open socket, showing live data popup');
                    showCalibCompletePopup(collectLiveChannelData());
                }

                if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
                running = false;
                btn.textContent = 'Calibrate Radio';
                btn.classList.remove('running');
                return;
            }

            // ── Start calibration ─────────────────────────────────────────
            running = true;
            btn.textContent = 'Complete';
            btn.classList.add('running');
            showStatus('Move all sticks and switches to their full extents…', false);
            toast?.('Move all sticks and switches to full extents');
            resetMinMax();

            const sysid = _getActiveSysid();
            const sent = wsSend(socket, { type: 'start_radio_calibration', sysid });

            if (!sent) {
                // No live drone — bars remain static until real data arrives
                console.warn('[CalibRadio] No WebSocket connection — waiting for drone to connect');
            }
            // When sent=true: backend streams rc_channels → bars update live.
        });

        // Bars remain at their default centre position until real rc_channels
        // data arrives from a connected drone/radio transmitter.

        console.log('[CalibRadio] Attached to socket', socket.url ?? socket);
    }

    window.CalibRadio = { init };
    console.log('✅ CalibRadio module ready');
})();
