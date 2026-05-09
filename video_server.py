"""
video_server.py -- RTSP/RTMP -> MJPEG HTTP server for TiHANFly GCS
===================================================================
Spawned by the C++ backend when the user clicks "Connect".
Serves MJPEG on http://localhost:5001/video

Supported stream URLs:
    rtsp://host:port/path      (e.g. rtsp://192.168.1.10:554/stream)
    rtmp://host/app/stream     (e.g. rtmp://192.168.1.10/live/stream)
    http://host/stream.m3u8    (HLS)

Usage:
    python video_server.py <stream_url> [port]

Requirements:
    pip install opencv-python flask flask-cors
"""

import sys
import os
import threading
import time

# ── Parse args FIRST so we can pick the right FFmpeg options ──────────────────
# Must happen BEFORE import cv2 (env vars are read at cv2 load time).
STREAM_URL = sys.argv[1] if len(sys.argv) > 1 else ""
PORT       = int(sys.argv[2]) if len(sys.argv) > 2 else 5001

if not STREAM_URL:
    print("[VideoServer] No stream URL provided.")
    sys.exit(1)

_scheme = STREAM_URL.lower().split('://')[0] if '://' in STREAM_URL else ''

# ── Suppress OpenCV/FFmpeg spam & set scheme-specific FFmpeg options ───────────
os.environ["OPENCV_LOG_LEVEL"]         = "ERROR"
os.environ["OPENCV_FFMPEG_LOGLEVEL"]   = "0"

if _scheme == 'rtsp':
    # RTSP: force TCP transport (avoids UDP packet loss), low-latency flags
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        "rtsp_transport;tcp"
        "|fflags;nobuffer"
        "|flags;low_delay"
        "|stimeout;5000000"   # socket timeout 5s
        "|err_detect;ignore_err"
    )
elif _scheme == 'rtmp':
    # RTMP: no rtsp_transport, use network timeout instead
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        "fflags;nobuffer"
        "|flags;low_delay"
        "|timeout;5000000"    # connection timeout 5s
        "|err_detect;ignore_err"
    )
else:
    # HTTP/HLS or other — generic low-latency
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        "fflags;nobuffer"
        "|flags;low_delay"
    )

try:
    import cv2
except ImportError:
    print("[VideoServer] ERROR: pip install opencv-python")
    sys.exit(1)

try:
    from flask import Flask, Response, jsonify
    from flask_cors import CORS
except ImportError:
    print("[VideoServer] ERROR: pip install flask flask-cors")
    sys.exit(1)

print(f"[VideoServer] Starting  URL={STREAM_URL}  scheme={_scheme}  port={PORT}")

# ── Shared state ───────────────────────────────────────────────────────────────
_frame_lock    = threading.Lock()
_current_frame = None      # raw numpy frame
_frame_count   = 0         # incremented each new frame
_running       = True

# ── Stream capture thread ─────────────────────────────────────────────────────
def capture_loop():
    """Continuously reads frames from the stream source into _current_frame."""
    global _current_frame, _frame_count, _running

    print("[VideoServer] Capture thread started")
    cap = None

    while _running:
        if cap is None or not cap.isOpened():
            print(f"[VideoServer] Connecting to {_scheme.upper()}: {STREAM_URL}")
            cap = cv2.VideoCapture(STREAM_URL, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                print("[VideoServer] Cannot open stream, retrying in 3s...")
                time.sleep(3)
                cap = None
                continue
            print("[VideoServer] Stream opened successfully")

        ret, frame = cap.read()
        if not ret:
            print("[VideoServer] Frame read failed, reconnecting...")
            cap.release()
            cap = None
            time.sleep(1)
            continue

        with _frame_lock:
            _current_frame = frame
            _frame_count  += 1

    if cap:
        cap.release()
    print("[VideoServer] Capture thread stopped")

# ── MJPEG frame generator ──────────────────────────────────────────────────────
def generate_frames():
    """Generator: yields MJPEG multipart frames to the HTTP client."""
    last_fid = -1

    while _running:
        with _frame_lock:
            frame = _current_frame
            fid   = _frame_count

        # No new frame yet — wait a bit
        if frame is None or fid == last_fid:
            time.sleep(0.01)
            continue

        last_fid = fid

        ok, jpg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            continue

        data = jpg.tobytes()
        yield (
            b'--frame\r\n'
            b'Content-Type: image/jpeg\r\n'
            b'Content-Length: ' + str(len(data)).encode() + b'\r\n'
            b'\r\n' + data + b'\r\n'
        )

# ── Flask app ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

@app.route('/video')
@app.route('/video_feed')
def video_feed():
    return Response(
        generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Cache-Control':    'no-cache, no-store, must-revalidate',
            'Pragma':           'no-cache',
            'Expires':          '0',
            'X-Accel-Buffering':'no',
            'Connection':       'keep-alive',
            'Access-Control-Allow-Origin': '*',
        }
    )

@app.route('/status')
def status():
    return jsonify({
        'status':      'running' if _running else 'stopped',
        'frame_count': _frame_count,
        'has_frame':   _current_frame is not None,
        'stream_url':  STREAM_URL,
        'port':        PORT,
    })

@app.route('/stop')
def stop():
    global _running
    _running = False
    return jsonify({'status': 'stopped'})

@app.route('/')
def index():
    return (
        f'<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:20px">'
        f'<h2>TiHANFly Video Server</h2>'
        f'<p>RTSP: {RTSP_URL}</p>'
        f'<p>Frames: {_frame_count}</p>'
        f'<img src="/video" style="max-width:100%;border:2px solid #22c55e">'
        f'</body></html>'
    )

# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Start RTSP capture thread (runs in background, won't block Flask startup)
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()

    print(f"[VideoServer] HTTP server on http://0.0.0.0:{PORT}")
    print(f"[VideoServer] Stream URL: http://localhost:{PORT}/video")

    # Flask with threaded=True handles multiple concurrent clients
    app.run(
        host='0.0.0.0',
        port=PORT,
        debug=False,
        threaded=True,
        use_reloader=False,
    )

    _running = False
    print("[VideoServer] Stopped.")
