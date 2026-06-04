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

  describe('Additional Edge Cases for param-full.js', () => {
    it('should test loadExternalMeta failure and default fetch errors', async () => {
      // Mock fetch rejection
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error('Fetch failed')));
      // We re-init to trigger loadExternalMeta
      await initPanel();
      // Should not crash and use default meta
      expect(document.getElementById('fpSearch')).toBeDefined();
    });

    it('should fall back to regex checks in getMeta', async () => {
      await initPanel();
      // Check different parameter types matching regex patterns in getMeta
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'INS_ACC2OFFS_X', value: 1.0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'INS_GYR2OFFS_X', value: 0.1 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'INS_GYR2_ID', value: 1234 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'BARO1_WCF', value: 0.5 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'GPS1_TYPE', value: 1 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'ATC_RAT_RLL_P', value: 0.15 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'PSC_POSXY_P', value: 1.0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'WPNAV_RADIUS', value: 200 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'LOG_BITMASK', value: 65535 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'NTF_LED_BRIGHT', value: 3 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'PRX_TYPE', value: 0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'FILT1_TYPE', value: 1 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'NET_ENABLE', value: 1 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'RNGFND_TYPE', value: 0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'TEMP1_TYPE', value: 0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'SR0_EXTRA1', value: 10 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'BATT_MONITOR', value: 4 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'MNT1_TYPE', value: 0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'OSD1_TYPE', value: 0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'CAN_TYPE', value: 0 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'LAND_SPEED', value: 50 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'UNKNOWN_PARAM', value: 10 }
      }));

      const tbody = document.getElementById('fpBody');
      expect(tbody.querySelector('tr[data-param="INS_ACC2OFFS_X"]')).not.toBeNull();
    });

    it('should handle wsSend failure modes and status toasts', async () => {
      window.SwUtil.toast = jest.fn();
      await initPanel();

      // Trigger param_file_saved, param_file_loaded, param_error messages
      window.dispatchEvent(new CustomEvent('param_file_saved', {
        detail: { type: 'param_file_saved', message: 'Custom save ok', path: '/test' }
      }));
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Custom save ok');

      window.dispatchEvent(new CustomEvent('param_file_loaded', {
        detail: { type: 'param_file_loaded', message: 'Custom load ok', count: 10 }
      }));
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Custom load ok');

      window.dispatchEvent(new CustomEvent('param_error', {
        detail: { type: 'param_error', message: 'Custom error occurred' }
      }));
      expect(window.SwUtil.toast).toHaveBeenCalledWith('⚠ Custom error occurred');

      // wsSend fails when ws is not present
      delete window.ws;
      window.dispatchEvent(new CustomEvent('ws_connected')); // executes wsSend but does not throw
    });

    it('should handle complex range cell representation (bitmask, multi-options)', async () => {
      // Configure metadata return for custom bitmask param
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            BITMASK_PARAM: {
              d: 'Custom bitmask description',
              isBitmask: true,
              bitmask: [
                { bit: 0, label: 'Bit 0 Label' },
                { bit: 1, label: 'Bit 1 Label' }
              ]
            },
            MANY_OPTS_PARAM: {
              d: 'Custom options list',
              options: [
                { code: '0', label: 'Opt 0' },
                { code: '1', label: 'Opt 1' },
                { code: '2', label: 'Opt 2' },
                { code: '3', label: 'Opt 3' }
              ]
            }
          })
        })
      );

      await initPanel();

      window.dispatchEvent(new CustomEvent('param_all', {
        detail: {
          type: 'param_all',
          params: [
            { param_id: 'BITMASK_PARAM', value: 1 },
            { param_id: 'MANY_OPTS_PARAM', value: 0 }
          ]
        }
      }));

      const tbody = document.getElementById('fpBody');
      const bitmaskRow = tbody.querySelector('tr[data-param="BITMASK_PARAM"]');
      expect(bitmaskRow.innerHTML).toContain('fp-bit');
      expect(bitmaskRow.innerHTML).toContain('Bit 0 Label');

      const optionsRow = tbody.querySelector('tr[data-param="MANY_OPTS_PARAM"]');
      expect(optionsRow.innerHTML).toContain('+1 more');
    });

    it('should test input events, focus, blur, non-enter keydown, and empty keydown', async () => {
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

      // Focus removes readonly
      input.dispatchEvent(new Event('focus'));

      // Non-numerical values on input
      input.value = 'invalid-val';
      input.dispatchEvent(new Event('input'));
      expect(row.classList.contains('param-dirty')).toBe(false);

      // Keydown other key (e.g. Tab) does nothing
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));

      // Keydown Enter on invalid value does not call wsSend
      window.ws.send.mockClear();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(window.ws.send).not.toHaveBeenCalled();
    });

    it('should test refresh button, prompt cancels, and write toast errors', async () => {
      await initPanel();

      // Refresh click clears all params and requests list
      window.dispatchEvent(new CustomEvent('param_all', {
        detail: {
          type: 'param_all',
          params: [{ param_id: 'ACRO_BAL_PITCH', value: 1.5 }]
        }
      }));
      window.ws.send.mockClear();
      const refreshBtn = document.getElementById('fpRefreshBtn');
      refreshBtn.click();
      expect(window.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'param_request_list', sysid: 1 })
      );

      // Prompt cancels on Load from File
      window.prompt = jest.fn().mockReturnValue(null);
      window.ws.send.mockClear();
      const loadBtn = document.getElementById('fpLoadBtn');
      loadBtn.click();
      expect(window.ws.send).not.toHaveBeenCalled();

      // Write button without changed params
      window.SwUtil.toast = jest.fn();
      const writeBtn = document.getElementById('fpWriteBtn');
      writeBtn.click();
      expect(window.SwUtil.toast).toHaveBeenCalledWith('No changed parameters');
    });

    it('should test vehicle_selected active class condition', async () => {
      await initPanel();

      // Remove active class from host panel
      hostPanel.classList.remove('active');
      window.ws.send.mockClear();

      // Change vehicle when panel is inactive
      window.selectedSysId = 3;
      window.dispatchEvent(new CustomEvent('vehicle_selected'));
      expect(window.ws.send).not.toHaveBeenCalled();

      // Re-add active class
      hostPanel.classList.add('active');
      window.dispatchEvent(new CustomEvent('vehicle_selected'));
      expect(window.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'param_get_all', sysid: 3 })
      );
    });

    it('should check upsertRow on existing elements updates select/inputs', async () => {
      await initPanel();

      window.dispatchEvent(new CustomEvent('param_all', {
        detail: {
          type: 'param_all',
          params: [
            { param_id: 'ARMING_CHECK', value: 0 },
            { param_id: 'ACRO_BAL_PITCH', value: 1.5 }
          ]
        }
      }));

      // Trigger param_value updates on existing parameter
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'ARMING_CHECK', value: 1 }
      }));
      window.dispatchEvent(new CustomEvent('param_value', {
        detail: { type: 'param_value', param_id: 'ACRO_BAL_PITCH', value: 2.0 }
      }));

      const tbody = document.getElementById('fpBody');
      expect(tbody.querySelector('tr[data-param="ARMING_CHECK"] .param-val-select').value).toBe('1');
      expect(tbody.querySelector('tr[data-param="ACRO_BAL_PITCH"] .param-val-input').value).toBe('2');
    });
  });
});