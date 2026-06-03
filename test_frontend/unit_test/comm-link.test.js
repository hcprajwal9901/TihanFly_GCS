describe('Communication Link Panel Unit Tests (comm-link.js)', () => {
  beforeEach(() => {
    // 1. Setup DOM target element
    document.body.innerHTML = `
      <div id="panel-comm-link"></div>
    `;

    // Clear globals and configure safeSend mock
    delete window.CommLink;
    delete window.safeSend;
    window.safeSend = jest.fn();
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };

    jest.clearAllMocks();
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
});
