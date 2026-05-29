/**
 * Polygon Manager - Survey Grid System (FINAL FIX)
 * Handles polygon drawing, editing, and grid generation for aerial surveys
 * FIXED: Properly maintains polygon reference and recreates when needed
 */

class PolygonManager {
    constructor(map) {
        console.log('🔷 PolygonManager constructor called');

        this.map = map;

        // Polygon state
        this.isDrawing = false;
        this.isEditing = false;
        this.currentPolygon = null;
        this.polygonPoints = [];
        this.polygonLayer = null;
        this.surveyGrid = [];
        this.gridLayer = null;
        this.createdWaypointIds = []; // IDs of waypoints added to WaypointManager by this polygon

        // Survey settings
        this.surveySettings = {
            altitude: 10,
            overlap: 70,
            sidelap: 60,
            angle: 0,
            pattern: 'horizontal',
            hFov: 120,
            vFov: 90,
            spacing: 0,
            cameraWidth: 4000,
            cameraHeight: 3000,
            sensorWidth: 6.17,
            sensorHeight: 4.55,
            focalLength: 4.5,
            speed: 10,
            turnaroundDistance: 50
        };

        // Visual elements
        this.tempMarkers = [];
        this.tempLines = [];
        this.closingLine = null;  // Line connecting last point to first

        this.initialize();
    }

    getLeafletMap() {
        return this.map.map || this.map;
    }

    initialize() {
        console.log('🔷 Initializing Polygon Manager...');

        const tryInitialize = (attempt = 1) => {
            try {
                const leafletMap = this.getLeafletMap();

                if (!leafletMap || !leafletMap.addLayer) {
                    throw new Error('Map not ready');
                }

                if (!window.L || typeof L.featureGroup !== 'function') {
                    throw new Error('Leaflet not ready');
                }

                this.polygonLayer = L.featureGroup();
                this.gridLayer = L.featureGroup();

                leafletMap.addLayer(this.polygonLayer);
                leafletMap.addLayer(this.gridLayer);

                console.log('✅ Polygon Manager initialized');
                return true;

            } catch (error) {
                if (attempt < 10) {
                    setTimeout(() => tryInitialize(attempt + 1), attempt * 200);
                    return false;
                } else {
                    console.error('❌ Failed to initialize after 10 attempts');
                    return false;
                }
            }
        };

        return tryInitialize();
    }

    ensureLayersInitialized() {
        if (this.polygonLayer && this.gridLayer) {
            return true;
        }

        try {
            const leafletMap = this.getLeafletMap();

            if (!this.polygonLayer) {
                this.polygonLayer = L.featureGroup();
                leafletMap.addLayer(this.polygonLayer);
            }

            if (!this.gridLayer) {
                this.gridLayer = L.featureGroup();
                leafletMap.addLayer(this.gridLayer);
            }

            return true;
        } catch (error) {
            console.error('❌ Failed to create layers:', error);
            return false;
        }
    }

    /**
     * CRITICAL FIX: Ensure polygon reference exists
     * If we have polygonPoints but no currentPolygon, recreate it
     */
    ensurePolygonExists() {
        console.log('🔍 Checking polygon existence...');
        console.log('  - currentPolygon:', !!this.currentPolygon);
        console.log('  - polygonPoints:', this.polygonPoints.length);

        // If we have a valid polygon, we're good
        if (this.currentPolygon && this.currentPolygon.getBounds) {
            console.log('✅ Polygon already exists');
            return true;
        }

        // If we have points but no polygon, recreate it
        if (this.polygonPoints.length >= 3) {
            console.log('⚠️ Polygon lost, recreating from points...');
            return this.recreatePolygon();
        }

        console.log('❌ No polygon and no points');
        return false;
    }

    /**
     * Recreate the polygon from stored points
     */
    recreatePolygon() {
        console.log('🔷 Recreating polygon from stored points...');

        if (!this.ensureLayersInitialized()) {
            console.error('❌ Layers not ready');
            return false;
        }

        if (this.polygonPoints.length < 3) {
            console.error('❌ Not enough points to recreate polygon');
            return false;
        }

        try {
            // Create the polygon with ORANGE fill
            this.currentPolygon = L.polygon(this.polygonPoints, {
                color: '#FF8C00',        // Orange border
                weight: 3,
                opacity: 1,
                fillColor: '#FF8C00',    // Orange fill
                fillOpacity: 0.3         // Semi-transparent (30%)
            }).addTo(this.polygonLayer);

            console.log('✅ Polygon recreated successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to recreate polygon:', error);
            return false;
        }
    }

    // ========================================================================
    // DRAWING MODE
    // ========================================================================

    startDrawing() {
        console.log('🔷 Starting polygon drawing mode...');

        if (!this.ensureLayersInitialized()) {
            alert('❌ Map not ready. Please try again in a moment.');
            return;
        }

        if (this.currentPolygon) {
            const clear = confirm('Clear existing polygon?');
            if (clear) {
                this.clearPolygon();
            } else {
                return;
            }
        }

        this.isDrawing = true;
        this.polygonPoints = [];

        const leafletMap = this.getLeafletMap();
        leafletMap.getContainer().style.cursor = 'crosshair';

        this.handleMapClickBound = this.handleMapClick.bind(this);
        leafletMap.on('click', this.handleMapClickBound);

        if (window.MsgConsole) {
            window.MsgConsole.success('🔷 Click map to draw polygon vertices');
            window.MsgConsole.info('💡 Press Enter to finish, ESC to cancel');
        }

        this.handleKeyPressBound = this.handleKeyPress.bind(this);
        document.addEventListener('keydown', this.handleKeyPressBound);
    }

    handleMapClick(e) {
        if (!this.isDrawing) return;

        const latlng = e.latlng;
        const index = this.polygonPoints.length;
        console.log('📍 Point', index + 1, ':', latlng.lat.toFixed(6), latlng.lng.toFixed(6));

        this.polygonPoints.push(latlng);

        // ── Draggable vertex marker during drawing ─────────────────────────────────
        const icon = L.divIcon({
            className: '',
            html: `<div style="
                width: 14px;
                height: 14px;
                background: #FF8C00;
                border: 2px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 6px rgba(0,0,0,0.5);
                cursor: grab;
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        const marker = L.marker(latlng, {
            icon: icon,
            draggable: true,
            autoPan: true,
            zIndexOffset: 1000
        }).addTo(this.polygonLayer);

        marker._drawingIndex = index;

        marker.on('drag', (ev) => {
            this.polygonPoints[marker._drawingIndex] = ev.latlng;
            this._updatePreviewLines();
        });

        marker.on('dragend', () => {
            console.log(`✏️ Vertex ${marker._drawingIndex} moved to`, this.polygonPoints[marker._drawingIndex]);
        });

        this.tempMarkers.push(marker);

        // Redraw all preview lines to reflect the new point
        this._updatePreviewLines();

        if (window.MsgConsole) {
            window.MsgConsole.info(`📍 Point ${this.polygonPoints.length} added — drag to adjust`);
        }
    }

    /**
     * Rebuild all preview lines between polygonPoints during drawing.
     * Called after every point addition or vertex drag.
     */
    _updatePreviewLines() {
        // Remove old lines
        this.tempLines.forEach(l => this.polygonLayer.removeLayer(l));
        if (this.closingLine) {
            this.polygonLayer.removeLayer(this.closingLine);
            this.closingLine = null;
        }
        this.tempLines = [];

        const pts = this.polygonPoints;

        // Segment lines
        for (let i = 0; i < pts.length - 1; i++) {
            const line = L.polyline([pts[i], pts[i + 1]], {
                color: '#FF8C00',
                weight: 2,
                opacity: 0.8,
                dashArray: '5, 5'
            }).addTo(this.polygonLayer);
            this.tempLines.push(line);
        }

        // Closing line when 3+ points
        if (pts.length >= 3) {
            this.closingLine = L.polyline([pts[pts.length - 1], pts[0]], {
                color: '#FF8C00',
                weight: 2,
                opacity: 0.5,
                dashArray: '10, 5'
            }).addTo(this.polygonLayer);
        }
    }

    handleKeyPress(e) {
        if (e.key === 'Enter' && this.isDrawing) {
            this.finishDrawing();
        } else if (e.key === 'Escape' && this.isDrawing) {
            this.cancelDrawing();
        }
    }

    finishDrawing() {
        console.log('✅ Finishing polygon drawing');
        console.log('Points collected:', this.polygonPoints.length);

        if (this.polygonPoints.length < 3) {
            alert('❌ Polygon needs at least 3 points!');
            return;
        }

        this.isDrawing = false;
        const leafletMap = this.getLeafletMap();
        leafletMap.getContainer().style.cursor = '';
        leafletMap.off('click', this.handleMapClickBound);
        document.removeEventListener('keydown', this.handleKeyPressBound);

        this.clearTempElements();

        const polygonCreated = this.createPolygon();

        if (!polygonCreated) {
            console.error('❌ Failed to create polygon');
            alert('❌ Failed to create polygon. Check console for details.');
            return;
        }

        this.generateSurveyGrid();

        // Immediately enable vertex dragging — no need to click "Edit Polygon"
        this.isEditing = true;
        this._rebuildVertexMarkers();

        if (window.MsgConsole) {
            window.MsgConsole.success(`✅ Polygon created with ${this.polygonPoints.length} vertices`);
            window.MsgConsole.info('✏️ Drag orange handles to reshape · Regenerate grid from Survey Settings');
        }
    }

    cancelDrawing() {
        console.log('❌ Cancelling polygon drawing');

        this.isDrawing = false;
        this.polygonPoints = [];
        const leafletMap = this.getLeafletMap();
        leafletMap.getContainer().style.cursor = '';
        leafletMap.off('click', this.handleMapClickBound);
        document.removeEventListener('keydown', this.handleKeyPressBound);

        this.clearTempElements();

        if (window.MsgConsole) {
            window.MsgConsole.info('Polygon drawing cancelled');
        }
    }

    clearTempElements() {
        this.tempMarkers.forEach(m => this.polygonLayer.removeLayer(m));
        this.tempLines.forEach(l => this.polygonLayer.removeLayer(l));
        if (this.closingLine) {
            this.polygonLayer.removeLayer(this.closingLine);
            this.closingLine = null;
        }
        this.tempMarkers = [];
        this.tempLines = [];
    }

    // ========================================================================
    // POLYGON CREATION
    // ========================================================================

    createPolygon() {
        console.log('🔷 Creating polygon from points...');

        if (this.polygonPoints.length < 3) {
            console.error('❌ Not enough points');
            return false;
        }

        if (!this.ensureLayersInitialized()) {
            console.error('❌ Layers not initialized');
            return false;
        }

        try {
            // ✅ FIX: Wipe the entire polygon layer so no stale drawing lines survive
            this.polygonLayer.clearLayers();
            this.tempMarkers = [];
            this.tempLines = [];
            this.closingLine = null;

            // Create polygon with ORANGE fill and proper styling
            this.currentPolygon = L.polygon(this.polygonPoints, {
                color: '#FF8C00',        // Orange border
                weight: 3,
                opacity: 1,
                fillColor: '#FF8C00',    // Orange fill
                fillOpacity: 0.3         // Semi-transparent (30%)
            }).addTo(this.polygonLayer);

            console.log('✅ Polygon created:', !!this.currentPolygon);

            // Add draggable vertex markers in ORANGE
            this.polygonPoints.forEach((point, index) => {
                this._addVertexMarker(point, index);
            });

            const area = this.calculatePolygonArea();
            console.log(`📏 Area: ${(area / 10000).toFixed(2)} hectares`);

            if (window.MsgConsole) {
                window.MsgConsole.success(`📏 Area: ${(area / 10000).toFixed(2)} hectares`);
            }

            return true;

        } catch (error) {
            console.error('❌ Error creating polygon:', error);
            this.currentPolygon = null;
            return false;
        }
    }

    calculatePolygonArea() {
        if (!this.currentPolygon || this.polygonPoints.length < 3) return 0;

        let area = 0;
        const points = this.polygonPoints;

        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].lat * points[j].lng;
            area -= points[j].lat * points[i].lng;
        }

        area = Math.abs(area / 2);
        const metersPerDegree = 111320;
        area = area * metersPerDegree * metersPerDegree;

        return area;
    }

    // ========================================================================
    // SURVEY GRID GENERATION
    // ========================================================================

    generateSurveyGrid() {
        console.log('📐 Generating survey grid...');

        // CRITICAL FIX: Ensure polygon exists before generating grid
        if (!this.ensurePolygonExists()) {
            console.error('❌ Cannot generate grid - no polygon');
            if (window.MsgConsole) {
                window.MsgConsole.error('Draw a polygon first! Click POLYGON → Draw Polygon');
            }
            alert('❌ No polygon found!\n\nPlease draw a polygon first:\n1. Click POLYGON → Draw Polygon\n2. Click on map to add vertices\n3. Press Enter to finish');
            return;
        }

        console.log('✅ Polygon confirmed, generating grid...');

        this.clearGrid();

        const gridParams = this.calculateGridParameters();
        const pattern = this.surveySettings.pattern || 'horizontal';
        
        let clippedLines = [];
        
        if (pattern === 'horizontal') {
            gridParams.angle = 0;
            const gridLines = this.generateGridLines(gridParams);
            clippedLines = this.clipLinesToPolygon(gridLines);
        } else if (pattern === 'vertical') {
            gridParams.angle = 90;
            const gridLines = this.generateGridLines(gridParams);
            clippedLines = this.clipLinesToPolygon(gridLines);
        } else if (pattern === 'crosshatch') {
            gridParams.angle = 0;
            const gridLinesH = this.generateGridLines(gridParams);
            const clippedH = this.clipLinesToPolygon(gridLinesH);
            
            gridParams.angle = 90;
            const gridLinesV = this.generateGridLines(gridParams);
            const clippedV = this.clipLinesToPolygon(gridLinesV);
            
            clippedLines = clippedH.concat(clippedV);
        } else if (pattern === 'rectangle') {
            // Rectangle pattern: survey the actual border of the polygon
            const pts = this.polygonPoints;
            for (let i = 0; i < pts.length; i++) {
                const nextPt = pts[(i + 1) % pts.length];
                clippedLines.push([pts[i], nextPt]);
            }
        } else if (pattern === 'circle') {
            // Circle: keep segments where at least one endpoint is inside the polygon
            const allLines = this.generateCircleLines(gridParams);
            clippedLines = allLines.filter(line =>
                this.pointInPolygon(line[0]) || this.pointInPolygon(line[1])
            );
        }

        this.createWaypointsFromGrid(clippedLines, pattern);
        this.drawGrid(clippedLines);

        if (window.MsgConsole) {
            window.MsgConsole.success(`✅ Survey grid: ${clippedLines.length} passes, ${this.surveyGrid.length} waypoints`);
        }
    }

    /**
     * Ray-casting point-in-polygon test.
     * Returns true if the LatLng point is inside this.polygonPoints.
     */
    pointInPolygon(latlng) {
        const x = latlng.lat;
        const y = latlng.lng;
        const pts = this.polygonPoints;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].lat, yi = pts[i].lng;
            const xj = pts[j].lat, yj = pts[j].lng;
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    calculateGridParameters() {
        const s = this.surveySettings;
        const alt = s.altitude;

        // ── FOV-based footprint ─────────────────────────────────────────────
        const hFov = s.hFov || 120;
        const vFov = s.vFov || 90;
        const footprintW = 2 * alt * Math.tan((hFov / 2) * Math.PI / 180); // cross-track m
        const footprintH = 2 * alt * Math.tan((vFov / 2) * Math.PI / 180); // along-track m

        // Use stored spacing if valid; otherwise derive from sidelap
        let spacing = s.spacing && s.spacing > 0 ? s.spacing : footprintW * (1 - s.sidelap / 100);
        // Clamp spacing to at least 1 m
        spacing = Math.max(1, spacing);

        console.log('📐 Grid parameters (FOV-based):', {
            altitude: alt + ' m',
            hFov: hFov + '°',
            vFov: vFov + '°',
            footprintW: footprintW.toFixed(2) + ' m',
            footprintH: footprintH.toFixed(2) + ' m',
            spacing: spacing.toFixed(2) + ' m',
            angle: s.angle + '°'
        });

        return {
            spacing: spacing,
            angle: s.angle,
            imageWidth: footprintW,
            imageHeight: footprintH
        };
    }

    generateGridLines(params) {
        console.log('📏 Generating grid lines...');

        const bounds = this.currentPolygon.getBounds();
        const center = bounds.getCenter();

        const angleRad = (params.angle * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);

        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);

        const spacingDeg = params.spacing / 111320;

        const lines = [];
        const numLines = Math.ceil(maxSpan / spacingDeg) + 2;

        for (let i = -numLines; i <= numLines; i++) {
            const offset = i * spacingDeg;

            const startLat = center.lat + offset * cos - maxSpan * sin;
            const startLng = center.lng + offset * sin + maxSpan * cos;
            const endLat = center.lat + offset * cos + maxSpan * sin;
            const endLng = center.lng + offset * sin - maxSpan * cos;

            lines.push([
                L.latLng(startLat, startLng),
                L.latLng(endLat, endLng)
            ]);
        }

        console.log(`✅ Generated ${lines.length} grid lines`);
        return lines;
    }

    generateRectangleLines(params) {
        console.log('📏 Generating rectangle lines...');
        const bounds = this.currentPolygon.getBounds();
        const center = bounds.getCenter();
        
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);
        
        const spacingDeg = params.spacing / 111320;
        const numRects = Math.ceil(maxSpan / (2 * spacingDeg));
        
        const lines = [];
        
        for (let i = 1; i <= numRects; i++) {
            const offset = i * spacingDeg;
            const n = center.lat + offset;
            const s = center.lat - offset;
            const e = center.lng + offset;
            const w = center.lng - offset;
            
            // Top: w -> e
            lines.push([L.latLng(n, w), L.latLng(n, e)]);
            // Right: n -> s
            lines.push([L.latLng(n, e), L.latLng(s, e)]);
            // Bottom: e -> w
            lines.push([L.latLng(s, e), L.latLng(s, w)]);
            // Left: s -> n
            lines.push([L.latLng(s, w), L.latLng(n, w)]);
        }
        return lines;
    }

    generateCircleLines(params) {
        console.log('📏 Generating circle lines...');
        const bounds = this.currentPolygon.getBounds();
        const center = bounds.getCenter();
        
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);
        
        const spacingDeg = params.spacing / 111320;
        const numCircles = Math.ceil(maxSpan / (2 * spacingDeg));
        
        const lines = [];
        const segments = 36; // 10 degrees per segment
        
        for (let i = 1; i <= numCircles; i++) {
            const r = i * spacingDeg;
            for (let j = 0; j < segments; j++) {
                const a1 = (j * 2 * Math.PI) / segments;
                const a2 = ((j + 1) * 2 * Math.PI) / segments;
                
                const p1 = L.latLng(center.lat + r * Math.sin(a1), center.lng + r * Math.cos(a1));
                const p2 = L.latLng(center.lat + r * Math.sin(a2), center.lng + r * Math.cos(a2));
                lines.push([p1, p2]);
            }
        }
        return lines;
    }

    clipLinesToPolygon(lines) {
        console.log('✂️ Clipping lines to polygon...');

        const clippedLines = [];

        lines.forEach(line => {
            const intersections = this.getLinePolygonIntersections(line);

            if (intersections.length >= 2) {
                intersections.sort((a, b) => {
                    const distA = line[0].distanceTo(a);
                    const distB = line[0].distanceTo(b);
                    return distA - distB;
                });

                for (let i = 0; i < intersections.length - 1; i += 2) {
                    clippedLines.push([intersections[i], intersections[i + 1]]);
                }
            }
        });

        console.log(`✅ Clipped to ${clippedLines.length} line segments`);
        return clippedLines;
    }

    getLinePolygonIntersections(line) {
        const intersections = [];
        const polygonPoints = this.polygonPoints;

        for (let i = 0; i < polygonPoints.length; i++) {
            const p1 = polygonPoints[i];
            const p2 = polygonPoints[(i + 1) % polygonPoints.length];

            const intersection = this.getLineIntersection(
                line[0].lat, line[0].lng,
                line[1].lat, line[1].lng,
                p1.lat, p1.lng,
                p2.lat, p2.lng
            );

            if (intersection) {
                intersections.push(L.latLng(intersection.lat, intersection.lng));
            }
        }

        return intersections;
    }

    getLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

        if (Math.abs(denom) < 1e-10) return null;

        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                lat: x1 + t * (x2 - x1),
                lng: y1 + t * (y2 - y1)
            };
        }

        return null;
    }

    // ========================================================================
    // WAYPOINT CREATION
    // ========================================================================

    createWaypointsFromGrid(gridLines, pattern = 'horizontal') {
        console.log('📍 Creating waypoints from grid...');

        this.surveyGrid = [];

        if (pattern === 'horizontal' || pattern === 'vertical' || pattern === 'crosshatch') {
            // Alternate line directions for efficient survey pattern
            gridLines.forEach((line, index) => {
                if (index % 2 === 0) {
                    this.surveyGrid.push(line[0]);
                    this.surveyGrid.push(line[1]);
                } else {
                    this.surveyGrid.push(line[1]);
                    this.surveyGrid.push(line[0]);
                }
            });
        } else {
            // Rectangle, Circle
            gridLines.forEach((line) => {
                if (this.surveyGrid.length === 0) {
                    this.surveyGrid.push(line[0]);
                    this.surveyGrid.push(line[1]);
                } else {
                    const lastPoint = this.surveyGrid[this.surveyGrid.length - 1];
                    // Add start point if it's not the same as the last point
                    if (lastPoint.distanceTo(line[0]) > 0.5) { // 0.5 meters
                        this.surveyGrid.push(line[0]);
                    }
                    this.surveyGrid.push(line[1]);
                }
            });
        }

        console.log(`✅ Created ${this.surveyGrid.length} waypoints`);

        // Add survey waypoints to WaypointManager.
        // FIRST remove any waypoints from a previous grid generation so patterns
        // don't stack on top of each other.
        if (window.WaypointManager) {
            // ── Remove previous batch ──────────────────────────────────────
            if (this.createdWaypointIds && this.createdWaypointIds.length > 0) {
                console.log(`🗑️ Removing ${this.createdWaypointIds.length} previous survey waypoints before adding new batch`);
                if (typeof window.WaypointManager.removeWaypointsByIds === 'function') {
                    window.WaypointManager.removeWaypointsByIds(this.createdWaypointIds);
                }
            }
            // Also purge any source-tagged leftovers (belt-and-braces)
            if (typeof window.WaypointManager.removeWaypointsBySource === 'function') {
                window.WaypointManager.removeWaypointsBySource('polygon');
            }

            // ── Add new batch ──────────────────────────────────────────────
            this.createdWaypointIds = [];

            this.surveyGrid.forEach(point => {
                const wp = window.WaypointManager.addWaypoint(
                    point.lat,
                    point.lng,
                    this.surveySettings.altitude,
                    this.surveySettings.speed,
                    'polygon'
                );
                if (wp && wp.id != null) {
                    this.createdWaypointIds.push(wp.id);
                }
            });

            console.log(`📌 Tracked ${this.createdWaypointIds.length} polygon waypoint IDs:`, this.createdWaypointIds);

            if (window.MsgConsole) {
                window.MsgConsole.success(`✅ ${this.surveyGrid.length} survey waypoints added to mission`);
            }
        }
    }

    // ========================================================================
    // VISUALIZATION
    // ========================================================================

    drawGrid(gridLines) {
        console.log('🎨 Drawing grid visualization...');

        if (!this.ensureLayersInitialized()) {
            console.error('❌ Cannot draw grid - layers not initialized');
            return;
        }

        gridLines.forEach((line, index) => {
            const polyline = L.polyline(line, {
                color: '#00D9FF',
                weight: 2,
                opacity: 0.6,
                dashArray: '10, 5'
            }).addTo(this.gridLayer);

            const midpoint = L.latLng(
                (line[0].lat + line[1].lat) / 2,
                (line[0].lng + line[1].lng) / 2
            );

            const label = L.marker(midpoint, {
                icon: L.divIcon({
                    className: 'grid-line-label',
                    html: `<div style="background: rgba(0, 217, 255, 0.9); color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold;">${index + 1}</div>`,
                    iconSize: [30, 20]
                })
            }).addTo(this.gridLayer);
        });

        console.log('✅ Grid visualization complete');
    }

    // ========================================================================
    // VERTEX MARKER HELPERS (used during createPolygon AND editing)
    // ========================================================================

    /**
     * Create a single draggable vertex marker and attach it to polygonLayer.
     * Dragging the marker updates polygonPoints[index] and redraws the polygon.
     */
    _addVertexMarker(point, index) {
        const icon = L.divIcon({
            className: '',
            html: `<div style="
                width: 14px;
                height: 14px;
                background: #FF8C00;
                border: 2px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 4px rgba(0,0,0,0.5);
                cursor: grab;
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        const marker = L.marker(point, {
            icon: icon,
            draggable: true,
            autoPan: true,
            zIndexOffset: 1000
        }).addTo(this.polygonLayer);

        marker._polygonVertexIndex = index;

        marker.on('drag', (e) => {
            this.polygonPoints[marker._polygonVertexIndex] = e.latlng;
            if (this.currentPolygon) {
                this.currentPolygon.setLatLngs(this.polygonPoints);
                // ✅ FIX: Force Leaflet to repaint the SVG path immediately
                this.currentPolygon.redraw();
            }
        });

        marker.on('dragend', () => {
            console.log(`✏️ Vertex ${marker._polygonVertexIndex} moved to`, this.polygonPoints[marker._polygonVertexIndex]);
            if (window.MsgConsole) {
                window.MsgConsole.info(`📍 Vertex ${marker._polygonVertexIndex + 1} updated — regenerate grid if needed`);
            }
        });

        this.tempMarkers.push(marker);
        return marker;
    }

    /**
     * Rebuild all vertex markers (used after editing session starts on existing polygon).
     */
    _rebuildVertexMarkers() {
        // Remove old markers without clearing the polygon itself
        this.tempMarkers.forEach(m => {
            if (this.polygonLayer) this.polygonLayer.removeLayer(m);
        });
        this.tempMarkers = [];

        this.polygonPoints.forEach((point, index) => {
            this._addVertexMarker(point, index);
        });
    }

    // ========================================================================
    // SURVEY PATTERN
    // ========================================================================
    
    showSurveyPatternModal() {
        console.log('📐 Opening survey pattern modal...');
        
        if (!this.ensurePolygonExists()) {
            alert('❌ Draw a polygon first!\n\nClick POLYGON → Draw Polygon');
            return;
        }

        const currentPattern = this.surveySettings.pattern || 'horizontal';
        
        const html = `
            <div style="font-family: 'Inter', sans-serif; padding: 20px;">
                <h3 style="margin: 0 0 20px 0; color: #1a1a1a;">Select Survey Pattern</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button class="pattern-btn ${currentPattern === 'horizontal' ? 'active' : ''}" data-pattern="horizontal" style="padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: ${currentPattern === 'horizontal' ? '#9c27b0' : '#f9f9f9'}; color: ${currentPattern === 'horizontal' ? 'white' : '#333'}; cursor: pointer; text-align: center;">
                        <div style="font-size: 24px; margin-bottom: 5px;">=</div>
                        <div style="font-size: 12px;">Horizontal</div>
                    </button>
                    <button class="pattern-btn ${currentPattern === 'vertical' ? 'active' : ''}" data-pattern="vertical" style="padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: ${currentPattern === 'vertical' ? '#9c27b0' : '#f9f9f9'}; color: ${currentPattern === 'vertical' ? 'white' : '#333'}; cursor: pointer; text-align: center;">
                        <div style="font-size: 24px; margin-bottom: 5px;">||</div>
                        <div style="font-size: 12px;">Vertical</div>
                    </button>
                    <button class="pattern-btn ${currentPattern === 'crosshatch' ? 'active' : ''}" data-pattern="crosshatch" style="padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: ${currentPattern === 'crosshatch' ? '#9c27b0' : '#f9f9f9'}; color: ${currentPattern === 'crosshatch' ? 'white' : '#333'}; cursor: pointer; text-align: center;">
                        <div style="font-size: 24px; margin-bottom: 5px;">╬</div>
                        <div style="font-size: 12px;">Crosshatch</div>
                    </button>
                    <button class="pattern-btn ${currentPattern === 'rectangle' ? 'active' : ''}" data-pattern="rectangle" style="padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: ${currentPattern === 'rectangle' ? '#9c27b0' : '#f9f9f9'}; color: ${currentPattern === 'rectangle' ? 'white' : '#333'}; cursor: pointer; text-align: center;">
                        <div style="font-size: 24px; margin-bottom: 5px;">▭</div>
                        <div style="font-size: 12px;">Rectangle</div>
                    </button>
                    <button class="pattern-btn ${currentPattern === 'circle' ? 'active' : ''}" data-pattern="circle" style="grid-column: span 2; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: ${currentPattern === 'circle' ? '#9c27b0' : '#f9f9f9'}; color: ${currentPattern === 'circle' ? 'white' : '#333'}; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;">
                        <div style="font-size: 16px; border: 2px solid ${currentPattern === 'circle' ? 'white' : '#9c27b0'}; border-radius: 50%; width: 16px; height: 16px;"></div>
                        <div style="font-size: 14px;">Circle</div>
                    </button>
                </div>
                
                <div style="margin-top: 20px; display: flex; gap: 10px;">
                    <button id="closePatternModalBtn" style="flex: 1; padding: 10px; background: #ddd; color: #333; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">Close</button>
                </div>
            </div>
        `;
        
        const modal = document.createElement('div');
        modal.id = 'surveyPatternModal';
        modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); z-index: 10000; min-width: 350px;';
        modal.innerHTML = html;
        
        const overlay = document.createElement('div');
        overlay.id = 'surveyPatternOverlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999;';
        overlay.onclick = () => this.closeSurveyPatternModal();
        
        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // Add event listeners to pattern buttons
        const patternBtns = modal.querySelectorAll('.pattern-btn');
        patternBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pattern = e.currentTarget.getAttribute('data-pattern');
                this.surveySettings.pattern = pattern;
                
                // Update UI visually
                patternBtns.forEach(b => {
                    b.style.background = '#f9f9f9';
                    b.style.color = '#333';
                    if(b.getAttribute('data-pattern') === 'circle') {
                        b.children[0].style.borderColor = '#9c27b0';
                    }
                });
                e.currentTarget.style.background = '#9c27b0';
                e.currentTarget.style.color = 'white';
                if(pattern === 'circle') {
                    e.currentTarget.children[0].style.borderColor = 'white';
                }

                // Pattern saved — do NOT generate waypoints here.
                // The user must go to Survey Settings → Apply & Regenerate.
                console.log('📐 Pattern selected:', pattern, '— awaiting Survey Settings apply');
                if (window.MsgConsole) {
                    window.MsgConsole.success('✅ Pattern set to ' + pattern + ' — open Survey Settings to apply');
                }
            });
        });

        document.getElementById('closePatternModalBtn').addEventListener('click', () => {
            this.closeSurveyPatternModal();
        });
    }

    closeSurveyPatternModal() {
        const modal = document.getElementById('surveyPatternModal');
        const overlay = document.getElementById('surveyPatternOverlay');
        if (modal) modal.remove();
        if (overlay) overlay.remove();
    }

    // ========================================================================
    // EDITING MODE
    // ========================================================================

    startEditing() {
        console.log('✏️ Starting polygon edit mode...');

        if (!this.ensurePolygonExists()) {
            alert('❌ No polygon to edit! Draw one first.');
            return;
        }

        this.isEditing = true;

        // Rebuild draggable vertex markers so the user can drag corners
        this._rebuildVertexMarkers();

        if (window.MsgConsole) {
            window.MsgConsole.success('✏️ Drag the orange corner handles to reshape the polygon');
            window.MsgConsole.info('💡 Click "Survey Settings → Apply & Regenerate" after editing to update the grid');
        }

        console.log('✅ Edit mode active — vertex handles are draggable');
    }

    stopEditing() {
        this.isEditing = false;
        console.log('✅ Edit mode stopped');
    }

    // ========================================================================
    // SURVEY SETTINGS
    // ========================================================================

    openSurveySettings() {
        console.log('⚙️ Opening survey settings...');

        // Check if polygon exists before opening settings
        if (!this.ensurePolygonExists()) {
            alert('❌ Draw a polygon first!\n\nClick POLYGON → Draw Polygon');
            return;
        }

        const settings = this.surveySettings;

        const html = `
            <div style="font-family: 'Inter', sans-serif; padding: 20px;">
                <h3 style="margin: 0 0 20px 0; color: #1a1a1a;">Survey Settings</h3>
                
                <div style="display: grid; gap: 15px;">
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Altitude (m):</label>
                        <input type="number" id="surveyAlt" value="${settings.altitude}" step="1" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Overlap (%):</label>
                        <input type="number" id="surveyOverlap" value="${settings.overlap}" step="5" min="0" max="90" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Sidelap (%):</label>
                        <input type="number" id="surveySidelap" value="${settings.sidelap}" step="5" min="0" max="90" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Grid Angle (°):</label>
                        <input type="number" id="surveyAngle" value="${settings.angle}" step="1" min="0" max="359" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Speed (m/s):</label>
                        <input type="number" id="surveySpeed" value="${settings.speed}" step="0.5" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
                
                <div style="margin-top: 20px; display: flex; gap: 10px;">
                    <button onclick="window.PolygonManager.applySurveySettings()" style="flex: 1; padding: 10px; background: #E6007E; color: white; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">Apply & Regenerate Grid</button>
                    <button onclick="window.PolygonManager.closeSurveySettings()" style="flex: 1; padding: 10px; background: #ddd; color: #333; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">Cancel</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.id = 'surveySettingsModal';
        modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); z-index: 10000; min-width: 400px;';
        modal.innerHTML = html;

        const overlay = document.createElement('div');
        overlay.id = 'surveySettingsOverlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999;';
        overlay.onclick = () => this.closeSurveySettings();

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    }

    applySurveySettings() {
        const alt = parseFloat(document.getElementById('surveyAlt').value);
        const overlap = parseFloat(document.getElementById('surveyOverlap').value);
        const sidelap = parseFloat(document.getElementById('surveySidelap').value);
        const angle = parseFloat(document.getElementById('surveyAngle').value);
        const speed = parseFloat(document.getElementById('surveySpeed').value);

        this.surveySettings.altitude = alt;
        this.surveySettings.overlap = overlap;
        this.surveySettings.sidelap = sidelap;
        this.surveySettings.angle = angle;
        this.surveySettings.speed = speed;

        this.closeSurveySettings();

        // Regenerate grid with new settings
        console.log('🔄 Regenerating grid with new settings...');
        this.generateSurveyGrid();

        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Survey settings updated and grid regenerated');
        }
    }

    closeSurveySettings() {
        const modal = document.getElementById('surveySettingsModal');
        const overlay = document.getElementById('surveySettingsOverlay');
        if (modal) modal.remove();
        if (overlay) overlay.remove();
    }

    // ========================================================================
    // CLEAR FUNCTIONS
    // ========================================================================

    clearPolygon() {
        console.log('🗑️ Clearing polygon...');

        // Remove the exact waypoints this polygon created from WaypointManager.
        // Uses tracked IDs (primary) and source tag (fallback) — both belt-and-braces.
        if (window.WaypointManager) {
            if (this.createdWaypointIds && this.createdWaypointIds.length > 0) {
                console.log(`🗑️ Removing ${this.createdWaypointIds.length} tracked polygon waypoints`);
                if (typeof window.WaypointManager.removeWaypointsByIds === 'function') {
                    window.WaypointManager.removeWaypointsByIds(this.createdWaypointIds);
                }
                this.createdWaypointIds = [];
            }
            // Fallback: also wipe any remaining source-tagged waypoints
            if (typeof window.WaypointManager.removeWaypointsBySource === 'function') {
                window.WaypointManager.removeWaypointsBySource('polygon');
            }
        }

        if (this.currentPolygon) {
            if (this.polygonLayer) {
                this.polygonLayer.clearLayers();
            }
            this.currentPolygon = null;
            this.polygonPoints = [];
            this.clearTempElements();

            if (window.MsgConsole) {
                window.MsgConsole.info('Polygon and survey waypoints cleared');
            }
        }

        this.clearGrid();
    }

    clearGrid() {
        console.log('🗑️ Clearing survey grid...');

        if (this.gridLayer) {
            this.gridLayer.clearLayers();
        }

        this.surveyGrid = [];
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    centerPolygon() {
        if (this.ensurePolygonExists()) {
            const leafletMap = this.getLeafletMap();
            leafletMap.fitBounds(this.currentPolygon.getBounds(), { padding: [50, 50] });
        }
    }

    exportPolygon() {
        if (!this.ensurePolygonExists()) {
            alert('No polygon to export!');
            return null;
        }

        return {
            points: this.polygonPoints.map(p => ({ lat: p.lat, lng: p.lng })),
            settings: this.surveySettings,
            grid: this.surveyGrid.map(p => ({ lat: p.lat, lng: p.lng }))
        };
    }
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

function initializePolygonManager() {
    console.log('🎯 Initializing Polygon Manager...');

    let attempts = 0;
    const maxAttempts = 50;

    const checkReady = setInterval(() => {
        attempts++;

        const mapInstance = window.tmap || window.mapInstance || window.myMap || window.gcsMap;

        const hasValidMap = mapInstance && (
            (mapInstance.map && mapInstance.map.addLayer) ||
            mapInstance.addLayer
        );

        if (hasValidMap && window.L && typeof L.featureGroup === 'function') {
            clearInterval(checkReady);

            try {
                console.log('✅ Map detected, creating PolygonManager...');

                setTimeout(() => {
                    const polygonManager = new PolygonManager(mapInstance);
                    window.PolygonManager = polygonManager;

                    console.log('✅ PolygonManager available globally');
                    console.log('💡 Use POLYGON → Draw Polygon to begin');
                }, 200);

            } catch (error) {
                console.error('❌ Error creating PolygonManager:', error);
            }
        } else if (attempts >= maxAttempts) {
            clearInterval(checkReady);
            console.error('❌ Polygon Manager initialization timeout');
        }
    }, 100);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializePolygonManager, 500);
    });
} else {
    setTimeout(initializePolygonManager, 500);
}

console.log('✅ Polygon Manager Script Loaded (FINAL FIX)');