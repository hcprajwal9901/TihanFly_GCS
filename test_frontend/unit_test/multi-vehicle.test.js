describe('Multi-Vehicle Selector Suite (js/multi-vehicle.js)', () => {
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

    // Load module script exactly once in beforeAll to prevent SyntaxError redeclarations
    global.loadScript('js/multi-vehicle.js');
  });

  afterAll(() => {
    // Restore setup.js custom selector guards for other suites
    document.getElementById = originalGetElementById;
    document.querySelector = originalQuerySelector;
    document.querySelectorAll = originalQuerySelectorAll;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Create DOM components
    const selector = document.createElement('select');
    selector.id = 'vehicleSelector';
    document.body.appendChild(selector);

    const wrap = document.createElement('div');
    wrap.id = 'vehicleSelectorWrap';
    document.body.appendChild(wrap);

    const badge = document.createElement('div');
    badge.id = 'droneCountBadge';
    document.body.appendChild(badge);

    const dot = document.createElement('div');
    dot.id = 'droneCountDot';
    document.body.appendChild(dot);

    const text = document.createElement('span');
    text.id = 'droneCountText';
    document.body.appendChild(text);

    // Mock WebSocket state
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn()
    };
  });

  it('should initialize successfully with baseline states', () => {
    expect(window.selectedSysId).toBe(1);
    expect(window.activeSysids).toEqual([]);
  });

  it('should setSelectedSysId and dispatch vehicle_selected CustomEvent correctly', () => {
    const listener = jest.fn();
    window.addEventListener('vehicle_selected', listener);

    // Create tab elements
    const wrap = document.getElementById('vehicleSelectorWrap');
    const tab1 = document.createElement('div');
    tab1.className = 'mv-drone-tab';
    tab1.setAttribute('data-sysid', '1');
    const tab2 = document.createElement('div');
    tab2.className = 'mv-drone-tab';
    tab2.setAttribute('data-sysid', '2');
    wrap.appendChild(tab1);
    wrap.appendChild(tab2);

    window.setSelectedSysId(2);

    expect(window.selectedSysId).toBe(2);
    expect(tab2.classList.contains('mv-active')).toBe(true);
    expect(tab1.classList.contains('mv-active')).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('should route sendToSelected messages correctly', () => {
    const payload = { type: 'arm', value: true };

    // 1. Single active drone target
    window.selectedSysId = 2;
    window.sendToSelected(payload);
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'arm', value: true, sysid: 2 })
    );

    // 2. Broadcast to all active drones if selectedSysId is 0
    window.ws.send.mockClear();
    window.selectedSysId = 0;
    window.activeSysids = [1, 2, 3];
    window.sendToSelected({ type: 'disarm' });

    expect(window.ws.send).toHaveBeenCalledTimes(3);
    expect(window.ws.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'disarm', sysid: 1 }));
    expect(window.ws.send).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'disarm', sysid: 2 }));
    expect(window.ws.send).toHaveBeenNthCalledWith(3, JSON.stringify({ type: 'disarm', sysid: 3 }));
  });

  it('should build fleet cards, battery colors, and badges in updateVehicleSelector', () => {
    const vehicles = [
      { sysid: 1, mode: 'Stabilize', battery_pct: 85, battery_v: 16.5, gps_fix: 3, num_sats: 12, armed: false },
      { sysid: 2, mode: 'Loiter', battery_pct: 15, battery_v: 14.2, gps_fix: 5, num_sats: 18, armed: true }
    ];

    window.updateVehicleSelector(vehicles);

    // Verify fleet count displays
    expect(document.getElementById('droneCountText').textContent).toBe('2 DRONES');

    const wrap = document.getElementById('vehicleSelectorWrap');
    const cards = wrap.querySelectorAll('.mv-drone-tab');
    
    // Total 3 cards (Drone 1, Drone 2, Fleet Card)
    expect(cards.length).toBe(3);

    // Verify individual cards contents
    const card1 = wrap.querySelector('.mv-drone-tab[data-sysid="1"]');
    expect(card1.querySelector('.mv-label').textContent).toBe('D-1');
    expect(card1.querySelector('.mv-arm-badge').textContent).toBe('DSRM');
    expect(card1.querySelector('.mv-dot').classList.contains('mv-warn')).toBe(false);
    expect(card1.querySelector('.mv-dot').classList.contains('mv-err')).toBe(false);

    const card2 = wrap.querySelector('.mv-drone-tab[data-sysid="2"]');
    expect(card2.querySelector('.mv-label').textContent).toBe('D-2');
    expect(card2.querySelector('.mv-arm-badge').textContent).toBe('ARMED');
    
    // Battery low pct: should have error dot class
    expect(card2.querySelector('.mv-dot').classList.contains('mv-err')).toBe(true);

    // Verify click handler switches target
    card2.click();
    expect(window.selectedSysId).toBe(2);
  });

  it('should snap active vehicle target to the first available if selected drone disconnects', () => {
    window.selectedSysId = 3; // Selected drone 3

    // Drone 3 is disconnected in the next update
    const vehicles = [{ sysid: 1 }, { sysid: 2 }];
    window.updateVehicleSelector(vehicles);

    // Active target snaps to first available (sysid = 1)
    expect(window.selectedSysId).toBe(1);
  });

  it('should build connection manager modal and support protocols selections', () => {
    window.openConnectionManager();

    const modal = document.getElementById('mvConnModal');
    expect(modal).not.toBeNull();
    expect(modal.style.display).not.toBe('none');

    const select = document.getElementById('mvConnProtocol');
    expect(select).not.toBeNull();

    const formUdp = document.getElementById('mvFormUdp');
    const formTcp = document.getElementById('mvFormTcp');
    const formSerial = document.getElementById('mvFormSerial');

    // 1. Initially UDP is visible
    expect(formUdp.style.display).not.toBe('none'); // Uses native default display style
    expect(formTcp.style.display).toBe('none');
    expect(formSerial.style.display).toBe('none');

    // 2. Select TCP
    select.value = 'tcp';
    select.dispatchEvent(new Event('change'));

    expect(formUdp.style.display).toBe('none');
    expect(formTcp.style.display).toBe('block');
    expect(formSerial.style.display).toBe('none');
  });

  it('should dispatch manual UDP connections requests correctly', () => {
    window.openConnectionManager();

    const connectBtn = document.getElementById('mvConnectBtn');
    const localPortInput = document.getElementById('mvLocalPort');
    const remoteIpInput = document.getElementById('mvRemoteIp');
    const remotePortInput = document.getElementById('mvRemotePort');

    // Try connect without port
    connectBtn.click();
    expect(document.getElementById('mvConnStatus').textContent).toBe('Enter the GCS Listen Port (e.g. 11040).');

    // Enter port details
    localPortInput.value = '11040';
    remoteIpInput.value = '192.168.1.100';
    remotePortInput.value = '14550';
    connectBtn.click();

    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'connect_vehicle',
        ip: '192.168.1.100',
        port: 14550,
        local_port: 11040
      })
    );
  });

  it('should support serial port selection and refresh triggerings', () => {
    window.openConnectionManager();

    const select = document.getElementById('mvConnProtocol');
    select.value = 'serial';
    select.dispatchEvent(new Event('change'));

    // Verify listing command was sent
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'list_serial_ports' })
    );

    // Mock incoming serial ports list response
    window._vcLastKnownPorts = [
      { port: 'COM3', description: 'Radio Telemetry' }
    ];

    // Fast-forward timeout loop
    jest.useFakeTimers();
    document.getElementById('mvRefreshPorts').click();
    jest.advanceTimersByTime(250);

    const portSelect = document.getElementById('mvSerialPort');
    expect(portSelect.options.length).toBe(1);
    expect(portSelect.value).toBe('COM3');

    // Trigger connect serial
    document.getElementById('mvConnectBtn').click();
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'manual_connect', conn_type: 'serial', port: 'COM3', baud: 115200 })
    );

    jest.useRealTimers();
  });

  it('should handle connect_vehicle_ack status messages', () => {
    window.openConnectionManager();

    // Trigger success ack message
    window._mvHandleMessage({
      type: 'connect_vehicle_ack',
      status: 'ok',
      message: 'UDP link created successfully'
    });

    const statusText = document.getElementById('mvConnStatus');
    expect(statusText.textContent).toBe('✓ UDP link created successfully');
    expect(statusText.style.color).toBe('rgb(74, 222, 128)'); // #4ade80 green
  });

  it('should render active dynamic link lists inside modal and support disconnections', () => {
    // Populate active dynamic links array
    const vehicles = [{ sysid: 1 }];
    const dynLinks = [
      { local_port: 11040, remote_ip: '127.0.0.1', remote_port: 14550, link_id: 0 }
    ];

    window.updateVehicleSelector(vehicles, dynLinks);
    window.openConnectionManager();

    const linkList = document.getElementById('mvLinkList');
    expect(linkList.innerHTML).toContain(':11040 → 127.0.0.1:14550');

    // Click disconnect link button
    const discBtn = linkList.querySelector('button');
    discBtn.click();

    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'disconnect_vehicle', local_port: 11040 })
    );
  });
});