describe('GCS Motor Test Panel High-Fidelity Behavioral Test Suite (motor-test.js)', () => {
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
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-motor-test"></div>';

    // Load motor-test.js physically in JSDOM
    global.loadScript('js/motor-test.js');

    // Initialize module
    window.MotorTest.init();
  });

  function triggerWsMessage(msg) {
    const evt = new CustomEvent('calibration_ws_message', { detail: msg });
    window.dispatchEvent(evt);
  }

  describe('Layout Injection & Security Initial State', () => {
    it('should inject layout nodes, render 8 motors, and enforce initial locked safety state', () => {
      expect(document.getElementById('mt-lock')).toBeTruthy();
      expect(document.getElementById('mt-content').classList.contains('mt-locked')).toBe(true);

      const motorButtons = document.querySelectorAll('.mt-motor-btn');
      expect(motorButtons.length).toBe(8);

      // Verify all buttons are disabled initially
      motorButtons.forEach(btn => {
        expect(btn.disabled).toBe(true);
      });
      expect(document.getElementById('mt-btn-all').disabled).toBe(true);

      expect(document.getElementById('mt-status-msg').textContent).toContain('Acknowledge safety warning to enable testing');
    });
  });

  describe('Safety Unlock & Slider Adjustments', () => {
    it('should unlock controls and enable buttons upon safety warning acknowledgement', () => {
      const ackBtn = document.getElementById('mt-ack-btn');
      const lockOverlay = document.getElementById('mt-lock');
      const content = document.getElementById('mt-content');

      ackBtn.click();

      expect(lockOverlay.style.display).toBe('none');
      expect(content.classList.contains('mt-locked')).toBe(false);

      // Verify all buttons are enabled
      document.querySelectorAll('.mt-motor-btn').forEach(btn => {
        expect(btn.disabled).toBe(false);
      });
      expect(document.getElementById('mt-btn-all').disabled).toBe(false);
      expect(document.getElementById('mt-status-msg').textContent).toContain('Ready — select a motor or test all');
    });

    it('should update slider fill track and numeric value on throttle changes', () => {
      document.getElementById('mt-ack-btn').click();

      const slider = document.getElementById('mt-throttle');
      const valEl = document.getElementById('mt-throttle-val');

      // Emulate changing throttle value to 25%
      slider.value = 25;
      slider.dispatchEvent(new Event('input'));

      expect(slider.style.getPropertyValue('--slider-pct')).toBe('25%');
      expect(valEl.textContent).toBe('25%');
    });
  });

  describe('Motor Triggers, Auto-Stop Timers, and Acknowledgements', () => {
    beforeEach(() => {
      // Unlock panel
      document.getElementById('mt-ack-btn').click();
    });

    it('should dispatch correct WebSocket command when individual motor is clicked and handle auto-stop highlights', () => {
      const motorBtn = document.getElementById('mt-motor-3');
      const statusMsg = document.getElementById('mt-status-msg');

      // Click motor 3
      motorBtn.click();

      // MAV_CMD_DO_MOTOR_TEST sent via window.safeSend
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'motor_test',
        motor_index: 3,
        throttle_pct: 15, // default
        duration_sec: 2   // default
      });

      expect(statusMsg.textContent).toContain('▶ Motor 3 testing at 15% for 2s');
      expect(motorBtn.classList.contains('mt-running')).toBe(true);

      // Other buttons should not be highlighted
      expect(document.getElementById('mt-motor-1').classList.contains('mt-running')).toBe(false);

      // Fast-forward past duration (2s + 0.4s buffer = 2400ms)
      jest.advanceTimersByTime(2390);
      expect(motorBtn.classList.contains('mt-running')).toBe(true);

      jest.advanceTimersByTime(20); // 2410ms total
      expect(motorBtn.classList.contains('mt-running')).toBe(false);
      expect(statusMsg.textContent).toContain('✓ Test complete');
    });

    it('should support testing all motors simultaneously', () => {
      const btnAll = document.getElementById('swWriteBtn') || document.getElementById('mt-btn-all');
      btnAll.click();

      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'motor_test',
        motor_index: 0,
        throttle_pct: 15,
        duration_sec: 2
      });

      // Verify all motor buttons highlight
      document.querySelectorAll('.mt-motor-btn').forEach(btn => {
        expect(btn.classList.contains('mt-running')).toBe(true);
      });
    });

    it('should immediately stop all motors and cancel timers on click Stop', () => {
      const motorBtn = document.getElementById('mt-motor-5');
      motorBtn.click();

      expect(motorBtn.classList.contains('mt-running')).toBe(true);

      const stopBtn = document.getElementById('mt-btn-stop');
      stopBtn.click();

      // Sends 0% throttle to index 0 to stop
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'motor_test',
        motor_index: 0,
        throttle_pct: 0,
        duration_sec: 0
      });

      expect(motorBtn.classList.contains('mt-running')).toBe(false);
      expect(document.getElementById('mt-status-msg').textContent).toBe('Stopped.');
    });

    it('should handle motor_test_ack errors and flash toasts', () => {
      const motorBtn = document.getElementById('mt-motor-1');
      motorBtn.click();

      // Send error acknowledgment from backend
      triggerWsMessage({
        type: 'motor_test_ack',
        motor_index: 1,
        status: 'error',
        message: 'Autopilot armed — motors locked!'
      });

      // UI should clear highlights instantly
      expect(motorBtn.classList.contains('mt-running')).toBe(false);
      expect(document.getElementById('mt-status-msg').textContent).toContain('✕ Autopilot armed — motors locked!');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Motor test: Autopilot armed — motors locked!', true);
    });
  });
});