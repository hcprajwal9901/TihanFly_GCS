describe('Log Download Panel Behavioral Test Suite', () => {
  let originalFetch;
  let msgConsoleMock;
  let originalConfirm;
  let originalAlert;
  let wsMsgCallback;
  let originalQuerySelectorAll;
  let originalQuerySelector;

  beforeAll(() => {
    jest.useFakeTimers();

    // Save aggressive setup.js overrides
    originalQuerySelectorAll = document.querySelectorAll;
    originalQuerySelector = document.querySelector;

    // Mock global Blob and URL methods
    global.Blob = class {
      constructor(content, options) {
        this.content = content;
        this.options = options;
      }
    };

    global.URL = {
      createObjectURL: jest.fn(() => 'blob:mock-url'),
      revokeObjectURL: jest.fn()
    };

    // Mock WebSocket properties on both global and window
    if (global.WebSocket) {
      global.WebSocket.OPEN = 1;
    }
    if (window.WebSocket) {
      window.WebSocket.OPEN = 1;
    }

    // Mock MsgConsole
    msgConsoleMock = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };
    window.MsgConsole = msgConsoleMock;

    originalConfirm = global.confirm;
    originalAlert = global.alert;
    global.confirm = window.confirm = jest.fn().mockReturnValue(true);
    global.alert = window.alert = jest.fn();

    // Setup global window.ws mock object once
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn(),
      addEventListener: jest.fn((evt, cb) => {
        if (evt === 'message') wsMsgCallback = cb;
      })
    };

    // Load Script once
    global.loadScript('js/log-download.js');

    // Run build once so DOM elements are created and listeners are attached permanently
    window.LogDownloadPanel.open();
  });

  afterAll(() => {
    global.confirm = originalConfirm;
    global.alert = originalAlert;
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Neutralize setup.js aggressive DOM guards for clean native DOM querying
    document.querySelectorAll = (sel) => Array.from(document.body.querySelectorAll(sel));
    document.querySelector = (sel) => document.body.querySelector(sel);

    // Reset WebSocket mock calls
    window.ws.send.mockClear();

    // Reset DOM states inside existing container instead of wiping body
    const tbody = document.getElementById('ldTbody');
    if (tbody) {
      tbody.innerHTML = '<tr class="ld-empty"><td colspan="6">Connect to vehicle to load logs</td></tr>';
    }
    const stats = document.getElementById('ldFooterStats');
    if (stats) {
      stats.textContent = '0 logs found';
    }
    const pill = document.getElementById('ldConnPill');
    if (pill) {
      pill.className = 'ld-pill off';
      pill.textContent = '● Not Connected';
    }
    const selAll = document.getElementById('ldSelAll');
    if (selAll) {
      selAll.checked = false;
    }
  });

  afterEach(() => {
    // Restore setup.js overrides
    document.querySelectorAll = originalQuerySelectorAll;
    document.querySelector = originalQuerySelector;
  });

  it('should auto-initialize window.LogDownloadPanel API', () => {
    expect(window.LogDownloadPanel).toBeDefined();
    expect(typeof window.LogDownloadPanel.open).toBe('function');
    expect(typeof window.LogDownloadPanel.close).toBe('function');
  });

  describe('Panel opening and WebSocket connection states', () => {
    it('should show "Backend not connected" if ws is not open on refresh', () => {
      window.ws.readyState = 0; // CLOSED / CONNECTING
      
      const refreshBtn = document.getElementById('ldBtnRefresh');
      refreshBtn.click();

      const tbody = document.getElementById('ldTbody');
      expect(tbody.innerHTML).toContain('Backend not connected');

      const pill = document.getElementById('ldConnPill');
      expect(pill.textContent).toContain('No Connection');
    });

    it('should show "Scanning" and send list_logs if ws is open on refresh', () => {
      window.ws.readyState = 1; // OPEN
      
      const refreshBtn = document.getElementById('ldBtnRefresh');
      refreshBtn.click();

      const tbody = document.getElementById('ldTbody');
      expect(tbody.innerHTML).toContain('Requesting logs from drone…');

      const pill = document.getElementById('ldConnPill');
      expect(pill.textContent).toContain('Scanning…');

      expect(window.ws.send).toHaveBeenCalled();
      const payload = JSON.parse(window.ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('list_logs');
    });
  });

  describe('Log Entries processing and UI rendering', () => {
    it('should parse log_entry payloads and construct rows', () => {
      // Re-trigger refresh to reset lists and scanning state
      window.ws.readyState = 1;
      document.getElementById('ldBtnRefresh').click();

      // Simulate receiving two logs
      const log1 = { type: 'log_entry', id: 1, size: 102400, time_utc: 1622616000 }; // 100 KB
      const log2 = { type: 'log_entry', id: 2, size: 512000, time_utc: 1622619600 }; // 500 KB

      wsMsgCallback({ data: JSON.stringify(log1) });
      wsMsgCallback({ data: JSON.stringify(log2) });

      const rows = document.querySelectorAll('#ldTbody tr');
      expect(rows.length).toBe(2);

      const cellLog2 = rows[0];
      expect(cellLog2.querySelector('td:nth-child(2)').textContent).toBe('# 2');
      expect(cellLog2.querySelector('td:nth-child(5)').textContent).toBe('500.0 KB');

      const cellLog1 = rows[1];
      expect(cellLog1.querySelector('td:nth-child(2)').textContent).toBe('# 1');
      expect(cellLog1.querySelector('td:nth-child(5)').textContent).toBe('100.0 KB');

      const pill = document.getElementById('ldConnPill');
      expect(pill.textContent).toContain('READY');
    });
  });

  describe('Download queue flow, progress, and file reconstruction', () => {
    beforeEach(() => {
      window.ws.readyState = 1;
      document.getElementById('ldBtnRefresh').click();

      // Setup logs list in view
      const log1 = { type: 'log_entry', id: 10, size: 102400, time_utc: 1622616000 };
      wsMsgCallback({ data: JSON.stringify(log1) });
    });

    it('should show alert if downloading with no logs checked', () => {
      const dlBtn = document.getElementById('ldBtnDownload');
      dlBtn.click();

      expect(global.alert).toHaveBeenCalledWith('Select at least one log first.');
    });

    it('should process downloads, update progress indicators, and reconstruct binary files on done', () => {
      // Check the checkbox for log #10
      const chk = document.querySelector('.ld-chk');
      chk.checked = true;

      // Clear list_logs calls
      window.ws.send.mockClear();

      // Start download
      const dlBtn = document.getElementById('ldBtnDownload');
      dlBtn.click();

      // Should send download_log command over WS
      expect(window.ws.send).toHaveBeenCalled();
      const req = JSON.parse(window.ws.send.mock.calls[0][0]);
      expect(req.type).toBe('download_log');
      expect(req.log_id).toBe(10);

      // Verify progress bar active
      const progressWrap = document.getElementById('ld-prog-10');
      expect(progressWrap.classList.contains('active')).toBe(true);

      // Push progress updates (50%)
      const progMsg = { type: 'log_download_progress', log_id: 10, received: 51200, total: 102400 };
      wsMsgCallback({ data: JSON.stringify(progMsg) });

      const fill = document.getElementById('ld-fill-10');
      const lbl = document.getElementById('ld-lbl-10');
      expect(fill.style.width).toBe('50%');
      expect(lbl.textContent).toBe('50%');

      // Mock anchor tags for download reconstruction
      const clickSpy = jest.fn();
      const mockAnchor = {
        href: '',
        download: '',
        click: clickSpy
      };
      const origCreateElement = document.createElement;
      jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'a') return mockAnchor;
        return origCreateElement.call(document, tag);
      });
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

      // Simulate download complete with base64 data for 'Tfly'
      const doneMsg = { type: 'log_download_done', log_id: 10, data: 'VGZseQ==' };
      wsMsgCallback({ data: JSON.stringify(doneMsg) });

      // Verify base64 decode and Blob creation
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(mockAnchor.download).toBe('log_10.bin');
      expect(clickSpy).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      // Verify row updates to "Saved"
      expect(lbl.textContent).toBe('Saved');
      expect(lbl.style.color).toBe('rgb(92, 191, 92)'); // green

      document.createElement.mockRestore();
    });
  });

  describe('Deleting logs from vehicle', () => {
    it('should prompt user on confirm, send erase_logs, and clear log list in UI', () => {
      window.ws.readyState = 1;
      document.getElementById('ldBtnRefresh').click();

      // Mock confirm return value to true
      global.confirm.mockReturnValue(true);

      // Clear list_logs calls
      window.ws.send.mockClear();

      const eraseBtn = document.getElementById('ldBtnErase');
      eraseBtn.click();

      expect(global.confirm).toHaveBeenCalledWith('Delete ALL logs from vehicle? This cannot be undone.');
      
      expect(window.ws.send).toHaveBeenCalled();
      const req = JSON.parse(window.ws.send.mock.calls[0][0]);
      expect(req.type).toBe('erase_logs');

      // Verify table text updates
      const tbody = document.getElementById('ldTbody');
      expect(tbody.innerHTML).toContain('Logs erased from vehicle.');
    });
  });
});