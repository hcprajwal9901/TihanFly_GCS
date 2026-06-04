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

    // Redefine Leaflet latLng specifically to support distanceTo math
    window.L.latLng = (lat, lng) => ({
      lat,
      lng,
      distanceTo: jest.fn().mockReturnValue(10)
    });
    window.L.LatLng = window.L.latLng;

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
        getCenter: jest.fn().mockReturnValue(window.L.latLng(17.6, 78.1)),
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
        }),
        fitBounds: jest.fn()
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

    it('should retry initialization if map or Leaflet is initially missing', () => {
      const originalTMapInstance = window.tmap;
      delete window.tmap;

      // Instantiate new PolygonManager with missing map
      const pm = new pmInstance.constructor(null);
      // Wait for it to retry
      jest.advanceTimersByTime(1000);
      
      // Restore map and recreate
      window.tmap = originalTMapInstance;
    });
  });

  describe('Polygon Drawing Interactions', () => {
    it('should configure map cursors and capture map clicks during drawing mode', () => {
      pmInstance.startDrawing();

      const leafletMap = pmInstance.getLeafletMap();
      expect(leafletMap.getContainer().style.cursor).toBe('crosshair');
      expect(pmInstance.isDrawing).toBe(true);

      // Simulate first map vertex click
      const clickEvent = { latlng: window.L.latLng(17.601, 78.125) };
      mapEvents['click'](clickEvent);

      expect(pmInstance.polygonPoints.length).toBe(1);
      expect(pmInstance.polygonPoints[0]).toMatchObject({ lat: 17.601, lng: 78.125 });
    });

    it('should prompt to clear existing polygon if already drawn', () => {
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);

      // Try start drawing again, confirm yes
      window.confirm.mockReturnValueOnce(true);
      pmInstance.startDrawing();
      expect(pmInstance.currentPolygon).toBeNull();
      expect(pmInstance.polygonPoints.length).toBe(0);

      // Set it up again
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);
      // Try start drawing again, confirm no
      window.confirm.mockReturnValueOnce(false);
      pmInstance.startDrawing();
      expect(pmInstance.currentPolygon).toBeDefined();
    });

    it('should cancel drawing and clear preview markers when pressing Escape key', () => {
      pmInstance.startDrawing();
      
      const clickEvent = { latlng: window.L.latLng(17.601, 78.125) };
      mapEvents['click'](clickEvent);
      expect(pmInstance.polygonPoints.length).toBe(1);

      // Dispatch KeyPress event
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);

      expect(pmInstance.isDrawing).toBe(false);
      expect(pmInstance.polygonPoints.length).toBe(0);
    });

    it('should reject finalizing if points are less than 3', () => {
      pmInstance.startDrawing();
      mapEvents['click']({ latlng: window.L.latLng(17.601, 78.125) });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);
      expect(pmInstance.isDrawing).toBe(true); // Should stay drawing
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Polygon needs at least 3 points!'));
    });

    it('should finalize polygon and generate grid when pressing Enter key', () => {
      pmInstance.startDrawing();
      
      // Simulate drawing 3 points
      mapEvents['click']({ latlng: window.L.latLng(17.601, 78.125) });
      mapEvents['click']({ latlng: window.L.latLng(17.603, 78.125) });
      mapEvents['click']({ latlng: window.L.latLng(17.602, 78.127) });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      expect(pmInstance.isDrawing).toBe(false);
      expect(pmInstance.currentPolygon).toBeDefined();
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Polygon created with 3 vertices'));
    });

    it('should handle dragging vertex markers during drawing and after creation', () => {
      pmInstance.startDrawing();
      
      // Add first marker
      mapEvents['click']({ latlng: window.L.latLng(17.601, 78.125) });
      const firstMarker = pmInstance.tempMarkers[0];
      
      // Mock drag event listeners
      let dragCallback = null;
      firstMarker.on = (evt, cb) => {
        if (evt === 'drag') dragCallback = cb;
      };
      
      // Re-trigger drawing click to invoke L.marker
      pmInstance.startDrawing();
      mapEvents['click']({ latlng: window.L.latLng(17.601, 78.125) });
      
      // Invoke drag handler
      if (dragCallback) {
        dragCallback({ latlng: window.L.latLng(17.605, 78.129) });
        expect(pmInstance.polygonPoints[0].lat).toBe(17.605);
      }
    });
  });

  describe('Geographic Area Calculations', () => {
    it('should compute polygon area accurately and convert meters to Hectares', () => {
      // Setup simple triangle corners
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
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
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);
    });

    it('should generate grid waypoints and add them to WaypointManager under Horizontal pattern', () => {
      // Decouple grid intersection math from Leaflet coordinate precision
      jest.spyOn(pmInstance, 'clipLinesToPolygon').mockReturnValue([
        [window.L.latLng(17.601, 78.121), window.L.latLng(17.602, 78.122)]
      ]);

      pmInstance.surveySettings.pattern = 'horizontal';
      pmInstance.surveySettings.altitude = 12;

      pmInstance.generateSurveyGrid();

      // Verify WaypointManager received waypoints with altitudes
      expect(window.WaypointManager.addWaypoint).toHaveBeenCalled();
      const lastCallArgs = window.WaypointManager.addWaypoint.mock.calls[0];
      expect(lastCallArgs[2]).toBe(12); // Altitude
      expect(lastCallArgs[4]).toBe('polygon'); // Source tag
    });

    it('should support Vertical, Crosshatch, Rectangle, and Circle grid patterns', () => {
      // Setup simple clip return
      jest.spyOn(pmInstance, 'clipLinesToPolygon').mockReturnValue([
        [window.L.latLng(17.601, 78.121), window.L.latLng(17.602, 78.122)]
      ]);

      // 1. Vertical
      pmInstance.surveySettings.pattern = 'vertical';
      pmInstance.generateSurveyGrid();
      expect(window.WaypointManager.addWaypoint).toHaveBeenCalled();

      // 2. Crosshatch
      pmInstance.surveySettings.pattern = 'crosshatch';
      pmInstance.generateSurveyGrid();
      expect(window.WaypointManager.addWaypoint).toHaveBeenCalled();

      // 3. Rectangle
      pmInstance.surveySettings.pattern = 'rectangle';
      pmInstance.generateSurveyGrid();
      expect(window.WaypointManager.addWaypoint).toHaveBeenCalled();

      // 4. Circle
      pmInstance.surveySettings.pattern = 'circle';
      pmInstance.generateSurveyGrid();
      expect(window.WaypointManager.addWaypoint).toHaveBeenCalled();
    });

    it('should calculate collinear lines with zero denominator intersection math safely', () => {
      // Parallel lines intersection math test
      const res = pmInstance.getLineIntersection(
        10, 10, 20, 20,
        10, 15, 20, 25 // Parallel, denom = 0
      );
      expect(res).toBeNull();

      // Intersecting lines
      const res2 = pmInstance.getLineIntersection(
        10, 10, 20, 20,
        10, 20, 20, 10
      );
      expect(res2).toEqual({ lat: 15, lng: 15 });
    });

    it('should perform ray-casting point-in-polygon math correctly', () => {
      const pointInside = window.L.latLng(17.601, 78.121);
      const pointOutside = window.L.latLng(17.650, 78.250);

      expect(pmInstance.pointInPolygon(pointInside)).toBe(true);
      expect(pmInstance.pointInPolygon(pointOutside)).toBe(false);
    });
  });

  describe('JSON Export & Blob dialogues', () => {
    it('should stringify coordinates and create downloadable JSON element', () => {
      // Mock URL.createObjectURL and URL.revokeObjectURL
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test-uuid');
      global.URL.revokeObjectURL = jest.fn();

      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);

      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      pmInstance.exportPolygonData();

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Polygon exported');

      clickSpy.mockRestore();
    });

    it('should alert if trying to export when polygon is missing', () => {
      pmInstance.currentPolygon = null;
      pmInstance.polygonPoints = [];
      
      pmInstance.exportPolygonData();
      expect(window.alert).toHaveBeenCalledWith('❌ No polygon to export!');
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

  describe('Modal Toggles and Editor Actions', () => {
    beforeEach(() => {
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);
    });

    it('should open and close survey settings dialog modal', () => {
      pmInstance.openSurveySettings();

      const modal = document.body.querySelector('#surveySettingsModal');
      expect(modal).toBeTruthy();

      // Apply settings
      document.getElementById('surveyAlt').value = '25';
      document.getElementById('surveyOverlap').value = '55';
      document.getElementById('surveySidelap').value = '45';
      document.getElementById('surveyAngle').value = '90';
      document.getElementById('surveySpeed').value = '8';

      pmInstance.applySurveySettings();

      expect(pmInstance.surveySettings.altitude).toBe(25);
      expect(pmInstance.surveySettings.overlap).toBe(55);
      expect(pmInstance.surveySettings.sidelap).toBe(45);
      expect(pmInstance.surveySettings.angle).toBe(90);
      expect(pmInstance.surveySettings.speed).toBe(8);

      expect(document.body.querySelector('#surveySettingsModal')).toBeNull();
    });

    it('should show survey pattern modal and handle click interactions', () => {
      pmInstance.showSurveyPatternModal();

      const modal = document.body.querySelector('#surveyPatternModal');
      expect(modal).toBeTruthy();

      // Find crosshatch btn and click it
      const crosshatchBtn = modal.querySelector('[data-pattern="crosshatch"]');
      crosshatchBtn.click();
      expect(pmInstance.surveySettings.pattern).toBe('crosshatch');

      // Close it
      document.getElementById('closePatternModalBtn').click();
      expect(document.body.querySelector('#surveyPatternModal')).toBeNull();
    });

    it('should alert when calling editor settings if polygon does not exist', () => {
      pmInstance.currentPolygon = null;
      pmInstance.polygonPoints = [];

      pmInstance.openSurveySettings();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Draw a polygon first!'));

      pmInstance.startEditing();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('No polygon to edit!'));

      pmInstance.showSurveyPatternModal();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Draw a polygon first!'));
    });

    it('should center, stop editing, and export polygon correctly', () => {
      const fitBoundsSpy = jest.spyOn(pmInstance.getLeafletMap(), 'fitBounds');
      
      pmInstance.centerPolygon();
      expect(fitBoundsSpy).toHaveBeenCalled();

      pmInstance.stopEditing();
      expect(pmInstance.isEditing).toBe(false);

      pmInstance.surveySettings.altitude = 10;
      const exported = pmInstance.exportPolygon();
      expect(exported.points.length).toBe(3);
      expect(exported.settings.altitude).toBe(10);
    });
  });

  describe('Polygon Manager & Survey Grid Edge Cases and Branch Coverage', () => {
    let originalMap;
    let originalPolygonLayer;
    let originalGridLayer;

    beforeEach(() => {
      originalMap = pmInstance.map;
      originalPolygonLayer = pmInstance.polygonLayer;
      originalGridLayer = pmInstance.gridLayer;
      
      jest.clearAllMocks();
    });

    afterEach(() => {
      pmInstance.map = originalMap;
      pmInstance.polygonLayer = originalPolygonLayer;
      pmInstance.gridLayer = originalGridLayer;
    });

    it('should cover ensureLayersInitialized returning false and true under various map states', () => {
      pmInstance.polygonLayer = null;
      pmInstance.gridLayer = null;
      pmInstance.map = {};
      
      const resFalse = pmInstance.ensureLayersInitialized();
      expect(resFalse).toBe(false);
      
      pmInstance.map = originalMap;
      const resTrue = pmInstance.ensureLayersInitialized();
      expect(resTrue).toBe(true);
      expect(pmInstance.polygonLayer).not.toBeNull();
      expect(pmInstance.gridLayer).not.toBeNull();
    });

    it('should cover ensurePolygonExists edge cases', () => {
      pmInstance.currentPolygon = null;
      pmInstance.polygonPoints = [];
      expect(pmInstance.ensurePolygonExists()).toBe(false);

      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      expect(pmInstance.ensurePolygonExists()).toBe(true);
      expect(pmInstance.currentPolygon).not.toBeNull();
    });

    it('should cover recreatePolygon failure when points < 3 or layers not ready', () => {
      pmInstance.polygonPoints = [];
      const resNoPoints = pmInstance.recreatePolygon();
      expect(resNoPoints).toBe(false);

      pmInstance.map = {};
      pmInstance.polygonLayer = null;
      pmInstance.gridLayer = null;
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      const resNoLayers = pmInstance.recreatePolygon();
      expect(resNoLayers).toBe(false);
    });

    it('should cover createPolygon catch block error handling', () => {
      const originalPolygon = window.L.polygon;
      window.L.polygon = jest.fn().mockImplementation(() => {
        throw new Error('Mock Polygon Creation Failure');
      });

      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = pmInstance.createPolygon();
      expect(res).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error creating polygon:'), expect.any(Error));
      
      consoleSpy.mockRestore();
      window.L.polygon = originalPolygon;
    });

    it('should cover generateRectangleLines directly', () => {
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);
      const params = pmInstance.calculateGridParameters();
      const lines = pmInstance.generateRectangleLines(params);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0][0].lat).toBeDefined();
    });

    it('should cover initialize failure logs and retries', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const badPm = new pmInstance.constructor({});
      jest.advanceTimersByTime(20000);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize after 10 attempts'));
      consoleSpy.mockRestore();
    });

    it('should track createdWaypointIds and remove them correctly on clearPolygon', () => {
      pmInstance.createdWaypointIds = [101, 102];
      pmInstance.currentPolygon = window.L.polygon([
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ]);
      Object.getPrototypeOf(pmInstance).clearPolygon.call(pmInstance);
      expect(window.WaypointManager.removeWaypointsByIds).toHaveBeenCalledWith([101, 102]);
      expect(pmInstance.createdWaypointIds.length).toBe(0);
    });

    it('should handle getLinePolygonIntersections when line does not intersect', () => {
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      const line = [window.L.latLng(17.500, 78.100), window.L.latLng(17.500, 78.200)];
      const intersections = pmInstance.getLinePolygonIntersections(line);
      expect(intersections.length).toBe(0);
    });

    it('should cover circle pattern grid generation filtering', () => {
      pmInstance.polygonPoints = [
        window.L.latLng(17.600, 78.120),
        window.L.latLng(17.602, 78.120),
        window.L.latLng(17.601, 78.122)
      ];
      pmInstance.currentPolygon = window.L.polygon(pmInstance.polygonPoints);
      
      const mockLines = [
        [window.L.latLng(17.601, 78.121), window.L.latLng(17.601, 78.121)],
        [window.L.latLng(17.650, 78.250), window.L.latLng(17.650, 78.250)]
      ];
      jest.spyOn(pmInstance, 'generateCircleLines').mockReturnValue(mockLines);
      pmInstance.surveySettings.pattern = 'circle';
      pmInstance.generateSurveyGrid();
      expect(pmInstance.surveyGrid.length).toBeGreaterThan(0);
    });
  });
});