/**
 * pid-tuning.js — TiHANFly GCS
 * PID Tuning Panel — QGroundControl-style dense parameter grid.
 *
 * Layout mirrors Mission Planner / QGC Extended Tuning:
 *   Row 1 : Stabilize Roll | Stabilize Pitch | Stabilize Yaw | Position XY
 *   [Lock Pitch and Roll Values]
 *   Row 2 : Rate Roll | Rate Pitch | Rate Yaw | [Velocity XY + Basic Filters]
 *   Row 3 : Throttle Accel | Throttle Rate | Altitude Hold | WPNav
 *   Row 4 : Filter Logs | (gap) | RC Options already inside AltHold box
 *   Row 5 : Static Notch Filter | Harmonic Notch Filter
 *   [Write Params]  [Refresh Screen]
 *
 * WebSocket protocol:
 *   send:    { type: "param_set",   param_id: "<NAME>", value: <float> }
 *   send:    { type: "param_fetch", param_id: "<NAME>" }
 *   receive: { type: "param_value", param_id: "<NAME>", value: <float> }
 */

(function () {
    'use strict';

    // ── Default values (ArduPilot Copter 4.x) ──────────────────────────────
    const DEF = {
        ATC_ANG_RLL_P   : 4.500, ATC_ACCEL_R_MAX  : 110000,
        ATC_ANG_PIT_P   : 4.500, ATC_ACCEL_P_MAX  : 110000,
        ATC_ANG_YAW_P   : 4.500, ATC_ACCEL_Y_MAX  : 27000,
        PSC_POSXY_P     : 1.000, PSC_JERK_XY      : 0.000,

        ATC_RAT_RLL_P   : 0.135, ATC_RAT_RLL_I    : 0.135,
        ATC_RAT_RLL_D   : 0.0036,ATC_RAT_RLL_IMAX : 0.500,
        ATC_RAT_RLL_FLTE: 0.000, ATC_RAT_RLL_FLTD : 20.000,
        ATC_RAT_RLL_FLTT: 20.000,

        ATC_RAT_PIT_P   : 0.135, ATC_RAT_PIT_I    : 0.135,
        ATC_RAT_PIT_D   : 0.0036,ATC_RAT_PIT_IMAX : 0.500,
        ATC_RAT_PIT_FLTE: 0.000, ATC_RAT_PIT_FLTD : 20.000,
        ATC_RAT_PIT_FLTT: 20.000,

        ATC_RAT_YAW_P   : 0.180, ATC_RAT_YAW_I    : 0.018,
        ATC_RAT_YAW_D   : 0.000, ATC_RAT_YAW_IMAX : 0.500,
        ATC_RAT_YAW_FLTE: 2.500, ATC_RAT_YAW_FLTD : 2.500,
        ATC_RAT_YAW_FLTT: 2.500,

        PSC_VELXY_P     : 2.000, PSC_VELXY_I      : 1.000,
        PSC_VELXY_D     : 0.500, PSC_VELXY_IMAX   : 1000,
        INS_GYRO_FILTER : 20,    INS_ACCEL_FILTER : 20,

        PSC_ACCZ_P      : 0.500, PSC_ACCZ_I       : 1.000,
        PSC_ACCZ_D      : 0.000, PSC_ACCZ_IMAX    : 800,

        PSC_VELZ_P      : 5.000,
        TUNE            : 0,
        TUNE_MIN        : 0.000, TUNE_MAX         : 0.000,

        PSC_POSZ_P      : 1.000,
        RC6_OPTION      : 0, RC7_OPTION: 0, RC8_OPTION: 0,
        RC9_OPTION      : 0, RC10_OPTION: 0,

        WPNAV_SPEED     : 500,   WPNAV_RADIUS     : 200,
        WPNAV_SPEED_UP  : 250,   WPNAV_SPEED_DN   : 150,
        LOIT_SPEED      : 500,

        LOG_BITMASK     : 65535, LOG_FILE_DSRMTH  : 0,

        INS_NOTCH_ENABLE: 0,     INS_NOTCH_FREQ   : 80,
        INS_NOTCH_BW    : 20,    INS_NOTCH_ATT    : 40,

        INS_HNTCH_ENABLE: 0,     INS_HNTCH_MODE   : 1,
        INS_HNTCH_REF   : 0.250, INS_HNTCH_FREQ   : 80,
        INS_HNTCH_ATT   : 40,    INS_HNTCH_BW     : 40,
        INS_HNTCH_OPTS  : 0,     INS_HNTCH_HMNCS  : 3,
    };

    // ── State ───────────────────────────────────────────────────────────────
    let initialised = false;
    let wsListener  = null;
    const valueCache = {};

    // ── All param IDs tracked (for bulk read/write) ─────────────────────────
    const ALL_PARAMS = Object.keys(DEF);

    // ── WebSocket helper ────────────────────────────────────────────────────
    function send(obj) {
        if (typeof window.safeSend !== 'function') return;
        
        const activeSysid = window.selectedSysId;
        
        // If writing parameters and "All Drones" is selected, broadcast to all
        if (obj.type === 'param_set' && activeSysid === 0 && window.activeSysids && window.activeSysids.length > 0) {
            window.activeSysids.forEach(sysid => {
                window.safeSend({ ...obj, sysid });
            });
            return;
        }

        // Otherwise (or if fetching), target the specific drone
        const targetSysid = (activeSysid && activeSysid > 0) ? activeSysid : 1;
        window.safeSend({ ...obj, sysid: targetSysid });
    }

    // ── Status helpers ──────────────────────────────────────────────────────
    function setStatus(state, text) {
        const dot = document.getElementById('pid-status-dot');
        const msg = document.getElementById('pid-status-msg');
        if (!dot || !msg) return;
        dot.className   = `pid-status-dot pid-dot-${state}`;
        msg.textContent = text;
    }

    // ── Helper: get current value of a param (cache → DEF) ─────────────────
    function val(id) {
        return valueCache[id] !== undefined ? valueCache[id] : DEF[id];
    }

    // ── Helper: render a numeric input row ──────────────────────────────────
    function row(label, id, step = 0.001) {
        return `
        <div class="pid-param-row">
            <span class="pid-param-label">${label}</span>
            <input class="pid-param-input"
                   type="number"
                   id="pid-inp-${id}"
                   data-param="${id}"
                   value="${val(id)}"
                   step="${step}"
                   placeholder="${DEF[id] !== undefined ? DEF[id] : ''}">
        </div>`;
    }

    // ── Helper: render a select row ──────────────────────────────────────────
    function rowSelect(label, id, options) {
        const cur = val(id);
        const opts = options.map(([v, t]) =>
            `<option value="${v}" ${parseFloat(cur) === v ? 'selected' : ''}>${t}</option>`
        ).join('');
        return `
        <div class="pid-param-row">
            <span class="pid-param-label">${label}</span>
            <select class="pid-param-select" id="pid-inp-${id}" data-param="${id}">
                ${opts}
            </select>
        </div>`;
    }

    // ── Build panel HTML ─────────────────────────────────────────────────────
    function buildPanelHTML() {
        return `
<div class="settings-panel-title" style="display:flex; justify-content:space-between; align-items:center;">
  <span>PID Tuning</span>
  <div class="drone-selector-wrap-container"></div>
</div>

<!-- Status strip -->
<div class="pid-status-strip">
  <div class="pid-status-dot pid-dot-idle" id="pid-status-dot"></div>
  <div class="pid-status-text" id="pid-status-msg">Click "Refresh Screen" to read current values from the flight controller.</div>
</div>

<div class="pid-wrap">

  <!-- ── ROW 1: Stabilize controllers ─────────────────────────────────────── -->
  <div class="pid-row-groups">

    <div class="pid-group">
      <span class="pid-group-title">Stabilize Roll (Error to Rate)</span>
      ${row('P',        'ATC_ANG_RLL_P',  0.1)}
      ${row('ACCEL MA', 'ATC_ACCEL_R_MAX', 1000)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Stabilize Pitch (Error to Rate)</span>
      ${row('P',        'ATC_ANG_PIT_P',  0.1)}
      ${row('ACCEL MA', 'ATC_ACCEL_P_MAX', 1000)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Stabilize Yaw (Error to Rate)</span>
      ${row('P',        'ATC_ANG_YAW_P',  0.1)}
      ${row('ACCEL MA', 'ATC_ACCEL_Y_MAX', 1000)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Position XY (Dist to Speed)</span>
      ${row('P',        'PSC_POSXY_P',  0.1)}
      ${row('INPUT TC', 'PSC_JERK_XY', 0.01)}
    </div>

  </div><!-- /row 1 -->

  <!-- ── Lock checkbox ─────────────────────────────────────────────────────── -->
  <label class="pid-lock-row" id="pid-lock-label">
    <input type="checkbox" class="pid-lock-checkbox" id="pid-lock-checkbox">
    <span class="pid-lock-label">Lock Pitch and Roll Values</span>
  </label>

  <!-- ── ROW 2: Rate controllers ───────────────────────────────────────────── -->
  <div class="pid-row-groups">

    <div class="pid-group">
      <span class="pid-group-title">Rate Roll</span>
      ${row('P',    'ATC_RAT_RLL_P',    0.001)}
      ${row('I',    'ATC_RAT_RLL_I',    0.001)}
      ${row('D',    'ATC_RAT_RLL_D',    0.0001)}
      ${row('IMAX', 'ATC_RAT_RLL_IMAX', 0.01)}
      ${row('FLTE', 'ATC_RAT_RLL_FLTE', 0.5)}
      ${row('FLTD', 'ATC_RAT_RLL_FLTD', 0.5)}
      ${row('FLTT', 'ATC_RAT_RLL_FLTT', 0.5)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Rate Pitch</span>
      ${row('P',    'ATC_RAT_PIT_P',    0.001)}
      ${row('I',    'ATC_RAT_PIT_I',    0.001)}
      ${row('D',    'ATC_RAT_PIT_D',    0.0001)}
      ${row('IMAX', 'ATC_RAT_PIT_IMAX', 0.01)}
      ${row('FLTE', 'ATC_RAT_PIT_FLTE', 0.5)}
      ${row('FLTD', 'ATC_RAT_PIT_FLTD', 0.5)}
      ${row('FLTT', 'ATC_RAT_PIT_FLTT', 0.5)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Rate Yaw</span>
      ${row('P',    'ATC_RAT_YAW_P',    0.001)}
      ${row('I',    'ATC_RAT_YAW_I',    0.001)}
      ${row('D',    'ATC_RAT_YAW_D',    0.0001)}
      ${row('IMAX', 'ATC_RAT_YAW_IMAX', 0.01)}
      ${row('FLTE', 'ATC_RAT_YAW_FLTE', 0.5)}
      ${row('FLTD', 'ATC_RAT_YAW_FLTD', 0.5)}
      ${row('FLTT', 'ATC_RAT_YAW_FLTT', 0.5)}
    </div>

    <!-- Velocity XY + Basic Filters stacked -->
    <div class="pid-col-stack">
      <div class="pid-group">
        <span class="pid-group-title">Velocity XY (Vel to Accel)</span>
        ${row('P',    'PSC_VELXY_P',    0.1)}
        ${row('I',    'PSC_VELXY_I',    0.1)}
        ${row('D',    'PSC_VELXY_D',    0.01)}
        ${row('IMAX', 'PSC_VELXY_IMAX', 10)}
      </div>
      <div class="pid-group">
        <span class="pid-group-title">Basic Filters</span>
        ${row('Gyro',  'INS_GYRO_FILTER', 1)}
        ${row('Accel', 'INS_ACCEL_FILTER', 1)}
      </div>
    </div>

  </div><!-- /row 2 -->

  <!-- ── ROW 3: Throttle / Altitude / WPNav ────────────────────────────────── -->
  <div class="pid-row-groups">

    <div class="pid-group">
      <span class="pid-group-title">Throttle Accel (Accel to motor)</span>
      ${row('P',    'PSC_ACCZ_P',    0.01)}
      ${row('I',    'PSC_ACCZ_I',    0.01)}
      ${row('D',    'PSC_ACCZ_D',    0.001)}
      ${row('IMAX', 'PSC_ACCZ_IMAX', 10)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Throttle Rate (VSpd to accel)</span>
      ${row('P',   'PSC_VELZ_P', 0.1)}
      ${rowSelect('Tune', 'TUNE', [
        [0,'None'],[1,'CH6 Opt'],[4,'Rate Roll/Pitch kP'],[5,'Rate Roll/Pitch kI'],
        [21,'Rate Roll/Pitch kD'],[12,'Rate Yaw kP'],[22,'Rate Yaw kD'],
        [26,'Rate Roll kP'],[27,'Rate Roll kI'],[28,'Rate Roll kD'],
        [29,'Rate Pitch kP'],[30,'Rate Pitch kI'],[31,'Rate Pitch kD'],
      ])}
      ${row('Min', 'TUNE_MIN', 0.001)}
      ${row('Max', 'TUNE_MAX', 0.001)}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">Altitude Hold (Alt to climbrate)</span>
      ${row('P', 'PSC_POSZ_P', 0.1)}
      <hr class="pid-group-sep">
      ${rowSelect('RC6 Opt', 'RC6_OPTION', [[0,'Do Nothing'],[2,'Flip'],[3,'Simple'],[4,'RTL'],[9,'Camera Trig'],[16,'Auto'],[40,'Proximity Avoidance']])}
      ${rowSelect('RC7 Opt', 'RC7_OPTION', [[0,'Do Nothing'],[2,'Flip'],[3,'Simple'],[4,'RTL'],[9,'Camera Trig'],[16,'Auto'],[40,'Proximity Avoidance']])}
      ${rowSelect('RC8 Opt', 'RC8_OPTION', [[0,'Do Nothing'],[2,'Flip'],[3,'Simple'],[4,'RTL'],[9,'Camera Trig'],[16,'Auto'],[40,'Proximity Avoidance']])}
      ${rowSelect('RC9 Opt', 'RC9_OPTION', [[0,'Do Nothing'],[2,'Flip'],[3,'Simple'],[4,'RTL'],[9,'Camera Trig'],[16,'Auto'],[40,'Proximity Avoidance']])}
      ${rowSelect('RC10 Opt','RC10_OPTION',[[0,'Do Nothing'],[2,'Flip'],[3,'Simple'],[4,'RTL'],[9,'Camera Trig'],[16,'Auto'],[40,'Proximity Avoidance']])}
    </div>

    <div class="pid-group">
      <span class="pid-group-title">WPNav (cm/s)</span>
      ${row('Speed',        'WPNAV_SPEED',    10)}
      ${row('Radius',       'WPNAV_RADIUS',   10)}
      ${row('Speed Up',     'WPNAV_SPEED_UP', 10)}
      ${row('Speed Dn',     'WPNAV_SPEED_DN', 10)}
      ${row('Loiter Speed', 'LOIT_SPEED',     10)}
    </div>

  </div><!-- /row 3 -->

  <!-- ── ROW 4: Filter Logs ────────────────────────────────────────────────── -->
  <div class="pid-row-groups">

    <div class="pid-group" style="max-width:280px;">
      <span class="pid-group-title">Filter Logs</span>
      ${rowSelect('Mask', 'LOG_BITMASK', [
        [65535,'All'],[0,'None'],[830,'Default'],[131071,'All+Disarmed'],
      ])}
      ${row('Options', 'LOG_FILE_DSRMTH', 1)}
    </div>

  </div><!-- /row 4 -->

  <!-- ── ROW 5: Notch Filters ──────────────────────────────────────────────── -->
  <div class="pid-row-groups">

    <div class="pid-group">
      <span class="pid-group-title">Static Notch Filter</span>
      ${rowSelect('Enabled',     'INS_NOTCH_ENABLE', [[0,'Disabled'],[1,'Enabled']])}
      ${row('Frequency',  'INS_NOTCH_FREQ', 1)}
      ${row('BandWidth',  'INS_NOTCH_BW',   1)}
      ${row('Attenuation','INS_NOTCH_ATT',  1)}
    </div>

    <div class="pid-group pid-group-wide">
      <span class="pid-group-title">Harmonic Notch Filter</span>
      <div class="pid-params-2col">
        <div>
          ${rowSelect('Enabled',   'INS_HNTCH_ENABLE', [[0,'Disabled'],[1,'Enabled']])}
          ${rowSelect('Mode',      'INS_HNTCH_MODE',   [[0,'Fixed'],[1,'Throttle'],[2,'RPM Sensor'],[3,'ESC Telemetry'],[4,'Dynamic FFT']])}
          ${row('Reference', 'INS_HNTCH_REF',  0.01)}
          ${row('Frequency', 'INS_HNTCH_FREQ', 1)}
        </div>
        <div>
          ${row('Attenuation', 'INS_HNTCH_ATT',   1)}
          ${row('Bandwidth',   'INS_HNTCH_BW',    1)}
          ${row('Options',     'INS_HNTCH_OPTS',  1)}
          ${row('Harmonics',   'INS_HNTCH_HMNCS', 1)}
        </div>
      </div>
    </div>

  </div><!-- /row 5 -->

  <!-- ── Action buttons ────────────────────────────────────────────────────── -->
  <div class="pid-btn-row">
    <button class="pid-write-btn" id="pid-write-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
      </svg>
      Write Params
    </button>
    <button class="pid-refresh-btn" id="pid-refresh-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
      Refresh Screen
    </button>
  </div>

</div><!-- /pid-wrap -->`;
    }

    // ── Lock Pitch/Roll mirroring ────────────────────────────────────────────
    function wireLock() {
        const ROLL_IDS  = ['ATC_RAT_RLL_P','ATC_RAT_RLL_I','ATC_RAT_RLL_D',
                           'ATC_RAT_RLL_IMAX','ATC_RAT_RLL_FLTE','ATC_RAT_RLL_FLTD','ATC_RAT_RLL_FLTT'];
        const PITCH_IDS = ['ATC_RAT_PIT_P','ATC_RAT_PIT_I','ATC_RAT_PIT_D',
                           'ATC_RAT_PIT_IMAX','ATC_RAT_PIT_FLTE','ATC_RAT_PIT_FLTD','ATC_RAT_PIT_FLTT'];

        const lockBox = document.getElementById('pid-lock-checkbox');
        if (!lockBox) return;

        function mirrorToPitch() {
            if (!lockBox.checked) return;
            ROLL_IDS.forEach((rid, i) => {
                const rEl = document.getElementById('pid-inp-' + rid);
                const pEl = document.getElementById('pid-inp-' + PITCH_IDS[i]);
                if (rEl && pEl) pEl.value = rEl.value;
            });
        }

        ROLL_IDS.forEach(rid => {
            document.getElementById('pid-inp-' + rid)
                ?.addEventListener('input', mirrorToPitch);
        });
    }

    // ── Wire action buttons ──────────────────────────────────────────────────
    function wireActions() {
        // Refresh / Read all params from FC
        document.getElementById('pid-refresh-btn')?.addEventListener('click', () => {
            setStatus('running', `Reading ${ALL_PARAMS.length} parameters from drone…`);
            // Use param_request_one (supported by backend); stagger 80ms apart to avoid flooding
            ALL_PARAMS.forEach((id, i) => {
                setTimeout(() => send({ type: 'param_request_one', name: id }), i * 80);
            });
            setTimeout(() => {
                setStatus('idle', 'Read requests sent. Waiting for drone response…');
            }, ALL_PARAMS.length * 80 + 200);
        });

        // Write all visible params to FC
        document.getElementById('pid-write-btn')?.addEventListener('click', () => {
            const updates = [];
            document.querySelectorAll('[data-param]').forEach(el => {
                const id  = el.dataset.param;
                const val = el.tagName === 'SELECT'
                    ? parseFloat(el.value)
                    : parseFloat(el.value);
                if (!isNaN(val)) updates.push({ id, value: val });
            });

            if (!updates.length) return;
            setStatus('running', `Writing ${updates.length} parameters to drone…`);

            updates.forEach((u, i) => {
                setTimeout(() => {
                    send({ type: 'param_set', param_id: u.id, value: u.value });
                    console.log(`[PIDTuning] Write ${u.id} = ${u.value}`);
                }, i * 100);
            });

            setTimeout(() => {
                setStatus('ok', `✓ ${updates.length} parameters written successfully.`);
                window.SwUtil?.toast?.(`PID Tuning: ${updates.length} parameters written.`);
            }, updates.length * 100 + 500);
        });
    }

    // ── Wire WebSocket listener for incoming param values ────────────────────
    function wireWS() {
        wsListener = function (evt) {
            const msg = evt.detail;
            if (!msg) return;

            if (msg.type === 'param_value' || msg.type === 'parameter') {
                const id  = (msg.param_id || msg.name || '').toUpperCase();
                const v   = parseFloat(msg.value ?? msg.param_value ?? NaN);
                if (isNaN(v)) return;

                valueCache[id] = v;
                const el = document.getElementById('pid-inp-' + id);
                if (el) {
                    el.value = v;
                    el.style.color = 'var(--good)';
                    setTimeout(() => { el.style.color = ''; }, 900);
                }
            }

            if (msg.type === 'param_error') {
                setStatus('error', `✕ ${msg.message || 'Parameter error'}`);
            }
        };
        window.addEventListener('calibration_ws_message', wsListener);
    }

    // ── Public API ───────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-pid-tuning');
        if (!host) {
            console.error('[PIDTuning] Host element #panel-pid-tuning not found');
            return;
        }

        host.innerHTML = buildPanelHTML();
        wireLock();
        wireActions();
        wireWS();
        console.log('✅ PIDTuning panel initialised');
    }

    window.PIDTuning = { init };
    console.log('✅ PIDTuning module loaded');

})();
