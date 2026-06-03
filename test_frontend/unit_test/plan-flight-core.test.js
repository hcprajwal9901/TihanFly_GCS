describe('Mission Planner Core High-Fidelity Behavioral Test Suite (plan-flight-core.js)', () => {
  beforeAll(() => {
    // Enable Jest fake timers for timeout sequencing
    jest.useFakeTimers();

    // Prepare exactly matched DOM structure for Plan Flight core setup
    const header = document.createElement('div');
    header.className = 'header-bar';
    document.body.appendChild(header);

    const headerLeft = document.createElement('div');
    headerLeft.className = 'header-left';
    header.appendChild(headerLeft);

    const headerCenter = document.createElement('div');
    headerCenter.className = 'header-center';
    header.appendChild(headerCenter);

    const statusBadge = document.createElement('span');
    statusBadge.className = 'status-badge';
    document.body.appendChild(statusBadge);

    const consoleContainer = document.createElement('div');
    consoleContainer.className = 'minimal-console-container';
    document.body.appendChild(consoleContainer);

    const weather = document.createElement('div');
    weather.id = 'weatherDashboard';
    document.body.appendChild(weather);

    const logo = document.createElement('img');
    logo.id = 'tihanLogo';
    document.body.appendChild(logo);

    const dropdownStrip = document.createElement('div');
    dropdownStrip.id = 'dropdownMenuStrip';
    document.body.appendChild(dropdownStrip);

    const flightStrip = document.createElement('div');
    flightStrip.id = 'flightControlsStrip';
    document.body.appendChild(flightStrip);

    const planStrip = document.createElement('div');
    planStrip.id = 'planFlightMenuStrip';
    document.body.appendChild(planStrip);

    // Mock UI layer methods on prototype since they are defined in plan-flight-ui.js
    const proto = window.PlanFlightMode ? window.PlanFlightMode.prototype : {};
    
    // Stub the prototype methods
    const uiMethods = [
      'hideElements',
      'transformHeaderForPlanMode',
      'showPlanMenuStrip',
      'moveWeatherToBottomLeft',
      'createCommandEditor',
      'attachMenuEventListeners',
      'restoreHeader',
      'restoreWeatherPosition',
      'removeCommandEditor',
      'hidePlanMenuStrip',
      'showElements'
    ];
    
    uiMethods.forEach(method => {
      Object.defineProperty(Object.prototype, method, {
        value: jest.fn(),
        writable: true,
        configurable: true
      });
    });

    // Mock global window elements used in connection sequences
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    window.CommandEditor = {
      setWaypointManager: jest.fn(),
      refreshWaypoints: jest.fn()
    };

    window.WaypointManager = {
      currentMode: null,
      cancelCurrentOperation: jest.fn()
    };

    window.PolygonManager = {
      isDrawing: false,
      cancelDrawing: jest.fn()
    };

    // Load actual script physically
    global.loadScript('plan-flight-modules/plan-flight-core.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.classList.remove('plan-mode-active');
    
    // Reset window managers state
    window.WaypointManager.currentMode = null;
    window.PolygonManager.isDrawing = false;
  });

  describe('Instantiation & Globals Exposure', () => {
    it('should expose the window.PlanFlight global controller API', () => {
      expect(window.PlanFlight).toBeDefined();
      expect(typeof window.PlanFlight.enter).toBe('function');
      expect(typeof window.PlanFlight.exit).toBe('function');
      expect(typeof window.PlanFlight.isActive).toBe('function');
    });

    it('should start with plan mode inactive', () => {
      expect(window.PlanFlight.isActive()).toBe(false);
      expect(document.body.classList.contains('plan-mode-active')).toBe(false);
    });
  });

  describe('Entering Plan Flight Mode', () => {
    it('should add the styling class to body and invoke UI transform steps', () => {
      window.PlanFlight.enter();

      // State check
      expect(window.PlanFlight.isActive()).toBe(true);
      expect(document.body.classList.contains('plan-mode-active')).toBe(true);

      // Verify MsgConsole call
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Plan Flight Mode activated');
    });

    it('should connect WaypointManager to CommandEditor and refresh list after a 500ms delay', () => {
      window.PlanFlight.enter();

      // WaypointManager connection block shouldn't have executed yet
      expect(window.CommandEditor.setWaypointManager).not.toHaveBeenCalled();
      expect(window.CommandEditor.refreshWaypoints).not.toHaveBeenCalled();

      // Advance timers by 500ms
      jest.advanceTimersByTime(500);

      // Verify delayed setup
      expect(window.CommandEditor.setWaypointManager).toHaveBeenCalledWith(window.WaypointManager);
      expect(window.CommandEditor.refreshWaypoints).toHaveBeenCalled();
    });
  });

  describe('Exiting Plan Flight Mode & Cancellations', () => {
    it('should remove the body class and transition state to inactive', () => {
      window.PlanFlight.enter();
      expect(window.PlanFlight.isActive()).toBe(true);

      window.PlanFlight.exit();
      expect(window.PlanFlight.isActive()).toBe(false);
      expect(document.body.classList.contains('plan-mode-active')).toBe(false);
    });

    it('should forcefully cancel active polygon drawing if exits while drawing', () => {
      // Simulate drawing active
      window.PolygonManager.isDrawing = true;

      window.PlanFlight.exit();

      expect(window.PolygonManager.cancelDrawing).toHaveBeenCalledTimes(1);
    });

    it('should forcefully cancel active waypoint operations if exits while in waypoint mode', () => {
      // Simulate active insert/add mode
      window.WaypointManager.currentMode = 'insert';

      window.PlanFlight.exit();

      expect(window.WaypointManager.cancelCurrentOperation).toHaveBeenCalledTimes(1);
    });

    it('should skip drawings/operations cancellation if none are active', () => {
      window.PolygonManager.isDrawing = false;
      window.WaypointManager.currentMode = null;

      window.PlanFlight.exit();

      expect(window.PolygonManager.cancelDrawing).not.toHaveBeenCalled();
      expect(window.WaypointManager.cancelCurrentOperation).not.toHaveBeenCalled();
    });
  });
});