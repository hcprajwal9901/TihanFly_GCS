describe('GCS Initial Tune Wizard High-Fidelity Behavioral Test Suite (initial-tune.js)', () => {
  beforeAll(() => {
    // Restore native JSDOM methods to allow natural null checks and element injections
    document.getElementById = Document.prototype.getElementById;
    document.querySelector = Document.prototype.querySelector;
    document.querySelectorAll = Document.prototype.querySelectorAll;

    jest.useFakeTimers();

    // Mock global components
    window.SwUtil = {
      toast: jest.fn()
    };
    window.safeSend = jest.fn();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Setup host DOM node
    document.body.innerHTML = '<div id="panel-initial-tune"></div>';

    // Load initial-tune.js physically in JSDOM
    global.loadScript('js/initial-tune.js');

    // Initialize module
    window.InitialTune.init();
  });

  function triggerWsMessage(msg) {
    const evt = new CustomEvent('calibration_ws_message', { detail: msg });
    window.dispatchEvent(evt);
  }

  describe('Form Layout and Prerequisites Banner', () => {
    it('should inject correct form elements, calculate buttons, and initially hide preview section', () => {
      expect(document.querySelector('.it-prereq-banner')).toBeTruthy();
      expect(document.getElementById('it-prop-size')).toBeTruthy();
      expect(document.getElementById('it-cell-count')).toBeTruthy();
      expect(document.getElementById('it-chemistry')).toBeTruthy();
      expect(document.getElementById('it-calc-btn')).toBeTruthy();

      const previewSection = document.getElementById('it-preview-section');
      expect(previewSection.style.display).toBe('none');

      const statusMsg = document.getElementById('it-status-msg');
      expect(statusMsg.textContent).toContain('Enter your airframe details above');
    });
  });

  describe('Chemistry Voltage Switch Defaults', () => {
    it('should auto-populate charged/discharged voltage inputs correctly when switching battery chemistry options', () => {
      const chemSelect = document.getElementById('it-chemistry');
      const chargedInp = document.getElementById('it-cell-charged');
      const dischargedInp = document.getElementById('it-cell-discharged');

      // Switch to LiHV
      chemSelect.value = 'LiHV';
      chemSelect.dispatchEvent(new Event('change'));

      expect(chargedInp.value).toBe('4.35');
      expect(dischargedInp.value).toBe('3.5');

      // Switch to LiFe
      chemSelect.value = 'LiFe';
      chemSelect.dispatchEvent(new Event('change'));

      expect(chargedInp.value).toBe('3.6');
      expect(dischargedInp.value).toBe('3');

      // Switch to NiMH
      chemSelect.value = 'NiMH';
      chemSelect.dispatchEvent(new Event('change'));

      expect(chargedInp.value).toBe('1.45');
      expect(dischargedInp.value).toBe('1.1');

      // Switch back to LiPo
      chemSelect.value = 'LiPo';
      chemSelect.dispatchEvent(new Event('change'));

      expect(chargedInp.value).toBe('4.2');
      expect(dischargedInp.value).toBe('3.5');
    });
  });

  describe('Prop Size Filter Scaling Calculator', () => {
    it('should resolve correct gyro and rate filters for various propeller sizes', () => {
      const propInp = document.getElementById('it-prop-size');
      const calcBtn = document.getElementById('it-calc-btn');

      // Test 5" props (should resolve to 100Hz)
      propInp.value = '5';
      calcBtn.click();

      let previewRows = document.querySelectorAll('#it-preview-tbody tr');
      // Assert INS_GYRO_FILTER is 100
      expect(previewRows[3].querySelector('.it-param-val').textContent).toBe('100');

      // Test 10" props (should resolve to 40Hz)
      propInp.value = '10';
      propInp.dispatchEvent(new Event('change')); // auto-preview updates if preview visible

      previewRows = document.querySelectorAll('#it-preview-tbody tr');
      expect(previewRows[3].querySelector('.it-param-val').textContent).toBe('40');

      // Test 15" props (should resolve to 25Hz)
      propInp.value = '15';
      propInp.dispatchEvent(new Event('change'));

      previewRows = document.querySelectorAll('#it-preview-tbody tr');
      expect(previewRows[3].querySelector('.it-param-val').textContent).toBe('25');

      // Test 20" props (should resolve to 20Hz)
      propInp.value = '20';
      propInp.dispatchEvent(new Event('change'));

      previewRows = document.querySelectorAll('#it-preview-tbody tr');
      expect(previewRows[3].querySelector('.it-param-val').textContent).toBe('20');
    });
  });

  describe('Suggested Settings & Failsafes Calculations', () => {
    it('should compile suggestive values table including battery voltage, ESC bounds, and AP4 low/critical options', () => {
      const cellInp = document.getElementById('it-cell-count');
      const tMotorCk = document.getElementById('it-tmotor-esc');
      const ap4Ck = document.getElementById('it-ap4-settings');
      const calcBtn = document.getElementById('it-calc-btn');

      cellInp.value = '6'; // 6S Battery
      tMotorCk.checked = true;
      ap4Ck.checked = true;

      calcBtn.click();

      // Verify preview section opens
      expect(document.getElementById('it-preview-section').style.display).toBe('block');

      // 6 basic params + 2 T-Motor params + 5 AP4 params = 13 parameters total
      const previewRows = document.querySelectorAll('#it-preview-tbody tr');
      expect(previewRows.length).toBe(13);

      // Verify battery voltage calculations:
      // MOT_BAT_VOLT_MAX: 6S * 4.2V = 25.2V
      expect(previewRows[0].querySelector('.it-param-id').textContent).toBe('MOT_BAT_VOLT_MAX');
      expect(previewRows[0].querySelector('.it-param-val').textContent).toBe('25.2');

      // MOT_BAT_VOLT_MIN: 6S * 3.5V = 21V
      expect(previewRows[1].querySelector('.it-param-id').textContent).toBe('MOT_BAT_VOLT_MIN');
      expect(previewRows[1].querySelector('.it-param-val').textContent).toBe('21');

      // BATT_ARM_VOLT: 6S * (3.5 + 0.2) = 22.2V
      expect(previewRows[2].querySelector('.it-param-id').textContent).toBe('BATT_ARM_VOLT');
      expect(previewRows[2].querySelector('.it-param-val').textContent).toBe('22.2');

      // T-Motor Flame limits: MOT_PWM_MIN=1000, MOT_PWM_MAX=2000
      expect(previewRows[6].querySelector('.it-param-id').textContent).toBe('MOT_PWM_MIN');
      expect(previewRows[6].querySelector('.it-param-val').textContent).toBe('1000');
      expect(previewRows[7].querySelector('.it-param-id').textContent).toBe('MOT_PWM_MAX');
      expect(previewRows[7].querySelector('.it-param-val').textContent).toBe('2000');

      // AP4 Low and Critical warnings:
      // BATT_LOW_VOLT: 6S * (3.5 + 0.5) = 24V
      expect(previewRows[8].querySelector('.it-param-id').textContent).toBe('BATT_LOW_VOLT');
      expect(previewRows[8].querySelector('.it-param-val').textContent).toBe('24');
      // BATT_CRT_VOLT: 6S * (3.5 + 0.1) = 21.6V
      expect(previewRows[9].querySelector('.it-param-id').textContent).toBe('BATT_CRT_VOLT');
      expect(previewRows[9].querySelector('.it-param-val').textContent).toBe('21.6');
    });
  });

  describe('Write Suggestion List & Sequential Stagger Send', () => {
    it('should disable write button and dispatch param_set messages staggered by 120ms', () => {
      const calcBtn = document.getElementById('it-calc-btn');
      const writeBtn = document.getElementById('it-write-btn');

      // Calculate with defaults (6 parameters)
      calcBtn.click();
      window.safeSend.mockClear();

      writeBtn.click();

      expect(writeBtn.disabled).toBe(true);
      expect(document.getElementById('it-status-dot').className).toContain('it-dot-running');
      expect(document.getElementById('it-status-msg').textContent).toContain('Writing 6 parameters');

      // Staggered sends: first runs at 0ms. Let's tick 1ms
      jest.advanceTimersByTime(1);
      expect(window.safeSend).toHaveBeenCalledTimes(1);
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'param_set',
        param_id: 'MOT_BAT_VOLT_MAX',
        value: 16.8 // 4S * 4.2V
      });

      // Advance by 120ms
      jest.advanceTimersByTime(120);
      expect(window.safeSend).toHaveBeenCalledTimes(2);
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'param_set',
        param_id: 'MOT_BAT_VOLT_MIN',
        value: 14 // 4S * 3.5V
      });

      // Fast forward past all writes (6 * 120 + 600 ms = 1320 ms)
      jest.advanceTimersByTime(1200);

      expect(writeBtn.disabled).toBe(false);
      expect(document.getElementById('it-status-dot').className).toContain('it-dot-ok');
      expect(document.getElementById('it-status-msg').textContent).toContain('successfully');
      expect(window.SwUtil.toast).toHaveBeenCalledWith(expect.stringContaining('parameters written'));
    });
  });

  describe('WebSocket Error Handlers', () => {
    it('should style the status badge as error if param_error ws message received', () => {
      triggerWsMessage({
        type: 'param_error',
        message: 'Parameter write rejected'
      });

      expect(document.getElementById('it-status-dot').className).toContain('it-dot-error');
      expect(document.getElementById('it-status-msg').textContent).toBe('✕ Parameter write rejected');
    });
  });
});