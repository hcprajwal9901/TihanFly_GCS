describe('WaypointContextMenu High-Fidelity Behavioral Test Suite (waypoint-context-menu.js)', () => {
  let mockWaypointManager;
  let mockPolygonManager;

  beforeAll(() => {
    // Setup window alert, confirm, prompt spies
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
    window.prompt = jest.fn().mockReturnValue('15');

    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Leaflet Mock DOM Event Helper
    window.L = {
      DomEvent: {
        stopPropagation: jest.fn(),
        preventDefault: jest.fn()
      }
    };

    // Load context menu script
    global.loadScript('js/waypoint-context-menu.js');
  });

  let menuInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Prepare robust WaypointManager mock
    mockWaypointManager = {
      waypoints: [],
      removeWaypoint: jest.fn(),
      clearAllWaypoints: jest.fn(),
      startInsertingWaypoint: jest.fn(),
      startSettingHome: jest.fn(),
      addLandingPoint: jest.fn(),
      setHomePosition: jest.fn(),
      tmap: {
        enableClick: jest.fn()
      }
    };
    window.WaypointManager = mockWaypointManager;

    // Prepare robust PolygonManager mock
    mockPolygonManager = {
      polygons: [],
      startDrawingPolygon: jest.fn(),
      clearAllPolygons: jest.fn(),
      saveAllPolygons: jest.fn(),
      loadPolygon: jest.fn(),
      fromCurrentWaypoints: jest.fn(),
      offsetPolygon: jest.fn(),
      getAreaInfo: jest.fn()
    };
    window.PolygonManager = mockPolygonManager;

    // Connect menu to WaypointManager
    menuInstance = window.WaypointContextMenu;
    menuInstance.waypointManager = mockWaypointManager;
  });

  describe('Initialization and DOM Generation', () => {
    it('should initialize and append menu div container to the document body', () => {
      expect(menuInstance).toBeDefined();
      const menuEl = document.getElementById('waypointContextMenu');
      expect(menuEl).toBeDefined();
      expect(menuEl.className).toBe('waypoint-context-menu');
      expect(menuEl.style.display).toBe('none');
    });

    it('should generate all menu action items', () => {
      const menuEl = document.getElementById('waypointContextMenu');
      const deleteWpItem = menuEl.querySelector('[data-action="delete-wp"]');
      const clearMissionItem = menuEl.querySelector('[data-action="clear-mission"]');
      const rtlItem = menuEl.querySelector('[data-action="rtl"]');
      const loiterItem = menuEl.querySelector('[data-action="loiter"]');

      expect(deleteWpItem).toBeDefined();
      expect(clearMissionItem).toBeDefined();
      expect(rtlItem).toBeDefined();
      expect(loiterItem).toBeDefined();
    });
  });

  describe('Show and Hide Operations (Coordinates Adjustments)', () => {
    it('should position the menu at (x, y) and set display to block', () => {
      const dummyWp = { id: 1, lat: 17.6, lng: 78.1 };
      
      // Spy on dimensions (mock viewport boundaries)
      window.innerWidth = 1000;
      window.innerHeight = 800;

      menuInstance.showMenu(100, 150, dummyWp);

      expect(menuInstance.currentWaypoint).toBe(dummyWp);
      expect(menuInstance.menu.style.display).toBe('block');
      expect(menuInstance.menu.style.left).toBe('100px');
      expect(menuInstance.menu.style.top).toBe('150px');
    });

    it('should correct position coordinates on overflow edge boundaries', () => {
      const dummyWp = { id: 1, lat: 17.6, lng: 78.1 };
      
      // Mock viewport dimensions
      window.innerWidth = 400;
      window.innerHeight = 300;

      // Mock menu bounding box sizes
      menuInstance.menu.getBoundingClientRect = jest.fn().mockReturnValue({
        width: 150,
        height: 200,
        right: 450, // x (350) + width (150) = 500 > innerWidth (400)
        bottom: 350 // y (250) + height (200) = 450 > innerHeight (300)
      });

      menuInstance.showMenu(350, 250, dummyWp);

      // Verify coordinate shifts (x - menuWidth, y - menuHeight)
      expect(menuInstance.menu.style.left).toBe('200px');
      expect(menuInstance.menu.style.top).toBe('50px');
    });

    it('should hide menu and clear current waypoint tracking', () => {
      menuInstance.hideMenu();
      expect(menuInstance.menu.style.display).toBe('none');
      expect(menuInstance.currentWaypoint).toBeNull();
    });
  });

  describe('Contextual Menu Actions Dispatching', () => {
    it('should execute delete-wp routing to removeWaypoint', () => {
      const dummyWp = { id: 5 };
      menuInstance.currentWaypoint = dummyWp;
      
      menuInstance.handleMenuAction('delete-wp');
      
      expect(mockWaypointManager.removeWaypoint).toHaveBeenCalledWith(5);
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Waypoint 5 deleted'));
    });

    it('should execute insert-wp and trigger startInsertingWaypoint', () => {
      menuInstance.handleMenuAction('insert-wp');
      
      expect(window.MsgConsole.info).toHaveBeenCalledWith('Click on map to insert waypoint');
      expect(mockWaypointManager.startInsertingWaypoint).toHaveBeenCalled();
    });

    it('should execute clear-mission after asking confirm dialogues', () => {
      // User rejects clear
      window.confirm.mockReturnValueOnce(false);
      menuInstance.handleMenuAction('clear-mission');
      expect(mockWaypointManager.clearAllWaypoints).not.toHaveBeenCalled();

      // User approves clear
      window.confirm.mockReturnValueOnce(true);
      menuInstance.handleMenuAction('clear-mission');
      expect(mockWaypointManager.clearAllWaypoints).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Mission cleared');
    });

    it('should handle takeoff pos action clicks', () => {
      menuInstance.handleMenuAction('takeoff');
      expect(window.MsgConsole.info).toHaveBeenCalledWith('Click on map to set takeoff position');
      expect(mockWaypointManager.startSettingHome).toHaveBeenCalled();
    });

    it('should block actions if first takeoff waypoint is targeted', () => {
      const takeoffWp = { id: 1, type: 'takeoff' };
      mockWaypointManager.waypoints = [takeoffWp];
      menuInstance.currentWaypoint = takeoffWp;

      // RTL block
      menuInstance.handleMenuAction('rtl');
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Takeoff point mode cannot be changed');

      // Hover block
      menuInstance.handleMenuAction('set-hover');
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Takeoff point mode cannot be changed');

      // Reset block
      menuInstance.handleMenuAction('set-waypoint');
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('Takeoff point mode cannot be changed');
    });

    it('should map waypoint mode to RTL type and MAVLink RTL command', () => {
      const mockMarker = { setPopupContent: jest.fn() };
      const regularWp = { id: 2, type: 'waypoint', marker: mockMarker, lat: 17.6, lng: 78.1 };
      mockWaypointManager.waypoints = [{}, regularWp];
      menuInstance.currentWaypoint = regularWp;

      menuInstance.handleMenuAction('rtl');

      expect(regularWp.type).toBe('rtl');
      expect(regularWp.command).toBe(20);
      expect(mockMarker.setPopupContent).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('set as RTL'));
    });

    it('should map waypoint mode to Hover type and loiter command', () => {
      const mockMarker = { setPopupContent: jest.fn() };
      const regularWp = { id: 2, type: 'waypoint', marker: mockMarker, lat: 17.6, lng: 78.1 };
      mockWaypointManager.waypoints = [{}, regularWp];
      menuInstance.currentWaypoint = regularWp;

      menuInstance.handleMenuAction('set-hover');

      expect(regularWp.type).toBe('hover');
      expect(regularWp.command).toBe(17);
      expect(mockMarker.setPopupContent).toHaveBeenCalled();
    });

    it('should reset special waypoint mode back to standard fly-through', () => {
      const mockMarker = { setPopupContent: jest.fn() };
      const regularWp = { id: 2, type: 'rtl', marker: mockMarker, lat: 17.6, lng: 78.1 };
      mockWaypointManager.waypoints = [{}, regularWp];
      menuInstance.currentWaypoint = regularWp;

      menuInstance.handleMenuAction('set-waypoint');

      expect(regularWp.type).toBe('waypoint');
      expect(regularWp.command).toBe(16);
      expect(mockMarker.setPopupContent).toHaveBeenCalled();
    });

    it('should add landing point coordinate triggers', () => {
      const regularWp = { id: 2, type: 'waypoint', lat: 17.61, lng: 78.15 };
      menuInstance.currentWaypoint = regularWp;

      menuInstance.handleMenuAction('land');
      expect(mockWaypointManager.addLandingPoint).toHaveBeenCalledWith(17.61, 78.15);
    });

    it('should handle land context clicks when no waypoint is currently targeted', () => {
      menuInstance.currentWaypoint = null;
      menuInstance.handleMenuAction('land');
      expect(mockWaypointManager.addLandingPoint).not.toHaveBeenCalled();
    });

    it('should set home position here coordinates', () => {
      const regularWp = { id: 2, lat: 17.62, lng: 78.16 };
      menuInstance.currentWaypoint = regularWp;

      menuInstance.handleMenuAction('set-home-here');
      expect(mockWaypointManager.setHomePosition).toHaveBeenCalledWith(17.62, 78.16);
    });

    it('should prompt user to modify altitude parameters', () => {
      const mockMarker = { setPopupContent: jest.fn() };
      const regularWp = { id: 2, altitude: 25, type: 'waypoint', marker: mockMarker, lat: 17.6, lng: 78.1 };
      menuInstance.currentWaypoint = regularWp;

      // Mock user inputs 45m height
      window.prompt.mockReturnValueOnce('45');

      menuInstance.handleMenuAction('modify-alt');

      expect(window.prompt).toHaveBeenCalled();
      expect(regularWp.altitude).toBe(45);
      expect(mockMarker.setPopupContent).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Altitude updated to 45m');
    });
  });

  describe('Polygon Management Action Integrations', () => {
    it('should draw polygons via startDrawingPolygon', () => {
      menuInstance.handleMenuAction('polygon-draw');
      expect(mockPolygonManager.startDrawingPolygon).toHaveBeenCalled();
    });

    it('should clear polygons via clearAllPolygons', () => {
      menuInstance.handleMenuAction('polygon-clear');
      expect(mockPolygonManager.clearAllPolygons).toHaveBeenCalled();
    });

    it('should save polygons checking length safeguards', () => {
      // Empty polygons block
      mockPolygonManager.polygons = [];
      menuInstance.handleMenuAction('polygon-save');
      expect(mockPolygonManager.saveAllPolygons).not.toHaveBeenCalled();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('No polygons to save');

      // Valid polygons saves
      mockPolygonManager.polygons = [{ id: 1 }];
      menuInstance.handleMenuAction('polygon-save');
      expect(mockPolygonManager.saveAllPolygons).toHaveBeenCalled();
    });

    it('should trigger polygons offset dialog prompts', () => {
      mockPolygonManager.polygons = [{ id: 1 }];
      window.prompt.mockReturnValueOnce('12');

      menuInstance.handleMenuAction('polygon-offset');

      expect(window.prompt).toHaveBeenCalled();
      expect(mockPolygonManager.offsetPolygon).toHaveBeenCalledWith(1, 12);
    });

    it('should show polygon aggregate areas list in alert', () => {
      mockPolygonManager.polygons = [{ id: 1 }];
      mockPolygonManager.getAreaInfo.mockReturnValue({
        name: 'GeoFence 1',
        areaHectares: 1.5,
        areaKm2: 0.015,
        area: 15000.25
      });

      menuInstance.handleMenuAction('polygon-area');

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('1.5 hectares'));
    });
  });

  describe('Leaflet Marker Interactions', () => {
    it('should map contextual clicks on leaflet markers', () => {
      const mockMarker = {
        on: jest.fn()
      };
      const dummyWp = { id: 3 };

      menuInstance.attachToMarker(mockMarker, dummyWp);

      expect(mockMarker.on).toHaveBeenCalledWith('contextmenu', expect.any(Function));

      // Trigger standard Leaflet right-click context menu event
      const contextMenuHandler = mockMarker.on.mock.calls[0][1];
      const spyShowMenu = jest.spyOn(menuInstance, 'showMenu');

      const dummyEvt = {
        originalEvent: {
          clientX: 250,
          clientY: 320
        }
      };

      contextMenuHandler(dummyEvt);

      expect(spyShowMenu).toHaveBeenCalledWith(250, 320, dummyWp);
    });
  });

  describe('Additional Edge Cases and Coverage Expansion', () => {
    it('should test connectToWaypointManager interval connection', () => {
      jest.useFakeTimers();
      
      // Delete manager to reset connection loop
      delete window.WaypointManager;
      
      // Instantiate context menu again to trigger connection search
      const menu = new window.WaypointContextMenu.constructor();
      
      // Advance by 100ms: WaypointManager is still missing
      jest.advanceTimersByTime(100);
      expect(menu.waypointManager).toBeNull();
      
      // Define WaypointManager and advance by 100ms
      window.WaypointManager = mockWaypointManager;
      jest.advanceTimersByTime(100);
      expect(menu.waypointManager).toBe(mockWaypointManager);
      
      jest.useRealTimers();
    });

    it('should close menu when clicking outside of it', () => {
      menuInstance.menu.style.display = 'block';
      
      // Click on body element
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(menuInstance.menu.style.display).toBe('none');
    });

    it('should handle menu item clicks in DOM', () => {
      const spyHandleAction = jest.spyOn(menuInstance, 'handleMenuAction');
      
      // Click a separator (should not trigger any action)
      const separator = menuInstance.menu.querySelector('.context-menu-separator');
      separator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(spyHandleAction).not.toHaveBeenCalled();
      
      // Click a context menu item
      const item = menuInstance.menu.querySelector('[data-action="delete-wp"]');
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(spyHandleAction).toHaveBeenCalledWith('delete-wp');
      
      spyHandleAction.mockRestore();
    });

    it('should prevent default context menu events on the menu container', () => {
      const preventSpy = jest.fn();
      const dummyEvt = { preventDefault: preventSpy };
      
      menuInstance.menu.dispatchEvent(new MouseEvent('contextmenu'));
      // Since JSDOM event dispatching might not trigger the inline listener directly, we test the handler
      const menuEl = document.getElementById('waypointContextMenu');
      const event = new Event('contextmenu', { cancelable: true });
      event.preventDefault = preventSpy;
      menuEl.dispatchEvent(event);
      expect(preventSpy).toHaveBeenCalled();
    });

    it('should position and display polygon submenu', () => {
      jest.useFakeTimers();

      // Clean up any pre-existing submenu
      const existingSub = document.querySelector('.polygon-submenu');
      if (existingSub) existingSub.remove();

      // Stub getBoundingClientRect for polygon item
      const polygonItem = menuInstance.menu.querySelector('[data-action="polygon"]');
      polygonItem.getBoundingClientRect = jest.fn().mockReturnValue({
        right: 150,
        top: 200
      });

      menuInstance.showPolygonSubmenu();

      const submenu = document.querySelector('.polygon-submenu');
      expect(submenu).toBeTruthy();
      expect(submenu.style.left).toBe('155px');
      expect(submenu.style.top).toBe('200px');

      // Click outside submenu to close it
      jest.advanceTimersByTime(100);
      
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(submenu.style.display).toBe('none');
      jest.useRealTimers();
    });

    it('should handle polygon file imports', () => {
      const clickSpy = jest.fn();
      const originalCreate = document.createElement;
      document.createElement = jest.fn().mockImplementation((tag) => {
        const el = originalCreate.call(document, tag);
        if (tag === 'input') {
          el.click = clickSpy;
        }
        return el;
      });

      menuInstance.handlePolygonAction('polygon-load');

      expect(clickSpy).toHaveBeenCalled();
      document.createElement = originalCreate;
    });

    it('should trigger polygon-from-shp alert', () => {
      menuInstance.handlePolygonAction('polygon-from-shp');
      expect(window.MsgConsole.info).toHaveBeenCalledWith('SHP import feature coming soon');
    });

    it('should cover polygon-offset prompt failures', () => {
      // 1. Prompt returns null
      window.prompt.mockReturnValueOnce(null);
      menuInstance.handlePolygonAction('polygon-offset');
      expect(mockPolygonManager.offsetPolygon).not.toHaveBeenCalled();

      // 2. Prompt returns non-number
      window.prompt.mockReturnValueOnce('abc');
      menuInstance.handlePolygonAction('polygon-offset');
      expect(mockPolygonManager.offsetPolygon).not.toHaveBeenCalled();

      // 3. Polygon list is empty
      mockPolygonManager.polygons = [];
      window.prompt.mockReturnValueOnce('10');
      menuInstance.handlePolygonAction('polygon-offset');
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('No polygon to offset');
    });

    it('should cover polygon-area list empty check', () => {
      mockPolygonManager.polygons = [];
      menuInstance.handlePolygonAction('polygon-area');
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('No polygons available');
    });

    it('should cover takeoff and land actions when waypoint is null', () => {
      menuInstance.currentWaypoint = null;
      
      menuInstance.handleMenuAction('land');
      expect(mockWaypointManager.currentMode).toBe('land');
      expect(mockWaypointManager.tmap.enableClick).toHaveBeenCalled();
    });

    it('should check isFirstTakeoffWaypoint helper', () => {
      // Case 1: waypoint is null
      expect(menuInstance.isFirstTakeoffWaypoint(null)).toBe(false);

      // Case 2: WaypointManager is missing
      menuInstance.waypointManager = null;
      expect(menuInstance.isFirstTakeoffWaypoint({})).toBe(false);
      menuInstance.waypointManager = mockWaypointManager;

      // Case 3: first waypoint is takeoff type
      const firstWp = { type: 'takeoff' };
      mockWaypointManager.waypoints = [firstWp];
      expect(menuInstance.isFirstTakeoffWaypoint(firstWp)).toBe(true);

      // Case 4: first waypoint is not takeoff
      const regularWp = { type: 'waypoint' };
      mockWaypointManager.waypoints = [regularWp];
      expect(menuInstance.isFirstTakeoffWaypoint(regularWp)).toBe(false);
    });

    it('should log warning for unimplemented actions', () => {
      menuInstance.handleMenuAction('unknown-action-test');
      expect(window.MsgConsole.info).toHaveBeenCalledWith('unknown-action-test feature coming soon');
    });

    it('should cover error logs when WaypointManager is not initialized', () => {
      menuInstance.waypointManager = null;
      
      menuInstance.handleMenuAction('delete-wp');
      
      expect(window.MsgConsole.error).toHaveBeenCalledWith('WaypointManager not initialized');
    });
  });
});