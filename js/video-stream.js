/**
 * video-stream.js — TiHANFly GCS
 *
 * Simple RTSP live video using Python MJPEG server (no ffmpeg, no JSMpeg).
 *
 * Flow:
 *   1. User enters rtsp://... and clicks CONNECT
 *   2. Frontend sends {type:"start_video", rtsp_url:"..."} over existing WebSocket
 *   3. C++ backend spawns video_server.py which reads RTSP via OpenCV
 *      and serves MJPEG on http://localhost:5001/video
 *   4. Frontend shows <img src="http://localhost:5001/video"> — done!
 *
 * Requirements:  pip install opencv-python
 */

const VideoStreamController = (() => {

    // ── State ─────────────────────────────────────────────────────────────────
    let connected = false;
    let uiBuilt   = false;
    const MJPEG_URL = 'http://localhost:5001/video';
    const VIDEO_PORT = 5001;

    // ── DOM refs ──────────────────────────────────────────────────────────────
    let imgEl, statusDot, statusText, rtspInput, connectBtn, disconnectBtn, statusBadge;

    // ─────────────────────────────────────────────────────────────────────────
    //  Build the UI
    // ─────────────────────────────────────────────────────────────────────────
    function buildUI() {
        const container = document.getElementById('videoStream');
        if (!container || uiBuilt) return;
        uiBuilt = true;

        container.style.cssText = `
            position: relative;
            width: 100%; height: 100%;
            background: #000;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            overflow: hidden;
        `;

        // ── Live video image ──────────────────────────────────────────────────
        imgEl = document.createElement('img');
        imgEl.id  = 'mjpegFrame';
        imgEl.alt = '';
        imgEl.style.cssText = `
            width: 100%; height: 100%;
            object-fit: contain;
            display: none;
            background: #000;
        `;
        imgEl.onerror = () => {
            // Stream dropped
            if (connected) {
                setStatus('NO SIGNAL', false);
                imgEl.style.display = 'none';
                connected = false;
                if (connectBtn)    { connectBtn.style.display = 'inline-block'; connectBtn.disabled = false; }
                if (disconnectBtn) disconnectBtn.style.display = 'none';
            }
        };
        container.appendChild(imgEl);

        // ── No-signal placeholder ─────────────────────────────────────────────
        const placeholder = document.createElement('div');
        placeholder.id = 'noSignalPlaceholder';
        placeholder.style.cssText = `
            position: absolute;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 10px; pointer-events: none;
        `;
        placeholder.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            <span style="color:rgba(255,255,255,0.25);font-size:12px;font-family:'JetBrains Mono',monospace;letter-spacing:1px;">NO SIGNAL</span>
        `;
        container.appendChild(placeholder);

        // ── Control overlay ───────────────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = 'rtspOverlay';
        overlay.style.cssText = `
            position: absolute;
            bottom: 0; left: 0; right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.85));
            padding: 12px 14px 10px;
            display: flex; align-items: center; gap: 8px;
            transition: opacity 0.3s;
        `;

        // Status badge
        const badge = document.createElement('div');
        badge.style.cssText = `
            display: flex; align-items: center; gap: 6px;
            background: rgba(0,0,0,0.55);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 20px; padding: 4px 10px; flex-shrink: 0;
        `;
        statusDot = document.createElement('span');
        statusDot.style.cssText = `
            width: 8px; height: 8px; border-radius: 50%;
            background: #555; display: inline-block; transition: background 0.3s;
        `;
        statusText = document.createElement('span');
        statusText.style.cssText = `
            font-size: 11px; font-weight: 700; letter-spacing: 1px;
            color: #aaa; font-family: 'JetBrains Mono', monospace;
        `;
        statusText.textContent = 'NO SIGNAL';
        badge.appendChild(statusDot);
        badge.appendChild(statusText);
        overlay.appendChild(badge);

        // RTSP URL input
        rtspInput = document.createElement('input');
        rtspInput.type = 'text';
        rtspInput.id   = 'rtspUrlInput';
        rtspInput.placeholder = 'rtsp://192.168.1.10:554/stream  or  rtmp://host/app/stream';
        rtspInput.value = localStorage.getItem('gcs_rtsp_url') || '';
        rtspInput.style.cssText = `
            flex: 1;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 6px; color: #e0e0e0;
            font-size: 12px; font-family: 'JetBrains Mono', monospace;
            padding: 5px 10px; outline: none; min-width: 0;
        `;
        rtspInput.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
        overlay.appendChild(rtspInput);

        // Connect button
        connectBtn = document.createElement('button');
        connectBtn.textContent = '▶ CONNECT';
        connectBtn.id = 'rtspConnectBtn';
        connectBtn.style.cssText = `
            background: linear-gradient(135deg, #22c55e, #16a34a);
            border: none; border-radius: 6px;
            color: #fff; font-size: 11px; font-weight: 700;
            letter-spacing: 0.8px; padding: 5px 12px; cursor: pointer;
            white-space: nowrap; transition: opacity 0.2s;
            font-family: 'JetBrains Mono', monospace;
        `;
        connectBtn.addEventListener('click', connect);
        overlay.appendChild(connectBtn);

        // Disconnect button
        disconnectBtn = document.createElement('button');
        disconnectBtn.textContent = '■ STOP';
        disconnectBtn.id = 'rtspDisconnectBtn';
        disconnectBtn.style.cssText = `
            background: linear-gradient(135deg, #ef4444, #b91c1c);
            border: none; border-radius: 6px;
            color: #fff; font-size: 11px; font-weight: 700;
            letter-spacing: 0.8px; padding: 5px 12px; cursor: pointer;
            white-space: nowrap; display: none; transition: opacity 0.2s;
            font-family: 'JetBrains Mono', monospace;
        `;
        disconnectBtn.addEventListener('click', disconnect);
        overlay.appendChild(disconnectBtn);

        container.appendChild(overlay);

        // Fade overlay when mouse leaves
        container.addEventListener('mouseenter', () => overlay.style.opacity = '1');
        container.addEventListener('mouseleave', () => overlay.style.opacity = '0.25');
        overlay.style.opacity = '0.25';

        // Listen for video_status reply from C++ backend
        _installWsListener();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Listen for video_status events dispatched by websocket.js
    //  Using a CustomEvent on window is reconnect-safe — no need to re-attach
    //  when window.ws is replaced after a backend disconnect/reconnect.
    // ─────────────────────────────────────────────────────────────────────────
    function _installWsListener() {
        window.addEventListener('video_status', (evt) => {
            const msg = evt.detail;
            if (!msg) return;
            if (msg.status === 'ready') {
                _showStream(msg.url || MJPEG_URL);
            } else if (msg.status === 'stopped') {
                _hideStream();
            } else if (msg.status === 'error') {
                setStatus('ERROR', false);
                if (connectBtn) connectBtn.disabled = false;
                console.error('[VideoStream] Backend error:', msg.message);
                window.MsgConsole?.error('Video: ' + msg.message);
            }
        });
        console.log('[VideoStream] WS listener installed');
    }


    // ─────────────────────────────────────────────────────────────────────────
    //  Connect
    // ─────────────────────────────────────────────────────────────────────────
    function connect() {
        const url = rtspInput ? rtspInput.value.trim() : '';
        if (!url) { alert('Please enter an RTSP URL.'); return; }

        localStorage.setItem('gcs_rtsp_url', url);

        setStatus('CONNECTING…', false);
        if (connectBtn)    { connectBtn.disabled = true; }
        if (disconnectBtn) disconnectBtn.style.display = 'none';

        // Ask C++ backend to spawn video_server.py
        _wsSend({ type: 'start_video', rtsp_url: url });
        console.log('[VideoStream] Sent start_video:', url);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Disconnect
    // ─────────────────────────────────────────────────────────────────────────
    function disconnect() {
        _wsSend({ type: 'stop_video' });
        _hideStream();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────────
    function _showStream(url) {
        connected = true;
        let retryCount = 0;
        const MAX_RETRIES = 6;

        const placeholder = document.getElementById('noSignalPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
        setStatus('CONNECTING…', false);

        function tryLoad() {
            imgEl.src = '';                         // clear first to force reload
            imgEl.src = url + '?t=' + Date.now();
        }

        imgEl.onload = () => {
            // First frame arrived — stream is live
            setStatus('LIVE', true);
            if (connectBtn)    { connectBtn.style.display = 'none'; connectBtn.disabled = false; }
            if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
        };

        imgEl.onerror = () => {
            if (connected && retryCount < MAX_RETRIES) {
                retryCount++;
                console.log(`[VideoStream] img load failed, retry ${retryCount}/${MAX_RETRIES} in 1s…`);
                setStatus(`STARTING… (${retryCount}/${MAX_RETRIES})`, false);
                setTimeout(tryLoad, 1000);
            } else {
                // Give up
                connected = false;
                imgEl.style.display = 'none';
                if (placeholder) placeholder.style.display = 'flex';
                setStatus('NO SIGNAL', false);
                if (connectBtn)    { connectBtn.style.display = 'inline-block'; connectBtn.disabled = false; }
                if (disconnectBtn) disconnectBtn.style.display = 'none';
                console.error('[VideoStream] Stream failed after retries.');
            }
        };

        imgEl.style.display = 'block';
        tryLoad();
    }

    function _hideStream() {
        connected = false;
        imgEl.src = '';
        imgEl.style.display = 'none';

        const placeholder = document.getElementById('noSignalPlaceholder');
        if (placeholder) placeholder.style.display = 'flex';

        setStatus('NO SIGNAL', false);
        if (connectBtn)    { connectBtn.style.display = 'inline-block'; connectBtn.disabled = false; }
        if (disconnectBtn) disconnectBtn.style.display = 'none';
    }

    function _wsSend(obj) {
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify(obj));
        } else {
            console.warn('[VideoStream] WebSocket not ready, command dropped:', obj.type);
        }
    }

    function setStatus(label, live) {
        if (statusDot)  statusDot.style.background  = live ? '#22c55e' : '#555';
        if (statusText) {
            statusText.textContent = label;
            statusText.style.color = live ? '#22c55e' : '#aaa';
        }
        if (statusBadge) {
            statusBadge.classList.toggle('live',      live);
            statusBadge.classList.toggle('no-signal', !live);
            const s = statusBadge.querySelector('span');
            if (s) s.textContent = label;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Public API (backward-compatible)
    // ─────────────────────────────────────────────────────────────────────────
    return {
        init()          { buildUI(); },
        connect,
        disconnect,
        isStreaming()   { return connected; },
        setRtspUrl(u)   { if (rtspInput) rtspInput.value = u; },
        getRtspUrl()    { return rtspInput ? rtspInput.value : ''; },
        takeSnapshot() {
            if (!imgEl || !imgEl.src) { alert('No video active.'); return null; }
            // Draw current frame onto a canvas and download
            const canvas = document.createElement('canvas');
            canvas.width  = imgEl.naturalWidth  || 1280;
            canvas.height = imgEl.naturalHeight || 720;
            canvas.getContext('2d').drawImage(imgEl, 0, 0);
            const link = document.createElement('a');
            link.download = `snapshot_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            return link.href;
        }
    };

})();

/* ── Backward-compatible shim ──────────────────────────────────────────────── */
window.VideoStream = {
    connect:      () => VideoStreamController.connect(),
    disconnect:   () => VideoStreamController.disconnect(),
    reconnect:    () => VideoStreamController.connect(),
    isStreaming:  () => VideoStreamController.isStreaming(),
    takeSnapshot: () => VideoStreamController.takeSnapshot(),
    setRtspUrl:   (u) => VideoStreamController.setRtspUrl(u),
    getRtspUrl:   () => VideoStreamController.getRtspUrl(),
};

/* ── Auto-init ─────────────────────────────────────────────────────────────── */
function _initVideoStream() {
    VideoStreamController.init();
    console.log('[VideoStream] RTSP video stream controller ready');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initVideoStream);
} else {
    _initVideoStream();
}
