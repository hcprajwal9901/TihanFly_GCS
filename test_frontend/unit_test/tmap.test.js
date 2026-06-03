describe('TMap Leaflet Mapping Library Behavioral Test Suite', () => {
  let mapMock;
  let markerMock;
  let layerGroupMock;
  let polylineMock;
  let originalQuerySelectorAll;
  let originalQuerySelector;
  let mapEvents = {};
  let markerEvents = {};

  beforeAll(() => {
    jest.useFakeTimers();

    originalQuerySelectorAll = document.querySelectorAll;
    originalQuerySelector = document.querySelector;

    // Setup robust Leaflet mock environment
    mapEvents = {};
    mapMock = {
      setView: jest.fn().mockReturnThis(),
      panTo: jest.fn().mockReturnThis(),
      on: jest.fn((evt, cb) => {
        mapEvents[evt] = cb;
      }),
      off: jest.fn((evt, cb) => {
        if (mapEvents[evt] === cb) {
          delete mapEvents[evt];
        }
      }),
      getCenter: jest.fn().mockReturnValue({ lat: 17.385, lng: 78.486 }),
      getZoom: jest.fn().mockReturnValue(16),
      setZoom: jest.fn(),
      getBounds: jest.fn().mockReturnValue({
        getNorthEast: () => ({ lat: 17.39, lng: 78.49 }),
        getSouthWest: () => ({ lat: 17.38, lng: 78.48 })
      }),
      fitBounds: jest.fn(),
      removeLayer: jest.fn()
    };

    markerEvents = {};
    markerMock = {
      addTo: jest.fn().mockReturnThis(),
      on: jest.fn((evt, cb) => {
        markerEvents[evt] = cb;
      }),
      off: jest.fn((evt) => {
        delete markerEvents[evt];
      }),
      setLatLng: jest.fn().mockReturnThis(),
      setIcon: jest.fn().mockReturnThis(),
      bindPopup: jest.fn().mockReturnThis(),
      isPopupOpen: jest.fn().mockReturnValue(false),
      getLatLng: jest.fn().mockReturnValue({ lat: 17.385, lng: 78.486 })
    };

    layerGroupMock = {
      addTo: jest.fn().mockReturnThis(),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      clearLayers: jest.fn()
    };

    polylineMock = {
      addTo: jest.fn().mockReturnThis()
    };

    global.L = {
      map: jest.fn().mockReturnValue(mapMock),
      layerGroup: jest.fn().mockReturnValue(layerGroupMock),
      tileLayer: jest.fn().mockReturnValue({
        addTo: jest.fn().mockReturnThis()
      }),
      TileLayer: {
        extend: jest.fn().mockImplementation(() => {
          return function() {
            return {
              addTo: jest.fn().mockReturnThis(),
              _getZoomForUrl: () => 16
            };
          };
        })
      },
      divIcon: jest.fn((opts) => opts),
      marker: jest.fn().mockReturnValue(markerMock),
      polyline: jest.fn().mockReturnValue(polylineMock),
      latLng: jest.fn((lat, lng) => ({
        lat,
        lng,
        distanceTo: jest.fn((other) => {
          const dy = other.lat - lat;
          const dx = other.lng - lng;
          return Math.sqrt(dx*dx + dy*dy) * 111000; // rough meters mapping
        })
      }))
    };

    window.L = global.L;

    // Delete mock class from setup.js so we load the real implementation
    delete global.TMap;
    if (typeof window !== 'undefined') {
      delete window.TMap;
    }

    // Load actual TMap library and explicitly attach to window/global
    const fs = require('fs');
    const path = require('path');
    const absolutePath = path.resolve(__dirname, '../../js/tmap.js');
    let code = fs.readFileSync(absolutePath, 'utf8');
    code += '\nwindow.TMap = TMap;\nglobal.TMap = TMap;';

    const scriptElement = document.createElement('script');
    scriptElement.textContent = code;
    document.body.appendChild(scriptElement);
    document.body.removeChild(scriptElement);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Neutralize setup.js aggressive DOM guards
    document.querySelectorAll = (sel) => Array.from(document.body.querySelectorAll(sel));
    document.querySelector = (sel) => document.body.querySelector(sel);

    mapEvents = {};
    markerEvents = {};
    document.body.innerHTML = '<div id="map-container"></div>';

    // Mock global window structures that tmap references
    window.WaypointManager = { currentMode: false };
    window.selectedSysId = 0;
    window._primarySysId = 1;
  });

  afterEach(() => {
    document.querySelectorAll = originalQuerySelectorAll;
    document.querySelector = originalQuerySelector;
  });

  describe('Instantiation and Tile Loading', () => {
    it('should create leaflet map and load tiles (online)', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, false);
      
      expect(global.L.map).toHaveBeenCalledWith('map-container', expect.any(Object));
      expect(mapMock.setView).toHaveBeenCalledWith([17.385, 78.486], 16);
      expect(global.L.layerGroup).toHaveBeenCalledTimes(2); // marker and route layers
      
      // Online mode should use extend & TileLayer creation
      expect(global.L.TileLayer.extend).toHaveBeenCalled();
    });

    it('should load offline tiles if specified', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      expect(global.L.tileLayer).toHaveBeenCalledWith('tiles/{z}/{x}/{y}.png', expect.any(Object));
    });
  });

  describe('Static & Home Markers Rendering', () => {
    it('addRotatingHomeMarker should create icon, marker and handle centering on click', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      const home = tmap.addRotatingHomeMarker(17.385, 78.486, 'Ground Base');
      expect(global.L.divIcon).toHaveBeenCalled();
      expect(global.L.marker).toHaveBeenCalledWith([17.385, 78.486], expect.any(Object));
      expect(tmap.getMarkerCount()).toBe(1);

      // Trigger click event on home marker
      expect(markerEvents['click']).toBeDefined();
      markerEvents['click']();

      expect(mapMock.setView).toHaveBeenCalledWith([17.385, 78.486], 18);
    });

    it('addStaticLocation should render stylized HTML location', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      const staticLoc = tmap.addStaticLocation(17.391, 78.492, 'Check Point B');
      expect(global.L.divIcon).toHaveBeenCalled();
      expect(tmap.getMarkerCount()).toBe(1);
    });
  });

  describe('Marker Operations & Coordinates', () => {
    it('should add, get, and clear markers correctly', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      const m1 = tmap.addMarker(17.1, 78.1, true);
      const m2 = tmap.addMarker(17.2, 78.2, true);
      expect(tmap.getMarkerCount()).toBe(2);

      // Get coords
      const coords = tmap.getMarkerCoordinates();
      expect(coords).toEqual([
        { lat: 17.385, lng: 78.486 }, // marker mock returns default coordinate
        { lat: 17.385, lng: 78.486 }
      ]);

      // Remove last marker
      tmap.removeLastMarker();
      expect(tmap.getMarkerCount()).toBe(1);

      // Clear markers
      tmap.clearMarkers();
      expect(tmap.getMarkerCount()).toBe(0);
    });
  });

  describe('Routes & Distance Calculations', () => {
    it('drawRoute should draw a polyline if points count >= 2', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      const routePoints = [
        { lat: 17.385, lng: 78.486 },
        { lat: 17.386, lng: 78.487 }
      ];

      tmap.drawRoute(routePoints, { color: '#00FF00' });
      expect(global.L.polyline).toHaveBeenCalledWith(
        [[17.385, 78.486], [17.386, 78.487]],
        expect.objectContaining({ color: '#00FF00' })
      );
    });

    it('calculateDistance should compute distance between points', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      const routePoints = [
        { lat: 17.0, lng: 78.0 },
        { lat: 17.0, lng: 78.1 }
      ];

      const dist = tmap.calculateDistance(routePoints);
      expect(dist).toBeGreaterThan(0);
    });
  });

  describe('Interactive Events and Weather clicks', () => {
    it('onClick should trigger callback when clickEnabled is true', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      const clickCallback = jest.fn();

      tmap.onClick(clickCallback);
      tmap.enableClick();

      // Trigger map click
      expect(mapEvents['click']).toBeDefined();
      mapEvents['click']({ latlng: { lat: 17.385, lng: 78.486 } });

      expect(clickCallback).toHaveBeenCalledWith(17.385, 78.486, expect.any(Object));
    });

    it('should trigger weather click callback only when not placing waypoints', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      const weatherCallback = jest.fn();

      tmap.registerWeatherClickHandler(weatherCallback);
      tmap.enableWeatherClicks();

      // Case 1: In waypoint mode - should not trigger
      window.WaypointManager.currentMode = true;
      mapEvents['click']({ latlng: { lat: 17.385, lng: 78.486 } });
      expect(weatherCallback).not.toHaveBeenCalled();

      // Case 2: Not in waypoint mode - should trigger
      window.WaypointManager.currentMode = false;
      mapEvents['click']({ latlng: { lat: 17.385, lng: 78.486 } });
      expect(weatherCallback).toHaveBeenCalledWith(17.385, 78.486);
    });
  });

  describe('Live Drone positions rendering', () => {
    it('should update or create vehicle marker and lock auto-pan', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      // Update drone position (creates marker)
      tmap.updateDronePosition(17.385, 78.486, 90);
      expect(tmap.droneMarkers[1]).toBeDefined();

      // Lock auto-pan checks map setView
      expect(mapMock.setView).toHaveBeenCalledWith([17.385, 78.486], 17, expect.any(Object));

      // Update position again (updates marker)
      tmap.updateDronePosition(17.386, 78.487, 180);
      expect(markerMock.setLatLng).toHaveBeenCalledWith([17.386, 78.487]);

      // Prune vehicle markers
      tmap.pruneStaleVehicleMarkers([2]); // only vehicle 2 is active, 1 is stale
      expect(mapMock.removeLayer).toHaveBeenCalledWith(markerMock);
      expect(tmap.droneMarkers[1]).toBeUndefined();
    });

    it('clearDroneMarkers should remove all vehicles', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      tmap.updateDronePositionForSysid(1, 17.385, 78.486);
      tmap.updateDronePositionForSysid(2, 17.386, 78.487);

      tmap.clearDroneMarkers();
      expect(tmap.droneMarkers).toEqual({});
    });
  });
});