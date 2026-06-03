describe('GCS Vehicle Configuration Setup Panel High-Fidelity Behavioral Test Suite (vehicle-config.js)', () => {
  let wsListeners = [];
  let originalFileReader;

  beforeAll(() => {
    // Restore native JSDOM methods to allow natural null checks and element injections
    document.getElementById = Document.prototype.getElementById;
    document.querySelector = Document.prototype.querySelector;
    document.querySelectorAll = Document.prototype.querySelectorAll;

    jest.useFakeTimers();

    // Mock requestAnimationFrame for sync performance ticks
    global.requestAnimationFrame = (cb) => cb(performance.now());

    // Setup standard WebSocket static states
    if (global.WebSocket) {
      global.WebSocket.CONNECTING = 0;
      global.WebSocket.OPEN = 1;
      global.WebSocket.CLOSING = 2;
      global.WebSocket.CLOSED = 3;
    }

    // Mock global safeSend
    window.safeSend = jest.fn();

    // Setup Mock FileReader
    originalFileReader = global.FileReader;
    class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
      }
      readAsText(file) {
        if (file.name === 'error.apj') {
          if (this.onerror) {
            this.onerror();
          }
        } else {
          if (this.onload) {
            this.onload({
              target: { result: file.content || '{}' }
            });
          }
        }
      }
    }
    global.FileReader = MockFileReader;
  });

  afterAll(() => {
    jest.useRealTimers();
    global.FileReader = originalFileReader;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    wsListeners = [];

    // Setup mock WebSocket object to satisfy immediate attachment logic
    window.ws = {
      addEventListener: jest.fn((event, cb) => {
        if (event === 'message') {
          wsListeners.push(cb);
        }
      }),
      removeEventListener: jest.fn()
    };

    // Setup fresh host overlay container in DOM prior to opening the modal
    document.body.innerHTML = `
      <div id="vehicleConfigOverlay" style="display: none;">
        <div class="vc-body"></div>
        <button id="vcCloseBtn">X</button>
      </div>
    `;

    // Load vehicle-config.js inside beforeEach to reset file-scoped states (unlocked Set, selectedPort, buffers)
    global.loadScript('js/vehicle-config.js');
  });

  function triggerWsMessage(msg) {
    const dataStr = JSON.stringify(msg);
    wsListeners.forEach(cb => cb({ data: dataStr }));
  }

  describe('Overlay Lifecycle & Initial Setup', () => {
    it('should open overlay, inject buildHTML elements, restore states, and scan ports', () => {
      expect(document.getElementById('vehicleConfigOverlay').style.display).toBe('none');

      // Open panel
      window.VehicleConfig.open();

      const overlay = document.getElementById('vehicleConfigOverlay');
      expect(overlay.style.display).toBe('flex');
      expect(overlay.querySelector('.vc-layout')).toBeTruthy();

      // Check default static log placeholder in DOM
      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('Vehicle Configuration ready.');

      // Check auto-scan message was dispatched
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'list_serial_ports' });
    });

    it('should smoothly hide overlay with fade-out delay when closed', () => {
      window.VehicleConfig.open();
      const overlay = document.getElementById('vehicleConfigOverlay');

      window.VehicleConfig.close();
      expect(overlay.style.opacity).toBe('0');

      // Advance timers to trigger display: none
      jest.advanceTimersByTime(200);
      expect(overlay.style.display).toBe('none');
    });

    it('should trigger close when close button or overlay backdrop background is clicked', () => {
      window.VehicleConfig.open();
      const overlay = document.getElementById('vehicleConfigOverlay');
      const closeBtn = document.getElementById('vcCloseBtn');

      closeBtn.click();
      expect(overlay.style.opacity).toBe('0');

      window.VehicleConfig.open();
      overlay.style.opacity = '1';

      // Click backdrop background
      overlay.dispatchEvent(new Event('click'));
      expect(overlay.style.opacity).toBe('0');
    });
  });

  describe('Serial Port Population & Management', () => {
    beforeEach(() => {
      window.VehicleConfig.open();
    });

    it('should present placeholder scanning row in port table initially', () => {
      const tableRows = document.querySelectorAll('.vc-port-table tbody tr');
      expect(tableRows.length).toBe(1);
      expect(tableRows[0].classList.contains('vc-port-row-placeholder')).toBe(true);
      expect(tableRows[0].textContent).toContain('Scanning ports…');
    });

    it('should populate list when serial_ports message arrives and allow port selection', () => {
      const mockPorts = [
        { port: 'COM3', board_id: 'v4', manufacturer: 'STMicroelectronics', brand: 'Pixhawk', description: 'FMU v4 Serial' },
        { port: 'COM4', board_id: 'v5', manufacturer: 'Hex', brand: 'Cube', description: 'Cube Orange Serial' }
      ];

      // Simulate WS serial ports push
      triggerWsMessage({ type: 'serial_ports', ports: mockPorts });

      const rows = document.querySelectorAll('.vc-port-row');
      expect(rows.length).toBe(2);
      expect(rows[0].children[0].textContent).toBe('COM3');
      expect(rows[0].children[1].textContent).toBe('v4');
      expect(rows[0].children[2].textContent).toBe('STMicroelectronics');
      expect(rows[0].children[3].textContent).toBe('Pixhawk');
      expect(rows[0].children[4].textContent).toBe('FMU v4 Serial');

      // Click first port COM3
      rows[0].dispatchEvent(new Event('click'));
      expect(rows[0].classList.contains('vc-selected')).toBe(true);
      expect(rows[1].classList.contains('vc-selected')).toBe(false);

      // Verify selected port logs
      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('Port selected: COM3');
    });

    it('should display warning in log when empty port scan occurs', () => {
      triggerWsMessage({ type: 'serial_ports', ports: [] });

      const tableRows = document.querySelectorAll('.vc-port-table tbody tr');
      expect(tableRows.length).toBe(1);
      expect(tableRows[0].textContent).toContain('No serial ports found');

      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('No serial ports found.');
    });

    it('should dispatch list_serial_ports command on clicking refresh ports button', () => {
      const refreshBtn = document.getElementById('vcRefreshPortsBtn');
      window.safeSend.mockClear();

      refreshBtn.click();
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'list_serial_ports' });
    });
  });

  describe('Drone Security & Unlock Password Modal', () => {
    beforeEach(() => {
      window.VehicleConfig.open();
    });

    it('should display security backdrop and modal card upon unlock request', () => {
      const card = document.querySelector('.vc-drone-card[data-drone="ti-shadow"]');
      const unlockBtn = card.querySelector('.vc-btn-unlock');

      unlockBtn.click();

      // Verify backdrop is injected in DOM
      const backdrop = document.querySelector('.vc-pw-backdrop');
      expect(backdrop).toBeTruthy();
      expect(backdrop.querySelector('.vc-pw-title').textContent).toBe('Unlock Required');
      expect(backdrop.querySelector('.vc-pw-drone-badge').textContent).toContain('Ti-Shadow');
    });

    it('should toggle password visibility on clicking the unmask eye toggle button', () => {
      const card = document.querySelector('.vc-drone-card[data-drone="ti-shadow"]');
      card.querySelector('.vc-btn-unlock').click();

      const backdrop = document.querySelector('.vc-pw-backdrop');
      const input = backdrop.querySelector('#vcPwInput');
      const toggleBtn = backdrop.querySelector('#vcPwToggle');

      expect(input.type).toBe('password');

      // Click to toggle to text
      toggleBtn.click();
      expect(input.type).toBe('text');

      // Click to toggle back to password
      toggleBtn.click();
      expect(input.type).toBe('password');
    });

    it('should trigger shaking animation and display error message on wrong password', () => {
      const card = document.querySelector('.vc-drone-card[data-drone="ti-shadow"]');
      card.querySelector('.vc-btn-unlock').click();

      const backdrop = document.querySelector('.vc-pw-backdrop');
      const input = backdrop.querySelector('#vcPwInput');
      const confirmBtn = backdrop.querySelector('#vcPwConfirm');
      const errMsg = backdrop.querySelector('#vcPwErrMsg');

      // Input wrong password
      input.value = 'wrongpassword';
      confirmBtn.click();

      expect(input.classList.contains('vc-pw-error')).toBe(true);
      expect(errMsg.classList.contains('visible')).toBe(true);
      expect(input.value).toBe('');

      // Advance timers to clear shake class
      jest.advanceTimersByTime(400);
      expect(input.classList.contains('vc-pw-error')).toBe(false);

      // Typing should clear error layout indicators
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      expect(errMsg.classList.contains('visible')).toBe(false);
    });

    it('should complete unlock, persist state, and unlock install button on correct password', () => {
      const card = document.querySelector('.vc-drone-card[data-drone="ti-shadow"]');
      const unlockBtn = card.querySelector('.vc-btn-unlock');
      const installBtn = card.querySelector('.vc-btn-install');

      unlockBtn.click();

      const backdrop = document.querySelector('.vc-pw-backdrop');
      const input = backdrop.querySelector('#vcPwInput');
      const confirmBtn = backdrop.querySelector('#vcPwConfirm');

      // Correct password for ti-shadow: tishadow@123
      input.value = 'tishadow@123';
      confirmBtn.click();

      // Advance timers to process closeModal remove transitions (150ms)
      jest.advanceTimersByTime(150);

      // Check modal got removed
      expect(document.querySelector('.vc-pw-backdrop')).toBeNull();

      // Verify persistent UI state
      expect(unlockBtn.textContent).toContain('UNLOCKED');
      expect(unlockBtn.disabled).toBe(true);
      expect(installBtn.classList.contains('vc-unlocked')).toBe(true);

      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('Ti-Shadow unlocked — install enabled.');
    });

    it('should dismiss modal when cancel button, Escape key, or backdrop itself is clicked', () => {
      const card = document.querySelector('.vc-drone-card[data-drone="ti-shadow"]');
      card.querySelector('.vc-btn-unlock').click();

      let backdrop = document.querySelector('.vc-pw-backdrop');
      expect(backdrop).toBeTruthy();

      // Press Escape key
      const input = backdrop.querySelector('#vcPwInput');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      jest.advanceTimersByTime(150);
      expect(document.querySelector('.vc-pw-backdrop')).toBeNull();

      // Re-trigger modal
      card.querySelector('.vc-btn-unlock').click();
      backdrop = document.querySelector('.vc-pw-backdrop');
      expect(backdrop).toBeTruthy();

      // Click Cancel
      backdrop.querySelector('#vcPwCancel').click();
      jest.advanceTimersByTime(150);
      expect(document.querySelector('.vc-pw-backdrop')).toBeNull();

      // Re-trigger modal
      card.querySelector('.vc-btn-unlock').click();
      backdrop = document.querySelector('.vc-pw-backdrop');
      expect(backdrop).toBeTruthy();

      // Click outside overlay backdrop
      backdrop.dispatchEvent(new Event('click'));
      jest.advanceTimersByTime(150);
      expect(document.querySelector('.vc-pw-backdrop')).toBeNull();
    });
  });

  describe('Install Button Locking/Unlocking and Port Guard Verification Rules', () => {
    it('should disable install buttons until BOTH drone is unlocked and port is selected', () => {
      window.VehicleConfig.open();

      const card = document.querySelector('.vc-drone-card[data-drone="spider"]');
      const installBtn = card.querySelector('.vc-btn-install');

      // Unlocked: false, Port Selected: false
      expect(installBtn.disabled).toBe(true);

      // Select port
      triggerWsMessage({
        type: 'serial_ports',
        ports: [{ port: 'COM5', board_id: 'v4', manufacturer: 'Hex', brand: 'Pixhawk' }]
      });
      document.querySelector('.vc-port-row').click();

      // Unlocked: false, Port Selected: true
      expect(installBtn.disabled).toBe(true);

      // Unlock drone (correct password for spider is spider@123)
      card.querySelector('.vc-btn-unlock').click();
      const backdrop = document.querySelector('.vc-pw-backdrop');
      backdrop.querySelector('#vcPwInput').value = 'spider@123';
      backdrop.querySelector('#vcPwConfirm').click();
      jest.advanceTimersByTime(150);

      // Unlocked: true, Port Selected: true
      expect(installBtn.disabled).toBe(false);
      expect(installBtn.style.opacity).toBe('');
      expect(installBtn.style.cursor).toBe('pointer');
    });

    it('should persist unlock states across multiple open and close lifecycle sessions', () => {
      window.VehicleConfig.open();

      const card = document.querySelector('.vc-drone-card[data-drone="kala"]');
      const installBtn = card.querySelector('.vc-btn-install');

      // Unlock kala drone (password kala@123)
      card.querySelector('.vc-btn-unlock').click();
      let backdrop = document.querySelector('.vc-pw-backdrop');
      backdrop.querySelector('#vcPwInput').value = 'kala@123';
      backdrop.querySelector('#vcPwConfirm').click();
      jest.advanceTimersByTime(150);

      expect(installBtn.classList.contains('vc-unlocked')).toBe(true);

      // Close panel
      window.VehicleConfig.close();
      jest.advanceTimersByTime(200);

      // Reopen panel
      window.VehicleConfig.open();

      const newCard = document.querySelector('.vc-drone-card[data-drone="kala"]');
      const newInstallBtn = newCard.querySelector('.vc-btn-install');
      const newUnlockBtn = newCard.querySelector('.vc-btn-unlock');

      expect(newInstallBtn.classList.contains('vc-unlocked')).toBe(true);
      expect(newUnlockBtn.textContent).toContain('UNLOCKED');
      expect(newUnlockBtn.disabled).toBe(true);
    });
  });

  describe('Firmware File Uploading & Parsing Stream', () => {
    let installBtn;

    beforeEach(() => {
      window.VehicleConfig.open();

      // Setup active port selection
      triggerWsMessage({
        type: 'serial_ports',
        ports: [{ port: 'COM7', board_id: 'v5', manufacturer: 'STMicroelectronics' }]
      });
      document.querySelector('.vc-port-row').click();

      // Setup unlocked drone (kala, password: kala@123)
      const card = document.querySelector('.vc-drone-card[data-drone="kala"]');
      card.querySelector('.vc-btn-unlock').click();
      const backdrop = document.querySelector('.vc-pw-backdrop');
      backdrop.querySelector('#vcPwInput').value = 'kala@123';
      backdrop.querySelector('#vcPwConfirm').click();
      jest.advanceTimersByTime(150);

      installBtn = card.querySelector('.vc-btn-install');
    });

    it('should build temporary file picker and log warning if user cancels selection', () => {
      const originalCreate = document.createElement;
      let createdInput = null;

      document.createElement = function(tagName) {
        const el = originalCreate.call(document, tagName);
        if (tagName === 'input') {
          createdInput = el;
        }
        return el;
      };

      installBtn.click();

      expect(createdInput).toBeTruthy();
      expect(createdInput.type).toBe('file');
      expect(createdInput.accept).toBe('.apj,application/json');

      // Setup writeable empty files array
      Object.defineProperty(createdInput, 'files', {
        value: [],
        writable: true
      });

      // Trigger change event with NO files (simulating file selection cancel)
      createdInput.dispatchEvent(new Event('change'));

      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('No file selected — install cancelled.');

      document.createElement = originalCreate;
    });

    it('should load the file content, validate json schemas, and dispatch backend install parameters', () => {
      let createdInput = null;
      const originalCreate = document.createElement;
      document.createElement = function(tagName) {
        const el = originalCreate.call(document, tagName);
        if (tagName === 'input') {
          createdInput = el;
        }
        return el;
      };

      installBtn.click();

      // Create a valid mock file payload
      const validMockFile = {
        name: 'tfly-subsystem.apj',
        size: 20480,
        content: JSON.stringify({
          image: 'aHR0cHM6Ly9naXRodWIuY29tL3RpaGFuZmx5',
          version: '1.2.3'
        })
      };

      // Define writeable files on the created element
      Object.defineProperty(createdInput, 'files', {
        value: [validMockFile],
        writable: true
      });

      createdInput.dispatchEvent(new Event('change'));

      // Check log updates
      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('Selected: tfly-subsystem.apj');
      expect(logBox.textContent).toContain('Port: COM7  |  Drone: kala');
      expect(logBox.textContent).toContain('Firmware file read OK — starting installation…');

      // Check safeSend firmware download dispatcher payload parameters
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'install_firmware_custom',
        drone: 'kala',
        port: 'COM7',
        boot_baud: 115200,
        apj: {
          image: 'aHR0cHM6Ly9naXRodWIuY29tL3RpaGFuZmx5',
          version: '1.2.3'
        }
      });

      // Verify button disables during active upload stream
      expect(installBtn.disabled).toBe(true);
      expect(installBtn.style.opacity).toBe('0.5');

      document.createElement = originalCreate;
    });

    it('should validate JSON syntax in uploads and show warning message for missing image field', () => {
      let createdInput = null;
      const originalCreate = document.createElement;
      document.createElement = function(tagName) {
        const el = originalCreate.call(document, tagName);
        if (tagName === 'input') {
          createdInput = el;
        }
        return el;
      };

      // 1. Test invalid JSON parsing error handling
      installBtn.click();
      const invalidJsonFile = {
        name: 'corrupted.apj',
        size: 512,
        content: '{"bad json'
      };

      Object.defineProperty(createdInput, 'files', {
        value: [invalidJsonFile],
        writable: true
      });

      createdInput.dispatchEvent(new Event('change'));

      let logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('APJ file is not valid JSON');
      // Button re-enabled
      expect(installBtn.disabled).toBe(false);

      // 2. Test missing "image" field warning
      installBtn.click();
      const missingImageFile = {
        name: 'no-image.apj',
        size: 1024,
        content: JSON.stringify({ version: '1.0' })
      };

      Object.defineProperty(createdInput, 'files', {
        value: [missingImageFile],
        writable: true
      });

      createdInput.dispatchEvent(new Event('change'));

      logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('APJ file has no "image" field');

      document.createElement = originalCreate;
    });
  });

  describe('WebSocket Firmware Status Messages & Log/Progress Terminal Updating', () => {
    let eraseBar;
    let writeBar;
    let logBox;

    beforeEach(() => {
      window.VehicleConfig.open();
      eraseBar = document.getElementById('vcEraseBar');
      writeBar = document.getElementById('vcWriteBar');
      logBox = document.getElementById('vcFlashLog');
    });

    it('should handle firmware_status preflight check messages', () => {
      triggerWsMessage({
        type: 'firmware_status',
        stage: 'preflight',
        message: '🔍 Initializing loader environment'
      });
      expect(logBox.textContent).toContain('Initializing loader environment');
    });

    it('should wipe previous state buffers and logs when starting a fresh flash session', () => {
      // Simulate some prior progress
      triggerWsMessage({ type: 'firmware_status', stage: 'erase', progress: 50 });
      expect(eraseBar.style.width).toBe('50%');

      // Fire a fresh start session
      triggerWsMessage({
        type: 'firmware_status',
        stage: 'start',
        message: '🚀 Beginning firmware installer stream'
      });

      // Assert visual progress reset
      expect(eraseBar.style.width).toBe('0%');
      expect(writeBar.style.width).toBe('0%');

      // The prior log contents should be wiped completely, leaving only the start message
      expect(logBox.textContent.trim()).toBe('→ 🚀 Beginning firmware installer stream');
    });

    it('should parse progressive log strings, highlight error types, and suppress repetitive lines', () => {
      triggerWsMessage({ type: 'firmware_status', stage: 'start' });

      // Trigger standard logs
      triggerWsMessage({ type: 'firmware_status', stage: 'log', message: 'Connecting to board...' });
      triggerWsMessage({ type: 'firmware_status', stage: 'log', message: '✓ Handshake successful' });
      triggerWsMessage({ type: 'firmware_status', stage: 'log', message: '❌ Incompatible board target' });
      triggerWsMessage({ type: 'firmware_status', stage: 'log', message: '⚠ Power supply fluctuates' });

      // Trigger repetitive write percent string (which must be suppressed from log window)
      triggerWsMessage({ type: 'firmware_status', stage: 'log', message: '→ Write: 42 %' });

      const text = logBox.textContent;
      expect(text).toContain('Connecting to board...');
      expect(text).toContain('✓ Handshake successful');
      expect(text).toContain('❌ Incompatible board target');
      expect(text).toContain('⚠ Power supply fluctuates');

      // Confirm percent string is suppressed
      expect(text).not.toContain('Write: 42 %');
    });

    it('should update erase progress and record logs on 10% milestones', () => {
      triggerWsMessage({ type: 'firmware_status', stage: 'erase', progress: 0 });
      expect(eraseBar.style.width).toBe('0%');
      expect(logBox.textContent).toContain('Erasing flash… 0%');

      triggerWsMessage({ type: 'firmware_status', stage: 'erase', progress: 15 });
      expect(eraseBar.style.width).toBe('15%');
      // No log written since 15% is not a 10% milestone
      expect(logBox.textContent).not.toContain('Erasing flash… 15%');

      triggerWsMessage({ type: 'firmware_status', stage: 'erase', progress: 20 });
      expect(eraseBar.style.width).toBe('20%');
      expect(logBox.textContent).toContain('Erasing flash… 20%');
    });

    it('should update program progress and record logs on 10% milestones', () => {
      triggerWsMessage({ type: 'firmware_status', stage: 'program', progress: 0 });
      expect(writeBar.style.width).toBe('0%');
      expect(logBox.textContent).toContain('Programming firmware… 0%');

      triggerWsMessage({ type: 'firmware_status', stage: 'program', progress: 75 });
      expect(writeBar.style.width).toBe('75%');
      expect(logBox.textContent).not.toContain('Programming firmware… 75%');

      triggerWsMessage({ type: 'firmware_status', stage: 'program', progress: 80 });
      expect(writeBar.style.width).toBe('80%');
      expect(logBox.textContent).toContain('Programming firmware… 80%');
    });

    it('should complete flashing successfully, fill bars to 100%, and trigger re-enablement', () => {
      triggerWsMessage({
        type: 'firmware_status',
        stage: 'complete',
        message: 'Successfully installed'
      });

      expect(eraseBar.style.width).toBe('100%');
      expect(writeBar.style.width).toBe('100%');
      expect(logBox.textContent).toContain('FLASH COMPLETED SUCCESSFULLY!');
    });

    it('should process troubleshooting multi-line arrays and warnings', () => {
      triggerWsMessage({
        type: 'firmware_status',
        stage: 'troubleshoot',
        message: 'Verify cable connection\nCheck bootloader driver'
      });

      expect(logBox.textContent).toContain('Verify cable connection');
      expect(logBox.textContent).toContain('Check bootloader driver');
    });

    it('should fallback to legacy message structures for backward-compatibility', () => {
      // Legacy firmware log
      triggerWsMessage({
        type: 'firmware_log',
        message: 'Erasing previous program...'
      });
      expect(logBox.textContent).toContain('Erasing previous program...');

      // Legacy firmware progress
      triggerWsMessage({
        type: 'firmware_progress',
        stage: 'erase',
        percent: 65
      });
      expect(eraseBar.style.width).toBe('65%');

      // Legacy result success
      triggerWsMessage({
        type: 'firmware_result',
        success: true,
        message: 'System up-to-date!'
      });
      expect(eraseBar.style.width).toBe('100%');
      expect(writeBar.style.width).toBe('100%');
      expect(logBox.textContent).toContain('System up-to-date!');
    });

    it('should preserve and replay complete session log buffers when closed and reopened mid-flash', () => {
      triggerWsMessage({ type: 'firmware_status', stage: 'start' });
      triggerWsMessage({ type: 'firmware_status', stage: 'log', message: 'Reading boot sector' });
      triggerWsMessage({ type: 'firmware_status', stage: 'erase', progress: 40 });

      // Close the modal
      window.VehicleConfig.close();
      jest.advanceTimersByTime(200);

      // Reopen the modal
      window.VehicleConfig.open();

      const newLogBox = document.getElementById('vcFlashLog');
      const newEraseBar = document.getElementById('vcEraseBar');

      // Confirm replayed state
      expect(newEraseBar.style.width).toBe('40%');
      expect(newLogBox.textContent).toContain('Reading boot sector');
      expect(newLogBox.textContent).toContain('Erasing flash… 40%');
    });
  });

  describe('WebSocket Port Plug-and-Play Router Events', () => {
    it('should trigger new list scan and log when port plug-and-play event is dispatched', () => {
      window.VehicleConfig.open();
      window.safeSend.mockClear();

      // Dispatch port plugging event
      triggerWsMessage({
        type: 'port_appeared',
        port: 'COM9'
      });

      // Verify router commands list scan refresh
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'list_serial_ports' });

      // Dispatch port unplugging event
      triggerWsMessage({
        type: 'port_disappeared',
        port: 'COM9'
      });

      // Check log notifications
      const logBox = document.getElementById('vcFlashLog');
      expect(logBox.textContent).toContain('Port disconnected: COM9');
    });
  });
});