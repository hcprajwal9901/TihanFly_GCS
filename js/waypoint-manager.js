/**
 * Waypoint Manager - Complete Working Version
 * Handles all waypoint operations for Plan Flight Mode
 * FIXED: Proper initialization that waits for TMap
 */

class WaypointManager {
    constructor(tmapInstance) {
        console.log('🎯 WaypointManager constructor called');

        this.tmap = tmapInstance;
        this.waypoints = [];
        this.homePosition = null;
        this.waypointCounter = 0;
        this.currentMode = null;
        this.showRouteLine = true;

        this.icons = {
            waypoint: L.icon({
                iconUrl: '../resources/markers.png',
                iconSize: [50, 50],
                iconAnchor: [26, 42],
                popupAnchor: [0, -32]
            }),
            home: L.icon({
                iconUrl: '../resources/takeoff.svg',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            }),
            landing: L.icon({
                iconUrl: '../resources/rtl.svg',
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

    handleMapClick(lat, lng, e) {
        console.log(`🖱️ Map clicked at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        console.log(`Current mode: ${this.currentMode}`);

        switch (this.currentMode) {
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

    startAddingWaypoint() {
        console.log('➕ Starting waypoint addition mode');
        this.currentMode = 'add';
        this.tmap.enableClick();

        if (window.MsgConsole) {
            window.MsgConsole.info('Click on map to add waypoint');
        }
    }

    addWaypoint(lat, lng, altitude = 50) {
        console.log(`➕ Adding waypoint at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

        const waypoint = {
            id: ++this.waypointCounter,
            lat: lat,
            lng: lng,
            altitude: altitude,
            type: 'waypoint',
            marker: null
        };

        waypoint.marker = this.tmap.addMarker(lat, lng, true, {
            icon: this.icons.waypoint
        });

        const popupContent = this.createWaypointPopup(waypoint);
        waypoint.marker.bindPopup(popupContent);

        this.tmap.onMarkerDragEnd(waypoint.marker, (newLat, newLng) => {
            waypoint.lat = newLat;
            waypoint.lng = newLng;
            this.updateRoute();
            this.updateStats();
            waypoint.marker.setPopupContent(this.createWaypointPopup(waypoint));

            if (window.CommandEditor) {
                window.CommandEditor.refreshWaypoints();
            }
        });

        this.tmap.onMarkerClick(waypoint.marker, () => {
            if (this.currentMode === 'delete') {
                this.removeWaypoint(waypoint.id);
            }
        });

        if (window.WaypointContextMenu) {
            window.WaypointContextMenu.attachToMarker(waypoint.marker, waypoint);
        }

        this.waypoints.push(waypoint);
        this.updateRoute();
        this.updateStats();

        if (window.CommandEditor) {
            window.CommandEditor.refreshWaypoints();
        }

        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${waypoint.id} added`);
        }

        console.log(`✅ Waypoint ${waypoint.id} added. Total: ${this.waypoints.length}`);
    }

    getWaypoints() {
        return this.waypoints;
    }

    getTotalDistance() {
        if (this.waypoints.length < 2) return 0;
        const coordinates = this.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));
        return this.tmap.calculateDistance(coordinates);
    }

    startInsertingWaypoint() {
        console.log('➕ Starting waypoint insertion mode');

        if (this.waypoints.length < 2) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('Need at least 2 waypoints to insert between');
            }
            return;
        }

        this.currentMode = 'insert';
        this.tmap.enableClick();

        if (window.MsgConsole) {
            window.MsgConsole.info('Click on map to insert waypoint');
        }
    }

    insertWaypoint(lat, lng) {
        console.log(`➕ Inserting waypoint at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

        const insertIndex = this.findBestInsertPosition(lat, lng);

        const waypoint = {
            id: ++this.waypointCounter,
            lat: lat,
            lng: lng,
            altitude: 50,
            type: 'waypoint',
            marker: null
        };

        waypoint.marker = this.tmap.addMarker(lat, lng, true, {
            icon: this.icons.waypoint
        });

        waypoint.marker.bindPopup(this.createWaypointPopup(waypoint));

        this.tmap.onMarkerDragEnd(waypoint.marker, (newLat, newLng) => {
            waypoint.lat = newLat;
            waypoint.lng = newLng;
            this.updateRoute();
            this.updateStats();
        });

        this.tmap.onMarkerClick(waypoint.marker, () => {
            if (this.currentMode === 'delete') {
                this.removeWaypoint(waypoint.id);
            }
        });

        if (window.WaypointContextMenu) {
            window.WaypointContextMenu.attachToMarker(waypoint.marker, waypoint);
        }

        this.waypoints.splice(insertIndex, 0, waypoint);
        this.updateRoute();
        this.updateStats();

        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${waypoint.id} inserted at position ${insertIndex + 1}`);
        }
    }

    findBestInsertPosition(lat, lng) {
        let minDistance = Infinity;
        let bestIndex = this.waypoints.length;

        const clickPoint = L.latLng(lat, lng);

        for (let i = 0; i < this.waypoints.length - 1; i++) {
            const p1 = L.latLng(this.waypoints[i].lat, this.waypoints[i].lng);
            const p2 = L.latLng(this.waypoints[i + 1].lat, this.waypoints[i + 1].lng);

            const distance = this.pointToSegmentDistance(clickPoint, p1, p2);

            if (distance < minDistance) {
                minDistance = distance;
                bestIndex = i + 1;
            }
        }

        return bestIndex;
    }

    pointToSegmentDistance(point, segStart, segEnd) {
        const x = point.lat;
        const y = point.lng;
        const x1 = segStart.lat;
        const y1 = segStart.lng;
        const x2 = segEnd.lat;
        const y2 = segEnd.lng;

        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = x - xx;
        const dy = y - yy;

        return Math.sqrt(dx * dx + dy * dy);
    }

    startDeletingWaypoint() {
        console.log('❌ Starting waypoint deletion mode');

        if (this.waypoints.length === 0) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('No waypoints to delete');
            }
            return;
        }

        this.currentMode = 'delete';

        if (window.MsgConsole) {
            window.MsgConsole.info('Click on a waypoint to delete it');
        }
    }

    removeWaypoint(waypointId) {
        console.log(`❌ Removing waypoint ${waypointId}`);

        const index = this.waypoints.findIndex(wp => wp.id === waypointId);
        if (index === -1) return;

        const waypoint = this.waypoints[index];
        this.tmap.removeMarker(waypoint.marker);
        this.waypoints.splice(index, 1);
        this.updateRoute();
        this.updateStats();

        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${waypointId} deleted`);
        }

        if (this.waypoints.length === 0) {
            this.currentMode = null;
        }
    }

    clearAllWaypoints() {
        console.log('🗑️ Clearing all waypoints');

        if (this.waypoints.length === 0) return;

        this.waypoints.forEach(waypoint => {
            this.tmap.removeMarker(waypoint.marker);
        });

        const count = this.waypoints.length;
        this.waypoints = [];
        this.updateRoute();
        this.updateStats();
        this.currentMode = null;
        this.tmap.disableClick();

        if (window.MsgConsole) {
            window.MsgConsole.success(`${count} waypoints cleared`);
        }
    }

    startTakeoffHere() {
        console.log('🛫 Starting takeoff position mode');
        this.currentMode = 'takeoff';
        this.tmap.enableClick();

        if (window.MsgConsole) {
            window.MsgConsole.info('Click on map to set takeoff position');
        }
    }

    setHomePosition(lat, lng) {
        console.log(`🏠 Setting home position at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

        if (this.homePosition && this.homePosition.marker) {
            this.tmap.removeMarker(this.homePosition.marker);
        }

        this.homePosition = {
            lat: lat,
            lng: lng,
            altitude: 0,
            marker: null
        };

        this.homePosition.marker = this.tmap.addMarker(lat, lng, true, {
            icon: this.icons.home
        });

        const popupContent = `
            <div style="text-align: center; font-family: Arial, sans-serif;">
                <strong style="color: #E6007E;">Home/Takeoff</strong><br>
                <small>Lat: ${lat.toFixed(6)}<br>
                Lng: ${lng.toFixed(6)}</small>
            </div>
        `;
        this.homePosition.marker.bindPopup(popupContent);

        this.tmap.onMarkerDragEnd(this.homePosition.marker, (newLat, newLng) => {
            this.homePosition.lat = newLat;
            this.homePosition.lng = newLng;
        });

        if (window.MsgConsole) {
            window.MsgConsole.success('Home position set');
        }
    }

    clearHomePosition() {
        if (!this.homePosition) return;

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

    startLandHere() {
        console.log('🛬 Starting landing position mode');
        this.currentMode = 'land';
        this.tmap.enableClick();

        if (window.MsgConsole) {
            window.MsgConsole.info('Click on map to set landing position');
        }
    }

    addLandingPoint(lat, lng) {
        console.log(`🛬 Adding landing point at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

        const waypoint = {
            id: ++this.waypointCounter,
            lat: lat,
            lng: lng,
            altitude: 0,
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
    }

    createWaypointPopup(waypoint) {
        return `
            <div style="text-align: center; font-family: Arial, sans-serif;">
                <strong style="color: #E6007E;">Waypoint ${waypoint.id}</strong><br>
                <small>Lat: ${waypoint.lat.toFixed(6)}<br>
                Lng: ${waypoint.lng.toFixed(6)}<br>
                Alt: ${waypoint.altitude}m</small>
            </div>
        `;
    }

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

    updateStats() {
        if (this.waypoints.length === 0) return;

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

    exportMission() {
        const mission = {
            waypoints: this.waypoints.map(wp => ({
                id: wp.id,
                lat: wp.lat,
                lng: wp.lng,
                altitude: wp.altitude,
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
                this.addWaypoint(wp.lat, wp.lng);
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
// PROPER INITIALIZATION - WAITS FOR TMAP
// ============================================================================

console.log('🎯 WaypointManager script loading...');

function initializeWaypointManager() {
    console.log('🔄 Attempting WaypointManager initialization...');
    console.log('  window.tmap:', !!window.tmap);
    console.log('  window.tmap.map:', !!(window.tmap && window.tmap.map));

    // Check if already initialized
    if (window.WaypointManager) {
        console.log('✅ WaypointManager already exists');
        return true;
    }

    // Check if tmap is ready
    if (!window.tmap || !window.tmap.map) {
        console.warn('⏳ TMap not ready yet, waiting...');
        return false;
    }

    // Initialize
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

// Try to initialize immediately
if (!initializeWaypointManager()) {
    // If not ready, retry with intervals
    let retryCount = 0;
    const maxRetries = 100; // 20 seconds max

    const retryInterval = setInterval(() => {
        retryCount++;

        // Log every 10 attempts
        if (retryCount % 10 === 0) {
            console.log(`🔄 Still waiting for tmap... (${retryCount}/${maxRetries})`);
        }

        // Try to initialize
        if (initializeWaypointManager()) {
            clearInterval(retryInterval);
            console.log(`✅ WaypointManager initialized after ${retryCount} retries (${retryCount * 0.2}s)`);
        } else if (retryCount >= maxRetries) {
            // Give up after max retries
            clearInterval(retryInterval);
            console.error(`❌ Failed to initialize WaypointManager after ${maxRetries} retries (${maxRetries * 0.2}s)`);
            console.error('💡 Make sure tmap.js is loaded before waypoint-manager.js');

            if (window.MsgConsole) {
                window.MsgConsole.error('❌ Waypoint Manager failed to initialize');
            }
        }
    }, 200); // Check every 200ms
}

console.log('✅ WaypointManager Script Loaded');