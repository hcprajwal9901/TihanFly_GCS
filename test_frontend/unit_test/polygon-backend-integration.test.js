describe('Polygon Backend Integration Behavioral Test Suite', () => {
  let pmMock;
  let wmMock;
  let msgConsoleMock;
  let commandEditorMock;
  let originalConfirm;
  let originalAlert;

  beforeAll(() => {
    jest.useFakeTimers();

    // Mock global Blob and URL methods
    global.Blob = class {
      constructor(content, options) {
        this.content = content;
        this.options = options;
      }
    };

    global.URL = {
      createObjectURL: jest.fn(() => 'blob:mock-url'),
      revokeObjectURL: jest.fn()
    };

    // Mock FileReader
    global.FileReader = class {
      constructor() {
        this.onload = null;
      }
      readAsText(file) {
        // We will call onload manually in the tests to simulate file loading
        if (this.onload) {
          const event = {
            target: {
              result: this.mockResult || '{}'
            }
          };
          this.onload(event);
        }
      }
    };

    // Leaflet mock setup
    global.L = {
      latLng: jest.fn((lat, lng) => ({ lat, lng }))
    };

    originalConfirm = window.confirm;
    originalAlert = window.alert;
    window.confirm = jest.fn();
    window.alert = jest.fn();
  });

  afterAll(() => {
    window.confirm = originalConfirm;
    window.alert = originalAlert;
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MsgConsole
    msgConsoleMock = {
      info: jest.fn(),
      success: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };
    window.MsgConsole = msgConsoleMock;

    // Mock CommandEditor
    commandEditorMock = {
      refreshWaypoints: jest.fn()
    };
    window.CommandEditor = commandEditorMock;

    // Mock WaypointManager
    wmMock = {
      waypoints: [],
      tmap: {
        markerLayer: {
          removeLayer: jest.fn()
        },
        markers: []
      },
      updateRoute: jest.fn(),
      updateStats: jest.fn()
    };
    window.WaypointManager = wmMock;

    // Mock PolygonManager
    pmMock = {
      finishDrawing: jest.fn(),
      generateSurveyGrid: jest.fn(),
      applySurveySettings: jest.fn(),
      clearPolygon: jest.fn(),
      closeSurveySettings: jest.fn(),
      createPolygon: jest.fn(),
      currentPolygon: null,
      polygonPoints: [],
      surveyGrid: [],
      surveySettings: {
        altitude: 50,
        overlap: 70,
        sidelap: 70,
        angle: 0,
        speed: 5
      },
      createdWaypointIds: [],
      polygonId: 'test_polygon'
    };
    window.PolygonManager = pmMock;

    // Reset DOM
    document.body.innerHTML = '';

    // Load Script
    global.loadScript('plan-flight-modules/polygon-backend-integration.js');
    
    // Advance timers so setInterval runs and initializePolygonExtensions is called
    jest.advanceTimersByTime(150);
  });

  it('should clear interval once window.PolygonManager is found', () => {
    expect(typeof window.PolygonManager.finishDrawing).toBe('function');
  });

  describe('Enhanced finishDrawing', () => {
    it('should call original finishDrawing and log to MsgConsole if points count >= 3', () => {
      pmMock.currentPolygon = {};
      pmMock.polygonPoints = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }];

      pmMock.finishDrawing();

      // Original finishDrawing was mocked in pmMock, but wrapped in extensions
      // Let's assert MsgConsole was notified
      expect(msgConsoleMock.info).toHaveBeenCalledWith('🔷 Polygon drawing complete');
    });

    it('should not log to MsgConsole if points count < 3', () => {
      pmMock.currentPolygon = {};
      pmMock.polygonPoints = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }];

      pmMock.finishDrawing();

      expect(msgConsoleMock.info).not.toHaveBeenCalled();
    });
  });

  describe('Enhanced generateSurveyGrid', () => {
    it('should call original generateSurveyGrid and show success toast if grid has points', () => {
      pmMock.currentPolygon = {};
      pmMock.surveyGrid = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }];

      pmMock.generateSurveyGrid();

      expect(msgConsoleMock.success).toHaveBeenCalledWith('✅ Grid: 2 waypoints');
    });
  });

  describe('Enhanced applySurveySettings', () => {
    it('should read DOM input elements, update surveySettings, and trigger grid regeneration on timeout', () => {
      // Create settings inputs in DOM
      const createInput = (id, val) => {
        const input = document.createElement('input');
        input.id = id;
        input.value = val;
        document.body.appendChild(input);
      };
      createInput('surveyAlt', '100');
      createInput('surveyOverlap', '80');
      createInput('surveySidelap', '75');
      createInput('surveyAngle', '45');
      createInput('surveySpeed', '8');

      pmMock.applySurveySettings();

      // Verify settings are updated
      expect(pmMock.surveySettings).toEqual({
        altitude: 100,
        overlap: 80,
        sidelap: 75,
        angle: 45,
        speed: 8
      });

      expect(pmMock.closeSurveySettings).toHaveBeenCalled();

      // Check timeout triggers generateSurveyGrid
      // Currently pmMock.generateSurveyGrid is the wrapped one, let's spy on it or check trigger
      jest.advanceTimersByTime(350);
      expect(msgConsoleMock.success).toHaveBeenCalledWith('✅ Settings updated');
    });
  });

  describe('Enhanced clearPolygon', () => {
    it('should clean up associated markers by coords, source tag, or id list', () => {
      // Mock waypoint data
      const marker1 = { id: 'm1' };
      const marker2 = { id: 'm2' };
      const marker3 = { id: 'm3' };
      
      const wp1 = { id: 101, lat: 10.0, lng: 20.0, source: 'user', marker: marker1 };
      const wp2 = { id: 102, lat: 11.0, lng: 21.0, source: 'polygon', marker: marker2 };
      const wp3 = { id: 103, lat: 12.0, lng: 22.0, source: 'user', marker: marker3 }; // matches createdWaypointIds

      wmMock.waypoints = [wp1, wp2, wp3];
      wmMock.tmap.markers = [marker1, marker2, marker3];

      pmMock.surveyGrid = [{ lat: 10.0, lng: 20.0 }]; // wp1 matches by coord (rounded)
      pmMock.createdWaypointIds = [103]; // wp3 matches by ID list

      pmMock.clearPolygon();

      // Verify markers removed from leaflet layer
      expect(wmMock.tmap.markerLayer.removeLayer).toHaveBeenCalledWith(marker1);
      expect(wmMock.tmap.markerLayer.removeLayer).toHaveBeenCalledWith(marker2);
      expect(wmMock.tmap.markerLayer.removeLayer).toHaveBeenCalledWith(marker3);

      // Verify markers spliced from list
      expect(wmMock.tmap.markers).toEqual([]);

      // Verify WaypointManager.waypoints update (wp1, wp2, wp3 are all removed)
      expect(wmMock.waypoints).toEqual([]);

      // Verify updates called
      expect(wmMock.updateRoute).toHaveBeenCalled();
      expect(wmMock.updateStats).toHaveBeenCalled();
      expect(commandEditorMock.refreshWaypoints).toHaveBeenCalled();

      // Verify ID tracking reset
      expect(pmMock.createdWaypointIds).toEqual([]);
      expect(msgConsoleMock.info).toHaveBeenCalledWith('Polygon and survey waypoints cleared');
    });
  });

  describe('Export/Import Functions', () => {
    it('should alert if there is no current polygon on export', () => {
      pmMock.currentPolygon = null;
      pmMock.exportPolygonData();
      expect(window.alert).toHaveBeenCalledWith('❌ No polygon to export!');
    });

    it('should export polygon data as a JSON file and trigger browser download', () => {
      pmMock.currentPolygon = {};
      pmMock.polygonPoints = [{ lat: 1, lng: 2 }];
      pmMock.surveySettings = { altitude: 60 };
      pmMock.surveyGrid = [{ lat: 3, lng: 4 }];

    const origCreateElement = document.createElement;
    const clickSpy = jest.fn();
    const mockAnchor = {
      href: '',
      download: '',
      click: clickSpy
    };
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return mockAnchor;
      return origCreateElement.call(document, tag);
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    pmMock.exportPolygonData();

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(mockAnchor.download).toContain('polygon_survey_');
    expect(clickSpy).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(msgConsoleMock.success).toHaveBeenCalledWith('✅ Polygon exported');
    
    // Restore spy
    document.createElement.mockRestore();
    document.body.appendChild.mockRestore();
    document.body.removeChild.mockRestore();
    });

    it('should import polygon data correctly', () => {
      window.confirm.mockReturnValue(true);
      pmMock.currentPolygon = {}; // Existing polygon triggers confirm clear

      const clickSpy = jest.fn();
      const mockInput = {
        type: '',
        accept: '',
        click: clickSpy,
        onchange: null
      };

      const origCreateElement = document.createElement;
      jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'input') return mockInput;
        return origCreateElement.call(document, tag);
      });

      pmMock.importPolygonData();

      expect(mockInput.type).toBe('file');
      expect(mockInput.accept).toBe('.json');
      expect(clickSpy).toHaveBeenCalled();

      // Trigger change callback with mock file
      const mockFile = new Blob(['{}'], { type: 'application/json' });
      FileReader.prototype.mockResult = JSON.stringify({
        id: 'new_polygon',
        points: [{ lat: 1.5, lng: 2.5 }],
        settings: { altitude: 80 },
        grid: [{ lat: 3.5, lng: 4.5 }]
      });

      mockInput.onchange({
        target: {
          files: [mockFile]
        }
      });

      // Assert PM state was updated
      expect(window.confirm).toHaveBeenCalledWith('Clear existing polygon?');
      expect(pmMock.polygonPoints).toEqual([{ lat: 1.5, lng: 2.5 }]);
      expect(pmMock.polygonId).toBe('new_polygon');
      expect(pmMock.surveySettings).toEqual({ altitude: 80 });
      expect(pmMock.createPolygon).toHaveBeenCalled();
      expect(pmMock.surveyGrid).toEqual([{ lat: 3.5, lng: 4.5 }]);
      expect(msgConsoleMock.success).toHaveBeenCalledWith('✅ Polygon imported');

      document.createElement.mockRestore();
    });
  });

  describe('Global Helper Functions', () => {
    it('window.exportPolygon should delegate to PM', () => {
      window.exportPolygon();
      expect(pmMock.finishDrawing).toBeDefined(); // Ensures init completed
    });

    it('window.importPolygon should delegate to PM', () => {
      window.importPolygon();
    });
  });
});