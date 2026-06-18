/* ════════════════════════════════════════════════════════════════
   VEHICLE CONFIG — Main Logic
   vehicle-config.js

   Exposes a global `VehicleConfig` object.
   dropdown-menu.js calls:  VehicleConfig.open()
   The close button calls:  VehicleConfig.close()
   ════════════════════════════════════════════════════════════════ */

window.VehicleConfig = (() => {

  /* ── Per-session state (persists while the page is open) ─── */
  const unlocked = new Set();
  let   selectedPort = null;

  /* ── Flash state buffers ───────────────────────────────────
     These survive panel close/reopen AND page reload mid-flash.
     vcLog() and vcSetBar() write here AND to the DOM.
     open() replays this state into the freshly-built DOM so
     the user always sees the full history even after a reload.
  ──────────────────────────────────────────────────────────── */
  const _flashLogBuffer = [];   // [{ type, msg }]
  let   _eraseProgress  = 0;
  let   _writeProgress  = 0;

  /* ── Password map: droneId → password ─────────────────────── */
  const DRONE_PASSWORDS = {
    'ti-shadow':  'tishadow@123',
    'spider':     'spider@123',
    'kala':       'kala@123',
    'palyanka':   'palyanka@123',
    'chakravyuh': 'chakravyuh@123'
  };

  /* ════════════════════════════════════════════════════════════
     PASSWORD MODAL STYLES (injected once into <head>)
     ════════════════════════════════════════════════════════════ */
  function injectModalStyles() {
    if (document.getElementById('vc-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'vc-modal-styles';
    style.textContent = `
      .vc-pw-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: rgba(10, 11, 15, 0.65);
        display: flex;
        align-items: center;
        justify-content: center;
        animation: vcBackdropIn 0.18s ease;
      }
      @keyframes vcBackdropIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      .vc-pw-modal {
        background: #ffffff;
        border: 1.5px solid #d0d6de;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.10);
        width: 360px;
        overflow: hidden;
        animation: vcModalIn 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes vcModalIn {
        from { opacity: 0; transform: scale(0.88) translateY(16px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }

      .vc-pw-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 20px 14px;
        border-bottom: 1px solid #e8ecf0;
        background: #f5f6fa;
      }

      .vc-pw-header-icon {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: rgba(229,57,53,0.10);
        border: 1.5px solid rgba(229,57,53,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .vc-pw-header-icon svg {
        width: 16px;
        height: 16px;
        color: #e53935;
      }

      .vc-pw-header-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .vc-pw-title {
        font-family: 'Exo 2', 'Rajdhani', sans-serif;
        font-size: 14px;
        font-weight: 700;
        color: #1a2332;
        letter-spacing: 0.01em;
      }

      .vc-pw-subtitle {
        font-family: 'Exo 2', sans-serif;
        font-size: 11px;
        color: #6b7a8d;
        font-weight: 400;
      }

      .vc-pw-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .vc-pw-drone-badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 7px 14px;
        background: rgba(0,188,212,0.07);
        border: 1px solid rgba(0,188,212,0.25);
        border-radius: 20px;
        font-family: 'Share Tech Mono', monospace;
        font-size: 12px;
        font-weight: 600;
        color: #007a8e;
        align-self: flex-start;
      }

      .vc-pw-drone-badge svg {
        width: 12px;
        height: 12px;
      }

      .vc-pw-field-label {
        font-family: 'Exo 2', sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: #6b7a8d;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }

      .vc-pw-input-wrap {
        position: relative;
      }

      .vc-pw-input {
        width: 100%;
        padding: 10px 40px 10px 14px;
        background: #f8fafc;
        border: 1.5px solid #d0d6de;
        border-radius: 8px;
        font-family: 'Share Tech Mono', monospace;
        font-size: 13px;
        color: #1a2332;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
        letter-spacing: 0.05em;
      }

      .vc-pw-input:focus {
        border-color: #00bcd4;
        box-shadow: 0 0 0 3px rgba(0,188,212,0.12);
        background: #fff;
      }

      .vc-pw-input.vc-pw-error {
        border-color: #e53935;
        box-shadow: 0 0 0 3px rgba(229,57,53,0.12);
        animation: vcShake 0.35s ease;
      }

      @keyframes vcShake {
        0%,100% { transform: translateX(0); }
        20%      { transform: translateX(-6px); }
        40%      { transform: translateX(6px); }
        60%      { transform: translateX(-4px); }
        80%      { transform: translateX(4px); }
      }

      .vc-pw-toggle {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        color: #6b7a8d;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
      }

      .vc-pw-toggle:hover { color: #1a2332; }

      .vc-pw-error-msg {
        display: none;
        align-items: center;
        gap: 6px;
        font-family: 'Exo 2', sans-serif;
        font-size: 11px;
        color: #e53935;
        font-weight: 500;
        margin-top: 6px;
      }

      .vc-pw-error-msg.visible { display: flex; }

      .vc-pw-footer {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 0 20px 20px;
      }

      .vc-pw-cancel {
        padding: 10px;
        background: #f0f4f8;
        border: 1.5px solid #d0d6de;
        border-radius: 8px;
        font-family: 'Exo 2', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: #6b7a8d;
        cursor: pointer;
        transition: all 0.15s;
      }

      .vc-pw-cancel:hover {
        background: #e8ecf0;
        color: #1a2332;
      }

      .vc-pw-confirm {
        padding: 10px;
        background: rgba(229,57,53,0.08);
        border: 1.5px solid rgba(229,57,53,0.35);
        border-radius: 8px;
        font-family: 'Exo 2', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: #e53935;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .vc-pw-confirm:hover {
        background: #e53935;
        color: #fff;
        border-color: #e53935;
        box-shadow: 0 4px 14px rgba(229,57,53,0.3);
      }

      .vc-pw-confirm:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════
     SHOW PASSWORD MODAL
     ════════════════════════════════════════════════════════════ */
  function showPasswordModal(droneId, droneName, onSuccess) {
    injectModalStyles();

    const backdrop = document.createElement('div');
    backdrop.className = 'vc-pw-backdrop';

    backdrop.innerHTML = `
      <div class="vc-pw-modal" id="vcPwModal">

        <div class="vc-pw-header">
          <div class="vc-pw-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="5" y="11" width="14" height="10" rx="2"/>
              <path d="M8 11V7a4 4 0 018 0"/>
            </svg>
          </div>
          <div class="vc-pw-header-text">
            <span class="vc-pw-title">Unlock Required</span>
            <span class="vc-pw-subtitle">Enter the drone unlock password</span>
          </div>
        </div>

        <div class="vc-pw-body">

          <div class="vc-pw-drone-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            ${droneName}
          </div>

          <div>
            <div class="vc-pw-field-label">Password</div>
            <div class="vc-pw-input-wrap">
              <input
                type="password"
                class="vc-pw-input"
                id="vcPwInput"
                placeholder="Enter unlock password…"
                autocomplete="off"
                spellcheck="false"
              />
              <button class="vc-pw-toggle" id="vcPwToggle" tabindex="-1" title="Show/hide">
                <svg id="vcEyeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <div class="vc-pw-error-msg" id="vcPwErrMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Incorrect password. Please try again.
            </div>
          </div>

        </div>

        <div class="vc-pw-footer">
          <button class="vc-pw-cancel" id="vcPwCancel">Cancel</button>
          <button class="vc-pw-confirm" id="vcPwConfirm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
              <rect x="5" y="11" width="14" height="10" rx="2"/>
              <path d="M8 11V7a4 4 0 018 0v4"/>
              <line x1="12" y1="15" x2="12" y2="17"/>
            </svg>
            Unlock
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(backdrop);

    const input      = backdrop.querySelector('#vcPwInput');
    const toggleBtn  = backdrop.querySelector('#vcPwToggle');
    const eyeIcon    = backdrop.querySelector('#vcEyeIcon');
    const errMsg     = backdrop.querySelector('#vcPwErrMsg');
    const confirmBtn = backdrop.querySelector('#vcPwConfirm');
    const cancelBtn  = backdrop.querySelector('#vcPwCancel');

    /* auto-focus */
    setTimeout(() => input.focus(), 60);

    /* show/hide password toggle */
    toggleBtn.addEventListener('click', () => {
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      eyeIcon.innerHTML = isText
        ? `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`
        : `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
    });

    /* clear error on typing */
    input.addEventListener('input', () => {
      input.classList.remove('vc-pw-error');
      errMsg.classList.remove('visible');
    });

    /* confirm on Enter */
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') closeModal();
    });

    function closeModal() {
      backdrop.style.opacity = '0';
      backdrop.style.transition = 'opacity 0.15s ease';
      setTimeout(() => backdrop.remove(), 150);
    }

    function tryUnlock() {
      const val = input.value;
      const correct = DRONE_PASSWORDS[droneId];
      if (val === correct) {
        closeModal();
        onSuccess();
      } else {
        input.classList.add('vc-pw-error');
        errMsg.classList.add('visible');
        input.value = '';
        setTimeout(() => input.classList.remove('vc-pw-error'), 400);
        input.focus();
      }
    }

    confirmBtn.addEventListener('click', tryUnlock);
    cancelBtn.addEventListener('click', closeModal);

    /* click outside modal to close */
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeModal();
    });
  }

  /* ── The HTML injected into .vc-body on every open() ──────── */
  function buildHTML() {
    return `
<div class="vc-layout">

  <!-- ══════════════════════════════════════════════════════════
       LEFT — Serial port + flash controls
       ══════════════════════════════════════════════════════════ -->
  <div class="vc-left">

    <!-- Serial Port -->
    <div class="vc-section">
      <div class="vc-section-header">
        <svg class="vc-section-icon" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="12" rx="2"
                stroke="currentColor" stroke-width="1.5"/>
          <path d="M7 10h10M7 14h6"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Select Serial Port:
      </div>

      <div class="vc-port-table-wrap">
        <table class="vc-port-table">
          <thead>
            <tr>
              <th>Port</th>
              <th>Board ID</th>
              <th>Manufacturer</th>
              <th>Brand</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <!-- populated dynamically by vcPopulatePorts() via list_serial_ports -->
            <tr class="vc-port-row-placeholder">
              <td colspan="5" style="text-align:center;color:#6b7a8d;font-size:12px;padding:12px;">
                Scanning ports…
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="vc-port-refresh-row">
        <button class="vc-refresh-btn" id="vcRefreshPortsBtn">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
            <path d="M21 10C21 10 18.995 7.268 17.366 5.638
                     C15.737 4.008 13.486 3 11 3
                     C6.029 3 2 7.029 2 12
                     C2 16.971 6.029 21 11 21
                     C15.103 21 18.565 18.254 19.648 14.5
                     M21 10V4M21 10H15"
                  stroke="currentColor" stroke-width="2"/>
          </svg>
          Refresh Ports
        </button>
      </div>
    </div>

    <!-- Baud Settings -->
    <div class="vc-section">
      <div class="vc-baud-row">
        <label class="vc-baud-label">Bootloader Baud:</label>
        <select class="vc-baud-select" id="vcBootBaud" aria-label="Bootloader Baud">
          <option>115200</option><option>57600</option>
          <option>38400</option><option>9600</option>
        </select>
      </div>
      <div class="vc-baud-row">
        <label class="vc-baud-label">Flash Baud:</label>
        <select class="vc-baud-select" id="vcFlashBaud" aria-label="Flash Baud">
          <option>115200</option><option>57600</option>
          <option>38400</option><option>9600</option>
        </select>
      </div>
    </div>

    <!-- Flashing Log -->
    <div class="vc-section vc-log-section">
      <div class="vc-section-header">
        <svg class="vc-section-icon" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="3" width="16" height="18" rx="2"
                stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 8h8M8 12h8M8 16h5"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Flashing Log:
      </div>
      <div class="vc-log-box" id="vcFlashLog">
        <span class="vc-log-line vc-log-info vc-log-placeholder">→ Vehicle Configuration ready.</span>
      </div>
    </div>

    <!-- Progress Bars -->
    <div class="vc-section">
      <div class="vc-progress-row">
        <span class="vc-progress-label">Erase Progress:</span>
        <div class="vc-progress-track">
          <div class="vc-progress-fill vc-progress-erase"
               id="vcEraseBar" style="width:0%"></div>
        </div>
      </div>
      <div class="vc-progress-row">
        <span class="vc-progress-label">Write Progress:</span>
        <div class="vc-progress-track">
          <div class="vc-progress-fill vc-progress-write"
               id="vcWriteBar" style="width:0%"></div>
        </div>
      </div>
    </div>

  </div><!-- /vc-left -->


  <!-- ══════════════════════════════════════════════════════════
       RIGHT — Drone type selector
       ══════════════════════════════════════════════════════════ -->
  <div class="vc-right">
    <div class="vc-drone-title">Select Drone Type</div>

    <div class="vc-drone-list" id="vcDroneList">

      <!-- Ti-Shadow -->
      <div class="vc-drone-card" data-drone="ti-shadow">
        <div class="vc-drone-img-wrap">
          <img src="resources/firmware/ti-shadow.png" alt="Ti-Shadow"
               class="vc-drone-img" onerror="this.style.opacity='0.12'">
        </div>
        <div class="vc-drone-info">
          <span class="vc-drone-name">Ti-Shadow</span>
          <span class="vc-drone-desc">Surveillance Drone</span>
        </div>
        <div class="vc-drone-actions">
          <button class="vc-btn vc-btn-unlock" data-drone="ti-shadow" data-name="Ti-Shadow">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <rect x="5" y="11" width="14" height="10" rx="2"
                    stroke="currentColor" stroke-width="2"/>
              <path d="M8 11V7a4 4 0 018 0" stroke="currentColor" stroke-width="2"/>
            </svg>
            UNLOCK
          </button>
          <button class="vc-btn vc-btn-install" data-drone="ti-shadow">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            INSTALL
          </button>
        </div>
      </div>

      <!-- Spider Drone -->
      <div class="vc-drone-card" data-drone="spider">
        <div class="vc-drone-img-wrap">
          <img src="resources/firmware/spider.png" alt="Spider Drone"
               class="vc-drone-img" onerror="this.style.opacity='0.12'">
        </div>
        <div class="vc-drone-info">
          <span class="vc-drone-name">Spider Drone</span>
          <span class="vc-drone-desc">Hexacopter Drone</span>
        </div>
        <div class="vc-drone-actions">
          <button class="vc-btn vc-btn-unlock" data-drone="spider" data-name="Spider Drone">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <rect x="5" y="11" width="14" height="10" rx="2"
                    stroke="currentColor" stroke-width="2"/>
              <path d="M8 11V7a4 4 0 018 0" stroke="currentColor" stroke-width="2"/>
            </svg>
            UNLOCK
          </button>
          <button class="vc-btn vc-btn-install" data-drone="spider">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            INSTALL
          </button>
        </div>
      </div>

      <!-- Kala Drone -->
      <div class="vc-drone-card" data-drone="kala">
        <div class="vc-drone-img-wrap">
          <img src="resources/firmware/Kala.png" alt="Kala Drone"
               class="vc-drone-img" onerror="this.style.opacity='0.12'">
        </div>
        <div class="vc-drone-info">
          <span class="vc-drone-name">Kala Drone</span>
          <span class="vc-drone-desc">Payload Dropping Drone</span>
        </div>
        <div class="vc-drone-actions">
          <button class="vc-btn vc-btn-unlock" data-drone="kala" data-name="Kala Drone">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <rect x="5" y="11" width="14" height="10" rx="2"
                    stroke="currentColor" stroke-width="2"/>
              <path d="M8 11V7a4 4 0 018 0" stroke="currentColor" stroke-width="2"/>
            </svg>
            UNLOCK
          </button>
          <button class="vc-btn vc-btn-install" data-drone="kala">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            INSTALL
          </button>
        </div>
      </div>

      <!-- Palyanka Drone -->
      <div class="vc-drone-card" data-drone="palyanka">
        <div class="vc-drone-img-wrap">
          <img src="resources/firmware/palyanka.png" alt="Palyanka Drone"
               class="vc-drone-img" onerror="this.style.opacity='0.12'">
        </div>
        <div class="vc-drone-info">
          <span class="vc-drone-name">Palyanka Drone</span>
          <span class="vc-drone-desc">Air Taxi</span>
        </div>
        <div class="vc-drone-actions">
          <button class="vc-btn vc-btn-unlock" data-drone="palyanka" data-name="Palyanka Drone">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <rect x="5" y="11" width="14" height="10" rx="2"
                    stroke="currentColor" stroke-width="2"/>
              <path d="M8 11V7a4 4 0 018 0" stroke="currentColor" stroke-width="2"/>
            </svg>
            UNLOCK
          </button>
          <button class="vc-btn vc-btn-install" data-drone="palyanka">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            INSTALL
          </button>
        </div>
      </div>

      <!-- Chakravyuh Drone -->
      <div class="vc-drone-card" data-drone="chakravyuh">
        <div class="vc-drone-img-wrap">
          <img src="resources/firmware/Chakravyuh.png" alt="Chakravyuh Drone"
               class="vc-drone-img" onerror="this.style.opacity='0.12'">
        </div>
        <div class="vc-drone-info">
          <span class="vc-drone-name">Chakrayukhan Drone</span>
          <span class="vc-drone-desc">Heavy Payload Cargo Drone</span>
          <span class="vc-drone-tag">Industrial-grade heavy lifting</span>
        </div>
        <div class="vc-drone-actions">
          <button class="vc-btn vc-btn-unlock" data-drone="chakravyuh" data-name="Chakrayukhan Drone">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <rect x="5" y="11" width="14" height="10" rx="2"
                    stroke="currentColor" stroke-width="2"/>
              <path d="M8 11V7a4 4 0 018 0" stroke="currentColor" stroke-width="2"/>
            </svg>
            UNLOCK
          </button>
          <button class="vc-btn vc-btn-install" data-drone="chakravyuh">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            INSTALL
          </button>
        </div>
      </div>

    </div><!-- /vc-drone-list -->
  </div><!-- /vc-right -->

</div><!-- /vc-layout -->
    `;
  }

  /* ── Restore unlock states after HTML is (re)injected ─────── */
  function restoreUnlockStates() {
    const overlay = document.getElementById('vehicleConfigOverlay');
    const scope   = overlay || document;

    unlocked.forEach(id => {
      const card = scope.querySelector(`.vc-drone-card[data-drone="${id}"]`);
      if (!card) return;

      /* re-enable install button */
      enableInstallBtn(card.querySelector('.vc-btn-install'));

      /* show unlock button as already-unlocked */
      const unlockBtn = card.querySelector('.vc-btn-unlock');
      if (unlockBtn) {
        unlockBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
            <rect x="5" y="11" width="14" height="10" rx="2"
                  stroke="currentColor" stroke-width="2"/>
            <path d="M8 11V7a4 4 0 014-4 4 4 0 014 3.5" stroke="currentColor" stroke-width="2"/>
            <line x1="12" y1="15" x2="12" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          UNLOCKED
        `;
        unlockBtn.style.cssText = 'background:rgba(0,200,83,0.08);border:1.5px solid rgba(0,200,83,0.35);border-radius:5px;color:#00a846;cursor:default;opacity:1;';
        unlockBtn.disabled = true;
      }
    });

    // After restoring all unlock states, apply port-based guard so buttons
    // that were unlocked in a prior session are correctly dimmed if no port
    // is currently selected.
    updateInstallBtns();
  }

  /* ── Bind all events inside the overlay ───────────────────── */
  function bindEvents() {
    const overlay = document.getElementById('vehicleConfigOverlay');
    if (!overlay) return;

    /* Port rows */
    overlay.querySelectorAll('.vc-port-row').forEach(row => {
      row.addEventListener('click', () => {
        overlay.querySelectorAll('.vc-port-row')
          .forEach(r => r.classList.remove('vc-selected'));
        row.classList.add('vc-selected');
        selectedPort = row.dataset.port;
        // Port just changed — re-evaluate all install buttons so unlocked
        // drones become clickable now that a port is available.
        updateInstallBtns();
        vcLog('info', `Port selected: ${selectedPort}`);
      });
    });

    /* Drone cards (select on click, not on button) */
    overlay.querySelectorAll('.vc-drone-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.vc-btn')) return;
        overlay.querySelectorAll('.vc-drone-card')
          .forEach(c => c.classList.remove('vc-active'));
        card.classList.add('vc-active');
      });
    });

    /* Unlock buttons — show password modal */
    overlay.querySelectorAll('.vc-btn-unlock').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const droneId   = btn.dataset.drone;
        const droneName = btn.dataset.name || droneId;

        if (unlocked.has(droneId)) {
          vcLog('warn', `${droneName} is already unlocked.`);
          return;
        }

        showPasswordModal(droneId, droneName, () => {
          vcUnlock(droneId, droneName, btn);
        });
      });
    });

    /* Install buttons — enabled only when unlocked AND a port is selected */
    overlay.querySelectorAll('.vc-btn-install').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!btn.classList.contains('vc-unlocked')) return;
        if (!selectedPort) {
          vcLog('warn', '⚠ Select a serial port before installing.');
          return;
        }

        const droneId = btn.dataset.drone;

        /* ── Open native file picker for .apj files ─── */
        const fileInput = document.createElement('input');
        fileInput.type   = 'file';
        fileInput.accept = '.apj,application/json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', () => {
          const file = fileInput.files && fileInput.files[0];
          document.body.removeChild(fileInput);

          if (!file) {
            vcLog('warn', '⚠ No file selected — install cancelled.');
            return;
          }

          if (!file.name.toLowerCase().endsWith('.apj')) {
            vcLog('warn', `⚠ "${file.name}" does not look like an APJ file. Proceeding anyway…`);
          }

          vcLog('info', `📂 Selected: ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`);
          vcLog('info', `🔌 Port: ${selectedPort}  |  Drone: ${droneId}`);
          vcLog('info', '⏳ Reading firmware file…');

          /* Disable the button during flash to prevent double-click */
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor  = 'not-allowed';

          const reader = new FileReader();

          reader.onload = ev => {
            const apjText = ev.target.result;

            /* Quick sanity-check: must be valid JSON with an "image" field */
            let parsed;
            try {
              parsed = JSON.parse(apjText);
            } catch (err) {
              vcLog('error', `❌ APJ file is not valid JSON: ${err.message}`);
              btn.disabled = false;
              btn.style.opacity = '';
              btn.style.cursor  = 'pointer';
              return;
            }

            if (!parsed.image) {
              vcLog('warn', '⚠ APJ file has no "image" field — may not be a valid firmware.');
            }

            vcLog('ok', '✓ Firmware file read OK — starting installation…');
            vcLog('info', '══════════════════════════════════════════');

            /* Send to backend */
            if (typeof window.safeSend === 'function') {
              window.safeSend({
                type:      'install_firmware_custom',
                drone:     droneId,
                port:      selectedPort,
                boot_baud: 115200,
                apj:       parsed
              });
            } else {
              vcLog('warn', '⚠ WebSocket not connected — cannot send firmware.');
              btn.disabled = false;
              btn.style.opacity = '';
              btn.style.cursor  = 'pointer';
            }
          };

          reader.onerror = () => {
            vcLog('error', '❌ Failed to read firmware file.');
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor  = 'pointer';
          };

          reader.readAsText(file);
        });

        /* Trigger the picker */
        fileInput.click();
      });
    });

    /* Refresh ports */
    const refreshBtn = overlay.querySelector('#vcRefreshPortsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        vcLog('info', 'Scanning serial ports…');
        if (typeof window.safeSend === 'function') {
          window.safeSend({ type: 'list_serial_ports' });
        } else {
          vcLog('warn', 'WebSocket not connected.');
        }
      });
    }

    /* Close button (titlebar X) */
    const closeBtn = document.getElementById('vcCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', close);
    }

    /* Click outside the window to close */
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });
  }

  /* ── enableInstallBtn — shared helper ─────────────────────── */
  function enableInstallBtn(btn) {
    if (!btn) return;
    btn.classList.add('vc-unlocked');
    btn.disabled = false;

    const applyDefault = () => {
      btn.style.cssText = 'cursor:pointer;pointer-events:all;color:#00a846;background:rgba(0,200,83,0.08);border:1.5px solid rgba(0,200,83,0.35);border-radius:5px;opacity:1;';
    };

    applyDefault();

    btn.addEventListener('mouseenter', () => {
      btn.style.cssText = 'cursor:pointer;pointer-events:all;color:#ffffff;background:#00c853;border:1.5px solid #00c853;border-radius:5px;box-shadow:0 4px 12px rgba(0,200,83,0.35);opacity:1;';
    });

    btn.addEventListener('mouseleave', applyDefault);
  }

  /* ── vcUnlock — called after password verified ─────────────── */
  function vcUnlock(id, name, unlockBtn) {
    unlocked.add(id);
    vcLog('ok', `🔓 ${name} unlocked — install enabled.`);

    /* scope to overlay so we always find the right button */
    const overlay = document.getElementById('vehicleConfigOverlay');
    const scope   = overlay || document;
    const card    = scope.querySelector(`.vc-drone-card[data-drone="${id}"]`);

    if (card) {
      enableInstallBtn(card.querySelector('.vc-btn-install'));
    }

    /* Update the unlock button to show "UNLOCKED" state */
    if (unlockBtn) {
      unlockBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
          <rect x="5" y="11" width="14" height="10" rx="2"
                stroke="currentColor" stroke-width="2"/>
          <path d="M8 11V7a4 4 0 014-4 4 4 0 014 3.5" stroke="currentColor" stroke-width="2"/>
          <line x1="12" y1="15" x2="12" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        UNLOCKED
      `;
      unlockBtn.style.cssText = 'background:rgba(0,200,83,0.08);border:1.5px solid rgba(0,200,83,0.35);border-radius:5px;color:#00a846;cursor:default;opacity:1;';
      unlockBtn.disabled = true;
    }

    // Re-evaluate install button: green but disabled until a port is also selected.
    updateInstallBtns();
  }


  /* Re-evaluates install button disabled state based on unlock + port selection */
  function updateInstallBtns() {
    const overlay = document.getElementById('vehicleConfigOverlay');
    if (!overlay) return;
    overlay.querySelectorAll('.vc-btn-install').forEach(btn => {
      const isUnlocked = btn.classList.contains('vc-unlocked');
      const canInstall = isUnlocked && !!selectedPort;
      btn.disabled     = !canInstall;
      if (isUnlocked) {
        btn.style.opacity = canInstall ? '' : '0.45';
        btn.style.cursor  = canInstall ? 'pointer' : 'not-allowed';
      }
    });
  }

  /* ════════════════════════════════════════════════════════════
     HELPERS — scoped inside the overlay
     ════════════════════════════════════════════════════════════ */

  function vcLog(type, msg) {
    // Always buffer so replaying on open() works even after a session/reconnect reload
    _flashLogBuffer.push({ type, msg });

    const overlay = document.getElementById('vehicleConfigOverlay');
    const box = overlay ? overlay.querySelector('#vcFlashLog') : document.getElementById('vcFlashLog');
    if (!box) return;

    // On the very first real log entry after the panel opened, clear the
    // static "Vehicle Configuration ready." placeholder that buildHTML()
    // bakes directly into innerHTML.  Without this the placeholder sits at
    // the top and new lines scroll off the bottom of the fixed-height box.
    const placeholder = box.querySelector('.vc-log-placeholder');
    if (placeholder) placeholder.remove();

    const line       = document.createElement('span');
    line.className   = 'vc-log-line' + (type ? ` vc-log-${type}` : '');
    line.textContent = `→ ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function vcSetBar(barId, value) {
    // Keep module state in sync so open() can replay the latest values
    if (barId === 'vcEraseBar') _eraseProgress = value;
    if (barId === 'vcWriteBar') _writeProgress = value;

    const overlay = document.getElementById('vehicleConfigOverlay');
    const bar = overlay ? overlay.querySelector(`#${barId}`) : document.getElementById(barId);
    if (bar) bar.style.width = value + '%';
  }

  function vcAnimBar(barId, from, to, dur, cb) {
    const overlay = document.getElementById('vehicleConfigOverlay');
    const bar = overlay ? overlay.querySelector(`#${barId}`) : document.getElementById(barId);
    if (!bar) return;
    const start = performance.now();
    (function step(now) {
      const p = Math.min((now - start) / dur, 1);
      bar.style.width = Math.round(from + (to - from) * p) + '%';
      if (p < 1) requestAnimationFrame(step);
      else if (cb) cb();
    })(start);
  }

  /* ── Replay buffered flash state into a freshly-built DOM ──
     Called by open() after buildHTML() so the panel always shows
     the full log history and correct progress bars even when:
       • The user closes and reopens the panel mid-flash
       • The page was reloaded while a flash was in progress
  ──────────────────────────────────────────────────────────── */
  function replayFlashState() {
    const overlay = document.getElementById('vehicleConfigOverlay');
    const box = overlay ? overlay.querySelector('#vcFlashLog') : document.getElementById('vcFlashLog');
    if (box) {
      if (_flashLogBuffer.length > 0) {
        // Clear the placeholder "Vehicle Configuration ready." line
        // that buildHTML() injects, then replay every buffered entry.
        box.innerHTML = '';
        _flashLogBuffer.forEach(({ type, msg }) => {
          const line     = document.createElement('span');
          line.className = 'vc-log-line' + (type ? ` vc-log-${type}` : '');
          line.textContent = `→ ${msg}`;
          box.appendChild(line);
        });
        box.scrollTop = box.scrollHeight;
      }
      // If buffer is empty and a flash is in progress, at least remove
      // the placeholder so the box looks ready for incoming messages.
      else if (_eraseProgress > 0 || _writeProgress > 0) {
        box.innerHTML = '';
      }
    }

    // Always restore progress bars to their last known values
    const eraseBar = overlay ? overlay.querySelector('#vcEraseBar') : document.getElementById('vcEraseBar');
    const writeBar = overlay ? overlay.querySelector('#vcWriteBar') : document.getElementById('vcWriteBar');
    if (eraseBar) eraseBar.style.width = _eraseProgress + '%';
    if (writeBar) writeBar.style.width = _writeProgress + '%';
  }

  /* ════════════════════════════════════════════════════════════
     vcPopulatePorts — called by websocket.js when serial_ports
     message arrives.  Also registered as window.vcPopulatePorts
     so websocket.js can reach it directly.
     ════════════════════════════════════════════════════════════ */

  /**
   * Populate (or replace) the port table rows inside the overlay.
   * @param {Array<{port,display,description,manufacturer,board_id,brand}>} ports
   */
  function vcPopulatePorts(ports) {
    const overlay = document.getElementById('vehicleConfigOverlay');
    if (!overlay) return;

    const tbody = overlay.querySelector('.vc-port-table tbody');
    if (!tbody) return;

    // Remove existing rows
    tbody.innerHTML = '';

    if (!ports || ports.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" style="text-align:center;color:#6b7a8d;padding:10px 0;">
        No serial ports found
      </td>`;
      tbody.appendChild(tr);
      vcLog('warn', 'No serial ports found.');
      return;
    }

    ports.forEach(p => {
      const tr = document.createElement('tr');
      tr.className  = 'vc-port-row';
      tr.dataset.port = p.port || p.display || '';
      tr.innerHTML = `
        <td>${p.port || p.display || '—'}</td>
        <td>${p.board_id || ''}</td>
        <td>${p.manufacturer || ''}</td>
        <td>${p.brand || ''}</td>
        <td>${p.description || 'n/a'}</td>
      `;

      // If this port was previously selected, re-highlight it
      if (selectedPort && tr.dataset.port === selectedPort) {
        tr.classList.add('vc-selected');
      }

      tr.addEventListener('click', () => {
        overlay.querySelectorAll('.vc-port-row')
          .forEach(r => r.classList.remove('vc-selected'));
        tr.classList.add('vc-selected');
        selectedPort = tr.dataset.port;
        // Port selected from live scan — re-evaluate all install buttons.
        updateInstallBtns();
        vcLog('info', `Port selected: ${selectedPort}`);
      });

      tbody.appendChild(tr);
    });

    vcLog('ok', `✓ Found ${ports.length} serial port(s).`);
  }

  // Expose globally so websocket.js serial_ports handler can call it
  // even before VehicleConfig.open() is invoked.
  window.vcPopulatePorts = vcPopulatePorts;

  /* ════════════════════════════════════════════════════════════
     vcHandleFirmwareMessage — called by websocket.js when a
     firmware_log / firmware_progress / firmware_result message
     arrives.  Register as window.vcHandleFirmwareMessage.
     ════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════════
     vcHandleFirmwareMessage — called by websocket.js when any
     firmware-related message arrives.
     Registered as window.vcHandleFirmwareMessage.

     Handles two wire formats:

     NEW (firmware_manager.cpp updated):
       { type: "firmware_status",
         stage: "preflight"|"start"|"log"|"erase"|"program"|
                "complete"|"error"|"abort"|"troubleshoot"|
                "warning"|"waiting"|"busy",
         message: "...",
         progress: 0-100,   // optional — present for erase/program
         error: true/false }

     LEGACY (backward-compat):
       { type: "firmware_log",      message: "..." }
       { type: "firmware_progress", stage: "erase"|"write", percent: 0-100 }
       { type: "firmware_result",   success: bool, message: "..." }
     ════════════════════════════════════════════════════════════════ */
  function vcHandleFirmwareMessage(msg) {

    /* ── Helper: re-enable install buttons after flash ends ── */
    function reenableInstallBtns() {
      const overlay = document.getElementById('vehicleConfigOverlay');
      if (!overlay) return;
      overlay.querySelectorAll('.vc-btn-install').forEach(btn => {
        if (btn.classList.contains('vc-unlocked') && selectedPort) {
          btn.disabled      = false;
          btn.style.opacity = '';
          btn.style.cursor  = 'pointer';
        }
      });
    }

    /* ══════════════════════════════════════════════════════════
       NEW FORMAT: firmware_status
       ══════════════════════════════════════════════════════════ */
    if (msg.type === 'firmware_status') {
      const stage    = msg.stage    || '';
      const message  = msg.message  || '';
      const progress = (msg.progress !== undefined && msg.progress >= 0)
                         ? msg.progress : -1;

      switch (stage) {

        /* ── Pre-flight / starting ── */
        case 'preflight':
          vcLog('info', message || '🔍 Running pre-flight checks…');
          break;

        case 'start':
          // New flash session — reset buffers so old log doesn't bleed over.
          _flashLogBuffer.length = 0;
          _eraseProgress = 0;
          _writeProgress = 0;
          // Also clear the DOM log box immediately (including any placeholder
          // or leftover lines from the prior session) so the new session starts
          // from a clean slate without waiting for replayFlashState().
          { const overlay = document.getElementById('vehicleConfigOverlay');
            const box = overlay ? overlay.querySelector('#vcFlashLog') : document.getElementById('vcFlashLog');
            if (box) box.innerHTML = ''; }
          // Reset both bars so they animate from 0 when the new flash begins.
          vcSetBar('vcEraseBar', 0);
          vcSetBar('vcWriteBar', 0);
          vcLog('ok', message || '🚀 Flash started…');
          break;

        case 'waiting':
          vcLog('info', message);
          break;

        case 'busy':
          vcLog('warn', message);
          break;

        /* ── Per-uploader log lines (all forwarded verbatim to flash log) ── */
        case 'log': {
          const text = message;
          // Suppress repetitive per-chunk write % lines (progress bar shows those)
          const isWritePct = /^→ Write: \d+ %$/.test(text);
          if (!isWritePct) {
            if (text === 'Upgrade complete') {
              vcLog('upgrade', text);
            } else if (text.startsWith('✓')) {
              vcLog('ok', text);
            } else if (text.startsWith('❌')) {
              vcLog('error', text);
            } else if (text.startsWith('⚠')) {
              vcLog('warn', text);
            } else {
              vcLog('info', text);
            }
          }
          break;
        }

        /* ── Erase progress (C++ sends 0–100 per-stage) ── */
        case 'erase':
          if (progress >= 0) {
            vcSetBar('vcEraseBar', progress);
            // Log every 10 % milestone + the very first tick (0 %)
            if (progress % 10 === 0) {
              vcLog('info', 'Erasing flash… ' + progress + '%');
            }
          }
          break;

        /* ── Program / write progress (C++ sends 0–100 per-stage) ── */
        case 'program':
          if (progress >= 0) {
            vcSetBar('vcWriteBar', progress);
            // Log every 10 % milestone + the very first tick (0 %)
            if (progress % 10 === 0) {
              vcLog('info', 'Programming firmware… ' + progress + '%');
            }
          }
          break;

        /* ── Success ── */
        case 'complete':
          vcSetBar('vcEraseBar', 100);
          vcSetBar('vcWriteBar', 100);
          vcLog('ok',  '✅ FLASH COMPLETED SUCCESSFULLY!');
          vcLog('ok',  '🔄 Board is rebooting — please wait for reconnect…');
          reenableInstallBtns();
          break;

        /* ── Abort ── */
        case 'abort':
          vcLog('abort', message || 'ℹ️  Flash cancelled.');
          reenableInstallBtns();
          break;

        /* ── Error ── */
        case 'error':
          vcLog('error', message);
          reenableInstallBtns();
          break;

        /* ── Troubleshooting checklist (multi-line) ── */
        case 'troubleshoot':
          message.split('\n').forEach(line => {
            if (line.trim()) vcLog('troubleshoot', line);
          });
          break;

        /* ── Generic warning ── */
        case 'warning':
          vcLog('warn', message);
          break;

        default:
          if (message) vcLog(msg.error ? 'error' : 'info', message);
          break;
      }
      return;
    }

    /* ══════════════════════════════════════════════════════════
       LEGACY FORMAT (backward-compat)
       ══════════════════════════════════════════════════════════ */
    if (msg.type === 'firmware_log') {
      const text = msg.message || '';

      if (text === 'Upgrade complete') {
        vcLog('upgrade', text);
      } else if (text.startsWith('Erasing previous program')) {
        vcSetBar('vcEraseBar', 0);
        vcLog('info', text);
      } else if (text.startsWith('Programming new version')) {
        vcSetBar('vcWriteBar', 0);
        vcLog('info', text);
      } else {
        vcLog('info', text);
      }
    }

    if (msg.type === 'firmware_progress') {
      const stage   = msg.stage   || 'write';
      const percent = msg.percent || 0;
      const barId   = stage === 'erase' ? 'vcEraseBar' : 'vcWriteBar';
      vcSetBar(barId, percent);
    }

    if (msg.type === 'firmware_result') {
      if (msg.success) {
        vcSetBar('vcEraseBar', 100);
        vcSetBar('vcWriteBar', 100);
        vcLog('ok',  '✅ ' + (msg.message || 'Firmware installed successfully!'));
        vcLog('ok',  '🔄 Board is rebooting — please wait for reconnect…');
      } else {
        vcLog('error', '❌ ' + (msg.message || 'Firmware installation failed.'));
      }
      reenableInstallBtns();
    }
  }

  window.vcHandleFirmwareMessage = vcHandleFirmwareMessage;

  /* ════════════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════════════ */

  function open() {
    const overlay = document.getElementById('vehicleConfigOverlay');
    if (!overlay) {
      console.error('❌ #vehicleConfigOverlay not found in DOM.');
      return;
    }

    /* Inject UI into the .vc-body each time we open */
    const body = overlay.querySelector('.vc-body');
    if (body) {
      body.innerHTML = buildHTML();
    }

    /* Restore any in-progress flash log + progress bars from the buffer */
    replayFlashState();

    /* Re-apply unlock states from this session */
    restoreUnlockStates();

    /* Wire up all event listeners */
    bindEvents();

    /* Populate port table from last known data immediately (no flicker) */
    if (window._vcLastKnownPorts && window._vcLastKnownPorts.length > 0) {
      vcPopulatePorts(window._vcLastKnownPorts);
    }

    /* Always request a fresh scan so the list is up-to-date */
    if (typeof window.safeSend === 'function') {
      window.safeSend({ type: 'list_serial_ports' });
    }

    /* Show the overlay */
    overlay.style.display    = 'flex';
    overlay.style.opacity    = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });

    console.log('✅ VehicleConfig opened.');
  }

  function close() {
    const overlay = document.getElementById('vehicleConfigOverlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);
    console.log('✅ VehicleConfig closed.');
  }

  /* ── Auto-init: wire close button if overlay already in DOM ── */
  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('vcCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);
    console.log('✅ VehicleConfig loaded and ready.');
  });

  return { open, close };

})();

/* ═══════════════════════════════════════════════════════════════════════
   VehicleConfig WS router
   ───────────────────────────────────────────────────────────────────────
   MainWindow.html patches the WebSocket constructor and stores every
   socket as window.ws (and window.__mv_sockets[]).  That interceptor
   only routes "status" messages — it ignores firmware_status,
   serial_ports, port_appeared, and port_disappeared entirely.

   This block attaches a second 'message' listener to the same socket
   so those messages reach the vehicle-config panel.  It runs after
   vehicle-config.js loads (which is after websocket.js creates the
   socket), so window.ws is already set by the time this executes.
   ═══════════════════════════════════════════════════════════════════════ */
(function attachVcWsRouter() {

  const FIRMWARE_TYPES = new Set([
    'firmware_status', 'firmware_log', 'firmware_progress', 'firmware_result'
  ]);

  function dispatch(raw) {
    let msg;
    try { msg = (typeof raw === 'string') ? JSON.parse(raw) : raw; }
    catch (_) { return; }
    if (!msg || !msg.type) return;

    /* ── firmware progress → vcHandleFirmwareMessage ── */
    if (FIRMWARE_TYPES.has(msg.type)) {
      if (typeof window.vcHandleFirmwareMessage === 'function')
        window.vcHandleFirmwareMessage(msg);
      return;
    }

    /* ── serial port list → vcPopulatePorts ── */
    if (msg.type === 'serial_ports') {
      window._vcLastKnownPorts = msg.ports || [];
      if (typeof window.vcPopulatePorts === 'function')
        window.vcPopulatePorts(msg.ports || []);
      return;
    }

    /* ── port plug/unplug → refresh port table ── */
    if (msg.type === 'port_appeared' || msg.type === 'port_disappeared') {
      // Request a fresh scan so the port table updates automatically
      if (typeof window.safeSend === 'function')
        window.safeSend({ type: 'list_serial_ports' });

      // Log disconnect events in the flash log if panel is open
      if (msg.type === 'port_disappeared' &&
          typeof window.vcHandleFirmwareMessage === 'function') {
        window.vcHandleFirmwareMessage({
          type: 'firmware_status', stage: 'log',
          message: '🔌 Port disconnected: ' + (msg.port || '(unknown)'),
          error: false
        });
      }
    }
  }

  function attachToSocket(sock) {
    if (!sock || typeof sock.addEventListener !== 'function') return false;
    sock.addEventListener('message', function (evt) { dispatch(evt.data); });
    console.log('[VcRouter] ✅ Attached to window.ws');
    return true;
  }

  /* window.ws is set by the PatchedWebSocket constructor in MainWindow.html
     before any script runs, so it should be available immediately.
     The poll handles the rare case where the socket is created lazily.  */
  if (!attachToSocket(window.ws)) {
    var tries = 0;
    var poll = setInterval(function () {
      if (attachToSocket(window.ws) || ++tries > 80) clearInterval(poll);
    }, 100);
  }

  /* Also hook window.__mv_sockets in case multiple sockets are created */
  if (window.__mv_sockets) {
    var _origPush = Array.prototype.push;
    window.__mv_sockets.push = function () {
      var result = _origPush.apply(this, arguments);
      for (var i = 0; i < arguments.length; i++)
        attachToSocket(arguments[i]);
      return result;
    };
  }

}());