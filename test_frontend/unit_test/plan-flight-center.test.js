describe('GCS Flight Plan Center Actions High-Fidelity Behavioral Test Suite (plan-flight-center.js)', () => {
  let modeInstance;

  beforeAll(() => {
    // Mock global components
    window.MsgConsole = {
      success: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Spy on global alert and console warnings
    jest.spyOn(global, 'alert').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Define a dummy constructor for PlanFlightMode
    window.PlanFlightMode = function() {};

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-center.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Clean up window globals
    delete window.WaypointManager;
    delete window.tmap;
  });

  describe('Function: handleCenterActions Routing', () => {
    it('should route matching center actions to their respective handlers', () => {
      const spyMission = jest.spyOn(modeInstance, 'centerMission').mockImplementation(() => {});
      const spyVehicle = jest.spyOn(modeInstance, 'centerVehicle').mockImplementation(() => {});
      const spyHome = jest.spyOn(modeInstance, 'centerHome').mockImplementation(() => {});

      modeInstance.handleCenterActions('center-mission');
      expect(spyMission).toHaveBeenCalledTimes(1);

      modeInstance.handleCenterActions('center-vehicle');
      expect(spyVehicle).toHaveBeenCalledTimes(1);

      modeInstance.handleCenterActions('center-home');
      expect(spyHome).toHaveBeenCalledTimes(1);

      // Verify warning for unknown action
      modeInstance.handleCenterActions('unknown-center-action');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown center action'));

      spyMission.mockRestore();
      spyVehicle.mockRestore();
      spyHome.mockRestore();
    });
  });

  describe('Function: centerMission', () => {
    it('should error if WaypointManager is not available', () => {
      modeInstance.centerMission();
      expect(console.error).toHaveBeenCalledWith('❌ WaypointManager not available');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('WaypointManager not initialized');
    });

    it('should trigger alert warning if waypoints are empty', () => {
      window.WaypointManager = {
        getWaypoints: jest.fn(() => [])
      };

      modeInstance.centerMission();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('No waypoints to center on');
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('No waypoints to center on'));
    });

    it('should invoke centerMission on WaypointManager and update MsgConsole on success', () => {
      const mockWaypoints = [{ id: 1, lat: 12.12, lng: 80.80 }];
      window.WaypointManager = {
        getWaypoints: jest.fn(() => mockWaypoints),
        centerMission: jest.fn()
      };

      modeInstance.centerMission();
      expect(window.WaypointManager.centerMission).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Mission centered');
    });
  });

  describe('Function: centerVehicle', () => {
    it('should warning alert if vehicle position or tmap is missing', () => {
      modeInstance.centerVehicle();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Vehicle position not available');
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Vehicle position not available'));
    });

    it('should warning alert if GPS position is invalid', () => {
      window.tmap = {
        droneMarker: {
          getLatLng: jest.fn(() => null)
        }
      };

      modeInstance.centerVehicle();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Vehicle GPS position not available');
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Vehicle GPS position not available'));
    });

    it('should update map coordinates when valid GPS coordinates are present', () => {
      window.tmap = {
        map: {
          setView: jest.fn()
        },
        droneMarker: {
          getLatLng: jest.fn(() => ({ lat: 13.004, lng: 80.234 }))
        }
      };

      modeInstance.centerVehicle();
      expect(window.tmap.map.setView).toHaveBeenCalledWith([13.004, 80.234], 16);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Map centered on vehicle');
    });
  });

  describe('Function: centerHome', () => {
    it('should error if WaypointManager is missing', () => {
      modeInstance.centerHome();
      expect(console.error).toHaveBeenCalledWith('❌ WaypointManager not available');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('WaypointManager not initialized');
    });

    it('should warning alert if home position is not set', () => {
      window.WaypointManager = {
        getHomePosition: jest.fn(() => null)
      };

      modeInstance.centerHome();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Home position not set');
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Home position not set'));
    });

    it('should invoke centerHome on WaypointManager on success', () => {
      const mockHome = { lat: 12.98, lng: 80.12 };
      window.WaypointManager = {
        getHomePosition: jest.fn(() => mockHome),
        centerHome: jest.fn()
      };

      modeInstance.centerHome();
      expect(window.WaypointManager.centerHome).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Map centered on home');
    });
  });
});