/**
 * video-stream.js — TiHANFly GCS
 * Low-latency RTSP live video player using JSMpeg.
 *
 * Flow:
 *   User enters rtsp://... URL in the panel
 *   → Electron main process spawns ffmpeg (RTSP → MPEG1 → stdout)
 *   → ffmpeg stdout piped to WebSocket server on localhost:9999
 *   → JSMpeg in this renderer connects to ws://localhost:9999
 *   → Decoded frames rendered into a <canvas> element
 *
 * Latency: ~150–400 ms (network + ffmpeg buffer).
 * No Python, no webcam, no browser getUserMedia.
 */

/* ============================================================================
   JSMpeg v1.0 — bundled inline (MIT licence, github.com/phoboslab/jsmpeg)
   We embed it here so the app works fully offline without CDN.
   Source: https://jsmpeg.com/jsmpeg.min.js
   ============================================================================ */
/* eslint-disable */
// JSMpeg will be loaded from the local file js/jsmpeg.min.js
// If that file doesn't exist yet the loader below will create a <script> tag
// pointing to the CDN fallback.

(function ensureJSMpeg() {
    if (window.JSMpeg) return; // already loaded

    // Try local copy first
    const local = document.createElement('script');
    local.src   = 'js/jsmpeg.min.js';
    local.async = false;

    local.onerror = () => {
        // Fall back to CDN
        console.warn('[VideoStream] Local jsmpeg not found, loading from CDN…');
        const cdn = document.createElement('script');
        cdn.src   = 'https://jsmpeg.com/jsmpeg.min.js';
        cdn.async = false;
        cdn.onload = () => { console.log('[VideoStream] JSMpeg loaded from CDN'); VideoStreamController.onJSMpegReady(); };
        cdn.onerror = () => console.error('[VideoStream] Failed to load JSMpeg from CDN too!');
        document.head.appendChild(cdn);
    };

    local.onload = () => {
        console.log('[VideoStream] JSMpeg loaded from local copy');
        VideoStreamController.onJSMpegReady();
    };

    document.head.appendChild(local);
})();

/* ============================================================================
   VideoStreamController — singleton that manages the player lifecycle
   ============================================================================ */

const VideoStreamController = (() => {

    // ── State ─────────────────────────────────────────────────────────────────
    let player       = null;   // JSMpeg player instance
    let wsPort       = 9999;
    let currentRtsp  = '';
    let connected    = false;
    let retryTimer   = null;
    let uiBuilt      = false;

    // ── DOM refs (populated in buildUI) ───────────────────────────────────────
    let canvas, statusBadge, statusDot, statusText, rtspInput, connectBtn, disconnectBtn;

    // ─────────────────────────────────────────────────────────────────────────
    //  Build the UI inside #videoStream
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

        // ── Canvas for JSMpeg ─────────────────────────────────────────────────
        canvas = document.createElement('canvas');
        canvas.id = 'rtspCanvas';
        canvas.style.cssText = `
            width: 100%; height: 100%;
            object-fit: contain;
            display: block;
            background: #000;
        `;
        container.appendChild(canvas);

        // ── Control overlay ───────────────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = 'rtspOverlay';
        overlay.style.cssText = `
            position: absolute;
            bottom: 0; left: 0; right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.85));
            padding: 12px 14px 10px;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: opacity 0.3s;
        `;

        // Status badge (inside overlay)
        const badge = document.createElement('div');
        badge.style.cssText = `
            display: flex; align-items: center; gap: 6px;
            background: rgba(0,0,0,0.55);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 20px;
            padding: 4px 10px;
            flex-shrink: 0;
        `;

        statusDot = document.createElement('span');
        statusDot.style.cssText = `
            width: 8px; height: 8px; border-radius: 50%;
            background: #555; display: inline-block;
            transition: background 0.3s;
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
        rtspInput.placeholder = 'rtsp://192.168.1.10:554/stream';
        rtspInput.value = localStorage.getItem('gcs_rtsp_url') || '';
        rtspInput.style.cssText = `
            flex: 1;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 6px;
            color: #e0e0e0;
            font-size: 12px;
            font-family: 'JetBrains Mono', monospace;
            padding: 5px 10px;
            outline: none;
            min-width: 0;
        `;
        rtspInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') connect();
        });
        overlay.appendChild(rtspInput);

        // Connect button
        connectBtn = document.createElement('button');
        connectBtn.textContent = '▶ CONNECT';
        connectBtn.id = 'rtspConnectBtn';
        connectBtn.style.cssText = `
            background: linear-gradient(135deg, #22c55e, #16a34a);
            border: none; border-radius: 6px;
            color: #fff; font-size: 11px; font-weight: 700;
            letter-spacing: 0.8px;
            padding: 5px 12px; cursor: pointer;
            white-space: nowrap;
            transition: opacity 0.2s;
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
            letter-spacing: 0.8px;
            padding: 5px 12px; cursor: pointer;
            white-space: nowrap;
            display: none;
            transition: opacity 0.2s;
            font-family: 'JetBrains Mono', monospace;
        `;
        disconnectBtn.addEventListener('click', disconnect);
        overlay.appendChild(disconnectBtn);

        container.appendChild(overlay);

        // Hide overlay when mouse leaves container for clean look
        container.addEventListener('mouseenter', () => overlay.style.opacity = '1');
        container.addEventListener('mouseleave', () => overlay.style.opacity = '0.25');
        overlay.style.opacity = '0.25';

        // Also update the outer .video-status badge if it exists
        statusBadge = document.querySelector('.video-status');
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Status helpers
    // ─────────────────────────────────────────────────────────────────────────
    function setStatus(label, live) {
        if (statusDot)  { statusDot.style.background  = live ? '#22c55e' : '#555'; }
        if (statusText) { statusText.textContent = label; statusText.style.color = live ? '#22c55e' : '#aaa'; }

        // Also sync the outer overlay badge
        if (statusBadge) {
            statusBadge.classList.toggle('live',      live);
            statusBadge.classList.toggle('no-signal', !live);
            const s = statusBadge.querySelector('span');
            if (s) s.textContent = label;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Connect: start relay + JSMpeg player
    // ─────────────────────────────────────────────────────────────────────────
    async function connect() {
        const rtspUrl = rtspInput ? rtspInput.value.trim() : currentRtsp;
        if (!rtspUrl) { alert('Please enter an RTSP URL.'); return; }

        // Save for next session
        localStorage.setItem('gcs_rtsp_url', rtspUrl);
        currentRtsp = rtspUrl;

        setStatus('CONNECTING…', false);
        if (connectBtn)    connectBtn.disabled = true;
        if (disconnectBtn) disconnectBtn.style.display = 'none';

        // 1. Tell Electron main process to start ffmpeg relay
        if (window.electronRTSP) {
            const result = await window.electronRTSP.start(rtspUrl, wsPort);
            if (!result.ok) {
                console.error('[VideoStream] Relay start failed:', result.error);
                setStatus('ERROR', false);
                if (connectBtn) connectBtn.disabled = false;
                return;
            }
        } else {
            console.warn('[VideoStream] electronRTSP IPC not available – running in browser preview mode');
        }

        // 2. Wait briefly for ffmpeg to buffer first frames
        await new Promise(r => setTimeout(r, 1500));

        // 3. Start JSMpeg player
        startPlayer();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Start JSMpeg WebSocket player
    // ─────────────────────────────────────────────────────────────────────────
    function startPlayer() {
        stopPlayer();

        if (!window.JSMpeg) {
            console.error('[VideoStream] JSMpeg not loaded yet — retrying in 1 s');
            setTimeout(startPlayer, 1000);
            return;
        }

        const wsUrl = `ws://localhost:${wsPort}`;
        console.log('[VideoStream] Connecting JSMpeg to', wsUrl);

        try {
            player = new JSMpeg.Player(wsUrl, {
                canvas:            canvas,
                autoplay:          true,
                audio:             false,
                loop:              false,
                disableGl:         false,  // WebGL for GPU-accelerated decode
                videoBufferSize:   512 * 1024,  // 512 KB — minimum buffer
                onSourceEstablished: () => {
                    console.log('[VideoStream] ✅ Stream established');
                    connected = true;
                    setStatus('LIVE', true);
                    if (connectBtn)    { connectBtn.disabled = false; connectBtn.style.display = 'none'; }
                    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
                },
                onSourceCompleted: () => {
                    console.warn('[VideoStream] Stream ended');
                    connected = false;
                    setStatus('NO SIGNAL', false);
                    if (connectBtn)    { connectBtn.style.display = 'inline-block'; connectBtn.disabled = false; }
                    if (disconnectBtn) disconnectBtn.style.display = 'none';
                }
            });

            // Detect connection via WebSocket events (JSMpeg may not fire onSourceEstablished immediately)
            const ws = player.source && player.source.socket;
            if (ws) {
                ws.addEventListener('open',  () => { console.log('[VideoStream] WS open'); });
                ws.addEventListener('close', () => {
                    connected = false;
                    setStatus('DISCONNECTED', false);
                    if (connectBtn)    { connectBtn.style.display = 'inline-block'; connectBtn.disabled = false; }
                    if (disconnectBtn) disconnectBtn.style.display = 'none';
                    // Schedule retry
                    scheduleRetry();
                });
                ws.addEventListener('error', () => {
                    console.error('[VideoStream] WebSocket error');
                    setStatus('WS ERROR', false);
                });
            }
        } catch (err) {
            console.error('[VideoStream] Failed to create JSMpeg player:', err);
            setStatus('PLAYER ERROR', false);
            if (connectBtn) connectBtn.disabled = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Disconnect
    // ─────────────────────────────────────────────────────────────────────────
    async function disconnect() {
        clearRetry();
        stopPlayer();
        setStatus('NO SIGNAL', false);
        if (connectBtn)    { connectBtn.style.display = 'inline-block'; connectBtn.disabled = false; }
        if (disconnectBtn) disconnectBtn.style.display = 'none';

        if (window.electronRTSP) {
            await window.electronRTSP.stop();
        }
        connected = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────────
    function stopPlayer() {
        if (player) {
            try { player.destroy(); } catch (_) {}
            player = null;
        }
    }

    function scheduleRetry() {
        clearRetry();
        console.log('[VideoStream] Retrying in 5 s…');
        retryTimer = setTimeout(() => {
            if (!connected && currentRtsp) startPlayer();
        }, 5000);
    }

    function clearRetry() {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    }

    // Called by the <script> tag after JSMpeg finishes loading
    function onJSMpegReady() {
        console.log('[VideoStream] JSMpeg ready');
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────────────────────────────────
    return {
        init()           { buildUI(); },
        connect,
        disconnect,
        onJSMpegReady,
        isStreaming()    { return connected; },
        setRtspUrl(url)  { if (rtspInput) rtspInput.value = url; currentRtsp = url; },
        getRtspUrl()     { return currentRtsp; },
        takeSnapshot() {
            if (!canvas) { alert('No video canvas available.'); return null; }
            const link = document.createElement('a');
            link.download = `snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            return link.href;
        }
    };

})();

/* ============================================================================
   Backward-compatible window.VideoStream shim
   (keeps the same API surface as the old MJPEG/webcam handler)
   ============================================================================ */
window.VideoStream = {
    connect:       () => VideoStreamController.connect(),
    disconnect:    () => VideoStreamController.disconnect(),
    reconnect:     () => VideoStreamController.connect(),
    isStreaming:   () => VideoStreamController.isStreaming(),
    takeSnapshot:  () => VideoStreamController.takeSnapshot(),
    setRtspUrl:    (url) => VideoStreamController.setRtspUrl(url),
    getRtspUrl:    () => VideoStreamController.getRtspUrl(),
};

/* ============================================================================
   Auto-init on DOM ready
   ============================================================================ */
function _initVideoStream() {
    VideoStreamController.init();
    console.log('[VideoStream] RTSP video stream controller ready');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initVideoStream);
} else {
    _initVideoStream();
}
