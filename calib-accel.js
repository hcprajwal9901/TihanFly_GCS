/**
 * calib-accel.js  —  TiHANFly GCS  Accelerometer Calibration
 *
 * Mirrors the Python CalibrationModel flow:
 *   1. User clicks Start  →  frontend sends  { type:"start_accel_calibration" }
 *   2. Backend sends  { type:"calibration_status", step:"started" }
 *   3. Drone requests position N  →  backend sends  { type:"calibration_step", step:"right", … }
 *      UI highlights the correct face
 *   4. User positions drone, clicks "Next Position"  →  frontend sends
 *        { type:"accel_calibration_step_done", step:"right" }
 *   5. Backend echoes to drone, drone requests next position → goto 3.
 *   6. Done:  { type:"calibration_result", step:"done" }
 *      Failed: { type:"calibration_result", step:"failed" }
 *
 *  KEY RULE: The frontend NEVER optimistically marks a step done.
 *  All state advances only when the backend sends the next calibration_step
 *  or calibration_result "done".
 */
(function () {
    'use strict';

    // ── Icons ─────────────────────────────────────────────────────────────────
    const PLAY  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const NEXT  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
    const WARN  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const CHECK = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`;

    // ── Face images & descriptors ─────────────────────────────────────────────
    const FACE_IMG = {
        'level'  : 'resources/calibration/accel_down.png',
        'left'   : 'resources/calibration/accel_left.png',
        'right'  : 'resources/calibration/accel_right.png',
        'nose-up': 'resources/calibration/accel_back.png',
        'nose-dn': 'resources/calibration/accel_front.png',
        'back'   : 'resources/calibration/accel_up.png',
    };

    const FACES = [
        { key: 'level',   label: 'Level',   wsStep: 'level'       },  // pos 1
        { key: 'left',    label: 'Left',    wsStep: 'left'        },  // pos 2
        { key: 'right',   label: 'Right',   wsStep: 'right'       },  // pos 3
        { key: 'nose-dn', label: 'Nose Dn', wsStep: 'nose_down'   },  // pos 4
        { key: 'nose-up', label: 'Nose Up', wsStep: 'nose_up'     },  // pos 5
        { key: 'back',    label: 'Back',    wsStep: 'upside_down' },  // pos 6
    ];

    const STEP_MAP = {
        'level'      : 0,
        'left'       : 1,
        'right'      : 2,
        'nose_down'  : 3,
        'nose_up'    : 4,
        'upside_down': 5,
    };

    // ── HTML builders ─────────────────────────────────────────────────────────

    function buildCubeGrid() {
        return FACES.map(f => `
        <div class="calib-cube-face" data-face="${f.key}">
            <img src="${FACE_IMG[f.key]}" alt="${f.label}" class="calib-face-img" draggable="false"/>
            <span class="calib-face-label">${f.label}</span>
            <span class="calib-face-tick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            </span>
        </div>`).join('');
    }

    function buildSuccessModal() {
        return `
        <div class="calib-modal-overlay" id="accelModal">
            <div class="calib-modal-box">
                <div class="calib-modal-icon">${CHECK}</div>
                <h3 class="calib-modal-title">Calibration Complete</h3>
                <p class="calib-modal-body">
                    Accelerometer calibration accepted by the flight controller.<br>
                    The vehicle is now calibrated and ready.
                </p>
                <div class="calib-modal-stats">
                    <div class="calib-modal-stat">
                        <span class="calib-modal-stat-val" id="accelModalPositions">— / —</span>
                        <span class="calib-modal-stat-lbl">Positions</span>
                    </div>
                    <div class="calib-modal-stat">
                        <span class="calib-modal-stat-val">✓</span>
                        <span class="calib-modal-stat-lbl">IMU Data</span>
                    </div>
                    <div class="calib-modal-stat">
                        <span class="calib-modal-stat-val">OK</span>
                        <span class="calib-modal-stat-lbl">Status</span>
                    </div>
                </div>
                <div class="calib-modal-actions">
                    <button class="calib-btn calib-btn-primary"   id="accelModalOkBtn">OK</button>
                    <button class="calib-btn calib-btn-secondary" id="accelModalRecalBtn">Recalibrate</button>
                </div>
            </div>
        </div>`;
    }

    function render() {
        return `
<div class="settings-panel-title">Accelerometer Calibration</div>

<div class="calib-warning">
  ${WARN}
  Place the drone on a firm, level surface before starting. Keep the vehicle
  <strong style="color:#ffa000">completely still</strong> during each position capture.
  Do not arm the drone.
</div>

<div class="calib-card">

  <div class="calib-visual">
    <div class="calib-icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="calib-meta">
      <h4>6-Position Calibration</h4>
      <p>Click <strong>Start</strong>, hold the drone in the highlighted position, then click
         <strong>Next Position</strong>. Repeat for all 6 positions.</p>
    </div>
  </div>

  <div class="calib-status-row">
    <span class="calib-status-label">Status</span>
    <span class="calib-status-value idle" id="accelStatus">NOT STARTED</span>
  </div>

  <div class="calib-progress-wrap">
    <div class="calib-progress-label">
      <span>Positions captured</span>
      <span id="accelPct">0 / 6</span>
    </div>
    <div class="calib-progress-bar">
      <div class="calib-progress-fill" id="accelBar"></div>
    </div>
  </div>

  <!-- Drone selector — only visible when multiple drones are connected -->
  <div id="accelDroneSelector" class="calib-drone-selector" style="display:none">
    <label class="calib-drone-label">Target Drone</label>
    <select class="calib-drone-select" id="accelDroneSelect"></select>
  </div>

  <div class="calib-step-hint" id="accelStepHint"></div>

  <!-- Live attitude (streaming from calib_attitude messages) -->
  <div class="calib-attitude-box" id="accelAttitudeBox" style="display:none">
    <div class="calib-attitude-row">
      <span class="calib-attitude-label">Roll</span>
      <span class="calib-attitude-val"  id="accelRollVal">—</span>
      <span class="calib-attitude-deg">°</span>
    </div>
    <div class="calib-attitude-row">
      <span class="calib-attitude-label">Pitch</span>
      <span class="calib-attitude-val"  id="accelPitchVal">—</span>
      <span class="calib-attitude-deg">°</span>
    </div>
  </div>

  <!-- Error banner -->
  <div class="calib-error-banner" id="accelErrorBanner" style="display:none">
    ${WARN}
    <span id="accelErrorText">Error — check connection and retry.</span>
  </div>

  <div class="calib-cube-grid">
    ${buildCubeGrid()}
  </div>

  <div class="calib-actions">
    <button class="calib-btn calib-btn-primary"   id="accelStartBtn">${PLAY} Start Calibration</button>
    <button class="calib-btn calib-btn-primary"   id="accelNextBtn"  style="display:none">${NEXT} Next Position</button>
    <button class="calib-btn calib-btn-success"   id="accelOkBtn"    style="display:none">✓ OK</button>
    <button class="calib-btn calib-btn-secondary" id="accelResetBtn">Reset</button>
  </div>

</div>

${buildSuccessModal()}
`;
    }

    // =========================================================================
    //  init()
    // =========================================================================
    function init() {
        const host = document.getElementById('panel-calib-accel');
        if (!host) return;
        host.innerHTML = render();

        // ── SwUtil safe fallback ─────────────────────────────────────────────
        const SwUtilSafe = window.SwUtil || {
            setStatus(id, text, cls) {
                const el = document.getElementById(id);
                if (el) { el.textContent = text; el.className = 'calib-status-value ' + (cls || 'idle'); }
            },
            toast(msg, type) {
                type = type || 'info';
                const d = document.createElement('div');
                d.style.cssText =
                    'position:fixed;bottom:24px;right:24px;z-index:9999;'
                    + 'padding:10px 18px;border-radius:8px;font-size:13px;'
                    + 'font-family:sans-serif;color:#fff;max-width:360px;'
                    + 'box-shadow:0 4px 16px rgba(0,0,0,.35);transition:opacity .4s;';
                d.style.background = type === 'error' ? '#c0392b'
                                   : type === 'warn'  ? '#e67e22'
                                   :                    '#27ae60';
                d.textContent = msg;
                document.body.appendChild(d);
                setTimeout(() => { d.style.opacity = '0'; }, 2800);
                setTimeout(() => { d.remove(); },            3200);
            }
        };
        const { setStatus, toast } = SwUtilSafe;

        // ── Socket helper ────────────────────────────────────────────────────
        function getLiveSocket() {
            return window.socket || window.ws || window.gcsSocket || null;
        }

        function sendWS(obj) {
            const socket = getLiveSocket();
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                console.warn('[CalibAccel] WebSocket not ready');
                return;
            }
            socket.send(JSON.stringify(obj));
        }

        // ── State ────────────────────────────────────────────────────────────
        let currentStep     = -1;      // FACES[] index currently shown
        let doneCount       = 0;
        let totalPositions  = 0;
        let displayingStep  = false;   // true: drone requested position, user must act
        let waitingForDrone = false;   // true: user clicked Next, locked until drone replies
        let positionQueue   = [];
        let calibrationEnded = false;  // true after done/failed — blocks all sends
        let lastSentWsStep  = null;    // duplicate-send guard

        // Selected drone — set by drone selector dropdown.
        // Both are sent in every WS message so the backend can route by either.
        // -1 = not yet set (single-drone: backend uses whichever vehicle is alive).
        let selectedLinkId = -1;
        let selectedSysId  = -1;

        // Locked at Start-click so mid-calibration drone-selector changes
        // don't reroute step confirmations to a different drone.
        let activeSysId  = -1;
        let activeLinkId = -1;

        // Populated by vehicle_list messages from the backend.
        let connectedVehicles = [];

        // Safety-net timer — re-enables button if drone goes silent
        let safetyTimer = null;

        // ── Drone selector ───────────────────────────────────────────────
        // Rebuilt every time a vehicle_list message arrives from the backend.
        // Each vehicle in the list has { sysid, link_id }.

        function buildDroneSelector() {
            const wrap = document.getElementById('accelDroneSelector');
            const sel  = document.getElementById('accelDroneSelect');
            if (!wrap || !sel) return;

            if (connectedVehicles.length <= 1) {
                wrap.style.display = 'none';
                if (connectedVehicles.length === 1) {
                    selectedLinkId = connectedVehicles[0].link_id ?? -1;
                    selectedSysId  = connectedVehicles[0].sysid  ?? -1;
                }
                return;
            }

            // Multiple drones — show selector
            wrap.style.display = 'flex';
            const prev = sel.value;
            sel.innerHTML = connectedVehicles.map(v =>
                `<option value="${v.sysid}" data-link="${v.link_id}">Drone ${v.sysid} (link ${v.link_id})</option>`
            ).join('');
            if (connectedVehicles.some(v => String(v.sysid) === prev))
                sel.value = prev;

            // Resolve both ids from selected option
            const opt = sel.options[sel.selectedIndex];
            selectedSysId  = parseInt(sel.value, 10);
            selectedLinkId = opt ? parseInt(opt.dataset.link, 10) : -1;
        }

        // ── DOM helpers ──────────────────────────────────────────────────────

        function getFaceEl(key) {
            return host.querySelector(`.calib-cube-face[data-face="${key}"]`);
        }

        function refreshProgress(done) {
            const total = totalPositions > 0 ? totalPositions : 6;
            const bar   = document.getElementById('accelBar');
            const pct   = document.getElementById('accelPct');
            if (bar) bar.style.width = (done / total * 100) + '%';
            if (pct) pct.textContent  = done + ' / ' + total;
        }

        function updateHint(text) {
            const el = document.getElementById('accelStepHint');
            if (el) { el.textContent = text; el.style.display = text ? 'block' : 'none'; }
        }

        function showError(text) {
            const banner = document.getElementById('accelErrorBanner');
            const span   = document.getElementById('accelErrorText');
            if (banner) banner.style.display = 'flex';
            if (span)   span.textContent = text;
        }

        function hideError() {
            const el = document.getElementById('accelErrorBanner');
            if (el) el.style.display = 'none';
        }

        // ── Next button helpers ───────────────────────────────────────────────

        function cancelSafetyTimer() {
            if (safetyTimer !== null) { clearTimeout(safetyTimer); safetyTimer = null; }
        }

        function setNextBtnNormal() {
            const btn = document.getElementById('accelNextBtn');
            if (!btn) return;
            btn.disabled = false;
            btn.innerHTML = `${NEXT} Next Position`;
        }

        function setNextBtnWaiting() {
            const btn = document.getElementById('accelNextBtn');
            if (!btn) return;
            btn.disabled = true;
            btn.innerHTML = `${NEXT} Next Position`;
        }

        // ── Face state helpers ────────────────────────────────────────────────

        function highlightStep(idx) {
            host.querySelectorAll('.calib-cube-face').forEach(f => f.classList.remove('active'));
            if (idx >= 0 && idx < FACES.length) {
                const face = getFaceEl(FACES[idx].key);
                if (face) face.classList.add('active');
                const total = totalPositions > 0 ? totalPositions : 6;
                updateHint(`Position ${idx + 1} of ${total} — Hold drone in the "${FACES[idx].label}" orientation, then click Next Position`);
            }
        }

        function markStepDone(idx) {
            const face = getFaceEl(FACES[idx].key);
            if (face) { face.classList.remove('active'); face.classList.add('done'); }
            doneCount = idx + 1;
            refreshProgress(doneCount);
        }

        // ── Attitude display ─────────────────────────────────────────────────
        function updateAttitudeDisplay(roll, pitch) {
            const box      = document.getElementById('accelAttitudeBox');
            const rollVal  = document.getElementById('accelRollVal');
            const pitchVal = document.getElementById('accelPitchVal');
            if (!box) return;
            box.style.display = 'flex';
            if (rollVal)  rollVal.textContent  = (roll  * 180 / Math.PI).toFixed(1);
            if (pitchVal) pitchVal.textContent = (pitch * 180 / Math.PI).toFixed(1);
        }

        function hideAttitudeBox() {
            const box = document.getElementById('accelAttitudeBox');
            if (box) box.style.display = 'none';
        }

        // ── Success modal ────────────────────────────────────────────────────
        function showModal() {
            const modal = document.getElementById('accelModal');
            const stat  = document.getElementById('accelModalPositions');
            if (stat)  stat.textContent = doneCount + ' / ' + (totalPositions || doneCount);
            if (modal) modal.classList.add('visible');
        }
        function hideModal() {
            const modal = document.getElementById('accelModal');
            if (modal) modal.classList.remove('visible');
        }

        // ── Position queue ────────────────────────────────────────────────────

        function dequeueNextPosition() {
            if (displayingStep || positionQueue.length === 0) return;

            const item = positionQueue.shift();
            const idx  = item.idx;

            cancelSafetyTimer();

            // Mark previous step done when backend confirms next step
            if (currentStep >= 0 && currentStep < idx) markStepDone(currentStep);

            currentStep     = idx;
            displayingStep  = true;
            waitingForDrone = false;
            lastSentWsStep  = null;   // new position — allow user to send

            hideError();

            const total = totalPositions > 0 ? totalPositions : 6;
            highlightStep(idx);
            setStatus('accelStatus', `POSITION ${idx + 1} / ${total}`, 'warn');
            toast(item.message || `Position ${idx + 1}: ${FACES[idx].label}`);
            setNextBtnNormal();

            console.log(`[CalibAccel] Step ${idx + 1}/${total} — ${FACES[idx].label}`);
        }

        // ── Reset ─────────────────────────────────────────────────────────────
        function resetAll() {
            cancelSafetyTimer();
            host.querySelectorAll('.calib-cube-face').forEach(f => f.classList.remove('done', 'active'));
            refreshProgress(0);
            currentStep = -1; doneCount = 0; totalPositions = 0;
            displayingStep = false; waitingForDrone = false;
            calibrationEnded = false; positionQueue = [];
            lastSentWsStep = null;
            activeSysId = -1; activeLinkId = -1;

            document.getElementById('accelStartBtn').style.display = 'inline-flex';
            document.getElementById('accelNextBtn').style.display  = 'none';
            document.getElementById('accelOkBtn').style.display    = 'none';

            updateHint('');
            hideError();
            hideAttitudeBox();
            hideModal();
            setStatus('accelStatus', 'NOT STARTED', 'idle');
        }

        // ── WebSocket message handler ─────────────────────────────────────────

        function handleCalibMessage(data) {
            const relevant = [
                'calibration_status', 'calibration_step', 'calibration_result',
                'calibration_error',  'calibration_timeout',
                'calib_attitude', 'attitude',
            ];
            if (!relevant.includes(data.type)) return;

            // Live attitude stream
            if (data.type === 'calib_attitude' || data.type === 'attitude') {
                updateAttitudeDisplay(data.roll, data.pitch);
                return;
            }

            console.log('[CalibAccel] WS message:', data);

            // ── Drone error: rejected echo ────────────────────────────────────
            if (data.type === 'calibration_error') {
                cancelSafetyTimer();
                showError('⚠️ ' + (data.message || 'Error — hold steady and click Next again.'));
                waitingForDrone = false;
                displayingStep  = true;
                lastSentWsStep  = null;   // allow retry
                setNextBtnNormal();
                return;
            }

            // ── Step timeout ──────────────────────────────────────────────────
            if (data.type === 'calibration_timeout') {
                cancelSafetyTimer();
                showError('⏱ ' + (data.message || 'No response — hold drone in position and click Next, or Reset.'));
                waitingForDrone = false;
                displayingStep  = true;
                lastSentWsStep  = null;
                setNextBtnNormal();
                return;
            }

            // ── New position requested by drone ───────────────────────────────
            if (data.type === 'calibration_step') {
                hideError();

                const idx = STEP_MAP[data.step];
                if (idx === undefined) { console.warn('[CalibAccel] Unknown step:', data.step); return; }

                // Deduplicate
                if (positionQueue.some(i => i.idx === idx) || (currentStep === idx && displayingStep)) {
                    console.log('[CalibAccel] Duplicate step', idx, '— ignored');
                    return;
                }

                if (data.total_steps > 0) totalPositions = data.total_steps;
                else totalPositions = Math.max(totalPositions, idx + 1);

                displayingStep = false;
                positionQueue.push({ idx, message: data.message || '' });
                refreshProgress(doneCount);
                dequeueNextPosition();
                return;
            }

            // ── vehicle_list — update drone selector ──────────────────────────────
            if (data.type === 'vehicle_list') {
                connectedVehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
                buildDroneSelector();
                return;
            }

            // ── calibration_status (started / progress) ───────────────────────
            if (data.type === 'calibration_status') {
                hideError();
                const idx = STEP_MAP[data.step];
                if (idx !== undefined) {
                    if (!positionQueue.some(i => i.idx === idx) &&
                        !(currentStep === idx && displayingStep)) {
                        if (data.total_steps > 0) totalPositions = data.total_steps;
                        else totalPositions = Math.max(totalPositions, idx + 1);
                        displayingStep = false;
                        positionQueue.push({ idx, message: data.message || '' });
                        refreshProgress(doneCount);
                        dequeueNextPosition();
                    }
                }
                if (data.step === 'started') {
                    updateHint(data.message || 'Drone ready — waiting for first position request…');
                    if (data.total_steps > 0) totalPositions = data.total_steps;
                    toast(data.message || 'Calibration started…');
                }
                return;
            }

            // ── Calibration complete or failed ────────────────────────────────
            if (data.type === 'calibration_result') {
                cancelSafetyTimer();
                displayingStep   = false;
                waitingForDrone  = false;
                positionQueue    = [];
                calibrationEnded = true;
                lastSentWsStep   = null;
                hideError();
                if (data.total_steps > 0) totalPositions = data.total_steps;

                if (data.step === 'done') {
                    if (currentStep >= 0) markStepDone(currentStep);
                    host.querySelectorAll('.calib-cube-face.active').forEach(f => f.classList.remove('active'));

                    document.getElementById('accelNextBtn').style.display = 'none';
                    document.getElementById('accelOkBtn').style.display   = 'inline-flex';
                    updateHint('');
                    setStatus('accelStatus', 'COMPLETE', 'good');
                    toast('✅ Accelerometer calibration complete!');
                }

                if (data.step === 'failed') {
                    document.getElementById('accelNextBtn').style.display  = 'none';
                    document.getElementById('accelStartBtn').style.display = 'inline-flex';
                    host.querySelectorAll('.calib-cube-face.active').forEach(f => f.classList.remove('active'));
                    currentStep = -1;
                    setStatus('accelStatus', 'FAILED', 'error');
                    showError('❌ ' + (data.message || 'Calibration failed — click Start to retry.'));
                    toast('❌ ' + (data.message || 'Calibration failed'), 'error');
                }
            }
        }

        // ── Wire up WebSocket ────────────────────────────────────────────────

        function onCalibEvent(e) { handleCalibMessage(e.detail); }
        window.addEventListener('calibration_ws_message', onCalibEvent);

        let _attachedSocket = null;
        function attachToSocket(sock) {
            if (!sock || sock === _attachedSocket) return;
            _attachedSocket = sock;
            sock.addEventListener('message', function (e) {
                let d; try { d = JSON.parse(e.data); } catch { return; }
                handleCalibMessage(d);
            });
            console.log('[CalibAccel] Attached to socket', sock.url);
        }

        attachToSocket(getLiveSocket());
        window.addEventListener('ws_connected', () => attachToSocket(getLiveSocket()));

        let _pc = 0;
        const _pt = setInterval(() => {
            const s = getLiveSocket();
            if (s) { attachToSocket(s); clearInterval(_pt); }
            else if (++_pc > 30) clearInterval(_pt);
        }, 100);

        // ── Start button ──────────────────────────────────────────────────────
        document.getElementById('accelDroneSelect')?.addEventListener('change', (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            selectedSysId  = parseInt(e.target.value, 10);
            selectedLinkId = opt ? parseInt(opt.dataset.link, 10) : -1;
            console.log('[CalibAccel] Target drone sysid=' + selectedSysId + ' link_id=' + selectedLinkId);
        });

        document.getElementById('accelStartBtn')?.addEventListener('click', () => {
            cancelSafetyTimer();
            host.querySelectorAll('.calib-cube-face').forEach(f => f.classList.remove('done', 'active'));
            refreshProgress(0);
            currentStep = -1; doneCount = 0; displayingStep = false;
            waitingForDrone = false; calibrationEnded = false;
            positionQueue = []; totalPositions = 0;
            lastSentWsStep = null;

            document.getElementById('accelStartBtn').style.display = 'none';
            document.getElementById('accelNextBtn').style.display  = 'inline-flex';
            document.getElementById('accelOkBtn').style.display    = 'none';
            setNextBtnWaiting();

            updateHint('Waiting for drone to request first position…');
            setStatus('accelStatus', 'WAITING…', 'warn');
            hideError();

            // Lock the target drone for the entire calibration session.
            // Use window.selectedSysId from multi-vehicle.js if the local
            // selector has not resolved a vehicle yet (single-drone path).
            activeSysId  = selectedSysId  > 0 ? selectedSysId  : (window.selectedSysId ?? -1);
            activeLinkId = selectedLinkId >= 0 ? selectedLinkId : -1;

            sendWS({ type: 'start_accel_calibration', sysid: activeSysId, link_id: activeLinkId });
            console.log('[CalibAccel] start_accel_calibration sent sysid=' + activeSysId + ' link_id=' + activeLinkId);
        });

        // ── Next Position button ──────────────────────────────────────────────
        document.getElementById('accelNextBtn')?.addEventListener('click', () => {
            if (calibrationEnded)  return;
            if (waitingForDrone)   return;
            if (!displayingStep)   return;
            if (currentStep < 0 || currentStep >= FACES.length) return;

            const wsStep = FACES[currentStep].wsStep;

            // Duplicate-send guard
            if (lastSentWsStep === wsStep) {
                console.warn('[CalibAccel] Duplicate send blocked — step=' + wsStep + ' already sent');
                return;
            }

            waitingForDrone = false;
            displayingStep  = false;

            setNextBtnWaiting();
            hideError();

            updateHint('Sending position to drone…');
            setStatus('accelStatus', 'CONFIRMING…', 'warn');

            lastSentWsStep = wsStep;
            sendWS({ type: 'accel_calibration_step_done', step: wsStep, sysid: activeSysId });
            waitingForDrone = true;
            console.log('[CalibAccel] → backend: accel_calibration_step_done step=' + wsStep + ' sysid=' + activeSysId);

            // Safety net: if drone goes silent for 8 s, re-enable Next button
            cancelSafetyTimer();
            safetyTimer = setTimeout(() => {
                safetyTimer = null;
                if (!calibrationEnded && !displayingStep) {
                    console.warn('[CalibAccel] Drone silent for 8 s — re-enabling Next (recovery mode)');
                    waitingForDrone = false;
                    displayingStep  = true;
                    lastSentWsStep  = null;
                    setNextBtnNormal();
                    updateHint('No response from drone — hold position and click Next, or Reset.');
                    showError('⚠️ No drone response for 8 s — retry or Reset.');
                }
            }, 8000);
        });

        // ── OK / modal / reset buttons ────────────────────────────────────────
        document.getElementById('accelOkBtn')?.addEventListener('click',         () => showModal());
        document.getElementById('accelModalOkBtn')?.addEventListener('click',    () => hideModal());
        document.getElementById('accelModalRecalBtn')?.addEventListener('click', () => resetAll());
        document.getElementById('accelModal')?.addEventListener('click', e => {
            if (e.target.id === 'accelModal') hideModal();
        });
        document.getElementById('accelResetBtn')?.addEventListener('click', () => resetAll());
    }

    window.CalibAccel = { init };
    console.log('✅ CalibAccel module ready');
})();