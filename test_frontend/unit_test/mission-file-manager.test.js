describe('Mission File Manager Behavioral Test Suite (mission-file-manager.js)', () => {
  let missionManager;
  let mockWaypointManager;
  let mockAnchor;

  beforeAll(() => {
    // 1. Prepare DOM and global environment spies
    window.URL = {
      createObjectURL: jest.fn().mockReturnValue('blob:http://localhost/mock-blob-uuid'),
      revokeObjectURL: jest.fn()
    };

    window.alert = jest.fn();

    // Mock anchor element factory
    mockAnchor = {
      href: '',
      download: '',
      click: jest.fn()
    };
    
    // Load the target mission-file-manager script
    global.loadScript('plan-flight-modules/mission-file-manager.js');

    const originalCreateElement = document.createElement.bind(document);
    document.createElement = jest.fn().mockImplementation((tag) => {
      if (tag === 'a') {
        return mockAnchor;
      }
      return originalCreateElement(tag);
    });

    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // 2. Set up high-fidelity WaypointManager spies
    mockWaypointManager = {
      getWaypoints: jest.fn().mockReturnValue([
        { id: 1, lat: 17.601, lng: 78.126, altitude: 50, type: 'waypoint' },
        { id: 2, lat: 17.605, lng: 78.130, altitude: 60, type: 'waypoint' }
      ]),
      getHomePosition: jest.fn().mockReturnValue({ lat: 17.600, lng: 78.125, altitude: 10 }),
      getTotalDistance: jest.fn().mockReturnValue(1250.5),
      clearAllWaypoints: jest.fn(),
      clearHomePosition: jest.fn(),
      setHomePosition: jest.fn(),
      addWaypoint: jest.fn(),
      centerMission: jest.fn()
    };
    window.WaypointManager = mockWaypointManager;

    // Reset current MissionFile instance
    window.MissionFile = null;
    missionManager = window.initializeMissionFileManager();
  });

  describe('Initialization Diagnostics', () => {
    it('should successfully instantiate the manager and set window reference', () => {
      expect(missionManager).toBeDefined();
      expect(window.MissionFile).toBe(missionManager);
    });
  });

  describe('Mission Export Operations (exportMission)', () => {
    it('should throw an error if WaypointManager is missing', () => {
      window.WaypointManager = null;
      expect(() => missionManager.exportMission()).toThrow('WaypointManager not initialized');
    });

    it('should map current waypoints, home coordinates, and stats to backend format', () => {
      const missionData = missionManager.exportMission();

      expect(missionData.version).toBe('1.0');
      expect(missionData.type).toBe('mission');
      expect(missionData.home).toEqual({
        lat: 17.600,
        lng: 78.125,
        altitude: 10
      });
      expect(missionData.waypoints).toHaveLength(2);
      expect(missionData.waypoints[0]).toEqual({
        id: 1,
        index: 0,
        lat: 17.601,
        lng: 78.126,
        altitude: 50,
        type: 'waypoint'
      });
      expect(missionData.stats).toEqual({
        totalWaypoints: 2,
        totalDistance: 1250.5,
        hasHome: true
      });
    });
  });

  describe('Save Mission to Waypoints File (saveMissionToFile)', () => {
    it('should display console warning and alert if waypoint list is empty', () => {
      mockWaypointManager.getWaypoints.mockReturnValue([]);
      
      const success = missionManager.saveMissionToFile();
      
      expect(success).toBe(false);
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('No waypoints to save'));
    });

    it('should trigger browser download link clicks and revoke object blobs', () => {
      const success = missionManager.saveMissionToFile('tihan_flight');

      expect(success).toBe(true);
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(mockAnchor.download).toBe('tihan_flight.waypoints');
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob-uuid');
      
      expect(window.MsgConsole.success).toHaveBeenCalledWith(
        expect.stringContaining('Mission saved: tihan_flight.waypoints')
      );
    });

    it('should catch exceptions and display diagnostics in MsgConsole error', () => {
      // Force error inside exportMission
      window.WaypointManager = null;
      
      expect(() => missionManager.saveMissionToFile()).toThrow();
      expect(window.MsgConsole.error).toHaveBeenCalled();
    });
  });

  describe('Load Mission Operations (loadMission)', () => {
    const validMissionData = {
      home: { lat: 17.600, lng: 78.125, altitude: 10 },
      waypoints: [
        { index: 1, lat: 17.605, lng: 78.130, altitude: 60 },
        { index: 0, lat: 17.601, lng: 78.126, altitude: 50 }
      ]
    };

    it('should validate inputs parameters and throw on coordinates validation failures', () => {
      const invalidData = {
        waypoints: [
          { lat: 150.5, lng: 78.126 } // invalid latitude > 90
        ]
      };

      expect(() => missionManager.loadMission(invalidData)).toThrow();
      expect(mockWaypointManager.clearAllWaypoints).not.toHaveBeenCalled();
    });

    it('should clear old missions, load home location, sort waypoints by index and re-add them', () => {
      const success = missionManager.loadMission(validMissionData);

      expect(success).toBe(true);
      expect(mockWaypointManager.clearAllWaypoints).toHaveBeenCalled();
      expect(mockWaypointManager.clearHomePosition).toHaveBeenCalled();
      expect(mockWaypointManager.setHomePosition).toHaveBeenCalledWith(17.600, 78.125);
      
      // Verify waypoints are sorted by index before being added
      // index 0 (17.601) should be added first, then index 1 (17.605)
      expect(mockWaypointManager.addWaypoint).toHaveBeenNthCalledWith(1, 17.601, 78.126, 50);
      expect(mockWaypointManager.addWaypoint).toHaveBeenNthCalledWith(2, 17.605, 78.130, 60);
      
      expect(mockWaypointManager.centerMission).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalled();
    });
  });

  describe('Load Mission File Picker Interactions (openMissionFile)', () => {
    it('should construct file inputs dialog and load parsed file contents', async () => {
      const dummyInput = {
        type: '',
        accept: '',
        addEventListener: jest.fn(),
        click: jest.fn()
      };
      
      // Override createElement to return dummy input picker
      document.createElement.mockReturnValueOnce(dummyInput);
      
      const filePromise = missionManager.openMissionFile();
      
      expect(document.createElement).toHaveBeenCalledWith('input');
      expect(dummyInput.type).toBe('file');
      expect(dummyInput.accept).toBe('.waypoints,.json');
      expect(dummyInput.click).toHaveBeenCalled();

      // Retrieve change handler and simulate file selection
      const changeHandler = dummyInput.addEventListener.mock.calls[0][1];
      
      const dummyFile = {
        name: 'test_plan.waypoints',
        text: jest.fn().mockResolvedValue(JSON.stringify({
          waypoints: [{ lat: 17.601, lng: 78.126, altitude: 50 }]
        }))
      };

      changeHandler({ target: { files: [dummyFile] } });
      
      const loadedData = await filePromise;
      expect(loadedData.waypoints[0].lat).toBe(17.601);
      expect(mockWaypointManager.clearAllWaypoints).toHaveBeenCalled();
    });

    it('should reject picker if an invalid file extension is selected', async () => {
      const dummyInput = {
        type: '',
        accept: '',
        addEventListener: jest.fn(),
        click: jest.fn()
      };
      
      document.createElement.mockReturnValueOnce(dummyInput);
      
      const filePromise = missionManager.openMissionFile();
      const changeHandler = dummyInput.addEventListener.mock.calls[0][1];
      
      const invalidFile = { name: 'unsupported.png' };
      changeHandler({ target: { files: [invalidFile] } });

      await expect(filePromise).rejects.toThrow('Invalid file type');
      expect(window.MsgConsole.error).toHaveBeenCalled();
    });
  });

  describe('New Mission Creation (newMission)', () => {
    it('should completely reset waypoints and clear GCS current mission states', () => {
      const success = missionManager.newMission();

      expect(success).toBe(true);
      expect(mockWaypointManager.clearAllWaypoints).toHaveBeenCalled();
      expect(mockWaypointManager.clearHomePosition).toHaveBeenCalled();
      expect(missionManager.getCurrentMission()).toBeNull();
      expect(window.MsgConsole.success).toHaveBeenCalled();
    });
  });
});