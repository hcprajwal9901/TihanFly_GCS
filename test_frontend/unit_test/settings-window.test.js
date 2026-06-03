describe('GCS Settings Window Shell & Sidebar Routing High-Fidelity Test Suite (settings-window.js)', () => {
  beforeAll(() => {
    // Restore native JSDOM methods to allow natural null checks and element injections
    document.getElementById = Document.prototype.getElementById;
    document.querySelector = Document.prototype.querySelector;
    document.querySelectorAll = Document.prototype.querySelectorAll;

    jest.useFakeTimers();

    // Mock global dependencies
    window.updateAllDroneSelectors = jest.fn();

    // Set up panel modules mock targets
    window.CalibAccel = { init: jest.fn() };
    window.CalibCompass = { init: jest.fn() };
    window.panel_calib_level = { init: jest.fn() };
    window.ParamSwitch = { init: jest.fn() };

    // Load settings-window.js physically in JSDOM
    global.loadScript('js/settings-window.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Remove pre-existing settings overlay if any
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.remove();
  });

  describe('Overlay Injection & Shell Layout', () => {
    it('should inject correct HTML shell when open() is called', () => {
      expect(document.getElementById('settingsOverlay')).toBeNull();

      // Open settings window
      window.SettingsWindow.open();

      const overlay = document.getElementById('settingsOverlay');
      expect(overlay).toBeTruthy();
      expect(overlay.style.display).toBe('flex');

      // Verify header titles
      expect(document.querySelector('.settings-header-title').textContent).toBe('Vehicle Configuration');
      expect(document.querySelector('.settings-header-subtitle').textContent).toBe('TiHANFly Ground Control Station');

      // Verify sidebar nav buttons
      const navButtons = Array.from(document.querySelectorAll('.settings-nav-btn'));
      expect(navButtons.length).toBeGreaterThan(5);

      // Verify that default visible panel (calib-accel) gets automatically initialised
      expect(window.CalibAccel.init).toHaveBeenCalledTimes(1);
    });

    it('should prevent double overlay creation on multiple open() calls', () => {
      window.SettingsWindow.open();
      const firstOverlay = document.getElementById('settingsOverlay');

      window.SettingsWindow.open();
      const secondOverlay = document.getElementById('settingsOverlay');

      expect(firstOverlay).toBe(secondOverlay);
    });
  });

  describe('Sidebar Routing & Lazy Load Module Triggers', () => {
    beforeEach(() => {
      window.SettingsWindow.open();
      jest.clearAllMocks();
    });

    it('should navigate between tabs and lazy-load relevant panels', () => {
      const compassBtn = document.querySelector('.settings-nav-btn[data-panel="calib-compass"]');
      const accelBtn = document.querySelector('.settings-nav-btn[data-panel="calib-accel"]');

      const compassPanel = document.getElementById('panel-calib-compass');
      const accelPanel = document.getElementById('panel-calib-accel');

      // Default active: accel
      expect(accelBtn.classList.contains('active')).toBe(true);
      expect(accelPanel.classList.contains('active')).toBe(true);
      expect(compassBtn.classList.contains('active')).toBe(false);
      expect(compassPanel.classList.contains('active')).toBe(false);

      // Click Compass tab
      compassBtn.click();

      expect(accelBtn.classList.contains('active')).toBe(false);
      expect(accelPanel.classList.contains('active')).toBe(false);
      expect(compassBtn.classList.contains('active')).toBe(true);
      expect(compassPanel.classList.contains('active')).toBe(true);

      // Verify lazy init ran for compass
      expect(window.CalibCompass.init).toHaveBeenCalledTimes(1);

      // Click Compass tab again - should NOT trigger double initialization
      compassBtn.click();
      expect(window.CalibCompass.init).toHaveBeenCalledTimes(1);
    });

    it('should display error block if panel module fails to initialize', () => {
      // Cause an error on level panel init
      window.panel_calib_level.init.mockImplementationOnce(() => {
        throw new Error('Compass magnetic interference');
      });

      const levelBtn = document.querySelector('.settings-nav-btn[data-panel="calib-level"]');
      levelBtn.click();

      const levelPanel = document.getElementById('panel-calib-level');
      expect(levelPanel.textContent).toContain('Failed to load panel: calib-level');
      expect(levelPanel.textContent).toContain('Compass magnetic interference');
    });

    it('should display script not loaded warning if module script is missing', () => {
      const failsafeBtn = document.querySelector('.settings-nav-btn[data-panel="failsafe"]');
      failsafeBtn.click();

      const failsafePanel = document.getElementById('panel-failsafe');
      expect(failsafePanel.textContent).toContain('Panel script not loaded:');
      expect(failsafePanel.textContent).toContain('failsafe.js');
    });
  });

  describe('Overlay Close & Dismissals', () => {
    beforeEach(() => {
      window.SettingsWindow.open();
    });

    it('should close the overlay on close button click with fade out', () => {
      const closeBtn = document.getElementById('settingsCloseBtn');
      const overlay = document.getElementById('settingsOverlay');

      expect(overlay.style.display).toBe('flex');

      closeBtn.click();
      expect(overlay.classList.contains('closing')).toBe(true);

      // Advance timers to trigger fade out completion
      jest.advanceTimersByTime(200);
      expect(overlay.style.display).toBe('none');
      expect(overlay.classList.contains('closing')).toBe(false);
    });

    it('should close overlay on Escape keydown', () => {
      const overlay = document.getElementById('settingsOverlay');
      expect(overlay.style.display).toBe('flex');

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escapeEvent);

      expect(overlay.classList.contains('closing')).toBe(true);
      jest.advanceTimersByTime(200);
      expect(overlay.style.display).toBe('none');
    });
  });

  describe('SwUtil Shared Global Utility Helpers', () => {
    beforeEach(() => {
      window.SettingsWindow.open();
    });

    it('should update status texts and classlists correctly', () => {
      const container = document.createElement('div');
      container.id = 'status-test-el';
      document.body.appendChild(container);

      window.SwUtil.setStatus('status-test-el', 'Calibration complete!', 'success');

      expect(container.textContent).toBe('Calibration complete!');
      expect(container.className).toBe('calib-status-value success');

      container.remove();
    });

    it('should trigger micro-animated success and error toasts', () => {
      const toastEl = document.getElementById('settingsToast');
      expect(toastEl.classList.contains('show')).toBe(false);

      // Successful toast
      window.SwUtil.toast('Ginseng written', false);
      expect(toastEl.textContent).toContain('✓');
      expect(toastEl.textContent).toContain('Ginseng written');
      expect(toastEl.className).toContain('success');
      expect(toastEl.classList.contains('show')).toBe(true);

      // Let it timeout
      jest.advanceTimersByTime(3000);
      expect(toastEl.classList.contains('show')).toBe(false);

      // Error toast
      window.SwUtil.toast('IMU Saturated', true);
      expect(toastEl.textContent).toContain('✕');
      expect(toastEl.textContent).toContain('IMU Saturated');
      expect(toastEl.className).toContain('error');
      expect(toastEl.classList.contains('show')).toBe(true);
    });
  });
});