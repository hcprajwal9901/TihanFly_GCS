describe('Flight HUD HTML5 Canvas Component Unit Tests (flight-hud.js)', () => {
  let mockCtx;
  let canvasElement;
  let hudContainer;
  let toggleHudCheckbox;
  let closeBtn;
  let titleBar;

  beforeEach(() => {
    // 1. Setup required DOM structure BEFORE loading the script
    document.body.innerHTML = `
      <div id="hudContainer" style="width: 400px; height: 300px;">
        <div id="hudTitleBar">HUD Title</div>
        <canvas id="hudCanvas" style="width: 400px; height: 300px;"></canvas>
        <button id="hudCloseBtn"></button>
        <input type="checkbox" id="toggleHud" />
      </div>
    `;

    // Retrieve references
    hudContainer = document.getElementById('hudContainer');
    titleBar = document.getElementById('hudTitleBar');
    canvasElement = document.getElementById('hudCanvas');
    closeBtn = document.getElementById('hudCloseBtn');
    toggleHudCheckbox = document.getElementById('toggleHud');

    // 2. Prepare canvas 2D context spies to capture rendering commands
    mockCtx = {
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      fillRect: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      arc: jest.fn(),
      fillText: jest.fn(),
      strokeRect: jest.fn(),
      setLineDash: jest.fn(),
      closePath: jest.fn()
    };

    const fillStyles = [];
    const strokeStyles = [];
    Object.defineProperty(mockCtx, 'fillStyle', {
      get: () => fillStyles[fillStyles.length - 1],
      set: (val) => {
        fillStyles.push(val);
      },
      configurable: true
    });
    Object.defineProperty(mockCtx, 'strokeStyle', {
      get: () => strokeStyles[strokeStyles.length - 1],
      set: (val) => {
        strokeStyles.push(val);
      },
      configurable: true
    });
    mockCtx.fillStyles = fillStyles;
    mockCtx.strokeStyles = strokeStyles;

    canvasElement.getContext = jest.fn().mockReturnValue(mockCtx);

    // Mock client height and parent elements dimensions for resize checks
    Object.defineProperty(canvasElement, 'clientHeight', { value: 270, configurable: true });
    Object.defineProperty(canvasElement, 'parentElement', {
      value: { clientWidth: 400 },
      configurable: true
    });

    // 3. Reset telemetry state
    window.TelemetryStore = {
      roll: 0,
      pitch: 0,
      yaw: 0,
      altitude: 0,
      speed: 0,
      mode: 'STABILIZE',
      batteryVoltage: 12.6,
      batteryPercent: 95,
      satellites: 12
    };

    window.compass = null;

    jest.clearAllMocks();
    jest.useFakeTimers();

    // 4. Load flight-hud.js to run initialization
    global.loadScript('js/flight-hud.js');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initialization Failure Guard', () => {
    it('should log errors and halt loading when critical elements are missing', () => {
      // Clear DOM to trigger error conditions
      document.body.innerHTML = '';
      
      const originalGetElementById = document.getElementById;
      document.getElementById = jest.fn().mockReturnValue(null);
      
      jest.spyOn(console, 'error').mockImplementation(() => {});

      // Reload to run init
      global.loadScript('js/flight-hud.js');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[Flight HUD] Initialization failed: Missing elements')
      );

      // Restore original
      document.getElementById = originalGetElementById;
    });
  });

  describe('HUD Toggle & Layout Class Modifications', () => {
    it('should render successfully and toggle visibility states on checkbox change', () => {
      expect(hudContainer.classList.contains('hud-visible')).toBe(false);

      // Check the toggle to open the HUD
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      expect(hudContainer.classList.contains('hud-visible')).toBe(true);
      expect(canvasElement.width).toBe(400); // verify resize updated dimension

      // Uncheck toggle to hide the HUD
      toggleHudCheckbox.checked = false;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      expect(hudContainer.classList.contains('hud-visible')).toBe(false);
    });

    it('should coordinate closed action when trigger close button clicked', () => {
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));
      expect(hudContainer.classList.contains('hud-visible')).toBe(true);

      // Click Close
      closeBtn.click();

      expect(toggleHudCheckbox.checked).toBe(false);
      expect(hudContainer.classList.contains('hud-visible')).toBe(false);
    });
  });

  describe('Mouse Drag Handling on Title Bar', () => {
    it('should apply absolute offsets and reposition HUD Container on dragging', () => {
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      // Stub getBoundingClientRect
      hudContainer.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 100,
        left: 200
      });

      // Simulate mousedown
      const mouseDownEvent = new MouseEvent('mousedown', {
        clientX: 250,
        clientY: 120
      });
      titleBar.dispatchEvent(mouseDownEvent);

      expect(hudContainer.style.top).toBe('100px');
      expect(hudContainer.style.left).toBe('200px');
      expect(hudContainer.style.bottom).toBe('auto');
      expect(hudContainer.style.right).toBe('auto');

      // Simulate mousemove (dragging right by 50px, down by 30px)
      // ClientX moves from 250 to 300, ClientY from 120 to 150
      // pos1 = 250 - 300 = -50. top offset shifts by -(-30) = +30, left shifts by -(-50) = +50
      // Since container offsetTop defaults to 0, shifts by -pos2.
      // Let's stub offsetTop and offsetLeft
      Object.defineProperty(hudContainer, 'offsetTop', { value: 100 });
      Object.defineProperty(hudContainer, 'offsetLeft', { value: 200 });

      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: 300,
        clientY: 150
      });
      document.dispatchEvent(mouseMoveEvent);

      expect(hudContainer.style.top).toBe('130px'); // 100 - (120 - 150)
      expect(hudContainer.style.left).toBe('250px'); // 200 - (250 - 300)

      // Simulate mouseup to release drag
      const mouseUpEvent = new MouseEvent('mouseup');
      document.dispatchEvent(mouseUpEvent);

      // Transition should be restored
      expect(hudContainer.style.transition).toBe('');
    });
  });

  describe('Asynchronous Telemetry Smoothing & Calculations', () => {
    it('should interpolate telemetry values gradually according to SMOOTH_FACTOR', () => {
      // Activate HUD to start animation ticks
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      // Inject telemetry values
      window.TelemetryStore.roll = 0.5; // ~28.6 degrees
      window.TelemetryStore.pitch = -0.2; // ~-11.4 degrees

      // Tick once to calculate next smoothed step:
      // smoothedVal = 0 + (target - 0) * 0.45 = target * 0.45
      jest.advanceTimersByTime(16); // 60 FPS tick

      // Verify that canvas rotate was called with smoothed roll
      expect(mockCtx.rotate).toHaveBeenCalledWith(0.5 * 0.45); // roll is 0.225
      expect(mockCtx.translate).toHaveBeenCalledWith(0, -0.2 * 0.45 * 400); // pitch translation offset
    });

    it('should wrapping yaw boundaries smoothly from 0 to 360 degrees without spinning', () => {
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      // Start yaw near 0 degrees
      window.TelemetryStore.yaw = 0.05; // ~2.8 degrees
      jest.advanceTimersByTime(16);

      // Reset mocks and cross over 0 degrees from positive to negative radians: e.g. 355 degrees
      jest.clearAllMocks();
      window.TelemetryStore.yaw = (355 * Math.PI) / 180; // ~6.2 radians

      // Yaw smoothing diff should compute shortest wrap path rather than taking the full 355 deg sweep
      jest.advanceTimersByTime(16);

      // Verify it did not experience full rotation spin
      const yawDrawCall = mockCtx.fillText.mock.calls.find(call => call[0] === 'N');
      expect(yawDrawCall).toBeDefined();
    });

    it('should override TelemetryStore when window.compass updates exist', () => {
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      // Mock compass telemetry update overrides
      window.compass = {
        telemetry: {
          altitude: 150.5,
          speed: 22.4
        }
      };

      jest.advanceTimersByTime(500);

      // Verify altitude readout drawing calls received compass altitude values instead of TelemetryStore
      const altBoxText = mockCtx.fillText.mock.calls.find(call => call[0] === '150.5');
      expect(altBoxText).toBeDefined();
    });
  });

  describe('Canvas Graphics HUD Draw Assertions', () => {
    it('should draw sky/ground horizontal layouts and alt/speed tapes', () => {
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      // Tick to force drawing sequence
      jest.advanceTimersByTime(16);

      // Horizon line, center aircraft crosshairs, and tape marks should compile
      expect(mockCtx.clearRect).toHaveBeenCalled();
      
      // Sky blue transparent fill
      expect(mockCtx.fillStyles).toContain('rgba(41, 128, 185, 0.4)');
      expect(mockCtx.fillRect).toHaveBeenCalled();

      // Ground brown fill
      expect(mockCtx.fillStyles).toContain('rgba(139, 69, 19, 0.4)');

      // Horizon line stroke
      expect(mockCtx.strokeStyles).toContain('rgba(255, 255, 255, 0.8)');

      // Compass markings checks
      expect(mockCtx.fillText).toHaveBeenCalledWith('N', expect.any(Number), expect.any(Number));
    });

    it('should print voltage percents and current flight mode text in the corner', () => {
      toggleHudCheckbox.checked = true;
      toggleHudCheckbox.dispatchEvent(new Event('change'));

      window.TelemetryStore.mode = 'ALT_HOLD';
      window.TelemetryStore.batteryVoltage = 11.8;
      window.TelemetryStore.batteryPercent = 72;
      window.TelemetryStore.satellites = 15;

      jest.advanceTimersByTime(16);

      // Check text drawing calls in bottom-left corner
      expect(mockCtx.fillText).toHaveBeenCalledWith('ALT_HOLD', expect.any(Number), expect.any(Number));
      expect(mockCtx.fillText).toHaveBeenCalledWith('BATT: 11.8V / 72%', expect.any(Number), expect.any(Number));
      expect(mockCtx.fillText).toHaveBeenCalledWith('GPS: 15 Sats', expect.any(Number), expect.any(Number));
    });
  });
});