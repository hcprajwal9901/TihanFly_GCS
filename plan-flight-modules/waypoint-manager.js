/**
 * Waypoint Manager
 * Handles waypoint operations, route management, and mission planning
 */

console.log('🎯 WAYPOINT MANAGER Loading...');

class WaypointManager {
    constructor(tmapInstance) {
        console.log('🎯 WaypointManager constructor called');
        
        this.tmap = tmapInstance;
        this.waypoints = [];
        this.homePosition = null;
        this.waypointCounter = 0;
        
        // Current operation mode
        this.currentMode = null; // 'add', 'insert', 'delete', 'takeoff', 'land'
        
        // Route line visibility
        this.showRouteLine = true;
        
        // Custom marker icons
        this.icons = {
            waypoint: L.icon({
                iconUrl: 'resources/markers.png',
                iconSize: [50, 50],
                iconAnchor: [26, 42],
                popupAnchor: [0, -32]
            }),
            home: L.icon({
                iconUrl: 'resources/takeoff.svg',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            }),
            landing: L.icon({
                iconUrl: 'resources/rtl.svg',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            })
        };
        
        this.initialize();
    }

    initialize() {
        console.log('🗺️ Initializing Waypoint Manager...');
        this.setupMapClickHandler();
        console.log('✅ Waypoint Manager initialized');
    }

    setupMapClickHandler() {
        this.tmap.onClick((lat, lng, e) => {
            this.handleMapClick(lat, lng, e);
        });
        this.tmap.disableClick();
        console.log('✅ Map click handler set up');
    }

    // ========================================================================
    // MAP CLICK HANDLER
    // ========================================================================
    
    handleMapClick(lat, lng, e) {
        console.log(`🖱️ Map clicked at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        console.log(`Current mode: ${this.currentMode}`);
        
        switch(this.currentMode) {
            case 'add':
                this.addWaypoint(lat, lng);
                break;
                
            case 'insert':
                this.insertWaypoint(lat, lng);
                break;
                
            case 'takeoff':
                this.setHomePosition(lat, lng);
                this.currentMode = null;
                this.tmap.disableClick();
                break;
                
            case 'land':
                this.addLandingPoint(lat, lng);
                this.currentMode = null;
                this.tmap.disableClick();
                break;
                
            default:
                console.log('No active mode');
        }
    }

    // ========================================================================
    // HOME/TAKEOFF POSITION
    // ========================================================================
    
    startTakeoffHere() {
        console.log('🛫 Starting takeoff position mode');
        this.currentMode = 'takeoff';
        this.tmap.enableClick();
        
        if (window.MsgConsole) {
            window.MsgConsole.info('🛫 Click on map to set takeoff position');
        }
    }

    setHomePosition(lat, lng) {
        console.log(`🏠 Setting home position at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        
        // Remove old home marker if exists
        if (this.homePosition && this.homePosition.marker) {
            this.tmap.removeMarker(this.homePosition.marker);
        }
        
        // Create home position object
        this.homePosition = {
            lat: lat,
            lng: lng,
            altitude: 0,
            marker: null
        };
        
        // Create marker
        this.homePosition.marker = this.tmap.addMarker(lat, lng, true, {
            icon: this.icons.home
        });
        
        // Add popup
        const popupContent = `
            <div style="text-align: center; font-family: Arial, sans-serif;">
                <strong style="color: #E6007E;">Home/Takeoff</strong><br>
                <small>Lat: ${lat.toFixed(6)}<br>
                Lng: ${lng.toFixed(6)}</small>
            </div>
        `;
        this.homePosition.marker.bindPopup(popupContent);
        
        // Add drag listener
        this.tmap.onMarkerDragEnd(this.homePosition.marker, (newLat, newLng) => {
            this.homePosition.lat = newLat;
            this.homePosition.lng = newLng;
            console.log(`Home position moved to: ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`);
        });
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Home position set');
        }
        
        console.log('✅ Home position set');
    }

    clearHomePosition() {
        console.log('🗑️ Clearing home position');
        
        if (!this.homePosition) {
            console.log('ℹ️ No home position to clear');
            return;
        }
        
        // Remove marker
        if (this.homePosition.marker) {
            this.tmap.removeMarker(this.homePosition.marker);
        }
        
        this.homePosition = null;
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Home position cleared');
        }
    }

    getHomePosition() {
        return this.homePosition;
    }

    // ========================================================================
    // WAYPOINT OPERATIONS
    // ========================================================================
    
    startAddingWaypoint() {
        console.log('➕ Starting add waypoint mode');
        this.currentMode = 'add';
        this.tmap.enableClick();
        
        if (window.MsgConsole) {
            window.MsgConsole.info('➕ Click on map to add waypoint');
        }
    }

    addWaypoint(lat, lng, altitude = 50, speed = 10, source = null) {
        this.waypointCounter++;
        
        const waypoint = {
            id:       this.waypointCounter,
            lat:      lat,
            lng:      lng,
            altitude: altitude,
            speed:    speed,
            type:     'waypoint',
            source:   source,   // optional tag, e.g. 'polygon' for survey waypoints
            marker:   null
        };
        
        // Create marker
        waypoint.marker = this.tmap.addMarker(lat, lng, true, {
            icon: this.icons.waypoint
        });
        
        // Add popup
        const popupContent = `
            <div style="text-align: center; font-family: Arial, sans-serif;">
                <strong style="color: #E6007E;">Waypoint ${waypoint.id}</strong><br>
                <small>Lat: ${lat.toFixed(6)}<br>
                Lng: ${lng.toFixed(6)}<br>
                Alt: ${altitude}m | Speed: ${speed}m/s</small>
            </div>
        `;
        waypoint.marker.bindPopup(popupContent);
        
        // Add drag listener
        this.tmap.onMarkerDragEnd(waypoint.marker, (newLat, newLng) => {
            waypoint.lat = newLat;
            waypoint.lng = newLng;
            this.updateRoute();
            this.updateStats();
        });
        
        // Add to waypoints array
        this.waypoints.push(waypoint);
        
        // Update route and stats
        this.updateRoute();
        this.updateStats();
        
        // Notify CommandEditor if it exists
        if (window.CommandEditor && window.CommandEditor.refreshWaypoints) {
            window.CommandEditor.refreshWaypoints();
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${waypoint.id} added`);
        }
        
        console.log('✅ Waypoint added:', waypoint.id);
        return waypoint;  // caller can track the ID
    }

    startDeletingWaypoint() {
        console.log('🗑️ Starting delete waypoint mode');
        
        if (this.waypoints.length === 0) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('No waypoints to delete');
            }
            return;
        }
        
        this.currentMode = 'delete';
        
        // Make waypoints clickable for deletion
        this.waypoints.forEach(wp => {
            if (wp.marker) {
                wp.marker.on('click', () => {
                    this.deleteWaypoint(wp.id);
                    this.currentMode = null;
                });
            }
        });
        
        if (window.MsgConsole) {
            window.MsgConsole.info('🗑️ Click on waypoint to delete');
        }
    }

    deleteWaypoint(waypointId) {
        console.log(`🗑️ Deleting waypoint ${waypointId}`);
        
        const index = this.waypoints.findIndex(wp => wp.id === waypointId);
        
        if (index === -1) {
            console.error(`❌ Waypoint ${waypointId} not found`);
            return;
        }
        
        const waypoint = this.waypoints[index];
        
        // Remove marker
        if (waypoint.marker) {
            this.tmap.removeMarker(waypoint.marker);
        }
        
        // Remove from array
        this.waypoints.splice(index, 1);
        
        // Update route and stats
        this.updateRoute();
        this.updateStats();
        
        // Notify CommandEditor
        if (window.CommandEditor && window.CommandEditor.refreshWaypoints) {
            window.CommandEditor.refreshWaypoints();
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${waypointId} deleted`);
        }
        
        console.log('✅ Waypoint deleted');
    }

    clearAllWaypoints() {
        console.log('🗑️ Clearing all waypoints');
        
        if (this.waypoints.length === 0) {
            if (window.MsgConsole) {
                window.MsgConsole.info('No waypoints to clear');
            }
            return;
        }
        
        const confirm = window.confirm(`Clear all ${this.waypoints.length} waypoints?`);
        if (!confirm) {
            console.log('❌ Clear cancelled');
            return;
        }
        
        // Remove all markers
        this.waypoints.forEach(wp => {
            if (wp.marker) {
                this.tmap.removeMarker(wp.marker);
            }
        });
        
        // Clear array
        this.waypoints = [];
        this.waypointCounter = 0;
        
        // Clear route
        this.tmap.clearRoute();
        
        // Notify CommandEditor
        if (window.CommandEditor && window.CommandEditor.refreshWaypoints) {
            window.CommandEditor.refreshWaypoints();
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success('All waypoints cleared');
        }
        
        console.log('✅ All waypoints cleared');
    }

    /**
     * Silently remove a specific set of waypoints by their IDs.
     * Used by PolygonManager.clearPolygon() — no confirm dialog, no per-item log spam.
     */
    removeWaypointsByIds(ids) {
        if (!ids || ids.length === 0) return;
        const idSet = new Set(ids);
        const victims = this.waypoints.filter(wp => idSet.has(wp.id));
        if (victims.length === 0) {
            console.warn('[WM] removeWaypointsByIds: none of the requested IDs found', ids);
            return;
        }
        victims.forEach(wp => {
            if (wp.marker) {
                try { this.tmap.removeMarker(wp.marker); } catch(e) {}
            }
        });
        this.waypoints = this.waypoints.filter(wp => !idSet.has(wp.id));
        this.updateRoute();
        this.updateStats();
        if (window.CommandEditor?.refreshWaypoints) {
            window.CommandEditor.refreshWaypoints();
        }
        console.log(`✅ removeWaypointsByIds: removed ${victims.length} waypoint(s)`);
    }

    /**
     * Remove all waypoints tagged with the given source string.
     * Kept as a fallback alongside removeWaypointsByIds.
     */
    removeWaypointsBySource(source) {
        const victims = this.waypoints.filter(wp => wp.source === source);
        console.log(`[WM] removeWaypointsBySource('${source}'): found ${victims.length} waypoints`);
        if (victims.length === 0) return;
        victims.forEach(wp => {
            if (wp.marker) {
                try { this.tmap.removeMarker(wp.marker); } catch(e) {}
            }
        });
        this.waypoints = this.waypoints.filter(wp => wp.source !== source);
        this.updateRoute();
        this.updateStats();
        if (window.CommandEditor?.refreshWaypoints) {
            window.CommandEditor.refreshWaypoints();
        }
        console.log(`✅ Removed ${victims.length} waypoint(s) with source='${source}'`);
    }

    getWaypoints() {
        return this.waypoints;
    }

    // ========================================================================
    // LANDING POINT
    // ========================================================================
    
    startLandHere() {
        console.log('🛬 Starting landing position mode');
        this.currentMode = 'land';
        this.tmap.enableClick();
        
        if (window.MsgConsole) {
            window.MsgConsole.info('🛬 Click on map to set landing position');
        }
    }

    addLandingPoint(lat, lng) {
        this.waypointCounter++;
        
        const waypoint = {
            id: this.waypointCounter,
            lat: lat,
            lng: lng,
            altitude: 0,
            speed: 5,
            type: 'landing',
            marker: null
        };
        
        waypoint.marker = this.tmap.addMarker(lat, lng, true, {
            icon: this.icons.landing
        });
        
        const popupContent = `
            <div style="text-align: center; font-family: Arial, sans-serif;">
                <strong style="color: #E6007E;">Landing Point</strong><br>
                <small>Lat: ${lat.toFixed(6)}<br>
                Lng: ${lng.toFixed(6)}</small>
            </div>
        `;
        waypoint.marker.bindPopup(popupContent);
        
        this.tmap.onMarkerDragEnd(waypoint.marker, (newLat, newLng) => {
            waypoint.lat = newLat;
            waypoint.lng = newLng;
            this.updateRoute();
            this.updateStats();
        });
        
        this.waypoints.push(waypoint);
        
        this.updateRoute();
        this.updateStats();
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Landing point added');
        }
        
        console.log('✅ Landing point added');
    }

    // ========================================================================
    // ROUTE MANAGEMENT
    // ========================================================================
    
    updateRoute() {
        this.tmap.clearRoute();
        
        if (this.showRouteLine && this.waypoints.length >= 2) {
            const coordinates = this.waypoints.map(wp => ({
                lat: wp.lat,
                lng: wp.lng
            }));
            
            this.tmap.drawRoute(coordinates, {
                color: '#060606ff',
                weight: 3,
                opacity: 0.8,
                dashArray: '2, 8'
            });
        }
    }

    toggleRouteLine() {
        this.showRouteLine = !this.showRouteLine;
        this.updateRoute();
        
        if (window.MsgConsole) {
            window.MsgConsole.info(this.showRouteLine ? 'Route line shown' : 'Route line hidden');
        }
    }

    showRouteLines() {
        this.showRouteLine = true;
        this.updateRoute();
    }

    hideRouteLines() {
        this.showRouteLine = false;
        this.updateRoute();
    }

    // ========================================================================
    // STATISTICS
    // ========================================================================
    
    updateStats() {
        if (this.waypoints.length === 0) {
            return;
        }
        
        const coordinates = this.waypoints.map(wp => ({
            lat: wp.lat,
            lng: wp.lng
        }));
        
        const totalDistance = this.tmap.calculateDistance(coordinates);
        
        return {
            waypointCount: this.waypoints.length,
            totalDistance: totalDistance,
            hasHome: !!this.homePosition
        };
    }

    getTotalDistance() {
        if (this.waypoints.length < 2) return 0;
        const coordinates = this.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));
        return this.tmap.calculateDistance(coordinates);
    }

    // ========================================================================
    // CENTER MAP
    // ========================================================================
    
    centerMission() {
        if (this.waypoints.length === 0) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('No waypoints to center on');
            }
            return;
        }
        
        const lats = this.waypoints.map(wp => wp.lat);
        const lngs = this.waypoints.map(wp => wp.lng);
        
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        
        this.tmap.fitBounds([
            [minLat, minLng],
            [maxLat, maxLng]
        ]);
    }

    centerHome() {
        if (!this.homePosition) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('No home position set');
            }
            return;
        }
        
        this.tmap.setCenter(this.homePosition.lat, this.homePosition.lng, 16);
    }

    // ========================================================================
    // EXPORT/IMPORT
    // ========================================================================
    
    exportMission() {
        const mission = {
            waypoints: this.waypoints.map(wp => ({
                id: wp.id,
                lat: wp.lat,
                lng: wp.lng,
                altitude: wp.altitude,
                speed: wp.speed || 10,
                type: wp.type
            })),
            homePosition: this.homePosition ? {
                lat: this.homePosition.lat,
                lng: this.homePosition.lng,
                altitude: this.homePosition.altitude
            } : null,
            stats: this.updateStats()
        };
        
        return mission;
    }

    importMission(missionData) {
        this.clearAllWaypoints();
        this.clearHomePosition();
        
        if (missionData.homePosition) {
            this.setHomePosition(
                missionData.homePosition.lat,
                missionData.homePosition.lng
            );
        }
        
        if (missionData.waypoints) {
            missionData.waypoints.forEach(wp => {
                this.addWaypoint(
                    wp.lat,
                    wp.lng,
                    wp.altitude || 50,
                    wp.speed || 10
                );
            });
        }
        
        this.centerMission();
    }

    cancelCurrentOperation() {
        this.currentMode = null;
        this.tmap.disableClick();
        
        if (window.MsgConsole) {
            window.MsgConsole.info('Operation cancelled');
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

console.log('🎯 WaypointManager script loading...');

function tryInitializeWaypointManager() {
    console.log('🔄 Attempting WaypointManager initialization...');
    
    if (window.WaypointManager) {
        console.log('✅ WaypointManager already initialized');
        return true;
    }
    
    if (!window.tmap || !window.tmap.map) {
        console.warn('⏳ TMap not ready yet, waiting...');
        return false;
    }
    
    try {
        const waypointManager = new WaypointManager(window.tmap);
        window.WaypointManager = waypointManager;
        
        console.log('✅ WaypointManager initialized successfully!');
        console.log('✅ Exposed as window.WaypointManager');
        
        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Waypoint Manager ready');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error initializing WaypointManager:', error);
        return false;
    }
}

if (!tryInitializeWaypointManager()) {
    let retryCount = 0;
    const maxRetries = 100;
    
    const retryInterval = setInterval(() => {
        retryCount++;
        
        if (retryCount % 10 === 0) {
            console.log(`🔄 Retry ${retryCount}/${maxRetries}...`);
        }
        
        if (tryInitializeWaypointManager()) {
            clearInterval(retryInterval);
            console.log('✅ WaypointManager initialized after', retryCount, 'retries');
        } else if (retryCount >= maxRetries) {
            clearInterval(retryInterval);
            console.error('❌ Failed to initialize WaypointManager after', maxRetries, 'retries');
            
            if (window.MsgConsole) {
                window.MsgConsole.error('❌ Waypoint Manager failed to initialize');
            }
        }
    }, 200);
}

console.log('✅ WaypointManager Script Loaded');