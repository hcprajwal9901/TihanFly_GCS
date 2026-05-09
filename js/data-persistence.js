/**
 * Data Persistence Module
 * Automatically saves and restores mission data on page refresh
 * Saves: Waypoints, Home Position, Polygon Data, and UI State
 */

console.log('💾 Data Persistence Module Loading...');

class DataPersistence {
    constructor() {
        this.STORAGE_KEY = 'mission_flight_data';
        this.AUTO_SAVE_INTERVAL = 2000; // Auto-save every 2 seconds
        this.autoSaveTimer = null;
        
        this.initialize();
    }

    initialize() {
        console.log('💾 Initializing Data Persistence...');
        
        // Restore data on page load
        this.restoreAllData();
        
        // Start auto-save
        this.startAutoSave();
        
        // Save on page unload
        window.addEventListener('beforeunload', () => {
            this.saveAllData();
        });
        
        console.log('✅ Data Persistence initialized');
    }

    // ========================================================================
    // SAVE DATA
    // ========================================================================
    
    saveAllData() {
        try {
            const data = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                waypoints: this.getWaypointsData(),
                homePosition: this.getHomePositionData(),
                polygonData: this.getPolygonData(),
                uiState: this.getUIState()
            };
            
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
            console.log('💾 Data saved successfully:', {
                waypoints: data.waypoints.length,
                hasHome: !!data.homePosition,
                hasPolygon: !!data.polygonData
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
        
        // Get polygon vertices
        const polygon = window.PolygonManager.polygon;
        if (!polygon || !polygon.vertices || polygon.vertices.length === 0) {
            return null;
        }
        
        return {
            vertices: polygon.vertices.map(v => ({
                lat: v.lat,
                lng: v.lng
            })),
            surveySettings: window.PolygonManager.surveySettings
        };
    }

    getUIState() {
        return {
            isPlanModeActive: window.PlanFlight ? window.PlanFlight.isActive() : false,
            showRouteLine: window.WaypointManager ? window.WaypointManager.showRouteLine : true
        };
    }

    // ========================================================================
    // RESTORE DATA
    // ========================================================================
    
    restoreAllData() {
        try {
            const savedData = localStorage.getItem(this.STORAGE_KEY);
            
            if (!savedData) {
                console.log('💾 No saved data found');
                return false;
            }
            
            const data = JSON.parse(savedData);
            console.log('💾 Restoring data from:', data.timestamp);
            console.log('💾 Data version:', data.version);
            
            // Wait for managers to be ready
            this.waitForManagers().then(() => {
                // Restore waypoints
                if (data.waypoints && data.waypoints.length > 0) {
                    this.restoreWaypoints(data.waypoints);
                }
                
                // Restore home position
                if (data.homePosition) {
                    this.restoreHomePosition(data.homePosition);
                }
                
                // Restore polygon
                if (data.polygonData) {
                    this.restorePolygon(data.polygonData);
                }
                
                // Restore UI state
                if (data.uiState) {
                    this.restoreUIState(data.uiState);
                }
                
                console.log('✅ All data restored successfully');
                
                if (window.MsgConsole) {
                    window.MsgConsole.success('💾 Mission data restored');
                }
            });
            
            return true;
        } catch (error) {
            console.error('❌ Error restoring data:', error);
            return false;
        }
    }

    async waitForManagers() {
        console.log('⏳ Waiting for managers to be ready...');
        
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 50;
            
            const checkInterval = setInterval(() => {
                attempts++;
                
                const waypointReady = window.WaypointManager && window.WaypointManager.tmap;
                const polygonReady = window.PolygonManager;
                
                if (waypointReady && polygonReady) {
                    clearInterval(checkInterval);
                    console.log('✅ Managers are ready');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    console.warn('⚠️ Timeout waiting for managers');
                    resolve();
                }
            }, 100);
        });
    }

    restoreWaypoints(waypoints) {
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            return;
        }
        
        console.log(`💾 Restoring ${waypoints.length} waypoints...`);
        
        // Clear existing waypoints first
        window.WaypointManager.clearAllWaypoints();
        
        // Add each waypoint
        waypoints.forEach((wp, index) => {
            setTimeout(() => {
                window.WaypointManager.addWaypoint(
                    wp.lat,
                    wp.lng,
                    wp.altitude,
                    wp.speed
                );
                
                console.log(`✅ Restored waypoint ${index + 1}:`, {
                    lat: wp.lat.toFixed(6),
                    lng: wp.lng.toFixed(6),
                    alt: wp.altitude,
                    speed: wp.speed
                });
            }, index * 50); // Stagger to avoid overwhelming the map
        });
        
        console.log('✅ Waypoints restoration initiated');
    }

    restoreHomePosition(home) {
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            return;
        }
        
        console.log('💾 Restoring home position:', home);
        
        setTimeout(() => {
            window.WaypointManager.setHomePosition(home.lat, home.lng);
            console.log('✅ Home position restored:', {
                lat: home.lat.toFixed(6),
                lng: home.lng.toFixed(6)
            });
        }, 500);
    }

    restorePolygon(polygonData) {
        if (!window.PolygonManager) {
            console.error('❌ PolygonManager not available');
            return;
        }
        
        console.log('💾 Restoring polygon with', polygonData.vertices.length, 'vertices');
        
        setTimeout(() => {
            // Clear existing polygon
            window.PolygonManager.clearPolygon();
            
            // Restore survey settings
            if (polygonData.surveySettings) {
                window.PolygonManager.surveySettings = polygonData.surveySettings;
            }
            
            // Create new polygon
            window.PolygonManager.polygon = {
                vertices: polygonData.vertices.map(v => ({ lat: v.lat, lng: v.lng })),
                layer: null,
                markers: []
            };
            
            // Redraw polygon
            window.PolygonManager.drawPolygon();
            
            // Generate survey grid
            window.PolygonManager.generateSurveyGrid();
            
            console.log('✅ Polygon restored');
        }, 1000);
    }

    restoreUIState(uiState) {
        console.log('💾 Restoring UI state:', uiState);
        
        // Restore route line visibility
        if (window.WaypointManager && uiState.showRouteLine !== undefined) {
            window.WaypointManager.showRouteLine = uiState.showRouteLine;
            window.WaypointManager.updateRoute();
        }
        
        // Note: We don't auto-restore plan mode to avoid unexpected UI changes
        // Users should manually enter plan mode after page refresh
    }

    // ========================================================================
    // AUTO-SAVE
    // ========================================================================
    
    startAutoSave() {
        console.log('💾 Starting auto-save (every 2 seconds)...');
        
        this.autoSaveTimer = setInterval(() => {
            this.saveAllData();
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
                timestamp: data.timestamp,
                waypointCount: data.waypoints ? data.waypoints.length : 0,
                hasHome: !!data.homePosition,
                hasPolygon: !!data.polygonData
            };
        } catch (error) {
            console.error('❌ Error getting saved data info:', error);
            return null;
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let dataPersistence = null;

function initializeDataPersistence() {
    console.log('💾 Creating DataPersistence instance...');
    
    if (!dataPersistence) {
        dataPersistence = new DataPersistence();
        
        // Expose globally
        window.DataPersistence = {
            save: () => dataPersistence.saveAllData(),
            restore: () => dataPersistence.restoreAllData(),
            clear: () => dataPersistence.clearSavedData(),
            hasSavedData: () => dataPersistence.hasSavedData(),
            getInfo: () => dataPersistence.getSavedDataInfo(),
            _instance: dataPersistence
        };
        
        console.log('✅ window.DataPersistence exposed globally');
        console.log('💡 Use window.DataPersistence.save() to manually save data');
        console.log('💡 Use window.DataPersistence.clear() to clear saved data');
    }
    
    return dataPersistence;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDataPersistence);
} else {
    initializeDataPersistence();
}

console.log('✅ Data Persistence Module Loaded');