/**
 * param-switch.js
 * TiHANFly GCS — RC Switch Options Panel
 *
 * Architecture:
 *   Frontend (param-switch.js)
 *       ↕  WebSocket JSON
 *   C++ Backend (Parameters/parameter_manager.cpp)
 *       ↕  MAVLink PARAM_REQUEST_LIST / PARAM_VALUE / PARAM_SET
 *   Flight Controller (ArduPilot)
 *
 * WebSocket messages sent (GCS → Backend):
 *   { "type": "param_request_list" }
 *   { "type": "param_set", "param_id": "RC6_OPTION", "value": 9 }
 *
 * WebSocket messages received (Backend → GCS):
 *   { "type": "param_value",         "param_id":"…", "value": 0.0, "default": 0.0, "index": N, "count": M }
 *   { "type": "param_load_start",    "message":"…" }
 *   { "type": "param_load_progress", "received": N, "total": M, "percent": P }
 *   { "type": "param_load_complete", "count": N, "elapsed_ms": T }
 *   { "type": "param_set_sent",      "param_id":"…", "value": 0.0 }
 *   { "type": "param_all",           "params": [{param_id, value, default, type, index}, …] }
 *   { "type": "param_error",         "message":"…" }
 */
(function () {
  'use strict';

  /* ─── RC switch option map ───────────────────────────────────────────────────
   * Full ArduPilot RCx_OPTION parameter map (Copter 4.x).
   * Keys are the numeric MAVLink values; values are the display labels.
   * Sorted by numeric key to match ArduPilot parameter documentation.
   * ─────────────────────────────────────────────────────────────────────────── */
  const SWITCH_OPTIONS = {
    0:   'Do Nothing',
    2:   'Flip',
    3:   'Simple Mode',
    4:   'RTL',
    5:   'Save Trim',
    7:   'Save WP',
    9:   'Camera Trigger',
    10:  'RangeFinder Enable',
    11:  'Fence Enable',
    13:  'Super Simple',
    14:  'Acro Trainer',
    15:  'Sprayer Enable',
    16:  'AUTO Mode',
    17:  'AutoTune',
    18:  'Land Mode',
    19:  'GUIDED Mode',
    21:  'Proximity Avoidance',
    22:  'Motor Emergency Stop',
    23:  'Motor Interlock',
    24:  'Brake Mode',
    25:  'Throw Mode',
    26:  'ADSB Avoidance Enable',
    27:  'Retract Mount1',
    28:  'Relay1 On/Off',
    29:  'Landing Gear',
    30:  'Lost Copter Sound',
    31:  'Motor Emergency Stop',
    32:  'Motor Interlock',
    33:  'Brake Mode',
    34:  'Relay2 On/Off',
    35:  'Relay3 On/Off',
    36:  'Relay4 On/Off',
    37:  'Throw Mode',
    38:  'ADSB Avoidance Enable',
    39:  'PrecLoiter Enable',
    40:  'Proximity Avoidance',
    41:  'ArmDisarm (4.1 and lower)',
    42:  'SmartRTL Mode',
    43:  'InvertedFlight',
    44:  'Winch Enable',
    45:  'Winch Control',
    46:  'RC Override Enable',
    47:  'User Function1',
    48:  'User Function2',
    49:  'User Function3',
    52:  'Acro Mode',
    55:  'GUIDED Mode',
    56:  'LOITER Mode',
    57:  'FOLLOW Mode',
    58:  'Clear Waypoints',
    59:  'Simple heading reset',
    60:  'ArmDisarm (4.2 and higher)',
    62:  'SMARTRTL Mode',
    63:  'POSHOLD Mode',
    64:  'STABILIZE Mode',
    65:  'GPS Disable',
    66:  'Relay5 On/Off',
    67:  'Relay6 On/Off',
    68:  'STABILIZE Mode',
    69:  'ALTHOLD Mode',
    72:  'Save Trim',
    73:  'Save WP',
    74:  'Camera Auto',
    75:  'Camera Image Tracking',
    76:  'STANDBY Mode',
    78:  'RunCam Control',
    79:  'RunCam OSD Control',
    80:  'Viso Align',
    81:  'Disarm',
    83:  'ZigZag Mode',
    84:  'ZigZag SaveWP',
    85:  'Scripting1',
    86:  'Scripting2',
    87:  'Scripting3',
    88:  'Scripting4',
    89:  'Scripting5',
    90:  'Scripting6',
    91:  'Scripting7',
    92:  'Scripting8',
    94:  'AirMode',
    97:  'SwitchExternalAHRS',
    99:  'AUTO RTL',
    100: 'KillIMU1',
    101: 'KillIMU2',
    102: 'Camera Lens',
    104: 'GPS Disable Yaw',
    105: 'Arm/Emergency Motor Stop',
    106: 'Camera Record',
    107: 'Camera Zoom',
    108: 'Camera Manual Focus',
    109: 'Camera Auto Focus',
    110: 'QSTABILIZE Mode',
    111: 'QHOVER Mode',
    112: 'QLOITER Mode',
    113: 'QLAND Mode',
    114: 'QRTL Mode',
    115: 'Generator',
    116: 'Non Auto Terrain Follow Disable',
    117: 'QAUTOTUNE Mode',
    118: 'Mount1 Pitch',
    119: 'Mount1 Roll',
    120: 'Mount1 Yaw',
    121: 'Mount2 Pitch',
    122: 'Mount2 Roll',
    123: 'Mount2 Yaw',
    124: 'Mount Lock',
    125: 'Mount LRF enable',
    126: 'AttCon Accel Limits',
    127: 'Optflow Calibration',
    128: 'Turbine Start(Heli)',
    129: 'FFT Tune',
    130: 'EKF Source Set',
    131: 'Arspd Calibrate',
    132: 'CIRCLE Mode',
    133: 'Parachute Enable',
    134: 'Parachute Release',
    135: 'Parachute 3pos',
    136: 'Auto Mission Reset',
    137: 'Retract Mount2',
    138: 'LOITER Mode',
    139: 'DRIFT Mode',
    140: 'FlightMode Pause',
    141: 'Camera Mode Toggle',
    142: 'Calibrate Compass',
    143: 'Battery MPPT Enable',
    144: 'Gripper Release',
    145: 'AttCon Feed Forward',
    146: 'VTX Power',
    147: 'BRAKE Mode',
    148: 'Parachute Enable',
    149: 'ZigZag Auto',
    150: 'SurfaceTracking Up/Down',
    151: 'Autotune Mode',
    152: 'Mount1 Pitch',
    153: 'KillIMU3',
    154: 'Camera Image Tracking',
    155: 'Transmitter Tuning',
    156: 'Simple Mode',
    157: 'Winch Control',
    158: 'Winch Enable',
    159: 'Force IS_Flying',
    160: 'Turbine Start(Heli)',
    162: 'TURTLE Mode',
    163: 'SIMPLE heading',
    164: 'ArmDisarm with Throttle',
    165: 'ACRO Mode',
    166: 'Pause Stream Logging',
    167: 'Arm/Emergency Motor Stop',
    168: 'Test autotune',
    169: 'FlightMode Pause',
    300: 'Scripting1',
    301: 'Scripting2',
    302: 'Scripting3',
    303: 'Scripting4',
    304: 'Scripting5',
    305: 'Scripting6',
    306: 'Scripting7',
    307: 'Scripting8',
    308: 'use Custom 0',
  };

  /* ─── Channel definitions ────────────────────────────────────────────────────
   * Each entry maps to a single RCx_OPTION MAVLink parameter.
   * `value` is the local working copy; `fcValue`/`defaultValue` track FC state.
   * ─────────────────────────────────────────────────────────────────────────── */
  const SWITCH_CHANNELS = [
    { name: 'RC5_OPTION',  label: 'RC 5',  sub: 'Aux 1', group: 'Aux Switches',  value: 0 },
    { name: 'RC6_OPTION',  label: 'RC 6',  sub: 'Aux 2', group: 'Aux Switches',  value: 0 },
    { name: 'RC7_OPTION',  label: 'RC 7',  sub: 'Aux 3', group: 'Aux Switches',  value: 0 },
    { name: 'RC8_OPTION',  label: 'RC 8',  sub: 'Aux 4', group: 'Aux Switches',  value: 0 },
    { name: 'RC9_OPTION',  label: 'RC 9',  sub: 'Aux 5', group: 'Extended Aux',  value: 0 },
    { name: 'RC10_OPTION', label: 'RC 10', sub: 'Aux 6', group: 'Extended Aux',  value: 0 },
    { name: 'RC11_OPTION', label: 'RC 11', sub: 'Aux 7', group: 'Extended Aux',  value: 0 },
    { name: 'RC12_OPTION', label: 'RC 12', sub: 'Aux 8', group: 'Extended Aux',  value: 0 },
  ];

  /* ─── Module state ───────────────────────────────────────────────────────── */
  // channelMap: name → { ...SWITCH_CHANNELS entry, fcValue: null, defaultValue: null }
  const channelMap = {};

  SWITCH_CHANNELS.forEach(ch => {
    channelMap[ch.name] = {
      ...ch,
      fcValue:      null,
      defaultValue: null,
    };
  });

  const state = {
    dirty:   new Set(),
    loading: false,
    wsReady: false,
  };

  /* ─── WebSocket ──────────────────────────────────────────────────────────── */
  const WS_URL = 'ws://127.0.0.1:9002';
  let ws = null;

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    console.info('[ParamSwitch] Connecting WebSocket →', WS_URL);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      state.wsReady = true;
      console.info('[ParamSwitch] WebSocket open');
      // ── FIX: Auto-fetch FC values on connect instead of waiting for user ──
      setStatusBanner('Connected — loading switch options…', 'info');
      readParamsFromFC();
    };

    ws.onclose = () => {
      state.wsReady = false;
      console.warn('[ParamSwitch] WebSocket closed — retrying in 3 s');
      setStatusBanner('Backend disconnected. Retrying…', 'warn');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error('[ParamSwitch] WebSocket error', err);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleBackendMessage(msg);
      } catch (e) {
        console.error('[ParamSwitch] Bad JSON from backend:', event.data, e);
      }
    };
  }

  function wsSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[ParamSwitch] WebSocket not ready — dropping:', obj);
      return false;
    }
    ws.send(JSON.stringify(obj));
    return true;
  }

  /* ─── Backend message dispatcher ────────────────────────────────────────── */
  function handleBackendMessage(msg) {
    switch (msg.type) {

      case 'param_value': {
        const name = msg.param_id;
        if (!name || !channelMap[name]) return;

        const rec = channelMap[name];

        if (rec.defaultValue === null) {
          rec.defaultValue = msg.value;
        }

        if (!state.dirty.has(name)) {
          rec.fcValue = msg.value;
          rec.value   = msg.value;
          updateChannelLive(name, msg.value, rec.defaultValue);
        }
        break;
      }

      case 'param_load_start':
        state.loading = true;
        setStatusBanner(msg.message || 'Loading parameters…', 'info');
        setProgressVisible(true, 0);
        break;

      case 'param_load_progress':
        setProgressVisible(true, msg.percent || 0, msg.received, msg.total);
        break;

      case 'param_load_complete':
        state.loading = false;
        setProgressVisible(false);
        setStatusBanner(msg.message || `${msg.count} parameters loaded`, 'success');
        rebuildGrid();
        break;

      case 'param_all':
        if (Array.isArray(msg.params)) {
          msg.params.forEach(p => {
            const rec = channelMap[p.param_id];
            if (rec) {
              if (rec.defaultValue === null) rec.defaultValue = p.default ?? p.value;
              if (!state.dirty.has(p.param_id)) {
                rec.fcValue = p.value;
                rec.value   = p.value;
              }
            }
          });
          rebuildGrid();
        }
        break;

      case 'param_set_sent':
        console.info(`[ParamSwitch] PARAM_SET sent for ${msg.param_id} = ${msg.value}`);
        break;

      case 'param_error':
        console.error('[ParamSwitch] Backend error:', msg.message);
        setStatusBanner('Error: ' + (msg.message || 'Unknown error'), 'error');
        break;

      default:
        break;
    }
  }

  /* ─── Live channel update (no full rebuild) ──────────────────────────────── */
  function updateChannelLive(name, fcValue, defaultValue) {
    const grid = document.getElementById('swGrid');
    if (!grid) return;

    const card = grid.querySelector(`.sw-channel[data-name="${name}"]`);
    if (!card) return;

    // Update default hint
    const hint = card.querySelector('.sw-default-hint span');
    if (hint && defaultValue !== null) {
      hint.textContent = optionLabel(defaultValue);
    }

    // Update select only if not dirty
    if (!state.dirty.has(name)) {
      const sel = card.querySelector('select[data-name]');
      if (sel) {
        const fcNum = Number(fcValue);
        for (const opt of sel.options) {
          if (Number(opt.value) === fcNum) {
            sel.value = opt.value;
            break;
          }
        }
      }
    }
  }

  /* ─── MAVLink helpers ────────────────────────────────────────────────────── */
  function readParamsFromFC() {
    if (!state.wsReady) {
      setStatusBanner('WebSocket not connected. Cannot read parameters.', 'error');
      return;
    }
    wsSend({ type: 'param_request_list' });
    console.info('[ParamSwitch] → param_request_list');

    state.dirty.clear();
    rebuildGrid();
  }

  function writeParamsToFC(dirtyChannels) {
    if (!dirtyChannels.length) {
      setStatusBanner('No modified channels to write.', 'info');
      return;
    }
    if (!state.wsReady) {
      setStatusBanner('WebSocket not connected. Cannot write parameters.', 'error');
      return;
    }

    dirtyChannels.forEach(ch => {
      wsSend({
        type:     'param_set',
        param_id: ch.name,
        value:    Number(ch.value),
      });
      console.info(`[ParamSwitch] → param_set ${ch.name} = ${ch.value}`);
    });

    state.dirty.clear();
    rebuildGrid();
    setStatusBanner(`${dirtyChannels.length} channel(s) sent to FC`, 'success');
  }

  /* ─── Render helpers ─────────────────────────────────────────────────────── */
  function optionLabel(value) {
    return SWITCH_OPTIONS[Number(value)] || `Unknown (${value})`;
  }

  function renderSelect(ch) {
    const isDirty  = state.dirty.has(ch.name);
    const current  = Number(ch.value);
    const opts = Object.entries(SWITCH_OPTIONS)
      .sort(([, a], [, b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([k, v]) =>
        `<option value="${k}"${Number(k) === current ? ' selected' : ''}>${v}</option>`
      )
      .join('');
    return `<select class="sw-select${isDirty ? ' dirty' : ''}" data-name="${ch.name}">${opts}</select>`;
  }

  /* ─── Grid rebuild ───────────────────────────────────────────────────────── */
  function rebuildGrid() {
    const grid = document.getElementById('swGrid');
    if (!grid) return;

    const frag      = document.createDocumentFragment();
    let lastGroup   = '';

    Object.values(channelMap).forEach(ch => {
      // Section divider
      if (ch.group !== lastGroup) {
        const sec = document.createElement('div');
        sec.className   = 'sw-section-label';
        sec.textContent = ch.group;
        frag.appendChild(sec);
        lastGroup = ch.group;
      }

      const isDirty    = state.dirty.has(ch.name);
      const defaultVal = ch.defaultValue !== null ? ch.defaultValue : ch.value;

      const div = document.createElement('div');
      div.className    = 'sw-channel' + (isDirty ? ' dirty' : '');
      div.dataset.name = ch.name;

      div.innerHTML = `
        <div class="sw-channel-top">
          <div class="sw-ch-badge">${ch.label}</div>
          <div class="sw-ch-info">
            <div class="sw-ch-name">${ch.name}</div>
            <div class="sw-ch-sub">${ch.sub}</div>
          </div>
          <span class="sw-dot"></span>
        </div>
        ${renderSelect(ch)}
        <div class="sw-default-hint">FC default: <span>${optionLabel(defaultVal)}</span></div>`;

      frag.appendChild(div);
    });

    grid.innerHTML = '';
    grid.appendChild(frag);

    updateStats();
    updateWriteBtn();
  }

  /* ─── Shell HTML ─────────────────────────────────────────────────────────── */
  function renderShell() {
    return `
<div class="sw-card">

  <div class="sw-header">
    <div class="sw-header-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        <line x1="12" y1="12" x2="12" y2="16"/>
        <line x1="10" y1="14" x2="14" y2="14"/>
      </svg>
    </div>
    <div class="sw-header-text">
      <h4>RC Switch Options</h4>
      <p>Assign functions to RC channels 5–12. Changes apply on Write to FC.</p>
    </div>
    <div class="sw-header-stats">
      <div class="sw-stat">
        <span class="sw-stat-val" id="swStatTotal">0</span>
        <span class="sw-stat-label">Channels</span>
      </div>
      <div class="sw-stat">
        <span class="sw-stat-val accent" id="swStatDirty">0</span>
        <span class="sw-stat-label">Modified</span>
      </div>
    </div>
  </div>

  <!-- Progress bar (shown during PARAM_REQUEST_LIST stream) -->
  <div id="swProgressBar" style="display:none; padding:0 18px 8px; background:rgba(0,0,0,0.2);">
    <div style="height:3px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
      <div id="swProgressFill" style="height:100%; width:0%; background:#e6007e; transition:width 0.3s;"></div>
    </div>
    <div id="swProgressLabel" style="font-size:10px; color:rgba(238,240,248,0.4); margin-top:4px; text-align:right;"></div>
  </div>

  <div class="sw-grid" id="swGrid"></div>

  <div class="sw-footer">
    <button class="sw-btn sw-btn-primary" id="swWriteBtn">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      Write to FC
    </button>
    <button class="sw-btn sw-btn-secondary" id="swReadBtn">Read from FC</button>
    <button class="sw-btn sw-btn-danger"    id="swResetBtn">Reset Defaults</button>
    <span class="sw-footer-info" id="swFooterInfo">Not connected</span>
  </div>

</div>`;
  }

  /* ─── UI helpers ─────────────────────────────────────────────────────────── */
  function updateStats() {
    const totalEl = document.getElementById('swStatTotal');
    const dirtyEl = document.getElementById('swStatDirty');
    if (totalEl) totalEl.textContent = Object.keys(channelMap).length;
    if (dirtyEl) dirtyEl.textContent = state.dirty.size;
  }

  function updateWriteBtn() {
    const btn = document.getElementById('swWriteBtn');
    if (!btn) return;
    const n     = state.dirty.size;
    let badge   = btn.querySelector('.sw-dirty-count');
    if (n > 0) {
      if (!badge) {
        badge           = document.createElement('span');
        badge.className = 'sw-dirty-count';
        btn.appendChild(badge);
      }
      badge.textContent = n;
    } else if (badge) {
      badge.remove();
    }
  }

  function setProgressVisible(visible, percent = 0, received = 0, total = 0) {
    const bar   = document.getElementById('swProgressBar');
    const fill  = document.getElementById('swProgressFill');
    const label = document.getElementById('swProgressLabel');
    if (!bar) return;
    bar.style.display = visible ? 'block' : 'none';
    if (fill)  fill.style.width   = percent + '%';
    if (label) label.textContent  = visible
      ? `Loading… ${received}/${total} (${percent}%)`
      : '';
  }

  function setStatusBanner(msg, level = 'info') {
    const el = document.getElementById('swFooterInfo');
    if (!el) return;
    const strong = document.createElement('strong');
    strong.textContent = msg;
    el.innerHTML = '';
    el.appendChild(strong);
    el.style.color = level === 'error'   ? '#ff6464'
                   : level === 'success' ? '#00c96e'
                   : level === 'warn'    ? '#f0a030'
                   : '';
  }

  /* ─── Change handler (delegated to grid) ─────────────────────────────────── */
  function onChannelChange(e) {
    const sel  = e.target;
    const name = sel.dataset.name;
    if (!name) return;

    const rec = channelMap[name];
    if (!rec) return;

    const newVal  = Number(sel.value);
    rec.value     = newVal;

    const baseline = rec.fcValue !== null
      ? Number(rec.fcValue)
      : (rec.defaultValue !== null ? Number(rec.defaultValue) : null);

    const isDirty = (baseline === null) || (newVal !== baseline);

    if (isDirty) state.dirty.add(name);
    else         state.dirty.delete(name);

    // Update card styling in-place (no full rebuild)
    const card = document.querySelector(`#swGrid .sw-channel[data-name="${name}"]`);
    if (card) {
      card.classList.toggle('dirty', isDirty);
      sel.classList.toggle('dirty', isDirty);
    }

    updateStats();
    updateWriteBtn();
  }

  /* ─── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    const host = document.getElementById('panel-param-switch');
    if (!host) return;

    host.innerHTML = renderShell();
    rebuildGrid();

    // Delegated change handler on grid
    document.getElementById('swGrid')?.addEventListener('change', onChannelChange);

    // Write button
    document.getElementById('swWriteBtn')?.addEventListener('click', () => {
      const dirty = Object.values(channelMap).filter(ch => state.dirty.has(ch.name));
      writeParamsToFC(dirty);
    });

    // Read button
    document.getElementById('swReadBtn')?.addEventListener('click', readParamsFromFC);

    // Reset button
    document.getElementById('swResetBtn')?.addEventListener('click', () => {
      if (!confirm('Reset all RC switch options to their FC defaults?')) return;

      Object.values(channelMap).forEach(rec => {
        if (rec.defaultValue !== null) rec.value = rec.defaultValue;
      });
      state.dirty.clear();
      rebuildGrid();
      setStatusBanner('Switch options reset to FC defaults (not yet written to FC)', 'info');
    });

    // ── FIX: Connect WebSocket, and if it's already open from a previous
    //         visit to this panel, immediately fetch the current FC values
    //         so dropdowns are never stuck showing "Do Nothing".
    connectWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      readParamsFromFC();
    }

    console.log('✅ ParamSwitch module ready (MAVLink WebSocket bridge)');
  }

  /* ─── Public API ─────────────────────────────────────────────────────────── */
  window.ParamSwitch = { init };

})();