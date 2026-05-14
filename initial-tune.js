/**
 * initial-tune.js — TiHANFly GCS
 * Initial Tune Parameters Panel
 *
 * Calculates and writes ArduPilot tuning parameters based on:
 *   - Airscrew (propeller) size in inches
 *   - Battery cell count
 *   - Battery chemistry (LiPo / LiHV / LiFe / NiMH)
 *   - Battery cell fully-charged voltage
 *   - Battery cell fully-discharged voltage
 *   - Optional: T-Motor Flame ESC flag
 *   - Optional: ArduPilot 4.0+ battery failsafe settings
 *
 * Parameters written (mirroring QGC Initial Tune behaviour):
 *   MOT_BAT_VOLT_MAX   — cells × charged voltage
 *   MOT_BAT_VOLT_MIN   — cells × discharged voltage
 *   BATT_ARM_VOLT      — cells × (discharged + 0.2)
 *   INS_GYRO_FILTER    — 10 Hz (large props) … 20 Hz (small props)
 *   ATC_RAT_RLL_FILT   — same as INS_GYRO_FILTER
 *   ATC_RAT_PIT_FILT   — same as INS_GYRO_FILTER
 *
 * WebSocket protocol (shared with frame-type / failsafe panels):
 *   send:    { type: "param_set", param_id: "<NAME>", value: <float> }
 *   receive: { type: "param_value", param_id: "<NAME>", value: <float> }
 */

(function () {
    'use strict';

    // ── Chemistry defaults ─────────────────────────────────────────────────────
    const CHEMISTRY = {
        LiPo:  { charged: 4.20, discharged: 3.50, label: 'LiPo'  },
        LiHV:  { charged: 4.35, discharged: 3.50, label: 'LiHV'  },
        LiFe:  { charged: 3.60, discharged: 3.00, label: 'LiFe'  },
        NiMH:  { charged: 1.45, discharged: 1.10, label: 'NiMH'  },
    };

    // Gyro filter vs prop size (QGC matching logic)
    function calcGyroFilter(propInch) {
        if (propInch <= 5)  return 100;
        if (propInch <= 7)  return  80;
        if (propInch <= 9)  return  60;
        if (propInch <= 11) return  40;
        if (propInch <= 14) return  30;
        if (propInch <= 18) return  25;
        return 20;  // large props / heavy lifter
    }

    // ── State ──────────────────────────────────────────────────────────────────
    let initialised = false;
    let wsListener  = null;

    // ── WebSocket helper ───────────────────────────────────────────────────────
    function send(obj) {
        if (typeof window.safeSend === 'function') window.safeSend(obj);
    }

    // ── Status helpers ─────────────────────────────────────────────────────────
    function setStatus(state, text) {
        const dot = document.getElementById('it-status-dot');
        const msg = document.getElementById('it-status-msg');
        if (!dot || !msg) return;
        dot.className   = `it-status-dot it-dot-${state}`;
        msg.textContent = text;
    }

    // ── Build the calculated parameter table ───────────────────────────────────
    function calculateParams() {
        const propInch    = parseFloat(document.getElementById('it-prop-size')?.value)    || 10;
        const cellCount   = parseInt(document.getElementById('it-cell-count')?.value, 10) || 4;
        const chemKey     = document.getElementById('it-chemistry')?.value                || 'LiPo';
        const rawCharged  = parseFloat(document.getElementById('it-cell-charged')?.value) ;
        const rawDisch    = parseFloat(document.getElementById('it-cell-discharged')?.value);
        const tMotor      = document.getElementById('it-tmotor-esc')?.checked             || false;
        const ap4plus     = document.getElementById('it-ap4-settings')?.checked           || false;

        const chem     = CHEMISTRY[chemKey] || CHEMISTRY.LiPo;
        const charged  = isNaN(rawCharged) ? chem.charged  : rawCharged;
        const disch    = isNaN(rawDisch)   ? chem.discharged : rawDisch;

        const voltMax  = parseFloat((cellCount * charged).toFixed(2));
        const voltMin  = parseFloat((cellCount * disch).toFixed(2));
        const armVolt  = parseFloat((cellCount * (disch + 0.2)).toFixed(2));
        const gyroFilt = calcGyroFilter(propInch);

        // Build param list
        const params = [
            { id: 'MOT_BAT_VOLT_MAX', value: voltMax,  desc: `${cellCount}S × ${charged}V charged`       },
            { id: 'MOT_BAT_VOLT_MIN', value: voltMin,  desc: `${cellCount}S × ${disch}V discharged`      },
            { id: 'BATT_ARM_VOLT',    value: armVolt,  desc: `${cellCount}S × (${disch}+0.2)V arm floor` },
            { id: 'INS_GYRO_FILTER',  value: gyroFilt, desc: `Prop size ${propInch}″`                    },
            { id: 'ATC_RAT_RLL_FILT', value: gyroFilt, desc: 'Matches INS_GYRO_FILTER'                   },
            { id: 'ATC_RAT_PIT_FILT', value: gyroFilt, desc: 'Matches INS_GYRO_FILTER'                   },
        ];

        if (tMotor) {
            params.push(
                { id: 'MOT_PWM_MIN',   value: 1000, desc: 'T-Motor Flame ESC min' },
                { id: 'MOT_PWM_MAX',   value: 2000, desc: 'T-Motor Flame ESC max' },
            );
        }

        if (ap4plus) {
            const warnVolt  = parseFloat((cellCount * (disch + 0.5)).toFixed(2));
            const failVolt  = parseFloat((cellCount * (disch + 0.1)).toFixed(2));
            params.push(
                { id: 'BATT_LOW_VOLT',    value: warnVolt, desc: 'Low batt warning (4.0+)'   },
                { id: 'BATT_CRT_VOLT',    value: failVolt, desc: 'Critical batt (4.0+)'       },
                { id: 'BATT_FS_LOW_ACT',  value: 2,        desc: 'Low batt → RTL (4.0+)'      },
                { id: 'BATT_FS_CRT_ACT',  value: 1,        desc: 'Critical batt → Land (4.0+)' },
                { id: 'FENCE_ENABLE',     value: 1,        desc: 'Enable fence (4.0+)'         },
            );
        }

        return params;
    }

    // ── Render preview table ───────────────────────────────────────────────────
    function renderPreview() {
        const params = calculateParams();
        const tbody  = document.getElementById('it-preview-tbody');
        if (!tbody) return;

        tbody.innerHTML = params.map(p => `
            <tr>
                <td class="it-param-id">${p.id}</td>
                <td class="it-param-val">${p.value}</td>
                <td class="it-param-desc">${p.desc}</td>
            </tr>
        `).join('');

        // Re-enable the write button now that we have a preview
        const writeBtn = document.getElementById('it-write-btn');
        if (writeBtn) writeBtn.disabled = false;

        setStatus('idle', `${params.length} parameters ready. Click "Write to Drone" to apply.`);
    }

    // ── Write all calculated params to FC via WebSocket ───────────────────────
    function writeParams() {
        const params = calculateParams();
        if (!params.length) return;

        setStatus('running', `Writing ${params.length} parameters…`);
        const writeBtn = document.getElementById('it-write-btn');
        if (writeBtn) writeBtn.disabled = true;

        params.forEach((p, i) => {
            setTimeout(() => {
                send({ type: 'param_set', param_id: p.id, value: p.value });
                console.log(`[InitialTune] Writing ${p.id} = ${p.value}`);
            }, i * 120);  // stagger 120ms apart to avoid flooding
        });

        setTimeout(() => {
            setStatus('ok', `✓ ${params.length} parameters written successfully.`);
            window.SwUtil?.toast?.(`Initial Tune: ${params.length} parameters written.`);
            if (writeBtn) writeBtn.disabled = false;
        }, params.length * 120 + 600);
    }

    // ── Update voltage hints when chemistry changes ────────────────────────────
    function onChemistryChange() {
        const chemKey  = document.getElementById('it-chemistry')?.value || 'LiPo';
        const chem     = CHEMISTRY[chemKey] || CHEMISTRY.LiPo;
        const chargedEl = document.getElementById('it-cell-charged');
        const dischEl   = document.getElementById('it-cell-discharged');
        if (chargedEl) chargedEl.value = chem.charged;
        if (dischEl)   dischEl.value   = chem.discharged;
        renderPreview();
    }

    // ── Build panel HTML ───────────────────────────────────────────────────────
    function buildPanelHTML() {
        const chemOptions = Object.keys(CHEMISTRY).map(k =>
            `<option value="${k}">${CHEMISTRY[k].label}</option>`
        ).join('\n');

        return `
<div class="settings-panel-title">Initial Tune Parameters</div>

<!-- Prerequisites banner -->
<div class="it-prereq-banner">
  <div class="it-prereq-icon">⚠</div>
  <div class="it-prereq-text">
    <div class="it-prereq-title">Before setting these parameters, ensure:</div>
    <ul class="it-prereq-list">
      <li>All initial setups are done (calibrations, frame settings, motor tests)</li>
      <li>Battery voltage monitoring is set and working</li>
    </ul>
    <div class="it-prereq-note">
      <strong>Note:</strong> INS_GYRO_FILTER with a value other than 20 is optional and mainly
      for small frames/props. At first, you can keep it at 20.
    </div>
  </div>
</div>

<!-- Input form -->
<div class="it-form-grid">

  <!-- Prop size -->
  <div class="it-form-group">
    <label class="it-form-label" for="it-prop-size">Airscrew size (inches)</label>
    <div class="it-input-row">
      <input class="it-input" type="number" id="it-prop-size" min="2" max="40" step="1" value="10" placeholder="e.g. 10">
      <span class="it-input-unit">in</span>
    </div>
  </div>

  <!-- Cell count -->
  <div class="it-form-group">
    <label class="it-form-label" for="it-cell-count">Battery cell count (S)</label>
    <div class="it-input-row">
      <input class="it-input" type="number" id="it-cell-count" min="1" max="12" step="1" value="4" placeholder="e.g. 4">
      <span class="it-input-unit">S</span>
    </div>
  </div>

  <!-- Chemistry -->
  <div class="it-form-group">
    <label class="it-form-label" for="it-chemistry">Battery chemistry</label>
    <select class="it-select" id="it-chemistry">
      ${chemOptions}
    </select>
  </div>

  <!-- Charged voltage -->
  <div class="it-form-group">
    <label class="it-form-label" for="it-cell-charged">Cell fully charged voltage</label>
    <div class="it-input-row">
      <input class="it-input" type="number" id="it-cell-charged" min="1.0" max="5.0" step="0.01" value="4.20" placeholder="4.20">
      <span class="it-input-unit">V/cell</span>
    </div>
  </div>

  <!-- Discharged voltage -->
  <div class="it-form-group">
    <label class="it-form-label" for="it-cell-discharged">Cell fully discharged voltage</label>
    <div class="it-input-row">
      <input class="it-input" type="number" id="it-cell-discharged" min="0.5" max="4.5" step="0.01" value="3.50" placeholder="3.50">
      <span class="it-input-unit">V/cell</span>
    </div>
  </div>

</div><!-- /it-form-grid -->

<!-- Checkboxes -->
<div class="it-checks">
  <label class="it-check-label">
    <input type="checkbox" id="it-tmotor-esc" class="it-checkbox">
    <span class="it-check-mark"></span>
    <span class="it-check-text">Using T-Motor Flame ESC?</span>
  </label>
  <label class="it-check-label">
    <input type="checkbox" id="it-ap4-settings" class="it-checkbox">
    <span class="it-check-mark"></span>
    <span class="it-check-text">Add suggested settings for ArduPilot 4.0 and up (Battery failsafe and Fence)?</span>
  </label>
</div>

<!-- Calculate button -->
<div class="it-calc-row">
  <button class="it-calc-btn" id="it-calc-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
    Calculate Initial Parameters
  </button>
</div>

<!-- Preview table (hidden until Calculate clicked) -->
<div class="it-preview-section" id="it-preview-section" style="display:none;">
  <div class="it-preview-title">Calculated Parameters</div>
  <div class="it-preview-table-wrap">
    <table class="it-preview-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Value</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody id="it-preview-tbody"></tbody>
    </table>
  </div>

  <!-- Write button -->
  <div class="it-write-row">
    <button class="it-write-btn" id="it-write-btn" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Write to Drone
    </button>
  </div>
</div>

<!-- Status strip -->
<div class="it-status-strip">
  <div class="it-status-dot it-dot-idle" id="it-status-dot"></div>
  <div class="it-status-text" id="it-status-msg">Enter your airframe details above, then click Calculate.</div>
</div>

<!-- Footer note -->
<div class="it-footer-note">
  You can find a detailed description of initial parameter settings and tuning at:<br>
  <a href="https://ardupilot.org/copter/docs/tuning-process-instructions.html"
     class="it-link" target="_blank">
    https://ardupilot.org/copter/docs/tuning-process-instructions.html
  </a><br>
  <strong>PLEASE READ IT!</strong>
</div>`;
    }

    // ── Wire controls ──────────────────────────────────────────────────────────
    function wirePanel() {
        // Chemistry change → auto-update voltage defaults
        document.getElementById('it-chemistry')?.addEventListener('change', onChemistryChange);

        // Live-preview on any input change
        ['it-prop-size','it-cell-count','it-cell-charged','it-cell-discharged',
         'it-tmotor-esc','it-ap4-settings'].forEach(id => {
            const el = document.getElementById(id);
            el?.addEventListener('change', () => {
                const section = document.getElementById('it-preview-section');
                if (section && section.style.display !== 'none') renderPreview();
            });
            el?.addEventListener('input', () => {
                const section = document.getElementById('it-preview-section');
                if (section && section.style.display !== 'none') renderPreview();
            });
        });

        // Calculate button
        document.getElementById('it-calc-btn')?.addEventListener('click', () => {
            const section = document.getElementById('it-preview-section');
            if (section) section.style.display = 'block';
            renderPreview();
        });

        // Write button
        document.getElementById('it-write-btn')?.addEventListener('click', writeParams);

        // Listen for param_value echoes (confirmation)
        wsListener = function(evt) {
            const msg = evt.detail;
            if (!msg) return;
            if (msg.type === 'param_value' || msg.type === 'parameter') {
                const id  = (msg.param_id || msg.name || '').toUpperCase();
                const val = parseFloat(msg.value ?? msg.param_value ?? NaN);
                const TRACKED = ['MOT_BAT_VOLT_MAX','MOT_BAT_VOLT_MIN','BATT_ARM_VOLT',
                                  'INS_GYRO_FILTER','ATC_RAT_RLL_FILT','ATC_RAT_PIT_FILT'];
                if (TRACKED.includes(id) && !isNaN(val)) {
                    console.log(`[InitialTune] Confirmed: ${id} = ${val}`);
                }
            }
            if (msg.type === 'param_error') {
                setStatus('error', `✕ ${msg.message || 'Parameter write error'}`);
            }
        };
        window.addEventListener('calibration_ws_message', wsListener);
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    function init() {
        if (initialised) return;
        initialised = true;

        const host = document.getElementById('panel-initial-tune');
        if (!host) {
            console.error('[InitialTune] Host element #panel-initial-tune not found');
            return;
        }

        host.innerHTML = buildPanelHTML();
        wirePanel();
        console.log('✅ InitialTune panel initialised');
    }

    window.InitialTune = { init };
    console.log('✅ InitialTune module loaded');

})();
