describe('GCS Compass Calibration High-Fidelity Behavioral Test Suite (calib-compass.js)', () => {
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

    // Mock HTMLCanvasElement context to include fillRect and createRadialGradient
    if (typeof HTMLCanvasElement !== 'undefined') {
      HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
        clearRect: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        fill: jest.fn(),
        arc: jest.fn(),
        fillText: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        rotate: jest.fn(),
        drawImage: jest.fn(),
        createLinearGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
        createRadialGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
        fillRect: jest.fn(),
        closePath: jest.fn()
      });
    }

    // Load script physically in JSDOM
    global.loadScript('js/calib-compass.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    wsListeners = [];

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-calib-compass"></div>';

    // Mock WebSocket with complete event handling
    mockSocket = {
      url: 'ws://mock-calib-compass',
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
      try {
        listener(event);
      } catch (err) {
        // Suppress errors during dispatch
      }
    });

    // Also dispatch as custom window event if any other handlers are registered
    window.dispatchEvent(new CustomEvent('calibration_ws_message', { detail: data }));
  }

  describe('Layout Injection & Priority Reordering', () => {
    it('should inject correct HTML templates, render rows, and allow priority row sorting up/down', () => {
      window.CalibCompass.init();

      // Check default rows are generated
      const rows = document.querySelectorAll('.compass-priority-table tbody tr');
      expect(rows.length).toBe(2);
      expect(rows[0].querySelector('td:nth-child(2)').textContent).toBe('97539'); // DevID of first row
      expect(rows[1].querySelector('td:nth-child(2)').textContent).toBe('131874'); // DevID of second row

      // Target row click select
      rows[1].click();
      expect(rows[1].classList.contains('selected')).toBe(true);
      expect(rows[0].classList.contains('selected')).toBe(false);

      // Click "Move Up" button on row 1 to swap rows
      const upBtn = rows[1].querySelector('.arrow-btn[data-dir="up"]');
      upBtn.click();

      const newRows = document.querySelectorAll('.compass-priority-table tbody tr');
      expect(newRows[0].querySelector('td:nth-child(2)').textContent).toBe('131874'); // Now first
      expect(newRows[1].querySelector('td:nth-child(2)').textContent).toBe('97539'); // Now second

      // Check priority index numbers columns are re-indexed
      expect(newRows[0].querySelector('td:first-child').textContent).toBe('1');
      expect(newRows[1].querySelector('td:first-child').textContent).toBe('2');
    });

    it('should allow removing missing compasses checkboxes', () => {
      window.CalibCompass.init();

      const removeBtn = document.querySelector('.remove-missing-btn');
      expect(removeBtn).toBeTruthy();

      // Verify row 1 has missing checkbox checked
      const rowsBefore = document.querySelectorAll('.compass-priority-table tbody tr');
      expect(rowsBefore.length).toBe(2);

      // Click Remove Missing button
      removeBtn.click();

      // Second row devId: 131874 has missing = true, should be removed
      const rowsAfter = document.querySelectorAll('.compass-priority-table tbody tr');
      expect(rowsAfter.length).toBe(1);
      expect(rowsAfter[0].querySelector('td:nth-child(2)').textContent).toBe('97539');
    });
  });

  describe('MagCal Calibration Commands & Toggles', () => {
    it('should start calibration with large vehicle toggles and cancel active session', () => {
      window.CalibCompass.init();

      const startBtn = document.getElementById('compassStartBtn');
      const cancelBtn = document.getElementById('compassCancelBtn');

      expect(startBtn.disabled).toBe(false);
      expect(cancelBtn.disabled).toBe(true);

      // Click Start
      startBtn.click();

      expect(startBtn.disabled).toBe(true);
      expect(cancelBtn.disabled).toBe(false);
      expect(document.getElementById('compassRingOverlay').style.display).toBe('flex');
      expect(document.getElementById('magStatusText').textContent).toBe('Sending calibration command…');

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_compass_calibration', sysid: 1 })
      );

      // Click Cancel
      mockSocket.send.mockClear();
      cancelBtn.click();

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'cancel_compass_calibration', sysid: 1 })
      );
    });

    it('should support large vehicle calibration triggers', () => {
      window.CalibCompass.init();

      const startBtn = document.getElementById('compassStartBtn');
      const checkLarge = document.getElementById('largeVehicleChk');

      checkLarge.checked = true;
      startBtn.click();

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_compass_calibration', sysid: 1, large_vehicle: true })
      );
    });

    it('should trigger large vehicle magcal button directly', () => {
      window.CalibCompass.init();

      const largeBtn = document.getElementById('largeVehicleMagCalBtn');
      largeBtn.click();

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'start_compass_calibration', sysid: 1, large_vehicle: true })
      );
    });
  });

  describe('WebSocket MagCal Progress & Status Updates', () => {
    it('should update progress bars, active indicators, and plot canvas dots', () => {
      window.CalibCompass.init();

      // Trigger calibration_status text
      triggerSocketMessage({
        type: 'compass_calibration_status',
        message: 'Rotate drone around roll axis'
      });
      expect(document.getElementById('magStatusText').textContent).toBe('Rotate drone around roll axis');

      // Trigger compass progress
      triggerSocketMessage({
        type: 'compass_progress',
        compass_id: 0,
        progress: 45
      });

      const bar1 = document.getElementById('mag1-bar');
      const pct1 = document.getElementById('mag1-label');
      const activeDot1 = document.getElementById('magActiveDot0');
      const row1 = document.getElementById('magBarRow0');

      expect(bar1.style.width).toBe('45%');
      expect(pct1.textContent).toBe('45%');
      expect(activeDot1.classList.contains('active')).toBe(true);
      expect(row1.classList.contains('mag-bar-active')).toBe(true);
      expect(document.getElementById('magStatusText').textContent).toContain('MAG1: 45%');

      // Trigger compass_result for individual compass done (compass_done)
      triggerSocketMessage({
        type: 'compass_result',
        status: 'compass_done',
        compass_id: 0
      });

      expect(bar1.style.width).toBe('100%');
      expect(bar1.style.background).toBe('rgb(0, 230, 118)'); // #00e676 green color
      expect(pct1.textContent).toBe('100%');
    });
  });

  describe('MagCal Result Handling & Reboot Overlay', () => {
    it('should handle final success done result, pop reboot overlay, and write reboot FC command', () => {
      window.CalibCompass.init();

      const startBtn = document.getElementById('compassStartBtn');
      const cancelBtn = document.getElementById('compassCancelBtn');

      // Simulate running state
      startBtn.disabled = true;
      cancelBtn.disabled = false;

      // Trigger final done
      triggerSocketMessage({
        type: 'compass_result',
        status: 'done',
        message: 'Offsets calculated'
      });

      expect(startBtn.disabled).toBe(false);
      expect(cancelBtn.disabled).toBe(true);
      expect(document.getElementById('compassRingOverlay').style.display).toBe('none');
      expect(document.getElementById('magStatusText').textContent).toContain('Offsets calculated');

      // Assert reboot popup overlay is shown
      const rebootPopup = document.getElementById('rebootPopupOverlay');
      expect(rebootPopup.style.display).toBe('flex');

      // Click Later in reboot popup
      document.getElementById('rebootPopupLaterBtn').click();
      expect(rebootPopup.style.display).toBe('none');

      // Call manual reboot button
      document.getElementById('rebootBtn').click();
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'reboot_vehicle', sysid: 1 })
      );

      // Call popup confirm reboot button
      mockSocket.send.mockClear();
      rebootPopup.style.display = 'flex';
      document.getElementById('rebootPopupConfirmBtn').click();
      expect(rebootPopup.style.display).toBe('none');
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'reboot_vehicle', sysid: 1 })
      );
    });

    it('should handle failed MagCal result, mark bars red, and indicate failures', () => {
      window.CalibCompass.init();

      // Trigger active progress on Mag1 and Mag2
      triggerSocketMessage({
        type: 'compass_progress',
        compass_id: 0,
        progress: 80
      });
      triggerSocketMessage({
        type: 'compass_progress',
        compass_id: 1,
        progress: 20
      });

      // Trigger failure result
      triggerSocketMessage({
        type: 'compass_result',
        status: 'failed',
        compass_id: 0, // Mag 1 failed
        message: 'Sphere fit failed'
      });

      const bar1 = document.getElementById('mag1-bar');
      const pct1 = document.getElementById('mag1-label');
      expect(bar1.style.width).toBe('100%');
      expect(bar1.style.background).toBe('rgb(255, 82, 82)'); // #ff5252 red color
      expect(pct1.textContent).toBe('FAIL');

      const bar2 = document.getElementById('mag2-bar');
      const pct2 = document.getElementById('mag2-label');
      expect(pct2.textContent).toBe('20% ✕'); // interrupted
    });
  });
});