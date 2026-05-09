/**
 * rtsp-relay.js
 * Low-latency RTSP → MPEG1 → WebSocket relay for TiHANFly GCS
 * Used by main.js (Electron main process) — no Python required.
 *
 * How it works:
 *   ffmpeg reads the RTSP stream, encodes as MPEG1 video at ~200kbps,
 *   and writes raw MPEG-TS to stdout.  The relay creates a WebSocket
 *   server on the chosen port and broadcasts every chunk to all
 *   connected browser clients.  JSMpeg in the renderer decodes it.
 *
 * Latency: 150–400 ms (depends on network + ffmpeg startup).
 */

'use strict';

const { spawn }  = require('child_process');
const { Server } = require('ws');

class RtspRelay {
    constructor() {
        this.wsServer   = null;
        this.ffmpeg     = null;
        this.clients    = new Set();
        this.rtspUrl    = null;
        this.port       = 9999;
        this.running    = false;
    }

    // ── Start relay ──────────────────────────────────────────────────────────
    start(rtspUrl, port = 9999) {
        if (this.running) this.stop();

        this.rtspUrl = rtspUrl;
        this.port    = port;
        this.running = true;

        console.log(`[RTSP-Relay] Starting relay for: ${rtspUrl}  port: ${port}`);

        // 1. Create WebSocket server
        this.wsServer = new Server({ port });
        this.wsServer.on('connection', (ws) => {
            console.log(`[RTSP-Relay] Client connected (total: ${this.clients.size + 1})`);
            this.clients.add(ws);
            ws.on('close', () => {
                this.clients.delete(ws);
                console.log(`[RTSP-Relay] Client disconnected (total: ${this.clients.size})`);
            });
            ws.on('error', () => this.clients.delete(ws));
        });
        this.wsServer.on('error', (err) => {
            console.error('[RTSP-Relay] WebSocket server error:', err.message);
        });

        // 2. Spawn ffmpeg
        this._spawnFfmpeg();
    }

    // ── Internal: launch ffmpeg ───────────────────────────────────────────────
    _spawnFfmpeg() {
        if (!this.running) return;

        const args = [
            // Input
            '-rtsp_transport', 'tcp',          // TCP for reliability (switch to udp if lower latency needed)
            '-i',              this.rtspUrl,

            // Tune for minimum latency
            '-fflags',         'nobuffer',
            '-flags',          'low_delay',
            '-probesize',      '32',
            '-analyzeduration','0',
            '-sync',           'ext',

            // Video: MPEG1 (only codec JSMpeg understands)
            '-f',        'mpegts',
            '-codec:v',  'mpeg1video',
            '-s',        '1280x720',      // resolution — lower = less latency
            '-b:v',      '800k',          // bitrate
            '-r',        '30',            // frame rate
            '-bf',       '0',             // no B-frames = lower latency
            '-muxdelay', '0.001',

            // No audio
            '-an',

            // Output to stdout
            'pipe:1'
        ];

        console.log('[RTSP-Relay] Spawning ffmpeg...');

        this.ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        // Broadcast every chunk to all WebSocket clients
        this.ffmpeg.stdout.on('data', (chunk) => {
            this.clients.forEach((ws) => {
                if (ws.readyState === 1 /* OPEN */) {
                    try { ws.send(chunk, { binary: true }); } catch (_) { /* ignore */ }
                }
            });
        });

        this.ffmpeg.stderr.on('data', (data) => {
            // Only log errors, not the normal ffmpeg progress lines
            const line = data.toString();
            if (line.includes('error') || line.includes('Error') || line.includes('failed')) {
                console.error('[RTSP-Relay] ffmpeg:', line.trim());
            }
        });

        this.ffmpeg.on('exit', (code, signal) => {
            console.log(`[RTSP-Relay] ffmpeg exited (code=${code}, signal=${signal})`);
            this.ffmpeg = null;
            // Auto-restart after 3 s if relay is still supposed to be running
            if (this.running) {
                console.log('[RTSP-Relay] Restarting ffmpeg in 3 s...');
                setTimeout(() => this._spawnFfmpeg(), 3000);
            }
        });

        this.ffmpeg.on('error', (err) => {
            // Most likely ffmpeg is not in PATH
            console.error('[RTSP-Relay] Failed to start ffmpeg:', err.message);
            console.error('[RTSP-Relay] Make sure ffmpeg is installed and in your system PATH.');
        });
    }

    // ── Stop relay ───────────────────────────────────────────────────────────
    stop() {
        console.log('[RTSP-Relay] Stopping relay');
        this.running = false;

        if (this.ffmpeg) {
            this.ffmpeg.kill('SIGKILL');
            this.ffmpeg = null;
        }
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }
        this.clients.clear();
    }

    isRunning() { return this.running; }
}

module.exports = RtspRelay;
