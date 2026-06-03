describe('GCS Flight Plan File Actions High-Fidelity Behavioral Test Suite (plan-flight-file.js)', () => {
  let modeInstance;
  let mockAnchor;
  let autoDismissCallback;
  let originalCreateElement;
  let createdNotification;

  beforeAll(() => {
    // Keep reference to genuine native document.createElement before any spy modifications
    originalCreateElement = document.createElement;

    // Mock MsgConsole component
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Mock URL object methods
    global.URL.createObjectURL = jest.fn(() => 'blob:test-mission-url');
    global.URL.revokeObjectURL = jest.fn();

    // Define dummy constructor for PlanFlightMode
    window.PlanFlightMode = function() {};

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-file.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    autoDismissCallback = null;
    createdNotification = null;

    // Spy on global console warnings and errors silently
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Define popups directly as mock functions on window to prevent spy failures in JSDOM
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    window.prompt = jest.fn(() => 'test_mission');

    // Define setTimeout mock in beforeEach to prevent it from being wiped by clearAllMocks
    jest.spyOn(global, 'setTimeout').mockImplementation((cb, delay) => {
      if (delay === 5000) {
        autoDismissCallback = cb;
      }
      return 0; // return dummy timer ID
    });

    // Intercept DOM node injection via document.body.appendChild to attach guaranteed remove polyfills
    const originalAppend = document.body.appendChild;
    jest.spyOn(document.body, 'appendChild').mockImplementation(function(node) {
      if (node && node.className === 'new-mission-notification') {
        createdNotification = node;
        // Inject bulletproof remove implementation directly on this specific JSDOM node
        node.remove = function() {
          if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        };
      }
      return originalAppend.call(this, node);
    });

    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Reset window variables
    delete window.WaypointManager;
    delete window.MissionFile;

    // Setup mock real anchor for JSDOM appendChild compatibility using genuine native constructor
    mockAnchor = originalCreateElement.call(document, 'a');
    jest.spyOn(mockAnchor, 'click').mockImplementation(() => {});
    
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'a') {
        return mockAnchor;
      }
      return originalCreateElement.call(document, tagName);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Function: handleFileActions Routing', () => {
    it('should route matching file actions to their respective handlers', () => {
      const spyNew = jest.spyOn(modeInstance, 'newMission').mockImplementation(() => {});
      const spyOpen = jest.spyOn(modeInstance, 'openMission').mockImplementation(() => {});
      const spySave = jest.spyOn(modeInstance, 'saveMission').mockImplementation(() => {});

      modeInstance.handleFileActions('new-mission');
      expect(spyNew).toHaveBeenCalledTimes(1);

      modeInstance.handleFileActions('open-mission');
      expect(spyOpen).toHaveBeenCalledTimes(1);

      modeInstance.handleFileActions('save-mission');
      expect(spySave).toHaveBeenCalledTimes(1);

      spyNew.mockRestore();
      spyOpen.mockRestore();
      spySave.mockRestore();
    });
  });

  describe('Function: ensureMissionFileManager Instantiation Fallbacks', () => {
    it('should return true if window.MissionFile is already defined', () => {
      window.MissionFile = {};
      const res = modeInstance.ensureMissionFileManager();
      expect(res).toBe(true);
    });

    it('should attempt fallback instantiation via initializeMissionFileManager global function if present', () => {
      const mockMgr = { initialized: true };
      global.initializeMissionFileManager = jest.fn(() => mockMgr);

      const res = modeInstance.ensureMissionFileManager();
      expect(res).toBe(true);
      expect(window.MissionFile).toBe(mockMgr);
      expect(global.initializeMissionFileManager).toHaveBeenCalled();

      delete global.initializeMissionFileManager;
    });

    it('should attempt fallback instantiation via new MissionFileManager constructor if present', () => {
      const mockMgr = { initialized: true };
      global.MissionFileManager = jest.fn().mockImplementation(() => mockMgr);

      const res = modeInstance.ensureMissionFileManager();
      expect(res).toBe(true);
      expect(window.MissionFile).toBe(mockMgr);
      expect(global.MissionFileManager).toHaveBeenCalled();

      delete global.MissionFileManager;
    });

    it('should return false and log error if no fallback is available to instantiate MissionFile', () => {
      const res = modeInstance.ensureMissionFileManager();
      expect(res).toBe(false);
    });
  });

  describe('Function: newMission & Floating Notification Modal', () => {
    it('should error if WaypointManager is not available', () => {
      modeInstance.newMission();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('WaypointManager not initialized'));
    });

    it('should clear caches, show notification modal, and trigger startAddingWaypoint on confirmation click', () => {
      window.WaypointManager = {
        clearAllWaypoints: jest.fn(),
        clearHomePosition: jest.fn(),
        startAddingWaypoint: jest.fn()
      };

      modeInstance.newMission();

      expect(window.WaypointManager.clearAllWaypoints).toHaveBeenCalledTimes(1);
      expect(window.WaypointManager.clearHomePosition).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ New mission ready');

      // Verify notification modal is injected into JSDOM body using body selector
      const notification = document.body.querySelector('.new-mission-notification');
      expect(notification).toBeTruthy();
      expect(notification.textContent).toContain('New Mission Ready');

      // Retrieve button inside notification modal
      const confirmBtn = notification.querySelector('button');
      
      // Compile and execute inline onclick directly in our clean test context to bypass buggy JSDOM with-scopes
      const onclickAttr = confirmBtn.getAttribute('onclick');
      const evalFn = new Function('window', onclickAttr);
      evalFn.call(confirmBtn, window);

      // Check notification got removed and waypoint adding started
      expect(document.body.querySelector('.new-mission-notification')).toBeNull();
      expect(window.WaypointManager.startAddingWaypoint).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.info).toHaveBeenCalledWith('✈️ Click on map to add waypoints');
    });

    it('should auto-dismiss new mission notification after a 5-second timeout', () => {
      window.WaypointManager = {
        clearAllWaypoints: jest.fn(),
        clearHomePosition: jest.fn()
      };

      modeInstance.newMission();
      expect(document.body.querySelector('.new-mission-notification')).toBeTruthy();
      expect(autoDismissCallback).toBeTruthy();

      // Invoke the dismissed timeout callback manually
      autoDismissCallback();
      
      expect(document.body.querySelector('.new-mission-notification')).toBeNull();
    });
  });

  describe('Function: openMission', () => {
    it('should check connectivity and alert error if MissionFile is unavailable', () => {
      modeInstance.openMission();
      expect(window.alert).toHaveBeenCalledWith('❌ Mission File Manager Not Available');
    });

    it('should resolve Promise and log success on loaded mission payload', async () => {
      const mockData = { id: 'mission_001', waypoints: [] };
      window.MissionFile = {
        openMissionFile: jest.fn(() => Promise.resolve(mockData))
      };

      modeInstance.openMission();

      // Await Promise resolution microtasks
      await Promise.resolve();
      await Promise.resolve();

      expect(window.MissionFile.openMissionFile).toHaveBeenCalledTimes(1);
    });

    it('should log error on failed file load except if user cancels selection', async () => {
      window.MissionFile = {
        openMissionFile: jest.fn(() => Promise.reject(new Error('Syntax error in parsing JSON')))
      };

      modeInstance.openMission();

      await Promise.resolve();
      await Promise.resolve();

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to load mission file'));

      // If error message is 'No file selected' (cancelled by user), do NOT alert user
      window.alert.mockClear();
      window.MissionFile.openMissionFile.mockImplementation(() => Promise.reject(new Error('No file selected')));
      modeInstance.openMission();

      await Promise.resolve();
      await Promise.resolve();

      expect(window.alert).not.toHaveBeenCalled();
    });
  });

  describe('Function: saveMission File Export Downloader', () => {
    beforeEach(() => {
      window.WaypointManager = {
        getWaypoints: jest.fn(() => [])
      };
      window.MissionFile = {
        exportMission: jest.fn(() => ({
          stats: { totalDistance: 3500 },
          waypoints: [{ lat: 12, lng: 80, altitude: 45 }]
        }))
      };
    });

    it('should check connectivity and alert error if MissionFile or WaypointManager is missing', () => {
      delete window.MissionFile;
      modeInstance.saveMission();
      expect(window.alert).toHaveBeenCalledWith('❌ Mission File Manager Not Available');

      window.MissionFile = {};
      delete window.WaypointManager;
      modeInstance.saveMission();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('WaypointManager not initialized'));
    });

    it('should show warning alert if waypoints array is empty', () => {
      modeInstance.saveMission();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('No waypoints to save');
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('No waypoints to save'));
    });

    it('should request filename via prompt, clean extensions, construct Blob, and invoke anchor click', async () => {
      const mockWaypoints = [{ id: 1, lat: 12, lng: 80 }];
      window.WaypointManager.getWaypoints.mockImplementation(() => mockWaypoints);

      // Simulate entering filename with extension: "mymission.waypoints"
      window.prompt.mockImplementation(() => 'mymission.waypoints');

      modeInstance.saveMission();

      // Resolve microtask and any background file stream timers
      await Promise.resolve();
      await Promise.resolve();

      expect(window.prompt).toHaveBeenCalledTimes(1);
      expect(window.MissionFile.exportMission).toHaveBeenCalledTimes(1);

      // Verify Blob URL creation
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);

      // Verify virtual anchor was generated and clicked
      expect(mockAnchor.download).toBe('mymission.waypoints');
      expect(mockAnchor.href).toBe('blob:test-mission-url');
      expect(mockAnchor.click).toHaveBeenCalledTimes(1);

      // Verify cleanup and revocation
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-mission-url');
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Mission saved: mymission.waypoints');
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('✅ Mission Saved Successfully'));
    });

    it('should handle cancel click in prompt dialog gracefully', () => {
      const mockWaypoints = [{ id: 1, lat: 12, lng: 80 }];
      window.WaypointManager.getWaypoints.mockImplementation(() => mockWaypoints);

      // Prompt returns null when user clicks Cancel
      window.prompt.mockImplementation(() => null);

      modeInstance.saveMission();

      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
      expect(mockAnchor.click).not.toHaveBeenCalled();
    });

    it('should handle empty input in prompt dialog gracefully', () => {
      const mockWaypoints = [{ id: 1, lat: 12, lng: 80 }];
      window.WaypointManager.getWaypoints.mockImplementation(() => mockWaypoints);

      // Prompt returns empty string when user clicks OK without typing
      window.prompt.mockImplementation(() => '   ');

      modeInstance.saveMission();

      expect(window.alert).toHaveBeenCalledWith('Please enter a valid filename.');
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });
  });
});