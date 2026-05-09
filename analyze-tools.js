/**
 * ANALYZE TOOLS  — 5 individual full-screen windows
 * Log Download uses real WebSocket → MAVLink LOG_REQUEST_LIST / LOG_DATA
 *
 * Back button navigation:
 *   Image4 (full-screen tool)  → Back → Image3 (analyze sidebar panel)
 *   Image3 Back button         → Image2 (PLAN/ANALYZE/CONFIG/SETTINGS strip)
 *   Image2 logo click          → Image1 (TAKEOFF/LAND/RTL strip)
 */
(function () {
    'use strict';

    var CSS = `
/* ── full-screen tool windows ── */
.atw {
    position : fixed !important;
    top      : 60px !important;
    left     : 0 !important;
    width    : 100vw !important;
    height   : calc(100vh - 60px) !important;
    z-index  : 9999999 !important;
    background: #0d0f16;
    flex-direction: column;
    font-family: 'Segoe UI', system-ui, sans-serif;
    overflow: hidden;
    display : none !important;
}
.atw.atw-on { display : flex !important; }
.atw-bar {
    display: flex; align-items: center; gap: 12px;
    height: 56px; padding: 0 22px;
    background: #111420; border-bottom: 2px solid #1c1f2e;
    flex-shrink: 0;
}
.atw-back {
    display: flex; align-items: center; gap: 6px;
    background: none; border: 1px solid rgba(41,182,246,.3);
    color: #29b6f6; font-size: 13px; font-weight: 600;
    cursor: pointer; padding: 7px 14px; border-radius: 7px;
    transition: background .15s;
}
.atw-back:hover { background: rgba(41,182,246,.12); }
.atw-back svg { width:15px; height:15px; flex-shrink:0; }
.atw-bar-sep { width:1px; height:24px; background:#1e2230; }
.atw-bar-ico {
    width:34px; height:34px; border-radius:9px;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.atw-bar-title { font-size:16px; font-weight:700; color:#e0e4f2; }
.atw-bar-desc  { font-size:12px; color:#363c58; margin-left:4px; }
.atw-body { flex:1; overflow:hidden; display:flex; flex-direction:column; padding:20px 26px; gap:14px; }

/* ── Analyze sidebar panel ── */
#analyzePanel {
    position: fixed !important;
    top: 60px !important;
    left: 0 !important;
    width: 265px !important;
    background: rgba(11,13,20,0.97) !important;
    border-right: 1px solid #181c2a !important;
    border-bottom-right-radius: 10px !important;
    z-index: 999998 !important;
    font-family: 'Segoe UI', system-ui, sans-serif !important;
    display: none;
    flex-direction: column !important;
}
#analyzePanel.ap-on { display: flex; }

.ap-header {
    display: flex;
    align-items: center;
    padding: 12px 14px 10px;
    border-bottom: 1px solid #181c2a;
    gap: 8px;
}
.ap-title-wrap { display:flex; align-items:center; gap:7px; flex:1; }
.ap-title-wrap svg { width:14px; height:14px; stroke:#ffa726; fill:none; flex-shrink:0; }
.ap-title-text { color:#ffa726; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.8px; }

.ap-back-btn {
    display: flex; align-items: center; gap: 4px;
    background: none;
    border: 1px solid rgba(41,182,246,.35);
    color: #29b6f6;
    font-size: 11px; font-weight: 600;
    cursor: pointer; padding: 5px 11px; border-radius: 6px;
    transition: background .15s; white-space: nowrap;
}
.ap-back-btn:hover { background: rgba(41,182,246,.12); }
.ap-back-btn svg { width:11px; height:11px; flex-shrink:0; }

.ap-list { display:flex; flex-direction:column; }

.ap-item {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px;
    cursor: pointer;
    transition: background .12s;
    border-bottom: 1px solid #10131e;
}
.ap-item:last-child { border-bottom: none; }
.ap-item:hover { background: rgba(255,255,255,.035); }

.ap-item-ico {
    width:28px; height:28px; border-radius:7px;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.ap-item-ico svg { width:14px; height:14px; fill:none; }
.ap-item-body { flex:1; min-width:0; }
.ap-item-label { display:block; color:#c8cedf; font-weight:600; font-size:13px; }
.ap-item-desc  { display:block; color:#2e3450; font-size:11px; margin-top:1px; }
.ap-item-chev  { flex-shrink:0; }
.ap-item-chev svg { width:13px; height:13px; stroke:#1e2234; fill:none; }

/* ── shared toolbar/table/etc ── */
.atw-tb { display:flex; align-items:center; gap:9px; flex-shrink:0; flex-wrap:wrap; }
.atw-btn {
    display:inline-flex; align-items:center; gap:6px;
    padding:7px 15px; border-radius:6px;
    border:1px solid #22273c; background:#161924;
    color:#8890aa; font-size:12px; font-weight:600;
    cursor:pointer; transition:all .15s; white-space:nowrap;
}
.atw-btn svg { width:13px; height:13px; flex-shrink:0; }
.atw-btn:hover { background:#1d2234; color:#d0d5ea; border-color:#2e3550; }
.atw-btn.p { background:rgba(41,182,246,.09); border-color:rgba(41,182,246,.3); color:#29b6f6; }
.atw-btn.p:hover { background:rgba(41,182,246,.18); border-color:#29b6f6; }
.atw-btn.d { background:rgba(244,67,54,.08); border-color:rgba(244,67,54,.25); color:#f44336; }
.atw-btn.d:hover { background:rgba(244,67,54,.16); border-color:#f44336; }
.atw-btn.sm { padding:5px 11px; font-size:11px; }
.atw-btn.full { width:100%; justify-content:center; margin-top:18px; }
.atw-sp { flex:1; }
.atw-pill { padding:3px 12px; border-radius:20px; font-size:11px; font-weight:600; white-space:nowrap; }
.atw-pill.off    { background:#131620; color:#2e3448; border:1px solid #1c2030; }
.atw-pill.green  { background:rgba(76,175,80,.1);  color:#4caf50; border:1px solid rgba(76,175,80,.22); }
.atw-pill.yellow { background:rgba(255,152,0,.1);  color:#ff9800; border:1px solid rgba(255,152,0,.22); }
.atw-pill.red    { background:rgba(244,67,54,.1);  color:#f44336; border:1px solid rgba(244,67,54,.22); }
.atw-pill.blue   { background:rgba(41,182,246,.1); color:#29b6f6; border:1px solid rgba(41,182,246,.22); }
.atw-twrap { flex:1; overflow-y:auto; border:1px solid #181c28; border-radius:8px; background:#0a0c14; min-height:0; }
.atw-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
.atw-tbl thead tr { background:#10131f; position:sticky; top:0; z-index:1; }
.atw-tbl th { padding:10px 14px; color:#2c3248; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.7px; border-bottom:1px solid #181c28; text-align:left; white-space:nowrap; }
.atw-tbl td { padding:10px 14px; color:#7880a0; border-bottom:1px solid #10131f; }
.atw-tbl tbody tr:hover { background:#10141e; }
.atw-tbl tbody tr:last-child td { border-bottom:none; }
.atw-empty td { padding:50px 14px !important; }
.atw-empty-box { display:flex; flex-direction:column; align-items:center; gap:12px; color:#1c2030; font-size:12px; }
.atw-empty-box svg { width:40px; height:40px; stroke:#1c2030; fill:none; }
.atw-bot { display:flex; align-items:center; gap:12px; padding:8px 0; color:#28304a; font-size:11.5px; flex-shrink:0; }
.atw-prog-wrap { display:flex; align-items:center; gap:8px; flex:1; }
.atw-prog-bar  { flex:1; height:4px; background:#181c28; border-radius:2px; overflow:hidden; }
.atw-prog-fill { height:100%; background:#29b6f6; border-radius:2px; transition:width .2s; }
.atw-actbtn { padding:5px 12px; background:#141820; border:1px solid #1e2432; border-radius:5px; color:#363c58; font-size:11px; cursor:pointer; transition:all .15s; }
.atw-actbtn:hover { background:#1a2032; color:#aaa; border-color:#303a58; }
.atw-actbtn:disabled { opacity:0.5; cursor:not-allowed; }
.atw-2col { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:22px; overflow:hidden; min-height:0; }
.atw-col  { display:flex; flex-direction:column; gap:12px; overflow-y:auto; }
.atw-col-h { color:#2c3248; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.8px; padding-bottom:9px; border-bottom:1px solid #181c28; }
.atw-field { display:flex; flex-direction:column; gap:5px; }
.atw-field label { color:#404a70; font-size:11.5px; font-weight:600; }
.atw-inp { width:100%; padding:8px 12px; background:#14182a; border:1px solid #1e2432; border-radius:6px; color:#7880a0; font-size:12.5px; outline:none; box-sizing:border-box; transition:border-color .15s; }
.atw-inp:focus { border-color:#29b6f6; }
select.atw-inp { cursor:pointer; }
.atw-file-row { display:flex; gap:7px; }
.atw-file-row .atw-inp { flex:1; }
.atw-checks { display:flex; flex-direction:column; gap:8px; }
.atw-checks label { display:flex; align-items:center; gap:8px; color:#404a70; font-size:12px; cursor:pointer; }
.atw-checks input[type=checkbox] { accent-color:#29b6f6; }
.atw-stats { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; flex-shrink:0; }
.atw-stat { background:#14182a; border:1px solid #181c28; border-radius:9px; padding:14px 10px; display:flex; flex-direction:column; align-items:center; gap:5px; }
.atw-stat-n { font-size:26px; font-weight:700; color:#7880a0; }
.atw-stat-n.g { color:#4caf50; }
.atw-stat-n.r { color:#f44336; }
.atw-stat-l { font-size:10px; color:#242d44; text-transform:uppercase; letter-spacing:.5px; }
.atw-logout { flex:1; background:#09090f; border:1px solid #14182a; border-radius:7px; padding:12px 14px; font-family:'Courier New',monospace; font-size:11.5px; overflow-y:auto; display:flex; flex-direction:column; gap:3px; min-height:120px; }
.atw-ll { display:block; }
.atw-ll.m { color:#1c2030; }
.atw-ll.g { color:#4caf50; }
.atw-ll.y { color:#ff9800; }
.atw-ll.r { color:#f44336; }
.atw-console { flex:1; overflow:hidden; display:flex; flex-direction:column; }
.atw-term { flex:1; background:#08090e; padding:16px 18px; font-family:'Courier New',Consolas,monospace; font-size:12.5px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }
.atw-tl { display:block; color:#7880a0; line-height:1.55; white-space:pre-wrap; word-break:break-all; }
.atw-tl.m { color:#1c2030; } .atw-tl.c { color:#29b6f6; }
.atw-inp-row { display:flex; align-items:center; gap:9px; padding:12px 18px; background:#0d0f18; border-top:1px solid #14182a; flex-shrink:0; }
.atw-prompt { color:#4caf50; font-family:'Courier New',monospace; font-size:13px; font-weight:700; white-space:nowrap; }
.atw-cmd-in { flex:1; background:transparent; border:none; outline:none; color:#c8cedf; font-family:'Courier New',monospace; font-size:13px; caret-color:#29b6f6; }
.atw-qbar { display:flex; align-items:center; gap:7px; padding:9px 18px; background:#0b0c14; border-top:1px solid #14182a; flex-wrap:wrap; flex-shrink:0; }
.atw-ql { color:#1c2030; font-size:11px; margin-right:4px; }
.atw-qb { padding:4px 11px; background:#10131f; border:1px solid #1a1e30; border-radius:4px; color:#303858; font-size:11px; font-family:'Courier New',monospace; cursor:pointer; transition:all .15s; }
.atw-qb:hover { color:#4caf50; border-color:#4caf50; background:#12161e; }
.atw-insp-wrap { flex:1; display:grid; grid-template-columns:1fr 360px; gap:16px; overflow:hidden; min-height:0; }
.atw-insp-left { display:flex; flex-direction:column; gap:8px; overflow:hidden; }
.atw-insp-left .atw-twrap { flex:1; }
.atw-insp-right { background:#0c0e18; border:1px solid #181c28; border-radius:9px; overflow-y:auto; }
.atw-insp-ph { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:14px; }
.atw-insp-ph svg { width:40px; height:40px; stroke:#181c28; fill:none; }
.atw-insp-ph span { font-size:12px; color:#1c2030; }
.atw-insp-d { padding:16px; }
.atw-insp-dt { display:flex; align-items:center; gap:8px; color:#ffa726; font-family:monospace; font-size:13px; font-weight:700; margin-bottom:4px; padding-bottom:9px; border-bottom:1px solid #181c28; }
.atw-insp-dmeta { font-size:10px; color:#2c3248; margin-bottom:12px; }
.atw-dot { display:inline-block; width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.atw-dot.g { background:#4caf50; box-shadow:0 0 4px #4caf50; }
.atw-dot.y { background:#ff9800; box-shadow:0 0 4px #ff9800; }
.atw-dot.b { background:#29b6f6; box-shadow:0 0 4px #29b6f6; }
.atw-dot.off { background:#2c3248; }
.atw-mn { color:#c8cedf; font-family:monospace; font-size:12px; }
.atw-mf { color:#4caf50; font-family:monospace; font-size:11.5px; font-weight:600; }
.atw-mc { color:#29b6f6; font-family:monospace; font-size:12px; }
.atw-irow { cursor:pointer; transition:background .1s; }
.atw-irow:hover { background:#10141e !important; }
.atw-irow.insp-selected { background:#101828 !important; }
.atw-fn { font-family:monospace; color:#4a5578; font-size:12px; }
.atw-fv { font-family:monospace; color:#e0e4f2; font-size:12px; font-weight:500; }
.atw-fu { font-size:10.5px; color:#1c2030; }
/* Rate bar in inspector table */
.insp-rate-cell { display:flex; align-items:center; gap:7px; min-width:90px; }
.insp-rate-bar { width:52px; height:4px; background:#181c28; border-radius:2px; overflow:hidden; flex-shrink:0; }
.insp-rate-fill { height:100%; border-radius:2px; transition:width .4s,background .4s; }
.insp-rate-txt { font-family:monospace; font-size:11px; min-width:38px; text-align:right; }
/* Flash on row update */
@keyframes insp-flash { 0%{background:#1a2840} 100%{background:transparent} }
.insp-flash { animation:insp-flash .35s ease-out; }
/* Flash on field value change */
@keyframes insp-val-flash { 0%{color:#29b6f6} 100%{color:#e0e4f2} }
.insp-changed { animation:insp-val-flash .4s ease-out; }
/* Search */
.insp-search { width:100%; padding:7px 12px; background:#0e1120; border:1px solid #1e2432; border-radius:6px; color:#8890aa; font-size:12px; outline:none; box-sizing:border-box; }
.insp-search:focus { border-color:rgba(255,167,38,.4); }
/* field flash */
@keyframes fv-flash { 0%{color:#ffa726} 100%{color:#e0e4f2} }
.fv-flash { animation:fv-flash .5s ease-out; }
.atw-vib-body { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:16px; }
.atw-vib-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; flex-shrink:0; }
.atw-vib-card { background:#10131e; border:1px solid #181c28; border-radius:10px; padding:16px; }
.atw-vib-ct { color:#2c3248; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; margin-bottom:14px; }
.atw-vib-axes { display:flex; flex-direction:column; gap:11px; }
.atw-vib-ax { display:grid; grid-template-columns:52px 1fr 48px; align-items:center; gap:9px; }
.atw-vib-al { color:#2c3248; font-size:11.5px; }
.atw-vib-tr { height:5px; background:#181c28; border-radius:3px; overflow:hidden; }
.atw-vib-fi { height:100%; background:#4caf50; border-radius:3px; transition:width .4s,background .4s; }
.atw-vib-v  { color:#4caf50; font-size:11.5px; font-family:monospace; text-align:right; transition:color .4s; }
.atw-clip-g { display:flex; flex-direction:column; gap:9px; margin-bottom:10px; }
.atw-clip-r { display:flex; align-items:center; justify-content:space-between; }
.atw-clip-l { color:#2c3248; font-size:12px; }
.atw-clip-v { font-family:monospace; font-size:14px; font-weight:700; }
.atw-clip-v.g { color:#4caf50; } .atw-clip-v.r { color:#f44336; }
.atw-clip-n { color:#1c2030; font-size:10.5px; line-height:1.4; }
.atw-vib-rt { color:#2c3248; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:9px; }
.atw-muted  { color:#1c2030; font-size:11px; }

/* ── per-row download progress bar in log table ── */
.log-row-prog { display:none; align-items:center; gap:6px; margin-top:4px; }
.log-row-prog.active { display:flex; }
.log-row-pbar { flex:1; height:3px; background:#181c28; border-radius:2px; overflow:hidden; }
.log-row-pfill { height:100%; background:#29b6f6; border-radius:2px; transition:width .15s; }
.log-row-plbl  { font-size:10px; color:#29b6f6; min-width:32px; text-align:right; }
`;

    function injectCSS() {
        if (document.getElementById('atw-css')) return;
        var s = document.createElement('style');
        s.id = 'atw-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    var TOOLS = [
        { id: 'log-download', i18n_lbl: 'at.tool.logdl', i18n_desc: 'at.tool.logdl.desc', label: 'Log Download', desc: 'Flight log files', color: '#29b6f6', ibg: 'rgba(41,182,246,0.13)', svg: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.5"/><path d="M12 12v6m0 0l-3-3m3 3l3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
        { id: 'review-log', i18n_lbl: 'at.tool.review', i18n_desc: 'at.tool.review.desc', label: 'Review a Log', desc: 'Analyze flight log', color: '#ab47bc', ibg: 'rgba(171,71,188,0.13)', svg: '<path d="M4 4H20V20H4V4ZM8 8H16M8 12H16M8 16H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
        { id: 'mavlink-inspector', i18n_lbl: 'at.tool.inspect', i18n_desc: 'at.tool.inspect.desc', label: 'MAVLink Inspector', desc: 'Live messages', color: '#ffa726', ibg: 'rgba(255,167,38,0.13)', svg: '<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' }
    ];

    /* ══════════════════════════════════════════════════════
       LOG DOWNLOAD — real WebSocket state
    ══════════════════════════════════════════════════════ */

    var _logList = [];   // { id, size, time_utc, num_logs }[]
    var _logScanActive = false;
    var _logScanTimer = null;
    var _dlQueue = [];
    var _isDownloading = false;

    // ── WebSocket helpers ─────────────────────────────────────────────────────
    // We piggyback on window.ws which is set by app.js (or drone-map-fix.js).
    // A polling interval re-attaches the listener whenever the socket reconnects.

    function _wsSend(obj) {
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify(obj));
            return true;
        }
        // Fallback: try the known backend URL
        console.warn('[AnalyzeTools] WebSocket not open — message dropped:', obj.type);
        return false;
    }

    // Attach our message listener to whatever socket is currently live.
    // Idempotent: tags the socket with _atw_listener so we don't double-attach.
    function _attachWsListener() {
        if (!window.ws) return;
        if (window.ws._atw_listener) return;
        window.ws._atw_listener = true;

        window.ws.addEventListener('message', function (evt) {
            var data;
            try { data = JSON.parse(evt.data); } catch (_) { return; }

            if (data.type === 'log_entry') _onLogEntry(data);
            else if (data.type === 'log_download_progress') _onLogProgress(data);
            else if (data.type === 'log_download_done') _onLogDone(data);
        });
    }

    // Re-attach whenever window.ws changes (reconnect scenario)
    setInterval(function () {
        if (window.ws && !window.ws._atw_listener) _attachWsListener();
    }, 800);

    /* ── log_entry handler ── */
    function _onLogEntry(data) {
        if (_logList.find(function (l) { return l.id === data.id; })) return;
        _logList.push({ id: data.id, size: data.size, time_utc: data.time_utc, num_logs: data.num_logs });

        if (data.num_logs > 0 && _logList.length >= data.num_logs) {
            clearTimeout(_logScanTimer);
            _finaliseLogList();
        }
    }

    /* ── render the log table ── */
    function _finaliseLogList() {
        _logScanActive = false;

        var body = document.getElementById('logTbody');
        var pill = document.getElementById('logConnPill');
        var cnt = document.getElementById('logCntLbl');
        if (!body) return;

        if (_logList.length === 0) {
            body.innerHTML =
                '<tr class="atw-empty"><td colspan="6">' +
                '<div class="atw-empty-box">' +
                '<svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.5"/></svg>' +
                '<span>No logs found on vehicle</span></div></td></tr>';
            if (pill) { pill.innerHTML = '<span data-i18n="at.dyn.no_logs">' + (window.i18n ? window.i18n.t('at.dyn.no_logs') : '● No Logs') + '</span>'; pill.className = 'atw-pill yellow'; }
            if (cnt) cnt.textContent = '0 logs found';
            return;
        }

        _logList.sort(function (a, b) { return b.id - a.id; });

        var rows = _logList.map(function (log) {
            var sizeMB = (log.size / (1024 * 1024)).toFixed(2) + ' MB';
            var dateStr = '--', timeStr = '--';
            if (log.time_utc && log.time_utc > 0) {
                var d = new Date(log.time_utc * 1000);
                dateStr = d.toLocaleDateString();
                timeStr = d.toLocaleTimeString();
            }
            return '<tr id="logrow_' + log.id + '">' +
                '<td><input type="checkbox" class="lchk" data-lid="' + log.id + '"></td>' +
                '<td style="color:#c8cedf;font-weight:600">' + log.id + '</td>' +
                '<td>' + dateStr + '</td>' +
                '<td>' + timeStr + '</td>' +
                '<td>' + sizeMB + '</td>' +
                '<td>' +
                '<div style="display:flex;flex-direction:column;gap:2px">' +
                '<button class="atw-actbtn" id="dlbtn_' + log.id + '" ' +
                'onclick="window.AnalyzeToolsPanel._dlLog(' + log.id + ',' + log.size + ')">' +
                '<span data-i18n="at.log.dl">⬇ Download</span>' +
                '</button>' +
                '<div class="log-row-prog" id="logprog_' + log.id + '">' +
                '<div class="log-row-pbar"><div class="log-row-pfill" id="logfill_' + log.id + '" style="width:0%"></div></div>' +
                '<span class="log-row-plbl" id="loglbl_' + log.id + '">0%</span>' +
                '</div>' +
                '</div>' +
                '</td>' +
                '</tr>';
        }).join('');

        body.innerHTML = rows;

        if (pill) { pill.innerHTML = '<span data-i18n="at.dyn.connected">' + (window.i18n ? window.i18n.t('at.dyn.connected') : '● Connected') + '</span>'; pill.className = 'atw-pill green'; }
        if (cnt) cnt.textContent = _logList.length + ' log' + (_logList.length !== 1 ? 's' : '') + ' found';
    }

    /* ── download progress ── */
    function _onLogProgress(data) {
        var id = data.log_id;
        var recv = data.received || 0;
        var tot = data.total || 0;
        var pct = tot > 0 ? Math.min(100, Math.round((recv / tot) * 100)) : 0;

        var fill = document.getElementById('logfill_' + id);
        var lbl = document.getElementById('loglbl_' + id);
        var prog = document.getElementById('logprog_' + id);
        var btn = document.getElementById('dlbtn_' + id);

        if (prog) prog.classList.add('active');
        if (fill) fill.style.width = pct + '%';
        if (lbl) lbl.textContent = pct + '%';
        if (btn) btn.textContent = '⏳ ' + pct + '%';

        var gWrap = document.getElementById('logProgWrap');
        var gFill = document.getElementById('logProgFill');
        var gLbl = document.getElementById('logProgLbl');
        if (gWrap) gWrap.style.display = 'flex';
        if (gFill) gFill.style.width = pct + '%';
        if (gLbl) gLbl.textContent = pct + '%';
    }

    /* ── download complete → trigger browser file save ── */
    function _onLogDone(data) {
        var id = data.log_id;
        var fill = document.getElementById('logfill_' + id);
        var lbl = document.getElementById('loglbl_' + id);
        var btn = document.getElementById('dlbtn_' + id);
        var prog = document.getElementById('logprog_' + id);

        if (fill) fill.style.width = '100%';
        if (lbl) lbl.textContent = '100%';
        if (btn) { btn.textContent = '✅ Saved'; btn.disabled = false; }

        setTimeout(function () {
            if (prog) prog.classList.remove('active');
            if (btn) btn.textContent = '⬇ Download';
            var gWrap = document.getElementById('logProgWrap');
            if (gWrap) gWrap.style.display = 'none';
            if (window.AnalyzeToolsPanel && window.AnalyzeToolsPanel._processDlQueue) window.AnalyzeToolsPanel._processDlQueue();
        }, 2500);

        try {
            var binary = atob(data.data);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            var blob = new Blob([bytes], { type: 'application/octet-stream' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'log_' + id + '.bin';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (window.MsgConsole) {
                var kb = data.size ? (data.size / 1024).toFixed(1) : '?';
                window.MsgConsole.success('📥 Log #' + id + ' downloaded (' + kb + ' KB)');
            }
        } catch (e) {
            console.error('[LogDownload] Decode error:', e);
            if (btn) btn.textContent = '⚠ Error';
        }
    }

    /* ══════════════════════════════════════════════════════
       BUILD PANEL & WINDOWS
    ══════════════════════════════════════════════════════ */

    function buildAnalyzePanel() {
        if (document.getElementById('analyzePanel')) return;
        var panel = document.createElement('div');
        panel.id = 'analyzePanel';

        panel.innerHTML =
            '<div class="ap-header">' +
            '<div class="ap-title-wrap">' +
            '<svg viewBox="0 0 24 24"><path d="M22 12H18L15 21L9 3L6 12H2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '<span class="ap-title-text" data-i18n="at.title">Analyze Tools</span>' +
            '</div>' +
            '<button class="ap-back-btn" id="apBackBtn">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '<span data-i18n="at.back">Back</span>' +
            '</button>' +
            '</div>' +
            '<div class="ap-list" id="apList"></div>';

        document.body.appendChild(panel);

        var list = document.getElementById('apList');
        TOOLS.forEach(function (t) {
            var item = document.createElement('div');
            item.className = 'ap-item';
            item.innerHTML =
                '<div class="ap-item-ico" style="background:' + t.ibg + '">' +
                '<svg viewBox="0 0 24 24" fill="none" style="stroke:' + t.color + ';width:14px;height:14px">' + t.svg + '</svg>' +
                '</div>' +
                '<div class="ap-item-body">' +
                '<span class="ap-item-label" data-i18n="' + t.i18n_lbl + '">' + t.label + '</span>' +
                '<span class="ap-item-desc" data-i18n="' + t.i18n_desc + '">' + t.desc + '</span>' +
                '</div>' +
                '<div class="ap-item-chev">' +
                '<svg viewBox="0 0 24 24"><path d="M9 18L15 12L9 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</div>';

            (function (toolId) {
                item.addEventListener('click', function () {
                    if (toolId === 'review-log') {
                        // Hide the analyze panel first, then open file picker.
                        // _loadFile() inside review-log.js calls API.open() which
                        // shows #rlWindow as a fullscreen overlay.
                        API.closeAll();
                        var fi = document.getElementById('reviewLogFileInput');
                        if (fi) fi.click();
                        return;
                    }
                    if (toolId === 'log-download') {
                        // Hide analyze panel, then show the log download overlay.
                        API.closeAll();
                        if (window.LogDownloadPanel) window.LogDownloadPanel.open();
                        return;
                    }
                    API.openTool(toolId);
                });
            })(t.id);

            list.appendChild(item);
        });

        document.getElementById('apBackBtn').addEventListener('click', function () {
            API.hideAnalyzePanel();
            if (window.DropdownStrip && window.DropdownStrip.showPlanStrip) {
                window.DropdownStrip.showPlanStrip();
            } else {
                var strip = document.getElementById('dropdownMenuStrip');
                var flight = document.getElementById('flightControlsStrip');
                if (strip) strip.style.setProperty('display', 'flex', 'important');
                if (flight) flight.style.setProperty('display', 'none', 'important');
            }
        });
    }

    var _built = false;
    function buildWindows() {
        if (_built) return;
        _built = true;
        injectCSS();
        buildAnalyzePanel();

        TOOLS.forEach(function (t) {
            var win = document.createElement('div');
            win.className = 'atw';
            win.id = 'atw-' + t.id;
            win.innerHTML =
                '<div class="atw-bar">' +
                '<button class="atw-back" onclick="window.AnalyzeToolsPanel.goBack()">' +
                '<svg viewBox="0 0 24 24" fill="none"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '<span data-i18n="at.back">Back</span>' +
                '</button>' +
                '<div class="atw-bar-sep"></div>' +
                '<div class="atw-bar-ico" style="background:' + t.ibg + '">' +
                '<svg viewBox="0 0 24 24" fill="none" style="stroke:' + t.color + ';width:18px;height:18px">' + t.svg + '</svg>' +
                '</div>' +
                '<span class="atw-bar-title" data-i18n="' + t.i18n_lbl + '">' + t.label + '</span>' +
                '<span class="atw-bar-desc" data-i18n="' + t.i18n_desc + '">' + t.desc + '</span>' +
                '</div>' +
                '<div class="atw-body">' + buildBody(t.id) + '</div>';
            document.body.appendChild(win);
        });

        // After building the HTML, force the i18n to translate these strings immediately
        if (window.i18n && window.i18n.setLang) {
            window.i18n.setLang(window.i18n.getLang ? window.i18n.getLang() : (localStorage.getItem('tihan_lang') || 'en'));
        }
        console.log('✅ Analyze panel + tool windows built');
    }

    function buildBody(id) {
        if (id === 'log-download') return bodyLog();
        if (id === 'geotag-images') return bodyGeo();
        if (id === 'mavlink-console') return bodyCon();
        if (id === 'mavlink-inspector') return bodyInsp();
        if (id === 'vibration') return bodyVib();
        return '';
    }

    function B(cls, fn, ico, lbl, id, i18Key) {
        return '<button class="atw-btn' + (cls ? ' ' + cls : '') + '"' +
            (id ? ' id="' + id + '"' : '') + ' onclick="' + fn + '">' +
            (ico || '') + (ico && lbl ? ' ' : '') + '<span' + (i18Key ? ' data-i18n="' + i18Key + '"' : '') + '>' + (lbl || '') + '</span></button>';
    }
    function F(lbl, ctrl, i18Key) { return '<div class="atw-field"><label' + (i18Key ? ' data-i18n="' + i18Key + '"' : '') + '>' + lbl + '</label>' + ctrl + '</div>'; }
    function SVG(d) {
        return '<svg viewBox="0 0 24 24" fill="none" style="width:13px;height:13px;flex-shrink:0">' +
            '<path d="' + d + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    /* ── LOG DOWNLOAD body ── */
    function bodyLog() {
        return '<div class="atw-tb">' +
            B('p', 'window.AnalyzeToolsPanel._refreshLogs()',
                SVG('M1 4V10H7M3.51 15a9 9 0 1 0 .49-4.05'), 'Refresh', '', 'at.log.refresh') +
            B('', 'window.AnalyzeToolsPanel._downloadSel()',
                SVG('M12 15V3M12 15L8 11M12 15L16 11M3 21H21'), 'Download Selected', '', 'at.log.dl_sel') +
            B('d', 'window.AnalyzeToolsPanel._deleteLogs()',
                SVG('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'), 'Delete All', '', 'at.log.del_all') +
            '<div class="atw-sp"></div>' +
            '<span class="atw-pill off" id="logConnPill" data-i18n="at.log.no_conn">● Not Connected</span>' +
            '</div>' +
            '<div class="atw-twrap">' +
            '<table class="atw-tbl">' +
            '<thead><tr>' +
            '<th><input type="checkbox" id="logSelAll" onchange="window.AnalyzeToolsPanel._selAll(this)"></th>' +
            '<th data-i18n="at.log.id">ID</th><th data-i18n="at.log.date">Date</th><th data-i18n="at.log.time">Time</th><th data-i18n="at.log.size">Size</th><th data-i18n="at.log.action">Action</th>' +
            '</tr></thead>' +
            '<tbody id="logTbody">' +
            '<tr class="atw-empty"><td colspan="6">' +
            '<div class="atw-empty-box">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.5"/></svg>' +
            '<span data-i18n="at.log.connect_pls">Connect to vehicle to load logs</span>' +
            '</div></td></tr>' +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '<div class="atw-bot">' +
            '<span id="logCntLbl">0 logs found</span>' +
            '<div class="atw-prog-wrap" id="logProgWrap" style="display:none">' +
            '<div class="atw-prog-bar"><div class="atw-prog-fill" id="logProgFill"></div></div>' +
            '<span id="logProgLbl">0%</span>' +
            '</div>' +
            '</div>';
    }

    function bodyGeo() {
        return '<div class="atw-2col"><div class="atw-col">' +
            '<div class="atw-col-h" data-i18n="at.geo.select">Image &amp; Log Selection</div>' +
            F('Image Directory', '<div class="atw-file-row"><input type="text" class="atw-inp" id="geoImgDir" placeholder="/path/to/images" readonly>' + B('', 'window.AnalyzeToolsPanel._browseImgs()', '', 'Browse', '', 'at.geo.browse') + '</div>', 'at.geo.img_dir') +
            F('Log File', '<div class="atw-file-row"><input type="text" class="atw-inp" id="geoLogFile" placeholder="Select .log or .tlog" readonly>' + B('', 'window.AnalyzeToolsPanel._browseLog()', '', 'Browse', '', 'at.geo.browse') + '</div>', 'at.geo.log_file') +
            F('Camera Trigger Source', '<select class="atw-inp"><option>CAM Message</option><option>Servo Trigger</option><option>Time Interval</option></select>', 'at.geo.trigger') +
            F('Max Time Offset (ms)', '<input type="number" class="atw-inp" value="1000" min="0">', 'at.geo.offset') +
            '<div class="atw-checks">' +
            '<label><input type="checkbox" checked> <span data-i18n="at.geo.cb1">Write tags to EXIF</span></label>' +
            '<label><input type="checkbox"> <span data-i18n="at.geo.cb2">Export CSV log</span></label>' +
            '<label><input type="checkbox"> <span data-i18n="at.geo.cb3">Overwrite existing tags</span></label>' +
            '</div>' +
            '<button class="atw-btn p full" onclick="window.AnalyzeToolsPanel._runGeo()">' + SVG('M5 3l14 9-14 9V3z') + ' <span data-i18n="at.geo.start">Start GeoTagging</span></button>' +
            '</div><div class="atw-col"><div class="atw-col-h" data-i18n="at.geo.res">Results</div>' +
            '<div class="atw-stats">' +
            '<div class="atw-stat"><span class="atw-stat-n" id="geoTotal">—</span><span class="atw-stat-l" data-i18n="at.geo.found">Found</span></div>' +
            '<div class="atw-stat"><span class="atw-stat-n g" id="geoTagged">—</span><span class="atw-stat-l" data-i18n="at.geo.tagged">Tagged</span></div>' +
            '<div class="atw-stat"><span class="atw-stat-n r" id="geoSkipped">—</span><span class="atw-stat-l" data-i18n="at.geo.skipped">Skipped</span></div>' +
            '</div>' +
            '<div class="atw-logout" id="geoLogOut"><span class="atw-ll m">Waiting for operation…</span></div>' +
            '</div></div>';
    }

    function bodyCon() {
        var qcmds = ['top', 'free', 'ver all', 'param show *', 'dmesg', 'sensors status'];
        return '<div class="atw-console"><div class="atw-term" id="mavTerm">' +
            '<div class="atw-tl m" data-i18n="at.con.ready">MAVLink Console — vehicle shell ready</div>' +
            '<div class="atw-tl m">──────────────────────────────────────</div>' +
            '</div><div class="atw-inp-row">' +
            '<span class="atw-prompt">nsh&gt;</span>' +
            '<input class="atw-cmd-in" id="mavIn" placeholder="Enter command…" onkeydown="if(event.key===\'Enter\')window.AnalyzeToolsPanel._sendCmd()">' +
            B('p', 'window.AnalyzeToolsPanel._sendCmd()', '', 'Send', '', 'at.con.send') +
            B('', 'window.AnalyzeToolsPanel._clrCon()', '', 'Clear', '', 'at.con.clear') +
            '</div><div class="atw-qbar"><span class="atw-ql" data-i18n="at.con.quick">Quick:</span>' +
            qcmds.map(function (c) {
                return '<button class="atw-qb" onclick="window.AnalyzeToolsPanel._qcmd(\'' + c + '\')">' + c + '</button>';
            }).join('') +
            '</div></div>';
    }

    function bodyInsp() {
        return '<div class="atw-tb">' +
            '<span class="atw-pill off" id="inspPill">● Disconnected</span>' +
            B('sm p', 'window.AnalyzeToolsPanel._togInsp()', '', '▶ Start', 'inspTogBtn', 'at.ins.start') +
            B('sm', 'window.AnalyzeToolsPanel._clrInsp()', '', 'Clear', '', 'at.con.clear') +
            '<div class="atw-sp"></div>' +
            '<span id="inspMsgCount" style="font-size:11px;color:#2c3248">0 messages</span>' +
            '</div>' +
            '<input class="insp-search" id="inspSearch" placeholder="🔍  Filter messages…" oninput="window.AnalyzeToolsPanel._filterInsp(this.value)">' +
            '<div class="atw-insp-wrap">' +
            '<div class="atw-insp-left">' +
            '<div class="atw-twrap">' +
            '<table class="atw-tbl" id="inspTable">' +
            '<thead><tr>' +
            '<th style="width:20px"></th>' +
            '<th data-i18n="at.ins.msg">Message</th>' +
            '<th data-i18n="at.ins.rate">Rate</th>' +
            '<th data-i18n="at.ins.count">Count</th>' +
            '<th></th>' +
            '</tr></thead>' +
            '<tbody id="inspTbody">' +
            '<tr class="atw-empty"><td colspan="5">' +
            '<div class="atw-empty-box">' +
            '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
            '<span>Press ▶ Start to begin inspection</span>' +
            '</div></td></tr>' +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '</div>' +
            '<div class="atw-insp-right" id="inspPane">' +
            '<div class="atw-insp-ph">' +
            '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
            '<span>Select a message to inspect</span>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    function bodyVib() {
        function icard(title, pfx) {
            return '<div class="atw-vib-card"><div class="atw-vib-ct">' + title + '</div>' +
                '<div class="atw-vib-axes">' +
                ['X', 'Y', 'Z'].map(function (ax) {
                    var lo = ax.toLowerCase();
                    return '<div class="atw-vib-ax">' +
                        '<span class="atw-vib-al">Vibe ' + ax + '</span>' +
                        '<div class="atw-vib-tr"><div class="atw-vib-fi" id="' + pfx + lo + '" style="width:0%"></div></div>' +
                        '<span class="atw-vib-v" id="' + pfx + lo + '_v">0.0</span>' +
                        '</div>';
                }).join('') +
                '</div></div>';
        }
        return '<div class="atw-tb">' +
            '<span class="atw-pill off" id="vibPill" data-i18n="at.log.no_conn">● Not Connected</span>' +
            B('', 'window.AnalyzeToolsPanel._togVib()', '', '▶ Start Monitoring', 'vibTogBtn', 'at.vib.start') +
            B('', 'window.AnalyzeToolsPanel._rstVib()', '', 'Reset', '', 'at.vib.reset') +
            '<div class="atw-sp"></div><span class="atw-muted" data-i18n="at.vib.updates">Updates every 1 s</span>' +
            '</div>' +
            '<div class="atw-vib-body">' +
            '<div class="atw-vib-grid">' +
            icard('IMU 0', 'vib0') +
            icard('IMU 1', 'vib1') +
            '<div class="atw-vib-card"><div class="atw-vib-ct" data-i18n="at.vib.clip">Clipping</div>' +
            '<div class="atw-clip-g">' +
            ['Acc0', 'Acc1', 'Acc2'].map(function (l) {
                return '<div class="atw-clip-r"><span class="atw-clip-l">' + l + '</span>' +
                    '<span class="atw-clip-v g" id="clip_' + l.toLowerCase() + '">0</span></div>';
            }).join('') +
            '</div><div class="atw-clip-n" data-i18n="at.vib.clip_hi">Values above 0 indicate sensor saturation</div></div>' +
            '</div>' +
            '<div><div class="atw-vib-rt" data-i18n="at.vib.raw">Raw Vibration Values</div>' +
            '<table class="atw-tbl"><thead><tr><th data-i18n="at.vib.imu">IMU</th><th data-i18n="at.vib.vib_x">Vibe X (m/s²)</th><th data-i18n="at.vib.vib_y">Vibe Y (m/s²)</th><th data-i18n="at.vib.vib_z">Vibe Z (m/s²)</th><th data-i18n="at.vib.status">Status</th></tr></thead>' +
            '<tbody>' +
            '<tr><td>IMU 0</td><td id="rv0x">—</td><td id="rv0y">—</td><td id="rv0z">—</td><td><span class="atw-pill" id="rvs0">—</span></td></tr>' +
            '<tr><td>IMU 1</td><td id="rv1x">—</td><td id="rv1y">—</td><td id="rv1z">—</td><td><span class="atw-pill" id="rvs1">—</span></td></tr>' +
            '</tbody></table>' +
            '</div>' +
            '</div>';
    }

    /* ══════════════════════════════════════════════════════
       STATE
    ══════════════════════════════════════════════════════ */
    // ── Inspector live state ─────────────────────────────────────────────────
    var _inspOn = false;
    var _inspPaused = true;  // start paused — user must click ▶ Start
    var _inspData = {};   // msgid → { id, name, rate, count, fields }
    var _inspSelected = null; // currently selected message name
    var _inspFilter = '';
    var _vibOn = false, _vibT = null;
    var _cmds = [], _cidx = -1;
    var _conInit = false;
    var _currentlyOpen = null;

    /** Called by the WS listener with the parsed mavlink_inspector packet.
     *  Runs unconditionally — the tbody guard below means it only renders
     *  when the Inspector window is actually open. */
    function _applyInspData(packet) {
        var msgs = packet.messages || [];

        msgs.forEach(function (m) {
            var prev = _inspData[m.name];
            _inspData[m.name] = m;
            var tbody = document.getElementById('inspTbody');
            if (!tbody) return;

            var rowId = 'irow_' + m.name.replace(/[^a-zA-Z0-9]/g, '_');
            var cntId = 'icnt_' + m.name.replace(/[^a-zA-Z0-9]/g, '_');
            var fillId = 'irf_' + m.name.replace(/[^a-zA-Z0-9]/g, '_');
            var txtId = 'irt_' + m.name.replace(/[^a-zA-Z0-9]/g, '_');

            var rateHz = m.rate || 0;
            var ratePct = Math.min(100, (rateHz / 20) * 100);
            var rateCol = rateHz > 8 ? '#4caf50' : rateHz > 2 ? '#ff9800' : '#29b6f6';
            var dotCls = rateHz > 0 ? (rateHz > 8 ? 'g' : rateHz > 2 ? 'y' : 'b') : 'off';
            var rateStr = rateHz > 0 ? rateHz.toFixed(1) + ' Hz' : 'event';

            // Build or update row
            var existing = document.getElementById(rowId);
            if (!existing) {
                // Only add if passes filter
                if (_inspFilter && m.name.toLowerCase().indexOf(_inspFilter.toLowerCase()) === -1) return;

                var tr = document.createElement('tr');
                tr.className = 'atw-irow';
                tr.id = rowId;
                (function (name) { tr.addEventListener('click', function () { window.AnalyzeToolsPanel._inspMsg(name); }); })(m.name);
                tr.innerHTML =
                    '<td><span class="atw-dot ' + dotCls + '" id="idot_' + rowId + '"></span></td>' +
                    '<td class="atw-mn">' + m.name + '</td>' +
                    '<td><div class="insp-rate-cell">' +
                    '<div class="insp-rate-bar"><div class="insp-rate-fill" id="' + fillId + '" style="width:' + ratePct + '%;background:' + rateCol + '"></div></div>' +
                    '<span class="insp-rate-txt" id="' + txtId + '" style="color:' + rateCol + '">' + rateStr + '</span>' +
                    '</div></td>' +
                    '<td class="atw-mc" id="' + cntId + '">' + m.count + '</td>' +
                    '<td><button class="atw-actbtn" onclick="event.stopPropagation();window.AnalyzeToolsPanel._inspMsg(\'' + m.name + '\')">Inspect ›</button></td>';

                // Remove the empty-state row on first real data
                var empty = tbody.querySelector('.atw-empty');
                if (empty) empty.remove();
                tbody.appendChild(tr);
            } else {
                // Update cells
                var dot = document.getElementById('idot_' + rowId);
                if (dot) dot.className = 'atw-dot ' + dotCls;
                var fill = document.getElementById(fillId);
                if (fill) { fill.style.width = ratePct + '%'; fill.style.background = rateCol; }
                var txt = document.getElementById(txtId);
                if (txt) { txt.textContent = rateStr; txt.style.color = rateCol; }
                var cnt = document.getElementById(cntId);
                if (cnt) cnt.textContent = m.count;  // always update — no stale-ref guard needed
            }
        });

        // Update count badge
        var badge = document.getElementById('inspMsgCount');
        if (badge) badge.textContent = Object.keys(_inspData).length + ' messages';
        // Note: the pane is refreshed by the dedicated _inspPaneInterval below
    }

    /**
     * Renders the right-hand detail pane for the selected message.
     * Always rebuilds the entire tbody so field values are guaranteed fresh.
     * Only replaces pane.innerHTML when the message changes; otherwise
     * updates individual cells to avoid scroll-position resets.
     */
    function _renderInspPane(name, m, tick) {
        var pane = document.getElementById('inspPane');
        if (!pane || !m) return;

        var rateHz = m.rate || 0;
        var rateStr = rateHz > 0 ? rateHz.toFixed(2) + ' Hz' : 'event';
        var dotCls = rateHz > 0 ? (rateHz > 8 ? 'g' : rateHz > 2 ? 'y' : 'b') : 'off';
        var fields = m.fields || {};
        var fieldKeys = Object.keys(fields);

        // Rebuild if message changed OR if the DOM structure was wiped (e.g. by _clrInsp)
        var needRebuild = (pane.dataset.inspMsg !== name) || !document.getElementById('ipd_tbody');

        if (needRebuild) {
            pane.dataset.inspMsg = name;
            pane.innerHTML =
                '<div class="atw-insp-d">' +
                '<div class="atw-insp-dt"><span class="atw-dot ' + dotCls + '" id="ipd_dot"></span>' + name + '</div>' +
                '<div class="atw-insp-dmeta" id="ipd_meta"></div>' +
                '<table class="atw-tbl"><thead><tr><th>Field</th><th>Value</th></tr></thead>' +
                '<tbody id="ipd_tbody"></tbody></table>' +
                '</div>';
        }

        // Always update meta line — tick # proves the loop is alive
        var meta = document.getElementById('ipd_meta');
        var dot = document.getElementById('ipd_dot');
        if (meta) meta.textContent = 'ID: ' + m.id + '  |  Rate: ' + rateStr + '  |  Count: ' + m.count + (tick ? '  |  #' + tick : '');
        if (dot) dot.className = 'atw-dot ' + dotCls;

        // Always rebuild tbody rows — ensures values are ALWAYS current
        var tbody = document.getElementById('ipd_tbody');
        if (!tbody) return;
        var scrollTop = pane.scrollTop;
        tbody.innerHTML = fieldKeys.map(function (k) {
            return '<tr><td class="atw-fn">' + k + '</td>' +
                '<td class="atw-fv">' + (fields[k] !== undefined ? fields[k] : '') + '</td></tr>';
        }).join('');
        pane.scrollTop = scrollTop;  // restore scroll position
    }

    // Dedicated pane refresh: runs every 300 ms independent of _applyInspData
    var _inspTickCount = 0;
    setInterval(function () {
        try {
            if (!_inspPaused && _inspSelected && _inspData[_inspSelected]) {
                _inspTickCount++;
                _renderInspPane(_inspSelected, _inspData[_inspSelected], _inspTickCount);
            }
        } catch (e) {
            console.error('[Inspector pane refresh error]', e);
        }
    }, 300);

    // Inspector data is routed via websocket.js → handleBackendMessage → _onInspectorData
    // No separate WS listener needed here.

    /* ══════════════════════════════════════════════════════
       PUBLIC API
    ══════════════════════════════════════════════════════ */
    var API = {

        isOpen: function () { return _currentlyOpen !== null; },

        /** Called by websocket.js every 250 ms with fresh inspector data.
         *  Always caches data into _inspData (for Vibration panel etc.).
         *  Only renders the inspector table when NOT paused. */
        _onInspectorData: function (messages) {
            // Always store the latest data so Vibration panel can read it
            if (messages && messages.length) {
                messages.forEach(function (m) { _inspData[m.name] = m; });
            }
            if (_inspPaused) return;   // UI frozen — skip rendering
            _inspOn = true;
            _applyInspData({ messages: messages });
        },

        showAnalyzePanel: function () {
            buildWindows();
            var p = document.getElementById('analyzePanel');
            if (p) {
                p.classList.add('ap-on');
                p.style.setProperty('display', 'flex', 'important');
            }
        },

        hideAnalyzePanel: function () {
            var p = document.getElementById('analyzePanel');
            if (p) {
                p.classList.remove('ap-on');
                p.style.setProperty('display', 'none', 'important');
            }
        },

        openTool: function (id) {
            id = id || 'log-download';
            buildWindows();
            _currentlyOpen = id;

            this.hideAnalyzePanel();

            ['flightControlsStrip', 'dropdownMenuStrip', 'planFlightMenuStrip',
                'commandEditorPanel', 'compassContainer', 'weatherDashboard', 'videoContainer'
            ].forEach(function (eid) {
                var e = document.getElementById(eid);
                if (e) e.style.setProperty('display', 'none', 'important');
            });
            var map = document.getElementById('map');
            if (map) map.style.setProperty('display', 'none', 'important');

            TOOLS.forEach(function (t) {
                var w = document.getElementById('atw-' + t.id);
                if (!w) return;
                if (t.id === id) w.classList.add('atw-on');
                else w.classList.remove('atw-on');
            });

            if (id === 'mavlink-console' && !_conInit) {
                _conInit = true;
                setTimeout(function () {
                    var inp = document.getElementById('mavIn');
                    if (!inp) return;
                    inp.addEventListener('keydown', function (e) {
                        if (e.key === 'ArrowUp') { if (_cidx < _cmds.length - 1) _cidx++; inp.value = _cmds[_cidx] || ''; e.preventDefault(); }
                        if (e.key === 'ArrowDown') { if (_cidx > 0) _cidx--; inp.value = _cmds[_cidx] || ''; e.preventDefault(); }
                    });
                }, 100);
            }
        },

        open: function (id) { this.openTool(id); },

        closeAll: function () {
            if (_inspOn) { _inspOn = false; _inspPaused = true; }
            if (_vibOn) { clearInterval(_vibT); _vibOn = false; }
            _currentlyOpen = null;
            this.hideAnalyzePanel();
            TOOLS.forEach(function (t) {
                var w = document.getElementById('atw-' + t.id);
                if (w) w.classList.remove('atw-on');
            });
            ['flightControlsStrip', 'compassContainer', 'videoContainer'].forEach(function (eid) {
                var e = document.getElementById(eid);
                if (e) e.style.removeProperty('display');
            });
            var map = document.getElementById('map');
            if (map) map.style.removeProperty('display');
        },

        goBack: function () {
            if (_inspOn) { _inspOn = false; _inspPaused = true; }
            if (_vibOn) { clearInterval(_vibT); _vibOn = false; }
            _currentlyOpen = null;

            TOOLS.forEach(function (t) {
                var w = document.getElementById('atw-' + t.id);
                if (w) w.classList.remove('atw-on');
            });

            var map = document.getElementById('map');
            if (map) map.style.removeProperty('display');
            ['compassContainer', 'videoContainer'].forEach(function (eid) {
                var e = document.getElementById(eid);
                if (e) e.style.removeProperty('display');
            });

            ['flightControlsStrip', 'dropdownMenuStrip'].forEach(function (eid) {
                var e = document.getElementById(eid);
                if (e) e.style.setProperty('display', 'none', 'important');
            });

            this.showAnalyzePanel();
        },

        /* ─── LOG DOWNLOAD ─── */

        _refreshLogs: function () {
            var body = document.getElementById('logTbody');
            var pill = document.getElementById('logConnPill');
            var cnt = document.getElementById('logCntLbl');
            if (!body) return;

            // Ensure WS listener is attached
            _attachWsListener();

            if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
                if (pill) { pill.innerHTML = '<span data-i18n="at.dyn.no_conn">' + (window.i18n ? window.i18n.t('at.dyn.no_conn') : '● No Connection') + '</span>'; pill.className = 'atw-pill red'; }
                body.innerHTML =
                    '<tr class="atw-empty"><td colspan="6">' +
                    '<div class="atw-empty-box">' +
                    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" stroke="currentColor" stroke-width="1.5"/></svg>' +
                    '<span>Backend not connected</span>' +
                    '<span style="font-size:10px;color:#1c2030">Start TihanFly backend and connect to vehicle</span>' +
                    '</div></td></tr>';
                if (cnt) cnt.textContent = '0 logs found';
                return;
            }

            // Reset state
            _logList = [];
            _logScanActive = true;
            clearTimeout(_logScanTimer);

            if (pill) { pill.innerHTML = '<span data-i18n="at.dyn.scan">' + (window.i18n ? window.i18n.t('at.dyn.scan') : '● Scanning…') + '</span>'; pill.className = 'atw-pill yellow'; }
            body.innerHTML =
                '<tr class="atw-empty"><td colspan="6">' +
                '<div class="atw-empty-box">' +
                '<svg viewBox="0 0 24 24" fill="none" style="animation:spin 1s linear infinite">' +
                '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>' +
                '<path d="M21 12a9 9 0 11-6.22-8.56" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>' +
                '<span>Requesting logs from drone…</span>' +
                '</div></td></tr>';
            if (cnt) cnt.textContent = 'Scanning…';

            _wsSend({ type: 'list_logs' });
            console.log('[LogBrowser] Sent list_logs request');

            if (window.MsgConsole) window.MsgConsole.info('📋 Requesting log list from drone…');

            // Fallback timeout — render whatever arrived after 6 s
            _logScanTimer = setTimeout(function () {
                if (_logScanActive) {
                    console.log('[LogBrowser] Scan timeout — rendering ' + _logList.length + ' entries');
                    _finaliseLogList();
                }
            }, 6000);
        },

        _processDlQueue: function () {
            if (_dlQueue.length === 0) {
                _isDownloading = false;
                if (window.MsgConsole) window.MsgConsole.success('✅ All selected logs downloaded');
                return;
            }
            _isDownloading = true;
            var nextLog = _dlQueue.shift();
            API._dlLog(nextLog.id, nextLog.size);
        },

        _dlLog: function (logId, logSize) {
            var btn = document.getElementById('dlbtn_' + logId);
            var prog = document.getElementById('logprog_' + logId);
            var fill = document.getElementById('logfill_' + logId);
            var lbl = document.getElementById('loglbl_' + logId);

            if (!_wsSend({ type: 'download_log', log_id: logId, log_size: logSize || 0 })) {
                if (window.MsgConsole) window.MsgConsole.info('⚠ WebSocket not connected');
                return;
            }

            if (btn) { btn.textContent = '⏳ 0%'; btn.disabled = true; }
            if (prog) prog.classList.add('active');
            if (fill) fill.style.width = '0%';
            if (lbl) lbl.textContent = '0%';

            var gWrap = document.getElementById('logProgWrap');
            var gFill = document.getElementById('logProgFill');
            var gLbl = document.getElementById('logProgLbl');
            if (gWrap) gWrap.style.display = 'flex';
            if (gFill) gFill.style.width = '0%';
            if (gLbl) gLbl.textContent = '0%';

            console.log('[LogBrowser] Download requested: log_id=' + logId + ' size=' + logSize);
            if (window.MsgConsole) window.MsgConsole.info('⬇ Downloading log #' + logId + '…');
        },

        _downloadSel: function () {
            var checked = document.querySelectorAll('.lchk:checked');
            if (!checked.length) { alert('Select at least one log first.'); return; }
            _dlQueue = [];
            checked.forEach(function (cb) {
                var lid = parseInt(cb.dataset.lid);
                var log = _logList.find(function (l) { return l.id === lid; });
                _dlQueue.push({ id: lid, size: log ? log.size : 0 });
            });
            if (!_isDownloading) {
                if (window.MsgConsole) window.MsgConsole.info('📥 Starting sequential download of ' + _dlQueue.length + ' logs...');
                API._processDlQueue();
            }
        },

        _deleteLogs: function () {
            if (!confirm('Delete ALL logs from vehicle?')) return;
            if (!_wsSend({ type: 'erase_logs' })) {
                if (window.MsgConsole) window.MsgConsole.info('⚠ WebSocket not connected');
                return;
            }
            if (window.MsgConsole) window.MsgConsole.info('🗑 Erasing logs from vehicle...');
            var b = document.getElementById('logTbody');
            if (b) b.innerHTML =
                '<tr class="atw-empty"><td colspan="6">' +
                '<div class="atw-empty-box"><span>Logs erased from vehicle.</span></div></td></tr>';
            var c = document.getElementById('logCntLbl');
            if (c) c.textContent = '0 logs found';
            _logList = [];
            setTimeout(function () { API._refreshLogs(); }, 1500);
        },

        _selAll: function (cb) {
            document.querySelectorAll('.lchk').forEach(function (c) { c.checked = cb.checked; });
        },

        /* ─── GEOTAG ─── */
        _browseImgs: function () { var e = document.getElementById('geoImgDir'); if (e) e.value = '/home/user/flight_images'; },
        _browseLog: function () { var e = document.getElementById('geoLogFile'); if (e) e.value = '/home/user/logs/flight_001.tlog'; },
        _runGeo: function () {
            var out = document.getElementById('geoLogOut');
            var tot = document.getElementById('geoTotal');
            var tgd = document.getElementById('geoTagged');
            var skp = document.getElementById('geoSkipped');
            if (!out) return;
            out.innerHTML = '<span class="atw-ll y">⟳ Scanning images…</span>';
            var lines = ['✔ Found 48 images', '✔ Loaded log: 2847 GPS records', '✔ 001.jpg → 17.3852°N, 78.4867°E', '✔ 002.jpg → 17.3854°N, 78.4869°E', '⚠ Skipped 004.jpg — no matching timestamp', '✔ 005.jpg → 17.3858°N, 78.4873°E', '─────────────────────────────', '✔ Done: 46 tagged, 2 skipped'];
            var i = 0;
            var t = setInterval(function () {
                if (i >= lines.length) {
                    clearInterval(t);
                    if (tot) tot.textContent = '48';
                    if (tgd) tgd.textContent = '46';
                    if (skp) skp.textContent = '2';
                    return;
                }
                var cls = lines[i].startsWith('⚠') ? 'y' : lines[i].startsWith('─') ? 'm' : 'g';
                out.innerHTML += '<span class="atw-ll ' + cls + '">' + lines[i] + '</span>';
                out.scrollTop = out.scrollHeight;
                i++;
            }, 280);
        },

        /* ─── CONSOLE ─── */
        _sendCmd: function () {
            var inp = document.getElementById('mavIn');
            var term = document.getElementById('mavTerm');
            if (!inp || !term) return;
            var cmd = inp.value.trim();
            if (!cmd) return;
            _cmds.unshift(cmd); _cidx = -1;
            term.innerHTML += '<div class="atw-tl c">nsh&gt; ' + cmd + '</div>';
            inp.value = '';
            var resp = _fakeResp(cmd);
            setTimeout(function () {
                resp.split('\n').forEach(function (l) {
                    term.innerHTML += '<div class="atw-tl">' + l + '</div>';
                });
                term.scrollTop = term.scrollHeight;
            }, 180);
        },
        _qcmd: function (cmd) { var i = document.getElementById('mavIn'); if (i) i.value = cmd; this._sendCmd(); },
        _clrCon: function () { var t = document.getElementById('mavTerm'); if (t) t.innerHTML = '<div class="atw-tl m">Console cleared.</div>'; },

        /* ─── INSPECTOR ─── */
        _togInsp: function () {
            var btn = document.getElementById('inspTogBtn');
            var pill = document.getElementById('inspPill');
            if (_inspPaused) {
                // Paused / not started → start live
                _inspPaused = false;
                _inspOn = true;
                if (btn) btn.innerHTML = '<span>\u25a0 Stop</span>';
                if (pill) { pill.innerHTML = '\u25cf Live'; pill.className = 'atw-pill green'; }
            } else {
                // Currently live → pause
                _inspPaused = true;
                _inspOn = false;
                if (btn) btn.innerHTML = '<span>\u25b6 Start</span>';
                if (pill) { pill.innerHTML = '\u25cf Paused'; pill.className = 'atw-pill off'; }
            }
        },


        _clrInsp: function () {
            _inspData = {};
            _inspSelected = null;
            _inspFilter = '';
            var srch = document.getElementById('inspSearch');
            if (srch) srch.value = '';
            var tbody = document.getElementById('inspTbody');
            if (tbody) tbody.innerHTML =
                '<tr class="atw-empty"><td colspan="5">' +
                '<div class="atw-empty-box">' +
                '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
                '<span>Press ▶ Start to begin inspection</span>' +
                '</div></td></tr>';
            var pane = document.getElementById('inspPane');
            if (pane) {
                pane.innerHTML =
                    '<div class="atw-insp-ph">' +
                    '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
                    '<span>Select a message to inspect</span></div>';
                delete pane.dataset.inspMsg;  // ← reset so next _renderInspPane does a full rebuild
            }
            var badge = document.getElementById('inspMsgCount');
            if (badge) badge.textContent = '0 messages';
        },

        _inspMsg: function (name) {
            _inspSelected = name;
            // Highlight selected row
            document.querySelectorAll('.atw-irow').forEach(function (r) { r.classList.remove('insp-selected'); });
            var rowId = 'irow_' + name.replace(/[^a-zA-Z0-9]/g, '_');
            var row = document.getElementById(rowId);
            if (row) row.classList.add('insp-selected');
            // Render pane from latest data
            var m = _inspData[name];
            if (m) {
                _renderInspPane(name, m);
            } else {
                var pane = document.getElementById('inspPane');
                if (pane) pane.innerHTML =
                    '<div class="atw-insp-d">' +
                    '<div class="atw-insp-dt"><span class="atw-dot off"></span>' + name + '</div>' +
                    '<div class="atw-insp-dmeta" style="color:#2e3450">Waiting for data…</div>' +
                    '</div>';
            }
        },

        _filterInsp: function (val) {
            _inspFilter = val;
            var tbody = document.getElementById('inspTbody');
            if (!tbody) return;
            tbody.querySelectorAll('.atw-irow').forEach(function (tr) {
                var nameCell = tr.querySelector('.atw-mn');
                if (!nameCell) return;
                var name = nameCell.textContent || '';
                tr.style.display = (!val || name.toLowerCase().indexOf(val.toLowerCase()) !== -1) ? '' : 'none';
            });
        },

        /* ─── VIBRATION ─── */
        _togVib: function () {
            var btn = document.getElementById('vibTogBtn');
            var pill = document.getElementById('vibPill');
            if (_vibOn) {
                clearInterval(_vibT); _vibOn = false;
                if (btn) btn.innerHTML = '<span data-i18n="at.dyn.start_mon">' + (window.i18n ? window.i18n.t('at.dyn.start_mon') : '▶ Start Monitoring') + '</span>';
                if (pill) { pill.innerHTML = '<span data-i18n="at.dyn.disconnect">' + (window.i18n ? window.i18n.t('at.dyn.disconnect') : '● Not Connected') + '</span>'; pill.className = 'atw-pill off'; }
            } else {
                _vibOn = true;
                if (btn) btn.innerHTML = '<span data-i18n="at.dyn.stop_mon">' + (window.i18n ? window.i18n.t('at.dyn.stop_mon') : '■ Stop Monitoring') + '</span>';
                if (pill) { pill.innerHTML = '<span data-i18n="at.dyn.mon">' + (window.i18n ? window.i18n.t('at.dyn.mon') : '● Monitoring') + '</span>'; pill.className = 'atw-pill green'; }
                _vibT = setInterval(_updateVib, 800);
            }
        },
        _rstVib: function () {
            ['vib0x', 'vib0y', 'vib0z', 'vib1x', 'vib1y', 'vib1z'].forEach(function (id) {
                var b = document.getElementById(id);
                var v = document.getElementById(id + '_v');
                if (b) b.style.width = '0%';
                if (v) v.textContent = '0.0';
            });
        }
    };

    function _updateVib() {
        // Pull live VIBRATION data from the inspector cache (populated by _onInspectorData)
        var vd = _inspData['VIBRATION'];
        var f = (vd && vd.fields) ? vd.fields : null;

        // IMU axes: use real values if available, else show zero
        var axes = [
            ['vib0x', 'rv0x', f ? (parseFloat(f.vibration_x) || 0) : 0],
            ['vib0y', 'rv0y', f ? (parseFloat(f.vibration_y) || 0) : 0],
            ['vib0z', 'rv0z', f ? (parseFloat(f.vibration_z) || 0) : 0],
            // ArduPilot only has one VIBRATION msg; mirror for IMU1 display
            ['vib1x', 'rv1x', f ? (parseFloat(f.vibration_x) || 0) : 0],
            ['vib1y', 'rv1y', f ? (parseFloat(f.vibration_y) || 0) : 0],
            ['vib1z', 'rv1z', f ? (parseFloat(f.vibration_z) || 0) : 0]
        ];

        axes.forEach(function (a) {
            var val = Math.abs(a[2]);
            var pct = Math.min(100, (val / 30) * 100);
            var col = pct > 66 ? '#f44336' : pct > 33 ? '#ff9800' : '#4caf50';
            var bar = document.getElementById(a[0]);
            var vEl = document.getElementById(a[0] + '_v');
            var raw = document.getElementById(a[1]);
            if (bar) { bar.style.width = pct + '%'; bar.style.background = col; }
            if (vEl) { vEl.textContent = val.toFixed(2); vEl.style.color = col; }
            if (raw) raw.textContent = val.toFixed(2);
        });

        // Clipping counters
        ['acc0', 'acc1', 'acc2'].forEach(function (k, i) {
            var el = document.getElementById('clip_' + k);
            if (!el) return;
            var v = f ? (parseInt(f['clipping_' + i]) || 0) : 0;
            el.textContent = v;
            el.className = 'atw-clip-v ' + (v > 0 ? 'r' : 'g');
        });

        // Update pill on vibration panel
        var pill = document.getElementById('vibPill');
        if (pill) {
            if (f) { pill.innerHTML = '\u25cf Live'; pill.className = 'atw-pill green'; }
            else { pill.innerHTML = '\u25cf No Data'; pill.className = 'atw-pill yellow'; }
        }

        // Status pills in raw table
        [0, 1].forEach(function (i) {
            var s = document.getElementById('rvs' + i);
            var xEl = document.getElementById('rv' + i + 'x');
            if (!s || !xEl) return;
            var x = parseFloat(xEl.textContent);
            if (isNaN(x)) return;
            if (x < 10) { s.textContent = 'Good'; s.className = 'atw-pill green'; }
            else if (x < 20) { s.textContent = 'Warning'; s.className = 'atw-pill yellow'; }
            else { s.textContent = 'High'; s.className = 'atw-pill red'; }
        });
    }

    function _fakeResp(cmd) {
        var r = {
            'top': 'Processes: 42 total\nCPU: 23.4%\nMem: 18.2 MB / 256 MB\n\nPID  NAME         CPU\n  1  init         0.0\n  2  rover        8.4\n  3  navigator    5.1',
            'free': 'Mem:  Total: 256M  Used: 47M  Free: 209M',
            'ver all': 'FW git-hash: abc1234\nFW version: 1.13.3\nOS: NuttX 10.1.0\nHW: Pixhawk 4',
            'dmesg': '[0.000] NuttX initialized\n[0.120] MAVLink started\n[0.650] GPS lock acquired\n[1.200] Ready to fly',
            'sensors status': 'Sensor   Status   Rate\nIMU0     OK       400 Hz\nIMU1     OK       400 Hz\nGPS0     OK         5 Hz'
        };
        return r[cmd] || ('Command \'' + cmd + '\' executed\nResult: OK');
    }

    function _mavFields(msg) {
        var db = {
            'HEARTBEAT': [{ n: 'type', v: '2 (QUADROTOR)', u: 'enum' }, { n: 'autopilot', v: '3 (APM)', u: 'enum' }, { n: 'base_mode', v: '81', u: 'bitmask' }, { n: 'system_status', v: '4 (ACTIVE)', u: 'enum' }],
            'ATTITUDE': [{ n: 'time_boot_ms', v: (Date.now() % 100000) + '', u: 'ms' }, { n: 'roll', v: (Math.random() * .1).toFixed(4), u: 'rad' }, { n: 'pitch', v: (Math.random() * .1).toFixed(4), u: 'rad' }, { n: 'yaw', v: (Math.random() * 6.28).toFixed(4), u: 'rad' }],
            'GPS_RAW_INT': [{ n: 'fix_type', v: '3 (3D FIX)', u: 'enum' }, { n: 'lat', v: '173852000', u: 'degE7' }, { n: 'lon', v: '784867000', u: 'degE7' }, { n: 'alt', v: '531000', u: 'mm' }, { n: 'satellites_visible', v: '14', u: '' }],
            'BATTERY_STATUS': [{ n: 'voltage', v: '16.72', u: 'V' }, { n: 'current', v: '8.3', u: 'A' }, { n: 'consumed', v: '1240', u: 'mAh' }, { n: 'remaining', v: '72', u: '%' }]
        };
        return db[msg] || [{ n: 'time_boot_ms', v: (Date.now() % 100000) + '', u: 'ms' }, { n: 'value_1', v: (Math.random() * 100).toFixed(2), u: '' }];
    }

    /* ── boot ── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildWindows);
    } else {
        buildWindows();
    }

    window.AnalyzeToolsPanel = API;
    console.log('✅ analyze-tools.js loaded — log download uses real WebSocket');

})();