describe('FlightControls High-Fidelity Behavioral Test Suite (flight-controls.js)', () => {
  beforeAll(() => {
    // Enable fake timers to tick sequence timeouts
    jest.useFakeTimers();

    // Prepare complete DOM structure that matches flight-controls UI exactly
    const container = document.createElement('div');
    container.className = 'flight-controls-strip';
    document.body.appendChild(container);

    // Primary control buttons
    const armBtn = document.createElement('button');
    armBtn.id = 'armBtn';
    const armLabel = document.createElement('span');
    armLabel.id = 'armBtnLabel';
    const armIcon = document.createElement('img');
    armIcon.id = 'armBtnIcon';
    armBtn.appendChild(armLabel);
    armBtn.appendChild(armIcon);
    container.appendChild(armBtn);

    const forceArmBtn = document.createElement('button');
    forceArmBtn.id = 'forceArmBtn';
    container.appendChild(forceArmBtn);

    const takeoffBtn = document.createElement('button');
    takeoffBtn.id = 'takeoffBtn';
    container.appendChild(takeoffBtn);

    const landBtn = document.createElement('button');
    landBtn.id = 'landBtn';
    container.appendChild(landBtn);

    const rtlBtn = document.createElement('button');
    rtlBtn.id = 'rtlBtn';
    container.appendChild(rtlBtn);

    // Mode Selector components
    const flightModeBtn = document.createElement('button');
    flightModeBtn.id = 'flightModeBtn';
    container.appendChild(flightModeBtn);

    const flightModePanel = document.createElement('div');
    flightModePanel.id = 'flightModePanel';
    
    // Add mode items
    const modeGuided = document.createElement('div');
    modeGuided.className = 'mode-item';
    modeGuided.dataset.mode = 'guided';
    flightModePanel.appendChild(modeGuided);

    const modeRtl = document.createElement('div');
    modeRtl.className = 'mode-item';
    modeRtl.dataset.mode = 'rtl';
    flightModePanel.appendChild(modeRtl);

    container.appendChild(flightModePanel);

    const activeModeDisplay = document.createElement('span');
    activeModeDisplay.id = 'activeModeDisplay';
    container.appendChild(activeModeDisplay);

    // Takeoff modal components
    const modal = document.createElement('div');
    modal.id = 'takeoffModal';
    
    const modalActions = document.createElement('div');
    modalActions.id = 'modalActions';
    modal.appendChild(modalActions);

    const closeBtn = document.createElement('button');
    closeBtn.id = 'modalCloseBtn';
    modal.appendChild(closeBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'modalCancelBtn';
    modal.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'modalConfirmBtn';
    modal.appendChild(confirmBtn);

    const altitudeInput = document.createElement('input');
    altitudeInput.id = 'altitudeInput';
    modal.appendChild(altitudeInput);

    const speedInput = document.createElement('input');
    speedInput.id = 'speedInput';
    modal.appendChild(speedInput);

    document.body.appendChild(modal);

    // Stub window global managers
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    window.sendCommand = jest.fn();

    // Load flight controls script
    global.loadScript('js/flight-controls.js');

    // Trigger DOMContentLoaded listener manually to run script init sequence
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    if (window.FlightControls) {
      window.FlightControls.clearExecutingState();
    }
  });

  describe('UI Initializations and Classes Bindings', () => {
    it('should successfully instantiate classes and expose them on window', () => {
      expect(window.FlightControls).toBeDefined();
      expect(window.ArmControl).toBeDefined();
      expect(window.FlightModeSelector).toBeDefined();
    });

    it('should configure strip visibility states', () => {
      window.FlightControls.show();
      expect(document.querySelector('.flight-controls-strip').style.display).toBe('flex');

      window.FlightControls.hide();
      expect(document.querySelector('.flight-controls-strip').style.display).toBe('none');
    });
  });

  describe('Takeoff Modal Interactions', () => {
    it('should present the takeoff dialog popup and load pre-configured parameters values', () => {
      const takeoffBtn = document.getElementById('takeoffBtn');
      const modal = document.getElementById('takeoffModal');

      // Click takeoff triggers showModal
      takeoffBtn.click();

      expect(modal.classList.contains('active')).toBe(true);
      expect(document.getElementById('altitudeInput').value).toBe('10');
      expect(document.getElementById('speedInput').value).toBe('2');
    });

    it('should sync changes on speed and altitude inputs parameters', () => {
      const altInput = document.getElementById('altitudeInput');
      const speedInput = document.getElementById('speedInput');

      altInput.value = '15';
      altInput.dispatchEvent(new Event('input'));

      speedInput.value = '3.5';
      speedInput.dispatchEvent(new Event('input'));

      expect(window.FlightControls.getTakeoffSettings()).toEqual({
        altitude: 15,
        speed: 3.5
      });
    });

    it('should close dialog if cancel button or container overlay is clicked', () => {
      const modal = document.getElementById('takeoffModal');
      modal.classList.add('active');

      const cancelBtn = document.getElementById('modalCancelBtn');
      cancelBtn.click();

      expect(modal.classList.contains('active')).toBe(false);

      modal.classList.add('active');
      modal.click(); // clicks container overlay
      expect(modal.classList.contains('active')).toBe(false);
    });
  });

  describe('Guided Auto Takeoff Sequence', () => {
    it('should execute three-stage takeoff commands sequence (Guided mode -> Arm -> Takeoff)', () => {
      const confirmBtn = document.getElementById('modalConfirmBtn');
      
      // Configure target altitude parameters
      window.FlightControls.takeoffSettings = { altitude: 12, speed: 2.5 };

      // Confirm takeoff clicks initiates callback
      confirmBtn.click();

      // Step 1: Change mode to GUIDED
      expect(window.sendCommand).toHaveBeenNthCalledWith(1, 'SET_MODE', { mode: 'GUIDED' });
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Setting mode → GUIDED'));

      // Step 2: Arm motors after 1.2s delay
      jest.advanceTimersByTime(1200);
      expect(window.sendCommand).toHaveBeenNthCalledWith(2, 'ARM');
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Arming drone'));

      // Step 3: Trigger Takeoff flight mode after 3.5s sequence settlements
      jest.advanceTimersByTime(2300);
      expect(window.sendCommand).toHaveBeenNthCalledWith(3, 'TAKEOFF', { altitude: 12, speed: 2.5 });
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Taking off to 12 m'));
    });
  });

  describe('Land and RTL Command Executions', () => {
    it('should trigger Land command on landBtn click', () => {
      const landBtn = document.getElementById('landBtn');
      landBtn.click();

      expect(window.sendCommand).toHaveBeenCalledWith('LAND');
      expect(window.FlightControls.isCommandExecuting()).toBe(true);
      expect(window.FlightControls.getCurrentCommand()).toBe('LAND');
    });

    it('should trigger RTL command on rtlBtn click', () => {
      const rtlBtn = document.getElementById('rtlBtn');
      rtlBtn.click();

      expect(window.sendCommand).toHaveBeenCalledWith('RTL');
      expect(window.FlightControls.isCommandExecuting()).toBe(true);
      expect(window.FlightControls.getCurrentCommand()).toBe('RTL');
    });
  });

  describe('Command Executing Locks & WebSocket Re-enabling', () => {
    it('should disable all controls buttons while executing command operations', () => {
      const takeoffBtn = document.getElementById('takeoffBtn');
      const landBtn = document.getElementById('landBtn');
      const rtlBtn = document.getElementById('rtlBtn');

      window.FlightControls.setExecutingState(takeoffBtn, 'TAKEOFF');

      expect(takeoffBtn.classList.contains('executing')).toBe(true);
      expect(takeoffBtn.disabled).toBe(true);
      expect(landBtn.disabled).toBe(true);
      expect(rtlBtn.disabled).toBe(true);
    });

    it('should automatically re-enable controls when matching WebSocket responses arrive', () => {
      const takeoffBtn = document.getElementById('takeoffBtn');
      const landBtn = document.getElementById('landBtn');
      const rtlBtn = document.getElementById('rtlBtn');

      window.FlightControls.setExecutingState(takeoffBtn, 'TAKEOFF');

      // Dispatch backend ACK matching the executing command
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'response',
          command: 'TAKEOFF',
          status: 'success'
        }
      }));

      expect(window.FlightControls.isCommandExecuting()).toBe(false);
      expect(takeoffBtn.classList.contains('executing')).toBe(false);
      expect(takeoffBtn.disabled).toBe(false);
      expect(landBtn.disabled).toBe(false);
      expect(rtlBtn.disabled).toBe(false);
    });
  });

  describe('Arming and Force Arm Controls', () => {
    it('should toggle armed and disarmed states', () => {
      const armToggle = window.ArmControl;
      
      // Optimistic Arm
      armToggle.arm();
      expect(armToggle.getState()).toBe(true);
      expect(window.sendCommand).toHaveBeenCalledWith('ARM');

      // Optimistic Disarm
      armToggle.disarm();
      expect(armToggle.getState()).toBe(false);
      expect(window.sendCommand).toHaveBeenCalledWith('DISARM');
    });

    it('should handle force arming clicks and sync standard states', () => {
      const forceArmBtn = document.getElementById('forceArmBtn');
      forceArmBtn.click();

      expect(window.sendCommand).toHaveBeenCalledWith('FORCE_ARM');
      expect(window.ArmControl.getState()).toBe(true);
    });
  });

  describe('Flight Mode Panel Selections overlays', () => {
    it('should toggle panel open and close class states', () => {
      const btn = document.getElementById('flightModeBtn');
      const panel = document.getElementById('flightModePanel');

      // Setup button layout coordinates
      btn.getBoundingClientRect = jest.fn().mockReturnValue({
        right: 150,
        bottom: 200
      });

      btn.click();
      expect(panel.classList.contains('open')).toBe(true);
      expect(panel.style.left).toBe('158px'); // 150 right + 8 pad

      btn.click();
      expect(panel.classList.contains('open')).toBe(false);
    });

    it('should select mode row, close overlays and trigger MAVLink command dispatcher', () => {
      const guidedItem = document.querySelector('[data-mode="guided"]');
      const spyEvent = jest.fn();

      window.addEventListener('flightModeChanged', spyEvent);

      window.FlightModeSelector.select('guided', guidedItem);

      expect(window.FlightModeSelector.getCurrentMode()).toBe('guided');
      expect(guidedItem.classList.contains('active-mode')).toBe(true);
      expect(document.getElementById('activeModeDisplay').textContent).toBe('GUIDED');
      expect(spyEvent).toHaveBeenCalled();

      // Verify event listener caught mode row clicked and dispatched SET_MODE
      expect(window.sendCommand).toHaveBeenCalledWith('SET_MODE', { mode: 'guided' });
    });

    it('should sync selector badge when receiving flight mode status updates', () => {
      window.dispatchEvent(new CustomEvent('flight_mode_changed', {
        detail: {
          mode: 'RTL'
        }
      }));

      expect(window.FlightModeSelector.getCurrentMode()).toBe('RTL');
      expect(document.getElementById('activeModeDisplay').textContent).toBe('RTL');
    });
  });
});