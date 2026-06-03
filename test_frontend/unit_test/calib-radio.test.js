describe('GCS Radio Calibration High-Fidelity Behavioral Test Suite (calib-radio.js)', () => {
  let mockSocket;
  let wsListeners = [];
  let customEventListeners = {};
  let pendingTimers = [];

  beforeAll(() => {
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
      toast: jest.fn()
    };

    // Mock global and window setTimeout and clearTimeout manually to avoid JSDOM VM fake timer bugs
    global.setTimeout = window.setTimeout = (callback, delay) => {
      const timer = { callback, delay };
      pendingTimers.push(timer);
      return timer;
    };
    global.clearTimeout = window.clearTimeout = (timer) => {
      const idx = pendingTimers.indexOf(timer);
      if (idx !== -1) {
        pendingTimers.splice(idx, 1);
      }
    };

    // Keep track of custom event listeners
    const originalAddEventListener = window.addEventListener.bind(window);
    window.addEventListener = jest.fn((event, cb, options) => {
      if (!customEventListeners[event]) {
        customEventListeners[event] = [];
      }
      customEventListeners[event].push(cb);
      originalAddEventListener(event, cb, options);
    });
  });

  afterAll(() => {
    // Restore original timers if needed, but not strictly required
  });

  beforeEach(() => {
    jest.clearAllMocks();
    wsListeners = [];
    customEventListeners = {};
    pendingTimers = [];

    delete window.getActiveSysid;
    delete window.activeSysid;
    delete window._calibRadioFallbackTimer;

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-calib-radio" style="display: flex;"></div>';

    // Mock WebSocket with complete event handling
    mockSocket = {
      url: 'ws://mock-calib-radio',
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
    window.gcsSocket = mockSocket;

    // Load script physically in JSDOM to ensure clean state per test
    global.loadScript('js/calib-radio.js');

    // Initialize module
    window.CalibRadio.init(mockSocket);
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

  function triggerCustomEvent(eventName, data) {
    const listeners = customEventListeners[eventName] || [];
    const event = { detail: data, data: JSON.stringify(data) };
    listeners.forEach(cb => {
      try {
        cb(event);
      } catch (err) {
        // Suppress errors during dispatch
      }
    });
  }

  function advanceManualTimers(time) {
    const expired = [];
    pendingTimers = pendingTimers.filter(t => {
      t.delay -= time;
      if (t.delay <= 0) {
        expired.push(t.callback);
        return false;
      }
      return true;
    });
    expired.forEach(cb => {
      try {
        cb();
      } catch (err) {
        // Suppress errors during dispatch
      }
    });
  }

  describe('Layout Injection & Styling', () => {
    it('should inject correct HTML templates and setup layout structural nodes', () => {
      expect(document.getElementById('radioStartBtn')).toBeTruthy();
      expect(document.getElementById('radio-status-bar')).toBeTruthy();
      expect(document.getElementById('hbar-fill-roll')).toBeTruthy();
      expect(document.getElementById('stick-fill-pitch')).toBeTruthy();
      expect(document.getElementById('stick-fill-throttle')).toBeTruthy();
      expect(document.getElementById('hbar-fill-yaw')).toBeTruthy();

      // Check range elements (e.g. min/max/val indicators)
      expect(document.getElementById('hbar-min-roll')).toBeTruthy();
      expect(document.getElementById('hbar-max-roll')).toBeTruthy();
      expect(document.getElementById('hbar-val-roll').textContent).toBe('1500');

      // Check auxiliary boxes
      for (let ch = 5; ch <= 14; ch++) {
        expect(document.getElementById(`rbox-${ch}`)).toBeTruthy();
        expect(document.getElementById(`rbar-${ch}`)).toBeTruthy();
      }
    });
  });

  describe('Active Drone Sysid Resolution', () => {
    it('should fallback to 1 as default sysid', () => {
      document.getElementById('radioStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_radio_calibration', sysid: 1 })
      );
    });

    it('should resolve sysid from window.activeSysid', () => {
      window.activeSysid = 42;
      document.getElementById('radioStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_radio_calibration', sysid: 42 })
      );
    });

    it('should resolve sysid from window.getActiveSysid()', () => {
      window.getActiveSysid = jest.fn(() => 7);
      document.getElementById('radioStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_radio_calibration', sysid: 7 })
      );
    });

    it('should resolve sysid from broadcasted vehicles list', () => {
      triggerSocketMessage({
        type: 'status',
        vehicles: [{ sysid: 17, type: 'Copter' }]
      });

      document.getElementById('radioStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_radio_calibration', sysid: 17 })
      );
    });
  });

  describe('Calibration Start Sequence & Signal Bounds', () => {
    it('should trigger start state when calibrate button is clicked', () => {
      const btn = document.getElementById('radioStartBtn');
      const status = document.getElementById('radio-status-bar');

      btn.click();

      expect(btn.textContent).toBe('Complete');
      expect(btn.classList.contains('running')).toBe(true);
      expect(status.style.display).toBe('block');
      expect(status.textContent).toContain('Move all sticks and switches to their full extents');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Move all sticks and switches to full extents');

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_radio_calibration', sysid: 1 })
      );
    });
  });

  describe('Live RC Channels Updates & Min/Max Bound Tracking', () => {
    beforeEach(() => {
      document.getElementById('radioStartBtn').click();
    });

    it('should update horizontal scrollbar indicators (hbar) on roll channels', () => {
      triggerSocketMessage({
        type: 'rc_channels',
        channels: [
          { channel: 1, raw: 1200 }
        ]
      });

      expect(document.getElementById('hbar-val-roll').textContent).toBe('1200');
      expect(document.getElementById('hbar-fill-roll').style.width).toBe('20%');

      // Check min/max tracking positions
      expect(document.getElementById('hbar-min-roll').style.left).toBe('20%');
      expect(document.getElementById('hbar-max-roll').style.left).toBe('20%');

      // Move roll channels higher to check max moves but min stays at 20%
      triggerSocketMessage({
        type: 'rc_channels',
        channels: [
          { channel: 1, raw: 1800 }
        ]
      });

      expect(document.getElementById('hbar-val-roll').textContent).toBe('1800');
      expect(document.getElementById('hbar-fill-roll').style.width).toBe('80%');
      expect(document.getElementById('hbar-min-roll').style.left).toBe('20%');
      expect(document.getElementById('hbar-max-roll').style.left).toBe('80%');
    });

    it('should update vertical sticks indicators (vstick) on pitch and throttle channels', () => {
      triggerSocketMessage({
        type: 'rc_channels',
        channels: [
          { channel: 2, raw: 1100 }, // pitch
          { channel: 3, raw: 1900 }  // throttle
        ]
      });

      expect(document.getElementById('stick-val-pitch').textContent).toBe('1100');
      expect(document.getElementById('stick-fill-pitch').style.height).toBe('10%');
      expect(document.getElementById('stick-min-pitch').style.bottom).toBe('10%');
      expect(document.getElementById('stick-max-pitch').style.bottom).toBe('10%');

      expect(document.getElementById('stick-val-throttle').textContent).toBe('1900');
      expect(document.getElementById('stick-fill-throttle').style.height).toBe('90%');
      expect(document.getElementById('stick-min-throttle').style.bottom).toBe('90%');
      expect(document.getElementById('stick-max-throttle').style.bottom).toBe('90%');
    });

    it('should update auxiliary radio box grid on channels 5-14', () => {
      triggerSocketMessage({
        type: 'rc_channels',
        channels: [
          { channel: 5, raw: 1000 },
          { channel: 14, raw: 2000 }
        ]
      });

      expect(document.getElementById('rval-5').textContent).toBe('1000');
      expect(document.getElementById('rbar-5').style.width).toBe('0%');
      expect(document.getElementById('rbar-min-5').style.left).toBe('0%');
      expect(document.getElementById('rbar-max-5').style.left).toBe('0%');

      expect(document.getElementById('rval-14').textContent).toBe('2000');
      expect(document.getElementById('rbar-14').style.width).toBe('100%');
      expect(document.getElementById('rbar-min-14').style.left).toBe('100%');
      expect(document.getElementById('rbar-max-14').style.left).toBe('100%');
    });

    it('should support dispatching updates via custom window events', () => {
      triggerCustomEvent('gcs-ws-message', {
        type: 'rc_channels',
        channels: [{ channel: 4, raw: 1500 }] // yaw
      });

      expect(document.getElementById('hbar-val-yaw').textContent).toBe('1500');
      expect(document.getElementById('hbar-fill-yaw').style.width).toBe('50%');
    });
  });

  describe('Completing Calibration Sequence', () => {
    beforeEach(() => {
      // Start it first
      document.getElementById('radioStartBtn').click();
    });

    it('should send completion command and trigger 2-second fallback timer', () => {
      const btn = document.getElementById('radioStartBtn');

      // Set some live channel values in the DOM
      triggerSocketMessage({
        type: 'rc_channels',
        channels: [
          { channel: 1, raw: 1100 },
          { channel: 2, raw: 1900 }
        ]
      });

      btn.click(); // clicks Complete

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'complete_radio_calibration', sysid: 1 })
      );

      // Verify layout is reset
      expect(btn.textContent).toBe('Calibrate Radio');
      expect(btn.classList.contains('running')).toBe(false);

      // Fast-forward 2 seconds to trigger fallback popup if no response comes
      advanceManualTimers(2000);

      const overlay = document.getElementById('mp-calib-popup-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay.textContent).toContain('Here are the detected radio options');
      // Verifies it scraped live channel values
      expect(overlay.textContent).toContain('CH1');
      expect(overlay.textContent).toContain('1100');
    });
  });

  describe('Status Bar Messages & Success Toasts', () => {
    it('should display status messages and fire toasts', () => {
      const status = document.getElementById('radio-status-bar');

      triggerSocketMessage({
        type: 'radio_calibration_status',
        message: 'PreArm: RC calibrating',
        success: false
      });
      expect(status.style.display).toBe('block');
      expect(status.textContent).toBe('PreArm: RC calibrating');
      expect(window.SwUtil.toast).not.toHaveBeenCalled();

      triggerSocketMessage({
        type: 'radio_calibration_status',
        message: 'Radio parameters verified!',
        success: true
      });
      expect(status.textContent).toBe('Radio parameters verified!');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Radio parameters verified!');
    });
  });

  describe('Complete Calibration Result Messages', () => {
    it('should handle successful complete message, update indicators and show popup', () => {
      document.getElementById('radioStartBtn').click(); // Starts it
      document.getElementById('radioStartBtn').click(); // Completes it (starts fallback timer)

      triggerSocketMessage({
        type: 'radio_calibration_complete',
        success: true,
        channels: [
          { channel: 1, min: 1100, max: 1900, trim: 1500, moved: true },
          { channel: 2, min: 1050, max: 1950, trim: 1480, moved: true },
          { channel: 5, min: 1500, max: 1500, trim: 1500, moved: false }
        ]
      });

      // Check fallback timer is cleared (advancing shouldn't spawn a second popup)
      advanceManualTimers(2000);

      const overlay = document.getElementById('mp-calib-popup-overlay');
      expect(overlay).toBeTruthy();
      expect(document.getElementById('radio-status-bar').textContent).toContain('Radio calibration successful!');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Radio calibration complete');

      // Verify final trim values were updated on UI elements
      expect(document.getElementById('hbar-val-roll').textContent).toBe('1500');
      expect(document.getElementById('stick-val-pitch').textContent).toBe('1480');

      // Verify the list rows in the popup
      expect(overlay.textContent).toContain('CH1');
      expect(overlay.textContent).toContain('1100 | 1900');
      expect(overlay.textContent).toContain('1050 | 1950');
      expect(overlay.textContent).toContain('(not moved)'); // channel 5 wasn't moved

      // Dismiss popup
      document.getElementById('mp-popup-ok-btn').click();
      advanceManualTimers(200); // fade out
      expect(document.body.querySelector('#mp-calib-popup-overlay')).toBeNull();
    });

    it('should handle failed complete message, update status and show popup', () => {
      document.getElementById('radioStartBtn').click();
      document.getElementById('radioStartBtn').click();

      triggerSocketMessage({
        type: 'radio_calibration_complete',
        success: false,
        channels: [
          { channel: 1, min: 1490, max: 1510, trim: 1500, moved: false }
        ]
      });

      const overlay = document.getElementById('mp-calib-popup-overlay');
      expect(overlay).toBeTruthy();
      expect(document.getElementById('radio-status-bar').textContent).toContain('Radio calibration failed');

      // Dismiss popup by clicking "✕" close button
      document.getElementById('mp-popup-close-x').click();
      advanceManualTimers(200);
      expect(document.body.querySelector('#mp-calib-popup-overlay')).toBeNull();
    });

    it('should dismiss popup if clicking overlay background', () => {
      document.getElementById('radioStartBtn').click();
      document.getElementById('radioStartBtn').click();

      triggerSocketMessage({
        type: 'radio_calibration_complete',
        success: true,
        channels: []
      });

      const overlay = document.getElementById('mp-calib-popup-overlay');
      expect(overlay).toBeTruthy();

      // Click background overlay
      const clickEvent = new Event('click');
      Object.defineProperty(clickEvent, 'target', { value: overlay, enumerable: true });
      overlay.dispatchEvent(clickEvent);

      advanceManualTimers(200);
      expect(document.body.querySelector('#mp-calib-popup-overlay')).toBeNull();
    });
  });
});