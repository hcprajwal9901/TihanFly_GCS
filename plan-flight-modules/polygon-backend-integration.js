/**
 * POLYGON INTEGRATION
 * Adds export and import functionality to the existing PolygonManager
 * Include this file AFTER polygon-manager.js
 */

console.log('🔷 Loading Polygon Integration...');

// Wait for PolygonManager to be initialized
(function() {
    let checkInterval = setInterval(() => {
        if (window.PolygonManager) {
            clearInterval(checkInterval);
            initializePolygonExtensions();
        }
    }, 100);
    
    setTimeout(() => {
        clearInterval(checkInterval);
        console.error('❌ PolygonManager not found after 10 seconds');
    }, 10000);
})();

function initializePolygonExtensions() {
    console.log('✅ PolygonManager found, adding extensions...');
    
    const pm = window.PolygonManager;
    
    // Store original methods
    const originalFinishDrawing = pm.finishDrawing.bind(pm);
    const originalGenerateSurveyGrid = pm.generateSurveyGrid.bind(pm);
    const originalApplySurveySettings = pm.applySurveySettings.bind(pm);
    const originalClearPolygon = pm.clearPolygon.bind(pm);

    // ========================================================================
    // ENHANCED FINISH DRAWING
    // ========================================================================

    pm.finishDrawing = function() {
        console.log('🔷 finishDrawing called');
        originalFinishDrawing();

        if (pm.currentPolygon && pm.polygonPoints.length >= 3) {
            if (window.MsgConsole) {
                window.MsgConsole.info('🔷 Polygon drawing complete');
            }
        }
    };

    // ========================================================================
    // ENHANCED GENERATE GRID
    // ========================================================================

    pm.generateSurveyGrid = function() {
        console.log('🔷 generateSurveyGrid called');
        originalGenerateSurveyGrid();

        if (pm.currentPolygon && pm.surveyGrid.length > 0) {
            if (window.MsgConsole) {
                window.MsgConsole.success(`✅ Grid: ${pm.surveyGrid.length} waypoints`);
            }
        }
    };

    // ========================================================================
    // ENHANCED APPLY SETTINGS
    // ========================================================================

    pm.applySurveySettings = function() {
        console.log('🔷 applySurveySettings called');

        if (document.getElementById('surveyAlt')) {
            pm.surveySettings.altitude = parseFloat(document.getElementById('surveyAlt').value);
            pm.surveySettings.overlap = parseFloat(document.getElementById('surveyOverlap').value);
            pm.surveySettings.sidelap = parseFloat(document.getElementById('surveySidelap').value);
            pm.surveySettings.angle = parseFloat(document.getElementById('surveyAngle').value);
            pm.surveySettings.speed = parseFloat(document.getElementById('surveySpeed').value);
        }

        pm.closeSurveySettings();

        setTimeout(() => {
            pm.generateSurveyGrid();
        }, 300);

        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Settings updated');
        }
    };

    // ========================================================================
    // ENHANCED CLEAR POLYGON
    // ========================================================================

    pm.clearPolygon = function() {
        console.log('🔷 clearPolygon called');

        const wm = window.WaypointManager;

        if (wm && Array.isArray(wm.waypoints) && wm.tmap) {

            // Build a coordinate lookup from the current surveyGrid
            // (must happen BEFORE originalClearPolygon wipes it)
            const gridCoords = new Set();
            if (pm.surveyGrid && pm.surveyGrid.length > 0) {
                pm.surveyGrid.forEach(p => {
                    gridCoords.add(`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`);
                });
            }

            const toKeep = [];
            let removed = 0;

            wm.waypoints.forEach(wp => {
                const coordKey  = `${wp.lat.toFixed(6)},${wp.lng.toFixed(6)}`;
                const byCoord   = gridCoords.size > 0 && gridCoords.has(coordKey);
                const bySource  = wp.source === 'polygon';
                const byIdList  = pm.createdWaypointIds &&
                                  pm.createdWaypointIds.includes(wp.id);

                if (byCoord || bySource || byIdList) {
                    // Remove the Leaflet marker directly from the map layer
                    if (wp.marker) {
                        try {
                            wm.tmap.markerLayer.removeLayer(wp.marker);
                            const i = wm.tmap.markers.indexOf(wp.marker);
                            if (i > -1) wm.tmap.markers.splice(i, 1);
                        } catch(e) {
                            console.warn('[Integration] marker removal error:', e);
                        }
                    }
                    removed++;
                } else {
                    toKeep.push(wp);
                }
            });

            if (removed > 0) {
                wm.waypoints = toKeep;
                if (typeof wm.updateRoute === 'function') wm.updateRoute();
                if (typeof wm.updateStats === 'function') wm.updateStats();
                if (window.CommandEditor && window.CommandEditor.refreshWaypoints) {
                    window.CommandEditor.refreshWaypoints();
                }
                console.log(`✅ [Integration] Removed ${removed} polygon waypoint(s)`);
            } else {
                console.warn('[Integration] No waypoints matched for removal');
            }
        }

        // Reset ID tracking
        if (pm.createdWaypointIds) pm.createdWaypointIds = [];

        // originalClearPolygon clears surveyGrid, polygonLayer, tempElements
        originalClearPolygon();

        if (window.MsgConsole) {
            window.MsgConsole.info('Polygon and survey waypoints cleared');
        }
    };

    // ========================================================================
    // EXPORT POLYGON
    // ========================================================================

    pm.exportPolygonData = function() {
        console.log('📤 Exporting polygon...');

        if (!pm.currentPolygon) {
            alert('❌ No polygon to export!');
            return;
        }

        const polygonData = {
            id: pm.polygonId || `polygon_${Date.now()}`,
            points: pm.polygonPoints.map(p => ({ lat: p.lat, lng: p.lng })),
            settings: pm.surveySettings,
            grid: pm.surveyGrid.map(p => ({ lat: p.lat, lng: p.lng })),
            exported: new Date().toISOString()
        };

        const jsonString = JSON.stringify(polygonData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `polygon_survey_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Polygon exported');
        }
    };

    // ========================================================================
    // IMPORT POLYGON
    // ========================================================================

    pm.importPolygonData = function() {
        console.log('📥 Importing polygon...');

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const polygonData = JSON.parse(event.target.result);

                    if (!polygonData.points || !Array.isArray(polygonData.points)) {
                        throw new Error('Invalid polygon data');
                    }

                    if (pm.currentPolygon) {
                        const clearConfirm = window.confirm('Clear existing polygon?');
                        if (!clearConfirm) return;
                        pm.clearPolygon();
                    }

                    pm.polygonPoints = polygonData.points.map(p => L.latLng(p.lat, p.lng));
                    pm.polygonId = polygonData.id;

                    if (polygonData.settings) {
                        pm.surveySettings = polygonData.settings;
                    }

                    pm.createPolygon();

                    if (polygonData.grid && polygonData.grid.length > 0) {
                        pm.surveyGrid = polygonData.grid.map(p => L.latLng(p.lat, p.lng));
                        pm.generateSurveyGrid();
                    }

                    if (window.MsgConsole) {
                        window.MsgConsole.success('✅ Polygon imported');
                    }

                } catch (error) {
                    console.error('❌ Error importing:', error);
                    alert('❌ Failed to import polygon: ' + error.message);
                }
            };

            reader.readAsText(file);
        };

        input.click();
    };

    console.log('✅ Polygon extensions loaded');
    console.log('📋 Available methods:');
    console.log('   - PolygonManager.exportPolygonData()');
    console.log('   - PolygonManager.importPolygonData()');
}

// ============================================================================
// GLOBAL HELPER FUNCTIONS
// ============================================================================

window.exportPolygon = function() {
    if (window.PolygonManager) {
        window.PolygonManager.exportPolygonData();
    } else {
        alert('❌ Polygon Manager not ready');
    }
};

window.importPolygon = function() {
    if (window.PolygonManager) {
        window.PolygonManager.importPolygonData();
    } else {
        alert('❌ Polygon Manager not ready');
    }
};

console.log('✅ Polygon Integration Loaded');
console.log('💡 Include this AFTER polygon-manager.js in your HTML');