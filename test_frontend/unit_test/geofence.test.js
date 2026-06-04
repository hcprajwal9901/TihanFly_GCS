describe('Geofence Manager Configuration High-Fidelity Behavioral Test Suite (geofence.js)', () => {
  beforeAll(() => {
    // Enable Jest fake timers
    jest.useFakeTimers();

    // Prepare panel container host
    const host = document.createElement('div');
    host.id = 'panel-geofence';
    document.body.appendChild(host);

    // Mock global window objects
    window.safeSend = jest.fn();
    window.SwUtil = {
      toast: jest.fn()
    };
    window.TelemetryStore = {
      altitude: 0,
      distFromHome: 0
    };

    // Load actual geofence script physically
    global.loadScript('js/geofence.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear and re-initialize geofence panel to clean state
    const host = document.getElementById('panel-geofence');
    if (host) {
      host.innerHTML = '';
    }

    // Reset window.Geofence initialised flag by re-loading the script if necessary,
    // but since we keep the same JSDOM environment, we'll manually call init
    if (window.Geofence) {
      // Re-trigger fresh init
      // We manually clear initialised in geofence.js if we could, but let's re-run loadScript to reload context safely
      // Delete old bindings
      delete window.Geofence;
      global.loadScript('js/geofence.js');
      window.Geofence.init();
    }
  });

  describe('Instantiation & UI Initializations', () => {
    it('should inject geofence UI HTML and wire initial refresh requests', () => {
      const panel = document.getElementById('gf-params-wrap');
      expect(panel).toBeDefined();
      expect(document.getElementById('gf-enable-chk')).toBeDefined();
      expect(document.getElementById('gf-save-btn')).toBeDefined();

      // Verify geofence requested initial parameters from FC
      jest.advanceTimersByTime(250); // Tick 200ms initial refresh timeout
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_request_one', name: 'FENCE_ENABLE' });
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_request_one', name: 'FENCE_ALT_MAX' });
    });

    it('should synchronize UI row displays when parameter values are fetched', () => {
      // Fetch FENCE_TYPE as Altitude only (value 1)
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'param_value',
          param_id: 'FENCE_TYPE',
          value: '1.0'
        }
      }));

      // Alt Max row should be visible, Radius row should be hidden
      expect(document.getElementById('gf-row-altmax').style.display).toBe('');
      expect(document.getElementById('gf-row-radius').style.display).toBe('none');

      // Fetch FENCE_TYPE as Circle only (value 2)
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'param_value',
          param_id: 'FENCE_TYPE',
          value: '2.0'
        }
      }));

      expect(document.getElementById('gf-row-altmax').style.display).toBe('none');
      expect(document.getElementById('gf-row-radius').style.display).toBe('');
    });
  });

  describe('Sync Badges & Row Tags Caching', () => {
    it('should toggle rows status to pending when values are edited by the user', () => {
      const altMaxRow = document.getElementById('gf-row-altmax');
      const altMaxInp = document.getElementById('gf-altmax-inp');

      expect(altMaxRow.classList.contains('gf-row-pending')).toBe(false);

      // Edit Alt Max input
      altMaxInp.value = '150';
      altMaxInp.dispatchEvent(new Event('input'));

      expect(altMaxRow.classList.contains('gf-row-pending')).toBe(true);
    });

    it('should flash rows saved and update sync badge upon parameter write ACK', () => {
      const altMaxRow = document.getElementById('gf-row-altmax');
      const altMaxInp = document.getElementById('gf-altmax-inp');

      // Mark row pending
      altMaxInp.value = '180';
      altMaxInp.dispatchEvent(new Event('input'));

      // Click save button
      document.getElementById('gf-save-btn').click();

      // Check safeSend sent param_set command
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'param_set',
        param_id: 'FENCE_ALT_MAX',
        value: 180
      });

      // Send back WS SET command confirmation ACK for all 6 parameters
      const params = ['FENCE_ENABLE', 'FENCE_TYPE', 'FENCE_ACTION', 'FENCE_ALT_MAX', 'FENCE_RADIUS', 'FENCE_MARGIN'];
      params.forEach(p => {
        window.dispatchEvent(new CustomEvent('calibration_ws_message', {
          detail: {
            type: 'param_set_sent',
            param_id: p,
            value: '0'
          }
        }));
      });

      // Pending class should be removed, saved class added
      expect(altMaxRow.classList.contains('gf-row-pending')).toBe(false);
      expect(altMaxRow.classList.contains('gf-row-saved')).toBe(true);
      expect(document.getElementById('gf-save-badge').textContent).toBe('✓ Saved to FC');
    });
  });

  describe('Breach Telemetry Warnings Logic', () => {
    beforeEach(() => {
      // Feed mock parameter values to configure and activate geofence state in state cache
      const mockParams = [
        { id: 'FENCE_ENABLE', val: '1.0' },
        { id: 'FENCE_TYPE', val: '3.0' }, // Alt + Circle active
        { id: 'FENCE_ALT_MAX', val: '100.0' },
        { id: 'FENCE_RADIUS', val: '200.0' },
        { id: 'FENCE_MARGIN', val: '5.0' }
      ];

      mockParams.forEach(p => {
        window.dispatchEvent(new CustomEvent('calibration_ws_message', {
          detail: {
            type: 'param_value',
            param_id: p.id,
            value: p.val
          }
        }));
      });
    });

    it('should show warn status on chips when telemetry value enters margin buffer', () => {
      // altitude limit 100m, margin 5m. Margin trigger range is altitude >= 95m
      window.TelemetryStore.altitude = 96;
      window.TelemetryStore.distFromHome = 50;

      // Advance timers by telemetry monitor tick (500ms)
      jest.advanceTimersByTime(500);

      const altValEl = document.getElementById('gf-chip-alt').querySelector('.gf-telem-chip-value');
      expect(altValEl.textContent).toBe('96.0');
      expect(altValEl.classList.contains('gf-warn')).toBe(true);
      expect(altValEl.classList.contains('gf-bad')).toBe(false);
    });

    it('should present the breach banner and flash bad status when limit is exceeded', () => {
      window.TelemetryStore.altitude = 105; // breaches alt limit (100)
      window.TelemetryStore.distFromHome = 50;

      jest.advanceTimersByTime(500);

      const banner = document.getElementById('gf-breach-banner');
      expect(banner.classList.contains('visible')).toBe(true);
      expect(document.getElementById('gf-breach-sub').textContent).toContain('Alt 105.0 m / 100 m limit');

      const altValEl = document.getElementById('gf-chip-alt').querySelector('.gf-telem-chip-value');
      expect(altValEl.classList.contains('gf-bad')).toBe(true);
    });

    it('should clear breach banners when telemetry values return to safe limits', () => {
      // 1. First trigger breach
      window.TelemetryStore.altitude = 110;
      jest.advanceTimersByTime(500);
      expect(document.getElementById('gf-breach-banner').classList.contains('visible')).toBe(true);

      // 2. Return to safe altitude
      window.TelemetryStore.altitude = 45;
      jest.advanceTimersByTime(500);
      expect(document.getElementById('gf-breach-banner').classList.contains('visible')).toBe(false);
    });
  });
  describe('Edge Cases & Uncovered Paths', () => {
    it('should handle already initialized state and missing host element', () => {
      // Calling init when already initialized should do nothing/return early
      window.Geofence.init();

      // Temporarily restore original getElementById to allow returning null
      const originalGetElementById = document.getElementById;
      document.getElementById = Document.prototype.getElementById.bind(document);

      // Delete all host elements and try to init
      document.querySelectorAll('#panel-geofence').forEach(el => el.remove());
      
      if (window.Geofence && typeof window.Geofence._resetInitialised === 'function') {
        window.Geofence._resetInitialised();
      }
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      window.Geofence.init();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Host element #panel-geofence not found'));
      consoleSpy.mockRestore();

      // Restore custom setup.js mock
      document.getElementById = originalGetElementById;

      // Restore host for other tests
      const newHost = document.createElement('div');
      newHost.id = 'panel-geofence';
      document.body.appendChild(newHost);
    });

    it('should warn when safeSend is missing', () => {
      const originalSafeSend = window.safeSend;
      delete window.safeSend;
      
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // Trigger a refresh/request
      document.getElementById('gf-refresh-btn').click();
      
      expect(consoleSpy).toHaveBeenCalledWith('[Geofence] safeSend not available');
      consoleSpy.mockRestore();
      window.safeSend = originalSafeSend;
    });

    it('should fail validation on invalid input values', () => {
      // 1. Invalid altmax
      document.getElementById('gf-altmax-inp').value = '5';
      document.getElementById('gf-save-btn').click();
      expect(window.SwUtil.toast).toHaveBeenCalledWith('FENCE_ALT_MAX must be 10–1000 m', true);

      // Restore altmax, invalid radius
      document.getElementById('gf-altmax-inp').value = '100';
      document.getElementById('gf-radius-inp').value = '20';
      document.getElementById('gf-save-btn').click();
      expect(window.SwUtil.toast).toHaveBeenCalledWith('FENCE_RADIUS must be 30–10000 m', true);

      // Restore radius, invalid margin
      document.getElementById('gf-radius-inp').value = '150';
      document.getElementById('gf-margin-inp').value = '0.5';
      document.getElementById('gf-save-btn').click();
      expect(window.SwUtil.toast).toHaveBeenCalledWith('FENCE_MARGIN must be 1–10 m', true);
    });

    it('should handle WS message error and unrecognized types', () => {
      // 1. WS msg.type = param_error
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'param_error',
          message: 'Mock FC parameter failure'
        }
      }));
      expect(window.SwUtil.toast).toHaveBeenCalledWith('Geofence param error: Mock FC parameter failure', true);

      // 2. Unrecognized msg type
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'unrecognized_type'
        }
      }));

      // 3. WS message parsing error (evt.detail getter throws)
      const badEvent = new CustomEvent('calibration_ws_message');
      Object.defineProperty(badEvent, 'detail', {
        get: () => { throw new Error('Detail access failure'); }
      });
      window.dispatchEvent(badEvent);
    });

    it('should ignore param_value or param_set_sent with unrecognized param_id', () => {
      // 1. param_value unrecognized id
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'param_value',
          param_id: 'UNKNOWN_PARAM',
          value: '42'
        }
      }));

      // 2. param_set_sent unrecognized id
      window.dispatchEvent(new CustomEvent('calibration_ws_message', {
        detail: {
          type: 'param_set_sent',
          param_id: 'UNKNOWN_PARAM',
          value: '42'
        }
      }));
    });
  });
});