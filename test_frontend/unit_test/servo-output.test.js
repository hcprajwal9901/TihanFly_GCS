describe('GCS Servo Output Panel High-Fidelity Behavioral Test Suite (servo-output.js)', () => {
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
    document.body.innerHTML = '<div id="panel-servo-output"></div>';

    // Load servo-output.js physically in JSDOM
    global.loadScript('js/servo-output.js');

    // Initialize module
    window.ServoOutput.init();
  });

  function triggerWsMessage(msg) {
    const evt = new CustomEvent('calibration_ws_message', { detail: msg });
    window.dispatchEvent(evt);
  }

  describe('Layout Injection & Initial State', () => {
    it('should inject correct table headers and 16 rows', () => {
      expect(document.getElementById('so-tbody')).toBeTruthy();
      const rows = document.querySelectorAll('.so-row');
      expect(rows.length).toBe(16);

      const tableHeaders = document.querySelectorAll('.so-th');
      const headersText = Array.from(tableHeaders).map(th => th.textContent.trim());
      expect(headersText).toEqual(['#', 'Position', 'Reverse', 'Function', 'Min', 'Trim', 'Max']);
    });

    it('should initially show not connected badge', () => {
      const connBadge = document.getElementById('so-conn-badge');
      expect(connBadge.textContent).toBe('Not connected');
      expect(connBadge.className).toContain('fs-badge-idle');
    });

    it('should trigger staggered refresh automatic fetch shortly after init', () => {
      // Upon init, refreshParams is called after 200ms
      expect(window.safeSend).not.toHaveBeenCalled();

      // Fast forward 200ms to trigger refreshParams, plus 1ms to allow the 0ms staggered timer to fire
      jest.advanceTimersByTime(201);

      const connBadge = document.getElementById('so-conn-badge');
      expect(connBadge.textContent).toContain('Fetching from FC…');
      expect(connBadge.className).toContain('fs-badge-loading');

      // The requests are staggered 40ms apart.
      // Total requests: 16 channels * 5 params = 80 requests.
      // Let's verify we send the first one at index 0 (0ms after refreshParams call)
      expect(window.safeSend).toHaveBeenCalledTimes(1);
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'param_request_one',
        name: 'SERVO1_FUNCTION'
      });

      // Fast forward 40ms more to let the next request fire
      jest.advanceTimersByTime(40);
      expect(window.safeSend).toHaveBeenCalledTimes(2);
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'param_request_one',
        name: 'SERVO2_FUNCTION'
      });
    });
  });

  describe('Param Value Echoes & UI Refresh', () => {
    beforeEach(() => {
      // Advance past the initial auto-fetch timer
      jest.advanceTimersByTime(200);
      window.safeSend.mockClear();
    });

    it('should update dropdowns, checkboxes, min/trim/max input numbers, and row LEDs upon receiving param_value updates', () => {
      // Simulate receiving FUNCTION parameter for Channel 3 (e.g. value 33 = Motor 1)
      triggerWsMessage({
        type: 'param_value',
        param_id: 'SERVO3_FUNCTION',
        value: 33
      });

      const fnSel3 = document.getElementById('so-fn-3');
      expect(fnSel3.value).toBe('33');

      const led3 = document.getElementById('so-led-3');
      expect(led3.classList.contains('so-led-active')).toBe(true);
      expect(led3.classList.contains('so-led-motor')).toBe(true);

      // Simulate REVERSED parameter
      triggerWsMessage({
        type: 'param_value',
        param_id: 'SERVO3_REVERSED',
        value: 1
      });
      const revCk3 = document.getElementById('so-rev-3');
      expect(revCk3.checked).toBe(true);

      // Simulate MIN, TRIM, MAX limits
      triggerWsMessage({
        type: 'param_value',
        param_id: 'SERVO3_MIN',
        value: 1050
      });
      triggerWsMessage({
        type: 'param_value',
        param_id: 'SERVO3_TRIM',
        value: 1520
      });
      triggerWsMessage({
        type: 'param_value',
        param_id: 'SERVO3_MAX',
        value: 1950
      });

      expect(document.getElementById('so-min-3').value).toBe('1050');
      expect(document.getElementById('so-trim-3').value).toBe('1520');
      expect(document.getElementById('so-max-3').value).toBe('1950');

      // Verify that all 5 values for Channel 3 triggers a check for fully loaded status
      // 16 channels * 5 parameters = 80 total. Let's send all of them to trigger Synced badge.
      for (let n = 1; n <= 16; n++) {
        const suffixList = ['FUNCTION', 'REVERSED', 'MIN', 'TRIM', 'MAX'];
        suffixList.forEach(suffix => {
          triggerWsMessage({
            type: 'param_value',
            param_id: `SERVO${n}_${suffix}`,
            value: suffix === 'FUNCTION' ? 0 : suffix === 'MIN' ? 1000 : suffix === 'MAX' ? 2000 : 1500
          });
        });
      }

      const connBadge = document.getElementById('so-conn-badge');
      expect(connBadge.textContent).toBe('✓ Synced with FC');
      expect(connBadge.className).toContain('fs-badge-ok');
    });
  });

  describe('Live Telemetry Position Tracking & Bar Scaling', () => {
    it('should scale live output positions dynamically relative to channel min/max thresholds', () => {
      // Configure Channel 5 values via param_value
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO5_MIN', value: 1000 });
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO5_MAX', value: 2000 });
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO5_TRIM', value: 1500 });

      // Receive live telemetry data for servo channel 5
      triggerWsMessage({
        type: 'servo_output_raw',
        ch5: 1250 // exactly 25% of range 1000-2000
      });

      const fillBar5 = document.getElementById('so-pos-fill-5');
      const label5 = document.getElementById('so-pos-lbl-5');

      // JSDOM normalizes the percentage decimal value
      expect(fillBar5.style.width).toBe('25%');
      expect(label5.textContent).toBe('1250 µs');

      // Test bounds clipping
      triggerWsMessage({
        type: 'servo_output_raw',
        ch5: 2200 // above max, should cap at 100%
      });
      expect(fillBar5.style.width).toBe('100%');

      triggerWsMessage({
        type: 'servo_output_raw',
        ch5: 800 // below min, should floor at 0%
      });
      expect(fillBar5.style.width).toBe('0%');
    });
  });

  describe('Unsaved Changes Flagging & Write to FC', () => {
    beforeEach(() => {
      // Simulate loading channel 8 parameters first
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO8_FUNCTION', value: 0 });
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO8_REVERSED', value: 0 });
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO8_MIN', value: 1100 });
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO8_TRIM', value: 1500 });
      triggerWsMessage({ type: 'param_value', param_id: 'SERVO8_MAX', value: 1900 });
    });

    it('should flag channel row as pending changes when dropdown select changes', () => {
      const fnSel8 = document.getElementById('so-fn-8');
      const row8 = document.getElementById('so-row-8');

      expect(row8.classList.contains('so-row-pending')).toBe(false);

      // Change function to 27 (Throttle)
      fnSel8.value = '27';
      fnSel8.dispatchEvent(new Event('change'));

      expect(row8.classList.contains('so-row-pending')).toBe(true);
      expect(row8.classList.contains('so-row-saved')).toBe(false);
    });

    it('should flag channel row as pending changes when checkbox toggle changes', () => {
      const revCk8 = document.getElementById('so-rev-8');
      const row8 = document.getElementById('so-row-8');

      expect(row8.classList.contains('so-row-pending')).toBe(false);

      revCk8.checked = true;
      revCk8.dispatchEvent(new Event('change'));

      expect(row8.classList.contains('so-row-pending')).toBe(true);
    });

    it('should flag channel row as pending changes when min/trim/max inputs change', () => {
      const minInp8 = document.getElementById('so-min-8');
      const row8 = document.getElementById('so-row-8');

      expect(row8.classList.contains('so-row-pending')).toBe(false);

      minInp8.value = '1080';
      minInp8.dispatchEvent(new Event('change'));

      expect(row8.classList.contains('so-row-pending')).toBe(true);
    });

    it('should clear pending flag and write parameters sequentially when write button is clicked', () => {
      const fnSel8 = document.getElementById('so-fn-8');
      const minInp8 = document.getElementById('so-min-8');
      const saveBtn = document.getElementById('so-save-btn');
      const saveBadge = document.getElementById('so-save-badge');

      fnSel8.value = '6'; // Mount Pitch
      fnSel8.dispatchEvent(new Event('change'));

      minInp8.value = '1060';
      minInp8.dispatchEvent(new Event('change'));

      window.safeSend.mockClear();

      saveBtn.click();

      // Verify params are set
      expect(window.safeSend).toHaveBeenCalledTimes(5); // all 5 params are sent for the pending row
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_set', param_id: 'SERVO8_FUNCTION', value: 6 });
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_set', param_id: 'SERVO8_REVERSED', value: 0 });
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_set', param_id: 'SERVO8_MIN', value: 1060 });
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_set', param_id: 'SERVO8_TRIM', value: 1500 });
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_set', param_id: 'SERVO8_MAX', value: 1900 });

      expect(saveBadge.textContent).toContain('Writing to FC…');
      expect(saveBadge.className).toContain('fs-badge-loading');

      // The row-pending class is removed on click write
      expect(document.getElementById('so-row-8').classList.contains('so-row-pending')).toBe(false);

      // Simulating param_set_sent ack packets
      triggerWsMessage({ type: 'param_set_sent', param_id: 'SERVO8_FUNCTION', value: 6 });
      triggerWsMessage({ type: 'param_set_sent', param_id: 'SERVO8_REVERSED', value: 0 });
      triggerWsMessage({ type: 'param_set_sent', param_id: 'SERVO8_MIN', value: 1060 });
      triggerWsMessage({ type: 'param_set_sent', param_id: 'SERVO8_TRIM', value: 1500 });
      triggerWsMessage({ type: 'param_set_sent', param_id: 'SERVO8_MAX', value: 1900 });

      // Check fully saved status
      expect(saveBadge.textContent).toBe('✓ Written to FC');
      expect(saveBadge.className).toContain('fs-badge-ok');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Servo output settings written to flight controller', false);

      // Verify row flash-saved highlight
      expect(document.getElementById('so-row-8').classList.contains('so-row-saved')).toBe(true);

      // Fast forward past flash duration
      jest.advanceTimersByTime(1800);
      expect(document.getElementById('so-row-8').classList.contains('so-row-saved')).toBe(false);
    });

    it('should toast and alert error when save requested while disconnected', () => {
      const fnSel8 = document.getElementById('so-fn-8');
      fnSel8.value = '6';
      fnSel8.dispatchEvent(new Event('change'));

      // Disconnect
      const origSafeSend = window.safeSend;
      delete window.safeSend;

      const saveBtn = document.getElementById('so-save-btn');
      const saveBadge = document.getElementById('so-save-badge');

      saveBtn.click();

      expect(saveBadge.textContent).toBe('✕ Not connected');
      expect(saveBadge.className).toContain('fs-badge-error');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Not connected — cannot write parameters', true);

      // Restore
      window.safeSend = origSafeSend;
    });
  });

  describe('EEPROM Calibration Saves & Custom Toast Dialogs', () => {
    it('should transmit save_eeprom command and toast when eeprom save is triggered', () => {
      const eepromBtn = document.getElementById('so-eeprom-btn');
      const saveBadge = document.getElementById('so-save-badge');

      eepromBtn.click();

      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'command',
        command: 'save_eeprom'
      });

      expect(saveBadge.textContent).toBe('✓ EEPROM save requested');
      expect(saveBadge.className).toContain('fs-badge-ok');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('EEPROM save command sent to flight controller', false);
    });

    it('should toast and error if ws message param_error received', () => {
      triggerWsMessage({
        type: 'param_error',
        message: 'MAVLink link timeout'
      });

      const connBadge = document.getElementById('so-conn-badge');
      expect(connBadge.textContent).toBe('✕ FC error');
      expect(connBadge.className).toContain('fs-badge-error');
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Servo param error: MAVLink link timeout', true);
    });
  });
});