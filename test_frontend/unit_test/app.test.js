describe('Core GCS Application Unit Tests (app.js)', () => {
  beforeEach(() => {
    // 1. Reset standard DOM structure required by app.js initialization
    document.body.innerHTML = `
      <div id="videoContainer"></div>
      <div id="map"></div>
      <button id="videoMaxBtn"></button>
      <div class="status-badge"></div>
    `;
    
    // Clear mocks
    jest.clearAllMocks();
    
    // 2. Load the app.js script
    global.loadScript('js/app.js');
  });

  describe('haversineDistance', () => {
    it('should calculate exactly zero meters for identical coordinates', () => {
      const lat = 17.601722;
      const lon = 78.126991;
      const dist = global.haversineDistance(lat, lon, lat, lon);
      expect(dist).toBe(0);
    });

    it('should calculate accurate physical distances between distinct coordinates', () => {
      // Hyderabad (17.3850, 78.4867) to Secunderabad (17.4399, 78.4983)
      // Approximately 6.2 km (6200m)
      const dist = global.haversineDistance(17.3850, 78.4867, 17.4399, 78.4983);
      expect(dist).toBeGreaterThan(6000);
      expect(dist).toBeLessThan(6300);
    });
  });

  describe('setHeaderStatus UI rendering', () => {
    it('should correctly update status text and apply state class name', () => {
      const badge = document.querySelector('.status-badge');
      expect(badge.textContent).toBe('');
      
      // Set to active/ready
      global.setHeaderStatus('Connected', 'ready');
      expect(badge.textContent).toBe('Connected');
      expect(badge.className).toBe('status-badge ready');

      // Set to disconnected/error
      global.setHeaderStatus('Disconnected', 'error');
      expect(badge.textContent).toBe('Disconnected');
      expect(badge.className).toBe('status-badge error');

      // Set to connecting
      global.setHeaderStatus('Connecting...', 'connecting');
      expect(badge.textContent).toBe('Connecting...');
      expect(badge.className).toBe('status-badge connecting');
    });
  });

  describe('initializeVideoMaximize and PIP Toggles', () => {
    it('should successfully wire buttons and toggle maximize states', () => {
      // Trigger initialization of video elements
      global.initializeVideoMaximize();
      
      expect(window.VideoMaximize).toBeDefined();
      expect(window.VideoMaximize.isMaximized()).toBe(false);

      // Verify containers are not in maximized states initially
      const videoContainer = document.getElementById('videoContainer');
      const mapContainer = document.getElementById('map');
      expect(videoContainer.classList.contains('maximized')).toBe(false);
      expect(mapContainer.classList.contains('minimized')).toBe(false);

      // Toggle to maximized state
      window.VideoMaximize.toggle();
      expect(window.VideoMaximize.isMaximized()).toBe(true);
      expect(videoContainer.classList.contains('maximized')).toBe(true);
      expect(mapContainer.classList.contains('minimized')).toBe(true);

      // Toggle back to normal
      window.VideoMaximize.toggle();
      expect(window.VideoMaximize.isMaximized()).toBe(false);
      expect(videoContainer.classList.contains('maximized')).toBe(false);
      expect(mapContainer.classList.contains('minimized')).toBe(false);
    });

    it('should execute maximize/minimize helper controls directly', () => {
      global.initializeVideoMaximize();
      
      // Force maximize
      window.VideoMaximize.maximize();
      expect(window.VideoMaximize.isMaximized()).toBe(true);

      // Force minimize (restore)
      window.VideoMaximize.minimize();
      expect(window.VideoMaximize.isMaximized()).toBe(false);
    });
  });
});
