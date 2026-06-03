describe('GCS Flight Plan Menu Router High-Fidelity Behavioral Test Suite (plan-flight-menu-router.js)', () => {
  let modeInstance;

  beforeAll(() => {
    // Mock MsgConsole component
    window.MsgConsole = {
      warning: jest.fn()
    };

    // Spy on global console warnings and logs
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Define dummy constructor
    window.PlanFlightMode = function() {};

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-menu-router.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();

    modeInstance = new window.PlanFlightMode();

    // Attach mock sub-handlers to the instance prototype/methods
    modeInstance.handleFileActions = jest.fn();
    modeInstance.handleTakeoffActions = jest.fn();
    modeInstance.handleWaypointActions = jest.fn();
    modeInstance.handleMissionSendActions = jest.fn();
    modeInstance.handlePolygonActions = jest.fn();
    modeInstance.handleReturnActions = jest.fn();
    modeInstance.handleCenterActions = jest.fn();
  });

  describe('Function: handleMenuAction Routing Categories', () => {
    it('should route file actions to handleFileActions', () => {
      const fileActions = ['new-mission', 'open-mission', 'save-mission'];
      fileActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handleFileActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handleFileActions).toHaveBeenCalledTimes(3);
    });

    it('should route takeoff actions to handleTakeoffActions', () => {
      const takeoffActions = ['takeoff-here', 'set-home-position', 'clear-home'];
      takeoffActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handleTakeoffActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handleTakeoffActions).toHaveBeenCalledTimes(3);
    });

    it('should route waypoint actions to handleWaypointActions', () => {
      const waypointActions = ['add-waypoint', 'insert-waypoint', 'delete-waypoint', 'clear-all'];
      waypointActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handleWaypointActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handleWaypointActions).toHaveBeenCalledTimes(4);
    });

    it('should route mission send actions to handleMissionSendActions', () => {
      const missionActions = ['send-markers', 'send-mission', 'write-to-drone', 'start-mission'];
      missionActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handleMissionSendActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handleMissionSendActions).toHaveBeenCalledTimes(4);
    });

    it('should route polygon actions to handlePolygonActions', () => {
      const polygonActions = ['draw-polygon', 'survey-pattern', 'survey-settings', 'clear-polygon'];
      polygonActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handlePolygonActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handlePolygonActions).toHaveBeenCalledTimes(4);
    });

    it('should route return actions to handleReturnActions', () => {
      const returnActions = ['return-to-launch', 'land-here'];
      returnActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handleReturnActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handleReturnActions).toHaveBeenCalledTimes(2);
    });

    it('should route centering actions to handleCenterActions', () => {
      const centerActions = ['center-mission', 'center-vehicle', 'center-home'];
      centerActions.forEach(action => {
        modeInstance.handleMenuAction(action);
        expect(modeInstance.handleCenterActions).toHaveBeenLastCalledWith(action);
      });
      expect(modeInstance.handleCenterActions).toHaveBeenCalledTimes(3);
    });

    it('should handle unimplemented/unknown menu action strings', () => {
      modeInstance.handleMenuAction('calibrate-sensor-action');
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Action not yet implemented: calibrate sensor action');
    });
  });
});