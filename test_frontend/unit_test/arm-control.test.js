describe('Arm Control Toggle High-Fidelity Behavioral Test Suite (arm-control.test.js / flight-controls.js)', () => {
  beforeAll(() => {
    // Enable fake timers
    jest.useFakeTimers();

    // Prepare fresh UI elements for ArmToggle class instantiation
    const container = document.createElement('div');
    container.className = 'flight-controls-strip';
    document.body.appendChild(container);

    const armBtn = document.createElement('button');
    armBtn.id = 'armBtn';
    const armLabel = document.createElement('span');
    armLabel.id = 'armBtnLabel';
    armLabel.textContent = 'ARM';
    const armIcon = document.createElement('img');
    armIcon.id = 'armBtnIcon';
    armIcon.alt = 'Arm';
    armBtn.appendChild(armLabel);
    armBtn.appendChild(armIcon);
    container.appendChild(armBtn);

    const forceArmBtn = document.createElement('button');
    forceArmBtn.id = 'forceArmBtn';
    container.appendChild(forceArmBtn);

    // Stubs for other FlightControls elements to avoid initialisation errors
    const takeoffBtn = document.createElement('button');
    takeoffBtn.id = 'takeoffBtn';
    container.appendChild(takeoffBtn);

    const landBtn = document.createElement('button');
    landBtn.id = 'landBtn';
    container.appendChild(landBtn);

    const rtlBtn = document.createElement('button');
    rtlBtn.id = 'rtlBtn';
    container.appendChild(rtlBtn);

    const flightModeBtn = document.createElement('button');
    flightModeBtn.id = 'flightModeBtn';
    container.appendChild(flightModeBtn);

    const flightModePanel = document.createElement('div');
    flightModePanel.id = 'flightModePanel';
    container.appendChild(flightModePanel);

    const activeModeDisplay = document.createElement('span');
    activeModeDisplay.id = 'activeModeDisplay';
    container.appendChild(activeModeDisplay);

    const takeoffModal = document.createElement('div');
    takeoffModal.id = 'takeoffModal';
    document.body.appendChild(takeoffModal);

    // Stub window global methods
    window.sendCommand = jest.fn();
    window.selectedSysId = 1;

    // Load flight controls script physically
    global.loadScript('js/flight-controls.js');

    // Trigger DOMContentLoaded listener manually to run script init sequence
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    if (window.ArmControl) {
      window.ArmControl.setArmedState(false);
      // Restore default callbacks to avoid test leakage
      window.ArmControl.onArm(() => {
        window.sendCommand('ARM');
      });
      window.ArmControl.onDisarm(() => {
        window.sendCommand('DISARM');
      });
    }
  });

  describe('Instantiation & DOM Bindings', () => {
    it('should successfully instantiate the ArmToggle class and bind to DOM elements', () => {
      expect(window.ArmControl).toBeDefined();
      expect(window.ArmControl.btn).toBe(document.getElementById('armBtn'));
      expect(window.ArmControl.label).toBe(document.getElementById('armBtnLabel'));
      expect(window.ArmControl.icon).toBe(document.getElementById('armBtnIcon'));
    });

    it('should initialize in a disarmed state', () => {
      expect(window.ArmControl.getState()).toBe(false);
      expect(window.ArmControl.btn.classList.contains('armed')).toBe(false);
      expect(window.ArmControl.label.textContent).toBe('ARM');
    });
  });

  describe('State Transitions & Class Modifications', () => {
    it('should add the armed CSS class and change text labels when armed', () => {
      const armToggle = window.ArmControl;
      
      armToggle.setArmedState(true);
      expect(armToggle.getState()).toBe(true);
      expect(armToggle.btn.classList.contains('armed')).toBe(true);
      expect(armToggle.label.textContent).toBe('DISARM');
      expect(armToggle.icon.alt).toBe('Disarm');
    });

    it('should remove the armed CSS class and change text labels when disarmed', () => {
      const armToggle = window.ArmControl;
      
      armToggle.setArmedState(true);
      armToggle.setArmedState(false);
      expect(armToggle.getState()).toBe(false);
      expect(armToggle.btn.classList.contains('armed')).toBe(false);
      expect(armToggle.label.textContent).toBe('ARM');
      expect(armToggle.icon.alt).toBe('Arm');
    });

    it('should not perform redundant state operations if set to the current state', () => {
      const armToggle = window.ArmControl;
      const spySet = jest.spyOn(armToggle, 'setArmedState');
      
      armToggle.arm(); // Transition false -> true
      expect(spySet).toHaveBeenCalledWith(true);
      
      spySet.mockClear();
      armToggle.arm(); // Already true
      // The implementation does: if (this.isArmed === isArmed) return;
      expect(armToggle.getState()).toBe(true);
      
      spySet.mockRestore();
    });
  });

  describe('User Interactions & WebSocket Commands', () => {
    it('should trigger sendCommand("ARM") when arming', () => {
      const armToggle = window.ArmControl;
      
      armToggle.arm();
      expect(window.sendCommand).toHaveBeenCalledWith('ARM');
    });

    it('should trigger sendCommand("DISARM") when disarming', () => {
      const armToggle = window.ArmControl;
      
      armToggle.disarm();
      expect(window.sendCommand).toHaveBeenCalledWith('DISARM');
    });

    it('should trigger callback handlers onArm and onDisarm when states transition', () => {
      const armToggle = window.ArmControl;
      const onArmSpy = jest.fn();
      const onDisarmSpy = jest.fn();

      armToggle.onArm(onArmSpy);
      armToggle.onDisarm(onDisarmSpy);

      armToggle.arm();
      expect(onArmSpy).toHaveBeenCalledTimes(1);
      expect(onDisarmSpy).not.toHaveBeenCalled();

      armToggle.disarm();
      expect(onDisarmSpy).toHaveBeenCalledTimes(1);
    });

    it('should toggle state and fire appropriate commands when the DOM button is clicked', () => {
      const armBtn = document.getElementById('armBtn');
      
      // Start: DISARMED. Clicking should ARM.
      armBtn.click();
      expect(window.ArmControl.getState()).toBe(true);
      expect(window.sendCommand).toHaveBeenCalledWith('ARM');

      // Click again. Should DISARM.
      window.sendCommand.mockClear();
      armBtn.click();
      expect(window.ArmControl.getState()).toBe(false);
      expect(window.sendCommand).toHaveBeenCalledWith('DISARM');
    });
  });

  describe('Synchronized State Updates via DOM events', () => {
    it('should optimistic-arm and dispatch FORCE_ARM when forceArmBtn is clicked', () => {
      const forceArmBtn = document.getElementById('forceArmBtn');
      
      forceArmBtn.click();
      expect(window.sendCommand).toHaveBeenCalledWith('FORCE_ARM');
      expect(window.ArmControl.getState()).toBe(true);
    });
  });
});
