describe('GCS Flight Plan Mission Send High-Fidelity Behavioral Test Suite (plan-flight-mission-send.js)', () => {
  let modeInstance;
  let originalCreateElement;
  let capturedTimeouts;
  let originalMockHandleMenuAction;

  beforeAll(() => {
    // Keep reference to genuine native document.createElement before any spy modifications
    originalCreateElement = document.createElement;

    // Define dummy constructor and prototype handleMenuAction for PlanFlightMode
    window.PlanFlightMode = function() {};
    originalMockHandleMenuAction = jest.fn();
    window.PlanFlightMode.prototype.handleMenuAction = originalMockHandleMenuAction;

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-mission-send.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    capturedTimeouts = [];

    // Neutralize setup.js aggressive DOM guards to restore realistic browser behavior
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      return document.body.querySelector(`#${id}`);
    });
    jest.spyOn(document, 'querySelector').mockImplementation((selector) => {
      return document.body.querySelector(selector);
    });

    // Mock MsgConsole component silently
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Spy on global console warnings and errors silently
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure WebSocket static constants are defined
    if (global.WebSocket) {
      global.WebSocket.CONNECTING = 0;
      global.WebSocket.OPEN = 1;
      global.WebSocket.CLOSING = 2;
      global.WebSocket.CLOSED = 3;
    }

    // Mock WebSocket connection
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn()
    };

    // Mock setTimeout to capture delay callbacks
    jest.spyOn(global, 'setTimeout').mockImplementation((cb, delay) => {
      capturedTimeouts.push({ cb, delay });
      return capturedTimeouts.length;
    });

    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: jest.fn(() => Promise.resolve())
      },
      writable: true,
      configurable: true
    });

    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Setup GCS global states
    window.selectedSysId = 1;
    window.activeSysids = [1, 2];
    window.PlanFlight = modeInstance;

    // Clear background queue states
    window.missionQueue = [];
    window.missionQueueBusy = false;
    window._missionInFlightSysid = null;
    if (window.missionQueueTimer) {
      window.missionQueueTimer = null;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Mission Queue System & Broadcasting', () => {
    it('should push payloads to missionQueue and trigger pump on idle state', () => {
      const msg = { type: 'mission', sysid: 1, waypoints: [] };
      window.queueMissionPayload(msg);

      expect(window.missionQueueBusy).toBe(true);
      expect(window._missionInFlightSysid).toBe(1);
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify(msg));
    });

    it('should not immediately pump new queued payloads if queue is already busy', () => {
      const msg1 = { type: 'mission', sysid: 1 };
      const msg2 = { type: 'mission', sysid: 2 };

      window.queueMissionPayload(msg1);
      window.ws.send.mockClear();

      window.queueMissionPayload(msg2);
      expect(window.missionQueue.length).toBe(1);
      expect(window.ws.send).not.toHaveBeenCalled();
    });

    it('should advance queue with small settle delay on advanceMissionQueue', () => {
      window.queueMissionPayload({ type: 'mission', sysid: 1 });
      window.queueMissionPayload({ type: 'mission', sysid: 2 });

      // Queue is busy with sysid 1. Advance the queue for sysid 1.
      window.advanceMissionQueue(1);

      expect(window.missionQueueBusy).toBe(false);
      expect(window._missionInFlightSysid).toBeNull();

      // Invoke the settle timeout (400ms) to trigger pump for next item
      const settleTimer = capturedTimeouts.find(t => t.delay === 400);
      expect(settleTimer).toBeTruthy();
      
      settleTimer.cb();
      expect(window._missionInFlightSysid).toBe(2);
    });

    it('should ignore advanceMissionQueue calls that do not match the current in-flight sysid', () => {
      window.queueMissionPayload({ type: 'mission', sysid: 1 });
      window.advanceMissionQueue(2); // Mismatching sysid

      expect(window.missionQueueBusy).toBe(true);
      expect(window._missionInFlightSysid).toBe(1);
    });

    it('should trigger a 6-second timeout fallback that advances the queue on lack of ACK', () => {
      window.queueMissionPayload({ type: 'mission', sysid: 1 });
      window.queueMissionPayload({ type: 'mission', sysid: 2 });

      // Find the 6000ms fallback timeout
      const fallbackTimer = capturedTimeouts.find(t => t.delay === 6000);
      expect(fallbackTimer).toBeTruthy();

      fallbackTimer.cb(); // trigger timeout

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ACK timeout'));
      expect(window.missionQueueBusy).toBe(true);
      expect(window._missionInFlightSysid).toBe(2);
    });
  });

  describe('Routing & Patches', () => {
    it('should route mission send action types correctly in handleMissionSendActions', () => {
      const spyMarkers = jest.spyOn(modeInstance, 'sendMarkersToDrone').mockImplementation(() => {});
      const spyMission = jest.spyOn(modeInstance, 'sendMissionToDrone').mockImplementation(() => {});

      modeInstance.handleMissionSendActions('send-markers');
      expect(spyMarkers).toHaveBeenCalledTimes(1);

      modeInstance.handleMissionSendActions('send-mission');
      expect(spyMission).toHaveBeenCalledTimes(1);

      modeInstance.handleMissionSendActions('write-to-drone');
      expect(spyMission).toHaveBeenCalledTimes(2);

      modeInstance.handleMissionSendActions('invalid-action');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown mission send action'));

      spyMarkers.mockRestore();
      spyMission.mockRestore();
    });

    it('should intercept handled actions in patched handleMenuAction prototype method', () => {
      const spySendActions = jest.spyOn(modeInstance, 'handleMissionSendActions').mockImplementation(() => {});

      // Call interceptable action
      modeInstance.handleMenuAction('send-markers');
      expect(spySendActions).toHaveBeenCalledWith('send-markers');
      expect(originalMockHandleMenuAction).not.toHaveBeenCalled();

      // Call standard non-send action
      spySendActions.mockClear();
      originalMockHandleMenuAction.mockClear();
      modeInstance.handleMenuAction('new-mission');
      expect(spySendActions).not.toHaveBeenCalled();
      expect(originalMockHandleMenuAction).toHaveBeenCalledWith('new-mission');

      spySendActions.mockRestore();
    });

    it('should provide global window shortcuts for sendMissionToDrone and sendMarkersToDrone', () => {
      const spyMarkers = jest.spyOn(modeInstance, 'sendMarkersToDrone').mockImplementation(() => {});
      const spyMission = jest.spyOn(modeInstance, 'sendMissionToDrone').mockImplementation(() => {});

      window.sendMarkersToDrone();
      expect(spyMarkers).toHaveBeenCalledTimes(1);

      window.sendMissionToDrone();
      expect(spyMission).toHaveBeenCalledTimes(1);

      spyMarkers.mockRestore();
      spyMission.mockRestore();
    });
  });

  describe('Function: sendMarkersToDrone (Rich JSON Format)', () => {
    beforeEach(() => {
      window.WaypointManager = {
        getWaypoints: jest.fn(() => [
          { id: 1, lat: 12.3456789, lng: 80.1234567, altitude: 25, speed: 5, type: 'takeoff' },
          { id: 2, lat: 12.3556789, lng: 80.1334567, altitude: 30, speed: 8, type: 'waypoint' },
          { id: 3, lat: 12.3656789, lng: 80.1434567, altitude: 35, speed: 10, type: 'hover' },
          { id: 4, lat: 12.3756789, lng: 80.1534567, altitude: 40, speed: 12, type: 'rtl' },
          { id: 5, lat: 12.3856789, lng: 80.1634567, altitude: 45, speed: 15, type: 'landing' }
        ])
      };
    });

    it('should alert error if WebSocket is not open', () => {
      window.ws.readyState = 0; // not open
      modeInstance.sendMarkersToDrone();

      expect(window.MsgConsole.error).toHaveBeenCalledWith('Not connected to backend');
      expect(window.ws.send).not.toHaveBeenCalled();
    });

    it('should show warning if WaypointManager has no waypoints set', () => {
      window.WaypointManager.getWaypoints.mockImplementation(() => []);
      modeInstance.sendMarkersToDrone();

      expect(window.MsgConsole.warning).toHaveBeenCalledWith(expect.stringContaining('No waypoints'));
      expect(window.ws.send).not.toHaveBeenCalled();
    });

    it('should generate rich JSON payload with actions mapping and queues message correctly', () => {
      modeInstance.sendMarkersToDrone();

      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Sending 5 markers to drone'));

      // Check if ws send was called with formatted markers message envelope
      expect(window.ws.send).toHaveBeenCalledTimes(1);
      const sentPayload = JSON.parse(window.ws.send.mock.calls[0][0]);
      
      expect(sentPayload.type).toBe('flight_plan');
      expect(sentPayload.sysid).toBe(1); // window.selectedSysId

      const flightPlan = sentPayload.data;
      expect(flightPlan.drone_id).toBe('Drone_001');
      expect(flightPlan.status).toBe('active');

      const wps = flightPlan.flight_plan.waypoints;
      expect(wps.length).toBe(5);

      // Verify coordinate precision rounding to 7 decimals
      expect(wps[0].latitude).toBe(12.3456789);
      expect(wps[0].longitude).toBe(80.1234567);

      // Verify action mapping rules
      expect(wps[0].action).toBe('takeoff');
      expect(wps[1].action).toBe('move'); // waypoint maps to move
      expect(wps[2].action).toBe('hover');
      expect(wps[3].action).toBe('return'); // rtl maps to return
      expect(wps[4].action).toBe('land'); // landing maps to land

      // Verify speed and altitude properties
      expect(wps[0].altitude).toBe(25);
      expect(wps[0].speed).toBe(5);
      expect(wps[4].altitude).toBe(45);
      expect(wps[4].speed).toBe(15);

      // Verify ISO string timestamp incrementing (5 mins per waypoint)
      const t1 = new Date(wps[0].estimated_time);
      const t2 = new Date(wps[1].estimated_time);
      expect(t2.getTime() - t1.getTime()).toBe(5 * 60 * 1000);
    });

    it('should broadcast markers to all active sysids if selectedSysId is 0', () => {
      window.selectedSysId = 0; // Broadcast mode
      modeInstance.sendMarkersToDrone();

      // Should call ws send twice, once for sysid 1 and once for sysid 2
      const activeTimer = capturedTimeouts.find(t => t.delay === 400);
      expect(window.missionQueue.length).toBe(1); // second in queue
      expect(window._missionInFlightSysid).toBe(1); // first in-flight
    });
  });

  describe('Function: sendMissionToDrone (MAVLink Format)', () => {
    beforeEach(() => {
      window.WaypointManager = {
        getWaypoints: jest.fn(() => [
          { id: 1, lat: 12.34, lng: 80.12, altitude: 25, speed: 5, type: 'takeoff' },
          { id: 2, lat: 12.35, lng: 80.13, altitude: 30, speed: 8, type: 'waypoint', hold_time: 2 },
          { id: 3, lat: 12.36, lng: 80.14, altitude: 35, speed: 10, type: 'hover' },
          { id: 4, lat: 12.37, lng: 80.15, altitude: 40, speed: 12, type: 'rtl' },
          { id: 5, lat: 12.38, lng: 80.16, altitude: 45, speed: 15, type: 'landing' }
        ]),
        getHomePosition: jest.fn(() => ({ lat: 12.0, lng: 80.0, altitude: 10 }))
      };
    });

    it('should prepend seq=0 home position and build MAVLink command list correctly', () => {
      modeInstance.sendMissionToDrone();

      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Uploading mission: home +'));
      
      const sentPayload = JSON.parse(window.ws.send.mock.calls[0][0]);
      expect(sentPayload.type).toBe('mission');

      const items = sentPayload.waypoints;
      
      // We expect 7 items:
      // seq 0: home coordinates (12.0, 80.0)
      // seq 1: takeoff (12.34, 80.12)
      // seq 2: waypoint (12.35, 80.13)
      // seq 3: loiter/hover (12.36, 80.14)
      // seq 4: fly-to waypoint for RTL (12.37, 80.15)
      // seq 5: RTL command (12.37, 80.15)
      // seq 6: Land command (12.38, 80.16)
      expect(items.length).toBe(7);

      // seq 0 (home position)
      expect(items[0].seq).toBe(0);
      expect(items[0].latitude).toBe(12.0);
      expect(items[0].longitude).toBe(80.0);
      expect(items[0].command).toBe(16); // MAV_CMD_NAV_WAYPOINT (16)

      // seq 1 (takeoff)
      expect(items[1].seq).toBe(1);
      expect(items[1].latitude).toBe(12.34);
      expect(items[1].command).toBe(22); // MAV_CMD_NAV_TAKEOFF (22)

      // seq 2 (waypoint)
      expect(items[2].seq).toBe(2);
      expect(items[2].latitude).toBe(12.35);
      expect(items[2].command).toBe(16);
      expect(items[2].param1).toBe(2); // hold_time = 2

      // seq 3 (hover)
      expect(items[3].seq).toBe(3);
      expect(items[3].command).toBe(17); // MAV_CMD_NAV_LOITER_UNLIM (17)

      // seq 4 (fly-to before RTL)
      expect(items[4].seq).toBe(4);
      expect(items[4].command).toBe(16);

      // seq 5 (RTL trigger command)
      expect(items[5].seq).toBe(5);
      expect(items[5].command).toBe(20); // MAV_CMD_NAV_RETURN_TO_LAUNCH (20)

      // seq 6 (land command)
      expect(items[6].seq).toBe(6);
      expect(items[6].command).toBe(21); // MAV_CMD_NAV_LAND (21)
    });

    it('should leverage PolygonManager survey fallbacks if waypoints are empty', () => {
      window.WaypointManager.getWaypoints.mockImplementation(() => []);
      
      // Setup mock survey data
      window.PolygonManager = {
        surveyGrid: [
          { lat: 12.50, lng: 80.50 },
          { lat: 12.51, lng: 80.51 }
        ],
        surveySettings: { altitude: 60, speed: 12 }
      };

      modeInstance.sendMissionToDrone();

      expect(window.MsgConsole.info).toHaveBeenCalledWith(expect.stringContaining('Using polygon survey grid'));
      
      const sentPayload = JSON.parse(window.ws.send.mock.calls[0][0]);
      const items = sentPayload.waypoints;

      // We expect 4 items:
      // seq 0: home
      // seq 1: takeoff (prepended)
      // seq 2: grid point 1
      // seq 3: grid point 2
      expect(items.length).toBe(4);
      expect(items[1].command).toBe(22); // takeoff
      expect(items[2].latitude).toBe(12.50);
      expect(items[2].altitude).toBe(60);
      expect(items[3].latitude).toBe(12.51);
    });
  });

  describe('Sent Payload Overlay UI & ACKs', () => {
    it('should create #sentPayloadOverlay and inject formatted JSON markup', () => {
      const payload = { mock_data: true };
      window.showSentPayloadOverlay(payload, 'markers');

      const overlay = document.body.querySelector('#sentPayloadOverlay');
      expect(overlay).toBeTruthy();
      expect(overlay.textContent).toContain('Markers Sent to Drone');

      const pre = overlay.querySelector('pre');
      expect(pre.textContent).toContain('"mock_data": true');
    });

    it('should dismiss overlay panel on clicking close button', () => {
      const payload = { mock_data: true };
      window.showSentPayloadOverlay(payload, 'markers');

      const closeBtn = document.body.querySelector('#closePayloadBtn');
      expect(closeBtn).toBeTruthy();

      closeBtn.click();
      expect(document.body.querySelector('#sentPayloadOverlay')).toBeNull();
    });

    it('should trigger clip writeText on copy button click', async () => {
      const payload = { mock_data: true };
      window.showSentPayloadOverlay(payload, 'markers');

      const copyBtn = document.body.querySelector('#copyPayloadBtn');
      expect(copyBtn).toBeTruthy();

      copyBtn.click();

      // Wait microtask promises
      await Promise.resolve();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
      expect(copyBtn.textContent).toBe('✅ Copied!');
    });

    it('should advance queue and log success on handleMissionAck with success status', () => {
      const spyAdvance = jest.spyOn(window, 'advanceMissionQueue').mockImplementation(() => {});
      
      const msg = { type: 'mission_ack', status: 'success', sysid: 1 };
      window.handleMissionAck(msg);

      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Mission uploaded'));
      expect(spyAdvance).toHaveBeenCalledWith(1);

      spyAdvance.mockRestore();
    });

    it('should advance queue and log success on handleFlightPlanAck with success status', () => {
      const spyAdvance = jest.spyOn(window, 'advanceMissionQueue').mockImplementation(() => {});
      
      const msg = { type: 'flight_plan_ack', status: 'success', sysid: 2 };
      window.handleFlightPlanAck(msg);

      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Markers delivered to drone'));
      expect(spyAdvance).toHaveBeenCalledWith(2);

      spyAdvance.mockRestore();
    });
  });
});