/**
 * multi-vehicle.js  —  TiHANFly GCS  (v2)
 *
 * Adds:
 *   • sendToSelected(payload)         — routes any command to the selected sysid
 *   • updateVehicleSelector(vehicles) — renders telemetry cards for every drone
 *   • Connection Manager modal        — connect_vehicle / disconnect_vehicle
 *   • Fleet count badge updates
 *
 * Load order: AFTER websocket.js, BEFORE app.js.
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
window.selectedSysId = 1;
window.activeSysids = [];
window.latestVehiclesState = [];
let _dynLinks = [];   // copy of dyn_udp_links from last status packet

function setSelectedSysId(id) {
    window.selectedSysId = id;
    document.querySelectorAll('.mv-drone-selector-dropdown, #vehicleSelector').forEach(function(sel) {
        if (sel.value != id) sel.value = id;
    });
    var wrap = document.getElementById('vehicleSelectorWrap');
    if (wrap) {
        wrap.querySelectorAll('.mv-drone-tab').forEach(function(t) { t.classList.remove('mv-active'); });
        var tab = wrap.querySelector('.mv-drone-tab[data-sysid="' + id + '"]');
        if (tab) tab.classList.add('mv-active');
    }
    console.log('[MV] Active drone => sysid=' + id);
    window.dispatchEvent(new CustomEvent('vehicle_selected', { detail: { sysid: id } }));
}
window.setSelectedSysId = setSelectedSysId;

function buildDroneSelectorHtml() {
    if (!window.activeSysids || window.activeSysids.length === 0) return '';
    var html = '<div class="drone-selector-wrap" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;background:var(--bg-raised,#1a1a2e);padding:8px 12px;border-radius:6px;border:1px solid var(--border-muted,#333);">'
        + '<span style="color:var(--text-muted,#888);font-size:13px;font-weight:600;">Target Drone:</span>'
        + '<select class="mv-drone-selector-dropdown" onchange="window.setSelectedSysId(parseInt(this.value,10))" style="background:var(--bg-surface,#111827);color:var(--accent,#4fc3f7);border:1px solid var(--border-muted,#333);padding:4px 8px;border-radius:4px;outline:none;font-family:monospace;min-width:100px;">';
    window.activeSysids.forEach(function(id) {
        html += '<option value="' + id + '"' + (window.selectedSysId === id ? ' selected' : '') + '>D' + id + '</option>';
    });
    if (window.activeSysids.length > 1) {
        html += '<option value="0"' + (window.selectedSysId === 0 ? ' selected' : '') + '>All Drones</option>';
    }
    html += '</select></div>';
    return html;
}
window.buildDroneSelectorHtml = buildDroneSelectorHtml;

function updateAllDroneSelectors() {
    document.querySelectorAll('.drone-selector-wrap-container').forEach(container => {
        container.innerHTML = buildDroneSelectorHtml();
    });
}


// ── sendToSelected ────────────────────────────────────────────────────────────
function sendToSelected(payload) {
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.warn('[MV] sendToSelected: socket not open', payload);
        return;
    }
    if (window.selectedSysId === 0 && window.activeSysids && window.activeSysids.length > 0) {
        window.activeSysids.forEach(sysid => {
            const msg = { ...payload, sysid: sysid };
            window.ws.send(JSON.stringify(msg));
        });
        console.log('[MV] Broadcasted to all drones:', payload.type || payload.cmd_id);
    } else {
        payload.sysid = window.selectedSysId ?? 1;
        window.ws.send(JSON.stringify(payload));
    }
}
window.sendToSelected = sendToSelected;

// ── updateVehicleSelector(vehicles) ─────────────────────────────────────────
/**
 * Called from the WebSocket 'status' message handler.
 * vehicles = array of:
 *   { sysid, armed, mode, battery_pct, battery_v,
 *     gps_fix, num_sats, lat, lon, alt, link_id }
 * dyn_links = array of:
 *   { local_port, remote_ip, remote_port, link_id }
 */
function updateVehicleSelector(vehicles, dynLinks) {
    if (!Array.isArray(vehicles)) vehicles = [];
    _dynLinks = Array.isArray(dynLinks) ? dynLinks : [];

    const count = vehicles.length;
    const ids   = vehicles.map(v => (typeof v === 'object' ? v.sysid : v));
    window.activeSysids = ids;

    // ── Fleet count badge ────────────────────────────────────────────────────
    const badge    = document.getElementById('droneCountBadge');
    const dot      = document.getElementById('droneCountDot');
    const countTxt = document.getElementById('droneCountText');
    if (badge && dot && countTxt) {
        countTxt.textContent = count + (count === 1 ? ' DRONE' : ' DRONES');
        const ok = count > 0;
        badge.style.color       = ok ? '#4fc3f7' : '#e57373';
        badge.style.borderColor = ok ? '#1e4a7a' : '#2e3a4a';
        dot.style.background    = ok ? '#4ade80' : '#e57373';
        dot.style.boxShadow     = ok ? '0 0 5px rgba(74,222,128,0.7)' : 'none';
        dot.style.animation     = ok ? 'dronePulse 1.4s ease-in-out infinite' : 'none';
    }

    // ── Normalise vehicles ────────────────────────────────────────────────────
    const list = vehicles.map(item => {
        if (item !== null && typeof item === 'object') return item;
        return { sysid: item };
    }).filter(v => typeof v.sysid === 'number' && v.sysid > 0);

    window.latestVehiclesState = list;

    // ── Hidden <select> (legacy compat) ──────────────────────────────────────
    const sel = document.getElementById('vehicleSelector');
    if (sel) {
        const prev = sel.value;
        sel.innerHTML = '';
        ids.forEach(id => {
            const o = document.createElement('option');
            o.value = id; o.textContent = 'Drone ' + id;
            sel.appendChild(o);
        });
        if (ids.length > 1) {
            const o = document.createElement('option');
            o.value = 0; o.textContent = 'All Drones';
            sel.appendChild(o);
        }
        sel.value = (prev == '0' || ids.includes(+prev)) ? prev : ids[0];
    }

    // ── Preserve selected sysid ───────────────────────────────────────────────
    // If the currently selected drone disappeared from the fleet, snap to the
    // first available one.  Use setSelectedSysId() so all listeners / dropdowns
    // are notified — a bare assignment here caused silent resets to Drone 1
    // without firing vehicle_selected, breaking param panel routing.
    if (window.selectedSysId !== 0 && ids.length > 0 && !ids.includes(window.selectedSysId)) {
        setSelectedSysId(ids[0]);
    } else if (ids.length === 0) {
        window.selectedSysId = 1; // no drones — safe default, no event needed
    }

    // ── Tab strip wrapper ─────────────────────────────────────────────────────
    const wrap = document.getElementById('vehicleSelectorWrap');
    if (!wrap) return;

    // Remove old vehicle tabs (keep the Add button)
    wrap.querySelectorAll('.mv-drone-tab').forEach(el => el.remove());

    // (Removed inline display override to let dropdown CSS handle visibility)

    // ── Build one card per drone ──────────────────────────────────────────────
    list.forEach(v => {
        const tab = document.createElement('div');
        const isActive = v.sysid === window.selectedSysId;
        tab.className = 'mv-drone-tab' + (isActive ? ' mv-active' : '');
        tab.dataset.sysid = v.sysid;

        const pct  = typeof v.battery_pct === 'number' ? v.battery_pct : -1;
        const batV = typeof v.battery_v   === 'number' ? v.battery_v.toFixed(1) : '–';
        const mode = v.mode  || '–';
        const sats = v.num_sats ?? '–';
        const fix  = v.gps_fix ?? 0;
        const armed = !!v.armed;

        // battery colour class
        let dotCls = 'mv-dot';
        if (pct >= 0 && pct < 20)      dotCls += ' mv-err';
        else if (pct >= 0 && pct < 40) dotCls += ' mv-warn';

        // GPS fix label
        const fixStr = ['NO GPS','No Fix','2D Fix','3D Fix','DGPS','RTK Float','RTK Fixed'][fix] || '–';

        tab.innerHTML = `
          <div class="mv-tab-top">
            <span class="${dotCls}"></span>
            <span class="mv-label">D-${v.sysid}</span>
            <span class="mv-arm-badge ${armed ? 'mv-armed' : 'mv-disarmed'}">${armed ? 'ARMED' : 'DSRM'}</span>
          </div>
          <div class="mv-tab-row"><span class="mv-ico">✈</span>${mode}</div>
          <div class="mv-tab-row"><span class="mv-ico">🔋</span>${pct >= 0 ? pct + '% ' + batV + 'V' : '–'}</div>
          <div class="mv-tab-row"><span class="mv-ico">📡</span>${fixStr} · ${sats} sats</div>`;

        tab.addEventListener('click', () => {
            window.setSelectedSysId(v.sysid);
        });

        // Insert tab into wrap
        wrap.appendChild(tab);
    });

    // ── Build "All Drones" card if >1 drone ──────────────────────────────────
    if (list.length > 1) {
        const tab = document.createElement('div');
        const isActive = window.selectedSysId === 0;
        tab.className = 'mv-drone-tab' + (isActive ? ' mv-active' : '');
        tab.dataset.sysid = 0;

        tab.innerHTML = `
          <div class="mv-tab-top">
            <span class="mv-dot" style="background:#b388ff;box-shadow:0 0 5px #b388ff;"></span>
            <span class="mv-label">All Drones</span>
            <span class="mv-arm-badge" style="background:transparent;border:1px solid #b388ff;color:#b388ff;">FLEET</span>
          </div>
          <div class="mv-tab-row"><span class="mv-ico">👥</span>${list.length} Vehicles Connected</div>
          <div class="mv-tab-row"><span class="mv-ico">⚡</span>Broadcast Commands</div>
        `;

        tab.addEventListener('click', () => {
            if (list.length > 0) {
                window._primarySysId = list[0].sysid;
            }
            window.setSelectedSysId(0);
        });

        wrap.appendChild(tab);
    }
    
    if (list.length > 0 && window.selectedSysId === 0) {
        window._primarySysId = list[0].sysid;
    }
    
    updateAllDroneSelectors();
}
window.updateVehicleSelector = updateVehicleSelector;

// ── Connection Manager modal ──────────────────────────────────────────────────
function buildConnectionManagerModal() {
    if (document.getElementById('mvConnModal')) return;

    const modal = document.createElement('div');
    modal.id = 'mvConnModal';
    modal.style.cssText = `
        display:none;position:fixed;inset:0;z-index:9999;
        background:rgba(0,0,0,.65);backdrop-filter:blur(4px);
        align-items:center;justify-content:center;`;

    modal.innerHTML = `
      <div style="background:#0d1b2e;border:1px solid #1e4a7a;border-radius:12px;
                  padding:24px;min-width:340px;max-width:440px;width:90%;
                  box-shadow:0 8px 40px rgba(0,0,0,.6);font-family:inherit;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <h3 style="margin:0;color:#4fc3f7;font-size:1rem;letter-spacing:.06em;">⚡ CONNECT VEHICLE</h3>
          <button id="mvConnClose" style="background:none;border:none;color:#7ba3c4;font-size:1.2rem;cursor:pointer;">✕</button>
        </div>

        <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">Protocol</label>
        <select id="mvConnProtocol"
          style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                 color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
            <option value="serial">Serial / USB</option>
        </select>

        <!-- UDP Form -->
        <div id="mvFormUdp">
            <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">GCS Listen Port ⭐</label>
            <input id="mvLocalPort" type="number" placeholder="e.g. 11040" min="1024" max="65535"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;opacity:0.6;">
              <div>
                <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;" title="Auto-detected from first packet received">Remote IP (auto)</label>
                <input id="mvRemoteIp" type="text" placeholder="127.0.0.1" value="127.0.0.1"
                  style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                         color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;">
              </div>
              <div>
                <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;" title="Auto-detected from first packet received">Remote Port (auto)</label>
                <input id="mvRemotePort" type="number" placeholder="auto" value="0"
                  style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                         color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;">
              </div>
            </div>
        </div>

        <!-- TCP Form -->
        <div id="mvFormTcp" style="display:none;">
            <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">TCP IP</label>
            <input id="mvTcpIp" type="text" placeholder="127.0.0.1" value="127.0.0.1"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">

            <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">TCP Port</label>
            <input id="mvTcpPort" type="number" value="5760"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">
        </div>

        <!-- Serial Form -->
        <div id="mvFormSerial" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <label style="color:#7ba3c4;font-size:.78rem;">Serial Port</label>
                <button id="mvRefreshPorts" style="background:none;border:none;color:#4fc3f7;cursor:pointer;font-size:.78rem;">🔄 Refresh</button>
            </div>
            <select id="mvSerialPort"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">
                <option value="">Scanning...</option>
            </select>

            <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">Baud Rate</label>
            <select id="mvSerialBaud"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">
                <option value="57600">57600 (RFD900x default)</option>
                <option value="115200" selected>115200</option>
                <option value="230400">230400</option>
                <option value="460800">460800</option>
                <option value="921600">921600</option>
            </select>
        </div>

        <button id="mvConnectBtn"
          style="width:100%;padding:10px;background:linear-gradient(135deg,#1565c0,#0d47a1);
                 border:none;border-radius:8px;color:#fff;font-size:.9rem;font-weight:600;
                 cursor:pointer;letter-spacing:.04em;margin-bottom:10px;
                 transition:opacity .2s;">
          CONNECT
        </button>

        <div id="mvConnStatus" style="color:#7ba3c4;font-size:.8rem;min-height:20px;text-align:center;"></div>

        <hr style="border-color:#1e4a7a;margin:16px 0 12px;">
        <div style="color:#7ba3c4;font-size:.78rem;margin-bottom:8px;">Active Dynamic Links</div>
        <div id="mvLinkList" style="max-height:130px;overflow-y:auto;"></div>
      </div>`;

    document.body.appendChild(modal);

    // Form toggling
    document.getElementById('mvConnProtocol').addEventListener('change', (e) => {
        const type = e.target.value;
        document.getElementById('mvFormUdp').style.display = type === 'udp' ? 'block' : 'none';
        document.getElementById('mvFormTcp').style.display = type === 'tcp' ? 'block' : 'none';
        document.getElementById('mvFormSerial').style.display = type === 'serial' ? 'block' : 'none';
        if (type === 'serial') _refreshMvPorts();
    });

    // Serial port refresh
    document.getElementById('mvRefreshPorts').onclick = _refreshMvPorts;

    // Close
    document.getElementById('mvConnClose').onclick = () => modal.style.display = 'none';
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    // Connect button
    document.getElementById('mvConnectBtn').onclick = () => {
        const type = document.getElementById('mvConnProtocol').value;
        const status = document.getElementById('mvConnStatus');

        if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
            status.style.color = '#e57373';
            status.textContent = 'WebSocket not connected.';
            return;
        }

        if (type === 'udp') {
            const remoteIp   = (document.getElementById('mvRemoteIp')?.value || '').trim() || '127.0.0.1';
            const rport = parseInt(document.getElementById('mvRemotePort').value) || 0;
            const lport = parseInt(document.getElementById('mvLocalPort').value)  || 0;
            
            if (!lport) { status.style.color='#e57373'; status.textContent='Enter the GCS Listen Port (e.g. 11040).'; return; }
            
            status.style.color = '#4fc3f7';
            status.textContent = 'Opening UDP socket…';
            
            window.ws.send(JSON.stringify({ 
                type: 'connect_vehicle', 
                ip: remoteIp, 
                port: rport || 1, 
                local_port: lport 
            }));
        } else if (type === 'tcp') {
            const ip    = document.getElementById('mvTcpIp').value.trim();
            const port  = parseInt(document.getElementById('mvTcpPort').value) || 5760;
            if (!ip) { status.style.color='#e57373'; status.textContent='Enter TCP IP address.'; return; }
            status.style.color = '#4fc3f7';
            status.textContent = 'Connecting to TCP server…';
            window.ws.send(JSON.stringify({ type:'manual_connect', conn_type:'tcp', ip, port }));
        } else if (type === 'serial') {
            const port = document.getElementById('mvSerialPort').value;
            const baud = parseInt(document.getElementById('mvSerialBaud').value) || 115200;
            if (!port) { status.style.color='#e57373'; status.textContent='Select a serial port.'; return; }
            status.style.color = '#4fc3f7';
            status.textContent = 'Opening Serial port…';
            window.ws.send(JSON.stringify({ type:'manual_connect', conn_type:'serial', port, baud }));
        }
    };
}

function _refreshMvPorts() {
    if (typeof window.safeSend === 'function') window.safeSend({ type: 'list_serial_ports' });
    else if (window.ws && window.ws.readyState === WebSocket.OPEN) window.ws.send(JSON.stringify({ type: 'list_serial_ports' }));
    
    setTimeout(() => {
        const sel = document.getElementById('mvSerialPort');
        if (!sel) return;
        sel.innerHTML = '';
        const ports = window._vcLastKnownPorts || [];
        if (ports.length === 0) {
            sel.innerHTML = '<option value="">No ports found</option>';
        } else {
            ports.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.port;
                opt.textContent = `${p.port} - ${p.description || 'Serial Device'}`;
                sel.appendChild(opt);
            });
        }
    }, 200);
}

function openConnectionManager() {
    buildConnectionManagerModal();
    _renderLinkList();
    document.getElementById('mvConnModal').style.display = 'flex';
}
window.openConnectionManager = openConnectionManager;

// Render active dynamic link list inside modal
function _renderLinkList() {
    const list = document.getElementById('mvLinkList');
    if (!list) return;
    if (_dynLinks.length === 0) {
        list.innerHTML = '<div style="color:#4a6a8a;font-size:.8rem;text-align:center;">No extra links active</div>';
        return;
    }
    list.innerHTML = _dynLinks.map(dl => `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  background:#07111f;border:1px solid #1e4a7a;border-radius:6px;
                  padding:7px 10px;margin-bottom:6px;font-size:.8rem;color:#b0cce0;">
        <span>:${dl.local_port} → ${dl.remote_ip}:${dl.remote_port}</span>
        <button data-lport="${dl.local_port}"
          style="background:#7f1d1d;border:none;border-radius:5px;color:#fca5a5;
                 padding:3px 8px;cursor:pointer;font-size:.75rem;">
          ✕ Disconnect
        </button>
      </div>`).join('');

    list.querySelectorAll('button[data-lport]').forEach(btn => {
        btn.onclick = () => {
            const lp = parseInt(btn.dataset.lport);
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type:'disconnect_vehicle', local_port:lp }));
                btn.textContent = '…'; btn.disabled = true;
            }
        };
    });
}

// ── Handle backend acknowledgements ──────────────────────────────────────────
function handleMvMessage(msg) {
    if (msg.type === 'connect_vehicle_ack' || msg.type === 'manual_connect_ack') {
        const status = document.getElementById('mvConnStatus');
        if (!status) return;
        if (msg.status === 'ok') {
            status.style.color = '#4ade80';
            status.textContent = '✓ ' + (msg.message || 'Connected successfully');
            _renderLinkList();
        } else {
            status.style.color = '#e57373';
            status.textContent = '✗ ' + (msg.message || 'Connection failed');
        }
        return;
    }
    if (msg.type === 'disconnect_vehicle_ack' || msg.type === 'manual_disconnect_ack') {
        _renderLinkList();
    }
}
window._mvHandleMessage = handleMvMessage;

// ── Add "+" button to the vehicle selector wrap ───────────────────────────────
function ensureAddButton() {
    const wrap = document.getElementById('vehicleSelectorWrap');
    if (!wrap || wrap.querySelector('#mvAddDroneBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'mvAddDroneBtn';
    btn.title = 'Connect another vehicle';
    btn.textContent = '+';
    btn.style.cssText = `
        background:linear-gradient(135deg,#1e4a7a,#0d2b45);
        border:1px solid #1e7a8a;border-radius:8px;
        color:#4fc3f7;font-size:1.1rem;font-weight:700;
        width:42px;height:42px;cursor:pointer;flex-shrink:0;
        transition:background .2s;`;
    btn.onmouseenter = () => btn.style.background = 'linear-gradient(135deg,#1565c0,#0d47a1)';
    btn.onmouseleave = () => btn.style.background = 'linear-gradient(135deg,#1e4a7a,#0d2b45)';
    btn.onclick = () => openConnectionManager();
    wrap.appendChild(btn);
}

// ── Hook into the WebSocket status message ────────────────────────────────────
// The global ws 'message' handler in MainWindow.html (or websocket.js) already
// calls window.updateVehicleSelector.  We patch it here to also pass dyn_links.
(function patchStatusHandler() {
    const _orig = window.updateVehicleSelector;
    // updateVehicleSelector is already our function above — this is a no-op shim
    // kept for safety if another script re-assigns it.
    window._mvPatchedHandler = true;
})();

// Wire hidden <select> change for any legacy code
(function wireDropdown() {
    const sel = document.getElementById('vehicleSelector');
    if (!sel) { document.addEventListener('DOMContentLoaded', wireDropdown); return; }
    sel.addEventListener('change', function () {
        window.selectedSysId = parseInt(this.value, 10);
    });
    console.log('[MV] wired ✓  initial sysid=' + (window.selectedSysId ?? 1));
})();



// Inject card styles
(function injectStyles() {
    if (document.getElementById('mvStyles')) return;
    const s = document.createElement('style');
    s.id = 'mvStyles';
    s.textContent = `
    #vehicleSelectorWrap {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 5px;
        flex-direction: column; gap: 8px; align-items: stretch;
        padding: 8px;
        background: rgba(10, 20, 35, 0.95);
        border: 1px solid #1e4a7a;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        z-index: 10000;
        max-height: 80vh;
        overflow-y: auto;
    }
    #vehicleSelectorWrap.show-dropdown {
        display: flex !important;
    }
    .mv-drone-tab {
        background: linear-gradient(160deg, #0d1b2e, #07111f);
        border: 1px solid #1e4a7a;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        min-width: 160px;
        font-size: .78rem;
        color: #7ba3c4;
        transition: border-color .2s, background .2s;
        flex-shrink: 0;
    }
    .mv-drone-tab:hover   { border-color: #2e8aaf; background: #0d2b45; }
    .mv-drone-tab.mv-active {
        border-color: #4fc3f7;
        background: linear-gradient(160deg, #0d2b45, #071a30);
        color: #cce8ff;
    }
    .mv-tab-top { display:flex; align-items:center; gap:6px; margin-bottom:5px; }
    .mv-label { font-weight:700; color:#b0d8f5; font-size:.85rem; }
    .mv-arm-badge {
        font-size:.65rem; font-weight:700; border-radius:4px;
        padding:1px 5px; letter-spacing:.05em; margin-left:auto;
    }
    .mv-armed    { background:#7f1d1d; color:#fca5a5; }
    .mv-disarmed { background:#1e3a1e; color:#86efac; }
    .mv-tab-row { display:flex; align-items:center; gap:5px; margin-top:3px; line-height:1.4; }
    .mv-ico { font-size:.75rem; width:14px; text-align:center; }
    .mv-dot {
        width:8px; height:8px; border-radius:50%;
        background:#4ade80; box-shadow:0 0 5px rgba(74,222,128,.6);
        animation: dronePulse 1.4s ease-in-out infinite; flex-shrink:0;
    }
    .mv-dot.mv-warn { background:#facc15; box-shadow:0 0 5px rgba(250,204,21,.6); }
    .mv-dot.mv-err  { background:#e57373; box-shadow:0 0 5px rgba(229,115,115,.6); animation:none; }
    `;
    document.head.appendChild(s);
})();
