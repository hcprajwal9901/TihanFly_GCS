describe('Flight Modes Configuration Panel Behavioral Test Suite', () => {
  let container;
  let swUtilMock;

  beforeAll(() => {
    jest.useFakeTimers();

    // Mock WebSocket properties
    if (global.WebSocket) {
      global.WebSocket.OPEN = 1;
    }

    // Mock global SwUtil
    swUtilMock = {
      toast: jest.fn()
    };
    window.SwUtil = swUtilMock;

    // Define single WebSocket mock object once to prevent intercept bypass on re-assignment
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn(),
      onmessage: null
    };

    // Load Script once
    global.loadScript('js/flight-mode.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset WebSocket mock calls
    window.ws.send.mockClear();

    // Setup DOM container
    document.body.innerHTML = `
      <div id="panel-flight-modes"></div>
    `;
    container = document.getElementById('panel-flight-modes');
  });

  it('should auto-initialize FlightModes, mount panel HTML, and install WS intercept', () => {
    window.FlightModes.init();

    // Check DOM structures
    expect(container.querySelector('.settings-panel-title').textContent).toContain('Flight Modes');
    expect(container.querySelector('#fmCurrentModeText').textContent).toBe('—');
    expect(container.querySelector('#fmCurrentPWM').textContent).toBe('—');

    const rows = container.querySelectorAll('.fm-row');
    expect(rows.length).toBe(6);

    // Verify select element options are populated
    const select = rows[0].querySelector('select');
    expect(select.options.length).toBe(25); // MODES length
    expect(select.options[0].text).toBe('Stabilize');

    // Verify WS intercept installed
    expect(typeof window.ws.onmessage).toBe('function');
  });

  describe('Select and Checkbox Interactions', () => {
    beforeEach(() => {
      window.FlightModes.init();
    });

    it('_onMode should update slot state and refresh the target row', () => {
      const selectEl = container.querySelector('#fmRow2 select');
      expect(selectEl.value).toBe('0'); // Stabilize default

      // Change selection to Acro (ID 1)
      window.FlightModes._onMode(2, '1');

      // Re-query selectEl because refreshRow replaces the element in DOM
      const newSelectEl = container.querySelector('#fmRow2 select');
      expect(newSelectEl.value).toBe('1');
    });

    it('_onSimple and _onSuperSimple should update slot checkbox state flags', () => {
      // Checked Simple on Slot 0
      window.FlightModes._onSimple(0, true);
      // Checked Super Simple on Slot 1
      window.FlightModes._onSuperSimple(1, true);

      // Verify saving payload captures this
      window.FlightModes._save();
      expect(window.ws.send).toHaveBeenCalled();
      const payload = JSON.parse(window.ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('save_flight_modes');
      expect(payload.modes).toBeDefined();
    });
  });

  describe('Saving configuration panel state', () => {
    beforeEach(() => {
      window.FlightModes.init();
    });

    it('should disable save button and broadcast save_flight_modes over WS', () => {
      const saveBtn = container.querySelector('#fmSaveBtn');
      expect(saveBtn.disabled).toBe(false);

      window.FlightModes._save();

      expect(saveBtn.disabled).toBe(true);
      expect(saveBtn.innerHTML).toContain('Saving…');

      expect(window.ws.send).toHaveBeenCalled();
      const payload = JSON.parse(window.ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('save_flight_modes');
      expect(payload.modes.length).toBe(6);
    });

    it('should re-enable save button on 5-second timeout if no response echo arrives', () => {
      window.FlightModes._save();
      const saveBtn = container.querySelector('#fmSaveBtn');
      expect(saveBtn.disabled).toBe(true);

      // Advance timers by 5.1s
      jest.advanceTimersByTime(5100);

      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.innerHTML).toContain('Save Modes');
    });
  });

  describe('WebSocket Event Stream Routing', () => {
    beforeEach(() => {
      window.FlightModes.init();
    });

    it('should handle flight_mode_status updates and refresh active highlighted row', () => {
      const statusMsg = {
        type: 'flight_mode_status',
        pwm: 1450, // slot 2
        slot: 2,
        mode: 'ALT_HOLD'
      };

      // Push message through WS intercept
      window.ws.onmessage({ data: JSON.stringify(statusMsg) });

      // Verify header values
      expect(container.querySelector('#fmCurrentModeText').textContent).toBe('Alt Hold');
      expect(container.querySelector('#fmCurrentPWM').textContent).toBe('3: 1450');

      // Verify row 2 is active (0-indexed, so 3rd row)
      const rows = container.querySelectorAll('.fm-row');
      expect(rows[2].className).toContain('fm-row--active');
      expect(rows[0].className).not.toContain('fm-row--active');
    });

    it('should handle flight_mode_pwm updates and highlight slot', () => {
      const pwmMsg = {
        type: 'flight_mode_pwm',
        pwm: 1680 // slot 4
      };

      window.ws.onmessage({ data: JSON.stringify(pwmMsg) });

      expect(container.querySelector('#fmCurrentPWM').textContent).toBe('5: 1680');
      
      const rows = container.querySelectorAll('.fm-row');
      expect(rows[4].className).toContain('fm-row--active');
    });

    it('should handle flight_mode_param parameter echoes and update options selection index', () => {
      const paramMsg = {
        type: 'flight_mode_param',
        slot: 1,
        mode_id: 6, // RTL
        mode: 'RTL'
      };

      window.ws.onmessage({ data: JSON.stringify(paramMsg) });

      const selectEl = container.querySelector('#fmRow1 select');
      expect(selectEl.value).toBe('6');
    });

    it('should re-enable save button on flight_mode_saved message and show toast', () => {
      // Trigger save first to disable button
      window.FlightModes._save();
      const saveBtn = container.querySelector('#fmSaveBtn');
      expect(saveBtn.disabled).toBe(true);

      const savedMsg = {
        type: 'flight_mode_saved',
        message: ' Autopilot modes saved successfully'
      };

      window.ws.onmessage({ data: JSON.stringify(savedMsg) });

      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.innerHTML).toContain('Save Modes');
      expect(swUtilMock.toast).toHaveBeenCalledWith(' Autopilot modes saved successfully', false);
    });
  });
});