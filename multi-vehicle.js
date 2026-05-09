/**
 * multi-vehicle.js
 * TiHANFly GCS — Multi-Vehicle Support
 *
 * The WebSocket is intercepted at constructor level inside MainWindow.html
 * (the <script> block in <head>, before any other scripts).  That patch:
 *   • Stores every socket as window.ws
 *   • Attaches an addEventListener('message') that calls
 *     window.updateVehicleSelector(msg.vehicles) on every status packet
 *
 * So this file only needs to:
 *   1. Define sendToSelected(payload)
 *   2. Define updateVehicleSelector(sysids)   ← renders drone tab strip
 *   3. Wire tab click events
 *
 * No polling, no onmessage wrapping, no dependency on websocket.js internals.
 *
 * Load order: AFTER websocket.js, BEFORE app.js.
 */

// ── sendToSelected(payload) ──────────────────────────────────────────────────
function sendToSelected(payload) {
    if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
        console.warn('[MultiVehicle] sendToSelected: socket not open — dropped', payload);
        return;
    }
    payload.sysid = window.selectedSysId ?? 1;
    window.ws.send(JSON.stringify(payload));
    console.log('[MultiVehicle] sendToSelected → sysid=' + payload.sysid, payload);
}
window.sendToSelected = sendToSelected;


// ── updateVehicleSelector(sysids) ────────────────────────────────────────────
/**
 * Accepts both formats from the backend:
 *   [{"sysid": 1, "battery": 92, "mode": "HOLD", "armed": true}]
 *   [{"sysid": 1}, {"sysid": 2}]
 *   [1, 2]   ← plain integers (also supported)
 */
function updateVehicleSelector(sysids) {
    if (!Array.isArray(sysids)) sysids = [];

    // Normalise to [{id, battery, armed, mode}]
    var vehicles = sysids.map(function(item) {
        if (item !== null && typeof item === 'object') {
            return {
                id:      item.sysid,
                battery: typeof item.battery === 'number' ? item.battery : null,
                armed:   !!item.armed,
                mode:    item.mode || null
            };
        }
        return { id: item, battery: null, armed: false, mode: null };
    }).filter(function(v) {
        return typeof v.id === 'number' && v.id > 0;
    });

    var count = vehicles.length;
    var ids   = vehicles.map(function(v) { return v.id; });

    // ── 1. Fleet count badge ─────────────────────────────────────────────────
    var badge    = document.getElementById('droneCountBadge');
    var dot      = document.getElementById('droneCountDot');
    var countTxt = document.getElementById('droneCountText');

    if (badge && dot && countTxt) {
        countTxt.textContent = count + (count === 1 ? ' DRONE' : ' DRONES');
        if (count > 0) {
            badge.style.color       = '#4fc3f7';
            badge.style.borderColor = '#1e4a7a';
            dot.style.background    = '#4ade80';
            dot.style.boxShadow     = '0 0 5px rgba(74,222,128,0.7)';
            dot.style.animation     = 'dronePulse 1.4s ease-in-out infinite';
        } else {
            badge.style.color       = '#e57373';
            badge.style.borderColor = '#2e3a4a';
            dot.style.background    = '#e57373';
            dot.style.boxShadow     = 'none';
            dot.style.animation     = 'none';
        }
    }

    // ── 2. Tab strip (only shown for 2+ drones) ──────────────────────────────
    var wrap = document.getElementById('vehicleSelectorWrap');
    var sel  = document.getElementById('vehicleSelector');   // hidden, kept for compat

    if (!wrap) return;

    if (count <= 1) {
        wrap.style.display = 'none';
        if (count === 1) {
            window.selectedSysId = ids[0];
            if (sel) {
                sel.innerHTML = '';
                var o = document.createElement('option');
                o.value = ids[0]; o.textContent = ids[0]; sel.appendChild(o);
                sel.value = ids[0];
            }
        }
        return;
    }

    wrap.style.display = 'flex';

    var prevSysId = window.selectedSysId ?? ids[0];
    if (ids.indexOf(prevSysId) === -1) prevSysId = ids[0];
    window.selectedSysId = prevSysId;

    // Remove old tabs; keep the hidden <select>
    Array.from(wrap.querySelectorAll('.mv-drone-tab')).forEach(function(el) { el.remove(); });

    // Rebuild hidden <select> for backward compat
    if (sel) {
        sel.innerHTML = '';
        ids.forEach(function(id) {
            var opt = document.createElement('option');
            opt.value = id; opt.textContent = id; sel.appendChild(opt);
        });
        sel.value = prevSysId;
    }

    // Build one tab per drone
    vehicles.forEach(function(v) {
        var tab = document.createElement('div');
        tab.className = 'mv-drone-tab' + (v.id === prevSysId ? ' mv-active' : '');
        tab.dataset.sysid = v.id;

        // Dot colour: low battery = amber/red, else green
        var dotClass = 'mv-dot';
        if (v.battery !== null && v.battery < 20)       dotClass += ' mv-err';
        else if (v.battery !== null && v.battery < 40)  dotClass += ' mv-warn';

        // Label: "D-1" or "D-1 · 84%" when battery is available
        var label = 'D-' + v.id;
        if (v.battery !== null) label += ' · ' + v.battery + '%';

        tab.innerHTML = '<span class="' + dotClass + '"></span>' + label;

        tab.addEventListener('click', function() {
            window.selectedSysId = v.id;
            wrap.querySelectorAll('.mv-drone-tab').forEach(function(t) {
                t.classList.remove('mv-active');
            });
            tab.classList.add('mv-active');
            if (sel) sel.value = v.id;
            console.log('[MultiVehicle] Active drone → sysid=' + v.id);

            // Brief highlight flash
            tab.style.transition = 'none';
            tab.style.borderColor = 'rgba(82,185,255,0.8)';
            setTimeout(function() {
                tab.style.transition = '';
                tab.style.borderColor = '';
            }, 450);
        });

        if (sel) wrap.insertBefore(tab, sel);
        else     wrap.appendChild(tab);
    });
}
window.updateVehicleSelector = updateVehicleSelector;


// ── Hidden <select> change — kept for any legacy code that reads vehicleSelector ──
(function wireDropdown() {
    var sel = document.getElementById('vehicleSelector');
    if (!sel) { document.addEventListener('DOMContentLoaded', wireDropdown); return; }
    sel.addEventListener('change', function () {
        window.selectedSysId = parseInt(this.value, 10);
        console.log('[MultiVehicle] (select fallback) Active drone → sysid=' + window.selectedSysId);
    });
    console.log('[MultiVehicle] wired ✓  initial sysid=' + (window.selectedSysId ?? 1));
})();