describe('WebSocket Connection Manager High-Fidelity Behavioral Test Suite (websocket.js)', () => {
  let mockTMap;
  let wsInstances;
  let customEventList;

  beforeAll(() => {
    // Enable Jest Fake Timers for reconnection/heartbeat ticks control
    jest.useFakeTimers();

    // Prepare global DOM inputs beforehand
    const wrap = document.createElement('div');
    wrap.id = 'vehicleSelectorWrap';
    document.body.appendChild(wrap);

    const sel = document.createElement('select');
    sel.id = 'vehicleSelector';
    document.body.appendChild(sel);

    const modeText = document.createElement('span');
    modeText.id = 'modeIndicatorText';
    document.body.appendChild(modeText);

    const activeMode = document.createElement('span');
    activeMode.id = 'activeModeDisplay';
    document.body.appendChild(activeMode);

    const connStat = document.createElement('div');
    connStat.id = 'connectionStatus';
    document.body.appendChild(connStat);

    const udpEl = document.createElement('div');
    udpEl.id = 'portStatusUDP';
    document.body.appendChild(udpEl);

    const serialEl = document.createElement('div');
    serialEl.id = 'portStatusSerial';
    document.body.appendChild(serialEl);

    // Global spies
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      arm: jest.fn(),
      disarm: jest.fn(),
      log: jest.fn()
    };

    window.TelemetryDisplay = {
      update: jest.fn(),
      setFlightMode: jest.fn()
    };

    window.compass = {
      updateTelemetry: jest.fn()
    };

    window.ArmControl = {
      setArmedState: jest.fn()
    };

    window.FlightModeSelector = {
      setMode: jest.fn()
    };

    window.homeMarker = { lat: 17.602, lng: 78.126 };

    mockTMap = {
      updateDronePositionForSysid: jest.fn(),
      updateDronePosition: jest.fn(),
      pruneStaleVehicleMarkers: jest.fn(),
      clearDroneMarkers: jest.fn(),
      map: {
        setView: jest.fn()
      }
    };
    window.tmap = mockTMap;

    // Track Custom Event listeners
    customEventList = [];
    window.addEventListener = jest.fn().mockImplementation((event, callback) => {
      customEventList.push({ event, callback });
    });

    // Capture instanced WebSockets
    wsInstances = [];
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.send = jest.fn();
        this.close = jest.fn();
        wsInstances.push(this);
      }
    }
    global.WebSocket = MockWebSocket;
    WebSocket.OPEN = 1;

    // Load connection manager script
    global.loadScript('plan-flight-modules/websocket.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    wsInstances.length = 0;
    
    // Clear vehicle dropdown select elements
    const sel = document.getElementById('vehicleSelector');
    if (sel) {
      sel.innerHTML = '';
      sel.options.length = 0;
      sel.value = '';
    }

    window.selectedSysId = 1;
    window.activeSysids = [1, 2];
    window.vcHandleFirmwareMessage = undefined;
    window.vcPopulatePorts = undefined;
  });

  describe('WebSocket Lifecycle & Connect States', () => {
    it('should construct WebSocket and attach onopen/onmessage/onerror/onclose handlers', () => {
      window.initWebSocket();
      expect(wsInstances).toHaveLength(1);
      const ws = wsInstances[0];

      expect(ws.onopen).toBeDefined();
      expect(ws.onmessage).toBeDefined();
      expect(ws.onerror).toBeDefined();
      expect(ws.onclose).toBeDefined();
    });

    it('should transition status and register heartbeats loop on open connect', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;

      // Trigger open callback
      ws.onopen();

      expect(window.MsgConsole.success).toHaveBeenCalledWith('Backend connected');
      
      // Ping timer should fire safeSend every 15s
      jest.advanceTimersByTime(15000);
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ping"'));
    });

    it('should handle constructor construction failures gracefully', () => {
      const originalWS = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => {
        throw new Error('WS Constructor Fail');
      });

      window.initWebSocket();
      expect(console.error).toHaveBeenCalledWith('[WS] Failed to construct WebSocket:', expect.any(Error));

      global.WebSocket = originalWS;
    });
  });

  describe('Outbound Messages & Sysid Auto-Injections', () => {
    it('should drop messages and log warnings if socket is closed', () => {
      window.ws = null;
      const sent = window.safeSend({ type: 'param_request_list' });
      expect(sent).toBe(false);
    });

    it('should auto-inject current selectedSysId for outbound commands', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;
      window.ws = ws;

      window.selectedSysId = 2;
      
      window.safeSend({ type: 'command', command: 176 });
      
      expect(ws.send).toHaveBeenCalled();
      const sentData = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentData.sysid).toBe(2);
    });

    it('should broadcast set-commands copy to all active sysids if selectedSysId is 0', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;
      window.ws = ws;

      window.selectedSysId = 0;
      window.activeSysids = [2, 5];

      window.safeSend({ type: 'param_set', param_id: 'THR_MIN', value: 15 });

      expect(ws.send).toHaveBeenCalledTimes(2);
      const data1 = JSON.parse(ws.send.mock.calls[0][0]);
      const data2 = JSON.parse(ws.send.mock.calls[1][0]);

      expect(data1.sysid).toBe(2);
      expect(data2.sysid).toBe(5);
    });
  });

  describe('Firmware buffering queue', () => {
    it('should queue firmware logs and flush them immediately once window handler is ready', () => {
      window.vcHandleFirmwareMessage = undefined;
      const testMsg = { type: 'firmware_log', text: 'Erasing flash...' };

      window.deliverFirmwareMessage(testMsg);

      const spyHandler = jest.fn();
      window.vcHandleFirmwareMessage = spyHandler;

      window.flushFirmwareQueue();

      expect(spyHandler).toHaveBeenCalledWith(testMsg);
    });

    it('should poll to flush queue automatically and give up after timeout limits', () => {
      window.vcHandleFirmwareMessage = undefined;
      window.deliverFirmwareMessage({ type: 'firmware_progress', pct: 40 });

      jest.advanceTimersByTime(50);

      const spyHandler = jest.fn();
      window.vcHandleFirmwareMessage = spyHandler;

      jest.advanceTimersByTime(50);
      expect(spyHandler).toHaveBeenCalled();
    });

    it('should clear firmware queue if polling exceeds timeout limit', () => {
      window.vcHandleFirmwareMessage = undefined;
      window.deliverFirmwareMessage({ type: 'firmware_progress', pct: 40 });

      // Advance time by 5000ms (100 retries * 50ms)
      jest.advanceTimersByTime(5100);

      const spyHandler = jest.fn();
      window.vcHandleFirmwareMessage = spyHandler;
      
      window.flushFirmwareQueue();
      // Should not replay message since queue was cleared
      expect(spyHandler).not.toHaveBeenCalled();
    });
  });

  describe('Multi-Vehicle selector dropdown dynamic rebuild', () => {
    it('should rebuild dropdown options based on live vehicle status array', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      
      const payload = {
        type: 'status',
        vehicles: [
          { sysid: 1, lat: 17.6, lon: 78.1 },
          { sysid: 3, lat: 17.7, lon: 78.2 }
        ],
        connected: true
      };

      ws.onmessage({ data: JSON.stringify(payload) });

      const sel = document.getElementById('vehicleSelector');
      expect(sel.options).toHaveLength(2);
      expect(sel.options[0].value).toBe('1');
      expect(sel.options[1].value).toBe('3');
      expect(document.getElementById('vehicleSelectorWrap').style.display).toBe('flex');
    });

    it('should wire up dropdown change listener', () => {
      const sel = document.getElementById('vehicleSelector');
      const opt = document.createElement('option');
      opt.value = '3';
      sel.appendChild(opt);
      sel.value = '3';

      // Dispatch DOMContentLoaded event to trigger listener wire up
      const domLoadedEvent = new Event('DOMContentLoaded');
      document.dispatchEvent(domLoadedEvent);

      // Trigger change event
      sel.dispatchEvent(new Event('change'));
      expect(window.selectedSysId).toBe(3);
    });
  });

  describe('Reconnection exponential backoff loops', () => {
    it('should trigger reconnection schedules and backoff delay increments', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.onopen(); // Reset reconnectAttempts to 0

      ws.onclose();

      expect(wsInstances).toHaveLength(1);

      // Tick base delay + jitter
      jest.advanceTimersByTime(4500);

      expect(wsInstances).toHaveLength(2);
    });

    it('should wait 30s and reset reconnect attempts after reaching limit', () => {
      window.initWebSocket();

      // Simulate reaching max reconnect attempts
      for (let i = 0; i < 11; i++) {
        const currentWs = wsInstances[wsInstances.length - 1];
        if (currentWs && typeof currentWs.onclose === 'function') {
          currentWs.onclose();
        }
        jest.advanceTimersByTime(35000);
      }

      // Reconnect Attempts resets to 0 and timer fires
      expect(wsInstances.length).toBeGreaterThan(5);
    });
  });

  describe('Inbound MAVLink Packet Dispatchings', () => {
    it('should update GPS coordinate positions on gps packet', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      ws.onmessage({
        data: JSON.stringify({
          type: 'gps',
          latitude: 17.601,
          longitude: 78.126,
          heading: 95,
          sysid: 3
        })
      });

      expect(mockTMap.updateDronePositionForSysid).toHaveBeenCalledWith(3, 17.601, 78.126, 95);
    });

    it('should update attitude roll pitch yaw dials on attitude packet for selected vehicle', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      window.selectedSysId = 3;

      ws.onmessage({
        data: JSON.stringify({
          type: 'attitude',
          roll: 0.1,
          pitch: -0.05,
          yaw: 1.5,
          sysid: 3
        })
      });

      expect(window.TelemetryDisplay.update).toHaveBeenCalledWith({
        roll: expect.any(Number),
        pitch: expect.any(Number),
        yaw: expect.any(Number)
      });
      expect(window.compass.updateTelemetry).toHaveBeenCalled();
    });

    it('should console log drone console texts and support filtering per sysid selection', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      window.selectedSysId = 3; // Drone 3 selected

      // Message from drone 4 is filtered/dropped
      ws.onmessage({
        data: JSON.stringify({
          type: 'drone_console',
          text: 'Failsafe low voltage',
          severity: 'critical',
          sysid: 4
        })
      });
      expect(window.MsgConsole.log).not.toHaveBeenCalled();

      // Message from drone 3 is displayed
      ws.onmessage({
        data: JSON.stringify({
          type: 'drone_console',
          text: 'GUIDED mode entered',
          severity: 'info',
          sysid: 3
        })
      });
      expect(window.MsgConsole.log).toHaveBeenCalledWith(expect.stringContaining('GUIDED mode entered'), 'info');
    });

    it('should dispatch custom events for calibration values pongs and serial ports', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      const spyDispatch = jest.spyOn(window, 'dispatchEvent');

      ws.onmessage({
        data: JSON.stringify({
          type: 'param_value',
          param_id: 'ALT_HOLD',
          value: 20
        })
      });

      expect(spyDispatch).toHaveBeenCalled();
    });

    it('should ignore non-string and non-json websocket frames', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      ws.onmessage({ data: 123 }); // Non-string
      ws.onmessage({ data: 'invalid json' }); // Non-json
      expect(window.MsgConsole.log).not.toHaveBeenCalled();
    });

    it('should route telemetry messages through handleTelemetryUpdate', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      window.selectedSysId = 1;

      ws.onmessage({
        data: JSON.stringify({
          type: 'telemetry',
          data: {
            sysid: 1,
            latitude: 17.601,
            longitude: 78.125,
            heading: 100
          }
        })
      });

      expect(window.TelemetryDisplay.update).toHaveBeenCalled();
      expect(mockTMap.updateDronePositionForSysid).toHaveBeenCalledWith(1, 17.601, 78.125, 100);
    });

    it('should process Command response ACKs', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      // Success ACK
      ws.onmessage({
        data: JSON.stringify({
          type: 'response',
          status: 'success',
          message: 'Takeoff Succeeded'
        })
      });
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Takeoff Succeeded');

      // Failure ACK
      ws.onmessage({
        data: JSON.stringify({
          type: 'response',
          status: 'failed',
          message: 'Takeoff Rejected'
        })
      });
      expect(window.MsgConsole.error).toHaveBeenCalledWith('Takeoff Rejected');
    });

    it('should process Mission ACKs', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      window.handleMissionAck = jest.fn();
      window.handleMissionDownloadAck = jest.fn();
      window.handleMissionClearAck = jest.fn();

      ws.onmessage({ data: JSON.stringify({ type: 'mission_ack', seq: 1 }) });
      expect(window.handleMissionAck).toHaveBeenCalled();

      ws.onmessage({ data: JSON.stringify({ type: 'mission_download_ack', count: 5 }) });
      expect(window.handleMissionDownloadAck).toHaveBeenCalled();

      ws.onmessage({ data: JSON.stringify({ type: 'mission_clear_ack' }) });
      expect(window.handleMissionClearAck).toHaveBeenCalled();
    });

    it('should process flight_mode and flight_mode_status updates', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      ws.onmessage({
        data: JSON.stringify({
          type: 'flight_mode_status',
          mode: 'LOITER',
          pwm: 1500,
          slot: 2
        })
      });
      expect(window.FlightModeSelector.setMode).toHaveBeenCalledWith('LOITER');
      expect(window.TelemetryDisplay.setFlightMode).toHaveBeenCalledWith('LOITER');

      ws.onmessage({
        data: JSON.stringify({
          type: 'flight_mode',
          mode: 'RTL'
        })
      });
      expect(window.FlightModeSelector.setMode).toHaveBeenCalledWith('RTL');
    });

    it('should process arm / disarm / mode_change events', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      // Armed event
      ws.onmessage({
        data: JSON.stringify({
          type: 'event',
          event: 'armed',
          message: 'Vehicle armed'
        })
      });
      expect(window.MsgConsole.arm).toHaveBeenCalledWith('Vehicle armed');
      expect(window.ArmControl.setArmedState).toHaveBeenCalledWith(true);

      // Disarmed event
      ws.onmessage({
        data: JSON.stringify({
          type: 'event',
          event: 'disarmed',
          message: 'Vehicle disarmed'
        })
      });
      expect(window.MsgConsole.disarm).toHaveBeenCalledWith('Vehicle disarmed');
      expect(window.ArmControl.setArmedState).toHaveBeenCalledWith(false);

      // Mode change event
      ws.onmessage({
        data: JSON.stringify({
          type: 'event',
          event: 'mode_change',
          message: 'Auto mode',
          mode: 'AUTO'
        })
      });
      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Auto mode'));
      expect(document.getElementById('modeIndicatorText').textContent).toBe('AUTO');
      expect(document.getElementById('activeModeDisplay').textContent).toBe('AUTO');
    });

    it('should process status message and manage drone disconnected state', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      ws.onmessage({
        data: JSON.stringify({
          type: 'status',
          connected: false
        })
      });

      expect(mockTMap.clearDroneMarkers).toHaveBeenCalled();
      expect(mockTMap.map.setView).toHaveBeenCalled();
    });

    it('should process serial_ports list packets and query loader retry checks', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      const portsPayload = {
        type: 'serial_ports',
        ports: ['COM3', 'COM4']
      };

      ws.onmessage({ data: JSON.stringify(portsPayload) });
      expect(window._vcLastKnownPorts).toEqual(['COM3', 'COM4']);

      // Setup window.vcPopulatePorts and let poll trigger it
      const spyPopulate = jest.fn();
      window.vcPopulatePorts = spyPopulate;

      ws.onmessage({ data: JSON.stringify(portsPayload) });
      jest.advanceTimersByTime(50);
      expect(spyPopulate).toHaveBeenCalled();
    });

    it('should process parameter set events and bulk parameter dumps', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      ws.onmessage({ data: JSON.stringify({ type: 'param_load_start', message: 'Loading' }) });
      expect(window.MsgConsole.info).toHaveBeenCalledWith('📋 Loading');

      ws.onmessage({ data: JSON.stringify({ type: 'param_load_complete', message: 'Loaded' }) });
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Loaded');

      ws.onmessage({ data: JSON.stringify({ type: 'param_file_saved', message: 'Saved' }) });
      expect(window.MsgConsole.success).toHaveBeenCalledWith('💾 Saved');

      ws.onmessage({ data: JSON.stringify({ type: 'param_error', message: 'Bad param' }) });
      expect(window.MsgConsole.error).toHaveBeenCalledWith('⚠️ Param: Bad param');
    });

    it('should process vehicle link acknowledgements', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      window._mvHandleMessage = jest.fn();
      window.CommLink = {
        processMessage: jest.fn()
      };

      ws.onmessage({ data: JSON.stringify({ type: 'connect_vehicle_ack', status: 'success' }) });
      expect(window._mvHandleMessage).toHaveBeenCalled();
      expect(window.CommLink.processMessage).toHaveBeenCalled();
    });
  });

  describe('Public API helpers: sendCommand & sendMission', () => {
    it('should send parameter command via sendCommand if socket is open', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;
      window.ws = ws;

      const sent = window.sendCommand('TAKEOFF', { altitude: 10 });
      expect(sent).toBe(true);
      expect(ws.send).toHaveBeenCalled();
    });

    it('should drop command and return false if sendCommand called when closed', () => {
      window.ws = null;
      const sent = window.sendCommand('TAKEOFF', { altitude: 10 });
      expect(sent).toBe(false);
      expect(window.MsgConsole.error).toHaveBeenCalledWith('Not connected to backend');
    });

    it('should send waypoints list via sendMission if socket is open', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;
      window.ws = ws;

      const sent = window.sendMission([{ lat: 17.6, lng: 78.1 }]);
      expect(sent).toBe(true);
      expect(ws.send).toHaveBeenCalled();
    });

    it('should reject sendMission if waypoints param is empty', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;
      window.ws = ws;

      const sent = window.sendMission([]);
      expect(sent).toBe(false);
      expect(window.MsgConsole.error).toHaveBeenCalledWith('No waypoints to send');
    });
  });

  describe('Connection status DOM updates', () => {
    it('should update connectionStatus text and styles', () => {
      window.initWebSocket();
      const ws = wsInstances[0];
      ws.readyState = WebSocket.OPEN;
      
      // Simulate status UDP linked
      ws.onmessage({
        data: JSON.stringify({
          type: 'status',
          connected: true,
          connection: 'UDP'
        })
      });

      const el = document.getElementById('connectionStatus');
      expect(el.textContent).toBe('🟢 Drone connected (UDP)');
    });

    it('should update port status bound details', () => {
      window.initWebSocket();
      const ws = wsInstances[0];

      ws.onmessage({
        data: JSON.stringify({
          type: 'status',
          ports: {
            udp_available: true,
            udp_port: 14550,
            serial_available: false,
            serial_port: 'COM5'
          }
        })
      });

      expect(document.getElementById('portStatusUDP').textContent).toBe('🟢 UDP :14550');
      expect(document.getElementById('portStatusSerial').textContent).toBe('🔴 Serial: not found');
    });
  });
});