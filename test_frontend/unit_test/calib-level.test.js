describe('GCS Level Calibration High-Fidelity Behavioral Test Suite (calib-level.js)', () => {
  let mockSocket;
  let wsListeners = [];

  beforeAll(() => {
    jest.useFakeTimers();

    // Mock MutationObserver to prevent cross-test leaks
    global.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    };

    // Define standard WebSocket static properties on the mock constructor
    if (global.WebSocket) {
      global.WebSocket.CONNECTING = 0;
      global.WebSocket.OPEN = 1;
      global.WebSocket.CLOSING = 2;
      global.WebSocket.CLOSED = 3;
    }

    // Mock offsetParent to bypass JSDOM offsetParent === null limits
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      get() { return this.parentElement || document.body; },
      configurable: true
    });

    // Mock global components
    window.SwUtil = {
      setStatus: jest.fn((id, text, cls) => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = text;
          el.className = 'calib-status-value ' + (cls || 'idle');
        }
      }),
      toast: jest.fn()
    };

    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Load script physically in JSDOM
    global.loadScript('js/calib-level.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    wsListeners = [];

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-calib-level" style="display: block;"></div>';

    // Mock WebSocket with complete event handling
    mockSocket = {
      url: 'ws://mock-calib-level',
      readyState: 1, // OPEN
      send: jest.fn(),
      addEventListener: jest.fn((event, cb) => {
        if (event === 'message') {
          wsListeners.push(cb);
        }
      }),
      removeEventListener: jest.fn()
    };

    window.ws = mockSocket;
    window.socket = mockSocket;

    // Manually trigger init to render layout and bind fresh listeners
    window.panel_calib_level.init();
  });

  function triggerSocketMessage(data) {
    const event = { data: JSON.stringify(data) };
    wsListeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        // Suppress errors during dispatch
      }
    });
  }

  describe('Layout Injection & Target Selector', () => {
    it('should inject correct HTML templates and populate drone selector when multiple drones exist', () => {
      expect(document.getElementById('levelStatus').textContent).toBe('NOT STARTED');
      expect(document.getElementById('levelStartBtn')).toBeTruthy();

      const selectorWrap = document.getElementById('levelDroneSelector');
      const select = document.getElementById('levelDroneSelect');

      expect(selectorWrap.style.display).toBe('none'); // initially none

      // Send vehicles list update via socket
      window.g_vehicles = [
        { sysid: 1, type: 'Copter' },
        { sysid: 3, type: 'Rover' }
      ];
      triggerSocketMessage({
        type: 'vehicles_update'
      });

      expect(selectorWrap.style.display).toBe('flex');
      expect(select.options.length).toBe(2);
      expect(select.options[0].value).toBe('1');
      expect(select.options[1].value).toBe('3');

      // Change selection
      select.value = '3';
      select.dispatchEvent(new Event('change'));

      // Click Start Calibration, verify targeted sysid
      document.getElementById('levelStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_level_calibration', sysid: 3 })
      );
    });

    it('should hide selector if only single vehicle is connected', () => {
      window.g_vehicles = [{ sysid: 10, type: 'Copter' }];
      triggerSocketMessage({
        type: 'vehicles_update'
      });

      expect(document.getElementById('levelDroneSelector').style.display).toBe('none');

      document.getElementById('levelStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_level_calibration', sysid: 10 })
      );
    });
  });

  describe('Level Start Sequence & Timeouts', () => {
    it('should start level calibration and trigger 15-second response timeouts', () => {
      window.g_vehicles = [];
      triggerSocketMessage({ type: 'vehicles_update' });
      window.selectedSysId = 12; // fallback active drone

      const startBtn = document.getElementById('levelStartBtn');
      const statusText = document.getElementById('levelStatus');
      const hint = document.getElementById('levelStepHint');

      startBtn.click();

      expect(startBtn.disabled).toBe(true);
      expect(statusText.textContent).toBe('STARTED');
      expect(hint.textContent).toContain('Sending command to drone...');

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_level_calibration', sysid: 12 })
      );

      // Advance timers by 14.9 seconds - should still be running
      jest.advanceTimersByTime(14900);
      expect(statusText.textContent).toBe('STARTED');

      // Advance past 15 seconds threshold
      jest.advanceTimersByTime(200);
      expect(statusText.textContent).toBe('FAILED');
      expect(document.getElementById('levelErrorText').textContent).toContain('Timeout waiting for drone');
    });
  });

  describe('WebSocket Result Messages', () => {
    it('should handle explicit done results and pop success modals', () => {
      const hint = document.getElementById('levelStepHint');
      const status = document.getElementById('levelStatus');
      const modal = document.getElementById('levelModal');

      // Send calibration_status
      triggerSocketMessage({
        type: 'calibration_status',
        sensor: 'level',
        message: 'Calibrating horizon...'
      });
      expect(hint.textContent).toBe('Calibrating horizon...');

      // Send successful done result
      triggerSocketMessage({
        type: 'calibration_result',
        sensor: 'level',
        step: 'done'
      });

      expect(status.textContent).toBe('DONE');
      expect(modal.classList.contains('show')).toBe(true);

      // Click OK inside modal, verify resets UI
      document.getElementById('levelModalOkBtn').click();
      expect(modal.classList.contains('show')).toBe(false);
      expect(status.textContent).toBe('NOT STARTED');
    });

    it('should handle failed result and display failure banner', () => {
      triggerSocketMessage({
        type: 'calibration_result',
        sensor: 'level',
        step: 'failed',
        message: 'Horizon slope too steep'
      });

      expect(document.getElementById('levelStatus').textContent).toBe('FAILED');
      expect(document.getElementById('levelErrorBanner').style.display).toBe('flex');
      expect(document.getElementById('levelErrorText').textContent).toBe('Horizon slope too steep');
    });
  });

  describe('Drone Console Stream Scraper', () => {
    it('should scrape console texts for successful calibration strings and complete leveling', () => {
      window.g_vehicles = [{ sysid: 7, type: 'Copter' }];
      triggerSocketMessage({
        type: 'vehicles_update'
      });

      // Click start
      document.getElementById('levelStartBtn').click();
      expect(document.getElementById('levelStatus').textContent).toBe('STARTED');

      // Send console message from a DIFFERENT drone - should be ignored
      triggerSocketMessage({
        type: 'drone_console',
        sysid: 9,
        text: 'Trim OK: Roll 0 Pitch 0'
      });
      expect(document.getElementById('levelStatus').textContent).toBe('STARTED');

      // Send console message from the ACTIVE drone
      triggerSocketMessage({
        type: 'drone_console',
        sysid: 7,
        text: 'Trim OK: level complete!'
      });

      expect(document.getElementById('levelStatus').textContent).toBe('DONE');
      expect(document.getElementById('levelModal').classList.contains('show')).toBe(true);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('🚁 Drone Levelled');
    });
  });
});