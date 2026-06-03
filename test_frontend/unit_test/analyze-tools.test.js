describe('Analyze Tools Suite (js/analyze-tools.js)', () => {
  let originalGetElementById;
  let originalQuerySelector;
  let originalQuerySelectorAll;

  beforeAll(() => {
    // Preserve setup.js custom selector guards
    originalGetElementById = document.getElementById;
    originalQuerySelector = document.querySelector;
    originalQuerySelectorAll = document.querySelectorAll;

    // Temporarily bind native JSDOM selectors to bypass auto-creation of elements
    document.getElementById = Document.prototype.getElementById.bind(document);
    document.querySelector = Document.prototype.querySelector.bind(document);
    document.querySelectorAll = Document.prototype.querySelectorAll.bind(document);

    global.WebSocket.OPEN = 1;

    // Mock URL helper
    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-log-bytes');
    global.URL.revokeObjectURL = jest.fn();

    // Mock global alert and confirm
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);

    // Mock global websocket will be recreated in beforeEach

    // Load module script exactly once
    global.loadScript('js/analyze-tools.js');
  });

  afterAll(() => {
    // Restore setup.js custom selector guards for other suites
    document.getElementById = originalGetElementById;
    document.querySelector = originalQuerySelector;
    document.querySelectorAll = originalQuerySelectorAll;

    document.body.innerHTML = '';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Stub message console
    window.MsgConsole = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      log: jest.fn()
    };

    // Recreate fresh global websocket to reset _atw_listener and mock calls
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn(),
      addEventListener: jest.fn()
    };

    // Clean up window states
    window.AnalyzeToolsPanel.closeAll();
  });

  it('should initialize and construct sidebar analyzePanel and tool windows', () => {
    window.AnalyzeToolsPanel.showAnalyzePanel();

    const panel = document.getElementById('analyzePanel');
    const dlWin = document.getElementById('atw-log-download');
    const insWin = document.getElementById('atw-mavlink-inspector');

    expect(panel).not.toBeNull();
    expect(dlWin).not.toBeNull();
    expect(insWin).not.toBeNull();

    expect(panel.classList.contains('ap-on')).toBe(true);
  });

  describe('Log Download Tool Flows', () => {
    beforeEach(() => {
      window.AnalyzeToolsPanel.openTool('log-download');
    });

    it('should refresh logs and send list_logs command to websocket', () => {
      window.AnalyzeToolsPanel._refreshLogs();

      // Verify list command sent
      expect(window.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'list_logs' })
      );

      const tableBody = document.getElementById('logTbody');
      expect(tableBody.textContent).toContain('Requesting logs from drone…');
    });

    it('should parse ws log entries and render table rows with checksum controls', () => {
      // Refresh logs first to attach the ws listener
      window.AnalyzeToolsPanel._refreshLogs();

      // Simulate ws message handler callback
      const wsHandler = window.ws.addEventListener.mock.calls.find(call => call[0] === 'message')[1];

      // Send 2 log entries
      wsHandler({
        data: JSON.stringify({
          type: 'log_entry',
          id: 1,
          size: 1048576, // 1MB
          time_utc: 1774830000,
          num_logs: 2
        })
      });

      wsHandler({
        data: JSON.stringify({
          type: 'log_entry',
          id: 2,
          size: 2097152, // 2MB
          time_utc: 1774840000,
          num_logs: 2
        })
      });

      // Verify rows rendered
      const row1 = document.getElementById('logrow_1');
      const row2 = document.getElementById('logrow_2');
      expect(row1).not.toBeNull();
      expect(row2).not.toBeNull();

      expect(row1.innerHTML).toContain('1.00 MB');
      expect(row2.innerHTML).toContain('2.00 MB');
    });

    it('should support checking all logs via header toggle', () => {
      const selectAll = document.getElementById('logSelAll');
      
      // Simulate rendering checkbox list
      const tbody = document.getElementById('logTbody');
      tbody.innerHTML = `
        <tr><td><input type="checkbox" class="lchk" data-lid="1"></td></tr>
        <tr><td><input type="checkbox" class="lchk" data-lid="2"></td></tr>
      `;

      selectAll.checked = true;
      window.AnalyzeToolsPanel._selAll(selectAll);

      const checkBoxes = tbody.querySelectorAll('.lchk');
      expect(checkBoxes[0].checked).toBe(true);
      expect(checkBoxes[1].checked).toBe(true);
    });

    it('should request single log downloads and broadcast progress updates', () => {
      // Refresh logs first to attach the ws listener
      window.AnalyzeToolsPanel._refreshLogs();

      window.AnalyzeToolsPanel._dlLog(5, 500000);

      // Verify command sent
      expect(window.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'download_log', log_id: 5, log_size: 500000 })
      );

      // Verify progress element activated
      const prog = document.getElementById('logprog_5');
      if (prog) {
        expect(prog.classList.contains('active')).toBe(true);
      }

      // Simulate progress events
      const wsHandler = window.ws.addEventListener.mock.calls.find(call => call[0] === 'message')[1];
      wsHandler({
        data: JSON.stringify({
          type: 'log_download_progress',
          log_id: 5,
          received: 250000,
          total: 500000
        })
      });

      // Verify progress elements updated
      const pctLbl = document.getElementById('loglbl_5');
      if (pctLbl) expect(pctLbl.textContent).toBe('50%');
    });

    it('should base64 decode complete binary data and trigger browser anchor download', () => {
      // Refresh logs first to attach the ws listener
      window.AnalyzeToolsPanel._refreshLogs();

      jest.useFakeTimers();

      const wsHandler = window.ws.addEventListener.mock.calls.find(call => call[0] === 'message')[1];

      const clickSpy = jest.fn();
      const originalCreate = document.createElement;
      document.createElement = jest.fn().mockImplementation((tag) => {
        const el = originalCreate.call(document, tag);
        if (tag === 'a') {
          el.click = clickSpy;
        }
        return el;
      });

      // Send download done message with base64 encoded data
      wsHandler({
        data: JSON.stringify({
          type: 'log_download_done',
          log_id: 5,
          size: 4,
          data: 'Y29kZQ==' // "code" base64
        })
      });

      // Verify browser trigger
      expect(clickSpy).toHaveBeenCalled();
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Log #5 downloaded'));

      // Restore elements
      document.createElement = originalCreate;
      jest.useRealTimers();
    });

    it('should erase all logs from vehicle on delete clicks', () => {
      window.confirm.mockReturnValueOnce(true);
      
      window.AnalyzeToolsPanel._deleteLogs();

      expect(window.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'erase_logs' })
      );
      expect(window.MsgConsole.info).toHaveBeenCalledWith('🗑 Erasing logs from vehicle...');
    });
  });

  describe('MAVLink Inspector Tool Flows', () => {
    beforeEach(() => {
      window.AnalyzeToolsPanel.openTool('mavlink-inspector');
    });

    it('should start/stop live inspection updates and toggle pills', () => {
      const btn = document.getElementById('inspTogBtn');
      const pill = document.getElementById('inspPill');

      // 1. Start Inspection
      window.AnalyzeToolsPanel._togInsp();
      expect(btn.innerHTML).toContain('Stop');
      expect(pill.textContent).toBe('● Live');
      expect(pill.className).toBe('atw-pill green');

      // 2. Stop Inspection
      window.AnalyzeToolsPanel._togInsp();
      expect(btn.innerHTML).toContain('Start');
      expect(pill.textContent).toBe('● Paused');
      expect(pill.className).toBe('atw-pill off');
    });

    it('should process inspector packets and display rate and count stats', () => {
      window.AnalyzeToolsPanel._togInsp(); // unpause

      // Send some live messages
      window.AnalyzeToolsPanel._onInspectorData([
        { name: 'HEARTBEAT', id: 0, rate: 1.0, count: 50, fields: {} },
        { name: 'ATTITUDE', id: 30, rate: 10.0, count: 500, fields: {} }
      ]);

      const countBadge = document.getElementById('inspMsgCount');
      expect(countBadge.textContent).toBe('2 messages');

      const tbody = document.getElementById('inspTbody');
      expect(tbody.innerHTML).toContain('HEARTBEAT');
      expect(tbody.innerHTML).toContain('ATTITUDE');
    });

    it('should filter inspector message rows based on user searches', () => {
      const tbody = document.getElementById('inspTbody');
      
      // Inject some mock rows
      tbody.innerHTML = `
        <tr class="atw-irow" id="irow_HEARTBEAT"><td class="atw-mn">HEARTBEAT</td></tr>
        <tr class="atw-irow" id="irow_ATTITUDE"><td class="atw-mn">ATTITUDE</td></tr>
      `;

      // Filter for 'HEART'
      window.AnalyzeToolsPanel._filterInsp('HEART');
      expect(document.getElementById('irow_HEARTBEAT').style.display).toBe('');
      expect(document.getElementById('irow_ATTITUDE').style.display).toBe('none');
    });

    it('should select message and show live parameter values in right-hand details panel', () => {
      // Setup cached inspector data
      window.AnalyzeToolsPanel._onInspectorData([
        { 
          name: 'HEARTBEAT', 
          id: 0, 
          rate: 1.0, 
          count: 50, 
          fields: { type: '2 (QUADROTOR)', autopilot: '3 (APM)' } 
        }
      ]);

      // Click HEARTBEAT row
      window.AnalyzeToolsPanel._inspMsg('HEARTBEAT');

      const pane = document.getElementById('inspPane');
      expect(pane.innerHTML).toContain('HEARTBEAT');
      expect(pane.innerHTML).toContain('type');
      expect(pane.innerHTML).toContain('2 (QUADROTOR)');
    });

    it('should clear message cache and reset detail pane views on clears', () => {
      window.AnalyzeToolsPanel._clrInsp();

      const countBadge = document.getElementById('inspMsgCount');
      expect(countBadge.textContent).toBe('0 messages');

      const pane = document.getElementById('inspPane');
      expect(pane.textContent).toContain('Select a message to inspect');
    });
  });

  describe('NSH Shell Console Flows', () => {
    beforeEach(() => {
      // Stub console window and elements that are not built by default
      const termWin = document.createElement('div');
      termWin.id = 'atw-mavlink-console';
      termWin.innerHTML = `
        <div id="mavTerm"></div>
        <input id="mavIn" />
      `;
      document.body.appendChild(termWin);

      window.AnalyzeToolsPanel.openTool('mavlink-console');
    });

    afterEach(() => {
      const termWin = document.getElementById('atw-mavlink-console');
      if (termWin) termWin.remove();
    });

    it('should prompt commands, add to history arrow buffer, and fake execute replies', () => {
      jest.useFakeTimers();

      const input = document.getElementById('mavIn');
      input.value = 'free';

      window.AnalyzeToolsPanel._sendCmd();

      const term = document.getElementById('mavTerm');
      expect(term.innerHTML).toContain('nsh&gt; free');

      // Fast forward fake terminal execution response delay
      jest.advanceTimersByTime(200);

      expect(term.innerHTML).toContain('Mem:  Total: 256M');

      jest.useRealTimers();
    });

    it('should clear terminal contents on clears', () => {
      window.AnalyzeToolsPanel._clrCon();
      const term = document.getElementById('mavTerm');
      expect(term.textContent).toBe('Console cleared.');
    });
  });

  describe('Vibration Monitoring Tool Flows', () => {
    beforeEach(() => {
      // Stub vibration window and elements that are not built by default
      const vibWin = document.createElement('div');
      vibWin.id = 'atw-vibration';
      vibWin.innerHTML = `
        <span id="vibPill"></span>
        <button id="vibTogBtn"></button>
        <div id="vib0x"></div><div id="vib0x_v"></div><div id="rv0x"></div>
        <div id="vib0y"></div><div id="vib0y_v"></div><div id="rv0y"></div>
        <div id="vib0z"></div><div id="vib0z_v"></div><div id="rv0z"></div>
        <div id="vib1x"></div><div id="vib1x_v"></div><div id="rv1x"></div>
        <div id="vib1y"></div><div id="vib1y_v"></div><div id="rv1y"></div>
        <div id="vib1z"></div><div id="vib1z_v"></div><div id="rv1z"></div>
        <div id="clip_acc0"></div><div id="clip_acc1"></div><div id="clip_acc2"></div>
        <span id="rvs0"></span><span id="rvs1"></span>
      `;
      document.body.appendChild(vibWin);

      window.AnalyzeToolsPanel.openTool('vibration');
    });

    afterEach(() => {
      const vibWin = document.getElementById('atw-vibration');
      if (vibWin) vibWin.remove();
    });

    it('should toggle monitoring timers and update progress bars from websocket inspector cache', () => {
      jest.useFakeTimers();

      // Trigger start monitoring
      window.AnalyzeToolsPanel._togVib();

      const pill = document.getElementById('vibPill');
      expect(pill.textContent).toBe('● Monitoring');

      // Inject mock VIBRATION message into inspector cache
      window.AnalyzeToolsPanel._onInspectorData([
        {
          name: 'VIBRATION',
          fields: {
            vibration_x: '5.2',
            vibration_y: '10.5',
            vibration_z: '15.8',
            clipping_0: '1',
            clipping_1: '0',
            clipping_2: '0'
          }
        }
      ]);

      // Advance timer to trigger _updateVib
      jest.advanceTimersByTime(1000);

      // Verify axis numbers and clipping tags
      expect(document.getElementById('vib0x_v').textContent).toBe('5.20');
      expect(document.getElementById('vib0y_v').textContent).toBe('10.50');
      expect(document.getElementById('vib0z_v').textContent).toBe('15.80');
      expect(document.getElementById('clip_acc0').textContent).toBe('1');

      jest.useRealTimers();
    });

    it('should clear all bar gauges and values on resets', () => {
      window.AnalyzeToolsPanel._rstVib();
      expect(document.getElementById('vib0x_v').textContent).toBe('0.0');
      expect(document.getElementById('vib0y_v').textContent).toBe('0.0');
      expect(document.getElementById('vib0z_v').textContent).toBe('0.0');
    });
  });
});