describe('Full Parameter Panel Suite (js/param-full.js)', () => {
  let hostPanel;

  beforeAll(() => {
    // Inject JSDOM global fallbacks
    global.CSS = { escape: (s) => s };
    global.WebSocket.OPEN = 1;

    // Mock fetch for param_metadata.json
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ACRO_BAL_PITCH: { d: 'Rate at which pitch returns to level', u: 'deg/s', r: '0 - 3' },
          ARMING_CHECK: {
            d: 'Arming checks bitmask',
            u: '',
            r: '0:Disabled,1:Barometer,2:Compass',
            options: [
              { code: '0', label: 'Disabled' },
              { code: '1', label: 'Barometer' },
              { code: '2', label: 'Compass' }
            ]
          },
          RTL_ALT_M: { d: 'RTL return altitude', u: 'm', r: '1 - 300', reboot: true }
        })
      })
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    
    // Create panel host element
    hostPanel = document.createElement('div');
    hostPanel.id = 'panel-param-full';
    hostPanel.className = 'active'; // Marks it as active
    document.body.appendChild(hostPanel);

    // Mock global safe WebSocket state
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn()
    };
    window.selectedSysId = 1;
    window.activeSysids = [1, 2];

    // Load module script
    global.loadScript('js/param-full.js');
  });

  afterEach(() => {
    delete window._fpBound;
  });

  // Helper to initialize and await the fetch metadata promise
  const initPanel = async () => {
    window.ParamFull.init();
    await new Promise(process.nextTick);
  };

  it('should initialize panel UI and fetch metadata correctly', async () => {
    await initPanel();

    expect(document.getElementById('fpSearch')).toBeDefined();
    expect(document.getElementById('fpFilterType')).toBeDefined();
    expect(document.getElementById('fpRefreshBtn')).toBeDefined();
    expect(document.getElementById('fpWriteBtn')).toBeDefined();
    
    // Verify CSS style block exists
    expect(document.getElementById('fp-style')).not.toBeNull();
  });

  it('should handle param_load_start and display progress correctly', async () => {
    await initPanel();

    // Trigger websocket message event
    const startEvt = new CustomEvent('param_load_start', { detail: { type: 'param_load_start' } });
    window.dispatchEvent(startEvt);

    const wrap = document.getElementById('fpPWrap');
    expect(wrap.style.display).toBe('flex');
    expect(document.getElementById('fpCount').textContent).toBe('Loading parameters…');
  });

  it('should handle param_load_progress updates', async () => {
    await initPanel();

    const progressEvt = new CustomEvent('param_load_progress', {
      detail: { type: 'param_load_progress', received: 50, total: 100, percent: 50 }
    });
    window.dispatchEvent(progressEvt);

    expect(document.getElementById('fpPTxt').textContent).toBe('50 / 100');
    expect(document.getElementById('fpPBar').style.width).toBe('50%');
  });

  it('should build table completely on param_all cache load', async () => {
    await initPanel();

    const allEvt = new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [
          { param_id: 'ACRO_BAL_PITCH', value: 1.5, type: 9, index: 0 },
          { param_id: 'ARMING_CHECK', value: 2.0, type: 9, index: 1 }
        ],
        cached: true
      }
    });
    window.dispatchEvent(allEvt);

    const tbody = document.getElementById('fpBody');
    const rows = tbody.querySelectorAll('tr[data-param]');
    expect(rows.length).toBe(2);

    // Verify row components mapping
    const acroRow = tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]');
    expect(acroRow.querySelector('.fp-param-name').textContent).toBe('ACRO_BAL_PITCH');
    expect(acroRow.querySelector('.param-val-input').value).toBe('1.5');
    expect(acroRow.querySelector('.fp-u').textContent).toBe('deg/s');
    expect(acroRow.querySelector('.fp-range-badge').textContent).toBe('0 - 3');
  });

  it('should upsert single row dynamically on param_value arrival', async () => {
    await initPanel();

    // Trigger initial empty table load complete
    window.dispatchEvent(new CustomEvent('param_load_complete', {
      detail: { type: 'param_load_complete', count: 0, elapsed_ms: 120 }
    }));

    const valEvt = new CustomEvent('param_value', {
      detail: { type: 'param_value', param_id: 'RTL_ALT_M', value: 150.0, type_id: 9, index: 0, count: 1 }
    });
    window.dispatchEvent(valEvt);

    const tbody = document.getElementById('fpBody');
    const row = tbody.querySelector('tr[data-param="RTL_ALT_M"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.param-val-input').value).toBe('150');
    expect(row.querySelector('.fp-reboot-badge')).not.toBeNull();
  });

  it('should mark rows as dirty when values are edited', async () => {
    await initPanel();

    window.dispatchEvent(new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [{ param_id: 'ACRO_BAL_PITCH', value: 1.5 }]
      }
    }));

    const tbody = document.getElementById('fpBody');
    const row = tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]');
    const input = row.querySelector('.param-val-input');

    // Simulate edit value
    input.value = '2.8';
    input.dispatchEvent(new Event('input'));

    expect(row.classList.contains('param-dirty')).toBe(true);

    // Escape should restore original value
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    input.dispatchEvent(escEvent);
    expect(input.value).toBe('1.5');
    expect(row.classList.contains('param-dirty')).toBe(false);
  });

  it('should write changed parameter values on Enter key', async () => {
    await initPanel();

    window.dispatchEvent(new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [{ param_id: 'ACRO_BAL_PITCH', value: 1.5 }]
      }
    }));

    const tbody = document.getElementById('fpBody');
    const row = tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]');
    const input = row.querySelector('.param-val-input');

    input.value = '2.5';
    input.dispatchEvent(new Event('input'));
    
    // Simulate Enter key
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    input.dispatchEvent(enterEvent);

    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_set', param_id: 'ACRO_BAL_PITCH', value: 2.5, sysid: 1 })
    );
  });

  it('should support dropdown selection comboboxes for categorical parameters', async () => {
    await initPanel();

    window.dispatchEvent(new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [{ param_id: 'ARMING_CHECK', value: 0 }]
      }
    }));

    const tbody = document.getElementById('fpBody');
    const row = tbody.querySelector('tr[data-param="ARMING_CHECK"]');
    const select = row.querySelector('.param-val-select');
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(3); // Exactly 0, 1, 2 from metadata

    // Change selection
    select.value = '2';
    select.dispatchEvent(new Event('change'));

    expect(row.classList.contains('param-dirty')).toBe(true);
  });

  it('should search/filter table correctly', async () => {
    await initPanel();

    window.dispatchEvent(new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [
          { param_id: 'ACRO_BAL_PITCH', value: 1.5 },
          { param_id: 'RTL_ALT_M', value: 150 }
        ]
      }
    }));

    const searchInput = document.getElementById('fpSearch');
    const filterSelect = document.getElementById('fpFilterType');

    // 1. Search text match
    searchInput.value = 'RTL';
    searchInput.dispatchEvent(new Event('input'));

    const tbody = document.getElementById('fpBody');
    expect(tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]').style.display).toBe('none');
    expect(tbody.querySelector('tr[data-param="RTL_ALT_M"]').style.display).toBe('');

    // 2. Filter type match (reboot required)
    searchInput.value = '';
    filterSelect.value = 'reboot';
    filterSelect.dispatchEvent(new Event('change'));

    expect(tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]').style.display).toBe('none');
    expect(tbody.querySelector('tr[data-param="RTL_ALT_M"]').style.display).toBe('');
  });

  it('should broadcast dirty parameters to all active drones if sysid = 0', async () => {
    await initPanel();

    window.dispatchEvent(new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [{ param_id: 'ACRO_BAL_PITCH', value: 1.5 }]
      }
    }));

    const tbody = document.getElementById('fpBody');
    const row = tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]');
    const input = row.querySelector('.param-val-input');

    // Edit value
    input.value = '2.9';
    input.dispatchEvent(new Event('input'));

    // Switch selectedSysId to 0 (All Drones)
    window.selectedSysId = 0;

    // Trigger "Write Changed" button click
    const writeBtn = document.getElementById('fpWriteBtn');
    writeBtn.click();

    // Verify broadcast send triggers to active drone 1 and drone 2
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_set', param_id: 'ACRO_BAL_PITCH', value: 2.9, sysid: 1 })
    );
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_set', param_id: 'ACRO_BAL_PITCH', value: 2.9, sysid: 2 })
    );
  });

  it('should support save to file and load from file prompts', async () => {
    await initPanel();

    // Save to File
    const saveBtn = document.getElementById('fpSaveBtn');
    saveBtn.click();
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_save_file', sysid: 1 })
    );

    // Load from File
    window.prompt = jest.fn().mockReturnValue('custom_params.param');
    const loadBtn = document.getElementById('fpLoadBtn');
    loadBtn.click();
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_load_file', path: 'custom_params.param', sysid: 1 })
    );
  });

  it('should clear dirty param on param_set_sent ack arrival', async () => {
    await initPanel();

    window.dispatchEvent(new CustomEvent('param_all', {
      detail: {
        type: 'param_all',
        params: [{ param_id: 'ACRO_BAL_PITCH', value: 1.5 }]
      }
    }));

    const tbody = document.getElementById('fpBody');
    const row = tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"]');
    const input = row.querySelector('.param-val-input');

    input.value = '2.2';
    input.dispatchEvent(new Event('input'));
    expect(row.classList.contains('param-dirty')).toBe(true);

    // Trigger sent ack CustomEvent
    window.dispatchEvent(new CustomEvent('param_set_sent', {
      detail: { type: 'param_set_sent', param_id: 'ACRO_BAL_PITCH', value: 2.2 }
    }));

    expect(row.classList.contains('param-dirty')).toBe(false);
    expect(row.classList.contains('param-sent')).toBe(true);
  });

  it('should re-request parameters when current active vehicle is changed', async () => {
    await initPanel();

    // Verify initial load request list trigger
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_get_all', sysid: 1 })
    );

    // Change selectedSysId and fire vehicle_selected
    window.selectedSysId = 2;
    window.dispatchEvent(new CustomEvent('vehicle_selected'));

    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'param_get_all', sysid: 2 })
    );
  });
});