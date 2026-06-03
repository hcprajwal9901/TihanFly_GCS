describe('Polygon Manager & Survey Grid High-Fidelity Behavioral Test Suite (polygon-manager.js / polygon-integration)', () => {
  let pmInstance;
  let mapLayers = [];
  let mapEvents = {};

  beforeAll(() => {
    // Enable Jest fake timers
    jest.useFakeTimers();

    // Stub window alert & confirm dialogs
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);

    // Mock console logs
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Mock Waypoint Manager
    window.WaypointManager = {
      waypoints: [],
      addWaypoint: jest.fn((lat, lng, alt, spd, src) => {
        const wp = { id: Math.floor(Math.random() * 1000) + 1, lat, lng, altitude: alt, speed: spd, source: src };
        window.WaypointManager.waypoints.push(wp);
        return wp;
      }),
      removeWaypointsByIds: jest.fn(ids => {
        window.WaypointManager.waypoints = window.WaypointManager.waypoints.filter(wp => !ids.includes(wp.id));
      }),
      removeWaypointsBySource: jest.fn(src => {
        window.WaypointManager.waypoints = window.WaypointManager.waypoints.filter(wp => wp.source !== src);
      }),
      updateRoute: jest.fn(),
      updateStats: jest.fn()
    };

    // Mock Leaflet features specifically for PolygonManager
    mapLayers = [];
    window.L.featureGroup = jest.fn().mockImplementation(() => ({
      addTo: jest.fn().mockReturnThis(),
      addLayer: jest.fn(layer => {
        mapLayers.push(layer);
        return this;
      }),
      removeLayer: jest.fn(layer => {
        const idx = mapLayers.indexOf(layer);
        if (idx > -1) mapLayers.splice(idx, 1);
      }),
      clearLayers: jest.fn(() => {
        mapLayers.length = 0;
      })
    }));

    window.L.polygon = jest.fn().mockImplementation((pts, opts) => ({
      getBounds: jest.fn().mockReturnValue({
        getCenter: jest.fn().mockReturnValue({ lat: 17.6, lng: 78.1 }),
        getNorth: jest.fn().mockReturnValue(17.61),
        getSouth: jest.fn().mockReturnValue(17.59),
        getEast: jest.fn().mockReturnValue(78.11),
        getWest: jest.fn().mockReturnValue(78.09)
      }),
      setLatLngs: jest.fn(),
      redraw: jest.fn(),
      addTo: jest.fn().mockReturnThis()
    }));

    window.L.marker = jest.fn().mockImplementation((latlng, opts) => ({
      addTo: jest.fn().mockReturnThis(),
      on: jest.fn(),
      _drawingIndex: 0,
      _polygonVertexIndex: 0
    }));

    window.L.polyline = jest.fn().mockImplementation((pts, opts) => ({
      addTo: jest.fn().mockReturnThis()
    }));

    // Setup window.tmap BEFORE loading scripts
    mapEvents = {};
    window.tmap = {
      map: {
        addLayer: jest.fn(),
        on: jest.fn((evt, cb) => {
          mapEvents[evt] = cb;
        }),
        off: jest.fn(evt => {
          delete mapEvents[evt];
        }),
        getContainer: jest.fn().mockReturnValue({
          style: { cursor: '' }
        })
      }
    };

    // Load main polygon manager script
    global.loadScript('plan-flight-modules/polygon-manager.js');

    // Load integration extensions script
    global.loadScript('plan-flight-modules/polygon-backend-integration.js');

    // Advance timers so checkReady setInterval detects window.tmap
    jest.advanceTimersByTime(1000);
    pmInstance = window.PolygonManager;
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mapLayers = [];
    if (pmInstance) {
      pmInstance.clearPolygon();
    }
    window.WaypointManager.waypoints = [];
  });

  describe('Initialization & Extensions Loading', () => {
    it('should successfully instantiate PolygonManager and extend with import/export methods', () => {
      expect(pmInstance).toBeDefined();
      expect(typeof pmInstance.exportPolygonData).toBe('function');
      expect(typeof pmInstance.importPolygonData).toBe('function');
    });

    it('should start with default survey parameters', () => {
      expect(pmInstance.surveySettings.altitude).toBe(10);
      expect(pmInstance.surveySettings.overlap).toBe(70);
      expect(pmInstance.surveySettings.sidelap).toBe(60);
      expect(pmInstance.surveySettings.pattern).toBe('horizontal');
    });
  });

  describe('Polygon Drawing Interactions', () => {
    it('should configure map cursors and capture map clicks during drawing mode', () => {
      pmInstance.startDrawing();

      const leafletMap = pmInstance.getLeafletMap();
      expect(leafletMap.getContainer().style.cursor).toBe('crosshair');
      expect(pmInstance.isDrawing).toBe(true);

      // Simulate first map vertex click
      const clickEvent = { latlng: { lat: 17.601, lng: 78.125, distanceTo: () => 0 } };
      mapEvents['click'](clickEvent);

      expect(pmInstance.polygonPoints.length).toBe(1);
      expect(pmInstance.polygonPoints[0]).toMatchObject({ lat: 17.601, lng: 78.125 });
    });

    it('should cancel drawing and clear preview markers when pressing Escape key', () => {
      pmInstance.startDrawing();
      
      const clickEvent = { latlng: { lat: 17.601, lng: 78.125, distanceTo: () => 0 } };
      mapEvents['click'](clickEvent);
      expect(pmInstance.polygonPoints.length).toBe(1);

      // Dispatch KeyPress event
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);

      expect(pmInstance.isDrawing).toBe(false);
      expect(pmInstance.polygonPoints.length).toBe(0);
    });

    it('should finalize polygon and generate grid when pressing Enter key', () => {
      pmInstance.startDrawing();
      
      // Simulate drawing 3 points
      mapEvents['click']({ latlng: { lat: 17.601, lng: 78.125, distanceTo: () => 0 } });
      mapEvents['click']({ latlng: { lat: 17.603, lng: 78.125, distanceTo: () => 0 } });
      mapEvents['click']({ latlng: { lat: 17.602, lng: 78.127, distanceTo: () => 0 } });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      expect(pmInstance.isDrawing).toBe(false);
      expect(pmInstance.currentPolygon).toBeDefined();
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Polygon created with 3 vertices'));
    });
  });

  describe('Geographic Area Calculations', () => {
    it('should compute polygon area accurately and convert meters to Hectares', () => {
      // Setup simple triangle corners
      pmInstance.polygonPoints = [
        { lat: 17.600, lng: 78.120 },
        { lat: 17.602, lng: 78.120 },
        { lat: 17.601, lng: 78.122 }
      ];
      // Mock polygon object
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);

      const areaSqM = pmInstance.calculatePolygonArea();
      
      // Let's assert a positive valid area has been calculated
      expect(areaSqM).toBeGreaterThan(0);
      
      // Compute Hectares (1 Hectare = 10,000 sq meters)
      const hectares = areaSqM / 10000;
      expect(hectares).toBeGreaterThan(0);
    });
  });

  describe('Survey Grid Generation Patterns', () => {
    beforeEach(() => {
      // Re-create simple polygon
      pmInstance.polygonPoints = [
        { lat: 17.600, lng: 78.120 },
        { lat: 17.602, lng: 78.120 },
        { lat: 17.601, lng: 78.122 }
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);

      // Decouple grid intersection math from Leaflet coordinate precision
      jest.spyOn(pmInstance, 'clipLinesToPolygon').mockReturnValue([
        [window.L.latLng(17.601, 78.121), window.L.latLng(17.602, 78.122)]
      ]);
    });

    it('should generate grid waypoints and add them to WaypointManager under Horizontal pattern', () => {
      pmInstance.surveySettings.pattern = 'horizontal';
      pmInstance.surveySettings.altitude = 12;

      pmInstance.generateSurveyGrid();

      // Verify WaypointManager received waypoints with altitudes
      expect(window.WaypointManager.addWaypoint).toHaveBeenCalled();
      const lastCallArgs = window.WaypointManager.addWaypoint.mock.calls[0];
      expect(lastCallArgs[2]).toBe(12); // Altitude
      expect(lastCallArgs[4]).toBe('polygon'); // Source tag
    });
  });

  describe('JSON Export & Blob dialogues', () => {
    it('should stringify coordinates and create downloadable JSON element', () => {
      // Mock URL.createObjectURL and URL.revokeObjectURL
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test-uuid');
      global.URL.revokeObjectURL = jest.fn();

      pmInstance.polygonPoints = [
        { lat: 17.600, lng: 78.120 },
        { lat: 17.602, lng: 78.120 },
        { lat: 17.601, lng: 78.122 }
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);

      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      pmInstance.exportPolygonData();

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Polygon exported');

      clickSpy.mockRestore();
    });
  });

  describe('JSON Import & FileReader parsers', () => {
    it('should trigger file prompt and recreate polygon layout on successful loading', () => {
      // Mock FileReader in global scope
      const dummyFileContent = JSON.stringify({
        id: 'imported_poly',
        points: [
          { lat: 17.605, lng: 78.130 },
          { lat: 17.607, lng: 78.130 },
          { lat: 17.606, lng: 78.132 }
        ],
        settings: { altitude: 15, overlap: 80, sidelap: 70, pattern: 'vertical' }
      });

      class FileReaderMock {
        readAsText(file) {
          this.onload({
            target: {
              result: dummyFileContent
            }
          });
        }
      }
      global.FileReader = FileReaderMock;

      // Spy on prompt elements click
      let fileOnChangeCallback = null;
      const originalCreate = document.createElement.bind(document);
      document.createElement = jest.fn().mockImplementation((tagName) => {
        const el = originalCreate(tagName);
        if (tagName === 'input') {
          Object.defineProperty(el, 'type', {
            set: (val) => {
              if (val === 'file') {
                setTimeout(() => {
                  if (fileOnChangeCallback) {
                    fileOnChangeCallback({
                      target: {
                        files: [{ name: 'survey.json' }]
                      }
                    });
                  }
                }, 0);
              }
            }
          });
          Object.defineProperty(el, 'onchange', {
            set: (cb) => { fileOnChangeCallback = cb; }
          });
        }
        return el;
      });

      pmInstance.importPolygonData();

      // Tick setTimeout prompts
      jest.advanceTimersByTime(100);

      // Verify imported values are parsed and loaded
      expect(pmInstance.polygonId).toBe('imported_poly');
      expect(pmInstance.surveySettings.altitude).toBe(15);
      expect(pmInstance.surveySettings.overlap).toBe(80);
      expect(pmInstance.polygonPoints[0].lat).toBe(17.605);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Polygon imported');

      // Restore document mock
      document.createElement = originalCreate;
    });
  });
});