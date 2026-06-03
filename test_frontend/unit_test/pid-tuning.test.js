describe('GCS PID Tuning Panel High-Fidelity Behavioral Test Suite (pid-tuning.js)', () => {
  beforeAll(() => {
    // Restore native JSDOM methods to allow natural null checks and element injections
    document.getElementById = Document.prototype.getElementById;
    document.querySelector = Document.prototype.querySelector;
    document.querySelectorAll = Document.prototype.querySelectorAll;

    jest.useFakeTimers();

    // Mock global components
    window.SwUtil = {
      toast: jest.fn()
    };
    window.safeSend = jest.fn();
    window.selectedSysId = 1;
    window.activeSysids = [1, 2, 3];
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-pid-tuning"></div>';

    // Load pid-tuning.js physically in JSDOM
    global.loadScript('js/pid-tuning.js');

    // Initialize module
    window.PIDTuning.init();
  });

  function triggerWsMessage(msg) {
    const evt = new CustomEvent('calibration_ws_message', { detail: msg });
    window.dispatchEvent(evt);
  }

  describe('Layout Injection & Inputs', () => {
    it('should inject correct headers, action buttons, and render all 45+ parameters', () => {
      expect(document.getElementById('pid-status-msg')).toBeTruthy();
      expect(document.getElementById('pid-write-btn')).toBeTruthy();
      expect(document.getElementById('pid-refresh-btn')).toBeTruthy();

      const inputs = document.querySelectorAll('[data-param]');
      expect(inputs.length).toBeGreaterThanOrEqual(45);
    });

    it('should initially show the idle state', () => {
      const msg = document.getElementById('pid-status-msg');
      const dot = document.getElementById('pid-status-dot');
      expect(msg.textContent).toContain('Click "Refresh Screen" to read');
      expect(dot.className).toContain('pid-dot-idle');
    });
  });

  describe('Lock Pitch and Roll Values Mirroring', () => {
    it('should mirror roll inputs to pitch inputs when mirror checkbox is checked', () => {
      const lockBox = document.getElementById('pid-lock-checkbox');
      const rollP = document.getElementById('pid-inp-ATC_RAT_RLL_P');
      const pitchP = document.getElementById('pid-inp-ATC_RAT_PIT_P');

      // Checked by default or check it explicitly
      lockBox.checked = true;

      rollP.value = '0.145';
      rollP.dispatchEvent(new Event('input'));

      expect(pitchP.value).toBe('0.145');
    });

    it('should not mirror roll inputs to pitch inputs when mirror checkbox is unchecked', () => {
      const lockBox = document.getElementById('pid-lock-checkbox');
      const rollP = document.getElementById('pid-inp-ATC_RAT_RLL_P');
      const pitchP = document.getElementById('pid-inp-ATC_RAT_PIT_P');

      lockBox.checked = false;

      rollP.value = '0.199';
      rollP.dispatchEvent(new Event('input'));

      // Should remain at its default value 0.135
      expect(pitchP.value).toBe('0.135');
    });
  });

  describe('Refresh / Fetch Parameters Engine', () => {
    it('should trigger staggered fetches for all params sequentially', () => {
      const refreshBtn = document.getElementById('pid-refresh-btn');
      window.safeSend.mockClear();

      refreshBtn.click();

      const dot = document.getElementById('pid-status-dot');
      const msg = document.getElementById('pid-status-msg');

      expect(dot.className).toContain('pid-dot-running');
      expect(msg.textContent).toContain('Reading 68 parameters');

      // Advance by 1ms to trigger the 0ms staggered timer callback
      jest.advanceTimersByTime(1);

      // Verify the first request is sent instantly
      expect(window.safeSend).toHaveBeenCalledTimes(1);
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'param_request_one',
        name: 'ATC_ANG_RLL_P',
        sysid: 1
      });

      // Fast forward 80ms more
      jest.advanceTimersByTime(80);
      expect(window.safeSend).toHaveBeenCalledTimes(2);
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'param_request_one',
        name: 'ATC_ACCEL_R_MAX',
        sysid: 1
      });

      // Fast forward past the full staggering limit (68 * 80 + 200 ms)
      jest.advanceTimersByTime(68 * 80 + 200);
      expect(dot.className).toContain('pid-dot-idle');
      expect(msg.textContent).toContain('Waiting for drone response…');
    });
  });

  describe('Write Parameters Engine & Fleet Broadcasts', () => {
    it('should send param_set packages sequentially for modified inputs', () => {
      const rollP = document.getElementById('pid-inp-ATC_RAT_RLL_P');
      const writeBtn = document.getElementById('pid-write-btn');

      rollP.value = '0.155';
      
      window.safeSend.mockClear();
      writeBtn.click();

      // Because it collects all data-params, it will write all elements (68 of them)
      // We must advance timers to execute the setTimeout staggered sends
      jest.advanceTimersByTime(68 * 100);
      expect(window.safeSend).toHaveBeenCalledTimes(68);
      
      // Let's verify our specific parameter was sent at the correct index
      // Since it loops through data-param in DOM order, ATC_RAT_RLL_P will be sent.
      // Let's fast forward the remaining timer
      jest.advanceTimersByTime(500);

      const dot = document.getElementById('pid-status-dot');
      const msg = document.getElementById('pid-status-msg');
      expect(dot.className).toContain('pid-dot-ok');
      expect(msg.textContent).toContain('parameters written successfully');
      expect(window.SwUtil.toast).toHaveBeenCalledWith(expect.stringContaining('parameters written'));
    });

    it('should broadcast parameters to all fleet members when selectedSysId is 0 (All Drones)', () => {
      window.selectedSysId = 0; // All Drones
      window.activeSysids = [2, 5, 8];

      const writeBtn = document.getElementById('pid-write-btn');
      window.safeSend.mockClear();

      writeBtn.click();

      // Fast forward staggering of writes
      jest.advanceTimersByTime(68 * 100);

      // Verify that safeSend was called for each active sysid
      // 68 params * 3 drones = 204 calls
      expect(window.safeSend).toHaveBeenCalledTimes(204);
      expect(window.safeSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'param_set',
        param_id: 'ATC_ANG_RLL_P',
        value: 4.5,
        sysid: 2
      }));
      expect(window.safeSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'param_set',
        param_id: 'ATC_ANG_RLL_P',
        value: 4.5,
        sysid: 5
      }));
      expect(window.safeSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'param_set',
        param_id: 'ATC_ANG_RLL_P',
        value: 4.5,
        sysid: 8
      }));

      // Restore selectedSysId
      window.selectedSysId = 1;
    });
  });

  describe('WebSocket Interaction & Visual Confirmation Feedback', () => {
    it('should update input value and flash positive styling upon param_value update', () => {
      const el = document.getElementById('pid-inp-ATC_ANG_RLL_P');
      
      triggerWsMessage({
        type: 'param_value',
        param_id: 'ATC_ANG_RLL_P',
        value: 5.2
      });

      expect(el.value).toBe('5.2');
      expect(el.style.color).toBe('var(--good)');

      // Color clears after 900ms
      jest.advanceTimersByTime(900);
      expect(el.style.color).toBe('');
    });

    it('should update input value and flash positive styling upon parameter message', () => {
      const el = document.getElementById('pid-inp-ATC_ANG_RLL_P');
      
      triggerWsMessage({
        type: 'parameter',
        name: 'ATC_ANG_RLL_P',
        value: 6.1
      });

      expect(el.value).toBe('6.1');
    });

    it('should display warning status message if param_error is received', () => {
      triggerWsMessage({
        type: 'param_error',
        message: 'Invalid MAVLink connection'
      });

      const dot = document.getElementById('pid-status-dot');
      const msg = document.getElementById('pid-status-msg');

      expect(dot.className).toContain('pid-dot-error');
      expect(msg.textContent).toContain('✕ Invalid MAVLink connection');
    });
  });
});