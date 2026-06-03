describe('Camera Controls Panel Suite (js/camera-controls.js)', () => {
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

    // Mock HTMLCanvasElement captureStream and global MediaRecorder
    HTMLCanvasElement.prototype.captureStream = jest.fn().mockReturnValue({
      getTracks: () => [{ stop: jest.fn() }]
    });

    global.MediaRecorder = class MediaRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.mimeType = (options && options.mimeType) || 'video/webm';
      }
      start(interval) {
        this.state = 'recording';
        if (this.onstart) this.onstart();
      }
      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
          const blobData = new Blob(['mock-webm-bytes'], { type: this.mimeType });
          this.ondataavailable({ data: blobData });
        }
        if (this.onstop) this.onstop();
      }
    };
    global.MediaRecorder.isTypeSupported = jest.fn().mockReturnValue(true);

    // Mock FileReader base64 loaders
    global.FileReader = class FileReader {
      constructor() {
        this.onloadend = null;
      }
      readAsDataURL(blob) {
        setTimeout(() => {
          this.result = 'data:image/png;base64,mockbase64data';
          if (this.onloadend) this.onloadend();
        }, 10);
      }
    };

    // Mock URL helper
    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();

    // Mock electron Save dialog file hooks
    window.electronSaveFile = {
      save: jest.fn().mockResolvedValue({ ok: true, filePath: 'C:\\Users\\MockUser\\Downloads\\photo_123.png' })
    };

    // Turn on fake timers BEFORE loading script so setTimeout is scheduled in Jest mock queue
    jest.useFakeTimers();

    // Load module script exactly once
    global.loadScript('js/camera-controls.js');

    // Run fake timers to execute the auto-init setTimeout(..., 400) which exposes window.CameraControls
    jest.advanceTimersByTime(500);
    
    // Restore real timers
    jest.useRealTimers();
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

    // Mock window sockets array required by camera-controls ws route installer
    window.__mv_sockets = [];

    // Create target container elements
    const videoStream = document.createElement('div');
    videoStream.id = 'videoStream';
    document.body.appendChild(videoStream);

    const mjpegFrame = document.createElement('img');
    mjpegFrame.id = 'mjpegFrame';
    mjpegFrame.src = 'http://localhost:5001/video';
    mjpegFrame.style.display = 'block';
    videoStream.appendChild(mjpegFrame);

    const maxBtn = document.createElement('button');
    maxBtn.id = 'videoMaxBtn';
    videoStream.appendChild(maxBtn);

    // Mock safe global WebSocket state
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn()
    };
  });

  it('should construct camera action bars and inject custom styles', () => {
    // Invoke public module builder method
    window.CameraControls.init();

    expect(document.getElementById('cameraActionBar')).not.toBeNull();
    expect(document.getElementById('camSnapBtn')).not.toBeNull();
    expect(document.getElementById('camRecordBtn')).not.toBeNull();
    expect(document.getElementById('camGimbalToggleBtn')).not.toBeNull();
    expect(document.getElementById('recTimerBadge')).not.toBeNull();
    expect(document.getElementById('gimbalPanel')).not.toBeNull();
    
    // Legacy max btn should have been detached and re-styled inside the action bar
    const actionBar = document.getElementById('cameraActionBar');
    expect(actionBar.querySelector('#videoMaxBtn')).not.toBeNull();
  });

  it('should capture photo frames and trigger Electron save dialogs', async () => {
    window.CameraControls.init();
    jest.useFakeTimers();

    // Mock HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = jest.fn().mockImplementation((cb) => {
      cb(new Blob(['photo-bytes'], { type: 'image/png' }));
    });

    window.CameraControls.capturePhoto();
    
    // Fast forward base64 reader loading loop
    jest.advanceTimersByTime(20);

    // Verify WebSocket notification sent
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'camera_capture_photo' })
    );

    // Verify Electron save dialogue called
    expect(window.electronSaveFile.save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultName: expect.stringContaining('.png'),
        base64Data: 'mockbase64data',
        mimeType: 'image/png'
      })
    );

    // Verify photo toast matches filename output
    await Promise.resolve();
    await Promise.resolve();
    const toast = document.getElementById('photoSavedToast');
    expect(toast.textContent).toBe('📷 photo_123.png');

    jest.useRealTimers();
  });

  it('should fallback to browser <a> downloads if electron is unavailable', async () => {
    const originalSave = window.electronSaveFile;
    delete window.electronSaveFile; // Remove electron

    window.CameraControls.init();
    jest.useFakeTimers();

    HTMLCanvasElement.prototype.toBlob = jest.fn().mockImplementation((cb) => {
      cb(new Blob(['photo-bytes'], { type: 'image/png' }));
    });

    // Mock append/click elements
    const clickSpy = jest.fn();
    const originalCreate = document.createElement;
    document.createElement = jest.fn().mockImplementation((tag) => {
      const el = originalCreate.call(document, tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    window.CameraControls.capturePhoto();
    jest.advanceTimersByTime(20);

    expect(clickSpy).toHaveBeenCalled();

    // Restore
    window.electronSaveFile = originalSave;
    document.createElement = originalCreate;
    jest.useRealTimers();
  });

  it('should start and stop video recordings loops with fake timer ticks', () => {
    window.CameraControls.init();
    jest.useFakeTimers();

    expect(window.CameraControls.isRecording()).toBe(false);

    // Mock save file to resolve with webm name
    window.electronSaveFile.save.mockResolvedValueOnce({ ok: true, filePath: 'C:\\Users\\MockUser\\Downloads\\rec_123.webm' });

    // 1. Start Recording
    window.CameraControls.toggleRecord();
    expect(window.CameraControls.isRecording()).toBe(true);

    const recBtn = document.getElementById('camRecordBtn');
    expect(recBtn.classList.contains('recording')).toBe(true);
    expect(document.getElementById('recTimerBadge').classList.contains('active')).toBe(true);

    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'camera_record_start' })
    );

    // Tick recording timer 5 seconds
    jest.advanceTimersByTime(5000);
    expect(document.getElementById('recTimerBadge').textContent).toBe('00:05');

    // 2. Stop Recording
    window.CameraControls.toggleRecord();
    expect(window.CameraControls.isRecording()).toBe(false);

    // Verify stopping commands
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'camera_record_stop' })
    );
    expect(recBtn.classList.contains('recording')).toBe(false);
    expect(document.getElementById('recTimerBadge').textContent).toBe('00:00');

    // Verify save triggered
    jest.advanceTimersByTime(20);
    expect(window.electronSaveFile.save).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('should trigger gimbal status display visibility dynamically on websocket status packets', () => {
    window.CameraControls.init();

    const toggleBtn = document.getElementById('camGimbalToggleBtn');
    expect(toggleBtn.classList.contains('gimbal-available')).toBe(false);

    // Trigger gimbal status message
    window.dispatchEvent(new CustomEvent('ws_message', {
      detail: { type: 'gimbal_status', available: true }
    }));

    expect(toggleBtn.classList.contains('gimbal-available')).toBe(true);
    expect(window.CameraControls.isGimbalAvailable()).toBe(true);
  });

  it('should dispatch sliding commands to WebSocket on gimbal sliders adjustments', () => {
    window.CameraControls.init();

    // Trigger sliding inputs
    const pitchSlider = document.getElementById('gimbalPitchSlider');
    pitchSlider.value = '-45';
    pitchSlider.dispatchEvent(new Event('input'));

    expect(document.getElementById('gimbalPitchVal').textContent).toBe('-45°');
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'gimbal_control', pitch: -45, roll: 0, yaw: 0 })
    );
  });

  it('should control gimbal adjustments sequentially on D-Pad arrows press-and-holds', () => {
    window.CameraControls.init();
    
    // Reset gimbal values before proceeding
    window.CameraControls.centerGimbal();

    jest.useFakeTimers();

    const dpadUp = document.getElementById('dpadUp');
    
    // Simulate mousedown press (tilt pitch up)
    dpadUp.dispatchEvent(new Event('mousedown'));

    // Verify first instant tick (pitch +5 degrees)
    expect(document.getElementById('gimbalPitchVal').textContent).toBe('5°');

    // Fast forward hold duration interval (120ms tick loops)
    jest.advanceTimersByTime(120);
    expect(document.getElementById('gimbalPitchVal').textContent).toBe('10°');

    // Release D-Pad mouseup
    document.dispatchEvent(new Event('mouseup'));
    jest.advanceTimersByTime(240); // Timer loop should have cleared
    expect(document.getElementById('gimbalPitchVal').textContent).toBe('10°');

    jest.useRealTimers();
  });

  it('should support gimbal centring, follow lock modes, and lock toggles', () => {
    window.CameraControls.init();

    // 1. Centring
    const centerBtn = document.getElementById('gimbalCenterBtn');
    centerBtn.click();
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'gimbal_center' })
    );

    // 2. Follow Lock toggle
    const modeBtn = document.getElementById('gimbalModeBtn');
    modeBtn.click(); // toggle lock mode
    expect(modeBtn.textContent).toBe('⊗ Locked');
    expect(document.getElementById('gimbalModeText').textContent).toBe('LOCK');
  });
});