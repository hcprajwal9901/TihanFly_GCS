/**
 * Plan Flight Mode - Polygon Actions Module
 * Handles: Draw Polygon, Edit Polygon, Survey Settings, Clear Polygon
 */

PlanFlightMode.prototype.handlePolygonActions = function(action) {
    console.log(`🔷 Polygon action: ${action}`);
    
    switch(action) {
        case 'draw-polygon':
            this.drawPolygon();
            break;
            
        case 'survey-pattern':
            this.showSurveyPattern();
            break;
            
        case 'survey-settings':
            this.showSurveySettings();
            break;
            
        case 'clear-polygon':
            this.clearPolygon();
            break;
            
        default:
            console.warn(`Unknown polygon action: ${action}`);
    }
};

// ========================================================================
// DRAW POLYGON
// ========================================================================

PlanFlightMode.prototype.drawPolygon = function() {
    console.log('🔷 Starting polygon drawing...');
    
    if (!window.PolygonManager) {
        console.error('❌ PolygonManager not initialized!');
        if (window.MsgConsole) {
            window.MsgConsole.error('Polygon system not ready');
        }
        return;
    }
    
    // Cancel any existing drawing session or waypoint mode first
    if (window.PolygonManager.isDrawing) {
        window.PolygonManager.cancelDrawing();
    }
    if (window.WaypointManager && window.WaypointManager.currentMode) {
        window.WaypointManager.cancelCurrentOperation();
    }

    window.PolygonManager.startDrawing();
    
    if (window.MsgConsole) {
        window.MsgConsole.success('🔷 Click map to place vertices — drag to adjust — Enter to finish — ESC to cancel');
    }
};

// ========================================================================
// SURVEY PATTERN
// ========================================================================

PlanFlightMode.prototype.showSurveyPattern = function() {
    console.log('📐 Opening survey pattern...');
    
    if (!window.PolygonManager) {
        console.error('❌ PolygonManager not initialized!');
        if (window.MsgConsole) {
            window.MsgConsole.error('Polygon system not ready');
        }
        return;
    }
    
    window.PolygonManager.showSurveyPatternModal();
};

// ========================================================================
// SURVEY SETTINGS
// ========================================================================

PlanFlightMode.prototype.showSurveySettings = function() {
    console.log('⚙️ Opening survey settings...');
    
    if (!window.PolygonManager) {
        console.error('❌ PolygonManager not initialized!');
        if (window.MsgConsole) {
            window.MsgConsole.error('Polygon system not ready');
        }
        return;
    }
    
    this.showSurveySettingsModal();
};

PlanFlightMode.prototype.showSurveySettingsModal = function() {
    if (!window.PolygonManager) {
        console.error('❌ PolygonManager not available');
        return;
    }

    const s = window.PolygonManager.surveySettings;

    // Remove any existing modal
    const existing = document.getElementById('surveySettingsModal');
    if (existing) existing.remove();

    // ── Shared input style ─────────────────────────────────────────────────
    const inp = 'width:100%;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(230,0,126,0.45);border-radius:6px;color:#fff;font-size:15px;box-sizing:border-box;';
    const inpRO = 'width:100%;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#888;font-size:15px;box-sizing:border-box;cursor:not-allowed;';
    const lbl = 'display:block;color:#ccc;font-size:13px;margin-bottom:6px;';
    const lblDim = 'display:block;color:#888;font-size:13px;margin-bottom:6px;';
    const row = 'margin-bottom:16px;';

    const initSpacing = s.spacing && s.spacing > 0 ? s.spacing.toFixed(1) : '0';

    const modal = document.createElement('div');
    modal.id = 'surveySettingsModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:10000;';

    modal.innerHTML = `
        <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,0.55);width:92%;max-width:500px;max-height:93vh;overflow-y:auto;border:2px solid rgba(230,0,126,0.38);font-family:'Inter',Arial,sans-serif;">

            <!-- Header -->
            <div style="padding:18px 22px 14px;border-bottom:1px solid rgba(230,0,126,0.2);">
                <span style="font-size:19px;color:#fff;font-weight:700;">⚙️ Survey Settings</span>
            </div>

            <div style="padding:20px 22px;">

                <!-- Altitude -->
                <div style="${row}">
                    <label style="${lbl}">Altitude (m)</label>
                    <input type="number" id="ss-altitude" value="${s.altitude}" min="1" max="500" step="1" style="${inp}">
                </div>

                <!-- H-FOV -->
                <div style="${row}">
                    <label style="${lbl}">Camera H-FOV (°) &ndash; Horizontal field of view</label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="number" id="ss-hfov" value="${s.hFov || 120}" min="10" max="170" step="1" style="flex:1;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(230,0,126,0.45);border-radius:6px;color:#fff;font-size:15px;">
                        <span style="color:#888;font-size:12px;white-space:nowrap;">degrees</span>
                    </div>
                </div>

                <!-- V-FOV -->
                <div style="${row}">
                    <label style="${lbl}">Camera V-FOV (°) &ndash; Vertical field of view</label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="number" id="ss-vfov" value="${s.vFov || 90}" min="10" max="170" step="1" style="flex:1;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(230,0,126,0.45);border-radius:6px;color:#fff;font-size:15px;">
                        <span style="color:#888;font-size:12px;white-space:nowrap;">degrees</span>
                    </div>
                </div>

                <!-- Footprint live panel -->
                <div id="ss-footprint" style="background:rgba(0,0,0,0.35);border:1px solid rgba(0,220,120,0.28);border-radius:9px;padding:13px 16px;margin-bottom:16px;font-size:12px;color:#ccc;line-height:1.75;">
                    <div style="color:#4fc;font-weight:700;margin-bottom:6px;">📷 Camera Footprint:</div>
                    <div>Width (cross-track):&nbsp;&nbsp;<span id="ss-fw" style="color:#fff;font-weight:600;">—</span></div>
                    <div>Height (along-track):&nbsp;<span id="ss-fh" style="color:#fff;font-weight:600;">—</span></div>
                    <div>Total coverage area:&nbsp;&nbsp;<span id="ss-fa" style="color:#fff;font-weight:600;">—</span></div>
                    <div style="margin-top:8px;color:#ffb347;font-weight:700;">↔ Sidelap (cross-track):</div>
                    <div>Strip: <span id="ss-sl-strip">—</span> &nbsp;|&nbsp; <span id="ss-sl-pct">—</span>%</div>
                    <div>Overlap area: <span id="ss-sl-area">—</span> m² out of <span id="ss-ta2">—</span> m²</div>
                    <div style="margin-top:8px;color:#87ceeb;font-weight:700;">⇒ Forward Overlap (along-track):</div>
                    <div>Strip: <span id="ss-fwd-strip">—</span> &nbsp;|&nbsp; <span id="ss-fwd-pct">—</span>%</div>
                    <div>Fwd overlap area: <span id="ss-fwd-area">—</span> m² out of <span id="ss-ta3">—</span> m²</div>
                    <div style="margin-top:8px;color:#ff9ecd;font-weight:700;">📸 Camera trigger every: <span id="ss-trigger">—</span></div>
                </div>

                <!-- Line Spacing -->
                <div style="${row}">
                    <label style="${lbl}">Line Spacing (m) &ndash; Gap between survey lines</label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="number" id="ss-spacing" value="${initSpacing}" min="0.5" step="0.1" style="flex:1;padding:10px 12px;background:rgba(255,255,255,0.07);border:1px solid rgba(230,0,126,0.45);border-radius:6px;color:#fff;font-size:15px;">
                        <span style="color:#888;font-size:12px;white-space:nowrap;">meters</span>
                    </div>
                    <div style="font-size:11px;color:#f0a500;margin-top:4px;">💡 Smaller = closer lines, more coverage</div>
                </div>

                <!-- Overlap -->
                <div style="${row}">
                    <label style="${lbl}">Overlap (%) &ndash; Forward image overlap</label>
                    <input type="number" id="ss-overlap" value="${s.overlap}" min="0" max="95" step="1" style="${inp}">
                </div>

                <!-- Sidelap (read-only) -->
                <div style="${row}">
                    <label style="${lblDim}">Sidelap (%) &ndash; Auto-calculated from Line Spacing</label>
                    <input type="number" id="ss-sidelap" value="${s.sidelap}" readonly style="${inpRO}">
                </div>

                <!-- Grid Angle -->
                <div style="${row}">
                    <label style="${lbl}">Grid Angle (°)</label>
                    <input type="number" id="ss-angle" value="${s.angle}" min="0" max="359" step="1" style="${inp}">
                </div>

                <!-- Speed -->
                <div style="margin-bottom:20px;">
                    <label style="${lbl}">Speed (m/s)</label>
                    <input type="number" id="ss-speed" value="${s.speed}" min="1" max="30" step="0.5" style="${inp}">
                </div>
            </div>

            <!-- Buttons -->
            <div style="padding:14px 22px 18px;border-top:1px solid rgba(230,0,126,0.2);display:flex;gap:12px;">
                <button id="ss-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
                <button id="ss-apply" style="flex:2;padding:12px;background:linear-gradient(135deg,#E6007E,#C4006A);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">Apply &amp; Regenerate</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // ── Live calculation engine ──────────────────────────────────────────────
    function recalc(autoSpacing) {
        const alt     = parseFloat(document.getElementById('ss-altitude').value) || 50;
        const hFov    = parseFloat(document.getElementById('ss-hfov').value)     || 120;
        const vFov    = parseFloat(document.getElementById('ss-vfov').value)     || 90;
        const overlap = parseFloat(document.getElementById('ss-overlap').value)  || 70;

        // Footprint
        const fw = 2 * alt * Math.tan((hFov / 2) * Math.PI / 180);
        const fh = 2 * alt * Math.tan((vFov / 2) * Math.PI / 180);
        const fa = fw * fh;

        // Auto-set spacing when FOV/alt changes
        if (autoSpacing) {
            const curSidelap = parseFloat(document.getElementById('ss-sidelap').value) || 60;
            document.getElementById('ss-spacing').value = (fw * (1 - curSidelap / 100)).toFixed(1);
        }

        // Derive sidelap from current spacing
        let spacing = parseFloat(document.getElementById('ss-spacing').value) || fw * 0.4;
        spacing = Math.max(0.5, spacing);
        const sidelap = Math.max(0, Math.min(99, (1 - spacing / fw) * 100));

        // Sidelap areas
        const slStrip = fw * sidelap / 100;
        const slArea  = slStrip * fh;

        // Forward overlap
        const fwdStrip = fh * overlap / 100;
        const fwdArea  = fwdStrip * fw;
        const trigger  = fh * (1 - overlap / 100);

        // Update footprint panel
        document.getElementById('ss-fw').textContent       = fw.toFixed(2) + ' m';
        document.getElementById('ss-fh').textContent       = fh.toFixed(2) + ' m';
        document.getElementById('ss-fa').textContent       = fa.toFixed(1) + ' m²';
        document.getElementById('ss-sl-strip').textContent = slStrip.toFixed(2) + ' m';
        document.getElementById('ss-sl-pct').textContent   = sidelap.toFixed(1);
        document.getElementById('ss-sl-area').textContent  = slArea.toFixed(1);
        document.getElementById('ss-ta2').textContent      = fa.toFixed(1);
        document.getElementById('ss-fwd-strip').textContent= fwdStrip.toFixed(2) + ' m';
        document.getElementById('ss-fwd-pct').textContent  = overlap.toFixed(0);
        document.getElementById('ss-fwd-area').textContent = fwdArea.toFixed(1);
        document.getElementById('ss-ta3').textContent      = fa.toFixed(1);
        document.getElementById('ss-trigger').textContent  = trigger.toFixed(2) + ' m';

        // Update sidelap display
        document.getElementById('ss-sidelap').value = sidelap.toFixed(1);
    }

    // Wire events
    document.getElementById('ss-altitude').addEventListener('input', () => recalc(true));
    document.getElementById('ss-hfov').addEventListener('input',     () => recalc(true));
    document.getElementById('ss-vfov').addEventListener('input',     () => recalc(false));
    document.getElementById('ss-overlap').addEventListener('input',  () => recalc(false));
    document.getElementById('ss-spacing').addEventListener('input',  () => recalc(false));

    // Initial calculation
    recalc(initSpacing === '0');

    // Cancel
    document.getElementById('ss-cancel').addEventListener('click', () => modal.remove());

    // Apply
    document.getElementById('ss-apply').addEventListener('click', () => {
        const pm = window.PolygonManager;
        pm.surveySettings.altitude = parseFloat(document.getElementById('ss-altitude').value) || 50;
        pm.surveySettings.hFov     = parseFloat(document.getElementById('ss-hfov').value)     || 120;
        pm.surveySettings.vFov     = parseFloat(document.getElementById('ss-vfov').value)     || 90;
        pm.surveySettings.overlap  = parseFloat(document.getElementById('ss-overlap').value)  || 70;
        pm.surveySettings.sidelap  = parseFloat(document.getElementById('ss-sidelap').value)  || 60;
        pm.surveySettings.spacing  = parseFloat(document.getElementById('ss-spacing').value)  || 10;
        pm.surveySettings.angle    = parseFloat(document.getElementById('ss-angle').value)    || 0;
        pm.surveySettings.speed    = parseFloat(document.getElementById('ss-speed').value)    || 10;

        pm.generateSurveyGrid();
        modal.remove();

        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Survey settings applied and grid regenerated');
        }
    });

    // Dismiss on backdrop click
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
};

// ========================================================================
// CLEAR POLYGON
// ========================================================================

PlanFlightMode.prototype.clearPolygon = function() {
    console.log('🗑️ Clearing polygon...');
    
    if (!window.PolygonManager) {
        console.error('❌ PolygonManager not initialized!');
        if (window.MsgConsole) {
            window.MsgConsole.error('Polygon system not ready');
        }
        return;
    }
    
    const confirm = window.confirm('Clear the current polygon and survey grid?');
    if (!confirm) {
        console.log('❌ Clear polygon cancelled');
        return;
    }
    
    window.PolygonManager.clearPolygon();
    
    if (window.MsgConsole) {
        window.MsgConsole.success('✅ Polygon cleared');
    }
    
    console.log('✅ Polygon cleared');
};

console.log('✅ Plan Flight Polygon Actions Module Loaded');