describe('GCS Flight Plan Return Actions High-Fidelity Behavioral Test Suite (plan-flight-return.js)', () => {
  let modeInstance;

  beforeAll(() => {
    // Setup standard WebSocket static states
    global.WebSocket = {
      OPEN: 1
    };

    // Mock global components
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Spy on global alerts and confirm dialogs
    jest.spyOn(global, 'alert').mockImplementation(() => {});
    jest.spyOn(global, 'confirm').mockImplementation(() => true);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Define dummy constructor
    window.PlanFlightMode = function() {};

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-return.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();

    modeInstance = new window.PlanFlightMode();

    // Mock sendCommand
    window.sendCommand = jest.fn(() => true);

    // Setup active open WebSocket
    window.ws = {
      readyState: 1 // WebSocket.OPEN
    };
  });

  describe('Function: handleReturnActions Routing', () => {
    it('should route matching return actions to their respective handlers', () => {
      const spyRtl = jest.spyOn(modeInstance, 'returnToLaunch').mockImplementation(() => {});
      const spyLand = jest.spyOn(modeInstance, 'landHere').mockImplementation(() => {});

      modeInstance.handleReturnActions('return-to-launch');
      expect(spyRtl).toHaveBeenCalledTimes(1);

      modeInstance.handleReturnActions('land-here');
      expect(spyLand).toHaveBeenCalledTimes(1);

      // Verify warning for unknown action
      modeInstance.handleReturnActions('unknown-return-action');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown return action'));

      spyRtl.mockRestore();
      spyLand.mockRestore();
    });
  });

  describe('Function: returnToLaunch', () => {
    it('should prevent sending command and alert user if WebSocket is not open', () => {
      delete window.ws;
      modeInstance.returnToLaunch();
      expect(window.MsgConsole.error).toHaveBeenCalledWith(expect.stringContaining('Not connected to drone'));
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Not connected to drone'));
      expect(window.sendCommand).not.toHaveBeenCalled();

      window.ws = { readyState: 0 }; // CONNECTING
      modeInstance.returnToLaunch();
      expect(window.sendCommand).not.toHaveBeenCalled();
    });

    it('should request confirmation and cancel sending RTL command if user rejects prompt', () => {
      global.confirm.mockImplementationOnce(() => false);

      modeInstance.returnToLaunch();

      expect(global.confirm).toHaveBeenCalledTimes(1);
      expect(window.sendCommand).not.toHaveBeenCalled();
    });

    it('should transmit RTL command via sendCommand and log success on OK confirmation', () => {
      modeInstance.returnToLaunch();

      expect(global.confirm).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.info).toHaveBeenCalledWith('🔙 Sending Return to Launch command…');
      expect(window.sendCommand).toHaveBeenCalledWith('RTL');
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ RTL command sent');
    });

    it('should log error if sendCommand RTL returns false (failure)', () => {
      window.sendCommand.mockImplementationOnce(() => false);

      modeInstance.returnToLaunch();

      expect(window.sendCommand).toHaveBeenCalledWith('RTL');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('❌ Failed to send RTL command');
      expect(console.error).toHaveBeenCalledWith('❌ RTL command send failed');
    });
  });

  describe('Function: landHere', () => {
    it('should prevent sending command and alert user if WebSocket is not open', () => {
      delete window.ws;
      modeInstance.landHere();
      expect(window.MsgConsole.error).toHaveBeenCalledWith(expect.stringContaining('Not connected to drone'));
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Not connected to drone'));
      expect(window.sendCommand).not.toHaveBeenCalled();
    });

    it('should request current-position landing confirmation and cancel command if user rejects', () => {
      global.confirm.mockImplementationOnce(() => false);

      modeInstance.landHere();

      expect(global.confirm).toHaveBeenCalledTimes(1);
      expect(window.sendCommand).not.toHaveBeenCalled();
    });

    it('should transmit LAND command via sendCommand and log success on OK confirmation', () => {
      modeInstance.landHere();

      expect(global.confirm).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.info).toHaveBeenCalledWith('🛬 Sending Land command…');
      expect(window.sendCommand).toHaveBeenCalledWith('LAND');
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Land command sent');
    });

    it('should log error if sendCommand LAND returns false (failure)', () => {
      window.sendCommand.mockImplementationOnce(() => false);

      modeInstance.landHere();

      expect(window.sendCommand).toHaveBeenCalledWith('LAND');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('❌ Failed to send Land command');
      expect(console.error).toHaveBeenCalledWith('❌ Land command send failed');
    });
  });
});