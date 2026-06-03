describe('Plan Flight Mode - Polygon Actions High-Fidelity Behavioral Test Suite (plan-flight-polygon.js)', () => {
  let instance;

  beforeAll(() => {
    // Enable Jest fake timers
    jest.useFakeTimers();

    // Setup basic mock objects
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    window.PolygonManager = {
      isDrawing: false,
      surveySettings: {
        altitude: 100,
        hFov: 120,
        vFov: 90,
        overlap: 70,
        sidelap: 60,
        spacing: 20,
        angle: 45,
        speed: 5
      },
      cancelDrawing: jest.fn(),
      startDrawing: jest.fn(),
      showSurveyPatternModal: jest.fn(),
      generateSurveyGrid: jest.fn(),
      clearPolygon: jest.fn()
    };

    window.WaypointManager = {
      currentMode: null,
      cancelCurrentOperation: jest.fn()
    };

    // Load actual script in global JSDOM context
    global.loadScript('plan-flight-modules/plan-flight-polygon.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Restore clean mock states
    window.PolygonManager.isDrawing = false;
    window.PolygonManager.surveySettings = {
      altitude: 100,
      hFov: 120,
      vFov: 90,
      overlap: 70,
      sidelap: 60,
      spacing: 20,
      angle: 45,
      speed: 5
    };
    window.WaypointManager.currentMode = null;

    // Clean up any stray modals in JSDOM body
    const modal = document.getElementById('surveySettingsModal');
    if (modal) {
      modal.remove();
    }

    // Create fresh instance of PlanFlightMode
    instance = new PlanFlightMode();
  });

  describe('Prototype Extension Validation', () => {
    it('should extend PlanFlightMode prototype with correct action handlers', () => {
      expect(typeof PlanFlightMode.prototype.handlePolygonActions).toBe('function');
      expect(typeof PlanFlightMode.prototype.drawPolygon).toBe('function');
      expect(typeof PlanFlightMode.prototype.showSurveyPattern).toBe('function');
      expect(typeof PlanFlightMode.prototype.showSurveySettings).toBe('function');
      expect(typeof PlanFlightMode.prototype.showSurveySettingsModal).toBe('function');
      expect(typeof PlanFlightMode.prototype.clearPolygon).toBe('function');
    });
  });

  describe('Function: handlePolygonActions', () => {
    beforeEach(() => {
      jest.spyOn(instance, 'drawPolygon').mockImplementation(() => {});
      jest.spyOn(instance, 'showSurveyPattern').mockImplementation(() => {});
      jest.spyOn(instance, 'showSurveySettings').mockImplementation(() => {});
      jest.spyOn(instance, 'clearPolygon').mockImplementation(() => {});
    });

    it('should route draw-polygon action', () => {
      instance.handlePolygonActions('draw-polygon');
      expect(instance.drawPolygon).toHaveBeenCalledTimes(1);
    });

    it('should route survey-pattern action', () => {
      instance.handlePolygonActions('survey-pattern');
      expect(instance.showSurveyPattern).toHaveBeenCalledTimes(1);
    });

    it('should route survey-settings action', () => {
      instance.handlePolygonActions('survey-settings');
      expect(instance.showSurveySettings).toHaveBeenCalledTimes(1);
    });

    it('should route clear-polygon action', () => {
      instance.handlePolygonActions('clear-polygon');
      expect(instance.clearPolygon).toHaveBeenCalledTimes(1);
    });

    it('should log warning for unknown action', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      instance.handlePolygonActions('unknown-action');
      expect(warnSpy).toHaveBeenCalledWith('Unknown polygon action: unknown-action');
      warnSpy.mockRestore();
    });
  });

  describe('Function: drawPolygon', () => {
    it('should handle error state if PolygonManager is missing', () => {
      const originalPolygonManager = window.PolygonManager;
      delete window.PolygonManager;

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      instance.drawPolygon();

      expect(errorSpy).toHaveBeenCalledWith('❌ PolygonManager not initialized!');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('Polygon system not ready');

      // Restore
      window.PolygonManager = originalPolygonManager;
      errorSpy.mockRestore();
    });

    it('should cancel drawing if PolygonManager is already drawing', () => {
      window.PolygonManager.isDrawing = true;

      instance.drawPolygon();

      expect(window.PolygonManager.cancelDrawing).toHaveBeenCalledTimes(1);
    });

    it('should cancel current operation if WaypointManager is in active mode', () => {
      window.WaypointManager.currentMode = 'add-waypoint';

      instance.drawPolygon();

      expect(window.WaypointManager.cancelCurrentOperation).toHaveBeenCalledTimes(1);
    });

    it('should start drawing session and output instructions toast on success', () => {
      instance.drawPolygon();

      expect(window.PolygonManager.startDrawing).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith(
        '🔷 Click map to place vertices — drag to adjust — Enter to finish — ESC to cancel'
      );
    });
  });

  describe('Function: showSurveyPattern', () => {
    it('should handle error state if PolygonManager is missing', () => {
      const originalPolygonManager = window.PolygonManager;
      delete window.PolygonManager;

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      instance.showSurveyPattern();

      expect(errorSpy).toHaveBeenCalledWith('❌ PolygonManager not initialized!');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('Polygon system not ready');

      // Restore
      window.PolygonManager = originalPolygonManager;
      errorSpy.mockRestore();
    });

    it('should open the survey pattern modal via PolygonManager', () => {
      instance.showSurveyPattern();
      expect(window.PolygonManager.showSurveyPatternModal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Function: showSurveySettings', () => {
    it('should handle error state if PolygonManager is missing', () => {
      const originalPolygonManager = window.PolygonManager;
      delete window.PolygonManager;

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      instance.showSurveySettings();

      expect(errorSpy).toHaveBeenCalledWith('❌ PolygonManager not initialized!');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('Polygon system not ready');

      // Restore
      window.PolygonManager = originalPolygonManager;
      errorSpy.mockRestore();
    });

    it('should delegate to showSurveySettingsModal on success', () => {
      const modalSpy = jest.spyOn(instance, 'showSurveySettingsModal').mockImplementation(() => {});
      instance.showSurveySettings();
      expect(modalSpy).toHaveBeenCalledTimes(1);
      modalSpy.mockRestore();
    });
  });

  describe('Function: showSurveySettingsModal', () => {
    it('should do nothing and print error if PolygonManager is missing', () => {
      const originalPolygonManager = window.PolygonManager;
      delete window.PolygonManager;

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      instance.showSurveySettingsModal();

      expect(errorSpy).toHaveBeenCalledWith('❌ PolygonManager not available');

      // Restore
      window.PolygonManager = originalPolygonManager;
      errorSpy.mockRestore();
    });

    it('should remove existing modal, render the layout, and set up live mathematical calculations', () => {
      // Setup a pre-existing modal to test cleanup logic
      const dummyModal = document.createElement('div');
      dummyModal.id = 'surveySettingsModal';
      document.body.appendChild(dummyModal);

      // Trigger modal builder
      instance.showSurveySettingsModal();

      // Assert pre-existing modal was removed and exactly one modal exists
      const modals = document.querySelectorAll('#surveySettingsModal');
      expect(modals.length).toBe(1);

      const modal = document.getElementById('surveySettingsModal');
      expect(modal).toBeDefined();

      // Check form fields match the surveySettings
      const altInput = document.getElementById('ss-altitude');
      const hfovInput = document.getElementById('ss-hfov');
      const vfovInput = document.getElementById('ss-vfov');
      const overlapInput = document.getElementById('ss-overlap');
      const spacingInput = document.getElementById('ss-spacing');
      const sidelapInput = document.getElementById('ss-sidelap');
      const angleInput = document.getElementById('ss-angle');
      const speedInput = document.getElementById('ss-speed');

      expect(altInput.value).toBe('100');
      expect(hfovInput.value).toBe('120');
      expect(vfovInput.value).toBe('90');
      expect(overlapInput.value).toBe('70');
      expect(spacingInput.value).toBe('20.0');
      expect(sidelapInput.value).toBe('94.2'); // derived: (1 - 20 / (2 * 100 * tan(60))) * 100
      expect(angleInput.value).toBe('45');
      expect(speedInput.value).toBe('5');

      // Test live calculations on inputs change
      // 1. Double the altitude to 200m
      altInput.value = '200';
      altInput.dispatchEvent(new Event('input'));

      // Ground footprint should recalculate:
      // alt = 200, hFov = 120 -> fw = 2 * 200 * tan(60 deg) = 400 * 1.73205 = 692.82m
      // alt = 200, vFov = 90 -> fh = 2 * 200 * tan(45 deg) = 400 * 1 = 400.00m
      // fa = 692.82 * 400 = 277128.1 m²
      // autoSpacing is true, so spacing should automatically adapt to match curSidelap (94.2%):
      // spacing = fw * (1 - 94.2/100) = 692.82 * 0.058 = 40.18m (approx)
      
      expect(document.getElementById('ss-fw').textContent).toContain('692.82 m');
      expect(document.getElementById('ss-fh').textContent).toContain('400.00 m');
      expect(document.getElementById('ss-fa').textContent).toContain('277128.1 m²');

      // 2. Adjust Line Spacing and verify sidelap changes
      spacingInput.value = '100'; // 100 meters
      spacingInput.dispatchEvent(new Event('input'));
      // sidelap = (1 - 100/692.82) * 100 = 85.56%
      expect(document.getElementById('ss-sl-pct').textContent).toBe('85.6');
      expect(sidelapInput.value).toBe('85.6');
    });

    it('should dismiss the modal if cancel button is clicked', () => {
      instance.showSurveySettingsModal();
      
      const modal = document.getElementById('surveySettingsModal');
      expect(modal).toBeTruthy();

      const cancelBtn = document.getElementById('ss-cancel');
      cancelBtn.click();

      expect(document.body.contains(modal)).toBe(false);
    });

    it('should dismiss the modal if backdrop is clicked', () => {
      instance.showSurveySettingsModal();
      
      const modal = document.getElementById('surveySettingsModal');
      expect(modal).toBeTruthy();

      // Click on background backdrop (the modal wrapper element itself)
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.contains(modal)).toBe(false);
    });

    it('should NOT dismiss the modal if modal content box itself is clicked', () => {
      instance.showSurveySettingsModal();
      
      const modal = document.getElementById('surveySettingsModal');
      expect(modal).toBeTruthy();

      // Click a inner element inside the modal container
      const altInput = document.getElementById('ss-altitude');
      altInput.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.contains(modal)).toBe(true);
    });

    it('should apply and regenerate the survey grid on clicking Apply', () => {
      instance.showSurveySettingsModal();

      const modal = document.getElementById('surveySettingsModal');
      expect(modal).toBeTruthy();

      // Modify values on form
      document.getElementById('ss-altitude').value = '150';
      document.getElementById('ss-hfov').value = '110';
      document.getElementById('ss-vfov').value = '80';
      document.getElementById('ss-overlap').value = '65';
      document.getElementById('ss-angle').value = '90';
      document.getElementById('ss-speed').value = '12';

      // Dispatch changes for altitude and FOVs first
      document.getElementById('ss-altitude').dispatchEvent(new Event('input'));

      // Set manual spacing last so it is not overridden by altitude auto-spacing recalculations
      document.getElementById('ss-spacing').value = '45';
      document.getElementById('ss-spacing').dispatchEvent(new Event('input'));

      // Click Apply
      document.getElementById('ss-apply').click();

      // Assert parameters mapped back to PolygonManager settings
      expect(window.PolygonManager.surveySettings.altitude).toBe(150);
      expect(window.PolygonManager.surveySettings.hFov).toBe(110);
      expect(window.PolygonManager.surveySettings.vFov).toBe(80);
      expect(window.PolygonManager.surveySettings.overlap).toBe(65);
      expect(window.PolygonManager.surveySettings.spacing).toBe(45);
      expect(window.PolygonManager.surveySettings.angle).toBe(90);
      expect(window.PolygonManager.surveySettings.speed).toBe(12);

      // Verify grid generation and success toast
      expect(window.PolygonManager.generateSurveyGrid).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Survey settings applied and grid regenerated');

      // Modal closed
      expect(document.body.contains(modal)).toBe(false);
    });
  });

  describe('Function: clearPolygon', () => {
    let confirmSpy;

    beforeEach(() => {
      confirmSpy = jest.spyOn(window, 'confirm');
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    it('should handle error state if PolygonManager is missing', () => {
      const originalPolygonManager = window.PolygonManager;
      delete window.PolygonManager;

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      instance.clearPolygon();

      expect(errorSpy).toHaveBeenCalledWith('❌ PolygonManager not initialized!');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('Polygon system not ready');

      // Restore
      window.PolygonManager = originalPolygonManager;
      errorSpy.mockRestore();
    });

    it('should do nothing if the user rejects the confirm dialog', () => {
      confirmSpy.mockReturnValue(false);

      instance.clearPolygon();

      expect(confirmSpy).toHaveBeenCalledWith('Clear the current polygon and survey grid?');
      expect(window.PolygonManager.clearPolygon).not.toHaveBeenCalled();
      expect(window.MsgConsole.success).not.toHaveBeenCalled();
    });

    it('should clear polygon, remove map layers, and log success if user confirms', () => {
      confirmSpy.mockReturnValue(true);

      instance.clearPolygon();

      expect(confirmSpy).toHaveBeenCalledWith('Clear the current polygon and survey grid?');
      expect(window.PolygonManager.clearPolygon).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('✅ Polygon cleared');
    });
  });
});