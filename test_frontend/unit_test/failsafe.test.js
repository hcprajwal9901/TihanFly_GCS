describe('Failsafe Configuration Panel Unit Tests (failsafe.js)', () => {
  beforeEach(() => {
    // 1. Prepare target DOM element for Failsafe host
    document.body.innerHTML = `
      <div id="panel-failsafe"></div>
    `;

    // Clear globals and mocks
    delete window.Failsafe;
    delete window.safeSend;
    window.safeSend = jest.fn();
    window.SwUtil = {
      toast: jest.fn()
    };

    jest.clearAllMocks();
    jest.useFakeTimers();

    // 2. Load the script
    global.loadScript('js/failsafe.js');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should compile panel templates and inject layout into host', () => {
    expect(window.Failsafe).toBeDefined();

    // Trigger initialisation
    window.Failsafe.init();

    // Verify elements have been rendered
    expect(document.getElementById('fs-conn-badge')).toBeDefined();
    expect(document.getElementById('fs-batt-low-sel')).toBeDefined();
    expect(document.getElementById('fs-batt-crt-sel')).toBeDefined();
    expect(document.getElementById('fs-rc-sel')).toBeDefined();
    expect(document.getElementById('fs-save-btn')).toBeDefined();
  });

  it('should query all parameters from flight controller on launch', () => {
    window.Failsafe.init();

    // Failsafe triggers automatic fetch after 200ms
    jest.advanceTimersByTime(200);

    // Should request the 3 failsafe parameters via WS
    expect(window.safeSend).toHaveBeenCalledTimes(3);
    expect(window.safeSend).toHaveBeenNativelyCalledWith(
      expect.objectContaining({ type: 'param_request_one', name: 'BATT_FS_LOW_ACT' })
    );
    expect(window.safeSend).toHaveBeenNativelyCalledWith(
      expect.objectContaining({ type: 'param_request_one', name: 'BATT_FS_CRT_ACT' })
    );
    expect(window.safeSend).toHaveBeenNativelyCalledWith(
      expect.objectContaining({ type: 'param_request_one', name: 'FS_THR_ENABLE' })
    );
  });

  it('should dispatch param_set WebSocket messages when save is clicked', () => {
    window.Failsafe.init();
    jest.advanceTimersByTime(200); // clear initial fetch
    jest.clearAllMocks();

    const lowSel = document.getElementById('fs-batt-low-sel');
    const crtSel = document.getElementById('fs-batt-crt-sel');
    const rcSel = document.getElementById('fs-rc-sel');

    // Change settings values
    lowSel.value = '1'; // Land
    crtSel.value = '2'; // RTL
    rcSel.value = '3';  // Always RTL

    // Trigger save action
    document.getElementById('fs-save-btn').click();

    // Check parameters set calls
    expect(window.safeSend).toHaveBeenCalledTimes(3);
    expect(window.safeSend).toHaveBeenNativelyCalledWith(
      expect.objectContaining({ type: 'param_set', param_id: 'BATT_FS_LOW_ACT', value: 1 })
    );
    expect(window.safeSend).toHaveBeenNativelyCalledWith(
      expect.objectContaining({ type: 'param_set', param_id: 'BATT_FS_CRT_ACT', value: 2 })
    );
    expect(window.safeSend).toHaveBeenNativelyCalledWith(
      expect.objectContaining({ type: 'param_set', param_id: 'FS_THR_ENABLE', value: 3 })
    );
  });

  it('should update UI selects and badge states when receiving WS messages via CustomEvents', () => {
    window.Failsafe.init();
    jest.advanceTimersByTime(200); // clear initial fetch

    const lowSel = document.getElementById('fs-batt-low-sel');
    expect(lowSel.value).toBe('0'); // default None

    // Dispatch a virtual WebSocket message via CustomEvent calibration_ws_message
    const paramEvent = new CustomEvent('calibration_ws_message', {
      detail: {
        type: 'param_value',
        param_id: 'BATT_FS_LOW_ACT',
        value: 2 // RTL
      }
    });
    window.dispatchEvent(paramEvent);

    // Verify low battery select updated to '2' and synced badge is visible
    expect(lowSel.value).toBe('2');
    expect(document.getElementById('fs-batt-low-hint').textContent).toBe(
      'Drone returns to the launch point.'
    );

    // Dispatch other parameters to complete synchronisation
    window.dispatchEvent(new CustomEvent('calibration_ws_message', {
      detail: { type: 'param_value', param_id: 'BATT_FS_CRT_ACT', value: 1 }
    }));
    window.dispatchEvent(new CustomEvent('calibration_ws_message', {
      detail: { type: 'param_value', param_id: 'FS_THR_ENABLE', value: 4 }
    }));

    // Connection badge should show fully synced
    expect(document.getElementById('fs-conn-badge').textContent).toBe('✓ Synced with FC');
    expect(document.getElementById('fs-conn-badge').className).toContain('fs-badge-ok');
  });

  it('should trigger successful row notifications and toasts upon writing save confirmation', () => {
    window.Failsafe.init();
    jest.advanceTimersByTime(200);

    const lowSel = document.getElementById('fs-batt-low-sel');
    lowSel.value = '1';

    // Click Save to set pending status
    document.getElementById('fs-save-btn').click();

    // Verify status shows loading/writing state
    expect(document.getElementById('fs-save-badge').textContent).toBe('⟳ Writing to FC…');

    // Send the WS completion confirmation
    window.dispatchEvent(new CustomEvent('calibration_ws_message', {
      detail: { type: 'param_set_sent', param_id: 'BATT_FS_LOW_ACT', value: 1 }
    }));
    window.dispatchEvent(new CustomEvent('calibration_ws_message', {
      detail: { type: 'param_set_sent', param_id: 'BATT_FS_CRT_ACT', value: 0 }
    }));
    window.dispatchEvent(new CustomEvent('calibration_ws_message', {
      detail: { type: 'param_set_sent', param_id: 'FS_THR_ENABLE', value: 0 }
    }));

    // Save badge should update to OK
    expect(document.getElementById('fs-save-badge').textContent).toBe('✓ Saved to FC');
    expect(window.SwUtil.toast).toHaveBeenCalledWith(
      'Failsafe settings written to flight controller',
      false
    );
  });
});

// Jest custom helper to track arguments regardless of wrapper functions
jest.Helper = {
  toHaveBeenNativelyCalledWith: (received, expected) => {
    const pass = received.mock.calls.some(call => {
      try {
        expect(call[0]).toEqual(expected);
        return true;
      } catch (e) {
        return false;
      }
    });
    return {
      pass,
      message: () => `Expected mock to be called with ${JSON.stringify(expected)}`
    };
  }
};
expect.extend({
  toHaveBeenNativelyCalledWith: jest.Helper.toHaveBeenNativelyCalledWith
});
