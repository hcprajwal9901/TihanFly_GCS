/**
 * TMap - Pure Map Library
 * Contains ONLY map-related operations
 * UPDATED: Simple PNG home marker (no 3D rotation)
 */

class TMap {
    constructor(containerId, centerCoords, zoomLevel, useOffline = false) {
        // Initialize Leaflet map with minZoom and maxBounds to prevent zooming/panning too far
        this.map = L.map(containerId, {
            minZoom: 2,
            maxBounds: [[-90, -180], [90, 180]],
            maxBoundsViscosity: 1.0,
            scrollWheelZoom: true,
            zoomControl: false
        }).setView(centerCoords, zoomLevel);

        
        // Initialize layers
        this.markerLayer = L.layerGroup().addTo(this.map);
        this.routeLayer = L.layerGroup().addTo(this.map);
        
        // Store markers
        this.markers = [];
        
        // Click handler control
        this.clickEnabled = false;
        this.clickCallback = null;
        this.clickEventHandler = null;
        
        // Load tiles
        this.loadTiles(useOffline);
    }

    // ========================================================================
    // TILE OPERATIONS - Load map tiles
    // ========================================================================
    
    loadTiles(useOffline) {
        this.useOffline = useOffline;
        if (this.tileLayer) {
            this.map.removeLayer(this.tileLayer);
        }
        if (useOffline) {
            this.tileLayer = L.tileLayer('tiles/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: 'Offline Map Data'
            });
            this.tileLayer.addTo(this.map);
        } else {
            const GoogleSatellite = L.TileLayer.extend({
                getTileUrl: function (coords) {
                    const x = coords.x;
                    const y = coords.y;
                    const z = this._getZoomForUrl();

                    if (z > 22) return '';

                    const server = (x + y) % 4;
                    return `https://mt${server}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
                }
            });

            this.tileLayer = new GoogleSatellite('', {
                maxZoom: 22,
                attribution: '\u00a9 Google'
            });
            this.tileLayer.addTo(this.map);
        }
    }

    setTheme(themeName) {
        console.log(`[TMap] Setting map theme to: ${themeName}`);
        this.currentTheme = themeName;
        
        // Remove existing theme layer if any
        if (this.themeLayer) {
            this.map.removeLayer(this.themeLayer);
            this.themeLayer = null;
        }

        if (themeName === 'high-contrast') {
            const isOffline = this.useOffline || !navigator.onLine;
            if (isOffline) {
                console.warn('[TMap] Offline mode active. Falling back to local offline tiles for High Contrast theme.');
                // Revert to default offline tiles
                this.loadTiles(true);
            } else {
                console.log('[TMap] Network available. Loading online high contrast tiles.');
                try {
                    // Try to load online high contrast stylesheet layer
                    this.themeLayer = L.tileLayer('https://{s}.tile.jawg.io/jawg-contrast/{z}/{x}/{y}{r}.png?access-token=dummy', {
                        maxZoom: 18,
                        attribution: 'Jawg Contrast'
                    });
                    this.themeLayer.addTo(this.map);
                    // Remove standard tile layer to show theme layer
                    if (this.tileLayer) {
                        this.map.removeLayer(this.tileLayer);
                    }
                } catch (error) {
                    console.error('[TMap] Error loading online contrast layer, falling back to offline tiles:', error);
                    this.loadTiles(true);
                }
            }
        } else {
            // Restore default tiles
            this.loadTiles(this.useOffline);
        }
    }

    // ========================================================================
    // SIMPLE HOME MARKER - PNG ONLY (NO 3D)
    // ========================================================================
    
    /**
     * Add a simple home location marker (PNG icon only)
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {object} options - Customization options
     * @returns {object} Marker object
     */
    addRotatingHomeMarker(lat, lng, label = 'Home', options = {}) {
        const defaults = {
            iconSize: [80, 80],
            iconAnchor: [20, 40],
            iconUrl: '../resources/icon/home.png',
            permanentLabel: true,
            labelOffset: [0, 5],
        };
        
        const config = { ...defaults, ...options };
        
        // Create simple div icon with PNG
        const iconHtml = `
            <div style="position: relative; width: ${config.iconSize[0]}px; height: ${config.iconSize[1]}px;">
                <img src="${config.iconUrl}" 
                     style="width: 100%; height: 100%; object-fit: contain; 
                            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
                ${config.permanentLabel ? `
                    <div style="
                        position: absolute;
                        ${config.labelDirection === 'bottom' ? 'top: 100%;' : ''}
                        ${config.labelDirection === 'top' ? 'bottom: 100%;' : ''}
                        ${config.labelDirection === 'right' ? 'left: 100%;' : ''}
                        ${config.labelDirection === 'left' ? 'right: 100%;' : ''}
                        left: 50%;
                        transform: translateX(-50%);
                        white-space: nowrap;
                        color: ${config.labelColor};
                        font-weight: bold;
                        font-size: 12px;
                        text-shadow: 0 2px 4px rgba(0,0,0,0.8);
                        padding: 4px 10px;
                        background: ${config.labelBgColor};
                        border-radius: 4px;
                        margin-top: ${config.labelOffset[1]}px;
                        pointer-events: none;
                    ">${label}</div>
                ` : ''}
            </div>
        `;
        
        const icon = L.divIcon({
            html: iconHtml,
            iconSize: config.iconSize,
            iconAnchor: config.iconAnchor,
            className: 'simple-home-marker'
        });
        
        const marker = L.marker([lat, lng], {
            icon: icon,
            draggable: false,
            zIndexOffset: 1000
        }).addTo(this.markerLayer);
        
        this.markers.push(marker);
        
        // Add click handler to center on home
        marker.on('click', () => {
            this.setCenter(lat, lng, 18);
            console.log(`🏠 Centered on home: ${label}`);
        });
        
        console.log(`🏠 Added home marker: ${label} at ${lat}, ${lng}`);
        
        return {
            marker: marker,
            lat: lat,
            lng: lng,
            label: label,
            remove: () => this.removeMarker(marker),
            center: () => this.setCenter(lat, lng, 18)
        };
    }

    // ========================================================================
    // STATIC LOCATION MARKER (NON-ROTATING)
    // ========================================================================
    
    /**
     * Add a static location marker with label
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {string} name - Location name
     * @param {object} options - Customization options
     * @returns {object} Marker reference
     */
    addStaticLocation(lat, lng, name, options = {}) {
        const defaults = {
            iconColor: '#E6007E',
            labelDirection: 'right',
            labelOffset: [15, 0],
            permanentLabel: true
        };
        
        const config = { ...defaults, ...options };
        
        // Create custom div icon for static location
        const icon = L.divIcon({
            className: 'static-location-marker',
            html: `
                <div style="position: relative; width: 30px; height: 30px;">
                    <div style="
                        width: 100%;
                        height: 100%;
                        background: ${config.iconColor};
                        border: 3px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                        cursor: pointer;
                    "></div>
                    ${config.permanentLabel ? `
                        <div style="
                            position: absolute;
                            ${config.labelDirection === 'right' ? 'left: 100%;' : ''}
                            ${config.labelDirection === 'left' ? 'right: 100%;' : ''}
                            ${config.labelDirection === 'top' ? 'bottom: 100%;' : ''}
                            ${config.labelDirection === 'bottom' ? 'top: 100%;' : ''}
                            white-space: nowrap;
                            color: white;
                            font-weight: bold;
                            font-size: 11px;
                            text-shadow: 0 2px 4px rgba(0,0,0,0.8);
                            padding: 4px 8px;
                            background: rgba(0, 0, 0, 0.7);
                            border-radius: 4px;
                            margin-left: ${config.labelOffset[0]}px;
                            margin-top: ${config.labelOffset[1]}px;
                            pointer-events: none;
                        ">${name}</div>
                    ` : ''}
                </div>
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        const marker = L.marker([lat, lng], {
            icon: icon,
            draggable: false
        }).addTo(this.markerLayer);
        
        this.markers.push(marker);
        
        marker.on('click', () => {
            this.setCenter(lat, lng, 16);
            console.log(`📍 Centered on: ${name}`);
        });
        
        return marker;
    }

    // ========================================================================
    // MARKER OPERATIONS - Add, remove, get markers
    // ========================================================================
    
    addMarker(lat, lng, draggable = true, options = {}) {
        const markerOptions = { 
            draggable,
            ...options
        };
        
        const marker = L.marker([lat, lng], markerOptions)
            .addTo(this.markerLayer);

        this.markers.push(marker);
        return marker;
    }

    removeMarker(marker) {
        const index = this.markers.indexOf(marker);
        if (index > -1) {
            this.markerLayer.removeLayer(marker);
            this.markers.splice(index, 1);
        }
    }

    removeLastMarker() {
        if (this.markers.length > 0) {
            const lastMarker = this.markers[this.markers.length - 1];
            this.removeMarker(lastMarker);
        }
    }

    removeMarkerAt(index) {
        if (index >= 0 && index < this.markers.length) {
            const marker = this.markers[index];
            this.removeMarker(marker);
        }
    }

    clearMarkers() {
        this.markerLayer.clearLayers();
        this.markers = [];
    }

    getMarkers() {
        return this.markers;
    }

    getMarkerCoordinates() {
        return this.markers.map(marker => {
            const pos = marker.getLatLng();
            return { lat: pos.lat, lng: pos.lng };
        });
    }

    getMarkerCount() {
        return this.markers.length;
    }

    // ========================================================================
    // ROUTE OPERATIONS - Draw and clear routes
    // ========================================================================
    
    drawRoute(coordinates, options = {}) {
        this.clearRoute();

        if (coordinates.length < 2) return null;

        const style = {
            color: options.color || '#FF0000',
            weight: options.weight || 3,
            opacity: options.opacity || 0.7
        };

        const latLngs = coordinates.map(coord => [coord.lat, coord.lng]);
        const route = L.polyline(latLngs, style).addTo(this.routeLayer);
        
        return route;
    }

    clearRoute() {
        this.routeLayer.clearLayers();
    }

    // ========================================================================
    // DISTANCE CALCULATION - Calculate distance between points
    // ========================================================================
    
    calculateDistance(coordinates) {
        if (coordinates.length < 2) return 0;

        let totalDistance = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
            const point1 = L.latLng(coordinates[i].lat, coordinates[i].lng);
            const point2 = L.latLng(coordinates[i + 1].lat, coordinates[i + 1].lng);
            totalDistance += point1.distanceTo(point2);
        }

        return totalDistance;
    }

    // ========================================================================
    // MAP NAVIGATION - Pan, zoom, get position
    // ========================================================================
    
    setCenter(lat, lng, zoom = null) {
        if (zoom !== null) {
            this.map.setView([lat, lng], zoom);
        } else {
            this.map.panTo([lat, lng]);
        }
    }

    getCenter() {
        return this.map.getCenter();
    }

    setZoom(zoom) {
        this.map.setZoom(zoom);
    }

    getZoom() {
        return this.map.getZoom();
    }

    getBounds() {
        return this.map.getBounds();
    }

    fitBounds(bounds) {
        this.map.fitBounds(bounds);
    }

    // ========================================================================
    // EVENT HANDLING - Map and marker events
    // ========================================================================
    
    onClick(callback) {
        if (this.clickEventHandler) {
            this.map.off('click', this.clickEventHandler);
        }
        
        this.clickCallback = callback;
        
        this.clickEventHandler = (e) => {
            if (this.clickEnabled && this.clickCallback) {
                this.clickCallback(e.latlng.lat, e.latlng.lng, e);
            }
        };
        
        this.map.on('click', this.clickEventHandler);
    }

    enableClick() {
        this.clickEnabled = true;
    }

    disableClick() {
        this.clickEnabled = false;
    }

    removeClickHandler() {
        this.clickEnabled = false;
        this.clickCallback = null;
        if (this.clickEventHandler) {
            this.map.off('click', this.clickEventHandler);
            this.clickEventHandler = null;
        }
    }

    onRightClick(callback) {
        this.map.on('contextmenu', (e) => {
            callback(e.latlng.lat, e.latlng.lng, e);
        });
    }

    onMarkerDrag(marker, callback) {
        marker.on('drag', () => {
            const pos = marker.getLatLng();
            callback(pos.lat, pos.lng);
        });
    }

    onMarkerDragEnd(marker, callback) {
        marker.on('dragend', () => {
            const pos = marker.getLatLng();
            callback(pos.lat, pos.lng);
        });
    }

    onMarkerClick(marker, callback) {
        marker.on('click', (e) => {
            e.originalEvent.stopPropagation();
            const pos = marker.getLatLng();
            callback(pos.lat, pos.lng, marker);
        });
    }

    onMarkerRightClick(marker, callback) {
        marker.on('contextmenu', (e) => {
            e.originalEvent.stopPropagation();
            const pos = marker.getLatLng();
            callback(pos.lat, pos.lng, marker);
        });
    }

    onZoomChange(callback) {
        this.map.on('zoom', () => {
            callback(this.getZoom());
        });
    }

    onMoveEnd(callback) {
        this.map.on('moveend', () => {
            const center = this.getCenter();
            callback(center.lat, center.lng);
        });
    }
registerWeatherClickHandler(handler) {
    console.log('🌦️ Registering weather click handler');
    this._weatherClickHandler = handler;
}

enableWeatherClicks() {
    console.log('🌦️ Enabling weather clicks on map');
    
    if (!this._weatherMapClickHandler) {
        this._weatherMapClickHandler = (e) => {
            // Only trigger weather if not placing waypoints
            const inWaypointMode = window.WaypointManager && window.WaypointManager.currentMode;
            
            if (!inWaypointMode && this._weatherClickHandler) {
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;
                console.log(`🌦️ Weather click triggered: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                this._weatherClickHandler(lat, lng);
            }
        };
        
        this.map.on('click', this._weatherMapClickHandler);
        console.log('✅ Weather click listener added to map');
    }
}

disableWeatherClicks() {
    if (this._weatherMapClickHandler) {
        this.map.off('click', this._weatherMapClickHandler);
        this._weatherMapClickHandler = null;
        console.log('✅ Weather click listener removed');
    }
}
    // ========================================================================
    // UTILITY METHODS - Helper functions
    // ========================================================================
    
    enableMarkerRemovalOnClick() {
        this.markers.forEach(marker => {
            this.onMarkerClick(marker, (lat, lng, m) => {
                this.removeMarker(m);
            });
        });
    }

    addRemovableMarker(lat, lng, draggable = true, options = {}) {
        const marker = this.addMarker(lat, lng, draggable, options);
        this.onMarkerClick(marker, (lat, lng, m) => {
            this.removeMarker(m);
        });
        return marker;
    }
    // ========================================================================
    // DRONE POSITION - Live GPS marker updated from WebSocket backend
    // ========================================================================

    /**
     * Update (or create) the live drone position marker on the map.
     * Called every time a { type:"gps" } JSON frame arrives from the backend (~4 Hz).
     *
     * @param {number} lat      - Latitude  (degrees)
     * @param {number} lng      - Longitude (degrees)
     * @param {number} heading  - Heading   (degrees, 0 = North)
     */
    updateDronePosition(lat, lng, heading = 0) {
        this.updateDronePositionForSysid(1, lat, lng, heading);
    }

    /**
     * Update the drone marker for a specific vehicle (sysid-keyed).
     * @param {number} sysid
     * @param {number} lat
     * @param {number} lng
     * @param {number} heading  degrees
     */
    updateDronePositionForSysid(sysid, lat, lng, heading = 0) {
        if (!lat || !lng) return;

        // Initialize droneMarkers if it doesn't exist
        if (!this.droneMarkers) {
            this.droneMarkers = {};
            this.droneAutoPan = true;
            this._gpsFixCount = 0;
        }

        // Pick a stable colour per sysid
        const COLOURS = ['#E6007E','#00c8ff','#ffe033','#4ade80','#f97316','#a78bfa'];
        const colour  = COLOURS[(sysid - 1) % COLOURS.length] || '#E6007E';

        // ── Build icon HTML ───────────────────────────────────────────────
        const iconHtml = `
            <div class="drone-marker-wrap" style="
                width: 48px; height: 48px;
                position: relative;
            ">
                <img src="../resources/icon/drone.svg"
                     style="width:48px; height:48px; position:absolute; inset:0;
                            transform: rotate(${heading}deg); transition: transform 0.4s ease;
                            filter: drop-shadow(0 2px 6px ${colour});"
                     alt="drone" />
                <div style="
                    position:absolute;bottom:-16px;left:50%;
                    transform:translateX(-50%);
                    background:rgba(0,0,0,.7);color:#fff;
                    font-size:10px;font-weight:700;
                    padding:1px 5px;border-radius:3px;
                    white-space:nowrap;
                ">D-${sysid}</div>
            </div>`;

        // ── Inject CSS keyframes once ─────────────────────────────────────
        if (!document.getElementById('drone-marker-style')) {
            const style = document.createElement('style');
            style.id = 'drone-marker-style';
            style.textContent = `
                @keyframes drone-pulse {
                    0%   { transform: scale(1);   opacity: 0.7; }
                    70%  { transform: scale(2.2); opacity: 0;   }
                    100% { transform: scale(2.2); opacity: 0;   }
                }
                .leaflet-drone-icon { background: transparent !important; border: none !important; }
            `;
            document.head.appendChild(style);
        }

        if (this.droneMarkers[sysid]) {
            // Update marker position, icon and heading
            this.droneMarkers[sysid].setLatLng([lat, lng]);

            const updatedIcon = L.divIcon({
                className: 'leaflet-drone-icon',
                html: iconHtml,
                iconSize:   [48, 48],
                iconAnchor: [24, 24]
            });
            this.droneMarkers[sysid].setIcon(updatedIcon);

            if (this.droneMarkers[sysid].isPopupOpen()) {
                const latEl = document.getElementById(`drone-popup-lat-${sysid}`);
                const lngEl = document.getElementById(`drone-popup-lng-${sysid}`);
                if (latEl) latEl.textContent = `Lat: ${lat.toFixed(6)}`;
                if (lngEl) lngEl.textContent = `Lng: ${lng.toFixed(6)}`;
            }
        } else {
            // Create new marker
            const icon = L.divIcon({
                className: 'leaflet-drone-icon',
                html: iconHtml,
                iconSize:   [48, 48],
                iconAnchor: [24, 24]
            });

            const marker = L.marker([lat, lng], {
                icon,
                zIndexOffset: 2000,
                interactive: true
            }).addTo(this.map);

            marker.bindPopup(`
                <b>🚁 Drone ${sysid}</b><br>
                <span id="drone-popup-lat-${sysid}">Lat: ${lat.toFixed(6)}</span><br>
                <span id="drone-popup-lng-${sysid}">Lng: ${lng.toFixed(6)}</span>
            `);

            this.droneMarkers[sysid] = marker;
            console.log(`✅ Drone marker created for sysid=${sysid} at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        }

        // ── Auto-pan logic (only for sysid 1 or selected) ─────────────────
        const isTarget = window.selectedSysId === sysid || (window.selectedSysId === 0 && sysid === (window._primarySysId || 1));
        
        if (!this.droneAutoPan || !isTarget) return;

        this._gpsFixCount = (this._gpsFixCount || 0) + 1;

        if (this._gpsFixCount <= 20) {
            this.map.setView([lat, lng], 17, { animate: false });
            if (this._gpsFixCount === 1 || this._gpsFixCount === 20) {
                console.log(`🚁 [fix ${this._gpsFixCount}] Snapped map to drone ${sysid}: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            }
            if (this._gpsFixCount === 20) {
                this.droneAutoPan = false;
                console.log('🚁 Initial map lock complete. Auto-pan disabled.');
            }
        }
    }

    /**
     * Toggle drone auto-pan programmatically.
     * @param {boolean} enabled
     */
    setDroneAutoPan(enabled) {
        this.droneAutoPan = enabled;
        // Reset fix counter so Phase 1 snap fires again when re-enabled
        if (enabled) this._gpsFixCount = 0;
        console.log(`🚁 Drone auto-pan: ${enabled ? 'ON' : 'OFF'}`);
    }

    /**
     * Prune vehicle markers that are no longer active/connected.
     * @param {number[]} activeSysids - Array of active vehicle system IDs
     */
    pruneStaleVehicleMarkers(activeSysids) {
        if (!this.droneMarkers) return;
        Object.keys(this.droneMarkers).forEach(sysidStr => {
            const sysid = parseInt(sysidStr, 10);
            if (!activeSysids.includes(sysid)) {
                console.log(`[TMap] Pruning stale drone marker for sysid=${sysid}`);
                const marker = this.droneMarkers[sysid];
                if (marker) {
                    this.map.removeLayer(marker);
                }
                delete this.droneMarkers[sysid];
            }
        });
    }

    /**
     * Remove all drone markers from the map.
     */
    clearDroneMarkers() {
        if (!this.droneMarkers) return;
        Object.keys(this.droneMarkers).forEach(sysid => {
            const marker = this.droneMarkers[sysid];
            if (marker) {
                this.map.removeLayer(marker);
            }
        });
        this.droneMarkers = {};
        console.log('[TMap] Cleared all drone markers');
    }

    /**
     * Getter for backward compatibility and simple access to the selected active drone marker.
     * @returns {object|null} The marker for the selected/active drone.
     */
    get droneMarker() {
        const activeSysId = window.selectedSysId || window._primarySysId || 1;
        return (this.droneMarkers && this.droneMarkers[activeSysId]) ? this.droneMarkers[activeSysId] : null;
    }
}