/**
 * review-log.js  —  TiHANFly GCS
 * Zoom/pan implemented via native wheel + mouse drag on canvas (no plugin needed).
 */

(function () {
    'use strict';

    var BACKEND_URL      = 'http://localhost:8080/parse_log';
    var BACKEND_DATA_URL = 'http://localhost:8080/log_data';

    var SERIES_COLORS = [
        '#29b6f6', '#ef5350', '#66bb6a', '#ffa726',
        '#ab47bc', '#26c6da', '#ff7043', '#9ccc65',
        '#ec407a', '#42a5f5', '#ffca28', '#26a69a',
        '#5c6bc0', '#d4e157', '#f06292', '#80cbc4'
    ];

    /* ===================================================================
       CSS
    =================================================================== */
    var CSS = `
#rlWindow {
    position: fixed !important; inset: 0 !important;
    z-index: 99999990 !important; display: none;
    flex-direction: column; background: #1e1e1e;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #d0d0d0; overflow: hidden;
}
#rlWindow.rl-on { display: flex !important; }

#rlBar {
    display: flex; align-items: center; gap: 8px;
    height: 38px; padding: 0 10px;
    background: #2d2d2d; border-bottom: 2px solid #111; flex-shrink: 0;
}
#rlBackBtn {
    display: flex; align-items: center; gap: 5px;
    background: #3a3a3a; border: 1px solid #555;
    color: #aaa; font-size: 11px; font-weight: 600;
    cursor: pointer; padding: 4px 10px; border-radius: 3px;
    font-family: inherit; transition: background .15s;
}
#rlBackBtn:hover { background: #4a4a4a; color:#fff; }
#rlBarTitle { font-size:12px; font-weight:700; color:#c8c8c8; letter-spacing:0.3px; }
#rlBarFile  { font-size:11px; color:#777; margin-left:4px; font-style:italic; }
.rl-pill {
    padding: 2px 8px; border-radius: 3px;
    font-size:10px; font-weight:700; font-family: inherit;
}
.rl-pill.off    { background:#333; color:#666; border:1px solid #444; }
.rl-pill.green  { background:#1a3a1a; color:#5cbf5c; border:1px solid #3a6a3a; }
.rl-pill.yellow { background:#3a2e00; color:#ffc107; border:1px solid #6a5500; }
#rlOpenBtn {
    margin-left: auto; display: flex; align-items: center; gap: 5px;
    background: #3a3a3a; border: 1px solid #555;
    color: #b0b0b0; font-size:11px; font-weight:600;
    cursor:pointer; padding:4px 12px; border-radius:3px; font-family: inherit;
    transition: all .15s;
}
#rlOpenBtn:hover { background: #4a4a4a; color:#fff; border-color:#888; }
#rlClearBtn {
    display: flex; align-items: center; gap: 5px;
    background: #3a2020; border: 1px solid #5a2a2a;
    color: #d07070; font-size:11px; font-weight:600;
    cursor:pointer; padding:4px 10px; border-radius:3px; font-family: inherit;
    transition: all .15s;
}
#rlClearBtn:hover { background: #5a2020; border-color:#e07070; }
#rlResetZoomBtn {
    display: flex; align-items: center; gap: 5px;
    background: #1e2a3a; border: 1px solid #2a4a6a;
    color: #5eb8d8; font-size:11px; font-weight:600;
    cursor:pointer; padding:4px 10px; border-radius:3px; font-family: inherit;
    transition: all .15s;
}
#rlResetZoomBtn:hover { background: #253545; border-color:#5eb8d8; color:#fff; }

#rlBody { flex: 1; display: flex; overflow: hidden; min-height: 0; }

#rlGraphPane {
    flex: 1; display: flex; flex-direction: column;
    background: #1e1e1e; overflow: hidden; min-height: 0;
}

#rlLegend {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 4px 8px; flex-shrink: 0; min-height: 26px;
    background: #252525; border-bottom: 1px solid #111;
}
.rl-legend-chip {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 2px; font-size:11px;
    font-weight:600; cursor:pointer; border: 1px solid #444;
    background: #2a2a2a; transition: opacity .15s;
}
.rl-legend-chip:hover { opacity: 0.75; }
.rl-chip-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.rl-chip-x { margin-left:4px; color:#888; font-size:10px; }

#rlChartWrap {
    flex: 1; background: #181818; position: relative;
    min-height: 0; overflow: hidden;
}
#rlChart { width:100% !important; height:100% !important; display:block; }
#rlNoData {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 10px; pointer-events: none;
}
#rlNoData.hidden { display:none; }
.rl-nodata-text { color:#3a3a3a; font-size:12px; text-align:center; line-height:1.8; }
#rlZoomHint {
    position: absolute; bottom: 8px; right: 10px;
    color: #3a3a3a; font-size: 10px; pointer-events: none;
    font-family: 'Consolas', monospace;
}

#rlStatBar {
    display: flex; gap: 0; flex-shrink: 0;
    background: #252525; border-top: 1px solid #111;
}
.rl-stat {
    padding: 4px 14px; display: flex; align-items: center; gap: 6px;
    border-right: 1px solid #333;
}
.rl-stat-l { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
.rl-stat-n { font-size: 11px; font-weight: 700; color: #aaa; font-family: 'Consolas', monospace; }
.rl-stat-n.g { color: #5cbf5c; }
.rl-stat-n.b { color: #5eb8d8; }
.rl-stat-n.p { color: #ab87bc; }

#rlTreePane {
    width: 260px; flex-shrink: 0;
    background: #252525; border-left: 2px solid #111;
    display: flex; flex-direction: column; overflow: hidden;
}
#rlTreeHead {
    padding: 7px 10px 6px; border-bottom: 1px solid #111;
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0; background: #2d2d2d;
}
.rl-tree-title { color: #999; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
.rl-tree-count { color:#555; font-size:10px; }
#rlSearchWrap { padding: 5px 8px; border-bottom: 1px solid #1a1a1a; flex-shrink:0; background: #272727; }
#rlSearch {
    width: 100%; padding: 4px 8px;
    background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 2px;
    color: #aaa; font-size: 11px; outline: none;
    box-sizing: border-box; font-family: inherit;
}
#rlSearch:focus { border-color: #5eb8d8; }
#rlSearch::placeholder { color: #444; }

#rlTreeScroll { flex: 1; overflow-y: auto; }
#rlTreeScroll::-webkit-scrollbar { width: 6px; }
#rlTreeScroll::-webkit-scrollbar-track { background: #1e1e1e; }
#rlTreeScroll::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

.rl-msg-group { border-bottom: 1px solid #1e1e1e; }
.rl-msg-row {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 8px 4px 4px; cursor: pointer;
    transition: background .08s; user-select: none;
}
.rl-msg-row:hover { background: #303030; }
.rl-msg-row.rl-has-active { background: #1e2a38; }
.rl-msg-arrow {
    width: 14px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: #555; font-size: 9px; transition: transform .12s;
}
.rl-msg-arrow.open { transform: rotate(90deg); color: #5eb8d8; }
.rl-msg-dot { width: 10px; height: 10px; border-radius: 1px; flex-shrink: 0; }
.rl-msg-name {
    flex: 1; font-size: 12px; font-weight: 600; color: #a8b0c0;
    font-family: 'Consolas', monospace;
}
.rl-msg-row:hover .rl-msg-name { color: #e0e8f8; }
.rl-msg-row.rl-has-active .rl-msg-name { color: #c8d8f8; }
.rl-msg-cnt {
    font-size: 9px; color: #555; background: #1e1e1e;
    border-radius: 2px; padding: 1px 4px; font-family: 'Consolas', monospace;
}
.rl-fields { display: none; flex-direction: column; }
.rl-fields.open { display: flex; }
.rl-field-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px 3px 28px; cursor: pointer;
    transition: background .06s; border-bottom: 1px solid #1e1e1e;
    position: relative;
}
.rl-field-row:hover { background: #2a2a2a; }
.rl-field-row.active { background: #1a2a3a; }
.rl-field-row.active::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: var(--field-color, #5eb8d8);
}
.rl-field-bullet {
    width: 8px; height: 8px; border-radius: 1px;
    background: #333; flex-shrink: 0; border: 1px solid #555;
}
.rl-field-row.active .rl-field-bullet {
    background: var(--field-color, #5eb8d8);
    border-color: var(--field-color, #5eb8d8);
}
.rl-field-name { flex: 1; font-size: 11px; color: #606878; font-family: 'Consolas', monospace; }
.rl-field-row:hover .rl-field-name { color: #9098a8; }
.rl-field-row.active .rl-field-name { color: #b8c8d8; }

#rlLoading {
    position: fixed; inset: 0; background: rgba(18,18,18,.97);
    display: none; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px; z-index: 100;
}
#rlLoading.show { display: flex; }
.rl-spinner {
    width: 36px; height: 36px; border: 3px solid #333;
    border-top-color: #5eb8d8; border-radius: 50%;
    animation: rlSpin .7s linear infinite;
}
@keyframes rlSpin { to { transform: rotate(360deg); } }
.rl-load-pct  { color:#5eb8d8; font-size:26px; font-weight:700; }
.rl-load-txt  { color:#555; font-size:11px; }
#rlProgressBar { width:240px; height:4px; background:#333; border-radius:2px; overflow:hidden; }
#rlProgressFill { height:100%; width:0%; background:#5eb8d8; border-radius:2px; transition:width .2s; }
#rlError {
    position: fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:rgba(160,30,30,.96); color:#fff;
    padding:8px 20px; border-radius:3px; font-size:11px; font-weight:700;
    display:none; z-index:200;
}
#rlError.show { display:block; }
`;

    /* ===================================================================
       STATE
    =================================================================== */
    var _state = {
        built:        false,
        fileName:     '',
        msgSchema:    {},
        msgRowCounts: {},
        msgData:      {},
        activeSeries: [],
        chart:        null,
        colorIndex:   0,
        totalRows:    0,
        // zoom/pan state — view window in data-space X
        xMin:         null,
        xMax:         null,
        xMinFull:     null,
        xMaxFull:     null,
        // pan drag
        isDragging:   false,
        dragStartX:   0,
        dragXMinAtStart: 0,
        dragXMaxAtStart: 0
    };

    /* ===================================================================
       BUILD DOM
    =================================================================== */
    function build() {
        if (_state.built) return;
        _state.built = true;
        _injectCSS();

        var win = document.createElement('div');
        win.id = 'rlWindow';
        win.innerHTML = `
<div id="rlBar">
  <button id="rlBackBtn">← Back</button>
  <span id="rlBarTitle">LOG BROWSER</span>
  <span id="rlBarFile">— no file loaded —</span>
  <span class="rl-pill off" id="rlStatusPill">● IDLE</span>
  <button id="rlClearBtn">✕ Clear Plots</button>
  <button id="rlResetZoomBtn">⟳ Reset Zoom</button>
  <button id="rlOpenBtn">📂 Open Log File</button>
</div>
<div id="rlBody">
  <div id="rlGraphPane">
    <div id="rlLegend"></div>
    <div id="rlChartWrap">
      <canvas id="rlChart"></canvas>
      <div id="rlNoData">
        <div class="rl-nodata-text">Open a .bin log file, then click<br>any field in the tree to plot it</div>
      </div>
      <div id="rlZoomHint">scroll to zoom · drag to pan</div>
    </div>
    <div id="rlStatBar">
      <div class="rl-stat"><span class="rl-stat-l">Min</span><span class="rl-stat-n" id="rlStatMin">—</span></div>
      <div class="rl-stat"><span class="rl-stat-l">Max</span><span class="rl-stat-n" id="rlStatMax">—</span></div>
      <div class="rl-stat"><span class="rl-stat-l">Avg</span><span class="rl-stat-n" id="rlStatAvg">—</span></div>
      <div class="rl-stat"><span class="rl-stat-l">Samples</span><span class="rl-stat-n g" id="rlStatRows">—</span></div>
      <div class="rl-stat"><span class="rl-stat-l">Duration</span><span class="rl-stat-n b" id="rlStatDur">—</span></div>
      <div class="rl-stat"><span class="rl-stat-l">Series</span><span class="rl-stat-n p" id="rlStatSeries">0</span></div>
    </div>
  </div>
  <div id="rlTreePane">
    <div id="rlTreeHead">
      <span class="rl-tree-title">Messages</span>
      <span class="rl-tree-count" id="rlMsgCount">0 types</span>
    </div>
    <div id="rlSearchWrap">
      <input id="rlSearch" type="text" placeholder="Filter messages…" autocomplete="off" spellcheck="false">
    </div>
    <div id="rlTreeScroll"></div>
  </div>
</div>
<div id="rlLoading">
  <div class="rl-spinner"></div>
  <div class="rl-load-pct" id="rlLoadPct">0%</div>
  <div id="rlProgressBar"><div id="rlProgressFill"></div></div>
  <div class="rl-load-txt" id="rlLoadTxt">Parsing log…</div>
</div>
<div id="rlError"></div>
`;
        document.body.appendChild(win);

        document.getElementById('rlBackBtn').addEventListener('click', API.close.bind(API));
        document.getElementById('rlOpenBtn').addEventListener('click', function () {
            var fi = document.getElementById('reviewLogFileInput');
            if (fi) fi.click();
        });
        document.getElementById('rlClearBtn').addEventListener('click', _clearAllSeries);
        document.getElementById('rlResetZoomBtn').addEventListener('click', _resetZoom);
        document.getElementById('rlSearch').addEventListener('input', function () {
            _filterTree(this.value.trim().toLowerCase());
        });

        // Wire zoom/pan on canvas
        _wireCanvasZoom();
    }

    function _injectCSS() {
        if (document.getElementById('rl-css')) return;
        var s = document.createElement('style');
        s.id = 'rl-css'; s.textContent = CSS;
        document.head.appendChild(s);
    }

    /* ===================================================================
       ZOOM / PAN  — pure canvas event handlers, no external plugin
    =================================================================== */
    function _wireCanvasZoom() {
        // We wire events on the wrapper so they're always available
        var wrap = document.getElementById('rlChartWrap');
        if (!wrap) return;

        // ── Scroll wheel → zoom X axis ─────────────────────────────────
        wrap.addEventListener('wheel', function (e) {
            e.preventDefault();
            if (!_state.chart || _state.xMin === null) return;

            var rect    = wrap.getBoundingClientRect();
            var mouseX  = e.clientX - rect.left;        // pixel position in canvas
            var canvasW = rect.width;

            // Fraction of canvas where mouse is (0 = left edge, 1 = right)
            var frac = Math.max(0, Math.min(1, mouseX / canvasW));

            var curRange = _state.xMax - _state.xMin;
            var factor   = e.deltaY < 0 ? 0.8 : 1.25;  // scroll up = zoom in
            var newRange = curRange * factor;

            // Clamp: can't zoom out past full range, don't zoom in below 0.05s
            var fullRange = _state.xMaxFull - _state.xMinFull;
            newRange = Math.max(0.05, Math.min(fullRange, newRange));

            // Keep the data point under the mouse cursor fixed
            var pivot   = _state.xMin + frac * curRange;
            var newXMin = pivot - frac * newRange;
            var newXMax = pivot + (1 - frac) * newRange;

            // Clamp to full data bounds
            if (newXMin < _state.xMinFull) { newXMax += (_state.xMinFull - newXMin); newXMin = _state.xMinFull; }
            if (newXMax > _state.xMaxFull) { newXMin -= (newXMax - _state.xMaxFull); newXMax = _state.xMaxFull; }
            newXMin = Math.max(_state.xMinFull, newXMin);
            newXMax = Math.min(_state.xMaxFull, newXMax);

            _state.xMin = newXMin;
            _state.xMax = newXMax;
            _applyZoom();
        }, { passive: false });

        // ── Mouse drag → pan ───────────────────────────────────────────
        wrap.addEventListener('mousedown', function (e) {
            if (!_state.chart || _state.xMin === null) return;
            if (e.button !== 0) return;
            _state.isDragging     = true;
            _state.dragStartX     = e.clientX;
            _state.dragXMinAtStart = _state.xMin;
            _state.dragXMaxAtStart = _state.xMax;
            wrap.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', function (e) {
            if (!_state.isDragging || !_state.chart) return;

            var wrap2   = document.getElementById('rlChartWrap');
            if (!wrap2) return;
            var canvasW = wrap2.getBoundingClientRect().width;
            var curRange = _state.dragXMaxAtStart - _state.dragXMinAtStart;
            var dx       = e.clientX - _state.dragStartX;         // pixels moved
            var dataDx   = (dx / canvasW) * curRange;             // convert to data units

            var newXMin = _state.dragXMinAtStart - dataDx;
            var newXMax = _state.dragXMaxAtStart - dataDx;

            // Clamp to data bounds
            if (newXMin < _state.xMinFull) { newXMax += (_state.xMinFull - newXMin); newXMin = _state.xMinFull; }
            if (newXMax > _state.xMaxFull) { newXMin -= (newXMax - _state.xMaxFull); newXMax = _state.xMaxFull; }
            newXMin = Math.max(_state.xMinFull, newXMin);
            newXMax = Math.min(_state.xMaxFull, newXMax);

            _state.xMin = newXMin;
            _state.xMax = newXMax;
            _applyZoom();
        });

        document.addEventListener('mouseup', function () {
            if (_state.isDragging) {
                _state.isDragging = false;
                var wrap2 = document.getElementById('rlChartWrap');
                if (wrap2) wrap2.style.cursor = '';
            }
        });

        // ── Touch pinch/pan ────────────────────────────────────────────
        var _touches = {};
        var _pinchStartDist = 0;
        var _pinchStartXMin = 0;
        var _pinchStartXMax = 0;
        var _panTouchId = null;
        var _panTouchStartX = 0;
        var _panXMinAtStart = 0;
        var _panXMaxAtStart = 0;

        wrap.addEventListener('touchstart', function(e) {
            e.preventDefault();
            for (var i = 0; i < e.changedTouches.length; i++) {
                _touches[e.changedTouches[i].identifier] = { x: e.changedTouches[i].clientX };
            }
            var ids = Object.keys(_touches);
            if (ids.length === 2) {
                _pinchStartDist = Math.abs(_touches[ids[0]].x - _touches[ids[1]].x);
                _pinchStartXMin = _state.xMin;
                _pinchStartXMax = _state.xMax;
                _panTouchId = null;
            } else if (ids.length === 1) {
                _panTouchId = ids[0];
                _panTouchStartX = _touches[ids[0]].x;
                _panXMinAtStart = _state.xMin;
                _panXMaxAtStart = _state.xMax;
            }
        }, { passive: false });

        wrap.addEventListener('touchmove', function(e) {
            e.preventDefault();
            for (var i = 0; i < e.changedTouches.length; i++) {
                if (_touches[e.changedTouches[i].identifier] !== undefined) {
                    _touches[e.changedTouches[i].identifier].x = e.changedTouches[i].clientX;
                }
            }
            var ids = Object.keys(_touches);
            var canvasW = wrap.getBoundingClientRect().width;

            if (ids.length === 2 && _pinchStartDist > 0) {
                var newDist = Math.abs(_touches[ids[0]].x - _touches[ids[1]].x);
                var scale   = _pinchStartDist / newDist;
                var midRange = (_pinchStartXMin + _pinchStartXMax) / 2;
                var half    = (_pinchStartXMax - _pinchStartXMin) * scale / 2;
                var fullRange = _state.xMaxFull - _state.xMinFull;
                half = Math.max(0.025, Math.min(fullRange / 2, half));
                _state.xMin = Math.max(_state.xMinFull, midRange - half);
                _state.xMax = Math.min(_state.xMaxFull, midRange + half);
                _applyZoom();
            } else if (ids.length === 1 && _panTouchId !== null) {
                var curRange = _panXMaxAtStart - _panXMinAtStart;
                var dx = _touches[_panTouchId].x - _panTouchStartX;
                var dataDx = (dx / canvasW) * curRange;
                var newXMin = _panXMinAtStart - dataDx;
                var newXMax = _panXMaxAtStart - dataDx;
                if (newXMin < _state.xMinFull) { newXMax += (_state.xMinFull - newXMin); newXMin = _state.xMinFull; }
                if (newXMax > _state.xMaxFull) { newXMin -= (newXMax - _state.xMaxFull); newXMax = _state.xMaxFull; }
                _state.xMin = Math.max(_state.xMinFull, newXMin);
                _state.xMax = Math.min(_state.xMaxFull, newXMax);
                _applyZoom();
            }
        }, { passive: false });

        wrap.addEventListener('touchend', function(e) {
            for (var i = 0; i < e.changedTouches.length; i++) {
                delete _touches[e.changedTouches[i].identifier];
            }
            _panTouchId = null; _pinchStartDist = 0;
        }, { passive: false });
    }

    /* Apply current _state.xMin/xMax to the live Chart.js instance */
    function _applyZoom() {
        if (!_state.chart) return;
        var xScale = _state.chart.options.scales.xAxes
            ? _state.chart.options.scales.xAxes[0]   // Chart.js v2
            : _state.chart.options.scales['x'];       // Chart.js v3

        if (_state.chart.options.scales.xAxes) {
            // Chart.js v2
            _state.chart.options.scales.xAxes[0].ticks.min = _state.xMin;
            _state.chart.options.scales.xAxes[0].ticks.max = _state.xMax;
        } else {
            // Chart.js v3+
            _state.chart.options.scales.x.min = _state.xMin;
            _state.chart.options.scales.x.max = _state.xMax;
        }
        _state.chart.update('none');   // 'none' = skip animation for smooth pan
    }

    function _resetZoom() {
        if (_state.xMinFull === null) return;
        _state.xMin = _state.xMinFull;
        _state.xMax = _state.xMaxFull;
        _applyZoom();
    }

    /* ===================================================================
       FILE LOADING
    =================================================================== */
    function _loadFile(file) {
        _state.fileName = file.name;
        _state.msgSchema = {}; _state.msgRowCounts = {};
        _state.msgData = {}; _state.activeSeries = [];
        _state.colorIndex = 0; _state.totalRows = 0;
        _state.xMin = null; _state.xMax = null;
        _state.xMinFull = null; _state.xMaxFull = null;

        API.open();
        var barFile = document.getElementById('rlBarFile');
        if (barFile) barFile.textContent = file.name;
        _setPill('rl-pill yellow', '● PARSING');
        _setProgress(0, 'Reading ' + file.name + '…');
        _showLoading(true);

        // The C++ backend has no HTTP /parse_log endpoint and the page
        // is loaded as file:// (origin null), so any XHR would be blocked
        // by CORS immediately. Parse the binary log entirely in-browser.
        setTimeout(function () { _localParse(file); }, 50);
    }

    /* ===================================================================
       LOCAL BINARY PARSER — ArduPilot DataFlash v2 (3-byte header)
    =================================================================== */
    function _localParse(file) {
        _setProgress(10, 'Reading file…');
        var reader = new FileReader();
        reader.onload = function (e) {
            _setProgress(20, 'Parsing binary log…');
            // Map parser 0-100% → display 20-90% so the loading bar
            // never appears to "stall" near the end due to rounding.
            _parseBinBuffer(e.target.result,
                function (pct, txt) { _setProgress(20 + Math.round(pct * 0.70), txt); },
                function (schema, data, totalRows) {
                    _state.msgData   = data;
                    _state.totalRows = totalRows;
                    _setProgress(95, 'Building tree…');
                    // Safety net: if _onSchemaReceived throws, still hide the
                    // loading overlay and show a useful error rather than
                    // leaving the user staring at a frozen 95% bar.
                    setTimeout(function () {
                        try {
                            _onSchemaReceived(schema);
                        } catch (err) {
                            console.error('[review-log] _onSchemaReceived threw:', err);
                            _showLoading(false);
                            _setPill('rl-pill off', '● ERROR');
                            _showError('Parse error: ' + (err && err.message ? err.message : String(err)));
                        }
                    }, 50);
                });
        };
        reader.onerror = function () {
            _showError('Failed to read file.');
            _showLoading(false); _setPill('rl-pill off', '● ERROR');
        };
        reader.readAsArrayBuffer(file);
    }

    function _parseBinBuffer(buffer, onProgress, onDone) {
        var bytes = new Uint8Array(buffer);
        var len   = bytes.length;
        var HEAD1 = 0xA3, HEAD2 = 0x95, FMT_TYPE = 0x80, FMT_PKT_SIZE = 89;
        var fmtMap = {}, schema = {}, msgData = {}, totalRows = 0, firstTimeUS = {};
        var i = 0, CHUNK = 131072;

        function readCStr(arr, offset, maxLen) {
            var s = '';
            for (var k = 0; k < maxLen; k++) {
                var idx = offset + k;
                if (idx >= arr.length) break;
                var c = arr[idx];
                if (c === 0) break;
                if (c >= 32 && c < 127) s += String.fromCharCode(c);
            }
            return s.replace(/\s+$/, '');
        }

        function decodeRow(payload, fmt, fields) {
            var row = {}, offset = 0, ab, view;
            try {
                ab   = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
                view = new DataView(ab);
            } catch(e) { return null; }

            for (var fi = 0; fi < fmt.length && fi < fields.length; fi++) {
                var f = fmt[fi], fn = fields[fi], val;
                try {
                    switch(f) {
                        case 'b': val=view.getInt8(offset); offset+=1; break;
                        case 'B': case 'M': val=view.getUint8(offset); offset+=1; break;
                        case 'h': val=view.getInt16(offset,true); offset+=2; break;
                        case 'H': val=view.getUint16(offset,true); offset+=2; break;
                        case 'i': val=view.getInt32(offset,true); offset+=4; break;
                        case 'I': val=view.getUint32(offset,true); offset+=4; break;
                        case 'f': val=+view.getFloat32(offset,true).toFixed(6); offset+=4; break;
                        case 'd': val=view.getFloat64(offset,true); offset+=8; break;
                        case 'c': val=+(view.getInt16(offset,true)/100.0).toFixed(6); offset+=2; break;
                        case 'C': val=+(view.getUint16(offset,true)/100.0).toFixed(6); offset+=2; break;
                        case 'e': val=+(view.getInt32(offset,true)/100.0).toFixed(6); offset+=4; break;
                        case 'E': val=+(view.getUint32(offset,true)/100.0).toFixed(6); offset+=4; break;
                        case 'L': val=+(view.getInt32(offset,true)/1e7).toFixed(7); offset+=4; break;
                        case 'n': val=readCStr(new Uint8Array(ab),offset,4); offset+=4; break;
                        case 'N': val=readCStr(new Uint8Array(ab),offset,16); offset+=16; break;
                        case 'Z': val=readCStr(new Uint8Array(ab),offset,64); offset+=64; break;
                        case 'q': { var lo=view.getUint32(offset,true),hi=view.getInt32(offset+4,true); val=hi*4294967296+lo; offset+=8; break; }
                        case 'Q': { var loU=view.getUint32(offset,true),hiU=view.getUint32(offset+4,true); val=hiU*4294967296+loU; offset+=8; break; }
                        default: offset+=1; val=0;
                    }
                } catch(e) { break; }
                row[fn] = val;
            }
            return Object.keys(row).length ? row : null;
        }

        function processChunk() {
            var end = Math.min(i + CHUNK, len);
            while (i < end) {
                if (i + 3 > len) break;
                if (bytes[i] !== HEAD1 || bytes[i+1] !== HEAD2) { i++; continue; }
                var msgType = bytes[i+2];
                if (msgType === FMT_TYPE) {
                    if (i + FMT_PKT_SIZE > len) { i++; continue; }
                    var fType=bytes[i+3], fTotLen=bytes[i+4];
                    var fName=readCStr(bytes,i+5,4), fFmt=readCStr(bytes,i+9,16), fCols=readCStr(bytes,i+25,64);
                    var fields=fCols.split(',').map(function(s){return s.trim();}).filter(function(s){return s.length>0;});
                    if (fName) { fmtMap[fType]={name:fName,fmt:fFmt,fields:fields,total_len:fTotLen}; schema[fName]=fields; }
                    i += FMT_PKT_SIZE;
                } else if (fmtMap[msgType]) {
                    var sch=fmtMap[msgType], pktTotal=sch.total_len;
                    if (pktTotal < 3 || i + pktTotal > len) { i++; continue; }
                    var payload=bytes.subarray(i+3, i+3+pktTotal-3);
                    var row=decodeRow(payload,sch.fmt,sch.fields);
                    if (row) {
                        var mn=sch.name;
                        if (!msgData[mn]) { msgData[mn]={_time:[]}; sch.fields.forEach(function(fn){msgData[mn][fn]=[];}); }
                        var tSec;
                        if (row['TimeUS']!==undefined) {
                            var rawUs=row['TimeUS'];
                            if (firstTimeUS[mn]===undefined) firstTimeUS[mn]=rawUs;
                            tSec=(rawUs-firstTimeUS[mn])/1e6;
                        } else { tSec=totalRows; }
                        msgData[mn]._time.push(tSec);
                        sch.fields.forEach(function(fn){
                            if (row[fn]===undefined) return;
                            msgData[mn][fn].push(fn==='TimeUS'?tSec:row[fn]);
                        });
                        totalRows++;
                    }
                    i += pktTotal;
                } else { i++; }
            }

            // ── Stall guard ────────────────────────────────────────────
            // If fewer than 3 bytes remain the inner loop will always
            // break at `if (i + 3 > len)` without advancing `i`, causing
            // an infinite setTimeout loop that never calls onDone.
            // Treat any sub-3-byte tail as padding and finish parsing.
            if (i < len && (len - i) < 3) {
                i = len; // skip unreadable tail
            }

            // Report true percentage; cap at 99 until genuinely done.
            var pct = i >= len ? 100 : Math.min(99, Math.round(i / len * 100));
            onProgress(pct, 'Parsing… ' + pct + '%');
            if (i < len) {
                setTimeout(processChunk, 0);
            } else {
                onDone(schema, msgData, totalRows);
            }
        }

        function processChunkSafe() {
            try {
                processChunk();
            } catch (err) {
                console.error('[review-log] processChunk threw (offset ' + i + '):', err);
                // Skip the offending byte and keep going, but cap retries
                // so a truly corrupt file doesn’t loop forever.
                i++;
                if (i < len) {
                    setTimeout(processChunkSafe, 0);
                } else {
                    onDone(schema, msgData, totalRows);
                }
            }
        }

        setTimeout(processChunkSafe, 0);
    }

    /* ===================================================================
       SCHEMA RECEIVED
    =================================================================== */
    function _onSchemaReceived(rawSchema) {
        var flatSchema={}, rowCounts={}, totalSamples=0;
        Object.keys(rawSchema).forEach(function(msgName) {
            var val=rawSchema[msgName];
            if (Array.isArray(val)) { flatSchema[msgName]=val; rowCounts[msgName]=0; }
            else if (val && Array.isArray(val.fields)) {
                flatSchema[msgName]=val.fields; rowCounts[msgName]=val.rows||0; totalSamples+=(val.rows||0);
            }
        });
        _state.msgSchema=flatSchema; _state.msgRowCounts=rowCounts;
        _setProgress(100,'Done!');
        setTimeout(function(){
            try {
                _showLoading(false);
                _buildTree(flatSchema, rowCounts);
                _setPill('rl-pill green', '● READY');
                var mc = document.getElementById('rlMsgCount');
                if (mc) mc.textContent = Object.keys(flatSchema).length + ' types';
                var dr = totalSamples > 0 ? totalSamples : _state.totalRows;
                var sr = document.getElementById('rlStatRows');
                if (sr) sr.textContent = dr > 0 ? dr.toLocaleString() : '—';
                var ss = document.getElementById('rlStatSeries');
                if (ss) ss.textContent = '0';
                if (Object.keys(flatSchema).length === 0) {
                    _showError('No recognisable messages found in this log file.');
                }
            } catch (err) {
                console.error('[review-log] tree build error:', err);
                _showLoading(false);
                _setPill('rl-pill off', '● ERROR');
                _showError('Failed to display log: ' + (err && err.message ? err.message : String(err)));
            }
        }, 300);
    }

    /* ===================================================================
       TREE BUILDER
    =================================================================== */
    var _mpColors=['#ef5350','#29b6f6','#66bb6a','#ffa726','#ab47bc','#26c6da','#ff7043','#9ccc65','#ec407a','#42a5f5','#ffca28','#26a69a','#5c6bc0','#d4e157','#f06292','#80cbc4'];
    var _msgColorMap={};
    function _getMsgColor(name) {
        if (!_msgColorMap[name]) _msgColorMap[name]=_mpColors[Object.keys(_msgColorMap).length%_mpColors.length];
        return _msgColorMap[name];
    }

    function _buildTree(schema, rowCounts) {
        rowCounts=rowCounts||{};
        var scroll=document.getElementById('rlTreeScroll');
        scroll.innerHTML='';
        var msgNames=Object.keys(schema).sort();
        if (!msgNames.length) { scroll.innerHTML='<div style="color:#444;font-size:11px;padding:16px;text-align:center;">No messages found</div>'; return; }
        msgNames.forEach(function(msgName){
            var fields=schema[msgName], color=_getMsgColor(msgName);
            var group=document.createElement('div'); group.className='rl-msg-group'; group.dataset.msg=msgName;
            var rc=rowCounts[msgName]||0;
            if (!rc&&_state.msgData&&_state.msgData[msgName]) rc=(_state.msgData[msgName]._time||[]).length;
            var msgRow=document.createElement('div'); msgRow.className='rl-msg-row';
            msgRow.innerHTML='<div class="rl-msg-arrow">&#9658;</div><div class="rl-msg-dot" style="background:'+color+'"></div><span class="rl-msg-name">'+_esc(msgName)+'</span>'+(rc>0?'<span class="rl-msg-cnt">'+rc.toLocaleString()+'</span>':'');
            var fieldList=document.createElement('div'); fieldList.className='rl-fields';
            fields.forEach(function(fieldName){
                if (!fieldName) return;
                var fr=document.createElement('div'); fr.className='rl-field-row'; fr.dataset.msg=msgName; fr.dataset.field=fieldName;
                fr.innerHTML='<div class="rl-field-bullet"></div><span class="rl-field-name">'+_esc(fieldName)+'</span>';
                fr.addEventListener('click',function(){_toggleField(msgName,fieldName,fr);});
                fieldList.appendChild(fr);
            });
            msgRow.addEventListener('click',function(){
                var arrow=msgRow.querySelector('.rl-msg-arrow'), isOpen=fieldList.classList.toggle('open');
                arrow.classList.toggle('open',isOpen);
            });
            group.appendChild(msgRow); group.appendChild(fieldList); scroll.appendChild(group);
        });
    }

    function _esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function _filterTree(query) {
        document.querySelectorAll('#rlTreeScroll .rl-msg-group').forEach(function(g){
            var mn=g.dataset.msg.toLowerCase();
            if (!query||mn.includes(query)) { g.style.display=''; g.querySelectorAll('.rl-field-row').forEach(function(fr){fr.style.display='';}); }
            else {
                var any=false;
                g.querySelectorAll('.rl-field-row').forEach(function(fr){ var m=fr.dataset.field.toLowerCase().includes(query); fr.style.display=m?'':'none'; if(m) any=true; });
                g.style.display=any?'':'none';
                if (any) { var fl=g.querySelector('.rl-fields'),ar=g.querySelector('.rl-msg-arrow'); if(fl)fl.classList.add('open'); if(ar)ar.classList.add('open'); }
            }
        });
    }

    /* ===================================================================
       FIELD TOGGLE
    =================================================================== */
    function _toggleField(msgName, fieldName, rowEl) {
        var key=msgName+'.'+fieldName;
        var idx=_state.activeSeries.findIndex(function(s){return s.key===key;});
        if (idx!==-1) {
            _state.activeSeries.splice(idx,1); rowEl.classList.remove('active'); rowEl.style.removeProperty('--field-color');
            var grp=rowEl.closest('.rl-msg-group');
            if (grp) grp.querySelector('.rl-msg-row').classList.toggle('rl-has-active',grp.querySelectorAll('.rl-field-row.active').length>0);
        } else {
            var color=SERIES_COLORS[_state.colorIndex%SERIES_COLORS.length]; _state.colorIndex++;
            _state.activeSeries.push({key:key,msg:msgName,field:fieldName,color:color});
            rowEl.classList.add('active'); rowEl.style.setProperty('--field-color',color);
            var grp2=rowEl.closest('.rl-msg-group'); if(grp2) grp2.querySelector('.rl-msg-row').classList.add('rl-has-active');
        }
        _fetchAndPlot(msgName,fieldName);
    }

    /* ===================================================================
       DATA FETCHING
    =================================================================== */
    function _fetchAndPlot(msgName, fieldName) {
        if (_state.msgData&&_state.msgData[msgName]) { _renderChart(); return; }
        _setPill('rl-pill yellow','● LOADING');
        fetch(BACKEND_DATA_URL+'?msg='+encodeURIComponent(msgName)+'&field='+encodeURIComponent(fieldName))
            .then(function(r){return r.json();})
            .then(function(json){
                if (!_state.msgData[msgName]) _state.msgData[msgName]={};
                _state.msgData[msgName]._time=json.time||[]; _state.msgData[msgName][fieldName]=json.values||[];
                if (json.totalRows) document.getElementById('rlStatRows').textContent=json.totalRows.toLocaleString();
                _renderChart(); _setPill('rl-pill green','● READY');
            })
            .catch(function(){ _renderChart(); _setPill('rl-pill green','● READY'); });
    }

    /* ===================================================================
       CHART RENDERING
    =================================================================== */
    function _renderChart() {
        var noData=document.getElementById('rlNoData');
        if (!_state.activeSeries.length) {
            if (_state.chart) { _state.chart.destroy(); _state.chart=null; }
            noData.classList.remove('hidden'); _clearLegend(); _resetStats();
            document.getElementById('rlStatSeries').textContent='0';
            _state.xMin=null; _state.xMax=null; _state.xMinFull=null; _state.xMaxFull=null;
            return;
        }
        noData.classList.add('hidden');

        var datasets=[], allValues=[], allTimes=[];
        _state.activeSeries.forEach(function(s){
            var md=_state.msgData[s.msg]; if (!md) return;
            var times=md._time||[], values=md[s.field]||[];
            var step=Math.max(1,Math.floor(values.length/4000)), pts=[];
            for (var idx=0;idx<values.length;idx+=step) {
                var v=values[idx],t=times[idx];
                if (typeof v==='number'&&isFinite(v)&&typeof t==='number'&&isFinite(t)) {
                    pts.push({x:t,y:v}); allValues.push(v); allTimes.push(t);
                }
            }
            datasets.push({
                label:s.msg+'.'+s.field, data:pts,
                borderColor:s.color, backgroundColor:s.color+'18',
                borderWidth:1.5, pointRadius:pts.length>600?0:2,
                pointHoverRadius:4, tension:0.15,
                fill:_state.activeSeries.length===1
            });
        });

        if (allValues.length) {
            var mn=Math.min.apply(null,allValues), mx=Math.max.apply(null,allValues);
            var avg=allValues.reduce(function(a,b){return a+b;},0)/allValues.length;
            document.getElementById('rlStatMin').textContent=mn.toFixed(4);
            document.getElementById('rlStatMax').textContent=mx.toFixed(4);
            document.getElementById('rlStatAvg').textContent=avg.toFixed(4);
            document.getElementById('rlStatRows').textContent=allValues.length.toLocaleString();
        }
        document.getElementById('rlStatSeries').textContent=_state.activeSeries.length;

        var tMin=null, tMax=null;
        if (allTimes.length>1) {
            tMin=Math.min.apply(null,allTimes); tMax=Math.max.apply(null,allTimes);
            document.getElementById('rlStatDur').textContent=(tMax-tMin).toFixed(2)+' s';
        }

        // Preserve zoom window if it fits; expand full range if new data extends beyond
        var prevXMin=_state.xMin, prevXMax=_state.xMax;
        _state.xMinFull = tMin !== null ? tMin : 0;
        _state.xMaxFull = tMax !== null ? tMax : 1;
        // If no zoom active yet, start full view
        if (prevXMin===null) { _state.xMin=_state.xMinFull; _state.xMax=_state.xMaxFull; }
        else { _state.xMin=Math.max(_state.xMinFull,prevXMin); _state.xMax=Math.min(_state.xMaxFull,prevXMax); }

        if (_state.chart) { _state.chart.destroy(); _state.chart=null; }

        var isV3 = typeof Chart !== 'undefined' && Chart.version && parseInt(Chart.version) >= 3;
        var chartConfig;

        if (isV3) {
            chartConfig = {
                type:'line', data:{datasets:datasets},
                options:{
                    responsive:true, maintainAspectRatio:false, animation:{duration:120},
                    interaction:{mode:'index',intersect:false},
                    plugins:{ legend:{display:false},
                        tooltip:{ backgroundColor:'rgba(18,20,26,.97)', titleColor:'#5eb8d8', bodyColor:'#909090', borderColor:'#333', borderWidth:1, padding:8,
                            callbacks:{ title:function(items){return 'T = '+(+items[0].parsed.x).toFixed(3)+' s';} } }
                    },
                    scales:{
                        x:{ type:'linear', min:_state.xMin, max:_state.xMax,
                            title:{display:true,text:'Time (s)',color:'#555',font:{size:10}},
                            grid:{color:'#242424'}, ticks:{color:'#555',font:{size:10},callback:function(v){return v.toFixed(1);}} },
                        y:{ grid:{color:'#242424'}, ticks:{color:'#555',font:{size:10}} }
                    }
                }
            };
        } else {
            // Chart.js v2 format
            chartConfig = {
                type:'line', data:{datasets:datasets},
                options:{
                    responsive:true, maintainAspectRatio:false, animation:{duration:120},
                    hover:{mode:'index',intersect:false},
                    legend:{display:false},
                    tooltips:{ backgroundColor:'rgba(18,20,26,.97)', titleFontColor:'#5eb8d8', bodyFontColor:'#909090', borderColor:'#333', borderWidth:1,
                        callbacks:{ title:function(items){return 'T = '+(+items[0].xLabel).toFixed(3)+' s';} } },
                    scales:{
                        xAxes:[{ type:'linear', ticks:{ min:_state.xMin, max:_state.xMax, fontColor:'#555', fontSize:10, callback:function(v){return v.toFixed(1);} },
                            scaleLabel:{display:true,labelString:'Time (s)',fontColor:'#555',fontSize:10},
                            gridLines:{color:'#242424'} }],
                        yAxes:[{ ticks:{fontColor:'#555',fontSize:10}, gridLines:{color:'#242424'} }]
                    }
                }
            };
        }

        var ctx=document.getElementById('rlChart').getContext('2d');
        _state.chart=new Chart(ctx,chartConfig);
        _buildLegend();
    }

    /* ===================================================================
       LEGEND / CLEAR
    =================================================================== */
    function _buildLegend() {
        var legend=document.getElementById('rlLegend'); legend.innerHTML='';
        _state.activeSeries.forEach(function(s){
            var chip=document.createElement('div'); chip.className='rl-legend-chip'; chip.style.borderColor=s.color+'88';
            chip.innerHTML='<div class="rl-chip-dot" style="background:'+s.color+'"></div><span style="color:'+s.color+'">'+_esc(s.msg+'.'+s.field)+'</span><span class="rl-chip-x">✕</span>';
            chip.addEventListener('click',function(){
                var fr=document.querySelector('.rl-field-row[data-msg="'+s.msg+'"][data-field="'+s.field+'"]');
                if (fr) { fr.classList.remove('active'); fr.style.removeProperty('--field-color'); }
                var idx=_state.activeSeries.indexOf(s); if (idx!==-1) _state.activeSeries.splice(idx,1);
                _renderChart();
            });
            legend.appendChild(chip);
        });
    }
    function _clearLegend(){ var el=document.getElementById('rlLegend'); if(el) el.innerHTML=''; }
    function _clearAllSeries() {
        _state.activeSeries=[]; _state.colorIndex=0;
        document.querySelectorAll('.rl-field-row.active').forEach(function(fr){fr.classList.remove('active');fr.style.removeProperty('--field-color');});
        document.querySelectorAll('.rl-msg-row.rl-has-active').forEach(function(mr){mr.classList.remove('rl-has-active');});
        _renderChart();
    }

    /* ===================================================================
       HELPERS
    =================================================================== */
    function _setPill(cls,txt){ var p=document.getElementById('rlStatusPill'); if(p){p.className=cls;p.textContent=txt;} }
    function _setProgress(pct,txt){
        var pe=document.getElementById('rlLoadPct'),fe=document.getElementById('rlProgressFill'),te=document.getElementById('rlLoadTxt');
        if(pe)pe.textContent=pct+'%'; if(fe)fe.style.width=pct+'%'; if(te)te.textContent=txt||'';
    }
    function _showLoading(show){ var el=document.getElementById('rlLoading'); if(el) el.classList.toggle('show',show); }
    function _showError(msg){ console.error('[review-log]',msg); var el=document.getElementById('rlError'); if(!el)return; el.textContent=msg; el.classList.add('show'); setTimeout(function(){el.classList.remove('show');},5000); }
    function _resetStats(){ ['rlStatMin','rlStatMax','rlStatAvg','rlStatRows','rlStatDur'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent='—'; }); }

    /* ===================================================================
       PUBLIC API
    =================================================================== */
    var API = {
        open: function(){
            build();
            var win=document.getElementById('rlWindow'); if(win) win.classList.add('rl-on');
            ['flightControlsStrip','dropdownMenuStrip','compassContainer','videoContainer'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.setProperty('display','none','important');});
            var map=document.getElementById('map'); if(map) map.style.setProperty('display','none','important');
        },
        close: function(){
            var win=document.getElementById('rlWindow'); if(win) win.classList.remove('rl-on');
            if (window.AnalyzeToolsPanel) { window.AnalyzeToolsPanel.goBack(); }
            else {
                var map=document.getElementById('map'); if(map) map.style.removeProperty('display');
                ['flightControlsStrip','compassContainer','videoContainer'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.removeProperty('display');});
            }
        },
        handleFile: function(file){ build(); _loadFile(file); }
    };

    function _wireFileInput(){
        var fi=document.getElementById('reviewLogFileInput'); if(!fi) return;
        fi.addEventListener('change',function(){ if(this.files&&this.files[0]){API.handleFile(this.files[0]);this.value='';} });
    }

    if (document.readyState==='loading') { document.addEventListener('DOMContentLoaded',function(){build();_wireFileInput();}); }
    else { build(); _wireFileInput(); }

    window.ReviewLog=API;
    console.log('✅ review-log.js loaded — native zoom/pan (no plugin required)');
})();