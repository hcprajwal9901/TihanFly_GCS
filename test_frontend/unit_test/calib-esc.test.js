describe('GCS ESC Calibration High-Fidelity Behavioral Test Suite (calib-esc.js)', () => {
  let mockSocket;

  beforeAll(() => {
    jest.useFakeTimers();

    // Define standard WebSocket static properties on the mock constructor
    if (global.WebSocket) {
      global.WebSocket.CONNECTING = 0;
      global.WebSocket.OPEN = 1;
      global.WebSocket.CLOSING = 2;
      global.WebSocket.CLOSED = 3;
    }

    // Mock global components
    window.SwUtil = {
      toast: jest.fn()
    };
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup host DOM node before loading script so autoInit mounts HTML successfully
    document.body.innerHTML = '<div id="panel-calib-esc"></div>';

    // Mock WebSocket with complete event handling
    mockSocket = {
      url: 'ws://mock-calib-esc',
      readyState: 1, // OPEN
      send: jest.fn(),
      onmessage: null
    };

    window.ws = mockSocket;
    window.socket = mockSocket;
    window.gcsSocket = mockSocket;

    // Load script in global JSDOM context (will autoInit and hook ws)
    global.loadScript('js/calib-esc.js');
  });

  function triggerSocketMessage(data) {
    if (typeof mockSocket.onmessage === 'function') {
      mockSocket.onmessage({ data: JSON.stringify(data) });
    }
  }

  describe('Layout Injection and WebSocket Hooking', () => {
    it('should inject correct HTML templates and setup WebSocket onmessage hook automatically', () => {
      expect(document.querySelector('.mp-esc-title-text').textContent).toBe('ESC Calibration');
      expect(document.getElementById('escStatusMsg').textContent).toBe('Ready');
      expect(document.getElementById('escStepTrack').style.display).toBe('none');

      // Verify protocol dropdown is populated
      const select = document.getElementById('escType');
      expect(select.options.length).toBe(7);
      expect(select.options[0].text).toBe('Normal');
      expect(select.options[6].text).toBe('DShot600');

      // Verify ws onmessage was hooked
      expect(typeof mockSocket.onmessage).toBe('function');
    });
  });

  describe('Start / Cancel ESC Calibration Sequence', () => {
    it('should start sequence, send websocket payload with correct sysid, and allow cancelling', () => {
      // 1. Send status vehicle list to cache target sysid
      triggerSocketMessage({
        type: 'status',
        vehicles: [{ sysid: 4, link_id: 1 }]
      });

      const calibBtn = document.getElementById('escCalibrateBtn');
      const cancelBtn = document.getElementById('escCancelBtn');

      expect(calibBtn.disabled).toBe(false);
      expect(cancelBtn.style.display).toBe('none');

      // Click Calibrate
      calibBtn.click();

      // Verify buttons transition
      expect(calibBtn.disabled).toBe(true);
      expect(calibBtn.textContent).toContain('Calibrating…');
      expect(cancelBtn.style.display).toBe('inline-flex');
      expect(document.getElementById('escStepTrack').style.display).toBe('flex');
      expect(document.getElementById('escStatusMsg').textContent).toContain('Starting ESC calibration');

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_esc_calibration', sysid: 4 })
      );

      // Click Cancel
      mockSocket.send.mockClear();
      cancelBtn.click();

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'cancel_esc_calibration', sysid: 4 })
      );
    });
  });

  describe('Stepper Dot Transitions & Power Cycle Toasts', () => {
    it('should transition dot active classes and trigger toasts on stages', () => {
      const statusText = document.getElementById('escStatusMsg');
      const stepPreflight = document.getElementById('step-preflight');
      const stepSafetyBtn = document.getElementById('step-safety_btn');

      // 1. Stage preflight (Writing calibration flag)
      triggerSocketMessage({
        type: 'esc_calibration_status',
        stage: 'preflight',
        message: 'Writing flag',
        busy: true
      });

      expect(statusText.textContent).toContain('Writing Calibration Flag');
      expect(stepPreflight.classList.contains('active')).toBe(true);
      expect(stepSafetyBtn.classList.contains('active')).toBe(false);

      // 2. Stage power_cycle (Disconnect drone battery)
      triggerSocketMessage({
        type: 'esc_calibration_status',
        stage: 'power_cycle',
        message: 'Disconnect / Reconnect battery',
        busy: true
      });

      expect(statusText.textContent).toContain('Power Cycle Required');
      expect(stepPreflight.classList.contains('done')).toBe(true);
      expect(stepSafetyBtn.classList.contains('active')).toBe(true);

      // Verify battery cycle warning toast
      expect(window.SwUtil.toast).toHaveBeenCalledWith(
        '✓ Flag written — disconnect battery, reconnect, then press safety button'
      );

      // 3. Stage done
      triggerSocketMessage({
        type: 'esc_calibration_status',
        stage: 'done',
        message: 'FC Rebooting',
        busy: false
      });

      expect(document.getElementById('escStepTrack').style.display).toBe('flex'); // track remains visible on done
      expect(document.getElementById('escCalibrateBtn').disabled).toBe(false); // restored start state
    });

    it('should transition status bar to failed states on sequence failures', () => {
      const statusBar = document.getElementById('escStatusBar');

      triggerSocketMessage({
        type: 'esc_calibration_status',
        stage: 'error',
        message: 'Command rejected',
        busy: false
      });

      expect(statusBar.classList.contains('failed')).toBe(true);
      expect(window.SwUtil.toast).toHaveBeenCalledWith(
        'ESC calibration error: Command rejected'
      );
    });
  });
});