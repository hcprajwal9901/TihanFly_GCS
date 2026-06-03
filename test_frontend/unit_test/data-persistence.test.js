describe('Data Persistence System Unit Tests (data-persistence.js)', () => {
  beforeAll(() => {
    // Load script ONCE in beforeAll to prevent class re-declaration errors in JSDOM
    global.loadScript('js/data-persistence.js');
  });

  beforeEach(() => {
    // Reset DOM structure before each test
    document.body.innerHTML = `
      <div class="compass-telemetry-container"></div>
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
      setHomePosition: jest.fn()
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
      polygonPoints: [],
      clearPolygon: jest.fn(),
      createPolygon: jest.fn(),
      generateSurveyGrid: jest.fn()
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
    });
  });

  describe('restoreAllData from cache', () => {
    it('should parse stored data and trigger step-by-step restoration callbacks', async () => {
      // Setup stored profile
      const testProfile = {
        version: '5.0',
        timestamp: new Date().toISOString(),
        waypoints: [{ id: 1, lat: 17.443, lng: 78.377, altitude: 60, speed: 8, type: 'waypoint' }],
        homePosition: { lat: 17.443, lng: 78.377, altitude: 0 },
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

      // Verify map center view got set to matching coordinates
      expect(window.tmap.map.setView).toHaveBeenCalledWith([17.443, 78.377], 18);
    });
  });

  describe('Instant plan mode preactivation', () => {
    it('should inject instant styles during page loads if plan mode was previously active', () => {
      // 1. Setup pre-requisite local storage flag
      const testProfile = {
        version: '5.0',
        uiState: { isPlanModeActive: true }
      };
      global.localStorage.setItem('mission_flight_data_complete', JSON.stringify(testProfile));

      // 2. Trigger instantiation to run the constructor preactivation check
      if (window.DataPersistence && window.DataPersistence._instance) {
        window.DataPersistence._instance.preActivatePlanModeIfNeeded();
      }

      // HTML element should have preload classes
      expect(document.documentElement.classList.contains('plan-mode-preload')).toBe(true);
      expect(document.getElementById('plan-mode-instant-css')).toBeDefined();
    });
  });
});
