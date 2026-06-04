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
    // Delete mock class from setup.js so we load the real implementation
    delete global.TMap;
    if (typeof window !== 'undefined') {
      delete window.TMap;
    }

    // Load actual TMap library via global.loadScript
    global.loadScript('js/tmap.js');
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

  describe('TMap Edge Cases and Untested Branches Coverage', () => {
    it('should cover addRotatingHomeMarker options and returns', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      const home1 = tmap.addRotatingHomeMarker(17.385, 78.486, 'Home Bottom', { labelDirection: 'bottom' });
      const home2 = tmap.addRotatingHomeMarker(17.385, 78.486, 'Home Top', { labelDirection: 'top' });
      const home3 = tmap.addRotatingHomeMarker(17.385, 78.486, 'Home Left', { labelDirection: 'left' });
      const home4 = tmap.addRotatingHomeMarker(17.385, 78.486, 'Home Right', { labelDirection: 'right' });
      const home5 = tmap.addRotatingHomeMarker(17.385, 78.486, 'Home No Label', { permanentLabel: false });

      expect(typeof home1.remove).toBe('function');
      expect(typeof home1.center).toBe('function');

      // Test helper execution
      home1.center();
      expect(mapMock.setView).toHaveBeenCalledWith([17.385, 78.486], 18);

      const initialCount = tmap.getMarkerCount();
      home1.remove();
      expect(tmap.getMarkerCount()).toBe(initialCount - 1);
    });

    it('should cover addStaticLocation options and labelDirections', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      tmap.addStaticLocation(17.385, 78.486, 'Loc Left', { labelDirection: 'left' });
      tmap.addStaticLocation(17.385, 78.486, 'Loc Top', { labelDirection: 'top' });
      tmap.addStaticLocation(17.385, 78.486, 'Loc Bottom', { labelDirection: 'bottom' });
      tmap.addStaticLocation(17.385, 78.486, 'Loc No Label', { permanentLabel: false });
      
      expect(tmap.getMarkerCount()).toBe(4);
    });

    it('should cover marker operations edge cases', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      // removeLastMarker on empty markers array
      tmap.removeLastMarker(); 
      expect(tmap.getMarkerCount()).toBe(0);

      // Add a couple of markers
      const m1 = tmap.addMarker(17.1, 78.1);
      const m2 = tmap.addMarker(17.2, 78.2);
      expect(tmap.getMarkers()).toHaveLength(2);

      // removeMarkerAt valid and invalid indices
      tmap.removeMarkerAt(5); // invalid index, nothing happens
      expect(tmap.getMarkerCount()).toBe(2);

      tmap.removeMarkerAt(-1); // invalid index, nothing happens
      expect(tmap.getMarkerCount()).toBe(2);

      tmap.removeMarkerAt(0); // valid index, removes first marker
      expect(tmap.getMarkerCount()).toBe(1);
    });

    it('should cover drawRoute and calculateDistance edge cases', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      // drawRoute with < 2 coordinates
      expect(tmap.drawRoute([])).toBeNull();
      expect(tmap.drawRoute([{ lat: 17.385, lng: 78.486 }])).toBeNull();

      // drawRoute with default options
      const route = tmap.drawRoute([
        { lat: 17.385, lng: 78.486 },
        { lat: 17.386, lng: 78.487 }
      ]);
      expect(global.L.polyline).toHaveBeenCalledWith(
        [[17.385, 78.486], [17.386, 78.487]],
        expect.objectContaining({ color: '#FF0000', weight: 3, opacity: 0.7 })
      );

      // clearRoute
      tmap.clearRoute();
      expect(layerGroupMock.clearLayers).toHaveBeenCalled();

      // calculateDistance with < 2 coordinates
      expect(tmap.calculateDistance([])).toBe(0);
      expect(tmap.calculateDistance([{ lat: 17.385, lng: 78.486 }])).toBe(0);
    });

    it('should cover map navigation and setting center/zoom', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      // setCenter with zoom = null
      tmap.setCenter(17.385, 78.486, null);
      expect(mapMock.panTo).toHaveBeenCalledWith([17.385, 78.486]);

      // setZoom
      tmap.setZoom(10);
      expect(mapMock.setZoom).toHaveBeenCalledWith(10);

      // getBounds
      tmap.getBounds();
      expect(mapMock.getBounds).toHaveBeenCalled();

      // fitBounds
      const bounds = [[17.38, 78.48], [17.39, 78.49]];
      tmap.fitBounds(bounds);
      expect(mapMock.fitBounds).toHaveBeenCalledWith(bounds);
    });

    it('should cover all map event registration methods', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      // onClick twice to cover removing old click handler
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      tmap.onClick(cb1);
      tmap.onClick(cb2);
      
      tmap.enableClick();
      // Trigger map click
      mapEvents['click']({ latlng: { lat: 17.1, lng: 78.1 } });
      expect(cb2).toHaveBeenCalledWith(17.1, 78.1, expect.any(Object));
      expect(cb1).not.toHaveBeenCalled();

      // disableClick
      tmap.disableClick();
      mapEvents['click']({ latlng: { lat: 17.1, lng: 78.1 } });
      expect(cb2).toHaveBeenCalledTimes(1); // not called again

      // removeClickHandler
      tmap.removeClickHandler();
      expect(mapEvents['click']).toBeUndefined();

      // onRightClick
      const rightClickCb = jest.fn();
      tmap.onRightClick(rightClickCb);
      expect(mapEvents['contextmenu']).toBeDefined();
      mapEvents['contextmenu']({ latlng: { lat: 17.2, lng: 78.2 } });
      expect(rightClickCb).toHaveBeenCalledWith(17.2, 78.2, expect.any(Object));

      // onMarkerDrag
      const dragCb = jest.fn();
      const mockMarker = {
        on: jest.fn((evt, cb) => {
          if (evt === 'drag') cb();
        }),
        getLatLng: () => ({ lat: 17.3, lng: 78.3 })
      };
      tmap.onMarkerDrag(mockMarker, dragCb);
      expect(dragCb).toHaveBeenCalledWith(17.3, 78.3);

      // onMarkerDragEnd
      const dragEndCb = jest.fn();
      const mockMarker2 = {
        on: jest.fn((evt, cb) => {
          if (evt === 'dragend') cb();
        }),
        getLatLng: () => ({ lat: 17.4, lng: 78.4 })
      };
      tmap.onMarkerDragEnd(mockMarker2, dragEndCb);
      expect(dragEndCb).toHaveBeenCalledWith(17.4, 78.4);

      // onMarkerClick
      const clickCb = jest.fn();
      const stopProp = jest.fn();
      const mockMarker3 = {
        on: jest.fn((evt, cb) => {
          if (evt === 'click') cb({ originalEvent: { stopPropagation: stopProp } });
        }),
        getLatLng: () => ({ lat: 17.5, lng: 78.5 })
      };
      tmap.onMarkerClick(mockMarker3, clickCb);
      expect(stopProp).toHaveBeenCalled();
      expect(clickCb).toHaveBeenCalledWith(17.5, 78.5, mockMarker3);

      // onMarkerRightClick
      const rightClickMarkerCb = jest.fn();
      const stopProp2 = jest.fn();
      const mockMarker4 = {
        on: jest.fn((evt, cb) => {
          if (evt === 'contextmenu') cb({ originalEvent: { stopPropagation: stopProp2 } });
        }),
        getLatLng: () => ({ lat: 17.6, lng: 78.6 })
      };
      tmap.onMarkerRightClick(mockMarker4, rightClickMarkerCb);
      expect(stopProp2).toHaveBeenCalled();
      expect(rightClickMarkerCb).toHaveBeenCalledWith(17.6, 78.6, mockMarker4);

      // onZoomChange
      const zoomChangeCb = jest.fn();
      tmap.onZoomChange(zoomChangeCb);
      expect(mapEvents['zoom']).toBeDefined();
      mapEvents['zoom']();
      expect(zoomChangeCb).toHaveBeenCalledWith(16);

      // onMoveEnd
      const moveEndCb = jest.fn();
      tmap.onMoveEnd(moveEndCb);
      expect(mapEvents['moveend']).toBeDefined();
      mapEvents['moveend']();
      expect(moveEndCb).toHaveBeenCalledWith(17.385, 78.486);

      // disableWeatherClicks
      tmap.enableWeatherClicks();
      tmap.disableWeatherClicks();
      expect(tmap._weatherMapClickHandler).toBeNull();
    });

    it('should cover marker removal on click helpers', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);
      
      const m1 = tmap.addMarker(17.385, 78.486);
      tmap.enableMarkerRemovalOnClick();
      expect(tmap.getMarkerCount()).toBe(1);

      // addRemovableMarker
      const m2 = tmap.addRemovableMarker(17.386, 78.487);
      expect(tmap.getMarkerCount()).toBe(2);
    });

    it('should cover drone position updating edge cases and auto-pan loop', () => {
      const tmap = new TMap('map-container', [17.385, 78.486], 16, true);

      // updateDronePosition empty inputs return early
      tmap.updateDronePosition(null, null);
      expect(tmap.droneMarkers).toBeUndefined();

      // Create vehicle marker & verify droneMarker getter returns it
      window.selectedSysId = 1;
      tmap.updateDronePosition(17.385, 78.486, 90);
      expect(tmap.droneMarker).not.toBeNull();

      // Trigger popup open DOM update branch
      document.body.innerHTML += `
        <div id="drone-popup-lat-1"></div>
        <div id="drone-popup-lng-1"></div>
      `;
      markerMock.isPopupOpen = jest.fn().mockReturnValue(true);
      tmap.updateDronePosition(17.387, 78.487, 180);
      expect(document.getElementById('drone-popup-lat-1').textContent).toBe('Lat: 17.387000');

      // Test auto-pan snap (Phase 1 auto-pan lock is active)
      tmap.setDroneAutoPan(true);
      // Run it multiple times to cover 20 fixes and disabling auto-pan
      for (let i = 0; i < 25; i++) {
        tmap.updateDronePosition(17.385, 78.486, 90);
      }
      expect(tmap.droneAutoPan).toBe(false);

      // pruneStaleVehicleMarkers with null droneMarkers
      tmap.droneMarkers = null;
      tmap.pruneStaleVehicleMarkers([1]);
      // clearDroneMarkers with null droneMarkers
      tmap.clearDroneMarkers();
    });
  });
});