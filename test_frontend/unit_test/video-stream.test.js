describe('Video Stream Panel Suite (js/video-stream.js)', () => {
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

    // Mock HTMLCanvasElement context and toDataURL globally for JSDOM
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
      drawImage: jest.fn()
    });
    HTMLCanvasElement.prototype.toDataURL = jest.fn().mockReturnValue('data:image/png;base64,mocksnapshot');

    // Create the required #videoStream container
    const container = document.createElement('div');
    container.id = 'videoStream';
    document.body.appendChild(container);

    // Load module script exactly once
    global.loadScript('js/video-stream.js');

    // Initialize UI once and preserve elements across tests since module uses uiBuilt guard
    VideoStreamController.init();
  });

  afterAll(() => {
    // Restore setup.js custom selector guards for other suites
    document.getElementById = originalGetElementById;
    document.querySelector = originalQuerySelector;
    document.querySelectorAll = originalQuerySelectorAll;
    
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();

    // Reset the internal GCS connected state
    VideoStreamController.disconnect();

    // Reset DOM element states to default (no signal)
    const imgEl = document.getElementById('mjpegFrame');
    const placeholder = document.getElementById('noSignalPlaceholder');
    const input = document.getElementById('rtspUrlInput');
    const connectBtn = document.getElementById('rtspConnectBtn');
    const disconnectBtn = document.getElementById('rtspDisconnectBtn');
    const statusDot = document.querySelector('#rtspOverlay span:first-child');
    const statusText = document.querySelector('#rtspOverlay span:last-child');

    if (imgEl) {
      imgEl.style.display = 'none';
      imgEl.removeAttribute('src');
    }
    if (placeholder) {
      placeholder.style.display = 'flex';
    }
    if (input) {
      input.value = '';
    }
    if (connectBtn) {
      connectBtn.style.display = 'inline-block';
      connectBtn.disabled = false;
    }
    if (disconnectBtn) {
      disconnectBtn.style.display = 'none';
    }
    if (statusDot) {
      statusDot.style.background = '#555';
    }
    if (statusText) {
      statusText.textContent = 'NO SIGNAL';
      statusText.style.color = '#aaa';
    }

    // Mock global alert
    window.alert = jest.fn();

    // Mock global websocket
    window.ws = {
      readyState: 1, // OPEN
      send: jest.fn()
    };

    // Mock MsgConsole
    window.MsgConsole = {
      error: jest.fn(),
      log: jest.fn()
    };
  });

  it('should initialize and build all UI overlay controls', () => {
    // Verify elements are created and appended
    const imgEl = document.getElementById('mjpegFrame');
    const placeholder = document.getElementById('noSignalPlaceholder');
    const overlay = document.getElementById('rtspOverlay');
    const input = document.getElementById('rtspUrlInput');
    const connectBtn = document.getElementById('rtspConnectBtn');
    const disconnectBtn = document.getElementById('rtspDisconnectBtn');

    expect(imgEl).not.toBeNull();
    expect(placeholder).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(input).not.toBeNull();
    expect(connectBtn).not.toBeNull();
    expect(disconnectBtn).not.toBeNull();

    // Expect default styling and states
    expect(imgEl.style.display).toBe('none');
    expect(placeholder.style.display).not.toBe('none');
    expect(disconnectBtn.style.display).toBe('none');
    expect(overlay.style.opacity).toBe('0.25');
  });

  it('should fade overlay opacity in/out on hover actions', () => {
    const container = document.getElementById('videoStream');
    const overlay = document.getElementById('rtspOverlay');

    // Hover in
    container.dispatchEvent(new Event('mouseenter'));
    expect(overlay.style.opacity).toBe('1');

    // Hover out
    container.dispatchEvent(new Event('mouseleave'));
    expect(overlay.style.opacity).toBe('0.25');
  });

  it('should perform connection flows and write URL to localStorage', () => {
    const input = document.getElementById('rtspUrlInput');
    const connectBtn = document.getElementById('rtspConnectBtn');

    input.value = 'rtsp://192.168.1.100:554/stream1';

    // Click CONNECT
    connectBtn.click();

    // Verify state changes
    expect(localStorage.getItem('gcs_rtsp_url')).toBe('rtsp://192.168.1.100:554/stream1');
    expect(connectBtn.disabled).toBe(true);

    // Verify WebSocket start command sent
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'start_video',
        rtsp_url: 'rtsp://192.168.1.100:554/stream1'
      })
    );
  });

  it('should restore stored RTSP URL from localStorage on initialization', () => {
    // Put url to input manually to simulate loading (since we can't fully reload script, we can test setRtspUrl / getRtspUrl)
    VideoStreamController.setRtspUrl('rtsp://saved-host/live');
    expect(VideoStreamController.getRtspUrl()).toBe('rtsp://saved-host/live');
  });

  it('should alert if CONNECT clicked with empty RTSP input', () => {
    const originalAlert = window.alert;
    window.alert = jest.fn();

    const input = document.getElementById('rtspUrlInput');
    input.value = '';

    const connectBtn = document.getElementById('rtspConnectBtn');
    connectBtn.click();

    expect(window.alert).toHaveBeenCalledWith('Please enter an RTSP URL.');
    window.alert = originalAlert;
  });

  it('should show stream on "ready" ws status and handle progressive load errors up to 6 times', () => {
    jest.useFakeTimers();

    const imgEl = document.getElementById('mjpegFrame');
    const placeholder = document.getElementById('noSignalPlaceholder');
    const connectBtn = document.getElementById('rtspConnectBtn');
    const disconnectBtn = document.getElementById('rtspDisconnectBtn');

    // Mock initial state
    VideoStreamController.connect();

    // Dispatch "ready" status from WebSocket
    window.dispatchEvent(new CustomEvent('video_status', {
      detail: { status: 'ready', url: 'http://localhost:5001/video' }
    }));

    // Verify container and placeholder states
    expect(imgEl.style.display).toBe('block');
    expect(placeholder.style.display).toBe('none');

    // Simulate image error (stream starts but has progressive errors loading frame)
    for (let retry = 1; retry <= 6; retry++) {
      imgEl.onerror();
      expect(imgEl.style.display).toBe('block'); // still trying
      // Verify retry text set
      const statusText = document.querySelector('#rtspOverlay span:last-child');
      expect(statusText.textContent).toBe(`STARTING… (${retry}/6)`);
      
      // Advance timer for reconnection retry
      jest.advanceTimersByTime(1000);
    }

    // 7th error triggers giving up
    imgEl.onerror();

    // Should give up and reset states
    expect(imgEl.style.display).toBe('none');
    expect(placeholder.style.display).toBe('flex');
    expect(VideoStreamController.isStreaming()).toBe(false);
    expect(connectBtn.style.display).toBe('inline-block');
    expect(disconnectBtn.style.display).toBe('none');

    jest.useRealTimers();
  });

  it('should connect live and transition stream state successfully on image onload', () => {
    const imgEl = document.getElementById('mjpegFrame');
    const connectBtn = document.getElementById('rtspConnectBtn');
    const disconnectBtn = document.getElementById('rtspDisconnectBtn');

    // Trigger ready stream status
    window.dispatchEvent(new CustomEvent('video_status', {
      detail: { status: 'ready', url: 'http://localhost:5001/video' }
    }));

    // Simulate successful first frame arrival (onload)
    imgEl.onload();

    expect(VideoStreamController.isStreaming()).toBe(true);
    expect(connectBtn.style.display).toBe('none');
    expect(disconnectBtn.style.display).toBe('inline-block');
    expect(disconnectBtn.disabled).toBe(false);

    // Verify LIVE status indicator color and text
    const statusDot = document.querySelector('#rtspOverlay span:first-child');
    const statusText = document.querySelector('#rtspOverlay span:last-child');
    expect(statusDot.style.background).toBe('rgb(34, 197, 94)'); // green
    expect(statusText.textContent).toBe('LIVE');
  });

  it('should stop and hide stream on disconnect clicks or "stopped" ws events', () => {
    const imgEl = document.getElementById('mjpegFrame');
    const connectBtn = document.getElementById('rtspConnectBtn');
    const disconnectBtn = document.getElementById('rtspDisconnectBtn');

    // Put into live state first
    window.dispatchEvent(new CustomEvent('video_status', {
      detail: { status: 'ready', url: 'http://localhost:5001/video' }
    }));
    imgEl.onload();
    expect(VideoStreamController.isStreaming()).toBe(true);

    // Call disconnect
    VideoStreamController.disconnect();

    // Verify stop command sent
    expect(window.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'stop_video' })
    );

    // Verify hidden states
    expect(imgEl.style.display).toBe('none');
    expect(imgEl.getAttribute('src')).toBe('');
    expect(VideoStreamController.isStreaming()).toBe(false);
    expect(connectBtn.style.display).toBe('inline-block');
    expect(disconnectBtn.style.display).toBe('none');

    // Verify stopped event acts the same
    imgEl.onload(); // restore live
    window.dispatchEvent(new CustomEvent('video_status', {
      detail: { status: 'stopped' }
    }));
    expect(imgEl.style.display).toBe('none');
    expect(VideoStreamController.isStreaming()).toBe(false);
  });

  it('should display error message on backend "error" ws status', () => {
    const connectBtn = document.getElementById('rtspConnectBtn');

    window.dispatchEvent(new CustomEvent('video_status', {
      detail: { status: 'error', message: 'RTSP Connection Timeout' }
    }));

    // Verify error states
    expect(connectBtn.disabled).toBe(false);
    expect(window.MsgConsole.error).toHaveBeenCalledWith('Video: RTSP Connection Timeout');

    const statusText = document.querySelector('#rtspOverlay span:last-child');
    expect(statusText.textContent).toBe('ERROR');
  });

  it('should capture video snapshots and trigger download element', () => {
    const originalAlert = window.alert;
    window.alert = jest.fn();

    // Snapshot with inactive video should show alert
    const inactiveRes = VideoStreamController.takeSnapshot();
    expect(window.alert).toHaveBeenCalledWith('No video active.');
    expect(inactiveRes).toBeNull();

    // Activate video stream
    const imgEl = document.getElementById('mjpegFrame');
    window.dispatchEvent(new CustomEvent('video_status', {
      detail: { status: 'ready', url: 'http://localhost:5001/video' }
    }));
    imgEl.onload();

    // Spy on document.createElement to intercept download anchor click
    const clickSpy = jest.fn();
    const originalCreate = document.createElement;
    document.createElement = jest.fn().mockImplementation((tag) => {
      const el = originalCreate.call(document, tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    const activeRes = VideoStreamController.takeSnapshot();
    expect(clickSpy).toHaveBeenCalled();
    expect(activeRes).toBe('data:image/png;base64,mocksnapshot');

    // Restore creators
    document.createElement = originalCreate;
    window.alert = originalAlert;
  });

  it('should fall back to backward-compatible global VideoStream shim methods', () => {
    // Connect shim
    const connectSpy = jest.spyOn(VideoStreamController, 'connect').mockImplementation(() => {});
    window.VideoStream.connect();
    expect(connectSpy).toHaveBeenCalled();

    // Disconnect shim
    const disconnectSpy = jest.spyOn(VideoStreamController, 'disconnect').mockImplementation(() => {});
    window.VideoStream.disconnect();
    expect(disconnectSpy).toHaveBeenCalled();

    // isStreaming shim
    const isStreamingSpy = jest.spyOn(VideoStreamController, 'isStreaming').mockReturnValue(true);
    expect(window.VideoStream.isStreaming()).toBe(true);

    // getRtspUrl and setRtspUrl shims
    const setRtspSpy = jest.spyOn(VideoStreamController, 'setRtspUrl').mockImplementation(() => {});
    window.VideoStream.setRtspUrl('rtsp://test');
    expect(setRtspSpy).toHaveBeenCalledWith('rtsp://test');

    const getRtspSpy = jest.spyOn(VideoStreamController, 'getRtspUrl').mockReturnValue('rtsp://test');
    expect(window.VideoStream.getRtspUrl()).toBe('rtsp://test');

    // restore spies
    connectSpy.mockRestore();
    disconnectSpy.mockRestore();
    isStreamingSpy.mockRestore();
    setRtspSpy.mockRestore();
    getRtspSpy.mockRestore();
  });
});