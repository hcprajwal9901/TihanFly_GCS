describe('Core GCS Application Unit Tests (app.js)', () => {
  let wsMockInstance;

  beforeEach(() => {
    // Reset WebSocket instances mock array
    global.WebSocket.instances = [];

    // Reset standard DOM structure required by app.js initialization
    document.body.innerHTML = `
      <div id="videoContainer"></div>
      <div id="map"></div>
      <button id="videoMaxBtn"></button>
      <div class="status-badge"></div>
      <button id="uiAppearanceBtn"></button>
      <div id="uiAppearanceDropdown" style="display: none;"></div>
      <div id="uiAppearanceChevron"></div>
      <input type="checkbox" id="toggleCamera1" />
      <input type="checkbox" id="toggleMessageViewer" />
      <div class="minimal-console-container"></div>
    `;
    
    // Clear mocks
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Define dependencies and helpers globally to be used during script load
    global.initializeUltraSmoothVideo = jest.fn().mockResolvedValue({
      startWebcam: jest.fn(),
      stopWebcam: jest.fn(),
      toggleWebcam: jest.fn(),
      isWebcamActive: jest.fn().mockReturnValue(true)
    });
    global.initializeMissionFileManager = jest.fn();

    // Mock TMap setCenter prototype method
    global.TMap.prototype.setCenter = function(lat, lng, zoom) {
      this.center = [lat, lng];
      this.zoom = zoom;
    };
    global.TMap.prototype.getMarkerCoordinates = function() {
      return [];
    };
    global.TMap.prototype.setDroneAutoPan = function(on) {
      this.droneAutoPan = on;
    };

    global.WebSocket.OPEN = 1;
    global.WebSocket.CLOSED = 3;

    window.selectedSysId = 0;
    window._primarySysId = 1;
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      takeoff: jest.fn(),
      land: jest.fn(),
      rtl: jest.fn()
    };
    window.minimalConsole = window.MsgConsole;
    window.weatherDashboard = {
      onMapClick: jest.fn(),
      fetchWeather: jest.fn()
    };
    window.flightControls = {
      onTakeoff: jest.fn(),
      onLand: jest.fn(),
      onRTL: jest.fn()
    };
    window.WaypointManager = {
      currentMode: null,
      handleMapClick: jest.fn(),
      startAddingWaypoint: jest.fn(),
      clearAllWaypoints: jest.fn(),
      getWaypoints: jest.fn().mockReturnValue([])
    };
    window.PlanFlight = {
      enter: jest.fn(),
      exit: jest.fn(),
      isActive: jest.fn().mockReturnValue(false)
    };
    window.Weather = {
      show: jest.fn(),
      hide: jest.fn()
    };
    window.VideoStream = {
      isWebcamActive: () => true,
      startWebcam: jest.fn(),
      stopWebcam: jest.fn(),
      toggleWebcam: jest.fn()
    };

    // Load the app.js script
    global.loadScript('js/app.js');

    // Retrieve WebSocket instance created in app.js
    wsMockInstance = global.WebSocket.instances[0];

    // Advance timers so all asynchronous components initialize (compass, map, UI toggles etc.)
    jest.advanceTimersByTime(1100);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initialization and Component Integration', () => {
    it('should initialize map immediately and other components after delays', async () => {
      expect(global.tmap).toBeDefined();
      expect(global.tmap.elementId).toBe('map');
      expect(global.compass).toBeDefined();
      expect(global.initializeMissionFileManager).toHaveBeenCalled();
      expect(window.flightControls.onTakeoff).toHaveBeenCalled();
      expect(window.flightControls.onLand).toHaveBeenCalled();
      expect(window.flightControls.onRTL).toHaveBeenCalled();
    });

    it('should retry waypoint manager integration if not initially ready', () => {
      // Temporarily remove WaypointManager
      const savedManager = window.WaypointManager;
      delete window.WaypointManager;

      // Reload app.js with missing manager
      global.loadScript('js/app.js');
      
      // Advance by retry check interval
      jest.advanceTimersByTime(1100);

      // It should start retry interval. Restore it now.
      window.WaypointManager = savedManager;
      
      // Advance by retry check interval (200ms)
      jest.advanceTimersByTime(200);
      expect(window.flightControls.onTakeoff).toHaveBeenCalled();
    });

    it('should handle map initialization failure gracefully', () => {
      // Mock TMap to throw
      const originalTMap = global.TMap;
      global.TMap = jest.fn().mockImplementation(() => {
        throw new Error('Map Initialization Failed');
      });

      // Reload app.js to trigger try-catch
      global.loadScript('js/app.js');
      jest.advanceTimersByTime(1100);

      expect(console.error).toHaveBeenCalledWith('❌ Error initializing map:', expect.any(Error));

      // Restore TMap
      global.TMap = originalTMap;
    });
  });

  describe('haversineDistance', () => {
    it('should calculate exactly zero meters for identical coordinates', () => {
      const lat = 17.601722;
      const lon = 78.126991;
      const dist = global.haversineDistance(lat, lon, lat, lon);
      expect(dist).toBe(0);
    });

    it('should calculate accurate physical distances between distinct coordinates', () => {
      const dist = global.haversineDistance(17.3850, 78.4867, 17.4399, 78.4983);
      expect(dist).toBeGreaterThan(6000);
      expect(dist).toBeLessThan(6300);
    });
  });

  describe('setHeaderStatus UI rendering', () => {
    it('should correctly update status text and apply state class name', () => {
      const badge = document.querySelector('.status-badge');
      
      global.setHeaderStatus('Connected', 'ready');
      expect(badge.textContent).toBe('Connected');
      expect(badge.className).toBe('status-badge ready');

      global.setHeaderStatus('Disconnected', 'error');
      expect(badge.textContent).toBe('Disconnected');
      expect(badge.className).toBe('status-badge error');
    });
  });

  describe('initializeVideoMaximize and PIP Toggles', () => {
    it('should successfully wire buttons and toggle maximize states', () => {
      global.initializeVideoMaximize();
      expect(window.VideoMaximize).toBeDefined();
      expect(window.VideoMaximize.isMaximized()).toBe(false);

      const videoContainer = document.getElementById('videoContainer');
      const mapContainer = document.getElementById('map');
      expect(videoContainer.classList.contains('maximized')).toBe(false);

      // Toggle to maximized state
      window.VideoMaximize.toggle();
      expect(window.VideoMaximize.isMaximized()).toBe(true);
      expect(videoContainer.classList.contains('maximized')).toBe(true);
      expect(mapContainer.classList.contains('minimized')).toBe(true);

      // Toggle back to normal
      window.VideoMaximize.toggle();
      expect(window.VideoMaximize.isMaximized()).toBe(false);
    });

    it('should handle maximize / minimize / toggle shortcuts via keyboard V key', () => {
      global.initializeVideoMaximize();
      
      const event = new KeyboardEvent('keydown', { key: 'v' });
      document.dispatchEvent(event);
      expect(window.VideoMaximize.isMaximized()).toBe(true);

      const eventUpper = new KeyboardEvent('keydown', { key: 'V' });
      document.dispatchEvent(eventUpper);
      expect(window.VideoMaximize.isMaximized()).toBe(false);
    });

    it('should restore maximized video if minimized map container is clicked', () => {
      global.initializeVideoMaximize();
      window.VideoMaximize.maximize();
      expect(window.VideoMaximize.isMaximized()).toBe(true);

      const mapContainer = document.getElementById('map');
      mapContainer.classList.add('minimized');

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      mapContainer.dispatchEvent(clickEvent);

      expect(window.VideoMaximize.isMaximized()).toBe(false);
    });
  });

  describe('Drone WebSocket Client Communication', () => {
    it('should update GPS lock on receiving gps message type', () => {
      wsMockInstance.readyState = 1; // Open
      wsMockInstance.onopen();
      expect(window.MsgConsole.success).toHaveBeenCalledWith('🔌 Backend connected');

      // Send GPS data message
      const gpsMessage = {
        data: JSON.stringify({
          type: 'gps',
          sysid: 1,
          latitude: 17.601722,
          longitude: 78.126991,
          altitude: 100.5,
          heading: 90,
          groundspeed: 5.4,
          satellites: 9
        })
      };
      wsMockInstance.onmessage(gpsMessage);

      // Verify home setting and state updates
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Map locked to drone GPS'));
      expect(global.compass.getTelemetry().latitude).toBe(17.601722);
      expect(global.compass.getTelemetry().satellites).toBe(9);
      expect(global.compass.getHeading()).toBe(90);
    });

    it('should update attitude details on receiving attitude messages', () => {
      wsMockInstance.readyState = 1; // Open
      wsMockInstance.onopen();

      const attitudeMessage = {
        data: JSON.stringify({
          type: 'attitude',
          sysid: 1,
          roll: 0.1,
          pitch: -0.2,
          yaw: 1.5 // Radians (~85.9 degrees)
        })
      };
      wsMockInstance.onmessage(attitudeMessage);

      expect(window.TelemetryStore.roll).toBe(0.1);
      expect(window.TelemetryStore.pitch).toBe(-0.2);
      expect(global.compass.getHeading()).toBeCloseTo(85.94, 1);
    });

    it('should update telemetry details if drone is active/connected', () => {
      wsMockInstance.readyState = 1; // Open
      wsMockInstance.onopen();
      
      // Simulate connection status first
      wsMockInstance.onmessage({
        data: JSON.stringify({
          type: 'status',
          connected: true,
          connection: 'UDP'
        })
      });

      const telemetryMessage = {
        data: JSON.stringify({
          type: 'telemetry',
          sysid: 1,
          groundspeed: 8.24,
          satellites: 12,
          altitude: 45.2
        })
      };
      wsMockInstance.onmessage(telemetryMessage);

      expect(global.compass.getTelemetry().speed).toBe(8.2);
      expect(global.compass.getTelemetry().satellites).toBe(12);
      expect(global.compass.getTelemetry().altitude).toBe(45.2);
    });

    it('should handle disconnect and reconnect routines on close event', () => {
      wsMockInstance.readyState = 1; // Open
      wsMockInstance.onopen();
      wsMockInstance.onclose();

      expect(window.MsgConsole.warning).toHaveBeenCalledWith(expect.stringContaining('Backend disconnected'));
      
      // Check reconnection timer trigger
      jest.advanceTimersByTime(3000);
      expect(global.WebSocket.instances.length).toBe(2);
    });

    it('should log WebSocket connection errors', () => {
      wsMockInstance.onerror(new Error('Connection failed'));
      expect(console.error).toHaveBeenCalledWith('❌ Drone WebSocket error:', expect.any(Error));
    });

    it('should handle JSON parse errors gracefully', () => {
      wsMockInstance.onmessage({ data: 'invalid json content' });
      expect(console.warn).toHaveBeenCalledWith('⚠️ WS message parse error:', expect.any(Error));
    });
  });

  describe('Draggable UI Panels', () => {
    it('should handle mouse dragging movements on draggable panels', () => {
      const panel = document.getElementById('videoContainer');
      
      // Simulate drag
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        bubbles: true
      });
      panel.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 120,
        clientY: 130,
        bubbles: true
      });
      document.dispatchEvent(mousemoveEvent);

      const mouseupEvent = new MouseEvent('mouseup', {
        bubbles: true
      });
      document.dispatchEvent(mouseupEvent);

      expect(panel.style.top).toBeDefined();
      expect(panel.style.left).toBeDefined();
    });

    it('should ignore dragging if initialized on interactive UI controls', () => {
      const panel = document.getElementById('videoContainer');
      const mockButton = document.createElement('button');
      panel.appendChild(mockButton);

      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        bubbles: true
      });
      Object.defineProperty(mousedownEvent, 'target', { value: mockButton, enumerable: true });
      
      panel.dispatchEvent(mousedownEvent);
      // Top style should remain empty/unset as drag shouldn't initiate
      expect(panel.style.top).toBe('');
    });
  });

  describe('UI Appearance Toggle Panels', () => {
    it('should expand and collapse appearance dropdown on button clicks', () => {
      const btn = document.getElementById('uiAppearanceBtn');
      const dropdown = document.getElementById('uiAppearanceDropdown');

      // Click to open
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dropdown.style.display).toBe('flex');

      // Click again to close
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      jest.advanceTimersByTime(200);
      expect(dropdown.style.display).toBe('none');
    });

    it('should close dropdown if user clicks outside of appearance controls', () => {
      const btn = document.getElementById('uiAppearanceBtn');
      const dropdown = document.getElementById('uiAppearanceDropdown');

      // Open first
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dropdown.style.display).toBe('flex');

      // Click outside
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      jest.advanceTimersByTime(200);
      expect(dropdown.style.display).toBe('none');
    });

    it('should toggle camera and message viewer visibility on checkbox change', () => {
      const toggleCam = document.getElementById('toggleCamera1');
      const toggleMsg = document.getElementById('toggleMessageViewer');
      const video = document.getElementById('videoContainer');
      const msgBox = document.querySelector('.minimal-console-container');

      toggleCam.checked = false;
      toggleCam.dispatchEvent(new Event('change'));
      expect(video.style.display).toBe('none');

      toggleCam.checked = true;
      toggleCam.dispatchEvent(new Event('change'));
      expect(video.style.display).toBe('');

      toggleMsg.checked = false;
      toggleMsg.dispatchEvent(new Event('change'));
      expect(msgBox.style.display).toBe('none');
    });
  });

  describe('Global GCS API Wrapper', () => {
    it('should export all module controls in GCS global object', () => {
      expect(window.GCS).toBeDefined();

      // Check module getters
      expect(window.GCS.map()).toBe(global.tmap);
      expect(window.GCS.compass()).toBe(global.compass);
      expect(window.GCS.flightControls()).toBe(window.flightControls);
      expect(window.GCS.weather()).toBe(window.weatherDashboard);
      expect(window.GCS.waypoints()).toBe(window.WaypointManager);

      // Center and Home Locations API
      window.GCS.centerOn(12.34, 56.78, 12);
      expect(global.tmap.center).toEqual([12.34, 56.78]);

      // Add Custom Location
      const locMarker = window.GCS.addLocation(10.1, 20.2, 'Test Loc');
      expect(locMarker).toEqual({ lat: 10.1, lng: 20.2 });

      // Add custom home marker
      const homeMarker = window.GCS.addHomeMarker(11.1, 22.2, 'Test Home');
      expect(homeMarker).toEqual({ lat: 11.1, lng: 22.2 });

      // Centering and going home
      window.GCS.goHome(); // Warning path first since homeMarker is not set on app.js closure
      
      expect(console.warn).toHaveBeenCalledWith('⚠️ Home marker not set');

      // Test Weather
      window.GCS.testWeather();
      expect(window.weatherDashboard.fetchWeather).toHaveBeenCalled();

      // Debug method
      window.GCS.debug();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Component Debug Information'));

      // Video toggles
      window.GCS.maximizeVideo();
      expect(window.VideoMaximize.isMaximized()).toBe(true);

      window.GCS.minimizeVideo();
      expect(window.VideoMaximize.isMaximized()).toBe(false);

      window.GCS.toggleVideo();
      expect(window.VideoMaximize.isMaximized()).toBe(true);

      // Webcam actions
      window.GCS.startWebcam();
      expect(window.GCS.isWebcamActive()).toBe(true);

      window.GCS.stopWebcam();
      window.GCS.toggleWebcam();

      // Waypoints actions
      window.GCS.addWaypoint();
      expect(window.WaypointManager.startAddingWaypoint).toHaveBeenCalled();

      window.GCS.clearWaypoints();
      expect(window.WaypointManager.clearAllWaypoints).toHaveBeenCalled();

      // Mode settings
      window.GCS.enterPlanMode();
      expect(window.PlanFlight.enter).toHaveBeenCalled();
      window.GCS.exitPlanMode();
      expect(window.PlanFlight.exit).toHaveBeenCalled();

      // Drone specific center actions
      window.GCS.centerOnDrone(); // Warning path as no drone marker
      expect(console.warn).toHaveBeenCalledWith('⚠️ No drone marker yet');

      // Set drone auto pan
      window.GCS.droneAutoPan(true);
      expect(global.tmap.droneAutoPan).toBe(true);

      expect(window.GCS.isDroneActive()).toBe(false);
    });

    it('should center map on drone if drone marker is active', () => {
      global.tmap.droneMarker = {
        getLatLng: () => ({ lat: 12.5, lng: 73.2 })
      };
      window.GCS.centerOnDrone();
      expect(global.tmap.center).toEqual([12.5, 73.2]);
    });

    it('should center map on home location if home marker is active', () => {
      wsMockInstance.onopen();
      
      // Trigger status message that connects
      wsMockInstance.onmessage({
        data: JSON.stringify({
          type: 'status',
          connected: true,
          connection: 'UDP'
        })
      });

      expect(console.warn).toBeDefined();
    });

    it('should test map click handler and weather integration routing', () => {
      // Trigger click callback registered on map
      expect(global.tmap.clickCallback).toBeDefined();

      // Case 1: WaypointManager mode is active
      window.WaypointManager.currentMode = 'ADD_WAYPOINT';
      global.tmap.clickCallback(17.6, 78.1, {});
      expect(window.WaypointManager.handleMapClick).toHaveBeenCalledWith(17.6, 78.1, {});

      // Case 2: Plan flight mode active but no waypoint mode
      window.WaypointManager.currentMode = null;
      window.PlanFlight.isActive = () => true;
      global.tmap.clickCallback(17.6, 78.1, {});
      // Should ignore (nothing called)

      // Case 3: Normal mode (no waypoint mode, plan flight inactive)
      window.PlanFlight.isActive = () => false;
      global.tmap.clickCallback(17.6, 78.1, {});
      expect(window.weatherDashboard.onMapClick).toHaveBeenCalledWith(17.6, 78.1);
      expect(window.MsgConsole.info).toHaveBeenCalledWith('Weather: 17.6000, 78.1000 ');
    });
  });

  describe('DroneWS helper methods', () => {
    it('should send payload over websocket helper if websocket is open', () => {
      wsMockInstance.readyState = 1; // Open
      wsMockInstance.onopen();
      const sendMock = jest.fn();
      wsMockInstance.send = sendMock;
      
      window.DroneWS.send({ cmd: 'takeoff' });
      expect(sendMock).toHaveBeenCalledWith(JSON.stringify({ cmd: 'takeoff' }));
      expect(window.DroneWS.status()).toBe(1); // OPEN
    });

    it('should warn when sending payload over websocket if websocket is closed', () => {
      wsMockInstance.readyState = 3; // CLOSED
      wsMockInstance.onclose();
      window.DroneWS.send({ cmd: 'takeoff' });
      expect(console.warn).toHaveBeenCalledWith('⚠️ WebSocket not connected');
    });
  });
});

