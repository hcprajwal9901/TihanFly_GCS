/**
 * calib-level.js  —  TiHANFly GCS  Level Calibration
 */
(function () {
    'use strict';

    const PLAY  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const CHECK = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`;
    const WARN  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function buildSuccessModal() {
        return `
        <div class="calib-modal-overlay" id="levelModal">
            <div class="calib-modal-box">
                <div class="calib-modal-icon">${CHECK}</div>
                <h3 class="calib-modal-title">Calibration Complete</h3>
                <p class="calib-modal-body">
                    Level calibration accepted by the flight controller.<br>
                    The vehicle horizon is now leveled.
                </p>
                <div class="calib-modal-actions">
                    <button class="calib-btn calib-btn-primary" id="levelModalOkBtn">OK</button>
                </div>
            </div>
        </div>`;
    }

    function render() {
        return `
<div class="settings-panel-title">Level Calibration</div>

<div class="calib-warning">
  ${WARN}
  Place the drone on a perfectly level surface. Keep the vehicle
  <strong style="color:#ffa000">completely still</strong> during the calibration.
  Do not arm the drone.
</div>

<div class="calib-card">
  <div class="calib-visual">
    <div class="calib-icon-wrap" style="background: rgba(41, 128, 185, 0.15); color: #3498db;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
        <line x1="12" y1="6" x2="12" y2="18"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
      </svg>
    </div>
    <div class="calib-meta">
      <h4>Board Level Calibration</h4>
      <p>Click <strong>Start</strong> to reset the accelerometer offsets so the current orientation is considered perfectly level.</p>
    </div>
  </div>

  <div class="calib-status-row">
    <span class="calib-status-label">Status</span>
    <span class="calib-status-value idle" id="levelStatus">NOT STARTED</span>
  </div>

  <!-- Drone selector — only visible when multiple drones are connected -->
  <div id="levelDroneSelector" class="calib-drone-selector" style="display:none; margin-top: 20px;">
    <label class="calib-drone-label">Target Drone</label>
    <select class="calib-drone-select" id="levelDroneSelect"></select>
  </div>

  <div class="calib-step-hint" id="levelStepHint"></div>

  <!-- Error banner -->
  <div class="calib-error-banner" id="levelErrorBanner" style="display:none">
    ${WARN}
    <span id="levelErrorText">Error — check connection and retry.</span>
  </div>

  <div class="calib-actions">
    <button class="calib-btn calib-btn-primary" id="levelStartBtn">${PLAY} Start Calibration</button>
  </div>
</div>

${buildSuccessModal()}
`;
    }

    function init() {
        const host = document.getElementById('panel-calib-level');
        if (!host) return;
        host.innerHTML = render();

        const SwUtilSafe = window.SwUtil || {
            setStatus(id, text, cls) {
                const el = document.getElementById(id);
                if (el) { el.textContent = text; el.className = 'calib-status-value ' + (cls || 'idle'); }
            },
            toast(msg, type) {
                console.log('[LevelCalib] Toast:', type, msg);
            }
        };

        function getLiveSocket() {
            return window.socket || window.ws || window.gcsSocket || null;
        }

        function sendWS(obj) {
            const socket = getLiveSocket();
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify(obj));
        }

        let calibrationEnded = false;
        let selectedDroneSysid = -1;

        const ui = {
            status: document.getElementById('levelStatus'),
            startBtn: document.getElementById('levelStartBtn'),
            hint: document.getElementById('levelStepHint'),
            errBanner: document.getElementById('levelErrorBanner'),
            errText: document.getElementById('levelErrorText'),
            modal: document.getElementById('levelModal'),
            modalOk: document.getElementById('levelModalOkBtn'),
            droneSelector: document.getElementById('levelDroneSelector'),
            droneSelect: document.getElementById('levelDroneSelect')
        };

        function showError(msg) {
            ui.errBanner.style.display = 'flex';
            ui.errText.textContent = msg;
            ui.startBtn.disabled = false;
        }

        function hideError() {
            ui.errBanner.style.display = 'none';
        }

        function populateDroneSelector() {
            if (!window.g_vehicles || window.g_vehicles.length === 0) {
                ui.droneSelector.style.display = 'none';
                selectedDroneSysid = -1;
                return;
            }
            if (window.g_vehicles.length === 1) {
                ui.droneSelector.style.display = 'none';
                selectedDroneSysid = window.g_vehicles[0].ui_sysid || window.g_vehicles[0].sysid;
                return;
            }
            ui.droneSelector.style.display = 'flex';
            const currentVal = ui.droneSelect.value;
            ui.droneSelect.innerHTML = '';
            
            let found = false;
            window.g_vehicles.forEach(v => {
                const opt = document.createElement('option');
                const sid = v.ui_sysid || v.sysid;
                opt.value = sid;
                opt.textContent = `Drone ${sid} (${v.type || 'Unknown'})`;
                if (sid.toString() === currentVal) {
                    opt.selected = true;
                    found = true;
                }
                ui.droneSelect.appendChild(opt);
            });
            if (!found && ui.droneSelect.options.length > 0) {
                ui.droneSelect.options[0].selected = true;
            }
            selectedDroneSysid = parseInt(ui.droneSelect.value, 10);
        }

        ui.droneSelect.addEventListener('change', () => {
            selectedDroneSysid = parseInt(ui.droneSelect.value, 10);
        });

        ui.startBtn.addEventListener('click', () => {
            hideError();
            ui.startBtn.disabled = true;
            calibrationEnded = false;
            SwUtilSafe.setStatus('levelStatus', 'STARTED', 'in-progress');
            ui.hint.innerHTML = 'Sending command to drone...';
            
            let sId = selectedDroneSysid > 0 ? selectedDroneSysid : (window.selectedSysId ?? -1);
            const payload = { type: "start_level_calibration", sysid: sId };
            sendWS(payload);
            
            // Timeout to reset if no reply
            setTimeout(() => {
                if (!calibrationEnded && ui.status.textContent === 'STARTED') {
                    showError("Timeout waiting for drone. Is it connected and disarmed?");
                    SwUtilSafe.setStatus('levelStatus', 'FAILED', 'error');
                }
            }, 15000);
        });

        ui.modalOk.addEventListener('click', () => {
            ui.modal.classList.remove('show');
            resetUI();
        });

        function resetUI() {
            calibrationEnded = true;
            hideError();
            ui.startBtn.disabled = false;
            SwUtilSafe.setStatus('levelStatus', 'NOT STARTED', 'idle');
            ui.hint.innerHTML = '';
        }

        function handleMessage(e) {
            if (!e.data || typeof e.data !== 'string') return;
            const host = document.getElementById('panel-calib-level');
            if (!host || host.offsetParent === null) return;

            try {
                const j = JSON.parse(e.data);

                if (j.type === 'calibration_status' && j.sensor === 'level') {
                    ui.hint.innerHTML = j.message || 'Waiting for level calibration to finish...';
                }

                if (j.type === 'calibration_result' && j.sensor === 'level') {
                    calibrationEnded = true;
                    if (j.step === 'done') {
                        SwUtilSafe.setStatus('levelStatus', 'DONE', 'success');
                        ui.hint.innerHTML = '';
                        ui.modal.classList.add('show');
                        ui.startBtn.disabled = false;
                    } else if (j.step === 'failed') {
                        SwUtilSafe.setStatus('levelStatus', 'FAILED', 'error');
                        showError(j.message || 'Calibration failed.');
                    }
                }

                // Check drone console for success/fail if the backend doesn't explicitly send calibration_result
                if (j.type === 'drone_console' && !calibrationEnded && ui.status.textContent === 'STARTED') {
                    const text = (j.text || "").toLowerCase();
                    // We only process if it matches the selected drone (if multi-vehicle is active)
                    if (selectedDroneSysid > 0 && j.sysid && j.sysid !== selectedDroneSysid) return;

                    if ((text.includes("calibration successful") && (text.includes("level") || text.includes("accel"))) || text.includes("trim ok:")) {
                        calibrationEnded = true;
                        SwUtilSafe.setStatus('levelStatus', 'DONE', 'success');
                        ui.hint.innerHTML = '';
                        ui.modal.classList.add('show');
                        ui.startBtn.disabled = false;
                        if (window.MsgConsole) window.MsgConsole.success('🚁 Drone Levelled');
                    } else if (text.includes("calibration failed") && text.includes("level")) {
                        calibrationEnded = true;
                        SwUtilSafe.setStatus('levelStatus', 'FAILED', 'error');
                        showError('Drone reported: ' + j.text);
                    }
                }

                // Update drone list
                if (j.type === 'vehicles_update') {
                    populateDroneSelector();
                }

            } catch (err) {}
        }

        // Attach listener globally but only act if panel is visible
        const liveSocket = getLiveSocket();
        if (liveSocket) {
            liveSocket.addEventListener('message', handleMessage);
        }

        populateDroneSelector();
    }

    window.panel_calib_level = { init };

})();
