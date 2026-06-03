describe('GCS RC Switch Options Panel High-Fidelity Behavioral Test Suite (param-switch.js)', () => {
  let mockPrivateWs = null;

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
    
    // Mock GCS shared window.ws
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn()
    };

    // Ensure WebSocketMock has the required static constants
    global.WebSocket.OPEN = 1;
    global.WebSocket.CONNECTING = 0;
    global.WebSocket.CLOSING = 2;
    global.WebSocket.CLOSED = 3;

    window.selectedSysId = 1;
    window.activeSysids = [1, 2, 3];

    // Confirm confirm mock
    window.confirm = jest.fn(() => true);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    global.WebSocket.instances = [];

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-param-switch"></div>';

    // Load param-switch.js physically in JSDOM
    global.loadScript('js/param-switch.js');

    // Initialize module
    window.ParamSwitch.init();

    // The connectWebSocket call in init creates the private WebSocket client.
    // Let's flush the macrotask queue so that the mock socket transitions to OPEN.
    jest.advanceTimersByTime(1);
    mockPrivateWs = global.WebSocket.instances[0];
  });

  function triggerPrivateMessage(msg) {
    if (mockPrivateWs && mockPrivateWs.onmessage) {
      mockPrivateWs.onmessage({ data: JSON.stringify(msg) });
    }
  }

  describe('Layout and Selection Maps', () => {
    it('should inject correct structural grids and populate the 8 auxiliary switch rows', () => {
      expect(document.getElementById('swGrid')).toBeTruthy();
      expect(document.getElementById('swWriteBtn')).toBeTruthy();
      expect(document.getElementById('swReadBtn')).toBeTruthy();

      const channels = document.querySelectorAll('.sw-channel');
      expect(channels.length).toBe(8);

      const badges = Array.from(document.querySelectorAll('.sw-ch-badge')).map(el => el.textContent.trim());
      expect(badges).toEqual(['RC 5', 'RC 6', 'RC 7', 'RC 8', 'RC 9', 'RC 10', 'RC 11', 'RC 12']);

      const names = Array.from(document.querySelectorAll('.sw-ch-name')).map(el => el.textContent.trim());
      expect(names).toEqual([
        'RC5_OPTION',
        'RC6_OPTION',
        'RC7_OPTION',
        'RC8_OPTION',
        'RC9_OPTION',
        'RC10_OPTION',
        'RC11_OPTION',
        'RC12_OPTION'
      ]);
    });

    it('should contain full QGC-compliant option dropdown values in alphabetical order', () => {
      const select = document.querySelector('select[data-name="RC5_OPTION"]');
      expect(select).toBeTruthy();

      // alphabetical check
      const optionTexts = Array.from(select.options).map(o => o.textContent);
      expect(optionTexts[0]).toBe('Acro Mode');
      expect(optionTexts[optionTexts.length - 1]).toBe('ZigZag SaveWP');
    });
  });

  describe('Staggered Parameter Fetch Queue', () => {
    it('should trigger staggered param_request_one calls upon reading from FC', () => {
      const readBtn = document.getElementById('swReadBtn');
      // Clear any pending timers from the automatic connect fetch
      jest.clearAllTimers();
      window.ws.send.mockClear();

      readBtn.click();

      // Advance by 1ms to trigger the 0ms staggered timer callback
      jest.advanceTimersByTime(1);

      // Staggers 8 params 80ms apart. First request is fired at i = 0 (0ms)
      expect(window.ws.send).toHaveBeenCalledTimes(1);
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'param_request_one',
        name: 'RC5_OPTION',
        sysid: 1
      }));

      // Fast forward 80ms
      jest.advanceTimersByTime(80);
      expect(window.ws.send).toHaveBeenCalledTimes(2);
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'param_request_one',
        name: 'RC6_OPTION',
        sysid: 1
      }));
    });
  });

  describe('Progress Bar & Backend Stream Updates', () => {
    it('should show correct percentage progress during parameter loading streams', () => {
      const progressBar = document.getElementById('swProgressBar');
      const fill = document.getElementById('swProgressFill');
      const label = document.getElementById('swProgressLabel');

      // Reset the progress bar display to none (in case auto-fetch left it visible)
      progressBar.style.display = 'none';

      expect(progressBar.style.display).toBe('none');

      // Send load start
      triggerPrivateMessage({
        type: 'param_load_start',
        message: 'Reading configurations…'
      });

      expect(progressBar.style.display).toBe('block');
      expect(document.getElementById('swFooterInfo').textContent).toBe('Reading configurations…');

      // Send progress update
      triggerPrivateMessage({
        type: 'param_load_progress',
        percent: 50,
        received: 4,
        total: 8
      });

      expect(fill.style.width).toBe('50%');
      expect(label.textContent).toContain('Loading… 4/8 (50%)');

      // Send complete
      triggerPrivateMessage({
        type: 'param_load_complete',
        count: 8,
        message: 'Sync OK'
      });

      expect(progressBar.style.display).toBe('none');
      expect(document.getElementById('swFooterInfo').textContent).toBe('Sync OK');
    });
  });

  describe('Option Changing, Flagging Unsaved Changes & Writing/Broadcasting', () => {
    it('should style active cards as dirty and enable writing when select options change', () => {
      const select5 = document.querySelector('select[data-name="RC5_OPTION"]');
      const card5 = document.querySelector('.sw-channel[data-name="RC5_OPTION"]');
      const dirtyBadge = document.getElementById('swStatDirty');

      expect(card5.classList.contains('dirty')).toBe(false);
      expect(dirtyBadge.textContent).toBe('0');

      // Change option to 4 (RTL)
      select5.value = '4';
      // In JSDOM, delegated event listeners require { bubbles: true } to trigger
      select5.dispatchEvent(new Event('change', { bubbles: true }));

      expect(card5.classList.contains('dirty')).toBe(true);
      expect(select5.classList.contains('dirty')).toBe(true);
      expect(dirtyBadge.textContent).toBe('1');
    });

    it('should transmit param_set only for modified rows targeting the active drone', () => {
      const select6 = document.querySelector('select[data-name="RC6_OPTION"]');
      select6.value = '9'; // Camera Trigger
      select6.dispatchEvent(new Event('change', { bubbles: true }));

      window.ws.send.mockClear();

      const writeBtn = document.getElementById('swWriteBtn');
      writeBtn.click();

      expect(window.ws.send).toHaveBeenCalledTimes(1);
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'param_set',
        param_id: 'RC6_OPTION',
        value: 9,
        sysid: 1
      }));

      // Confirm clean state after writing
      expect(document.querySelector('.sw-channel[data-name="RC6_OPTION"]').classList.contains('dirty')).toBe(false);
      expect(document.getElementById('swStatDirty').textContent).toBe('0');
      expect(document.getElementById('swFooterInfo').textContent).toContain('sent to FC');
    });

    it('should broadcast param_set to all active drone fleet sysids if selectedSysId is 0 (All Drones)', () => {
      window.selectedSysId = 0; // All Drones
      window.activeSysids = [2, 4, 6];

      const select7 = document.querySelector('select[data-name="RC7_OPTION"]');
      select7.value = '11'; // Fence Enable
      select7.dispatchEvent(new Event('change', { bubbles: true }));

      window.ws.send.mockClear();

      const writeBtn = document.getElementById('swWriteBtn');
      writeBtn.click();

      // Sends 1 request for each active fleet sysid
      expect(window.ws.send).toHaveBeenCalledTimes(3);
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'param_set', param_id: 'RC7_OPTION', value: 11, sysid: 2 }));
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'param_set', param_id: 'RC7_OPTION', value: 11, sysid: 4 }));
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'param_set', param_id: 'RC7_OPTION', value: 11, sysid: 6 }));

      // Restore
      window.selectedSysId = 1;
    });
  });

  describe('Reset Defaults & Confirmation Handling', () => {
    it('should prompt user and reset UI selections to defaults upon confirmation without writing to flight controller', () => {
      // Setup some dirty changes
      const select5 = document.querySelector('select[data-name="RC5_OPTION"]');
      select5.value = '4'; // RTL
      select5.dispatchEvent(new Event('change', { bubbles: true }));

      // Populate some fake FC default via param_value
      triggerPrivateMessage({
        type: 'param_value',
        param_id: 'RC5_OPTION',
        value: 0.0 // Do Nothing
      });

      window.ws.send.mockClear();
      window.confirm.mockClear();

      const resetBtn = document.getElementById('swResetBtn');
      resetBtn.click();

      // User confirmed
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('defaults'));
      
      // Re-query select5 since rebuildGrid replaced it in the DOM
      const newSelect5 = document.querySelector('select[data-name="RC5_OPTION"]');
      expect(newSelect5.value).toBe('0');
      
      // State is no longer dirty in UI
      expect(document.querySelector('.sw-channel[data-name="RC5_OPTION"]').classList.contains('dirty')).toBe(false);
      expect(document.getElementById('swStatDirty').textContent).toBe('0');

      // Verify no changes were sent to FC yet
      expect(window.ws.send).not.toHaveBeenCalled();

      expect(document.getElementById('swFooterInfo').textContent).toContain('defaults (not yet written to FC)');
    });
  });
});