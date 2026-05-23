/**
 * comm-link.js
 * TiHANFly GCS — Communication Link Settings Panel
 *
 * WS messages sent (via window.safeSend):
 *   { type: "list_serial_ports" }
 *   { type: "manual_connect", conn_type: "udp|tcp|serial", … }
 *   { type: "manual_disconnect", conn_id: "…" }
 *
 * WS messages received (routed here from websocket.js via CommLink.processMessage):
 *   manual_connect_ack, manual_disconnect_ack
 *
 * Status messages received (via window.addEventListener 'status_update'):
 *   populated by the 'status' case in websocket.js which also calls updatePortStatus
 */

window.CommLink = (function () {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────────────
    let _mode         = 'auto';
    let _connType     = 'udp';
    let _selectedPort = '';
    let _serialPorts  = [];
    let _manualConns  = [];       // connections opened via the Manual form
    let _initialised  = false;
    let _lastStatus   = null;     // last 'status' WS payload

    // ── WS send helper ─────────────────────────────────────────────────────────
    function _ws_send(obj) {
        if (typeof window.safeSend === 'function') {
            window.safeSend(obj);
        } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify(obj));
        } else {
            console.warn('[CommLink] WS not ready:', obj);
        }
    }

    // ── Public message entry point (called by websocket.js handleBackendMessage)
    function processMessage(msg) {
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'manual_connect_ack':    
            case 'connect_vehicle_ack':    _on_connect_ack(msg);    break;
            case 'manual_disconnect_ack': 
            case 'disconnect_vehicle_ack': _on_disconnect_ack(msg); break;
        }
    }

    // ── Listen for 'status' messages via a custom event ───────────────────────
    // websocket.js dispatches 'calibration_ws_message' for every message —
    // we piggyback on that to receive status updates for the connections list.
    window.addEventListener('calibration_ws_message', function (evt) {
        const msg = evt.detail;
        if (!msg) return;
        if (msg.type === 'status') {
            _lastStatus = msg;
            _renderConnectionsList();
            _syncStatusDot();
        }
        if (msg.type === 'serial_ports') {
            _serialPorts = msg.ports || [];
            _renderPortList();
        }
    });

    // ── Build panel HTML ───────────────────────────────────────────────────────
    function _build_html() {
        return `
<div class="cl-panel" id="clPanel">

  <!-- Status bar -->
  <div>
    <div class="cl-section-title">Link Status</div>
    <div class="cl-status-bar">
      <div class="cl-status-dot idle" id="clStatusDot"></div>
      <span class="cl-status-text" id="clStatusText">Waiting for status…</span>
    </div>
  </div>

  <!-- Mode selector -->
  <div>
    <div class="cl-section-title">Connection Mode</div>
    <div class="cl-mode-row">
      <button class="cl-mode-btn active" id="clModeAuto"   onclick="CommLink._setMode('auto')">⚡ Automatic</button>
      <button class="cl-mode-btn"        id="clModeManual" onclick="CommLink._setMode('manual')">🔧 Manual</button>
    </div>
  </div>

  <!-- Auto mode info -->
  <div id="clAutoSection">
    <div class="cl-section-title">Automatic Discovery</div>
    <div class="cl-auto-card">
      The GCS automatically listens for vehicles on all available links:<br>
      <ul>
        <li><strong>UDP</strong> — binds to <code>0.0.0.0:14550</code>, waits for HEARTBEAT</li>
        <li><strong>Serial / USB</strong> — scans all ports at <code>115200 baud</code> on plug-in</li>
      </ul>
      Switch to <strong>Manual</strong> to add SITL drones on 14551, 14552, etc., or RFD 900x serial.
    </div>
  </div>

  <!-- Manual mode form -->
  <div id="clManualSection" style="display:none; flex-direction:column; gap:20px;">

    <!-- Connection type -->
    <div>
      <div class="cl-section-title">Connection Type</div>
      <div class="cl-form">
        <div class="cl-form-row">
          <label>Protocol</label>
          <select class="cl-select" id="clConnType" onchange="CommLink._setConnType(this.value)">
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
            <option value="serial">Serial / USB</option>
          </select>
        </div>
      </div>
    </div>

    <!-- UDP form -->
    <div id="clUdpForm">
      <div class="cl-section-title">UDP Settings</div>
      <div class="cl-form">
        <div class="cl-form-row">
          <label>GCS Listen Port ⭐</label>
          <input class="cl-input" type="number" id="clListenPort"
                 placeholder="e.g. 11040" min="1024" max="65535">
        </div>
        <div class="cl-form-row" style="opacity:0.6;">
          <label title="Auto-detected from first packet received">Remote IP (auto)</label>
          <input class="cl-input" type="text" id="clIpInput"
                 placeholder="127.0.0.1" value="127.0.0.1">
        </div>
        <div class="cl-form-row" style="opacity:0.6;">
          <label title="Auto-detected from first packet received">Remote Port (auto)</label>
          <input class="cl-input" type="number" id="clPortInput"
                 placeholder="auto" min="1" max="65535" value="0">
        </div>
      </div>
      <div style="font-size:11px;color:#aaa;margin-top:4px;padding:0 4px;">
        ⭐ Set <strong>GCS Listen Port</strong> to match your SITL/MAVProxy
        <code>--out=udp:127.0.0.1:<em>PORT</em></code> value (e.g. 11040).
        Remote IP/Port are auto-detected from the first received packet.
      </div>
    </div>

    <!-- TCP form -->
    <div id="clTcpForm" style="display:none;">
      <div class="cl-section-title">TCP Settings</div>
      <div class="cl-form">
        <div class="cl-form-row">
          <label>Host / IP</label>
          <input class="cl-input" type="text" id="clTcpIp"
                 placeholder="e.g. 127.0.0.1" value="127.0.0.1">
        </div>
        <div class="cl-form-row">
          <label>Port</label>
          <input class="cl-input" type="number" id="clTcpPort"
                 placeholder="5760" value="5760" min="1" max="65535">
        </div>
      </div>
    </div>

    <!-- Serial form -->
    <div id="clSerialForm" style="display:none;">
      <div class="cl-section-title">Serial Port</div>
      <div class="cl-refresh-row" style="margin-bottom:8px;">
        <button class="cl-btn cl-btn-secondary cl-btn-sm" id="clRefreshBtn"
                onclick="CommLink._refresh_ports()">🔄 Refresh Ports</button>
      </div>
      <div class="cl-port-list" id="clPortList">
        <div class="cl-port-empty">Click Refresh to scan ports…</div>
      </div>
      <div class="cl-baud-row" style="margin-top:12px;">
        <label>Baud Rate</label>
        <select class="cl-select" id="clBaudRate">
          <option value="57600">57600  (RFD900x default)</option>
          <option value="115200" selected>115200</option>
          <option value="230400">230400</option>
          <option value="460800">460800</option>
          <option value="921600">921600</option>
        </select>
      </div>
    </div>

    <!-- Connect / Disconnect -->
    <div class="cl-action-row">
      <button class="cl-btn cl-btn-primary" id="clConnectBtn"
              onclick="CommLink._do_connect()">🔗 Connect</button>
      <button class="cl-btn cl-btn-danger" id="clDisconnectBtn" style="display:none;"
              onclick="CommLink._do_disconnect()">✕ Disconnect Last</button>
    </div>

  </div><!-- /clManualSection -->

  <!-- Active connections -->
  <div>
    <div class="cl-section-title">Active Connections</div>
    <div class="cl-connections" id="clConnectionsList">
      <div class="cl-empty-conn" id="clNoConns">No active connections</div>
    </div>
  </div>

</div>`;
    }

    // ── Status dot ─────────────────────────────────────────────────────────────
    function _syncStatusDot() {
        const { auto, manual } = _buildAllRows();
        const total = auto.length + manual.length;
        if (total === 0) {
            _setStatus('idle', 'No active connections');
        } else {
            const parts = [];
            if (auto.length)   parts.push(auto.length   + ' auto');
            if (manual.length) parts.push(manual.length + ' manual');
            _setStatus('connected', total + ' link(s) active — ' + parts.join(', '));
        }
    }

    function _setStatus(dotClass, text) {
        const dot  = document.getElementById('clStatusDot');
        const span = document.getElementById('clStatusText');
        if (dot)  dot.className    = 'cl-status-dot ' + dotClass;
        if (span) span.textContent = text;
    }

    // ── Build row data ─────────────────────────────────────────────────────────
    function _buildAllRows() {
        const auto   = [];
        const manual = [];

        if (_lastStatus) {
            const ports = _lastStatus.ports || {};

            if (ports.serial_available && ports.serial_port &&
                ports.serial_port !== 'Not found') {
                auto.push({ type: 'serial', info: ports.serial_port + ' @ 115200', badge: 'auto' });
            }

            if (ports.udp_available) {
                auto.push({ type: 'udp', info: '0.0.0.0:' + (ports.udp_port || 14550) + ' (listening)', badge: 'auto' });
            }

            const dynLinks = _lastStatus.dyn_udp_links || [];
            dynLinks.forEach(dl => {
                const alreadyManual = _manualConns.some(m => m.local_port && m.local_port === dl.local_port);
                if (!alreadyManual) {
                    auto.push({
                        type: 'udp',
                        info: dl.remote_ip + ':' + dl.remote_port + ' ← :' + dl.local_port,
                        badge: 'auto'
                    });
                }
            });
        }

        _manualConns.forEach(c => {
            manual.push({ type: c.type, info: c.info, badge: 'manual', conn_id: c.conn_id });
        });

        return { auto, manual };
    }

    // ── Render connections list ────────────────────────────────────────────────
    function _renderConnectionsList() {
        const list  = document.getElementById('clConnectionsList');
        const empty = document.getElementById('clNoConns');
        if (!list) return;

        const { auto, manual } = _buildAllRows();
        const allRows = [...auto, ...manual];

        list.querySelectorAll('.cl-conn-row').forEach(r => r.remove());

        if (allRows.length === 0) {
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        allRows.forEach(c => {
            const row = document.createElement('div');
            row.className = 'cl-conn-row';
            const badgeCls = c.badge === 'auto' ? 'cl-conn-status-auto' : 'cl-conn-status';
            row.innerHTML = `
                <span class="cl-conn-type ${c.type}">${(c.type||'?').toUpperCase()}</span>
                <span class="cl-conn-info">${c.info}</span>
                <span class="${badgeCls}">${c.badge === 'auto' ? 'Auto' : 'Manual'}</span>
            `;
            list.insertBefore(row, empty || null);
        });
    }

    // ── Mode / type toggles ───────────────────────────────────────────────────
    function _setMode(mode) {
        _mode = mode;
        document.getElementById('clModeAuto')   ?.classList.toggle('active', mode === 'auto');
        document.getElementById('clModeManual') ?.classList.toggle('active', mode === 'manual');
        const autoSec   = document.getElementById('clAutoSection');
        const manualSec = document.getElementById('clManualSection');
        if (autoSec)   autoSec.style.display   = mode === 'auto'   ? '' : 'none';
        if (manualSec) manualSec.style.display = mode === 'manual' ? 'flex' : 'none';
    }

    function _setConnType(type) {
        _connType = type;
        document.getElementById('clUdpForm')   ?.style &&
            (document.getElementById('clUdpForm').style.display    = type === 'udp'    ? '' : 'none');
        document.getElementById('clTcpForm')   ?.style &&
            (document.getElementById('clTcpForm').style.display    = type === 'tcp'    ? '' : 'none');
        document.getElementById('clSerialForm')?.style &&
            (document.getElementById('clSerialForm').style.display = type === 'serial' ? '' : 'none');

        if (type === 'serial' && _serialPorts.length === 0) _refresh_ports();
    }

    function _refresh_ports() {
        const btn = document.getElementById('clRefreshBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⟳ Scanning…'; }
        _ws_send({ type: 'list_serial_ports' });
        setTimeout(() => {
            if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh Ports'; }
        }, 2000);
    }

    function _renderPortList() {
        const list = document.getElementById('clPortList');
        if (!list) return;
        if (!_serialPorts || _serialPorts.length === 0) {
            list.innerHTML = '<div class="cl-port-empty">No serial ports found</div>';
            return;
        }
        list.innerHTML = _serialPorts.map(p => `
            <div class="cl-port-item${p.port === _selectedPort ? ' selected' : ''}"
                 onclick="CommLink._selectPort('${p.port.replace(/\\/g, '\\\\')}')"
                 title="${p.description || p.port}">
              <span class="cl-port-name">${p.display || p.port}</span>
              <span class="cl-port-desc">${p.description || ''}</span>
            </div>
        `).join('');
    }

    function _selectPort(port) {
        _selectedPort = port;
        _renderPortList();
    }

    // ── Connect ────────────────────────────────────────────────────────────────
    function _do_connect() {
        const btn = document.getElementById('clConnectBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⟳ Connecting…'; }
        _setStatus('connecting', 'Connecting…');

        if (_connType === 'serial') {
            if (!_selectedPort) {
                _setStatus('error', 'No serial port selected.');
                if (btn) { btn.disabled = false; btn.textContent = '🔗 Connect'; }
                return;
            }
            const baud = parseInt(document.getElementById('clBaudRate')?.value || '115200');
            _ws_send({ type: 'manual_connect', conn_type: 'serial', port: _selectedPort, baud });

        } else if (_connType === 'tcp') {
            const ip   = (document.getElementById('clTcpIp')?.value || '').trim();
            const port = parseInt(document.getElementById('clTcpPort')?.value || '5760');
            if (!ip) {
                _setStatus('error', 'Enter a host/IP address.');
                if (btn) { btn.disabled = false; btn.textContent = '🔗 Connect'; }
                return;
            }
            _ws_send({ type: 'manual_connect', conn_type: 'tcp', ip, port });

        } else {  // UDP
            const listenPort = parseInt(document.getElementById('clListenPort')?.value) || 0;
            const remoteIp   = (document.getElementById('clIpInput')?.value || '').trim() || '127.0.0.1';
            const remotePort = parseInt(document.getElementById('clPortInput')?.value) || 0;

            if (!listenPort) {
                _setStatus('error', 'Enter the GCS Listen Port (e.g. 11040).');
                if (btn) { btn.disabled = false; btn.textContent = '🔗 Connect'; }
                return;
            }

            _ws_send({
                type: 'connect_vehicle',
                ip: remoteIp,
                port: remotePort || 1,   // backend will auto-update from first received packet
                local_port: listenPort
            });
        }
    }

    // ── Disconnect ─────────────────────────────────────────────────────────────
    function _do_disconnect() {
        if (_manualConns.length === 0) return;
        const last = _manualConns[_manualConns.length - 1];
        _ws_send({ type: 'manual_disconnect', conn_id: last.conn_id });
    }

    // ── ACK handlers ───────────────────────────────────────────────────────────
    function _on_connect_ack(msg) {
        const btn = document.getElementById('clConnectBtn');
        if (btn) { btn.disabled = false; btn.textContent = '🔗 Connect'; }

        if (msg.status === 'ok') {
            _manualConns.push({
                conn_id:    msg.conn_id || ('conn_' + Date.now()),
                type:       msg.conn_type || _connType,
                info:       msg.info     || msg.message || '',
                local_port: msg.local_port || 0
            });
            _renderConnectionsList();
            _syncStatusDot();
            document.getElementById('clDisconnectBtn') &&
                (document.getElementById('clDisconnectBtn').style.display = '');
            window.MsgConsole?.success('🔗 ' + (msg.message || 'Link connected'));
        } else {
            _setStatus('error', '✗ ' + (msg.message || 'Connection failed'));
            window.MsgConsole?.error('[CommLink] ' + (msg.message || 'Connection failed'));
        }
    }

    function _on_disconnect_ack(msg) {
        if (msg.status === 'ok') {
            _manualConns = _manualConns.filter(c => c.conn_id !== msg.conn_id);
            _renderConnectionsList();
            _syncStatusDot();
            if (_manualConns.length === 0) {
                document.getElementById('clDisconnectBtn') &&
                    (document.getElementById('clDisconnectBtn').style.display = 'none');
            }
            window.MsgConsole?.info('🔌 ' + (msg.message || 'Link disconnected'));
        } else {
            _setStatus('error', '✗ ' + (msg.message || 'Disconnect failed'));
        }
    }

    // ── Panel init ─────────────────────────────────────────────────────────────
    function init() {
        if (_initialised) return;
        _initialised = true;

        const host = document.getElementById('panel-comm-link');
        if (!host) { console.warn('[CommLink] host div not found'); return; }

        host.innerHTML = _build_html();

        // Scan serial ports so the list is ready if user opens Serial mode
        setTimeout(_refresh_ports, 400);

        console.log('✅ CommLink panel initialised');
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        init,
        processMessage,   // ← called by websocket.js for manual_connect_ack etc.
        _setMode,
        _setConnType,
        _refresh_ports,
        _selectPort,
        _do_connect,
        _do_disconnect,
    };
})();
