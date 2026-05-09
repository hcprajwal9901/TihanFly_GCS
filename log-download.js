/**
 * log-download.js  —  TiHANFly GCS
 * Standalone module for downloading DataFlash logs.
 */

(function () {
    'use strict';

    var CSS = `
#ldWindow {
    position: fixed !important; top: 60px !important; bottom: 0 !important; left: 0 !important; right: 0 !important;
    z-index: 99999990 !important; display: none;
    flex-direction: column; background: #1e1e1e;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #d0d0d0; overflow: hidden;
}
#ldWindow.ld-on { display: flex !important; }

#ldBar {
    display: flex; align-items: center; gap: 8px;
    height: 38px; padding: 0 10px;
    background: #2d2d2d; border-bottom: 2px solid #111; flex-shrink: 0;
}
#ldBackBtn {
    display: flex; align-items: center; gap: 5px;
    background: #3a3a3a; border: 1px solid #555;
    color: #aaa; font-size: 11px; font-weight: 600;
    cursor: pointer; padding: 4px 10px; border-radius: 3px;
    font-family: inherit; transition: background .15s;
}
#ldBackBtn:hover { background: #4a4a4a; color:#fff; }
#ldBarTitle { font-size:12px; font-weight:700; color:#c8c8c8; letter-spacing:0.3px; display:flex; align-items:center; gap:6px; }

.ld-pill {
    padding: 2px 8px; border-radius: 3px;
    font-size:10px; font-weight:700; font-family: inherit;
    margin-left: auto;
}
.ld-pill.off    { background:#333; color:#666; border:1px solid #444; }
.ld-pill.green  { background:#1a3a1a; color:#5cbf5c; border:1px solid #3a6a3a; }
.ld-pill.yellow { background:#3a2e00; color:#ffc107; border:1px solid #6a5500; }

.ld-btn {
    display: flex; align-items: center; gap: 5px;
    background: #2a2a2a; border: 1px solid #444;
    color: #ccc; font-size:11px; font-weight:600;
    cursor:pointer; padding:4px 12px; border-radius:3px; font-family: inherit;
    transition: all .15s;
}
.ld-btn.primary { background: #1e3a5a; border-color: #2a4a6a; color: #5eb8d8; }
.ld-btn.primary:hover { background: #254565; color: #fff; }
.ld-btn.danger { background: #3a2020; border-color: #5a2a2a; color: #d07070; margin-left: 10px; }
.ld-btn.danger:hover { background: #5a2020; color: #ff8080; }
.ld-btn:hover { background: #3a3a3a; border-color: #666; color: #fff; }

#ldBody {
    flex: 1; display: flex; flex-direction: column; overflow: hidden;
    padding: 15px; background: #181818;
}

.ld-table-wrap {
    flex: 1; overflow-y: auto; background: #202020; 
    border: 1px solid #333; border-radius: 4px;
}
table.ld-table { width: 100%; border-collapse: collapse; text-align: left; }
table.ld-table th { 
    position: sticky; top: 0; background: #2a2a2a; 
    padding: 8px 10px; font-size: 11px; color: #888;
    text-transform: uppercase; border-bottom: 2px solid #1a1a1a;
    z-index: 10;
}
table.ld-table td { 
    padding: 8px 10px; font-size: 12px; color: #ccc;
    border-bottom: 1px solid #2a2a2a;
}
table.ld-table tbody tr:hover { background: #282828; }
table.ld-table tbody tr.ld-empty td { text-align: center; padding: 40px; color: #666; }

.ld-progress-bar-wrap {
    width: 80px; height: 6px; background: #333; border-radius: 3px; overflow: hidden;
    display: inline-block; vertical-align: middle; margin-right: 6px; display: none;
}
.ld-progress-bar-wrap.active { display: inline-block; }
.ld-progress-fill { height: 100%; width: 0%; background: #5eb8d8; transition: width 0.1s linear; }

#ldFooter {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 0 0 0; flex-shrink: 0;
}
#ldFooterStats { font-size: 11px; color: #888; }
.ld-global-prog {
    display: none; align-items: center; gap: 8px; font-size: 11px; color: #5eb8d8; font-weight: 600;
}
.ld-global-prog-bar { width: 150px; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
.ld-global-prog-fill { height: 100%; width: 0%; background: #5eb8d8; transition: width 0.1s linear; }
`;

    var _built = false;
    var _logList = [];
    var _dlQueue = [];
    var _isDownloading = false;
    var _logScanActive = false;
    var _logScanTimer = null;

    function _injectCSS() {
        if (document.getElementById('ld-css')) return;
        var s = document.createElement('style');
        s.id = 'ld-css'; s.textContent = CSS;
        document.head.appendChild(s);
    }

        function _build() {
        if (_built) return;
        _built = true;
        _injectCSS();

        var win = document.createElement('div');
        win.id = 'ldWindow';
        win.innerHTML = `
<div id="ldBar">
    <button id="ldBackBtn">
        <svg viewBox="0 0 24 24" fill="none" style="width:14px;height:14px"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span data-i18n="at.back">Back</span>
    </button>
    <div id="ldBarTitle">
        <svg viewBox="0 0 24 24" fill="none" style="stroke:#29b6f6;width:16px;height:16px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke-width="1.5"/><path d="M12 12v6m0 0l-3-3m3 3l3-3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        LOG DOWNLOAD
    </div>
    
    <button class="ld-btn primary" id="ldBtnDownload" style="margin-left:20px;">
        <svg viewBox="0 0 24 24" fill="none" style="width:14px;height:14px"><path d="M12 15V3M12 15L8 11M12 15L16 11M3 21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Download Selected
    </button>
    <button class="ld-btn" id="ldBtnRefresh">
        <svg viewBox="0 0 24 24" fill="none" style="width:14px;height:14px"><path d="M1 4V10H7M3.51 15a9 9 0 1 0 .49-4.05" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh
    </button>
    <button class="ld-btn danger" id="ldBtnErase">
        <svg viewBox="0 0 24 24" fill="none" style="width:14px;height:14px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Delete All
    </button>

    <span class="ld-pill off" id="ldConnPill">● Not Connected</span>
</div>
<div id="ldBody">
    <div class="ld-table-wrap">
        <table class="ld-table">
            <thead>
                <tr>
                    <th style="width:40px; text-align:center;"><input type="checkbox" id="ldSelAll"></th>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Size</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody id="ldTbody">
                <tr class="ld-empty"><td colspan="6">Connect to vehicle to load logs</td></tr>
            </tbody>
        </table>
    </div>
    <div id="ldFooter">
        <div id="ldFooterStats">0 logs found</div>
        <div class="ld-global-prog" id="ldGlobalProg">
            <span id="ldGlobalLbl">Downloading...</span>
            <div class="ld-global-prog-bar"><div class="ld-global-prog-fill" id="ldGlobalFill"></div></div>
        </div>
    </div>
</div>
`;
        document.body.appendChild(win);

        document.getElementById('ldBackBtn').addEventListener('click', API.close);
        document.getElementById('ldBtnRefresh').addEventListener('click', _refreshLogs);
        document.getElementById('ldBtnDownload').addEventListener('click', _downloadSel);
        document.getElementById('ldBtnErase').addEventListener('click', _deleteLogs);
        document.getElementById('ldSelAll').addEventListener('change', function(e) {
            document.querySelectorAll('.ld-chk').forEach(c => c.checked = e.target.checked);
        });

        _attachWsListener();
        
        // Translate texts dynamically if translation module is available
        if (window.i18n && window.i18n.setLang) {
            window.i18n.setLang(window.i18n.getLang ? window.i18n.getLang() : (localStorage.getItem('tihan_lang') || 'en'));
        }
    }

    /* ─── WEBSOCKET INTERACTION ─── */
    function _wsSend(obj) {
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    function _attachWsListener() {
        if (!window.ws) return;
        if (window.ws._ld_listener) return;
        window.ws._ld_listener = true;

        window.ws.addEventListener('message', function (e) {
            try {
                var data = JSON.parse(e.data);
                if (data.type === 'log_entry') _onLogEntry(data);
                else if (data.type === 'log_download_progress') _onLogProgress(data);
                else if (data.type === 'log_download_done') API._onLogDone(data);
            } catch (err) {}
        });
    }

    // Re-attach whenever window.ws changes (e.g. after reconnect)
    setInterval(function () {
        if (window.ws && !window.ws._ld_listener) _attachWsListener();
    }, 800);


    function _onLogEntry(data) {
        if (_logScanActive) {
            _logScanActive = false;
            clearTimeout(_logScanTimer);
        }
        _logList.push({ id: data.id, size: data.size, time_utc: data.time_utc, num_logs: data.num_logs });
        _finaliseLogList();
    }

    function _finaliseLogList() {
        var body = document.getElementById('ldTbody');
        var pill = document.getElementById('ldConnPill');
        var cnt = document.getElementById('ldFooterStats');
        if (!body) return;

        _logList.sort(function (a, b) { return b.id - a.id; });
        if (pill) { pill.innerHTML = '● READY'; pill.className = 'ld-pill green'; }
        if (cnt) cnt.textContent = _logList.length + ' logs found';

        if (!_logList.length) {
            body.innerHTML = '<tr class="ld-empty"><td colspan="6">No logs found on vehicle.</td></tr>';
            return;
        }

        body.innerHTML = '';
        _logList.forEach(function (log) {
            var tr = document.createElement('tr');
            var kb = (log.size / 1024).toFixed(1);
            var dt = new Date(log.time_utc * 1000);
            var dStr = dt.getFullYear() > 1980 ? dt.toLocaleDateString() : '???';
            var tStr = dt.getFullYear() > 1980 ? dt.toLocaleTimeString() : '???';

            tr.innerHTML = `
                <td style="text-align:center;"><input type="checkbox" class="ld-chk" data-lid="${log.id}"></td>
                <td style="font-family:monospace; color:#5eb8d8;"># ${log.id}</td>
                <td>${dStr}</td>
                <td>${tStr}</td>
                <td style="font-family:monospace">${kb} KB</td>
                <td>
                    <div class="ld-progress-bar-wrap" id="ld-prog-${log.id}"><div class="ld-progress-fill" id="ld-fill-${log.id}"></div></div>
                    <span id="ld-lbl-${log.id}" style="color:#888;">Pending</span>
                </td>
`;
            body.appendChild(tr);
        });
    }

    function _onLogProgress(data) {
        var pct = Math.floor((data.received / data.total) * 100);
        var fill = document.getElementById('ld-fill-' + data.log_id);
        var lbl = document.getElementById('ld-lbl-' + data.log_id);
        if (fill) fill.style.width = pct + '%';
        if (lbl) lbl.textContent = pct + '%';

        var gProg = document.getElementById('ldGlobalProg');
        var gFill = document.getElementById('ldGlobalFill');
        var gLbl = document.getElementById('ldGlobalLbl');
        if (gProg) gProg.style.display = 'flex';
        if (gFill) gFill.style.width = pct + '%';
        if (gLbl) gLbl.textContent = 'Log #' + data.log_id + ' (' + pct + '%)';
    }

    function _refreshLogs() {
        var body = document.getElementById('ldTbody');
        var pill = document.getElementById('ldConnPill');
        var cnt = document.getElementById('ldFooterStats');
        if (!body) return;

        _attachWsListener();

        if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
            if (pill) { pill.innerHTML = '● No Connection'; pill.className = 'ld-pill off'; }
            body.innerHTML = '<tr class="ld-empty"><td colspan="6">Backend not connected</td></tr>';
            if (cnt) cnt.textContent = '0 logs found';
            return;
        }

        _logList = [];
        _logScanActive = true;
        clearTimeout(_logScanTimer);

        if (pill) { pill.innerHTML = '● Scanning…'; pill.className = 'ld-pill yellow'; }
        body.innerHTML = '<tr class="ld-empty"><td colspan="6">Requesting logs from drone…</td></tr>';
        if (cnt) cnt.textContent = 'Scanning…';

        _wsSend({ type: 'list_logs' });

        _logScanTimer = setTimeout(function () {
            if (_logScanActive) {
                _finaliseLogList();
            }
        }, 6000);
    }

    function _downloadSel() {
        var checked = document.querySelectorAll('.ld-chk:checked');
        if (!checked.length) { alert('Select at least one log first.'); return; }
        _dlQueue = [];
        checked.forEach(function (cb) {
            var lid = parseInt(cb.dataset.lid);
            var log = _logList.find(l => l.id === lid);
            _dlQueue.push({ id: lid, size: log ? log.size : 0 });
        });
        if (!_isDownloading) {
            _processDlQueue();
        }
    }

    function _processDlQueue() {
        if (_dlQueue.length === 0) {
            _isDownloading = false;
            var gProg = document.getElementById('ldGlobalProg');
            if (gProg) gProg.style.display = 'none';
            if (window.MsgConsole) window.MsgConsole.success('✅ All selected logs downloaded');
            return;
        }
        _isDownloading = true;
        var nextLog = _dlQueue.shift();
        
        var wrap = document.getElementById('ld-prog-' + nextLog.id);
        var lbl = document.getElementById('ld-lbl-' + nextLog.id);
        var fill = document.getElementById('ld-fill-' + nextLog.id);
        
        if (wrap) wrap.classList.add('active');
        if (fill) fill.style.width = '0%';
        if (lbl) { lbl.textContent = '0%'; lbl.style.color = '#5eb8d8'; }

        _wsSend({ type: 'download_log', log_id: nextLog.id, log_size: nextLog.size });
    }

    function _deleteLogs() {
        if (!confirm('Delete ALL logs from vehicle? This cannot be undone.')) return;
        if (!_wsSend({ type: 'erase_logs' })) {
            if (window.MsgConsole) window.MsgConsole.info('⚠ WebSocket not connected');
            return;
        }
        
        document.getElementById('ldTbody').innerHTML = '<tr class="ld-empty"><td colspan="6">Logs erased from vehicle.</td></tr>';
        document.getElementById('ldFooterStats').textContent = '0 logs found';
        _logList = [];
        setTimeout(_refreshLogs, 1500);
    }

    var API = {
        open: function () {
            _build();
            document.getElementById('ldWindow').classList.add('ld-on');
            _refreshLogs();
        },
        close: function () {
            var win = document.getElementById('ldWindow');
            if (win) win.classList.remove('ld-on');
        },
        _onLogDone: function(data) {
            var id = data.log_id;
            var fill = document.getElementById('ld-fill-' + id);
            var lbl = document.getElementById('ld-lbl-' + id);
            
            if (fill) fill.style.width = '100%';
            if (lbl) { lbl.textContent = 'Saved'; lbl.style.color = '#5cbf5c'; }

            setTimeout(function () {
                var wrap = document.getElementById('ld-prog-' + id);
                if (wrap) wrap.classList.remove('active');
                if (window.LogDownloadPanel && window.LogDownloadPanel._processDlQueue) window.LogDownloadPanel._processDlQueue();
            }, 2000);

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
            } catch (e) {
                console.error('[LogDownload] Decode error:', e);
                if (lbl) { lbl.textContent = 'Error'; lbl.style.color = '#d07070'; }
            }
        },
        _processDlQueue: _processDlQueue
    };

    window.LogDownloadPanel = API;

})();
