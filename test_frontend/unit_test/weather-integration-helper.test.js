describe('Weather Integration Helper Unit Tests (weather-integration-helper.js)', () => {
  beforeEach(() => {
    // Reset JSDOM and globals before each test
    document.body.innerHTML = `
      <div id="weather-dashboard"></div>
    `;
    
    // Clear global space
    delete window.tmap;
    delete window.weatherDashboard;
    delete window.WeatherIntegration;

    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('integrateWeatherWithMap', () => {
    it('should return false and log errors if map or weather dashboard is missing', () => {
      // Load script
      global.loadScript('js/weather-integration-helper.js');
      expect(window.WeatherIntegration).toBeDefined();

      // Run integrate directly (should fail because map/dashboard are missing)
      const success = window.WeatherIntegration.integrate();
      expect(success).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Map (window.tmap) not found!')
      );
    });

    it('should successfully bind click listeners and route clicks once both exist', () => {
      // Mock window.tmap
      window.tmap = new global.TMap();
      
      // Mock weatherDashboard
      window.weatherDashboard = {
        onMapClick: jest.fn(),
        getCurrentLocation: jest.fn().mockReturnValue('Hyderabad')
      };

      global.loadScript('js/weather-integration-helper.js');

      const success = window.WeatherIntegration.integrate();
      expect(success).toBe(true);
      expect(window.tmap.clickEnabled).toBe(true);
      expect(window.tmap.clickCallback).toBeDefined();

      // Trigger map click and verify it forwards to weatherDashboard
      const testLat = 17.4435;
      const testLng = 78.3772;
      window.tmap.clickCallback(testLat, testLng);

      expect(window.weatherDashboard.onMapClick).toHaveBeenCalledWith(testLat, testLng);
    });
  });

  describe('autoIntegrateWeather timer logic', () => {
    it('should retry matching components and stop interval upon discovery', () => {
      global.loadScript('js/weather-integration-helper.js');

      // Start auto integration
      window.WeatherIntegration.autoIntegrate();

      // Advancing timer should not succeed since globals aren't ready yet
      jest.advanceTimersByTime(200);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for map...')
      );

      // Supply the mocks
      window.tmap = new global.TMap();
      window.weatherDashboard = {
        onMapClick: jest.fn(),
        getCurrentLocation: jest.fn()
      };

      // Advance again - integration should run and succeed
      jest.advanceTimersByTime(200);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Found map and weather dashboard')
      );
      expect(window.tmap.clickEnabled).toBe(true);
    });

    it('should timeout and report a warning after maximum attempts', () => {
      global.loadScript('js/weather-integration-helper.js');

      window.WeatherIntegration.autoIntegrate();

      // Advance by 50 intervals (50 * 200 = 10,000ms)
      jest.advanceTimersByTime(10000);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Integration timeout - could not find map or weather dashboard')
      );
    });
  });

  describe('MsgConsole integration branch', () => {
    it('should show success message in MsgConsole if present on integration', () => {
      window.tmap = new global.TMap();
      window.weatherDashboard = {
        onMapClick: jest.fn()
      };
      window.MsgConsole = {
        success: jest.fn()
      };

      global.loadScript('js/weather-integration-helper.js');
      window.WeatherIntegration.integrate();

      expect(window.MsgConsole.success).toHaveBeenCalledWith(
        expect.stringContaining('Weather Dashboard ready')
      );
      delete window.MsgConsole;
    });
  });

  describe('testWeatherDashboard', () => {
    it('should fetch weather for Hyderabad if weatherDashboard is present', () => {
      window.weatherDashboard = {
        fetchWeather: jest.fn()
      };
      global.loadScript('js/weather-integration-helper.js');
      
      window.WeatherIntegration.test();
      expect(window.weatherDashboard.fetchWeather).toHaveBeenCalledWith(17.4435, 78.3772);
    });

    it('should log error if weatherDashboard is missing', () => {
      delete window.weatherDashboard;
      global.loadScript('js/weather-integration-helper.js');
      
      window.WeatherIntegration.test();
      expect(console.error).toHaveBeenCalledWith('❌ Weather Dashboard not found!');
    });
  });

  describe('debugWeatherIntegration', () => {
    it('should log debug info showing map, dashboard, and API states', () => {
      window.tmap = {
        clickEnabled: true,
        clickCallback: jest.fn()
      };
      window.weatherDashboard = {
        isVisible: true,
        isLoading: false,
        getCurrentLocation: jest.fn().mockReturnValue({ lat: 17.6, lng: 78.1 })
      };
      window.Weather = {};

      global.loadScript('js/weather-integration-helper.js');
      window.WeatherIntegration.debug();

      expect(console.log).toHaveBeenCalledWith('Map (window.tmap):', true);
      expect(console.log).toHaveBeenCalledWith('Weather Dashboard:', true);
      expect(console.log).toHaveBeenCalledWith('Weather API:', true);
      expect(console.log).toHaveBeenCalledWith('Map click enabled:', true);
      expect(console.log).toHaveBeenCalledWith('Weather visible:', true);
      
      delete window.Weather;
    });

    it('should log debug info even when all components are missing', () => {
      delete window.tmap;
      delete window.weatherDashboard;
      delete window.Weather;

      global.loadScript('js/weather-integration-helper.js');
      window.WeatherIntegration.debug();

      expect(console.log).toHaveBeenCalledWith('Map (window.tmap):', false);
      expect(console.log).toHaveBeenCalledWith('Weather Dashboard:', false);
    });
  });
});
