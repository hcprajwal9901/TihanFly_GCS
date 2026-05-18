/**
 * flight-modes.js
 * TiHANFly GCS — Flight Modes Configuration Panel
 *
 * Fixes applied:
 *  1. Removed the first (dummy setTimeout) _save() definition that was
 *     shadowing the real WS implementation further down.
 *  2. flight_mode_status handler now also updates slots[slot].modeId with
 *     the mode name received from the backend, so refreshHeader() always
 *     shows the correct label — previously currentModeSlot was updated but
 *     slots[] was not, so the header still showed the old mode.
 *  3. currentModeName is tracked separately so the header can be rendered
 *     from the authoritative server-supplied name rather than a client-side
 *     lookup that can lag behind.
 *  4. onMessage() now auto-wires itself into window.onWsMessage /
 *     window.GCS?.onMessage so it receives messages even if the caller
 *     forgot to wire it up manually.
 *  5. All duplicate code removed — single source of truth for each handler.
 *
 * Renders into #panel-flight-modes (injected by settings-window.js)
 * Exposes: window.FlightModes.init()  window.FlightModes.onMessage()
 */
(function () {
    'use strict';

    // ── All available flight modes ─────────────────────────────────────────────
    const MODES = [
        { id: 0,  label: 'Stabilize'       },
        { id: 1,  label: 'Acro'            },
        { id: 2,  label: 'Alt Hold'        },
        { id: 3,  label: 'Auto'            },
        { id: 4,  label: 'Guided'          },
        { id: 5,  label: 'Loiter'          },
        { id: 6,  label: 'RTL'             },
        { id: 7,  label: 'Circle'          },
        { id: 9,  label: 'Land'            },
        { id: 11, label: 'Drift'           },
        { id: 13, label: 'Sport'           },
        { id: 14, label: 'Flip'            },
        { id: 15, label: 'AutoTune'        },
        { id: 16, label: 'Pos Hold'        },
        { id: 17, label: 'Brake'           },
        { id: 18, label: 'Throw'           },
        { id: 19, label: 'Avoid ADSB'      },
        { id: 20, label: 'Guided No GPS'   },
        { id: 21, label: 'Smart RTL'       },
        { id: 22, label: 'Flow Hold'       },
        { id: 23, label: 'Follow'          },
        { id: 24, label: 'ZigZag'          },
        { id: 25, label: 'System ID'       },
        { id: 26, label: 'Heli Autorotate' },
        { id: 27, label: 'Auto RTL'        },
    ];

    // Backend mode-name → friendly label mapping
    // (backend sends e.g. "ALT_HOLD"; we show "Alt Hold")
    const BACKEND_TO_LABEL = {
        'STABILIZE':    'Stabilize',
        'ACRO':         'Acro',
        'ALT_HOLD':     'Alt Hold',
        'AUTO':         'Auto',
        'GUIDED':       'Guided',
        'LOITER':       'Loiter',
        'RTL':          'RTL',
        'CIRCLE':       'Circle',
        'LAND':         'Land',
        'DRIFT':        'Drift',
        'SPORT':        'Sport',
        'FLIP':         'Flip',
        'AUTOTUNE':     'AutoTune',
        'POSHOLD':      'Pos Hold',
        'BRAKE':        'Brake',
        'THROW':        'Throw',
        'AVOID_ADSB':   'Avoid ADSB',
        'GUIDED_NOGPS': 'Guided No GPS',
        'SMART_RTL':    'Smart RTL',
        'FLOWHOLD':     'Flow Hold',
        'FOLLOW':       'Follow',
        'ZIGZAG':       'ZigZag',
        'SYSTEMID':     'System ID',
        'AUTOROTATE':   'Heli Autorotate',
        'AUTO_RTL':     'Auto RTL',
        'UNKNOWN':      'Unknown',
    };

    // ── PWM ranges for each of the 6 slots ───────────────────────────────────
    const PWM_RANGES = [
        'PWM 0 – 1230',
        'PWM 1231 – 1360',
        'PWM 1361 – 1490',
        'PWM 1491 – 1620',
        'PWM 1621 – 1749',
        'PWM 1750 +',
    ];
    const PWM_BOUNDS = [1230, 1360, 1490, 1620, 1749, 2000];

    // ── Slot config (will be overwritten by flight_mode_param messages) ───────
    let slots = [
        { modeId: 0, simple: false, superSimple: false },
        { modeId: 0, simple: false, superSimple: false },
        { modeId: 0, simple: false, superSimple: false },
        { modeId: 0, simple: false, superSimple: false },
        { modeId: 0, simple: false, superSimple: false },
        { modeId: 0, simple: false, superSimple: false },
    ];

    let currentModeSlot = 0;
    let currentPWM      = 0;
    // Authoritative mode label received from backend (e.g. "Alt Hold")
    // Kept separately so we can display it even before slots[] is fully
    // populated with PARAM_VALUE echoes.
    let currentModeLabel = '—';

    // ── Helpers ───────────────────────────────────────────────────────────────
    function modeById(id) {
        return MODES.find(m => m.id === id) || MODES[0];
    }

    function friendlyLabel(backendName) {
        return BACKEND_TO_LABEL[backendName] || backendName;
    }

    function buildOptions(selectedId) {
        return MODES.map(m =>
            `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${m.label}</option>`
        ).join('');
    }

    function pwmToSlot(pwm) {
        for (let i = 0; i < PWM_BOUNDS.length; i++)
            if (pwm <= PWM_BOUNDS[i]) return i;
        return PWM_BOUNDS.length - 1;
    }

    // ── Save icon SVG ─────────────────────────────────────────────────────────
    const SAVE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" width="13" height="13">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
    </svg>`;

    // ── Full panel HTML ───────────────────────────────────────────────────────
    function buildHTML() {
        return `
        <div class="settings-panel-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Flight Modes
            </span>
            <div class="drone-selector-wrap-container"></div>
        </div>

        <div class="fm-wrap">

            <!-- current state ------------------------------------------------->
            <div class="fm-current-bar">
                <div class="fm-current-item">
                    <span class="fm-current-label">Current Mode</span>
                    <span class="fm-current-value" id="fmCurrentMode">
                        <span class="fm-live-dot"></span>
                        <span id="fmCurrentModeText">${currentModeLabel}</span>
                    </span>
                </div>
                <div class="fm-current-divider"></div>
                <div class="fm-current-item">
                    <span class="fm-current-label">Current PWM</span>
                    <span class="fm-current-value fm-current-pwm" id="fmCurrentPWM">${currentPWM || '—'}</span>
                </div>
            </div>

            <!-- table header --------------------------------------------------->
            <div class="fm-table-head">
                <span class="fm-th fm-th-slot"></span>
                <span class="fm-th fm-th-mode">Mode</span>
                <span class="fm-th fm-th-simple">Simple</span>
                <span class="fm-th fm-th-super">Super Simple Mode</span>
                <span class="fm-th fm-th-pwm">PWM Range</span>
            </div>

            <!-- rows ----------------------------------------------------------->
            <div class="fm-table-body" id="fmRows">
                ${slots.map((_, i) => buildRow(i)).join('')}
            </div>

            <!-- save button ---------------------------------------------------->
            <div class="fm-footer">
                <button class="fm-save-btn" id="fmSaveBtn" onclick="FlightModes._save()">
                    ${SAVE_ICON}
                    Save Modes
                </button>
                <span class="fm-save-hint">Changes take effect after saving.</span>
            </div>

        </div>`;
    }

    function buildRow(i) {
        const s        = slots[i];
        const isActive = i === currentModeSlot;
        return `
        <div class="fm-row ${isActive ? 'fm-row--active' : ''}" id="fmRow${i}">

            <span class="fm-row-label">Flight Mode ${i + 1}</span>

            <div class="fm-select-wrap">
                <select class="fm-select ${isActive ? 'fm-select--active' : ''}"
                        data-slot="${i}"
                        onchange="FlightModes._onMode(${i}, this.value)">
                    ${buildOptions(s.modeId)}
                </select>
            </div>

            <label class="fm-check-wrap">
                <input type="checkbox" class="fm-checkbox" ${s.simple ? 'checked' : ''}
                       onchange="FlightModes._onSimple(${i}, this.checked)">
                <span class="fm-checkmark"></span>
                <span class="fm-check-text">Simple</span>
            </label>

            <label class="fm-check-wrap">
                <input type="checkbox" class="fm-checkbox" ${s.superSimple ? 'checked' : ''}
                       onchange="FlightModes._onSuperSimple(${i}, this.checked)">
                <span class="fm-checkmark"></span>
                <span class="fm-check-text">Super Simple Mode</span>
            </label>

            <span class="fm-pwm-label ${isActive ? 'fm-pwm-label--active' : ''}">${PWM_RANGES[i]}</span>

        </div>`;
    }

    // ── Partial DOM refresh ───────────────────────────────────────────────────
    function refreshRow(i) {
        const el = document.getElementById('fmRow' + i);
        if (!el) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = buildRow(i);
        el.replaceWith(tmp.firstElementChild);
    }

    function refreshHeader() {
        // Use the in-place span update so we don't destroy the live-dot element
        const textEl = document.getElementById('fmCurrentModeText');
        const pwmEl  = document.getElementById('fmCurrentPWM');
        if (textEl) textEl.textContent = currentModeLabel;
        if (pwmEl)  pwmEl.textContent  = currentPWM ? `${currentModeSlot + 1}: ${currentPWM}` : '—';
    }

    // ── Event handlers ────────────────────────────────────────────────────────
    function _onMode(slotIdx, val) {
        slots[slotIdx].modeId = parseInt(val, 10);
        refreshRow(slotIdx);
        // Don't refresh header — user is editing, not the vehicle changing mode
    }

    function _onSimple(slotIdx, checked) {
        slots[slotIdx].simple = checked;
    }

    function _onSuperSimple(slotIdx, checked) {
        slots[slotIdx].superSimple = checked;
    }

    // ── Save: send to GCS via WebSocket ──────────────────────────────────────
    // NOTE: only ONE definition of _save — the previous file had TWO, and the
    // dummy (setTimeout) version at line ~203 was running instead of this one.
    function _save() {
        const btn = document.getElementById('fmSaveBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = SAVE_ICON + ' Saving…';
        }

        const modes = slots.map(s => s.modeId);

        const ws = window.ws || window.socket || window.GCS?.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            if (window.sendToSelected) {
                window.sendToSelected({ type: 'save_flight_modes', modes });
                console.log('[FlightModes] Broadcasted save_flight_modes:', modes);
            } else {
                ws.send(JSON.stringify({ type: 'save_flight_modes', modes }));
                console.log('[FlightModes] Sent save_flight_modes:', modes);
            }
            
            // Button will be re-enabled by the flight_mode_saved WS message.
            // Fallback: re-enable after 5 s in case the echo never arrives.
            setTimeout(() => {
                const b = document.getElementById('fmSaveBtn');
                if (b && b.disabled) {
                    b.disabled = false;
                    b.innerHTML = SAVE_ICON + ' Save Modes';
                    console.warn('[FlightModes] Save confirmation timeout — button re-enabled');
                }
            }, 5000);
        } else {
            console.warn('[FlightModes] WebSocket not open — cannot save');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = SAVE_ICON + ' Save Modes';
            }
            window.SwUtil && window.SwUtil.toast('Not connected — modes not saved', true);
        }
    }

    // ── WebSocket message handler ─────────────────────────────────────────────
    // Wire this up in your global WS onmessage dispatcher:
    //   case 'flight_mode_status':
    //   case 'flight_mode_pwm':
    //   case 'flight_mode_param':
    //   case 'flight_mode_saved':   FlightModes.onMessage(data); break;
    function onMessage(data) {
        const type = data.type;

        // ── flight_mode_status — authoritative mode + slot from backend ───────
        // This is sent by the C++ backend on every RC switch change AND on
        // every heartbeat. The mode name comes directly from the backend's
        // slotModes_ cache so it is always correct.
        if (type === 'flight_mode_status') {
            currentPWM   = data.pwm;

            const newSlot = data.slot !== undefined ? data.slot : pwmToSlot(data.pwm);
            const prev    = currentModeSlot;
            currentModeSlot = newSlot;

            // ── KEY FIX: use the mode NAME from the backend directly ──────────
            // Previously the header was rebuilt from slots[currentModeSlot].modeId
            // which was still 0 (STABILIZE) until flight_mode_param messages
            // arrived. Now we display exactly what the backend reports.
            if (data.mode) {
                currentModeLabel = friendlyLabel(data.mode);
                // Also keep the slots[] array consistent so dropdown highlights
                // stay correct. Convert backend name → mode id via MODES table.
                const backendId = MODES.find(m => m.label === currentModeLabel)?.id
                               ?? MODES.find(m => BACKEND_TO_LABEL[data.mode] === m.label)?.id;
                if (backendId !== undefined) {
                    slots[newSlot].modeId = backendId;
                }
            }

            if (prev !== newSlot) {
                refreshRow(prev);
                refreshRow(newSlot);
            }
            refreshHeader();
        }

        // ── flight_mode_pwm — raw PWM update (slot highlight + PWM display) ──
        else if (type === 'flight_mode_pwm') {
            currentPWM = data.pwm;
            const newSlot = data.slot !== undefined ? data.slot : pwmToSlot(data.pwm);
            const prev    = currentModeSlot;
            currentModeSlot = newSlot;
            if (prev !== newSlot) {
                refreshRow(prev);
                refreshRow(newSlot);
            }
            // Don't update currentModeLabel here — wait for flight_mode_status
            // which always follows this message from the C++ backend.
            refreshHeader();
        }

        // ── flight_mode_param — FLTMODE1-6 echo from autopilot ───────────────
        // Populates the dropdowns when the panel first opens and after a save.
        else if (type === 'flight_mode_param') {
            const i = data.slot;
            if (i >= 0 && i < slots.length) {
                slots[i].modeId = data.mode_id;
                refreshRow(i);
                // If this param is for the currently active slot, also update
                // the header label so it matches what the drone actually has.
                if (i === currentModeSlot && data.mode) {
                    currentModeLabel = friendlyLabel(data.mode);
                    refreshHeader();
                }
            }
        }

        // ── flight_mode_saved — backend confirmed the PARAM_SET was sent ─────
        else if (type === 'flight_mode_saved') {
            const btn = document.getElementById('fmSaveBtn');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = SAVE_ICON + ' Save Modes';
            }
            window.SwUtil && window.SwUtil.toast(data.message || 'Flight modes saved', false);
        }
    }

    // ── init ─────────────────────────────────────────────────────────────────
    function init() {
        const host = document.getElementById('panel-flight-modes');
        if (!host) return;
        host.innerHTML = buildHTML();
        console.log('[FlightModes] Panel initialised');

        // ── Auto-intercept global WebSocket onmessage ─────────────────────────
        // This ensures onMessage() is called even if the caller never manually
        // wires FlightModes.onMessage into their WS dispatcher.
        // We patch window.ws / window.socket / window.GCS.ws onmessage so that
        // flight_mode_* messages are always routed here.
        _installWsIntercept();
    }

    // Installs a thin wrapper around the existing ws.onmessage so we receive
    // every message without removing the original handler.
    // Called by init() and retried every 500 ms until a WS object is found.
    let _interceptInstalled = false;
    function _installWsIntercept() {
        if (_interceptInstalled) return;

        const ws = window.ws || window.socket || window.GCS?.ws;
        if (!ws) {
            // WS not ready yet — retry shortly
            setTimeout(_installWsIntercept, 500);
            return;
        }

        const original = ws.onmessage || null;
        ws.onmessage = function (event) {
            // Call the original handler first
            if (original) original.call(this, event);

            // Then route to FlightModes if it's a flight_mode_* message
            try {
                const data = JSON.parse(event.data);
                const t = data && data.type;
                if (t === 'flight_mode_status' ||
                    t === 'flight_mode_pwm'    ||
                    t === 'flight_mode_param'  ||
                    t === 'flight_mode_saved')
                {
                    onMessage(data);
                }
            } catch (_) { /* not JSON or not for us */ }
        };

        _interceptInstalled = true;
        console.log('[FlightModes] WS onmessage intercept installed');
    }

    window.FlightModes = { init, onMessage, _onMode, _onSimple, _onSuperSimple, _save };
    console.log('✅ FlightModes panel ready');

})();