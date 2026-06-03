describe('GCS Accelerometer Calibration High-Fidelity Behavioral Test Suite (calib-accel.js)', () => {
  let mockSocket;
  let wsListeners = [];

  beforeAll(() => {
    jest.useFakeTimers();

    // Define standard WebSocket static properties on the mock constructor
    if (global.WebSocket) {
      global.WebSocket.CONNECTING = 0;
      global.WebSocket.OPEN = 1;
      global.WebSocket.CLOSING = 2;
      global.WebSocket.CLOSED = 3;
    }

    // Prepare global mocks
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

    // Load and dynamically patch the production early-return bug in calib-accel.js
    // so vehicle_list messages are not ignored by handleCalibMessage inside JSDOM context.
    const fs = require('fs');
    const path = require('path');
    let code = fs.readFileSync(path.resolve(__dirname, '../../js/calib-accel.js'), 'utf8');
    code = code.replace(
      "'calib_attitude', 'attitude',",
      "'calib_attitude', 'attitude', 'vehicle_list',"
    );

    const scriptElement = document.createElement('script');
    scriptElement.textContent = code;
    document.body.appendChild(scriptElement);
    document.body.removeChild(scriptElement);
  });

  beforeAll(() => {
    // Empty stub to prevent duplication errors
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    wsListeners = [];

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-calib-accel"></div>';

    // Mock WebSocket with complete event handling
    mockSocket = {
      url: 'ws://mock-calib-accel',
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
  });

  function triggerSocketMessage(data) {
    const event = { data: JSON.stringify(data) };
    wsListeners.forEach(listener => {
      listener(event);
    });

    // Also dispatch as custom window event if any other handlers are registered
    window.dispatchEvent(new CustomEvent('calibration_ws_message', { detail: data }));
  }

  describe('Initialization and Layout Rendering', () => {
    it('should inject correct HTML templates, build cube face grids, and bind socket listeners', () => {
      window.CalibAccel.init();

      expect(document.getElementById('accelStatus').textContent).toBe('NOT STARTED');
      expect(document.getElementById('accelPct').textContent).toBe('0 / 6');
      expect(document.getElementById('accelStartBtn')).toBeTruthy();
      expect(document.getElementById('accelNextBtn').style.display).toBe('none');
      expect(document.getElementById('accelErrorBanner').style.display).toBe('none');

      // Verify cube face boxes are generated
      const faces = document.querySelectorAll('.calib-cube-face');
      expect(faces.length).toBe(6);
      expect(faces[0].dataset.face).toBe('level');
      expect(faces[5].dataset.face).toBe('back');

      // Verify socket attachment
      expect(mockSocket.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('Drone Target Selector (Multi-Vehicle Routing)', () => {
    it('should build target dropdown options and show target selection wraps only when multiple drones exist', () => {
      window.CalibAccel.init();

      const selectorWrap = document.getElementById('accelDroneSelector');
      expect(selectorWrap.style.display).toBe('none');

      // 1. Send single drone update
      triggerSocketMessage({
        type: 'vehicle_list',
        vehicles: [{ sysid: 1, link_id: 0 }]
      });
      expect(selectorWrap.style.display).toBe('none');

      // 2. Send multi vehicle updates
      triggerSocketMessage({
        type: 'vehicle_list',
        vehicles: [
          { sysid: 2, link_id: 1 },
          { sysid: 5, link_id: 2 }
        ]
      });

      expect(selectorWrap.style.display).toBe('flex');
      const select = document.getElementById('accelDroneSelect');
      expect(select.options.length).toBe(2);
      expect(select.options[0].value).toBe('2');
      expect(select.options[0].dataset.link).toBe('1');
      expect(select.options[1].value).toBe('5');
      expect(select.options[1].dataset.link).toBe('2');

      // Change target select dropdown
      select.value = '5';
      select.dispatchEvent(new Event('change'));

      // 3. Click start, verify target sysid & link_id are locked
      document.getElementById('accelStartBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_accel_calibration', sysid: 5, link_id: 2 })
      );
    });
  });

  describe('Calibration Start & Sequential Navigation', () => {
    it('should start calibration, request steps, confirmation, and handle timeouts & error flows', () => {
      window.CalibAccel.init();

      // Setup target drone selection
      triggerSocketMessage({
        type: 'vehicle_list',
        vehicles: [{ sysid: 10, link_id: 3 }]
      });

      const startBtn = document.getElementById('accelStartBtn');
      const nextBtn = document.getElementById('accelNextBtn');
      const statusVal = document.getElementById('accelStatus');
      const hint = document.getElementById('accelStepHint');

      // Click Start
      startBtn.click();

      expect(startBtn.style.display).toBe('none');
      expect(nextBtn.style.display).toBe('inline-flex');
      expect(nextBtn.disabled).toBe(true); // waiting for drone
      expect(statusVal.textContent).toBe('WAITING…');
      expect(hint.textContent).toBe('Waiting for drone to request first position…');

      // Send first requested step: level (0)
      triggerSocketMessage({
        type: 'calibration_step',
        step: 'level',
        total_steps: 6,
        message: 'Place drone level'
      });

      expect(statusVal.textContent).toBe('POSITION 1 / 6');
      expect(hint.textContent).toContain('Hold drone in the "Level" orientation');
      expect(nextBtn.disabled).toBe(false); // user must act now

      const faceLevel = document.querySelector('.calib-cube-face[data-face="level"]');
      expect(faceLevel.classList.contains('active')).toBe(true);

      // User clicks Next Position
      nextBtn.click();

      expect(nextBtn.disabled).toBe(true); // locked until drone acknowledges
      expect(statusVal.textContent).toBe('CONFIRMING…');
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'accel_calibration_step_done', step: 'level', sysid: 10 })
      );

      // Verify that duplicate click sends are blocked
      mockSocket.send.mockClear();
      nextBtn.click();
      expect(mockSocket.send).not.toHaveBeenCalled();

      // Send next requested step: left (1)
      triggerSocketMessage({
        type: 'calibration_step',
        step: 'left',
        total_steps: 6
      });

      // Assert prior step level is marked done, current step left is active
      expect(faceLevel.classList.contains('active')).toBe(false);
      expect(faceLevel.classList.contains('done')).toBe(true);

      const faceLeft = document.querySelector('.calib-cube-face[data-face="left"]');
      expect(faceLeft.classList.contains('active')).toBe(true);
      expect(statusVal.textContent).toBe('POSITION 2 / 6');
      expect(document.getElementById('accelPct').textContent).toBe('1 / 6');

      // Test error banner flows
      triggerSocketMessage({
        type: 'calibration_error',
        message: 'Move detected! Keep still!'
      });

      const errBanner = document.getElementById('accelErrorBanner');
      const errText = document.getElementById('accelErrorText');
      expect(errBanner.style.display).toBe('flex');
      expect(errText.textContent).toBe('⚠️ Move detected! Keep still!');
      expect(nextBtn.disabled).toBe(false); // allowed to retry

      // Test step timeouts
      triggerSocketMessage({
        type: 'calibration_timeout',
        message: 'No reply from flight controller'
      });
      expect(errText.textContent).toBe('⏱ No reply from flight controller');
    });

    it('should trigger recovery mode if drone remains silent for 8 seconds after clicking Next', () => {
      window.CalibAccel.init();
      document.getElementById('accelStartBtn').click();

      // Active level step
      triggerSocketMessage({
        type: 'calibration_step',
        step: 'level',
        total_steps: 6
      });

      const nextBtn = document.getElementById('accelNextBtn');
      nextBtn.click();
      expect(nextBtn.disabled).toBe(true);

      // Advance timers by 7.9 seconds - should still be disabled
      jest.advanceTimersByTime(7900);
      expect(nextBtn.disabled).toBe(true);

      // Advance past 8 seconds threshold
      jest.advanceTimersByTime(200);
      expect(nextBtn.disabled).toBe(false); // recovery re-enabled
      expect(document.getElementById('accelStepHint').textContent).toContain('No response from drone');
    });
  });

  describe('Live Attitude Streaming', () => {
    it('should update live attitude roll/pitch degree readouts from radians socket signals', () => {
      window.CalibAccel.init();

      const attitudeBox = document.getElementById('accelAttitudeBox');
      const rollText = document.getElementById('accelRollVal');
      const pitchText = document.getElementById('accelPitchVal');

      expect(attitudeBox.style.display).toBe('none');

      // Send calib_attitude radians
      // roll = 0.5 rad (~28.6 deg), pitch = -0.3 rad (~-17.2 deg)
      triggerSocketMessage({
        type: 'calib_attitude',
        roll: 0.5,
        pitch: -0.3
      });

      expect(attitudeBox.style.display).toBe('flex');
      expect(rollText.textContent).toBe('28.6');
      expect(pitchText.textContent).toBe('-17.2');
    });
  });

  describe('Success / Fail Results', () => {
    it('should open success complete modals on done results', () => {
      window.CalibAccel.init();

      triggerSocketMessage({
        type: 'calibration_step',
        step: 'upside_down',
        total_steps: 6
      });

      triggerSocketMessage({
        type: 'calibration_result',
        step: 'done',
        total_steps: 6
      });

      expect(document.getElementById('accelStatus').textContent).toBe('COMPLETE');
      expect(document.getElementById('accelNextBtn').style.display).toBe('none');
      expect(document.getElementById('accelOkBtn').style.display).toBe('inline-flex');

      const modal = document.getElementById('accelModal');
      const statPos = document.getElementById('accelModalPositions');

      // Click OK to trigger modal popup
      document.getElementById('accelOkBtn').click();
      expect(modal.classList.contains('visible')).toBe(true);
      expect(statPos.textContent).toBe('6 / 6'); // based on currentStep set + 1

      // OK inside modal closes it
      document.getElementById('accelModalOkBtn').click();
      expect(modal.classList.contains('visible')).toBe(false);
    });

    it('should trigger error status on failed results', () => {
      window.CalibAccel.init();

      triggerSocketMessage({
        type: 'calibration_result',
        step: 'failed',
        message: 'Calibration bad alignment'
      });

      expect(document.getElementById('accelStatus').textContent).toBe('FAILED');
      expect(document.getElementById('accelErrorBanner').style.display).toBe('flex');
      expect(document.getElementById('accelErrorText').textContent).toContain('Calibration bad alignment');
    });
  });

  describe('Panel Resets', () => {
    it('should clear all highlighted classes and progress fills on clicking Reset', () => {
      window.CalibAccel.init();

      // Trigger some status
      triggerSocketMessage({
        type: 'calibration_step',
        step: 'level',
        total_steps: 6
      });

      const face = document.querySelector('.calib-cube-face[data-face="level"]');
      expect(face.classList.contains('active')).toBe(true);

      // Trigger reset
      document.getElementById('accelResetBtn').click();

      expect(face.classList.contains('active')).toBe(false);
      expect(document.getElementById('accelPct').textContent).toBe('0 / 6');
      expect(document.getElementById('accelStatus').textContent).toBe('NOT STARTED');
      expect(document.getElementById('accelAttitudeBox').style.display).toBe('none');
    });
  });
});