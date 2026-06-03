describe('GCS Flight Plan Waypoint High-Fidelity Behavioral Test Suite (plan-flight-waypoint.js)', () => {
  let modeInstance;

  beforeAll(() => {
    // Define dummy constructor for PlanFlightMode
    window.PlanFlightMode = function() {};

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-waypoint.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MsgConsole component silently
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Spy on global console warnings, errors and tables silently
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'table').mockImplementation(() => {});

    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Reset window variables
    delete window.WaypointManager;
    delete window.PolygonManager;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Function: handleWaypointActions', () => {
    it('should log error if WaypointManager is missing', () => {
      modeInstance.handleWaypointActions('add-waypoint');
      expect(console.error).toHaveBeenCalledWith('❌ WaypointManager not available');
    });

    it('should cancel active PolygonManager drawing before executing waypoint actions', () => {
      window.WaypointManager = {
        startAddingWaypoint: jest.fn()
      };
      window.PolygonManager = {
        isDrawing: true,
        cancelDrawing: jest.fn()
      };

      modeInstance.handleWaypointActions('add-waypoint');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Cancelling active polygon draw'));
      expect(window.PolygonManager.cancelDrawing).toHaveBeenCalledTimes(1);
      expect(window.WaypointManager.startAddingWaypoint).toHaveBeenCalledTimes(1);
    });

    it('should route matching waypoint actions to their respective handlers', () => {
      window.WaypointManager = {
        startAddingWaypoint: jest.fn(),
        startDeletingWaypoint: jest.fn(),
        clearAllWaypoints: jest.fn()
      };
      window.PolygonManager = {
        isDrawing: false
      };

      modeInstance.handleWaypointActions('add-waypoint');
      expect(window.WaypointManager.startAddingWaypoint).toHaveBeenCalledTimes(1);

      modeInstance.handleWaypointActions('delete-waypoint');
      expect(window.WaypointManager.startDeletingWaypoint).toHaveBeenCalledTimes(1);

      modeInstance.handleWaypointActions('clear-all');
      expect(window.WaypointManager.clearAllWaypoints).toHaveBeenCalledTimes(1);

      modeInstance.handleWaypointActions('invalid-action');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown waypoint action'));
    });
  });

  describe('Function: logMarkersToConsole', () => {
    it('should log console warning if getWaypoints returns empty list', () => {
      window.WaypointManager = {
        getWaypoints: jest.fn(() => [])
      };

      modeInstance.logMarkersToConsole();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('No waypoints found'));
      expect(console.table).not.toHaveBeenCalled();
    });

    it('should log coordinates, JSON strings, and console table formatted outputs', () => {
      window.WaypointManager = {
        getWaypoints: jest.fn(() => [
          { id: 1, lat: 12.34, lng: 80.12, altitude: 25, speed: 5 },
          { id: 2, lat: 12.35, lng: 80.13, altitude: 30, speed: 8 }
        ])
      };

      modeInstance.logMarkersToConsole();

      expect(console.table).toHaveBeenCalledTimes(1);
      
      const tableArg = console.table.mock.calls[0][0];
      expect(tableArg.length).toBe(2);
      expect(tableArg[0].id).toBe('1');
      expect(tableArg[0].lat).toBe(12.34);
      expect(tableArg[0].altitude).toBe(25);
      
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('2 waypoints logged to console'));
    });
  });
});