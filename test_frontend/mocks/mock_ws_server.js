const http = require('http');
const { WebSocketServer } = require('ws');
const url = require('url');

class MockServer {
  constructor(wsPort, httpPort) {
    this.wsPort = wsPort;
    this.httpPort = httpPort;
    this.wsServer = null;
    this.httpServer = null;
    this.clients = new Set();
    this.broadcastInterval = null;

    // Default parameters state (in-memory persistence)
    this.params = {
      FENCE_ENABLE: 1,
      FENCE_TYPE: 3,
      FENCE_ACTION: 1,
      FENCE_ALT_MAX: 100,
      FENCE_RADIUS: 150,
      FENCE_MARGIN: 2,
      BATT_FS_LOW_ACT: 2,
      BATT_FS_CRT_ACT: 1,
      FS_THR_ENABLE: 3
    };

    // Scenario variables
    this.activeScenario = 'reset';
    this.ackTimeoutCommands = new Set(); // set of commands (e.g., 'ARM') that should not receive ACK
    this.seqCounter = 1000;
    this.customGpsSatCount = null;
    this.customBatteryPct = null;
    this.customAltitude = 10.0;
    this.customDistFromHome = 5.0;
    this.customMode = 'GUIDED';
    this.customArmed = false;

    // Firmware flash scenarios
    this.flashScenario = null; // 'corrupted', 'interrupted', 'timeout'
  }

  start() {
    // 1. HTTP Control Server
    this.httpServer = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (pathname === '/scenario/reset') {
          this.resetScenarios();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/telemetry_loss') {
          this.activeScenario = 'telemetry_loss';
          this.stopTelemetryBroadcast();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/gps_loss') {
          this.activeScenario = 'gps_loss';
          this.customGpsSatCount = 0;
          this.customAltitude = 0;
          this.customDistFromHome = 0;
          this.broadcastTelemetryImmediately();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/low_battery') {
          this.activeScenario = 'low_battery';
          this.customBatteryPct = 8;
          this.broadcastTelemetryImmediately();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/failsafe_rtl') {
          this.activeScenario = 'failsafe_rtl';
          this.customMode = 'RTL';
          this.broadcastTelemetryImmediately();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/packet_drops') {
          this.activeScenario = 'packet_drops';
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/slow_network') {
          this.activeScenario = 'slow_network';
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/invalid_packets') {
          this.activeScenario = 'invalid_packets';
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/ack_timeout') {
          const cmd = parsedUrl.query.command || '';
          if (cmd) {
            this.ackTimeoutCommands.add(cmd.toUpperCase());
          } else {
            this.ackTimeoutCommands.add('ARM'); // fallback
          }
          res.end(JSON.stringify({ status: 'success', ack_timeout_commands: Array.from(this.ackTimeoutCommands) }));
        } else if (pathname === '/scenario/out_of_order_packets') {
          this.activeScenario = 'out_of_order_packets';
          this.broadcastOutOfOrderTelemetry();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/duplicate_packets') {
          this.activeScenario = 'duplicate_packets';
          this.broadcastDuplicateTelemetry();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/reconnect_restore') {
          this.triggerReconnectRestore();
          res.end(JSON.stringify({ status: 'success' }));
        } else if (pathname === '/scenario/gps_degradation') {
          this.activeScenario = 'gps_degradation';
          this.triggerGpsDegradationAndRecovery();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/geofence_breach') {
          this.activeScenario = 'geofence_breach';
          this.customAltitude = 120.0;
          this.broadcastTelemetryImmediately();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/geofence_clear') {
          this.activeScenario = 'geofence_clear';
          this.customAltitude = 50.0;
          this.broadcastTelemetryImmediately();
          res.end(JSON.stringify({ status: 'success', scenario: this.activeScenario }));
        } else if (pathname === '/scenario/flash_corrupted') {
          this.flashScenario = 'corrupted';
          res.end(JSON.stringify({ status: 'success', flashScenario: this.flashScenario }));
        } else if (pathname === '/scenario/flash_interrupted') {
          this.flashScenario = 'interrupted';
          res.end(JSON.stringify({ status: 'success', flashScenario: this.flashScenario }));
        } else if (pathname === '/scenario/flash_timeout') {
          this.flashScenario = 'timeout';
          res.end(JSON.stringify({ status: 'success', flashScenario: this.flashScenario }));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Only POST requests allowed');
      }
    });

    this.httpServer.listen(this.httpPort, () => {
      console.log(`[MockServer] HTTP server running on port ${this.httpPort}`);
    });

    // 2. WebSocket Server
    this.wsServer = new WebSocketServer({ port: this.wsPort });
    this.wsServer.on('connection', (ws) => {
      console.log('[MockServer] WebSocket client connected');
      this.clients.add(ws);

      // Send initial status and parameter values
      this.sendInitialPackets(ws);

      ws.on('message', (message) => {
        let payload;
        try {
          payload = JSON.parse(message);
        } catch (e) {
          console.warn('[MockServer] Received non-JSON WebSocket frame:', message);
          return;
        }

        console.log('[MockServer] Received WS payload:', payload);

        // Validate message if validation hook is present
        if (typeof this.validateMessage === 'function') {
          try {
            this.validateMessage(payload);
          } catch (err) {
            console.error('[MockServer] Schema validation warning/error:', err.message);
          }
        }

        this.handleWsClientMessage(ws, payload);
      });

      ws.on('close', () => {
        console.log('[MockServer] WebSocket client disconnected');
        this.clients.delete(ws);
      });
    });

    this.startTelemetryBroadcast();
  }

  stop() {
    this.stopTelemetryBroadcast();

    if (this.wsServer) {
      this.clients.forEach((ws) => ws.close());
      this.wsServer.close();
    }
    if (this.httpServer) {
      this.httpServer.close();
    }
    console.log('[MockServer] Stopped servers');
  }

  resetScenarios() {
    this.activeScenario = 'reset';
    this.ackTimeoutCommands.clear();
    this.customGpsSatCount = null;
    this.customBatteryPct = null;
    this.customAltitude = 10.0;
    this.customDistFromHome = 5.0;
    this.customMode = 'GUIDED';
    this.customArmed = false;
    this.flashScenario = null;
    this.params = {
      FENCE_ENABLE: 1,
      FENCE_TYPE: 3,
      FENCE_ACTION: 1,
      FENCE_ALT_MAX: 100,
      FENCE_RADIUS: 150,
      FENCE_MARGIN: 2,
      BATT_FS_LOW_ACT: 2,
      BATT_FS_CRT_ACT: 1,
      FS_THR_ENABLE: 3
    };
    this.startTelemetryBroadcast();
    console.log('[MockServer] Scenario variables reset');
  }

  handleWsClientMessage(ws, payload) {
    const type = payload.type;
    const sysid = payload.sysid || 1;

    // Handle commands
    if (type === 'command') {
      const cmd = (payload.command || '').toUpperCase();
      console.log(`[MockServer] Processing command: ${cmd} (sysid: ${sysid})`);

      // Check if command is configured to time out
      if (this.ackTimeoutCommands.has(cmd)) {
        console.log(`[MockServer] Simulating ACK timeout for command: ${cmd}`);
        // Do not respond or trigger events
        return;
      }

      // Respond success and events with a short delay to simulate firmware processing time
      setTimeout(() => {
        if (!this.clients.has(ws)) return;

        ws.send(JSON.stringify({
          type: 'response',
          id: payload.id,
          command: cmd,
          status: 'success',
          message: `Command ${cmd} accepted`
        }));

        // Trigger state change events
        if (cmd === 'ARM' || cmd === 'FORCE_ARM') {
          this.customArmed = true;
          ws.send(JSON.stringify({
            type: 'event',
            event: 'armed',
            sysid: sysid,
            message: 'Armed'
          }));
        } else if (cmd === 'DISARM') {
          this.customArmed = false;
          ws.send(JSON.stringify({
            type: 'event',
            event: 'disarmed',
            sysid: sysid,
            message: 'Disarmed'
          }));
        } else if (cmd === 'SET_MODE') {
          const mode = (payload.params && payload.params.mode) || 'GUIDED';
          this.customMode = mode;
          ws.send(JSON.stringify({
            type: 'event',
            event: 'mode_change',
            sysid: sysid,
            mode: mode,
            message: `Mode changed to ${mode}`
          }));
        } else if (cmd === 'TAKEOFF') {
          this.customMode = 'GUIDED';
          ws.send(JSON.stringify({
            type: 'event',
            event: 'mode_change',
            sysid: sysid,
            mode: 'GUIDED',
            message: 'Mode changed to GUIDED'
          }));
          ws.send(JSON.stringify({
            type: 'takeoff_progress',
            step: 'starting',
            message: 'Takeoff started'
          }));
          setTimeout(() => {
            if (this.clients.has(ws)) {
              ws.send(JSON.stringify({
                type: 'takeoff_progress',
                step: 'complete',
                message: 'Takeoff complete'
              }));
            }
          }, 500);
        } else if (cmd === 'RTL') {
          this.customMode = 'RTL';
          ws.send(JSON.stringify({
            type: 'event',
            event: 'mode_change',
            sysid: sysid,
            mode: 'RTL',
            message: 'Mode changed to RTL'
          }));
        } else if (cmd === 'LAND') {
          this.customMode = 'LAND';
          ws.send(JSON.stringify({
            type: 'event',
            event: 'mode_change',
            sysid: sysid,
            mode: 'LAND',
            message: 'Mode changed to LAND'
          }));
        }
      }, 100);
    }

    // Handle parameter requests
    else if (type === 'param_request_one') {
      const name = payload.name;
      if (name in this.params) {
        ws.send(JSON.stringify({
          type: 'param_value',
          param_id: name,
          value: this.params[name]
        }));
      }
    }

    // Handle parameter sets
    else if (type === 'param_set') {
      const id = payload.param_id;
      const val = parseFloat(payload.value);
      this.params[id] = val;
      ws.send(JSON.stringify({
        type: 'param_set_sent',
        param_id: id,
        value: val
      }));
      // Also broadcast param_value
      ws.send(JSON.stringify({
        type: 'param_value',
        param_id: id,
        value: val
      }));
    }

    // Handle request for telemetry
    else if (type === 'request' && payload.request === 'telemetry') {
      console.log('[MockServer] Telemetry requested by client');
      // Already running broadcast loop
    }

    // Handle list_serial_ports request
    else if (type === 'list_serial_ports') {
      console.log('[MockServer] Serial ports requested by client');
      ws.send(JSON.stringify({
        type: 'serial_ports',
        ports: [
          { port: '/dev/ttyS4', display: '/dev/ttyS4', description: 'n/a', manufacturer: '', board_id: '', brand: '' },
          { port: '/dev/ttyS31', display: '/dev/ttyS31', description: 'n/a', manufacturer: '', board_id: '', brand: '' },
          { port: '/dev/ttyS30', display: '/dev/ttyS30', description: 'n/a', manufacturer: '', board_id: '', brand: '' },
          { port: '/dev/ttyS29', display: '/dev/ttyS29', description: 'n/a', manufacturer: '', board_id: '', brand: '' }
        ]
      }));
    }

    // Handle custom firmware flashing command
    else if (type === 'install_firmware_custom') {
      console.log('[MockServer] install_firmware_custom triggered');
      this.handleFirmwareInstall(ws, payload);
    }
  }

  handleFirmwareInstall(ws, payload) {
    // Simulating flash failure states
    if (this.flashScenario === 'corrupted' || (payload.apj && payload.apj.is_corrupt)) {
      ws.send(JSON.stringify({
        type: 'firmware_status',
        stage: 'error',
        message: 'Flash failed: Corrupted image or invalid JSON',
        error: true
      }));
      this.flashScenario = null;
      return;
    }

    if (this.flashScenario === 'interrupted') {
      ws.send(JSON.stringify({ type: 'firmware_status', stage: 'preflight', message: 'Running pre-flight checks...', error: false }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'firmware_status', stage: 'start', message: 'Flash started...', error: false }));
      }, 100);
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'firmware_status', stage: 'erase', progress: 30, message: 'Erasing flash...', error: false }));
      }, 200);
      setTimeout(() => {
        console.log('[MockServer] Abruptly closing client connection for flash interrupted scenario');
        ws.close();
        this.flashScenario = null;
      }, 400);
      return;
    }

    if (this.flashScenario === 'timeout') {
      ws.send(JSON.stringify({ type: 'firmware_status', stage: 'preflight', message: 'Running pre-flight checks...', error: false }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'firmware_status', stage: 'start', message: 'Flash started...', error: false }));
      }, 100);
      // halt progress updates entirely to trigger timeout
      this.flashScenario = null;
      return;
    }

    // Normal successful flash
    ws.send(JSON.stringify({ type: 'firmware_status', stage: 'preflight', message: 'Running pre-flight checks...', error: false }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'firmware_status', stage: 'start', message: 'Flash started...', error: false })), 100);
    
    // Erase progress ticks
    [20, 60, 100].forEach((pct, idx) => {
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'firmware_status', stage: 'erase', progress: pct, message: 'Erasing flash...', error: false }));
      }, 200 + idx * 100);
    });

    // Program progress ticks
    [20, 60, 100].forEach((pct, idx) => {
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'firmware_status', stage: 'program', progress: pct, message: 'Programming firmware...', error: false }));
      }, 500 + idx * 100);
    });

    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'firmware_status', stage: 'complete', message: '✅ FLASH COMPLETED SUCCESSFULLY!', error: false }));
    }, 850);
  }

  sendInitialPackets(ws) {
    const statusMsg = this.generateStatusMsg();
    ws.send(JSON.stringify(statusMsg));

    // Send param values
    Object.keys(this.params).forEach(key => {
      ws.send(JSON.stringify({
        type: 'param_value',
        param_id: key,
        value: this.params[key]
      }));
    });
  }

  startTelemetryBroadcast() {
    this.stopTelemetryBroadcast();
    this.broadcastInterval = setInterval(() => {
      if (this.activeScenario === 'telemetry_loss') return;

      const latency = this.activeScenario === 'slow_network' ? 1000 : 0;
      setTimeout(() => {
        const status = this.generateStatusMsg();
        const gps = this.generateGpsMsg();
        const telemetry = this.generateTelemetryMsg();
        const attitude = this.generateAttitudeMsg();

        this.broadcast(status);
        this.broadcast(gps);
        this.broadcast(telemetry);
        this.broadcast(attitude);
      }, latency);
    }, 1000);
  }

  stopTelemetryBroadcast() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  broadcastTelemetryImmediately() {
    const status = this.generateStatusMsg();
    const gps = this.generateGpsMsg();
    const telemetry = this.generateTelemetryMsg();

    this.broadcast(status);
    this.broadcast(gps);
    this.broadcast(telemetry);
  }

  broadcast(msg) {
    if (this.activeScenario === 'packet_drops' && Math.random() < 0.2) {
      // Simulate drops
      return;
    }

    if (typeof this.validateMessage === 'function') {
      try {
        this.validateMessage(msg);
      } catch (err) {
        console.error('[MockServer] Schema validation failed:', err.message);
      }
    }

    const data = JSON.stringify(msg);
    this.clients.forEach((ws) => {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
      }
    });
  }

  generateStatusMsg() {
    this.seqCounter++;
    return {
      type: 'status',
      seq: this.seqCounter,
      connected: this.activeScenario !== 'telemetry_loss',
      connection: 'UDP',
      vehicles: [
        {
          sysid: 1,
          lat: this.customGpsSatCount === 0 ? 0.0 : 17.601,
          lon: this.customGpsSatCount === 0 ? 0.0 : 78.126,
          yaw: 0.5,
          mode: this.customMode,
          armed: this.customArmed,
          battery_pct: this.customBatteryPct !== null ? this.customBatteryPct : 90,
          battery_v: this.customBatteryPct !== null ? (this.customBatteryPct * 0.13 + 3.0) : 12.0,
          num_sats: this.customGpsSatCount !== null ? this.customGpsSatCount : 9,
          alt: this.customAltitude,
          speed: 5.0
        }
      ]
    };
  }

  generateGpsMsg() {
    return {
      type: 'gps',
      seq: this.seqCounter,
      sysid: 1,
      latitude: this.customGpsSatCount === 0 ? 0.0 : 17.601,
      longitude: this.customGpsSatCount === 0 ? 0.0 : 78.126,
      altitude: this.customAltitude,
      heading: 45.0,
      satellites: this.customGpsSatCount !== null ? this.customGpsSatCount : 9
    };
  }

  generateTelemetryMsg() {
    return {
      type: 'telemetry',
      seq: this.seqCounter,
      sysid: 1,
      data: {
        sysid: 1,
        battery_pct: this.customBatteryPct !== null ? this.customBatteryPct : 90,
        battery_v: this.customBatteryPct !== null ? (this.customBatteryPct * 0.13 + 3.0) : 12.0,
        groundspeed: 5.0,
        satellites: this.customGpsSatCount !== null ? this.customGpsSatCount : 9,
        altitude: this.customAltitude
      }
    };
  }

  generateAttitudeMsg() {
    return {
      type: 'attitude',
      seq: this.seqCounter,
      sysid: 1,
      roll: 0.1,
      pitch: -0.1,
      yaw: 0.5
    };
  }

  // Scenario: Out-of-order packets simulation
  broadcastOutOfOrderTelemetry() {
    // Send standard packet (seq 1500)
    const normalMsg = {
      type: 'status',
      seq: 1500,
      connected: true,
      connection: 'UDP',
      vehicles: [
        {
          sysid: 1,
          battery_pct: 75,
          battery_v: 11.5
        }
      ]
    };
    this.broadcast(normalMsg);

    // Send older stale packet (seq 1400) with battery 90%
    setTimeout(() => {
      const olderMsg = {
        type: 'status',
        seq: 1400,
        connected: true,
        connection: 'UDP',
        vehicles: [
          {
            sysid: 1,
            battery_pct: 90,
            battery_v: 12.0
          }
        ]
      };
      this.broadcast(olderMsg);
    }, 100);
  }

  // Scenario: Duplicate packets simulation
  broadcastDuplicateTelemetry() {
    const msg = {
      type: 'status',
      seq: 2000,
      connected: true,
      connection: 'UDP',
      vehicles: [
        {
          sysid: 1,
          battery_pct: 88,
          battery_v: 11.8,
          num_sats: 8
        }
      ]
    };

    // Send repeatedly
    this.broadcast(msg);
    setTimeout(() => this.broadcast(msg), 50);
    setTimeout(() => this.broadcast(msg), 100);
  }

  // Scenario: Reconnect & Restore simulation
  triggerReconnectRestore() {
    console.log('[MockServer] Triggering disconnect...');
    this.stopTelemetryBroadcast();
    
    // Disconnect clients
    this.clients.forEach(ws => ws.close());

    // Allow reconnect after 1.0 second and resume telemetry
    setTimeout(() => {
      console.log('[MockServer] Reconnect allowed, resuming telemetry...');
      this.startTelemetryBroadcast();
    }, 1000);
  }

  // Scenario: GPS degradation and recovery loop
  triggerGpsDegradationAndRecovery() {
    const steps = [12, 8, 5, 2, 0, 2, 5, 8, 12];
    steps.forEach((sats, idx) => {
      setTimeout(() => {
        this.customGpsSatCount = sats;
        this.customAltitude = sats === 0 ? 0.0 : 10.0;
        this.broadcastTelemetryImmediately();
        console.log(`[MockServer] GPS sat count set to ${sats}`);
      }, idx * 200);
    });
  }
}

module.exports = MockServer;
