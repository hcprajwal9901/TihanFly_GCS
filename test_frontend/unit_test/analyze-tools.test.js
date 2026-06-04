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

  describe('Additional Edge Cases and Coverage Expansion', () => {
    it('should cover fallback paths in _wsSend when ws is closed or not available', () => {
      // 1. ws is closed
      window.ws.readyState = 3; // CLOSED
      const sentClosed = window.AnalyzeToolsPanel._refreshLogs();
      // Verify list command not sent
      expect(window.ws.send).not.toHaveBeenCalled();

      // 2. ws is null
      delete window.ws;
      window.AnalyzeToolsPanel._refreshLogs();
    });

    it('should handle log scanner timeout and empty log list', () => {
      jest.useFakeTimers();
      // Refresh logs
      window.ws = { readyState: 1, send: jest.fn(), addEventListener: jest.fn() };
      window.AnalyzeToolsPanel._refreshLogs();

      // Advance by 6000ms to trigger timeout fallback
      jest.advanceTimersByTime(6000);

      const tableBody = document.getElementById('logTbody');
      expect(tableBody.innerHTML).toContain('No logs found on vehicle');
      jest.useRealTimers();
    });

    it('should handle log download queue and base64 decode failures', () => {
      window.ws = { readyState: 1, send: jest.fn(), addEventListener: jest.fn() };
      
      // Open the tool and refresh logs to attach listener
      window.AnalyzeToolsPanel.openTool('log-download');
      window.AnalyzeToolsPanel._refreshLogs();
      
      const wsHandler = window.ws.addEventListener.mock.calls.find(call => call[0] === 'message')[1];

      // Send log entries to populate _logList and render table
      wsHandler({
        data: JSON.stringify({ type: 'log_entry', id: 1, size: 100, num_logs: 2 })
      });
      wsHandler({
        data: JSON.stringify({ type: 'log_entry', id: 2, size: 200, num_logs: 2 })
      });

      // Select/check the checkbox for log 2
      const cb = document.querySelector('.lchk[data-lid="2"]');
      expect(cb).toBeTruthy();
      cb.checked = true;

      window.ws.send.mockClear();

      // Click Download Selected
      window.AnalyzeToolsPanel._downloadSel();
      expect(window.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'download_log', log_id: 2, log_size: 200 })
      );

      // Trigger decode error in onLogDone
      const spyConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      wsHandler({
        data: JSON.stringify({
          type: 'log_download_done',
          log_id: 2,
          size: 200,
          data: '!!!invalid_base64!!!'
        })
      });
      expect(spyConsoleError).toHaveBeenCalled();
      spyConsoleError.mockRestore();
    });

    it('should trigger sidebar click events for different tools', () => {
      // Show sidebar
      window.AnalyzeToolsPanel.showAnalyzePanel();

      // We click on the review-log item
      const reviewLogItem = Array.from(document.querySelectorAll('.ap-item'))
        .find(el => el.innerHTML.includes('Review a Log'));
      
      const fileInput = document.createElement('input');
      fileInput.id = 'reviewLogFileInput';
      fileInput.type = 'file';
      document.body.appendChild(fileInput);
      const clickSpy = jest.spyOn(fileInput, 'click').mockImplementation(() => {});

      reviewLogItem.click();
      expect(clickSpy).toHaveBeenCalled();
      fileInput.remove();

      // We click on the log-download item
      window.LogDownloadPanel = { open: jest.fn() };
      const logDlItem = Array.from(document.querySelectorAll('.ap-item'))
        .find(el => el.innerHTML.includes('Log Download'));
      logDlItem.click();
      expect(window.LogDownloadPanel.open).toHaveBeenCalled();
    });

    it('should trigger apBackBtn and restore window layouts', () => {
      window.DropdownStrip = { showPlanStrip: jest.fn() };
      
      // Setup elements that closeAll/goBack targets
      const cmdPanel = document.createElement('div');
      cmdPanel.id = 'commandEditorPanel';
      document.body.appendChild(cmdPanel);

      // Test isOpen function
      expect(window.AnalyzeToolsPanel.isOpen()).toBe(false);
      window.AnalyzeToolsPanel.openTool('log-download');
      expect(window.AnalyzeToolsPanel.isOpen()).toBe(true);

      // Test _qcmd quick command helper
      const termWin = document.createElement('div');
      termWin.id = 'atw-mavlink-console';
      termWin.innerHTML = '<div id="mavTerm"></div><input id="mavIn" />';
      document.body.appendChild(termWin);
      window.AnalyzeToolsPanel._qcmd('free');
      expect(document.getElementById('mavTerm').innerHTML).toContain('free');
      termWin.remove();

      window.AnalyzeToolsPanel.showAnalyzePanel();
      
      const backBtn = document.getElementById('apBackBtn');
      backBtn.click();
      
      expect(window.DropdownStrip.showPlanStrip).toHaveBeenCalled();
      cmdPanel.remove();
    });

    it('should simulate geotagging images loop', () => {
      jest.useFakeTimers();
      
      // Inject geotagging output elements
      const geoDiv = document.createElement('div');
      geoDiv.innerHTML = `
        <input type="text" id="geoImgDir" />
        <input type="text" id="geoLogFile" />
        <div id="geoLogOut"></div>
        <div id="geoTotal"></div>
        <div id="geoTagged"></div>
        <div id="geoSkipped"></div>
      `;
      document.body.appendChild(geoDiv);

      window.AnalyzeToolsPanel._browseImgs();
      window.AnalyzeToolsPanel._browseLog();
      expect(document.getElementById('geoImgDir').value).toBe('/home/user/flight_images');
      expect(document.getElementById('geoLogFile').value).toBe('/home/user/logs/flight_001.tlog');

      window.AnalyzeToolsPanel._runGeo();

      // Fast forward the loop intervals (8 ticks at 280ms each)
      jest.advanceTimersByTime(280 * 10);

      expect(document.getElementById('geoTotal').textContent).toBe('48');
      expect(document.getElementById('geoTagged').textContent).toBe('46');
      expect(document.getElementById('geoSkipped').textContent).toBe('2');

      geoDiv.remove();
      jest.useRealTimers();
    });

    it('should handle NSH terminal history arrows navigation', () => {
      jest.useFakeTimers();

      // Reset closure state by reloading the script
      global.loadScript('js/analyze-tools.js');

      const termWin = document.createElement('div');
      termWin.id = 'atw-mavlink-console';
      termWin.innerHTML = `
        <div id="mavTerm"></div>
        <input id="mavIn" />
      `;
      document.body.appendChild(termWin);

      window.AnalyzeToolsPanel.openTool('mavlink-console');
      // Advance by 100ms to register keydown
      jest.advanceTimersByTime(100);

      const input = document.getElementById('mavIn');
      // Simulate sending 2 commands
      input.value = 'help';
      window.AnalyzeToolsPanel._sendCmd();
      input.value = 'status';
      window.AnalyzeToolsPanel._sendCmd();

      // Trigger ArrowUp
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(input.value).toBe('status');

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(input.value).toBe('help');

      // Trigger ArrowDown
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(input.value).toBe('status');

      termWin.remove();
      jest.useRealTimers();
    });

    it('should test raw vibration table pills status mapping', () => {
      jest.useFakeTimers();
      
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

      window.AnalyzeToolsPanel._togVib();

      // 1. Test "Good" status pill (< 10)
      window.AnalyzeToolsPanel._onInspectorData([{
        name: 'VIBRATION',
        fields: { vibration_x: '5.2', vibration_y: '5.2', vibration_z: '5.2' }
      }]);
      jest.advanceTimersByTime(800);
      expect(document.getElementById('rvs0').textContent).toBe('Good');

      // 2. Test "Warning" status pill (between 10 and 20)
      window.AnalyzeToolsPanel._onInspectorData([{
        name: 'VIBRATION',
        fields: { vibration_x: '15.2', vibration_y: '15.2', vibration_z: '15.2' }
      }]);
      jest.advanceTimersByTime(800);
      expect(document.getElementById('rvs0').textContent).toBe('Warning');

      // 3. Test "High" status pill (>= 20)
      window.AnalyzeToolsPanel._onInspectorData([{
        name: 'VIBRATION',
        fields: { vibration_x: '25.2', vibration_y: '25.2', vibration_z: '25.2' }
      }]);
      jest.advanceTimersByTime(800);
      expect(document.getElementById('rvs0').textContent).toBe('High');

      // Turn off vibration monitoring
      window.AnalyzeToolsPanel._togVib();

      vibWin.remove();
      jest.useRealTimers();
    });

    it('should test inspector detail pane updates and interval refreshes', () => {
      jest.useFakeTimers();

      // Add messages
      window.AnalyzeToolsPanel._onInspectorData([
        { name: 'ATTITUDE', id: 30, rate: 5.0, count: 100, fields: { roll: '0.1' } }
      ]);

      // Open inspector and select message
      window.AnalyzeToolsPanel.openTool('mavlink-inspector');
      window.AnalyzeToolsPanel._togInsp(); // starts live

      window.AnalyzeToolsPanel._inspMsg('ATTITUDE');
      
      const pane = document.getElementById('inspPane');
      expect(pane).toBeTruthy();
      expect(pane.dataset.inspMsg).toBe('ATTITUDE');

      // Advance by 300ms to trigger the inspector pane refresh interval
      jest.advanceTimersByTime(300);

      // Verify that value has been refreshed in the detail table
      const body = document.getElementById('ipd_tbody');
      expect(body.innerHTML).toContain('roll');

      jest.useRealTimers();
    });

    it('should verify all format cases for _mavFields helper in memory', () => {
      const heartbeat = window.AnalyzeToolsPanel._mavFields('HEARTBEAT');
      expect(heartbeat).toEqual(expect.arrayContaining([expect.objectContaining({ n: 'type' })]));

      const attitude = window.AnalyzeToolsPanel._mavFields('ATTITUDE');
      expect(attitude).toEqual(expect.arrayContaining([expect.objectContaining({ n: 'roll' })]));

      const gps = window.AnalyzeToolsPanel._mavFields('GPS_RAW_INT');
      expect(gps).toEqual(expect.arrayContaining([expect.objectContaining({ n: 'fix_type' })]));

      const battery = window.AnalyzeToolsPanel._mavFields('BATTERY_STATUS');
      expect(battery).toEqual(expect.arrayContaining([expect.objectContaining({ n: 'voltage' })]));

      const other = window.AnalyzeToolsPanel._mavFields('OTHER');
      expect(other).toEqual(expect.arrayContaining([expect.objectContaining({ n: 'value_1' })]));
    });
  });
});