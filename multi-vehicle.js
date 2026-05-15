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
let _dynLinks = [];   // copy of dyn_udp_links from last status packet

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
        sel.value = ids.includes(+prev) ? prev : ids[0];
    }

    // ── Preserve selected sysid ───────────────────────────────────────────────
    if (window.selectedSysId !== 0 && !ids.includes(window.selectedSysId)) {
        window.selectedSysId = ids[0] ?? 1;
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
            window.selectedSysId = v.sysid;
            wrap.querySelectorAll('.mv-drone-tab').forEach(t => t.classList.remove('mv-active'));
            tab.classList.add('mv-active');
            if (sel) sel.value = v.sysid;
            console.log('[MV] Active drone → sysid=' + v.sysid);
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
            window.selectedSysId = 0;
            wrap.querySelectorAll('.mv-drone-tab').forEach(t => t.classList.remove('mv-active'));
            tab.classList.add('mv-active');
            if (sel) {
                // Try to keep it pointing to something valid, or 0 if supported
                let opt = Array.from(sel.options).find(o => o.value == 0);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = 0;
                    opt.textContent = 'All Drones';
                    sel.appendChild(opt);
                }
                sel.value = 0;
            }
            console.log('[MV] Active drone → ALL (sysid=0)');
            
            // Force an update to show the first drone's data on compass/header
            if (list.length > 0) {
                window._primarySysId = list[0].sysid;
            }
        });

        wrap.appendChild(tab);
    }
    
    if (list.length > 0) {
        window._primarySysId = list[0].sysid;
    }
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

        <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">Remote IP</label>
        <input id="mvRemoteIp" type="text" placeholder="192.168.1.10" value="127.0.0.1"
          style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                 color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;margin-bottom:12px;">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
          <div>
            <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">Remote Port</label>
            <input id="mvRemotePort" type="number" value="14550"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;">
          </div>
          <div>
            <label style="color:#7ba3c4;font-size:.78rem;display:block;margin-bottom:4px;">Local Port <span style="color:#4a6a8a">(auto)</span></label>
            <input id="mvLocalPort" type="number" placeholder="auto"
              style="width:100%;box-sizing:border-box;background:#07111f;border:1px solid #1e4a7a;
                     color:#e0f0ff;border-radius:6px;padding:8px 10px;font-size:.9rem;">
          </div>
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
        <div style="color:#7ba3c4;font-size:.78rem;margin-bottom:8px;">Active UDP Links</div>
        <div id="mvLinkList" style="max-height:130px;overflow-y:auto;"></div>
      </div>`;

    document.body.appendChild(modal);

    // Close
    document.getElementById('mvConnClose').onclick = () => modal.style.display = 'none';
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    // Connect button
    document.getElementById('mvConnectBtn').onclick = () => {
        const ip    = document.getElementById('mvRemoteIp').value.trim();
        const rport = parseInt(document.getElementById('mvRemotePort').value) || 14550;
        const lport = parseInt(document.getElementById('mvLocalPort').value)  || 0;
        const status = document.getElementById('mvConnStatus');
        if (!ip) { status.style.color='#e57373'; status.textContent='Enter a remote IP address.'; return; }
        status.style.color = '#4fc3f7';
        status.textContent = 'Opening UDP socket…';
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
            window.ws.send(JSON.stringify({ type:'connect_vehicle', ip, port:rport, local_port:lport }));
        } else {
            status.style.color = '#e57373';
            status.textContent = 'WebSocket not connected.';
        }
    };
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
    if (msg.type === 'connect_vehicle_ack') {
        const status = document.getElementById('mvConnStatus');
        if (!status) return;
        if (msg.status === 'ok') {
            status.style.color = '#4ade80';
            status.textContent = '✓ ' + msg.message;
        } else {
            status.style.color = '#e57373';
            status.textContent = '✗ ' + msg.message;
        }
        return;
    }
    if (msg.type === 'disconnect_vehicle_ack') {
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