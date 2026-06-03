describe('WaypointManager High-Fidelity Behavioral Test Suite (waypoint-manager.js)', () => {
  let mockTMap;
  let clickCallback;
  let rightClickCallback;
  let dragCallbackMap;
  let markerClickCallbackMap;
  let contextMenuCallback = null;

  beforeAll(() => {
    // Mock global dependencies
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };
    window.CommandEditor = {
      refreshWaypoints: jest.fn()
    };
    window.WaypointContextMenu = {
      attachToMarker: jest.fn()
    };

    // Initialize mock event trackers
    dragCallbackMap = new Map();
    markerClickCallbackMap = new Map();

    // Prepare leaflet stubs
    window.L = {
      icon: jest.fn().mockImplementation((options) => options),
      latLng: jest.fn((lat, lng) => ({
        lat,
        lng,
        distanceTo: (other) => {
          const dx = lat - other.lat;
          const dy = lng - other.lng;
          return Math.sqrt(dx * dx + dy * dy) * 111000; // approximate meters
        }
      }))
    };

    // Construct a premium mock for TMap
    mockTMap = {
      onClick: jest.fn().mockImplementation((cb) => {
        clickCallback = cb;
      }),
      onRightClick: jest.fn().mockImplementation((cb) => {
        rightClickCallback = cb;
      }),
      disableClick: jest.fn(),
      enableClick: jest.fn(),
      addMarker: jest.fn().mockImplementation((lat, lng, draggable, options) => {
        const marker = {
          lat,
          lng,
          draggable,
          options,
          bindPopup: jest.fn().mockReturnThis(),
          setPopupContent: jest.fn().mockReturnThis(),
          on: jest.fn().mockImplementation((evt, cb) => {
            if (evt === 'contextmenu') {
              contextMenuCallback = cb;
            }
          })
        };
        return marker;
      }),
      onMarkerDragEnd: jest.fn().mockImplementation((marker, cb) => {
        dragCallbackMap.set(marker, cb);
      }),
      onMarkerClick: jest.fn().mockImplementation((marker, cb) => {
        markerClickCallbackMap.set(marker, cb);
      }),
      removeMarker: jest.fn(),
      clearRoute: jest.fn(),
      drawRoute: jest.fn(),
      calculateDistance: jest.fn().mockReturnValue(150.2),
      fitBounds: jest.fn(),
      setCenter: jest.fn(),
      map: {
        getCenter: jest.fn().mockReturnValue({ lat: 17.601, lng: 78.126 })
      }
    };

    window.tmap = mockTMap;

    // Load the target script in the global context
    global.loadScript('js/waypoint-manager.js');
  });

  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    dragCallbackMap.clear();
    markerClickCallbackMap.clear();
    
    // Create a fresh instance of WaypointManager for isolated tests using constructor of the loaded global instance
    const WaypointManagerClass = window.WaypointManager.constructor;
    manager = new WaypointManagerClass(mockTMap);
  });

  describe('Instantiation & Map Bindings', () => {
    it('should initialize and register itself globally', () => {
      expect(manager).toBeDefined();
      expect(mockTMap.onClick).toHaveBeenCalled();
      expect(mockTMap.onRightClick).toHaveBeenCalled();
      expect(mockTMap.disableClick).toHaveBeenCalled();
    });

    it('should configure internal icons correctly', () => {
      expect(manager.icons.waypoint).toBeDefined();
      expect(manager.icons.home).toBeDefined();
      expect(manager.icons.landing).toBeDefined();
    });
  });

  describe('Modes & Event Interventions', () => {
    it('should switch into waypoint addition mode', () => {
      manager.startAddingWaypoint();
      expect(manager.currentMode).toBe('add');
      expect(mockTMap.enableClick).toHaveBeenCalled();
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Click on map'));
    });

    it('should cancel operations gracefully', () => {
      manager.currentMode = 'add';
      manager.cancelCurrentOperation();
      expect(manager.currentMode).toBeNull();
      expect(mockTMap.disableClick).toHaveBeenCalled();
      expect(window.MsgConsole.info).toHaveBeenCalledWith('Operation cancelled');
    });

    it('should route map click events based on current active mode', () => {
      const spyAdd = jest.spyOn(manager, 'addWaypoint');
      const spyInsert = jest.spyOn(manager, 'insertWaypoint');
      const spySetHome = jest.spyOn(manager, 'setHomePosition');
      const spyLanding = jest.spyOn(manager, 'addLandingPoint');

      // Click with no active mode
      manager.currentMode = null;
      clickCallback(17.6, 78.1, {});
      expect(spyAdd).not.toHaveBeenCalled();

      // Click in 'add' mode
      manager.currentMode = 'add';
      clickCallback(17.601, 78.126, {});
      expect(spyAdd).toHaveBeenCalledWith(17.601, 78.126);

      // Click in 'insert' mode
      manager.currentMode = 'insert';
      clickCallback(17.602, 78.127, {});
      expect(spyInsert).toHaveBeenCalledWith(17.602, 78.127);

      // Click in 'takeoff' mode
      manager.currentMode = 'takeoff';
      clickCallback(17.603, 78.128, {});
      expect(spySetHome).toHaveBeenCalledWith(17.603, 78.128);
      expect(manager.currentMode).toBeNull();
      expect(mockTMap.disableClick).toHaveBeenCalled();

      // Click in 'land' mode
      manager.currentMode = 'land';
      clickCallback(17.604, 78.129, {});
      expect(spyLanding).toHaveBeenCalledWith(17.604, 78.129);
      expect(manager.currentMode).toBeNull();
    });

    it('should route map right-click event to set home coordinates', () => {
      const spySetHome = jest.spyOn(manager, 'setHomePosition');
      const mockEvent = {
        originalEvent: {
          preventDefault: jest.fn(),
          stopPropagation: jest.fn()
        }
      };

      rightClickCallback(17.65, 78.65, mockEvent);
      expect(spySetHome).toHaveBeenCalledWith(17.65, 78.65);
      expect(mockEvent.originalEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.originalEvent.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('Drone Coordinate Resolutions', () => {
    it('should resolve position from drone marker if present', () => {
      mockTMap.droneMarker = {
        getLatLng: () => ({ lat: 17.9, lng: 78.9 })
      };
      expect(manager.getDroneActualLocation()).toEqual({ lat: 17.9, lng: 78.9 });
    });

    it('should resolve from home position if drone marker is missing', () => {
      mockTMap.droneMarker = null;
      manager.homePosition = { lat: 17.8, lng: 78.8 };
      expect(manager.getDroneActualLocation()).toEqual({ lat: 17.8, lng: 78.8 });
    });

    it('should resolve from map center if drone and home are missing', () => {
      mockTMap.droneMarker = null;
      manager.homePosition = null;
      expect(manager.getDroneActualLocation()).toEqual({ lat: 17.601, lng: 78.126 });
    });
  });

  describe('Interactive Node Additions', () => {
    it('should automatically prepend takeoff point if waypoint list is empty', () => {
      const spyDirect = jest.spyOn(manager, '_addWaypointDirect');
      
      // Attempt adding a normal waypoint first
      manager.addWaypoint(17.605, 78.130, 40);

      // Verify direct additions: First takeoff (prepended) then actual waypoint
      expect(spyDirect).toHaveBeenCalledTimes(2);
      expect(spyDirect).toHaveBeenNthCalledWith(1, 17.601, 78.126, 15, 'takeoff', 10);
      expect(spyDirect).toHaveBeenNthCalledWith(2, 17.605, 78.130, 40, 'waypoint', 10);
      expect(manager.waypoints).toHaveLength(2);
      expect(manager.waypoints[0].type).toBe('takeoff');
      expect(manager.waypoints[1].type).toBe('waypoint');
    });

    it('should create marker, bind popup, register drags/clicks and contextual menu listeners', () => {
      manager.addWaypoint(17.605, 78.130, 50, 'landing');
      
      const waypoint = manager.waypoints[1]; // Index 1 because takeoff was prepended
      expect(waypoint.marker).toBeDefined();
      expect(waypoint.marker.bindPopup).toHaveBeenCalled();
      expect(mockTMap.onMarkerDragEnd).toHaveBeenCalledWith(waypoint.marker, expect.any(Function));
      expect(mockTMap.onMarkerClick).toHaveBeenCalledWith(waypoint.marker, expect.any(Function));
      expect(window.WaypointContextMenu.attachToMarker).toHaveBeenCalledWith(waypoint.marker, waypoint);
    });

    it('should handle dragging marker and updating route and command editors', () => {
      manager.addWaypoint(17.605, 78.130, 50);
      const waypoint = manager.waypoints[1];

      const dragCallback = dragCallbackMap.get(waypoint.marker);
      expect(dragCallback).toBeDefined();

      // Trigger drag completion
      dragCallback(17.610, 78.140);

      expect(waypoint.lat).toBe(17.610);
      expect(waypoint.lng).toBe(78.140);
      expect(mockTMap.clearRoute).toHaveBeenCalled();
      expect(window.CommandEditor.refreshWaypoints).toHaveBeenCalled();
    });

    it('should remove waypoint on marker click if current mode is delete', () => {
      manager.addWaypoint(17.605, 78.130, 50);
      const waypoint = manager.waypoints[1];

      const markerClickCallback = markerClickCallbackMap.get(waypoint.marker);
      expect(markerClickCallback).toBeDefined();

      const spyRemove = jest.spyOn(manager, 'removeWaypoint');
      
      // Try click when delete mode is NOT active
      manager.currentMode = null;
      markerClickCallback();
      expect(spyRemove).not.toHaveBeenCalled();

      // Try click in delete mode
      manager.currentMode = 'delete';
      markerClickCallback();
      expect(spyRemove).toHaveBeenCalledWith(waypoint.id);
    });
  });

  describe('Waypoint Deletions', () => {
    it('should trigger warnings and prevent deletion of takeoff node if other points exist', () => {
      manager.addWaypoint(17.605, 78.130, 50);
      expect(manager.waypoints).toHaveLength(2); // Takeoff + Waypoint

      const takeoffWp = manager.waypoints[0];
      
      manager.removeWaypoint(takeoffWp.id);
      expect(manager.waypoints).toHaveLength(2); // Deletion blocked!
      expect(window.MsgConsole.warning).toHaveBeenCalledWith(expect.stringContaining('Takeoff point cannot be deleted'));
    });

    it('should delete takeoff point safely if it is the only waypoint in the mission', () => {
      manager.addWaypoint(17.605, 78.130, 50);
      expect(manager.waypoints).toHaveLength(2);
      
      // Delete regular waypoint first
      const regularWp = manager.waypoints[1];
      manager.removeWaypoint(regularWp.id);
      expect(manager.waypoints).toHaveLength(1);

      // Now delete takeoff waypoint
      const takeoffWp = manager.waypoints[0];
      manager.removeWaypoint(takeoffWp.id);
      expect(manager.waypoints).toHaveLength(0); // Safely deleted!
    });
  });

  describe('Waypoint Path Insertions', () => {
    it('should reject starting insertion mode if less than 2 waypoints are present', () => {
      manager.waypoints = [];
      manager.startInsertingWaypoint();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith(expect.stringContaining('Need at least 2 waypoints'));
      expect(manager.currentMode).not.toBe('insert');
    });

    it('should insert mid-segment point by finding best spatial projection coordinates', () => {
      // Create path of two points
      manager.waypoints = [
        { id: 1, lat: 17.600, lng: 78.120, altitude: 20, type: 'takeoff', marker: {} },
        { id: 2, lat: 17.600, lng: 78.140, altitude: 30, type: 'waypoint', marker: {} }
      ];

      manager.currentMode = 'insert';
      // Insert near coordinates (exactly half-way on segment)
      manager.insertWaypoint(17.600, 78.130);

      expect(manager.waypoints).toHaveLength(3);
      expect(manager.waypoints[1].lat).toBe(17.600);
      expect(manager.waypoints[1].lng).toBe(78.130);
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('inserted at position 2'));
    });
  });

  describe('Home and Landing Position Controls', () => {
    it('should trigger takeoff operations setting current mode', () => {
      manager.startTakeoffHere();
      expect(manager.currentMode).toBe('takeoff');
      expect(mockTMap.enableClick).toHaveBeenCalled();
    });

    it('should establish home position, construct marker popup and handle contexts right click', () => {
      manager.setHomePosition(17.61, 78.12);
      expect(manager.homePosition).toBeDefined();
      expect(manager.homePosition.lat).toBe(17.61);
      expect(mockTMap.addMarker).toHaveBeenCalled();

      expect(contextMenuCallback).toBeDefined();

      const mockEvt = {
        originalEvent: {
          stopPropagation: jest.fn(),
          preventDefault: jest.fn()
        }
      };
      
      contextMenuCallback(mockEvt);
      expect(manager.homePosition).toBeNull();
      expect(mockTMap.removeMarker).toHaveBeenCalled();
    });

    it('should handle startLandHere setting land mode', () => {
      manager.startLandHere();
      expect(manager.currentMode).toBe('land');
      expect(mockTMap.enableClick).toHaveBeenCalled();
    });
  });

  describe('Route Visibilities, Stats and Center Maps', () => {
    it('should toggle routes visibility lines and sync displays', () => {
      manager.addWaypoint(17.601, 78.126);
      manager.addWaypoint(17.605, 78.130);
      
      manager.showRouteLine = true;
      manager.toggleRouteLine();
      expect(manager.showRouteLine).toBe(false);
      expect(mockTMap.clearRoute).toHaveBeenCalled();

      manager.toggleRouteLine();
      expect(manager.showRouteLine).toBe(true);
      expect(mockTMap.drawRoute).toHaveBeenCalled();
    });

    it('should hide and show route lines explicitly', () => {
      manager.hideRouteLines();
      expect(manager.showRouteLine).toBe(false);

      manager.showRouteLines();
      expect(manager.showRouteLine).toBe(true);
    });

    it('should fit bounds to center mission waypoints', () => {
      manager.waypoints = [
        { lat: 17.601, lng: 78.126 },
        { lat: 17.605, lng: 78.130 }
      ];
      manager.centerMission();
      expect(mockTMap.fitBounds).toHaveBeenCalledWith([
        [17.601, 78.126],
        [17.605, 78.130]
      ]);
    });

    it('should center camera on home position marker', () => {
      manager.homePosition = { lat: 17.601, lng: 78.126 };
      manager.centerHome();
      expect(mockTMap.setCenter).toHaveBeenCalledWith(17.601, 78.126, 16);
    });
  });

  describe('Mission Loading, Imports & Exports', () => {
    it('should clear all nodes and reset states', () => {
      manager.waypoints = [{ marker: {} }];
      manager.clearAllWaypoints();
      expect(manager.waypoints).toHaveLength(0);
      expect(mockTMap.removeMarker).toHaveBeenCalled();
    });

    it('should serialize waypoints and home position on export', () => {
      manager.waypoints = [
        { id: 1, lat: 17.601, lng: 78.126, altitude: 20, type: 'takeoff' }
      ];
      manager.homePosition = { lat: 17.600, lng: 78.120, altitude: 10 };

      const mission = manager.exportMission();
      expect(mission.waypoints).toHaveLength(1);
      expect(mission.homePosition).toEqual({ lat: 17.600, lng: 78.120, altitude: 10 });
    });

    it('should unpack imported mission payload and map route coordinates', () => {
      const spyClearWaypoints = jest.spyOn(manager, 'clearAllWaypoints');
      const spyClearHome = jest.spyOn(manager, 'clearHomePosition');
      const spySetHome = jest.spyOn(manager, 'setHomePosition');
      const spyAdd = jest.spyOn(manager, 'addWaypoint');

      const missionData = {
        homePosition: { lat: 17.600, lng: 78.120 },
        waypoints: [
          { lat: 17.601, lng: 78.126, altitude: 30, type: 'takeoff' },
          { lat: 17.605, lng: 78.130, altitude: 45, type: 'waypoint' }
        ]
      };

      manager.importMission(missionData);

      expect(spyClearWaypoints).toHaveBeenCalled();
      expect(spyClearHome).toHaveBeenCalled();
      expect(spySetHome).toHaveBeenCalledWith(17.600, 78.120);
      expect(spyAdd).toHaveBeenNthCalledWith(1, 17.601, 78.126, 30, 'takeoff');
      expect(spyAdd).toHaveBeenNthCalledWith(2, 17.605, 78.130, 45, 'waypoint');
    });
  });
});