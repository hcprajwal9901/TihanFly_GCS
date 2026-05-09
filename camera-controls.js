/**
 * camera-controls.js  —  TiHANFly GCS
 *
 * Adds three overlaid controls to the existing #videoStream panel:
 *   1. 📷 Photo Capture  — draws current MJPEG frame onto a canvas & downloads PNG
 *   2. ⏺  Video Record   — uses MediaRecorder to capture the live <img> frames
 *                          at ~15 fps via a hidden canvas, saves as WebM
 *   3. 🎮 Gimbal Panel   — pitch/tilt sliders + D-pad arrows → MAVLink
 *                          MOUNT_CONTROL / DO_MOUNT_CONTROL over WebSocket
 *
 * The gimbal button is hidden by default and becomes visible when the backend
 * sends  { type: "gimbal_status", available: true }  via WebSocket,
 * or when window.GimbalAvailable is set to true externally.
 */

const CameraControls = (() => {

    /* ── State ─────────────────────────────────────────────────────────────── */
    let recording = false;
    let recTimer = null;
    let recSeconds = 0;
    let mediaRecorder = null;
    let recordedChunks = [];
    let recCanvas = null;       // hidden canvas used during recording
    let recCtx = null;
    let recAnimFrame = null;
    let gimbalOpen = false;
    let gimbalAvail = false;

    // Gimbal state (degrees)
    let gPitch = 0;
    let gRoll = 0;
    let gYaw = 0;   // heading-lock offset

    /* ── DOM refs ─────────────────────────────────────────────────────────── */
    let imgEl;          // the live MJPEG <img> built by video-stream.js

    /* ── Build the UI (called once after VideoStream builds its own UI) ──── */
    function build() {
        const container = document.getElementById('videoStream');
        if (!container) return;

        // Grab the live frame reference
        imgEl = document.getElementById('mjpegFrame');

        _buildActionBar(container);
        _buildSnapFlash(container);
        _buildPhotoToast(container);
        _buildRecTimer(container);
        _buildGimbalPanel(container);
        _installWsListener();

        console.log('[CameraControls] UI ready');
    }

    /* ══════════════════════════════════════════════════════════════════════
       ACTION BAR  (right-side buttons: snap / record / gimbal)
    ══════════════════════════════════════════════════════════════════════ */
    function _buildActionBar(container) {
        const bar = document.createElement('div');
        bar.id = 'cameraActionBar';

        /* ── Maximize / Minimize button (adopted from #videoMaxBtn in the DOM) ── */
        const existingMaxBtn = document.getElementById('videoMaxBtn');
        if (existingMaxBtn && existingMaxBtn.parentNode) {
            // Detach from videoContainer, restyle as a cam-action-btn
            existingMaxBtn.parentNode.removeChild(existingMaxBtn);
            existingMaxBtn.className = 'cam-action-btn';
            existingMaxBtn.removeAttribute('style');   // clear any inline style from app.js
            bar.appendChild(existingMaxBtn);
        }

        /* ── Snapshot button ── */
        const snapBtn = document.createElement('button');
        snapBtn.id = 'camSnapBtn';
        snapBtn.className = 'cam-action-btn';
        snapBtn.title = 'Capture Photo';
        snapBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
            </svg>`;
        snapBtn.addEventListener('click', capturePhoto);
        bar.appendChild(snapBtn);

        /* ── Record button ── */
        const recBtn = document.createElement('button');
        recBtn.id = 'camRecordBtn';
        recBtn.className = 'cam-action-btn';
        recBtn.title = 'Start/Stop Recording';
        recBtn.innerHTML = `
            <svg id="recBtnIcon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="8" fill="#ef4444"/>
            </svg>`;
        recBtn.addEventListener('click', toggleRecord);
        bar.appendChild(recBtn);

        /* ── Gimbal toggle button ── */
        const gimbalToggle = document.createElement('button');
        gimbalToggle.id = 'camGimbalToggleBtn';
        gimbalToggle.className = 'cam-action-btn';
        gimbalToggle.title = 'Gimbal Controls';
        gimbalToggle.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="#63b3ed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
                <path d="M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
            </svg>`;
        gimbalToggle.addEventListener('click', toggleGimbalPanel);
        bar.appendChild(gimbalToggle);

        container.appendChild(bar);
    }

    /* ══════════════════════════════════════════════════════════════════════
       SNAP FLASH & TOAST
    ══════════════════════════════════════════════════════════════════════ */
    function _buildSnapFlash(container) {
        const flash = document.createElement('div');
        flash.id = 'snapFlashOverlay';
        container.appendChild(flash);
    }

    function _buildPhotoToast(container) {
        const toast = document.createElement('div');
        toast.id = 'photoSavedToast';
        toast.textContent = '📷 Photo saved';
        container.appendChild(toast);
    }

    function _flashSnap() {
        const flash = document.getElementById('snapFlashOverlay');
        if (!flash) return;
        flash.classList.add('flash');
        setTimeout(() => flash.classList.remove('flash'), 180);
    }


    /* ══════════════════════════════════════════════════════════════════════
       RECORDING TIMER BADGE
    ══════════════════════════════════════════════════════════════════════ */
    function _buildRecTimer(container) {
        const badge = document.createElement('div');
        badge.id = 'recTimerBadge';
        badge.textContent = '00:00';
        container.appendChild(badge);
    }

    function _startTimer() {
        recSeconds = 0;
        const badge = document.getElementById('recTimerBadge');
        if (badge) badge.classList.add('active');
        recTimer = setInterval(() => {
            recSeconds++;
            const m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
            const s = String(recSeconds % 60).padStart(2, '0');
            if (badge) badge.textContent = `${m}:${s}`;
        }, 1000);
    }

    function _stopTimer() {
        clearInterval(recTimer);
        recTimer = null;
        const badge = document.getElementById('recTimerBadge');
        if (badge) { badge.classList.remove('active'); badge.textContent = '00:00'; }
    }

    /* ══════════════════════════════════════════════════════════════════════
       PHOTO CAPTURE
    ══════════════════════════════════════════════════════════════════════ */
    function capturePhoto() {
        imgEl = imgEl || document.getElementById('mjpegFrame');
        if (!imgEl || !imgEl.src || imgEl.style.display === 'none') {
            _showNoStreamToast();
            return;
        }

        // Mark cross-origin so canvas won't be tainted
        imgEl.crossOrigin = 'anonymous';

        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth || 1280;
        canvas.height = imgEl.naturalHeight || 720;
        try {
            canvas.getContext('2d').drawImage(imgEl, 0, 0);
        } catch (e) {
            console.warn('[CameraControls] Canvas draw failed (taint?):', e.message);
            _showInfoToast('⚠ Could not capture frame', 'rgba(239,68,68,0.88)', 2200);
            return;
        }

        _flashSnap();

        const filename = `photo_${_timestamp()}.png`;
        canvas.toBlob((blob) => {
            if (!blob) { _showInfoToast('⚠ Canvas export failed', 'rgba(239,68,68,0.88)', 2200); return; }
            _saveViaElectron(blob, filename, 'image/png', (savedPath) => {
                const label = savedPath ? '📷 ' + savedPath.split(/[\\/]/).pop() : '📷 Photo saved';
                _showInfoToast(label, '', 2500);
            });
        }, 'image/png');

        // Notify backend
        _wsSend({ type: 'camera_capture_photo' });
        console.log('[CameraControls] Photo captured:', filename);
    }



    /* ══════════════════════════════════════════════════════════════════════
       VIDEO RECORDING  (MediaRecorder from hidden canvas)
    ══════════════════════════════════════════════════════════════════════ */
    function toggleRecord() {
        if (recording) {
            _stopRecording();
        } else {
            _startRecording();
        }
    }

    function _startRecording() {
        imgEl = imgEl || document.getElementById('mjpegFrame');
        if (!imgEl || !imgEl.src || imgEl.style.display === 'none') {
            _showNoStreamToast();
            return;
        }

        // crossOrigin must be set before the src is used in drawImage
        // so the canvas doesn't get tainted by the MJPEG HTTP stream.
        imgEl.crossOrigin = 'anonymous';

        recCanvas = document.createElement('canvas');
        recCanvas.width = imgEl.naturalWidth || 1280;
        recCanvas.height = imgEl.naturalHeight || 720;
        recCtx = recCanvas.getContext('2d');

        // Check browser support
        if (!window.MediaRecorder) {
            alert('MediaRecorder API not supported in this browser/Electron version.');
            return;
        }

        const stream = recCanvas.captureStream(15);   // 15 fps
        const mimeType = _getSupportedMime();

        try {
            mediaRecorder = new MediaRecorder(stream, { mimeType });
        } catch (e) {
            console.error('[CameraControls] MediaRecorder init failed:', e);
            alert('Could not start recording: ' + e.message);
            return;
        }

        recordedChunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = _saveRecording;
        mediaRecorder.start(200);   // collect data every 200 ms

        // Draw frames
        function drawFrame() {
            if (!recording) return;
            try { recCtx.drawImage(imgEl, 0, 0, recCanvas.width, recCanvas.height); } catch (_) { }
            recAnimFrame = requestAnimationFrame(drawFrame);
        }
        recording = true;
        drawFrame();

        // UI update
        const recBtn = document.getElementById('camRecordBtn');
        if (recBtn) {
            recBtn.classList.add('recording');
            recBtn.title = 'Stop Recording';
            recBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>`;
        }
        _startTimer();
        _wsSend({ type: 'camera_record_start' });
        console.log('[CameraControls] Recording started');
    }

    function _stopRecording() {
        if (!recording) return;
        recording = false;
        cancelAnimationFrame(recAnimFrame);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        _stopTimer();

        const recBtn = document.getElementById('camRecordBtn');
        if (recBtn) {
            recBtn.classList.remove('recording');
            recBtn.title = 'Start/Stop Recording';
            recBtn.innerHTML = `
                <svg id="recBtnIcon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="8" fill="#ef4444"/>
                </svg>`;
        }
        _wsSend({ type: 'camera_record_stop' });
        console.log('[CameraControls] Recording stopped');
    }

    function _saveRecording() {
        if (!recordedChunks.length) {
            console.warn('[CameraControls] No recorded chunks — nothing to save.');
            return;
        }
        const mimeType = mediaRecorder ? mediaRecorder.mimeType : 'video/webm';
        const blob = new Blob(recordedChunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const filename = `rec_${_timestamp()}.${ext}`;

        _saveViaElectron(blob, filename, mimeType, (savedPath) => {
            const label = savedPath ? '⏺ Saved: ' + savedPath.split(/[\\/]/).pop() : '⏺ Recording saved';
            _showInfoToast(label, 'rgba(99,179,237,0.92)', 3000);
        });
    }

    function _getSupportedMime() {
        const types = [
            'video/mp4;codecs=avc1',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ];
        for (const t of types) {
            if (MediaRecorder.isTypeSupported(t)) return t;
        }
        return 'video/webm';
    }

    /* ══════════════════════════════════════════════════════════════════════
       GIMBAL PANEL
    ══════════════════════════════════════════════════════════════════════ */
    function _buildGimbalPanel(container) {
        const panel = document.createElement('div');
        panel.id = 'gimbalPanel';

        panel.innerHTML = `
            <div class="gimbal-panel-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
                </svg>
                Gimbal Control
                <div class="gimbal-mode-row" style="margin-left:auto;">
                    <span class="gimbal-mode-dot" id="gimbalModeDot"></span>
                    <span id="gimbalModeText">FOLLOW</span>
                </div>
            </div>

            <!-- D-Pad -->
            <div class="gimbal-joystick-wrap">
                <div class="gimbal-dpad">
                    <div class="dpad-btn dpad-empty"></div>
                    <div class="dpad-btn" id="dpadUp"    title="Tilt Up">▲</div>
                    <div class="dpad-btn dpad-empty"></div>

                    <div class="dpad-btn" id="dpadLeft"  title="Pan Left">◀</div>
                    <div class="dpad-btn dpad-center" id="dpadCenter" title="Center Gimbal">CTR</div>
                    <div class="dpad-btn" id="dpadRight" title="Pan Right">▶</div>

                    <div class="dpad-btn dpad-empty"></div>
                    <div class="dpad-btn" id="dpadDown"  title="Tilt Down">▼</div>
                    <div class="dpad-btn dpad-empty"></div>
                </div>
            </div>

            <!-- Pitch slider -->
            <div class="gimbal-sliders">
                <div class="gimbal-slider-row">
                    <div class="gimbal-slider-label">PITCH<span id="pitchValLabel">0°</span></div>
                    <input type="range" class="gimbal-range" id="gimbalPitchSlider"
                           min="-90" max="30" value="0" step="1">
                    <span class="gimbal-value-badge" id="gimbalPitchVal">0°</span>
                </div>
                <div class="gimbal-slider-row">
                    <div class="gimbal-slider-label">ROLL<span id="rollValLabel">0°</span></div>
                    <input type="range" class="gimbal-range" id="gimbalRollSlider"
                           min="-45" max="45" value="0" step="1">
                    <span class="gimbal-value-badge" id="gimbalRollVal">0°</span>
                </div>
                <div class="gimbal-slider-row">
                    <div class="gimbal-slider-label">YAW<span id="yawValLabel">0°</span></div>
                    <input type="range" class="gimbal-range" id="gimbalYawSlider"
                           min="-180" max="180" value="0" step="1">
                    <span class="gimbal-value-badge" id="gimbalYawVal">0°</span>
                </div>
            </div>

            <!-- Action buttons -->
            <div class="gimbal-actions">
                <button class="gimbal-action-btn" id="gimbalCenterBtn">⟳ Center</button>
                <button class="gimbal-action-btn" id="gimbalModeBtn">⇌ Follow</button>
                <button class="gimbal-action-btn" id="gimbalLockBtn">🔒 Lock</button>
            </div>
        `;

        container.appendChild(panel);
        _wireGimbalUI();
    }

    function _wireGimbalUI() {
        /* Sliders */
        const pitchSlider = document.getElementById('gimbalPitchSlider');
        const rollSlider = document.getElementById('gimbalRollSlider');
        const yawSlider = document.getElementById('gimbalYawSlider');

        if (pitchSlider) {
            pitchSlider.addEventListener('input', () => {
                gPitch = parseInt(pitchSlider.value);
                _updateValBadge('gimbalPitchVal', gPitch);
                _sendGimbalCommand();
            });
        }
        if (rollSlider) {
            rollSlider.addEventListener('input', () => {
                gRoll = parseInt(rollSlider.value);
                _updateValBadge('gimbalRollVal', gRoll);
                _sendGimbalCommand();
            });
        }
        if (yawSlider) {
            yawSlider.addEventListener('input', () => {
                gYaw = parseInt(yawSlider.value);
                _updateValBadge('gimbalYawVal', gYaw);
                _sendGimbalCommand();
            });
        }

        /* D-pad — press-and-hold */
        const STEP = 5;     // degrees per tick
        const HOLD_MS = 120;
        let dpadInterval = null;

        function dpadStart(direction) {
            dpadTick(direction);
            dpadInterval = setInterval(() => dpadTick(direction), HOLD_MS);
        }

        function dpadStop() {
            clearInterval(dpadInterval);
            dpadInterval = null;
        }

        function dpadTick(dir) {
            if (dir === 'up') gPitch = Math.min(30, gPitch + STEP);
            if (dir === 'down') gPitch = Math.max(-90, gPitch - STEP);
            if (dir === 'left') gYaw = Math.max(-180, gYaw - STEP);
            if (dir === 'right') gYaw = Math.min(180, gYaw + STEP);
            _syncSlidersFromState();
            _sendGimbalCommand();
        }

        ['up', 'down', 'left', 'right'].forEach(dir => {
            const btn = document.getElementById(`dpad${dir.charAt(0).toUpperCase() + dir.slice(1)}`);
            if (!btn) return;
            btn.addEventListener('mousedown', () => dpadStart(dir));
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); dpadStart(dir); });
        });
        document.addEventListener('mouseup', dpadStop);
        document.addEventListener('touchend', dpadStop);

        /* Center button */
        const centerBtn = document.getElementById('dpadCenter');
        if (centerBtn) centerBtn.addEventListener('click', centerGimbal);

        const centerBtn2 = document.getElementById('gimbalCenterBtn');
        if (centerBtn2) centerBtn2.addEventListener('click', centerGimbal);

        /* Mode toggle */
        const modeBtn = document.getElementById('gimbalModeBtn');
        let followMode = true;
        if (modeBtn) {
            modeBtn.addEventListener('click', () => {
                followMode = !followMode;
                modeBtn.textContent = followMode ? '⇌ Follow' : '⊗ Locked';
                modeBtn.classList.toggle('active', !followMode);
                _updateGimbalModeIndicator(followMode ? 'follow' : 'lock');
                _wsSend({ type: 'gimbal_set_mode', mode: followMode ? 'follow' : 'lock' });
            });
        }

        /* Lock button */
        const lockBtn = document.getElementById('gimbalLockBtn');
        let locked = false;
        if (lockBtn) {
            lockBtn.addEventListener('click', () => {
                locked = !locked;
                lockBtn.classList.toggle('active', locked);
                lockBtn.textContent = locked ? '🔓 Unlock' : '🔒 Lock';
                _wsSend({ type: 'gimbal_set_lock', locked });
            });
        }
    }

    function _syncSlidersFromState() {
        const ps = document.getElementById('gimbalPitchSlider');
        const rs = document.getElementById('gimbalRollSlider');
        const ys = document.getElementById('gimbalYawSlider');
        if (ps) ps.value = gPitch;
        if (rs) rs.value = gRoll;
        if (ys) ys.value = gYaw;
        _updateValBadge('gimbalPitchVal', gPitch);
        _updateValBadge('gimbalRollVal', gRoll);
        _updateValBadge('gimbalYawVal', gYaw);
    }

    function _updateValBadge(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val + '°';
    }

    function _updateGimbalModeIndicator(mode) {
        const dot = document.getElementById('gimbalModeDot');
        const text = document.getElementById('gimbalModeText');
        if (!dot || !text) return;
        dot.className = 'gimbal-mode-dot ' + (mode === 'follow' ? '' : 'lock');
        text.textContent = mode === 'follow' ? 'FOLLOW' : 'LOCK';
    }

    function centerGimbal() {
        gPitch = 0; gRoll = 0; gYaw = 0;
        _syncSlidersFromState();
        _sendGimbalCommand();
        _wsSend({ type: 'gimbal_center' });
        console.log('[CameraControls] Gimbal centered');
    }

    function toggleGimbalPanel() {
        gimbalOpen = !gimbalOpen;
        const panel = document.getElementById('gimbalPanel');
        const btn = document.getElementById('camGimbalToggleBtn');
        if (panel) panel.classList.toggle('open', gimbalOpen);
        if (btn) btn.classList.toggle('gimbal-open', gimbalOpen);
    }

    /* MAVLink-style command: send pitch/roll/yaw to backend */
    function _sendGimbalCommand() {
        _wsSend({
            type: 'gimbal_control',
            pitch: gPitch,
            roll: gRoll,
            yaw: gYaw
        });
    }

    /* ══════════════════════════════════════════════════════════════════════
       WS LISTENER  (detect gimbal_status from backend)
    ══════════════════════════════════════════════════════════════════════ */
    function _installWsListener() {
        window.addEventListener('message', (e) => {
            // Electron IPC passthrough — ignored unless it's our own format
        });

        // Intercept via the patched WebSocket (already active in MainWindow.html)
        const origRoute = window.__cameraControlsRouteInstalled;
        if (origRoute) return;
        window.__cameraControlsRouteInstalled = true;

        window.addEventListener('ws_message', (evt) => {
            const msg = evt.detail;
            if (!msg) return;
            if (msg.type === 'gimbal_status') {
                setGimbalAvailable(msg.available !== false);
            }
            if (msg.type === 'gimbal_angles') {
                // Sync sliders if backend sends current angles
                if (msg.pitch !== undefined) gPitch = msg.pitch;
                if (msg.roll !== undefined) gRoll = msg.roll;
                if (msg.yaw !== undefined) gYaw = msg.yaw;
                _syncSlidersFromState();
            }
        });

        // Also poll the WebSocket directly
        const _oldRoute = window.__mvRouteMessages;
        if (!_oldRoute) {
            // Patch the global routeMessages that was installed in MainWindow.html
            window.__mv_sockets.forEach(ws => {
                ws.addEventListener('message', (event) => {
                    let msg;
                    try { msg = JSON.parse(event.data); } catch (e) { return; }
                    if (!msg) return;
                    if (msg.type === 'gimbal_status') setGimbalAvailable(msg.available !== false);
                    if (msg.type === 'gimbal_angles') {
                        if (msg.pitch !== undefined) gPitch = msg.pitch;
                        if (msg.roll !== undefined) gRoll = msg.roll;
                        if (msg.yaw !== undefined) gYaw = msg.yaw;
                        _syncSlidersFromState();
                    }
                });
            });
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
       HELPERS
    ══════════════════════════════════════════════════════════════════════ */
    function _wsSend(obj) {
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify(obj));
        } else {
            console.warn('[CameraControls] WS not ready, dropped:', obj.type);
        }
    }

    function _timestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    }

    /**
     * Save a Blob via Electron's native Save dialog (IPC → main process → fs.writeFileSync).
     * Falls back to <a>.click() when running in a normal browser.
     * @param {Blob}     blob        — data to save
     * @param {string}   defaultName — suggested filename
     * @param {string}   mimeType    — MIME type for dialog filter
     * @param {Function} onDone      — callback(savedPath|null)
     */
    function _saveViaElectron(blob, defaultName, mimeType, onDone) {
        const reader = new FileReader();
        reader.onloadend = async () => {
            // reader.result = "data:<mime>;base64,<data>"
            const base64Data = reader.result.split(',')[1];

            if (window.electronSaveFile && typeof window.electronSaveFile.save === 'function') {
                // ── Electron path (native Save dialog) ──────────────────────
                try {
                    const result = await window.electronSaveFile.save({ defaultName, base64Data, mimeType });
                    if (result && result.ok) {
                        console.log('[CameraControls] File saved via Electron:', result.filePath);
                        if (onDone) onDone(result.filePath);
                    } else if (result && result.canceled) {
                        console.log('[CameraControls] Save canceled by user.');
                        if (onDone) onDone(null);
                    } else {
                        console.error('[CameraControls] Save error:', result && result.error);
                        _showInfoToast('⚠ Save failed: ' + (result && result.error || 'unknown'), 'rgba(239,68,68,0.88)', 3000);
                        if (onDone) onDone(null);
                    }
                } catch (err) {
                    console.error('[CameraControls] IPC save_file threw:', err);
                    _showInfoToast('⚠ Save error: ' + err.message, 'rgba(239,68,68,0.88)', 3000);
                    if (onDone) onDone(null);
                }
            } else {
                // ── Browser fallback (<a> download) ─────────────────────────
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = defaultName;
                link.href = url;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                console.log('[CameraControls] File download triggered (browser fallback):', defaultName);
                if (onDone) onDone(defaultName);
            }
        };
        reader.readAsDataURL(blob);
    }

    /**
     * Show the shared toast notification with a custom background color.
     * @param {string} text        — message to display
     * @param {string} [bgColor]   — CSS color; leave blank for the default green
     * @param {number} [duration]  — ms to show (default 2500)
     */
    function _showInfoToast(text, bgColor, duration) {
        const toast = document.getElementById('photoSavedToast');
        if (!toast) return;
        const prevBg = toast.style.background;
        const prevText = toast.textContent;
        if (bgColor) toast.style.background = bgColor;
        toast.textContent = text;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            toast.style.background = prevBg;
            toast.textContent = prevText;
        }, duration || 2500);
    }

    function _showNoStreamToast() {
        _showInfoToast('⚠ No live stream active', 'rgba(239,68,68,0.88)', 2200);
    }

    /* ══════════════════════════════════════════════════════════════════════
       PUBLIC API
    ══════════════════════════════════════════════════════════════════════ */
    function setGimbalAvailable(avail) {
        gimbalAvail = avail;
        const btn = document.getElementById('camGimbalToggleBtn');
        if (!btn) return;
        btn.classList.toggle('gimbal-available', avail);
        if (!avail && gimbalOpen) {
            gimbalOpen = false;
            const panel = document.getElementById('gimbalPanel');
            if (panel) panel.classList.remove('open');
        }
        console.log('[CameraControls] Gimbal available:', avail);
    }

    return {
        init: build,
        capturePhoto,
        toggleRecord,
        startRecord: _startRecording,
        stopRecord: _stopRecording,
        centerGimbal,
        setGimbalAvailable,
        isRecording: () => recording,
        isGimbalAvailable: () => gimbalAvail,
    };

})();

/* ── Auto-init (after VideoStream has built its UI) ─────────────────────── */
function _initCameraControls() {
    // Delay slightly to let video-stream.js finish building #videoStream
    setTimeout(() => {
        CameraControls.init();
        // Expose globally so devtools / other modules can call it
        window.CameraControls = CameraControls;
        // Allow external forced gimbal enable (e.g. from app.js after checking params)
        if (window.GimbalAvailable === true) CameraControls.setGimbalAvailable(true);
    }, 400);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCameraControls);
} else {
    _initCameraControls();
}
