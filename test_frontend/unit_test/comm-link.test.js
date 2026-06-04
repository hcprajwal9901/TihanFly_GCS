describe('Communication Link Panel Unit Tests (comm-link.js)', () => {
  beforeEach(() => {
    // 1. Setup DOM target element
    document.body.innerHTML = `
      <div id="panel-comm-link"></div>
    `;

    // Clear globals and configure safeSend mock
    if (window.CommLink && window.CommLink._resetInitialised) {
      window.CommLink._resetInitialised();
    }
    delete window.CommLink;
    delete window.safeSend;
    window.safeSend = jest.fn();
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };

    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    // 2. Load the script
    global.loadScript('js/comm-link.js');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render link state widgets and select boxes on init', () => {
    expect(window.CommLink).toBeDefined();

    // Run init
    window.CommLink.init();

    expect(document.getElementById('clPanel')).toBeDefined();
    expect(document.getElementById('clStatusDot')).toBeDefined();
    expect(document.getElementById('clModeAuto')).toBeDefined();
    expect(document.getElementById('clModeManual')).toBeDefined();
  });

  describe('UI Interaction Modes & Connections Toggle', () => {
    it('should swap viewports and labels when switching between automatic and manual modes', () => {
      window.CommLink.init();

      const autoSec = document.getElementById('clAutoSection');
      const manualSec = document.getElementById('clManualSection');

      // Auto mode is visible initially
      expect(autoSec.style.display).not.toBe('none');
      expect(manualSec.style.display).toBe('none');

      // Set to manual
      window.CommLink._setMode('manual');
      expect(autoSec.style.display).toBe('none');
      expect(manualSec.style.display).toBe('flex');
    });

    it('should select different manual communication protocols', () => {
      window.CommLink.init();
      window.CommLink._setMode('manual');

      // Default is UDP settings visible
      expect(document.getElementById('clUdpForm').style.display).not.toBe('none');
      expect(document.getElementById('clTcpForm').style.display).toBe('none');

      // Change connection type to TCP
      window.CommLink._setConnType('tcp');
      expect(document.getElementById('clUdpForm').style.display).toBe('none');
      expect(document.getElementById('clTcpForm').style.display).not.toBe('none');
    });
  });

  describe('WebSocket handshakes and ACK message confirmations', () => {
    it('should dispatch list_serial_ports WS message on refresh ports', () => {
      window.CommLink.init();
      jest.clearAllMocks();

      window.CommLink._refresh_ports();

      expect(window.safeSend).toHaveBeenCalledWith({ type: 'list_serial_ports' });
    });

    it('should dispatch manual_connect actions and add connection upon ACK confirmation', () => {
      window.CommLink.init();
      window.CommLink._setMode('manual');
      
      // Setup UDP fields in DOM
      document.getElementById('clListenPort').value = '11040';
      document.getElementById('clIpInput').value = '127.0.0.1';

      jest.clearAllMocks();

      // Trigger connect
      window.CommLink._do_connect();

      // Check MAVLink UDP query is dispatched
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'connect_vehicle',
        ip: '127.0.0.1',
        port: 1,
        local_port: 11040
      });

      // Send the positive manual_connect ACK confirmation
      window.CommLink.processMessage({
        type: 'manual_connect_ack',
        status: 'ok',
        conn_id: 'conn_udp_1',
        conn_type: 'udp',
        message: 'Manual connection successful'
      });

      // Verify connection lists elements rendering
      const connsList = document.getElementById('clConnectionsList');
      expect(connsList.textContent).toContain('UDP');
      expect(window.MsgConsole.success).toHaveBeenCalledWith(
        expect.stringContaining('connection successful')
      );
    });
  });

  describe('Edge cases, protocols, and handlers', () => {
    it('should not initialize again if already initialized', () => {
      window.CommLink.init();
      const originalHtml = document.getElementById('panel-comm-link').innerHTML;
      document.getElementById('panel-comm-link').innerHTML = 'different';
      window.CommLink.init();
      expect(document.getElementById('panel-comm-link').innerHTML).toBe('different');
    });

    it('should log warning if host element is missing', () => {
      document.body.innerHTML = '';
      const spyGetElementById = jest.spyOn(document, 'getElementById').mockReturnValue(null);
      const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      window.CommLink.init();
      expect(spyWarn).toHaveBeenCalledWith('[CommLink] host div not found');
      spyWarn.mockRestore();
      spyGetElementById.mockRestore();
    });

    it('should use fallback window.ws.send if safeSend is not defined', () => {
      window.CommLink.init();
      delete window.safeSend;
      window.ws = {
        readyState: WebSocket.OPEN,
        send: jest.fn()
      };
      
      window.CommLink._refresh_ports();
      expect(window.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'list_serial_ports' }));
      delete window.ws;
    });

    it('should log warning on _ws_send if no socket is available', () => {
      window.CommLink.init();
      delete window.safeSend;
      const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      window.CommLink._refresh_ports();
      expect(spyWarn).toHaveBeenCalledWith('[CommLink] WS not ready:', { type: 'list_serial_ports' });
      spyWarn.mockRestore();
    });

    it('should handle custom event calibration_ws_message of type status', () => {
      window.CommLink.init();
      
      const event = new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'status',
          ports: {
            serial_available: true,
            serial_port: 'COM3',
            udp_available: true,
            udp_port: 14550,
            dyn_udp_links: [
              { remote_ip: '127.0.0.1', remote_port: 14555, local_port: 14550 }
            ]
          }
        }
      });
      window.dispatchEvent(event);

      const dot = document.getElementById('clStatusDot');
      expect(dot.className).toContain('connected');
      
      const connsList = document.getElementById('clConnectionsList');
      expect(connsList.textContent).toContain('COM3');
      expect(connsList.textContent).toContain('0.0.0.0:14550');
    });

    it('should handle custom event calibration_ws_message of type serial_ports', () => {
      window.CommLink.init();
      window.CommLink._setConnType('serial');

      const event = new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'serial_ports',
          ports: [
            { port: 'COM1', display: 'COM1 - Port 1', description: 'Serial Port 1' },
            { port: 'COM2', display: 'COM2 - Port 2', description: 'Serial Port 2' }
          ]
        }
      });
      window.dispatchEvent(event);

      const portList = document.getElementById('clPortList');
      expect(portList.innerHTML).toContain('COM1 - Port 1');
      expect(portList.innerHTML).toContain('COM2 - Port 2');

      // Select port
      window.CommLink._selectPort('COM1');
      expect(portList.querySelector('.selected').textContent).toContain('COM1 - Port 1');
    });

    it('should show empty serial port list message if empty serial_ports is received', () => {
      window.CommLink.init();
      window.CommLink._setConnType('serial');

      const event = new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'serial_ports',
          ports: []
        }
      });
      window.dispatchEvent(event);

      const portList = document.getElementById('clPortList');
      expect(portList.textContent).toContain('No serial ports found');
    });

    it('should validate form and show error for serial port connections', () => {
      window.CommLink.init();
      window.CommLink._setConnType('serial');
      
      // Select none
      window.CommLink._selectPort('');
      window.CommLink._do_connect();
      expect(document.getElementById('clStatusText').textContent).toBe('No serial port selected.');

      // Select one and connect
      window.CommLink._selectPort('COM1');
      window.CommLink._do_connect();
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'manual_connect',
        conn_type: 'serial',
        port: 'COM1',
        baud: 115200
      });
    });

    it('should validate form and show error for TCP connections', () => {
      window.CommLink.init();
      window.CommLink._setConnType('tcp');

      // Blank IP
      document.getElementById('clTcpIp').value = '';
      window.CommLink._do_connect();
      expect(document.getElementById('clStatusText').textContent).toBe('Enter a host/IP address.');

      // Valid IP
      document.getElementById('clTcpIp').value = '192.168.1.100';
      document.getElementById('clTcpPort').value = '8000';
      window.CommLink._do_connect();
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'manual_connect',
        conn_type: 'tcp',
        ip: '192.168.1.100',
        port: 8000
      });
    });

    it('should validate form and show error for UDP connection GCS Listen Port', () => {
      window.CommLink.init();
      window.CommLink._setConnType('udp');

      document.getElementById('clListenPort').value = '';
      window.CommLink._do_connect();
      expect(document.getElementById('clStatusText').textContent).toBe('Enter the GCS Listen Port (e.g. 11040).');
    });

    it('should handle failed manual connect ACK status', () => {
      window.CommLink.init();
      window.CommLink._setMode('manual');

      window.CommLink.processMessage({
        type: 'manual_connect_ack',
        status: 'error',
        message: 'Port busy'
      });

      expect(document.getElementById('clStatusText').textContent).toBe('✗ Port busy');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('[CommLink] Port busy');
    });

    it('should handle disconnect action and disconnect ACKs', () => {
      window.CommLink.init();
      
      // Attempt disconnect with no active manual connections
      window.CommLink._do_disconnect();
      expect(window.safeSend).not.toHaveBeenCalled();

      // Establish a connection
      window.CommLink.processMessage({
        type: 'manual_connect_ack',
        status: 'ok',
        conn_id: 'conn_1',
        conn_type: 'udp',
        message: 'Connected'
      });

      // Disconnect last connection
      window.CommLink._do_disconnect();
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'manual_disconnect',
        conn_id: 'conn_1'
      });

      // Confirm disconnect failed ACK
      window.CommLink.processMessage({
        type: 'manual_disconnect_ack',
        status: 'error',
        message: 'Could not disconnect'
      });
      expect(document.getElementById('clStatusText').textContent).toBe('✗ Could not disconnect');

      // Confirm disconnect success ACK
      window.CommLink.processMessage({
        type: 'manual_disconnect_ack',
        status: 'ok',
        conn_id: 'conn_1',
        message: 'Disconnected successfully'
      });
      expect(window.MsgConsole.info).toHaveBeenCalledWith('🔌 Disconnected successfully');
    });

    it('should restore refresh button text after timeout', () => {
      window.CommLink.init();
      window.CommLink._refresh_ports();
      const btn = document.getElementById('clRefreshBtn');
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('⟳ Scanning…');

      jest.advanceTimersByTime(2000);
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('🔄 Refresh Ports');
    });

    it('should ignore message if type or payload is empty', () => {
      expect(window.CommLink.processMessage(null)).toBeUndefined();
      expect(window.CommLink.processMessage({})).toBeUndefined();
    });
  });
});
