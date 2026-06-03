describe('GCS Flight Plan Takeoff Actions High-Fidelity Behavioral Test Suite (plan-flight-takeoff.js)', () => {
  let modeInstance;
  let originalCreateElement;
  let capturedTimeouts;

  beforeAll(() => {
    // Keep reference to genuine native document.createElement before any spy modifications
    originalCreateElement = document.createElement;

    // Define dummy constructor for PlanFlightMode
    window.PlanFlightMode = function() {};

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-takeoff.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    capturedTimeouts = [];

    // Neutralize setup.js aggressive DOM guards to restore realistic browser behavior
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      return document.body.querySelector(`#${id}`);
    });
    jest.spyOn(document, 'querySelector').mockImplementation((selector) => {
      return document.body.querySelector(selector);
    });

    // Mock MsgConsole component silently
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Spy on global console warnings and errors silently
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Define popups directly as mock functions on window to prevent spy failures in JSDOM
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    window.prompt = jest.fn(() => '10');

    // Define mock for sendCommand
    window.sendCommand = jest.fn();

    // Ensure WebSocket static constants are defined
    if (global.WebSocket) {
      global.WebSocket.CONNECTING = 0;
      global.WebSocket.OPEN = 1;
      global.WebSocket.CLOSING = 2;
      global.WebSocket.CLOSED = 3;
    }

    // Mock setTimeout to capture delay callbacks
    jest.spyOn(global, 'setTimeout').mockImplementation((cb, delay) => {
      capturedTimeouts.push({ cb, delay });
      return capturedTimeouts.length; // return dummy timer ID
    });

    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Reset window variables
    delete window.WaypointManager;
    delete window.ws;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Function: handleTakeoffActions Routing', () => {
    it('should route matching takeoff actions to their respective handlers', () => {
      const spyTakeoff = jest.spyOn(modeInstance, 'takeoffHere').mockImplementation(() => {});
      const spySetHome = jest.spyOn(modeInstance, 'setHomePosition').mockImplementation(() => {});
      const spyClearHome = jest.spyOn(modeInstance, 'clearHome').mockImplementation(() => {});

      modeInstance.handleTakeoffActions('takeoff-here');
      expect(spyTakeoff).toHaveBeenCalledTimes(1);

      modeInstance.handleTakeoffActions('set-home-position');
      expect(spySetHome).toHaveBeenCalledTimes(1);

      modeInstance.handleTakeoffActions('clear-home');
      expect(spyClearHome).toHaveBeenCalledTimes(1);

      modeInstance.handleTakeoffActions('invalid-action');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown takeoff action'));

      spyTakeoff.mockRestore();
      spySetHome.mockRestore();
      spyClearHome.mockRestore();
    });
  });

  describe('Function: takeoffHere (GUIDED -> ARM -> TAKEOFF)', () => {
    it('should alert error and return if WebSocket connection is not open', () => {
      window.ws = { readyState: 0 }; // CONNECTING (not OPEN)
      modeInstance.takeoffHere();

      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Not connected to drone'));
      expect(window.MsgConsole.error).toHaveBeenCalledWith(expect.stringContaining('Not connected to drone'));
      expect(window.sendCommand).not.toHaveBeenCalled();
    });

    it('should launch multi-step takeoff sequence at confirmed altitude when WebSocket is connected', () => {
      window.ws = { readyState: 1 }; // OPEN (WebSocket.OPEN)
      window.prompt.mockImplementation(() => '15'); // Confirm altitude at 15m

      modeInstance.takeoffHere();

      // Step 1: immediately set mode to GUIDED
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Setting mode → GUIDED'));
      expect(window.sendCommand).toHaveBeenCalledWith('SET_MODE', { mode: 'GUIDED' });

      // Verify timers are registered for subsequent steps
      expect(capturedTimeouts.length).toBe(2);
      expect(capturedTimeouts[0].delay).toBe(1200);
      expect(capturedTimeouts[1].delay).toBe(3500);

      // Step 2: Invoke ARM timer
      capturedTimeouts[0].cb();
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Arming drone'));
      expect(window.sendCommand).toHaveBeenCalledWith('ARM');

      // Step 3: Invoke TAKEOFF timer
      capturedTimeouts[1].cb();
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Taking off to 15 m'));
      expect(window.sendCommand).toHaveBeenCalledWith('TAKEOFF', { altitude: 15 });
    });

    it('should cancel takeoff sequence if altitude input is cancelled (null)', () => {
      window.ws = { readyState: 1 };
      window.prompt.mockImplementation(() => null); // Cancel dialog

      modeInstance.takeoffHere();

      expect(window.sendCommand).not.toHaveBeenCalled();
      expect(capturedTimeouts.length).toBe(0);
    });
  });

  describe('Function: _showTakeoffDialog (DOM Modal vs Prompt Fallback)', () => {
    it('should fall back to native prompt if DOM elements are missing', () => {
      const mockCallback = jest.fn();
      modeInstance._showTakeoffDialog(mockCallback);

      expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('takeoff altitude'), '10');
      expect(mockCallback).toHaveBeenCalledWith(10);
    });

    it('should alert error if negative or NaN altitude is entered in prompt fallback', () => {
      const mockCallback = jest.fn();
      
      // Test invalid text
      window.prompt.mockImplementation(() => 'invalid_number');
      modeInstance._showTakeoffDialog(mockCallback);
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Invalid altitude'));
      expect(mockCallback).toHaveBeenCalledWith(null);

      // Test negative value
      window.alert.mockClear();
      mockCallback.mockClear();
      window.prompt.mockImplementation(() => '-5');
      modeInstance._showTakeoffDialog(mockCallback);
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Invalid altitude'));
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should reuse existing #takeoffModal elements and attach listener triggers if present in DOM', () => {
      const mockCallback = jest.fn();

      // Create modal elements and append them to DOM
      const modal = originalCreateElement.call(document, 'div');
      modal.id = 'takeoffModal';
      modal.className = 'takeoff-modal';
      
      const altInput = originalCreateElement.call(document, 'input');
      altInput.id = 'altitudeInput';
      altInput.value = '12.5';

      const confirmBtn = originalCreateElement.call(document, 'button');
      confirmBtn.id = 'modalConfirmBtn';

      const cancelBtn = originalCreateElement.call(document, 'button');
      cancelBtn.id = 'modalCancelBtn';

      document.body.appendChild(modal);
      document.body.appendChild(altInput);
      document.body.appendChild(confirmBtn);
      document.body.appendChild(cancelBtn);

      modeInstance._showTakeoffDialog(mockCallback);

      // Verify modal becomes active
      expect(modal.classList.contains('active')).toBe(true);

      // Click confirm button
      confirmBtn.click();

      // Verify modal is deactivated and callback receives entered altitude
      expect(modal.classList.contains('active')).toBe(false);
      expect(mockCallback).toHaveBeenCalledWith(12.5);
    });

    it('should default altitude value to 10 in DOM modal if altInput value is empty', () => {
      const mockCallback = jest.fn();

      const modal = originalCreateElement.call(document, 'div');
      modal.id = 'takeoffModal';
      
      const altInput = originalCreateElement.call(document, 'input');
      altInput.id = 'altitudeInput';
      altInput.value = ''; // empty

      const confirmBtn = originalCreateElement.call(document, 'button');
      confirmBtn.id = 'modalConfirmBtn';

      document.body.appendChild(modal);
      document.body.appendChild(altInput);
      document.body.appendChild(confirmBtn);

      modeInstance._showTakeoffDialog(mockCallback);

      expect(altInput.value).toBe('10');
      confirmBtn.click();
      expect(mockCallback).toHaveBeenCalledWith(10);
    });

    it('should log warning and callback null if invalid altitude is confirmed in DOM modal', () => {
      const mockCallback = jest.fn();

      const modal = originalCreateElement.call(document, 'div');
      modal.id = 'takeoffModal';
      
      const altInput = originalCreateElement.call(document, 'input');
      altInput.id = 'altitudeInput';
      altInput.value = 'invalid';

      const confirmBtn = originalCreateElement.call(document, 'button');
      confirmBtn.id = 'modalConfirmBtn';

      document.body.appendChild(modal);
      document.body.appendChild(altInput);
      document.body.appendChild(confirmBtn);

      modeInstance._showTakeoffDialog(mockCallback);
      confirmBtn.click();

      expect(window.MsgConsole.error).toHaveBeenCalledWith('Invalid altitude value');
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should clean up and callback null when cancel button is clicked in DOM modal', () => {
      const mockCallback = jest.fn();

      const modal = originalCreateElement.call(document, 'div');
      modal.id = 'takeoffModal';
      
      const altInput = originalCreateElement.call(document, 'input');
      altInput.id = 'altitudeInput';
      altInput.value = '20';

      const confirmBtn = originalCreateElement.call(document, 'button');
      confirmBtn.id = 'modalConfirmBtn';

      const cancelBtn = originalCreateElement.call(document, 'button');
      cancelBtn.id = 'modalCancelBtn';

      document.body.appendChild(modal);
      document.body.appendChild(altInput);
      document.body.appendChild(confirmBtn);
      document.body.appendChild(cancelBtn);

      modeInstance._showTakeoffDialog(mockCallback);
      expect(modal.classList.contains('active')).toBe(true);

      // Click cancel button
      cancelBtn.click();

      expect(modal.classList.contains('active')).toBe(false);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });
  });

  describe('Function: setHomePosition', () => {
    it('should error and alert if WaypointManager is missing', () => {
      modeInstance.setHomePosition();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WaypointManager not available'));
      expect(window.MsgConsole.error).toHaveBeenCalledWith('WaypointManager not initialized');
    });

    it('should request map click via WaypointManager when initialized', () => {
      window.WaypointManager = {
        startTakeoffHere: jest.fn()
      };

      modeInstance.setHomePosition();
      expect(window.WaypointManager.startTakeoffHere).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.info).toHaveBeenCalledWith('🏠 Click on map to set home position');
    });
  });

  describe('Function: clearHome', () => {
    it('should error and alert if WaypointManager is missing', () => {
      modeInstance.clearHome();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WaypointManager not available'));
      expect(window.MsgConsole.error).toHaveBeenCalledWith('WaypointManager not initialized');
    });

    it('should log warning and return if no home position is set', () => {
      window.WaypointManager = {
        getHomePosition: jest.fn(() => null)
      };

      modeInstance.clearHome();
      expect(window.MsgConsole.warning).toHaveBeenCalledWith('No home position to clear');
    });

    it('should prompt confirmation and cancel clear if user rejects confirmation dialog', () => {
      window.WaypointManager = {
        getHomePosition: jest.fn(() => ({ lat: 12, lng: 80 })),
        clearHomePosition: jest.fn()
      };
      window.confirm.mockImplementation(() => false); // Cancel clear

      modeInstance.clearHome();

      expect(window.confirm).toHaveBeenCalledWith('Clear home position?');
      expect(window.WaypointManager.clearHomePosition).not.toHaveBeenCalled();
    });

    it('should clear home position and log success if user confirms clear', () => {
      window.WaypointManager = {
        getHomePosition: jest.fn(() => ({ lat: 12, lng: 80 })),
        clearHomePosition: jest.fn()
      };
      window.confirm.mockImplementation(() => true); // Confirm clear

      modeInstance.clearHome();

      expect(window.confirm).toHaveBeenCalledWith('Clear home position?');
      expect(window.WaypointManager.clearHomePosition).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Home position cleared');
    });
  });
});