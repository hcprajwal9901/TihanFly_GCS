/**
 * Data Persistence Module - COMPLETE VERSION
 * Saves and restores EVERYTHING including:
 * - Plan Flight Mode state
 * - Waypoints and mission data
 * - Compass state
 * - Weather dashboard state
 * - Command Editor state
 * - Map position and zoom
 * 
 * INSTANT loading with no visual flash!
 */

console.log('💾 Data Persistence Module Loading (COMPLETE)...');

class DataPersistence {
    constructor() {
        this.STORAGE_KEY = 'mission_flight_data_complete';
        this.AUTO_SAVE_INTERVAL = 2000;
        this.autoSaveTimer = null;
        this.restorationInProgress = false;
        
        // ✅ CHECK AND APPLY PLAN MODE IMMEDIATELY
        this.preActivatePlanModeIfNeeded();
        
        this.initialize();
    }

    // ========================================================================
    // PRE-ACTIVATION - RUNS BEFORE PAGE FULLY LOADS
    // ========================================================================
    
    preActivatePlanModeIfNeeded() {
        try {
            const savedData = localStorage.getItem(this.STORAGE_KEY);
            
            if (!savedData) {
                console.log('💾 No saved data, normal page load');
                return;
            }
            
            const data = JSON.parse(savedData);
            
            if (data.uiState && data.uiState.isPlanModeActive) {
                console.log('🎯 INSTANT MODE: Plan Mode was active, pre-hiding elements...');
                
                // ✅ Add CSS class to body IMMEDIATELY to hide elements
                document.documentElement.classList.add('plan-mode-preload');
                
                // ✅ Inject instant CSS to hide normal mode elements
                const style = document.createElement('style');
                style.id = 'plan-mode-instant-css';
                style.textContent = `
                    /* Hide elements instantly during page load */
                    .plan-mode-preload #dropdownMenuStrip,
                    .plan-mode-preload #flightControlsStrip,
                    .plan-mode-preload .minimal-console-container,
                    .plan-mode-preload #tihanLogo,
                    .plan-mode-preload .status-badge {
                        display: none !important;
                    }
                    
                    /* Show Plan Mode elements instantly */
                    .plan-mode-preload #planFlightMenuStrip {
                        display: flex !important;
                    }
                    
                    .plan-mode-preload #commandEditorPanel {
                        display: flex !important;
                    }
                    
                    /* Position weather dashboard */
                    .plan-mode-preload #weatherDashboard {
                        top: auto !important;
                        bottom: 20px !important;
                        right: auto !important;
                        left: 110px !important;
                    }
                    
                    /* Show compass if it was visible */
                    ${data.compassState?.visible ? `
                    .plan-mode-preload .compass-telemetry-container {
                        display: block !important;
                    }
                    ` : ''}
                `;
                document.head.appendChild(style);
                
                console.log('✅ Instant Plan Mode CSS applied');
            }
        } catch (error) {
            console.error('❌ Error in pre-activation:', error);
        }
    }

    initialize() {
        console.log('💾 Initializing Data Persistence (COMPLETE)...');
        
        // Restore data on page load
        this.restoreAllData();
        
        // Start auto-save
        this.startAutoSave();
        
        // Save on page unload
        window.addEventListener('beforeunload', () => {
            console.log('💾 Page closing, saving data...');
            this.saveAllData();
        });
        
        console.log('✅ Data Persistence initialized (COMPLETE)');
    }

    // ========================================================================
    // SAVE DATA - COMPLETE VERSION
    // ========================================================================
    
    saveAllData() {
        try {
            const data = {
                version: '5.0', // Complete version
                timestamp: new Date().toISOString(),
                waypoints: this.getWaypointsData(),
                homePosition: this.getHomePositionData(),
                polygonData: this.getPolygonData(),
                uiState: this.getUIState(),
                compassState: this.getCompassState(),
                weatherState: this.getWeatherState(),
                commandEditorState: this.getCommandEditorState()
            };
            
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
            console.log('💾 Complete data saved:', {
                waypoints: data.waypoints.length,
                hasHome: !!data.homePosition,
                hasPolygon: !!data.polygonData,
                planModeActive: data.uiState.isPlanModeActive,
                compassVisible: data.compassState?.visible,
                weatherVisible: data.weatherState?.visible
            });
            
            return true;
        } catch (error) {
            console.error('❌ Error saving data:', error);
            return false;
        }
    }

    getWaypointsData() {
        if (!window.WaypointManager) {
            return [];
        }
        
        const waypoints = window.WaypointManager.getWaypoints();
        
        return waypoints.map(wp => ({
            id: wp.id,
            lat: wp.lat,
            lng: wp.lng,
            altitude: wp.altitude || 50,
            speed: wp.speed || 10,
            type: wp.type || 'waypoint'
        }));
    }

    getHomePositionData() {
        if (!window.WaypointManager) {
            return null;
        }
        
        const home = window.WaypointManager.getHomePosition();
        
        if (!home) {
            return null;
        }
        
        return {
            lat: home.lat,
            lng: home.lng,
            altitude: home.altitude || 0
        };
    }

    getPolygonData() {
        if (!window.PolygonManager) {
            return null;
        }
        
        const points = window.PolygonManager.polygonPoints;
        if (!points || points.length === 0) {
            return null;
        }
        
        return {
            vertices: points.map(v => ({
                lat: v.lat,
                lng: v.lng
            })),
            surveySettings: window.PolygonManager.surveySettings
        };
    }

    getUIState() {
        const mapCenter = this.getMapCenter();
        const mapZoom = this.getMapZoom();
        
        return {
            isPlanModeActive: window.PlanFlight ? window.PlanFlight.isActive() : false,
            showRouteLine: window.WaypointManager ? window.WaypointManager.showRouteLine : true,
            mapCenter: mapCenter,
            mapZoom: mapZoom
        };
    }

    getCompassState() {
        if (!window.compassEnhanced) {
            return { visible: false };
        }
        
        const container = document.querySelector('.compass-telemetry-container');
        const visible = container && container.style.display !== 'none';
        
        return {
            visible: visible,
            heading: window.compassEnhanced.getHeading(),
            telemetry: window.compassEnhanced.getTelemetry()
        };
    }

    getWeatherState() {
        if (!window.weatherDashboard) {
            return { visible: false };
        }
        
        return {
            visible: window.weatherDashboard.isVisible,
            currentLocation: window.weatherDashboard.getCurrentLocation()
        };
    }

    getCommandEditorState() {
        if (!window.CommandEditor) {
            return { visible: false };
        }
        
        return {
            visible: window.CommandEditor.isVisible(),
            currentTab: window.CommandEditor.currentTab || 'mission'
        };
    }

    getMapCenter() {
        if (window.tmap && window.tmap.map) {
            const center = window.tmap.map.getCenter();
            return {
                lat: center.lat,
                lng: center.lng
            };
        }
        return null;
    }

    getMapZoom() {
        if (window.tmap && window.tmap.map) {
            return window.tmap.map.getZoom();
        }
        return 13;
    }

    // ========================================================================
    // RESTORE DATA - COMPLETE VERSION
    // ========================================================================
    
    restoreAllData() {
        try {
            const savedData = localStorage.getItem(this.STORAGE_KEY);
            
            if (!savedData) {
                console.log('💾 No saved data found');
                return false;
            }
            
            const data = JSON.parse(savedData);
            console.log('💾 ========================================');
            console.log('💾 COMPLETE RESTORATION');
            console.log('💾 ========================================');
            console.log('💾 Version:', data.version);
            console.log('💾 Timestamp:', data.timestamp);
            console.log('💾 Waypoints:', data.waypoints?.length || 0);
            console.log('💾 Home:', !!data.homePosition);
            console.log('💾 Plan Mode Active:', data.uiState?.isPlanModeActive);
            console.log('💾 Compass Visible:', data.compassState?.visible);
            console.log('💾 Weather Visible:', data.weatherState?.visible);
            console.log('💾 ========================================');
            
            this.restorationInProgress = true;
            
            // Wait for everything to be ready
            this.waitForEverything().then(() => {
                console.log('💾 All systems ready, starting restoration...');
                
                // Step 1: Restore map position
                if (data.uiState?.mapCenter && data.uiState?.mapZoom) {
                    this.restoreMapPosition(data.uiState.mapCenter, data.uiState.mapZoom);
                }
                
                // Step 2: If Plan Mode should be active, activate it FIRST
                if (data.uiState && data.uiState.isPlanModeActive) {
                    this.activatePlanModeInstantly(data.uiState);
                }
                
                // Step 3: Restore waypoints
                if (data.waypoints && data.waypoints.length > 0) {
                    this.restoreWaypointsFixed(data.waypoints).then(() => {
                        console.log('✅ Waypoints restoration complete');
                        
                        // Step 4: Restore home position
                        if (data.homePosition) {
                            setTimeout(() => {
                                this.restoreHomePosition(data.homePosition);
                            }, 300);
                        }
                        
                        // Step 5: Restore polygon
                        if (data.polygonData) {
                            setTimeout(() => {
                                this.restorePolygon(data.polygonData);
                            }, 600);
                        }
                        
                        // Step 6: Restore compass state
                        if (data.compassState) {
                            setTimeout(() => {
                                this.restoreCompassState(data.compassState);
                            }, 800);
                        }
                        
                        // Step 7: Restore weather state
                        if (data.weatherState) {
                            setTimeout(() => {
                                this.restoreWeatherState(data.weatherState);
                            }, 900);
                        }
                        
                        // Step 8: Restore command editor state
                        if (data.commandEditorState) {
                            setTimeout(() => {
                                this.restoreCommandEditorState(data.commandEditorState);
                            }, 1000);
                        }
                        
                        // Step 9: Final cleanup
                        setTimeout(() => {
                            this.finalizePlanModeRestoration(data.uiState);
                            this.restorationInProgress = false;
                        }, 1200);
                    });
                } else {
                    console.log('ℹ️ No waypoints to restore');
                    
                    // Still restore other components
                    if (data.homePosition) {
                        setTimeout(() => this.restoreHomePosition(data.homePosition), 300);
                    }
                    if (data.compassState) {
                        setTimeout(() => this.restoreCompassState(data.compassState), 500);
                    }
                    if (data.weatherState) {
                        setTimeout(() => this.restoreWeatherState(data.weatherState), 600);
                    }
                    if (data.commandEditorState) {
                        setTimeout(() => this.restoreCommandEditorState(data.commandEditorState), 700);
                    }
                    
                    setTimeout(() => {
                        this.finalizePlanModeRestoration(data.uiState);
                        this.restorationInProgress = false;
                    }, 1000);
                }
            });
            
            return true;
        } catch (error) {
            console.error('❌ Error restoring data:', error);
            this.restorationInProgress = false;
            return false;
        }
    }

    async waitForEverything() {
        console.log('⏳ Waiting for all systems to be ready...');
        
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 100;
            
            const checkInterval = setInterval(() => {
                attempts++;
                
                const tmapReady = window.tmap && window.tmap.map;
                const waypointReady = window.WaypointManager && window.WaypointManager.tmap;
                const polygonReady = window.PolygonManager;
                const planFlightReady = window.PlanFlight;
                
                if (attempts % 10 === 0) {
                    console.log(`⏳ Attempt ${attempts}/${maxAttempts}:`, {
                        tmap: !!tmapReady,
                        waypoint: !!waypointReady,
                        polygon: !!polygonReady,
                        planFlight: !!planFlightReady,
                        compass: !!window.compassEnhanced,
                        weather: !!window.weatherDashboard,
                        commandEditor: !!window.CommandEditor
                    });
                }
                
                if (tmapReady && waypointReady && polygonReady && planFlightReady) {
                    clearInterval(checkInterval);
                    console.log('✅ Core systems ready!');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    console.warn('⚠️ Timeout waiting for systems, proceeding anyway...');
                    resolve();
                }
            }, 50);
        });
    }

    // ========================================================================
    // INSTANT PLAN MODE ACTIVATION
    // ========================================================================
    
    activatePlanModeInstantly(uiState) {
        console.log('🎯 INSTANT ACTIVATION: Entering Plan Mode immediately...');
        
        if (!window.PlanFlight) {
            console.error('❌ PlanFlight not available');
            return;
        }
        
        if (window.PlanFlight.isActive()) {
            console.log('ℹ️ Plan Mode already active from CSS, updating state only');
            return;
        }
        
        window.PlanFlight.enter();
        console.log('✅ Plan Mode activated instantly!');
    }

    finalizePlanModeRestoration(uiState) {
        console.log('🎯 Finalizing restoration...');
        
        // Remove the preload class
        document.documentElement.classList.remove('plan-mode-preload');
        
        // Remove instant CSS
        const instantCSS = document.getElementById('plan-mode-instant-css');
        if (instantCSS) {
            instantCSS.remove();
        }
        
        // Force Command Editor refresh
        if (window.CommandEditor && window.CommandEditor.refreshWaypoints) {
            setTimeout(() => {
                console.log('🔄 Final Command Editor refresh...');
                // Ensure WaypointManager is wired before refreshing
                if (window.CommandEditor.setWaypointManager && window.WaypointManager) {
                    window.CommandEditor.setWaypointManager(window.WaypointManager);
                }
                window.CommandEditor.refreshWaypoints();
            }, 200);
        }
        
        // Restore route line visibility
        if (window.WaypointManager && uiState.showRouteLine !== undefined) {
            window.WaypointManager.showRouteLine = uiState.showRouteLine;
            window.WaypointManager.updateRoute();
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success('💾 Complete system state restored');
        }
        
        console.log('✅ Complete restoration finalized');
        console.log('💾 ========================================');
        console.log('💾 COMPLETE RESTORATION FINISHED!');
        console.log('💾 ========================================');
    }

    // ========================================================================
    // RESTORATION METHODS
    // ========================================================================
    
    restoreMapPosition(center, zoom) {
        if (window.tmap && window.tmap.map) {
            // Check if the drone has already established a live position
            if (window.droneMapSnapped) {
                console.log(`🛡️ Skipping restore map position — drone GPS is already active`);
                return;
            }
            console.log(`📍 Restoring map: [${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}] zoom ${zoom}`);
            window.tmap.map.setView([center.lat, center.lng], zoom);
            console.log('✅ Map position restored');
        }
    }

    async restoreWaypointsFixed(waypoints) {
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            return;
        }
        
        console.log(`💾 Starting restoration of ${waypoints.length} waypoints...`);
        
        // Clear existing waypoints silently
        const oldWaypoints = [...window.WaypointManager.waypoints];
        oldWaypoints.forEach(wp => {
            if (wp.marker) {
                window.WaypointManager.tmap.removeMarker(wp.marker);
            }
        });
        window.WaypointManager.waypoints = [];
        window.WaypointManager.waypointCounter = 0;
        window.WaypointManager.tmap.clearRoute();
        
        // Add waypoints one by one
        return new Promise((resolve) => {
            let restored = 0;
            
            waypoints.forEach((wp, index) => {
                setTimeout(() => {
                    console.log(`💾 Restoring waypoint ${index + 1}/${waypoints.length}`);
                    
                    window.WaypointManager.addWaypoint(
                        wp.lat,
                        wp.lng,
                        wp.altitude,
                        wp.speed
                    );
                    
                    restored++;
                    
                    if (restored === waypoints.length) {
                        console.log(`✅ All ${waypoints.length} waypoints restored!`);
                        
                        window.WaypointManager.updateRoute();
                        window.WaypointManager.updateStats();
                        
                        if (window.CommandEditor && window.CommandEditor.refreshWaypoints) {
                            setTimeout(() => {
                                // Ensure WaypointManager is wired before refreshing
                                if (window.CommandEditor.setWaypointManager && window.WaypointManager) {
                                    window.CommandEditor.setWaypointManager(window.WaypointManager);
                                }
                                window.CommandEditor.refreshWaypoints();
                            }, 100);
                        }
                        
                        resolve();
                    }
                }, index * 80);
            });
        });
    }

    restoreHomePosition(home) {
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            return;
        }
        
        console.log(`💾 Restoring home: [${home.lat.toFixed(6)}, ${home.lng.toFixed(6)}]`);
        window.WaypointManager.setHomePosition(home.lat, home.lng);
        console.log('✅ Home position restored');
    }

    restorePolygon(polygonData) {
        if (!window.PolygonManager) {
            console.error('❌ PolygonManager not available');
            return;
        }
        
        console.log(`💾 Restoring polygon with ${polygonData.vertices.length} vertices`);
        
        window.PolygonManager.clearPolygon();
        
        if (polygonData.surveySettings) {
            window.PolygonManager.surveySettings = polygonData.surveySettings;
        }
        
        window.PolygonManager.polygonPoints = polygonData.vertices.map(v => L.latLng(v.lat, v.lng));
        
        window.PolygonManager.createPolygon();
        window.PolygonManager.generateSurveyGrid();
        
        console.log('✅ Polygon restored');
    }

    restoreCompassState(compassState) {
        if (!window.compassEnhanced) {
            console.log('ℹ️ Compass not available for restoration');
            return;
        }
        
        console.log('💾 Restoring compass state:', compassState);
        
        if (compassState.visible) {
            window.compassEnhanced.show();
        } else {
            window.compassEnhanced.hide();
        }
        
        if (compassState.heading !== undefined) {
            window.compassEnhanced.setHeading(compassState.heading);
        }
        
        if (compassState.telemetry) {
            window.compassEnhanced.updateTelemetry(compassState.telemetry);
        }
        
        console.log('✅ Compass state restored');
    }

    restoreWeatherState(weatherState) {
        if (!window.weatherDashboard) {
            console.log('ℹ️ Weather dashboard not available for restoration');
            return;
        }
        
        console.log('💾 Restoring weather state:', weatherState);
        
        if (weatherState.visible && !window.weatherDashboard.isVisible) {
            window.weatherDashboard.show();
        } else if (!weatherState.visible && window.weatherDashboard.isVisible) {
            window.weatherDashboard.hide();
        }
        
        if (weatherState.currentLocation) {
            const loc = weatherState.currentLocation;
            if (loc.lat && loc.lng) {
                window.weatherDashboard.fetchWeather(loc.lat, loc.lng);
            }
        }
        
        console.log('✅ Weather state restored');
    }

    restoreCommandEditorState(editorState) {
        if (!window.CommandEditor) {
            console.log('ℹ️ Command Editor not available for restoration');
            return;
        }
        
        console.log('💾 Restoring Command Editor state:', editorState);
        
        // Visibility is handled by Plan Mode activation
        // Just restore the tab
        if (editorState.currentTab) {
            setTimeout(() => {
                window.CommandEditor.switchTab(editorState.currentTab);
                console.log(`✅ Command Editor tab restored to: ${editorState.currentTab}`);
            }, 500);
        }
    }

    // ========================================================================
    // AUTO-SAVE
    // ========================================================================
    
    startAutoSave() {
        console.log('💾 Auto-save enabled (every 2 seconds)');
        
        this.autoSaveTimer = setInterval(() => {
            if (!this.restorationInProgress) {
                this.saveAllData();
            }
        }, this.AUTO_SAVE_INTERVAL);
    }

    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            console.log('💾 Auto-save stopped');
        }
    }

    // ========================================================================
    // CLEAR DATA
    // ========================================================================
    
    clearSavedData() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            console.log('✅ Saved data cleared');
            
            if (window.MsgConsole) {
                window.MsgConsole.info('💾 Saved data cleared');
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error clearing data:', error);
            return false;
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================
    
    hasSavedData() {
        return !!localStorage.getItem(this.STORAGE_KEY);
    }

    getSavedDataInfo() {
        try {
            const savedData = localStorage.getItem(this.STORAGE_KEY);
            if (!savedData) {
                return null;
            }
            
            const data = JSON.parse(savedData);
            return {
                version: data.version,
                timestamp: data.timestamp,
                waypointCount: data.waypoints ? data.waypoints.length : 0,
                hasHome: !!data.homePosition,
                hasPolygon: !!data.polygonData,
                planModeActive: data.uiState?.isPlanModeActive || false,
                compassVisible: data.compassState?.visible || false,
                weatherVisible: data.weatherState?.visible || false
            };
        } catch (error) {
            console.error('❌ Error getting saved data info:', error);
            return null;
        }
    }
}

// ============================================================================
// INITIALIZATION - RUNS AS EARLY AS POSSIBLE
// ============================================================================

let dataPersistence = null;

function initializeDataPersistence() {
    console.log('💾 Creating DataPersistence instance (COMPLETE)...');
    
    if (!dataPersistence) {
        dataPersistence = new DataPersistence();
        
        window.DataPersistence = {
            save: () => dataPersistence.saveAllData(),
            restore: () => dataPersistence.restoreAllData(),
            clear: () => dataPersistence.clearSavedData(),
            hasSavedData: () => dataPersistence.hasSavedData(),
            getInfo: () => dataPersistence.getSavedDataInfo(),
            _instance: dataPersistence
        };
        
        console.log('✅ DataPersistence exposed globally (COMPLETE)');
    }
    
    return dataPersistence;
}

// Initialize IMMEDIATELY - don't wait for DOMContentLoaded
initializeDataPersistence();

console.log('✅ Data Persistence Module Loaded (COMPLETE VERSION)');