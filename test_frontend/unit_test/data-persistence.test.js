describe('Data Persistence System Unit Tests (data-persistence.js)', () => {
  beforeAll(() => {
    // Load script ONCE in beforeAll to prevent class re-declaration errors in JSDOM
    global.loadScript('js/data-persistence.js');
  });

  beforeEach(() => {
    // Reset DOM structure before each test
    document.body.innerHTML = `
      <div class="compass-telemetry-container" style="display: block;"></div>
      <div id="dropdownMenuStrip"></div>
      <div id="flightControlsStrip"></div>
      <div class="minimal-console-container"></div>
      <div id="tihanLogo"></div>
      <div class="status-badge"></div>
      <div id="planFlightMenuStrip" style="display: none;"></div>
      <div id="commandEditorPanel" style="display: none;"></div>
      <div id="weatherDashboard" style="top: 20px;"></div>
    `;

    // Reset localStorage mock
    global.localStorage.clear();

    // Mock WaypointManager, PlanFlight, and tmap
    window.WaypointManager = {
      waypoints: [],
      tmap: {
        removeMarker: jest.fn(),
        clearRoute: jest.fn()
      },
      getWaypoints: jest.fn().mockReturnValue([
        { id: 1, lat: 17.601, lng: 78.126, altitude: 50, speed: 10, type: 'waypoint' }
      ]),
      getHomePosition: jest.fn().mockReturnValue({ lat: 17.601, lng: 78.126, altitude: 0 }),
      restoreWaypointsFixed: jest.fn().mockResolvedValue(true),
      addWaypoint: jest.fn(),
      updateRoute: jest.fn(),
      updateStats: jest.fn(),
      setHomePosition: jest.fn(),
      showRouteLine: true
    };

    window.PlanFlight = {
      isActive: jest.fn().mockReturnValue(false),
      enter: jest.fn()
    };

    window.tmap = {
      map: {
        getCenter: jest.fn().mockReturnValue({ lat: 17.601, lng: 78.126 }),
        getZoom: jest.fn().mockReturnValue(18),
        setView: jest.fn()
      }
    };

    window.PolygonManager = {
      polygonPoints: [{ lat: 17.601, lng: 78.126 }],
      surveySettings: { altitude: 15 },
      clearPolygon: jest.fn(),
      createPolygon: jest.fn(),
      generateSurveyGrid: jest.fn()
    };

    window.compassEnhanced = {
      getHeading: jest.fn().mockReturnValue(90),
      getTelemetry: jest.fn().mockReturnValue({ speed: 5 }),
      show: jest.fn(),
      hide: jest.fn(),
      setHeading: jest.fn(),
      updateTelemetry: jest.fn()
    };

    window.weatherDashboard = {
      isVisible: true,
      getCurrentLocation: jest.fn().mockReturnValue({ lat: 17.6, lng: 78.1 }),
      show: jest.fn(),
      hide: jest.fn(),
      fetchWeather: jest.fn()
    };

    window.CommandEditor = {
      isVisible: jest.fn().mockReturnValue(true),
      currentTab: 'mission',
      switchTab: jest.fn(),
      refreshWaypoints: jest.fn(),
      setWaypointManager: jest.fn()
    };

    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    jest.clearAllMocks();
    jest.useFakeTimers();

    // Re-initialize class instance in persistent object if needed
    if (window.DataPersistence && window.DataPersistence._instance) {
      window.DataPersistence._instance.initialize();
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should successfully register global DataPersistence handlers and auto-saves', () => {
    expect(window.DataPersistence).toBeDefined();
    
    // Auto save interval triggers every 2 seconds
    jest.advanceTimersByTime(2000);
    
    // localStorage setItem should be called by auto-save
    expect(global.localStorage.setItem).toHaveBeenCalledWith(
      'mission_flight_data_complete',
      expect.any(String)
    );
  });

  describe('saveAllData & localStorage persistence', () => {
    it('should compile correct serializable models of waypoints, maps, and panel states', () => {
      const success = window.DataPersistence.save();
      expect(success).toBe(true);

      const savedString = global.localStorage.getItem('mission_flight_data_complete');
      const savedData = JSON.parse(savedString);

      expect(savedData.version).toBe('5.0');
      expect(savedData.waypoints).toHaveLength(1);
      expect(savedData.waypoints[0].lat).toBe(17.601);
      expect(savedData.homePosition.lat).toBe(17.601);
      expect(savedData.uiState.mapZoom).toBe(18);
      expect(savedData.compassState.heading).toBe(90);
      expect(savedData.weatherState.currentLocation.lat).toBe(17.6);
      expect(savedData.commandEditorState.currentTab).toBe('mission');
    });

    it('should handle missing components gracefully during serialization', () => {
      delete window.WaypointManager;
      delete window.PolygonManager;
      delete window.compassEnhanced;
      delete window.weatherDashboard;
      delete window.CommandEditor;
      delete window.tmap;

      const success = window.DataPersistence.save();
      expect(success).toBe(true);

      const savedData = JSON.parse(global.localStorage.getItem('mission_flight_data_complete'));
      expect(savedData.waypoints).toEqual([]);
      expect(savedData.polygonData).toBeNull();
      expect(savedData.compassState.visible).toBe(false);
      expect(savedData.weatherState.visible).toBe(false);
      expect(savedData.commandEditorState.visible).toBe(false);
      expect(savedData.uiState.mapCenter).toBeNull();
    });

    it('should handle save error catching when localStorage throws', () => {
      const originalSetItem = global.localStorage.setItem;
      global.localStorage.setItem = jest.fn().mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const success = window.DataPersistence.save();
      expect(success).toBe(false);
      expect(console.error).toHaveBeenCalledWith('❌ Error saving data:', expect.any(Error));

      global.localStorage.setItem = originalSetItem;
    });
  });

  describe('restoreAllData from cache', () => {
    it('should parse stored data and trigger step-by-step restoration callbacks', async () => {
      // Setup stored profile
      window.weatherDashboard.isVisible = false;
      const testProfile = {
        version: '5.0',
        timestamp: new Date().toISOString(),
        waypoints: [{ id: 1, lat: 17.443, lng: 78.377, altitude: 60, speed: 8, type: 'waypoint' }],
        homePosition: { lat: 17.443, lng: 78.377, altitude: 0 },
        polygonData: {
          vertices: [{ lat: 17.443, lng: 78.377 }],
          surveySettings: { altitude: 12 }
        },
        compassState: {
          visible: true,
          heading: 120,
          telemetry: { speed: 8.5 }
        },
        weatherState: {
          visible: true,
          currentLocation: { lat: 17.443, lng: 78.377 }
        },
        commandEditorState: {
          visible: true,
          currentTab: 'survey'
        },
        uiState: {
          isPlanModeActive: true,
          showRouteLine: true,
          mapCenter: { lat: 17.443, lng: 78.377 },
          mapZoom: 18
        }
      };

      global.localStorage.setItem('mission_flight_data_complete', JSON.stringify(testProfile));

      // Trigger restore
      const success = window.DataPersistence.restore();
      expect(success).toBe(true);

      // Advance timers and flush microtasks sequentially to allow the Promise chain to execute
      for (let i = 0; i < 30; i++) {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      }

      // Verify restorations
      expect(window.tmap.map.setView).toHaveBeenCalledWith([17.443, 78.377], 18);
      expect(window.WaypointManager.setHomePosition).toHaveBeenCalledWith(17.443, 78.377);
      expect(window.PolygonManager.clearPolygon).toHaveBeenCalled();
      expect(window.compassEnhanced.show).toHaveBeenCalled();
      expect(window.compassEnhanced.setHeading).toHaveBeenCalledWith(120);
      expect(window.weatherDashboard.show).toHaveBeenCalled();
      expect(window.weatherDashboard.fetchWeather).toHaveBeenCalledWith(17.443, 78.377);
      expect(window.CommandEditor.switchTab).toHaveBeenCalledWith('survey');
    });

    it('should restore correctly even when waypoints list is empty', async () => {
      const testProfile = {
        version: '5.0',
        waypoints: [],
        homePosition: { lat: 17.443, lng: 78.377, altitude: 0 },
        compassState: { visible: false },
        weatherState: { visible: false },
        commandEditorState: { visible: false },
        uiState: {
          isPlanModeActive: false,
          showRouteLine: false,
          mapCenter: { lat: 17.443, lng: 78.377 },
          mapZoom: 18
        }
      };
      global.localStorage.setItem('mission_flight_data_complete', JSON.stringify(testProfile));

      const success = window.DataPersistence.restore();
      expect(success).toBe(true);

      for (let i = 0; i < 30; i++) {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      }

      expect(window.WaypointManager.setHomePosition).toHaveBeenCalledWith(17.443, 78.377);
    });

    it('should handle restore errors and catch exceptions gracefully', () => {
      // Corrupt localStorage JSON syntax to trigger catch block
      global.localStorage.setItem('mission_flight_data_complete', 'invalid JSON string');

      const success = window.DataPersistence.restore();
      expect(success).toBe(false);
      expect(console.error).toHaveBeenCalledWith('❌ Error restoring data:', expect.any(Error));
    });

    it('should proceed after timeout if map systems are not ready', async () => {
      // Make map unready
      delete window.tmap;

      const testProfile = {
        version: '5.0',
        waypoints: []
      };
      global.localStorage.setItem('mission_flight_data_complete', JSON.stringify(testProfile));

      window.DataPersistence.restore();

      // Tick checking interval (50ms) up to 100 times to force timeout
      jest.advanceTimersByTime(5500);
      await Promise.resolve();

      expect(console.warn).toHaveBeenCalledWith('⚠️ Timeout waiting for systems, proceeding anyway...');
    });
  });

  describe('Instant plan mode preactivation', () => {
    it('should inject instant styles during page loads if plan mode was previously active', () => {
      const testProfile = {
        version: '5.0',
        uiState: { isPlanModeActive: true },
        compassState: { visible: true }
      };
      global.localStorage.setItem('mission_flight_data_complete', JSON.stringify(testProfile));

      if (window.DataPersistence && window.DataPersistence._instance) {
        window.DataPersistence._instance.preActivatePlanModeIfNeeded();
      }

      expect(document.documentElement.classList.contains('plan-mode-preload')).toBe(true);
      expect(document.getElementById('plan-mode-instant-css')).toBeDefined();
    });
  });

  describe('UI methods: clear, getInfo, and hasSavedData', () => {
    it('should handle data clearance and return indicators', () => {
      const testProfile = { version: '5.0' };
      global.localStorage.setItem('mission_flight_data_complete', JSON.stringify(testProfile));

      expect(window.DataPersistence.hasSavedData()).toBe(true);

      const info = window.DataPersistence.getInfo();
      expect(info.version).toBe('5.0');

      const cleared = window.DataPersistence.clear();
      expect(cleared).toBe(true);
      expect(window.DataPersistence.hasSavedData()).toBe(false);
    });

    it('should handle exceptions during clearSavedData', () => {
      const originalRemoveItem = global.localStorage.removeItem;
      global.localStorage.removeItem = jest.fn().mockImplementation(() => {
        throw new Error('Localstorage Blocked');
      });

      const cleared = window.DataPersistence.clear();
      expect(cleared).toBe(false);

      global.localStorage.removeItem = originalRemoveItem;
    });

    it('should handle exceptions during getSavedDataInfo', () => {
      const originalGetItem = global.localStorage.getItem;
      global.localStorage.getItem = jest.fn().mockImplementation(() => {
        throw new Error('Localstorage Blocked');
      });

      const info = window.DataPersistence.getInfo();
      expect(info).toBeNull();

      global.localStorage.getItem = originalGetItem;
    });
  });
});

