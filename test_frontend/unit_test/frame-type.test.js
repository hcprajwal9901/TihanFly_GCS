describe('GCS Frame Type Panel High-Fidelity Behavioral Test Suite (frame-type.js)', () => {
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
    document.body.innerHTML = '<div id="panel-frame-type"></div>';

    // Load frame-type.js physically in JSDOM
    global.loadScript('js/frame-type.js');

    // Initialize module
    window.FrameType.init();
  });

  function triggerWsMessage(msg) {
    const evt = new CustomEvent('calibration_ws_message', { detail: msg });
    window.dispatchEvent(evt);
  }

  describe('Form Layout and Descriptions', () => {
    it('should inject correct headers, select elements, and initial empty read texts', () => {
      expect(document.querySelector('.ft-info-banner')).toBeTruthy();
      expect(document.getElementById('ft-current-class').textContent).toBe('— (not read)');
      expect(document.getElementById('ft-current-type').textContent).toBe('— (not read)');

      const classSel = document.getElementById('ft-class-select');
      const typeSel = document.getElementById('ft-type-select');

      expect(classSel.options.length).toBe(13); // 13 classes defined
      expect(typeSel.options.length).toBe(12);  // 12 types defined
    });

    it('should update class description when select element changes', () => {
      const classSel = document.getElementById('ft-class-select');
      const classDesc = document.getElementById('ft-class-desc');

      // Change class to 1 (Quad)
      classSel.value = '1';
      classSel.dispatchEvent(new Event('change'));

      expect(classDesc.textContent).toContain('Quadcopter');

      // Change class to 2 (Hexa)
      classSel.value = '2';
      classSel.dispatchEvent(new Event('change'));

      expect(classDesc.textContent).toContain('Hexacopter');
    });

    it('should update type description when select element changes', () => {
      const typeSel = document.getElementById('ft-type-select');
      const typeDesc = document.getElementById('ft-type-desc');

      // Change type to 1 (X)
      typeSel.value = '1';
      typeSel.dispatchEvent(new Event('change'));

      expect(typeDesc.textContent).toContain('X layout');

      // Change type to 4 (V-Tail)
      typeSel.value = '4';
      typeSel.dispatchEvent(new Event('change'));

      expect(typeDesc.textContent).toContain('V-Tail');
    });
  });

  describe('Cache-First MAVLink Read Strategy', () => {
    it('should query cache first, and fall back to targeted requests if empty after 800ms', () => {
      const readBtn = document.getElementById('ft-read-btn');
      window.safeSend.mockClear();

      readBtn.click();

      // Requests in-memory cache dump via param_get_all instantly
      expect(window.safeSend).toHaveBeenCalledTimes(1);
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_get_all' });

      // Fast forward 800ms to test cache miss fallback logic
      jest.advanceTimersByTime(800);

      // Verify targeted param_request_one calls for FRAME_CLASS and FRAME_TYPE
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_request_one', name: 'FRAME_CLASS' });

      // The FRAME_TYPE is scheduled 200ms after FRAME_CLASS fallback
      jest.advanceTimersByTime(200);
      expect(window.safeSend).toHaveBeenCalledWith({ type: 'param_request_one', name: 'FRAME_TYPE' });
    });

    it('should load parameters immediately and skip fallback if param_all cache hit received before 800ms', () => {
      const readBtn = document.getElementById('ft-read-btn');
      window.safeSend.mockClear();

      readBtn.click();

      // Simulate receiving param_all cache dump at 100ms
      jest.advanceTimersByTime(100);
      triggerWsMessage({
        type: 'param_all',
        params: [
          { param_id: 'FRAME_CLASS', value: 1.0 },
          { param_id: 'FRAME_TYPE', value: 3.0 }
        ]
      });

      // Confirm UI displays updated values
      expect(document.getElementById('ft-current-class').textContent).toContain('Quad');
      expect(document.getElementById('ft-current-type').textContent).toContain('H');

      // Fast forward past 800ms fallback threshold
      jest.advanceTimersByTime(700);

      // Confirm safeSend only has the single initial param_get_all call, no fallbacks
      expect(window.safeSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Write Parameters Actions & Staggering', () => {
    it('should write FRAME_CLASS individually and update status', () => {
      const writeClassBtn = document.getElementById('ft-write-class');
      const classSel = document.getElementById('ft-class-select');

      classSel.value = '2'; // Hexa
      classSel.dispatchEvent(new Event('change'));

      window.safeSend.mockClear();

      writeClassBtn.click();

      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'param_set',
        param_id: 'FRAME_CLASS',
        value: 2
      });

      expect(document.getElementById('ft-status-msg').textContent).toContain('Writing FRAME_CLASS = 2');

      // Simulate receiving parameter confirmation event
      triggerWsMessage({
        type: 'param_value',
        param_id: 'FRAME_CLASS',
        value: 2.0
      });

      expect(document.getElementById('ft-status-msg').textContent).toContain('Reboot required');
      expect(window.SwUtil.toast).toHaveBeenCalledWith(expect.stringContaining('Reboot to apply.'));
    });

    it('should write FRAME_TYPE individually and update status', () => {
      const writeTypeBtn = document.getElementById('ft-write-type');
      const typeSel = document.getElementById('ft-type-select');

      typeSel.value = '3'; // H layout
      typeSel.dispatchEvent(new Event('change'));

      window.safeSend.mockClear();

      writeTypeBtn.click();

      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'param_set',
        param_id: 'FRAME_TYPE',
        value: 3
      });

      expect(document.getElementById('ft-status-msg').textContent).toContain('Writing FRAME_TYPE = 3');

      // Simulate parameter echo
      triggerWsMessage({
        type: 'param_value',
        param_id: 'FRAME_TYPE',
        value: 3.0
      });

      expect(document.getElementById('ft-status-msg').textContent).toContain('Reboot required');
    });

    it('should stagger writing both parameters when Write Both is clicked', () => {
      const writeBothBtn = document.getElementById('ft-write-both');
      const classSel = document.getElementById('ft-class-select');
      const typeSel = document.getElementById('ft-type-select');

      classSel.value = '1'; // Quad
      typeSel.value = '1';  // X Layout

      window.safeSend.mockClear();

      writeBothBtn.click();

      // Instantly sends FRAME_CLASS
      expect(window.safeSend).toHaveBeenCalledTimes(1);
      expect(window.safeSend).toHaveBeenCalledWith({
        type: 'param_set',
        param_id: 'FRAME_CLASS',
        value: 1
      });

      // Staggers FRAME_TYPE by 300ms
      jest.advanceTimersByTime(300);
      expect(window.safeSend).toHaveBeenCalledTimes(2);
      expect(window.safeSend).toHaveBeenLastCalledWith({
        type: 'param_set',
        param_id: 'FRAME_TYPE',
        value: 1
      });

      // Confirmation displays after another 1200ms
      jest.advanceTimersByTime(1200);
      expect(document.getElementById('ft-status-msg').textContent).toContain('Both parameters written');
      expect(window.SwUtil.toast).toHaveBeenCalledWith(expect.stringContaining('Class + Type written'));
    });
  });

  describe('WebSocket Interaction Errors', () => {
    it('should set status text to error if param_error ws message received', () => {
      triggerWsMessage({
        type: 'param_error',
        message: 'Flight controller rebooting'
      });

      expect(document.getElementById('ft-status-dot').className).toContain('ft-dot-error');
      expect(document.getElementById('ft-status-msg').textContent).toBe('✕ Flight controller rebooting');
    });
  });
});