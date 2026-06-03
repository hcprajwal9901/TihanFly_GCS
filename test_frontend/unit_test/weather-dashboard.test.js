describe('Weather Dashboard Behavioral Test Suite', () => {
  let backendMock;
  let msgConsoleMock;
  let originalFetch;

  beforeAll(() => {
    jest.useFakeTimers();

    // Mock fetch globally
    originalFetch = global.fetch;
    global.fetch = jest.fn();

    // Mock WebSocket properties
    if (global.WebSocket) {
      global.WebSocket.OPEN = 1;
    }

    // Mock MsgConsole
    msgConsoleMock = {
      info: jest.fn(),
      success: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };
    window.MsgConsole = msgConsoleMock;

    // Load Script once
    global.loadScript('js/weather-dashboard.js');
  });

  afterAll(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Create DOM structure
    document.body.innerHTML = `
      <div id="weatherDashboard" class="hidden" style="display: none;">
        <div id="weatherLoading" style="display: none;"></div>
        <div id="weatherError" style="display: none;">
          <span id="weatherErrorMessage"></span>
        </div>
        <div id="weatherContent" style="display: none;">
          <span id="locationName"></span>
          <span id="locationCoords"></span>
          <span id="weatherTemp"></span>
          <span id="weatherDescription"></span>
          <img id="weatherMainIcon" src="" />
          <span id="feelsLike"></span>
          <span id="humidity"></span>
          <span id="windSpeed"></span>
          <span id="pressure"></span>
          <span id="visibility"></span>
          <span id="clouds"></span>
          <span id="weatherUpdateTime"></span>
        </div>
        <button id="weatherCloseBtn"></button>
        <button id="weatherRetryBtn"></button>
      </div>
      <div class="status-badge">Normal</div>
    `;

    // Re-initialize a fresh WeatherDashboard instance on window
    if (window.weatherDashboard) {
      window.weatherDashboard.initialize();
      window.weatherDashboard.clear();
    }
  });

  it('should auto-initialize WeatherDashboard and register window.Weather API', () => {
    expect(window.Weather).toBeDefined();
    expect(typeof window.Weather.show).toBe('function');
    expect(typeof window.Weather.fetchWeather).toBe('function');
  });

  describe('UI Visibility Controls', () => {
    it('should show, hide, and toggle the dashboard correctly', () => {
      const dashboard = document.getElementById('weatherDashboard');
      
      window.Weather.show();
      expect(dashboard.classList.contains('hidden')).toBe(false);
      expect(dashboard.style.display).toBe('');
      expect(window.Weather.isShown()).toBe(true);

      window.Weather.hide();
      expect(dashboard.classList.contains('hidden')).toBe(true);
      expect(dashboard.style.display).toBe('none');
      expect(window.Weather.isShown()).toBe(false);

      window.Weather.toggle();
      expect(window.Weather.isShown()).toBe(true);
    });

    it('should hide dashboard when clicking close button', () => {
      const dashboard = document.getElementById('weatherDashboard');
      window.Weather.show();
      
      const closeBtn = document.getElementById('weatherCloseBtn');
      closeBtn.click();

      expect(dashboard.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Coordinate Validation and Normalization', () => {
    it('should validate coordinates and normalize longitude wrapping', () => {
      const wd = window.weatherDashboard;
      
      // Valid coordinates
      expect(wd.validateCoordinates(12.34, 56.78)).toEqual({ lat: 12.34, lng: 56.78 });

      // Out of bounds latitude
      expect(wd.validateCoordinates(-95, 120)).toBeNull();
      expect(wd.validateCoordinates(91, 120)).toBeNull();

      // Longitude wrapping
      expect(wd.validateCoordinates(10, 190)).toEqual({ lat: 10, lng: -170 });
      expect(wd.validateCoordinates(10, -200)).toEqual({ lat: 10, lng: 160 });
    });
  });

  describe('WebSocket Backend Connection', () => {
    beforeEach(() => {
      // Mock window.compassBackend
      backendMock = {
        isConnected: true,
        handleMessage: jest.fn(),
        ws: {
          readyState: 1, // OPEN
          send: jest.fn()
        }
      };
      window.compassBackend = backendMock;

      // Tick the 500ms setInterval check in WeatherDashboard
      jest.advanceTimersByTime(600);
    });

    afterEach(() => {
      delete window.compassBackend;
      delete window.weatherDashboard.backend;
    });

    it('should connect to backend if available and intercept handleMessage', () => {
      expect(window.weatherDashboard.backend).toBe(backendMock);
      expect(backendMock.handleMessage).not.toBeUndefined();
    });

    it('should process weather updates sent from backend', () => {
      const weatherPayload = {
        type: 'weather',
        data: {
          location: { name: 'Hyderabad', country: 'IN', latitude: 17.385, longitude: 78.486 },
          main: { temperature: 34.5, description: 'clear sky', iconCode: '01d', feelsLike: 36.2 },
          conditions: { humidity: 45, pressure: 1010, visibility: 10000, clouds: 0 },
          wind: { speed: 4.2 },
          safety: {
            overall: 'SAFE',
            overallColor: '#22c55e',
            message: 'Weather conditions safe for flight',
            warnings: []
          }
        }
      };

      // Call handleMessage directly to simulate backend WS push
      backendMock.handleMessage(JSON.stringify(weatherPayload));

      expect(document.getElementById('locationName').textContent).toBe('Hyderabad, IN');
      expect(document.getElementById('weatherTemp').textContent).toBe('35°C'); // rounded
      expect(document.getElementById('weatherDescription').textContent).toBe('clear sky');
      expect(document.getElementById('feelsLike').textContent).toBe('36°C');
      expect(document.getElementById('humidity').textContent).toBe('45%');
      expect(document.getElementById('windSpeed').textContent).toBe('4.2 m/s');
      
      const safetyIndicator = document.getElementById('weatherSafetyIndicator');
      expect(safetyIndicator).toBeDefined();
      expect(safetyIndicator.innerHTML).toContain('Weather conditions safe for flight');
    });

    it('should update status badge to Unsafe and render warnings if weather is unsafe', () => {
      const weatherPayload = {
        type: 'weather',
        data: {
          location: { name: 'Hyderabad', country: 'IN', latitude: 17.385, longitude: 78.486 },
          main: { temperature: 34.5, description: 'stormy', iconCode: '11d', feelsLike: 36.2 },
          conditions: { humidity: 95, pressure: 995, visibility: 3000, clouds: 90 },
          wind: { speed: 18.5 },
          safety: {
            overall: 'UNSAFE',
            overallColor: '#ef4444',
            message: 'High winds! Flight unsafe',
            warnings: ['Wind speed exceeds limit (18.5 m/s)', 'Low visibility']
          }
        }
      };

      backendMock.handleMessage(JSON.stringify(weatherPayload));

      const statusBadge = document.querySelector('.status-badge');
      expect(statusBadge.textContent).toBe('Weather Unsafe');
      expect(statusBadge.style.background).toBe('rgb(239, 68, 68)');

      const safetyIndicator = document.getElementById('weatherSafetyIndicator');
      expect(safetyIndicator.innerHTML).toContain('High winds! Flight unsafe');
      expect(safetyIndicator.innerHTML).toContain('Wind speed exceeds limit (18.5 m/s)');
    });

    it('should handle weather_warning from backend and log to MsgConsole', () => {
      const warningPayload = {
        type: 'weather_warning',
        message: 'Wind speed rising near safety thresholds'
      };

      backendMock.handleMessage(JSON.stringify(warningPayload));

      expect(msgConsoleMock.warning).toHaveBeenCalledWith('Wind speed rising near safety thresholds');
    });

    it('should handle weather_error from backend and show error state', () => {
      const errorPayload = {
        type: 'weather_error',
        message: 'Failed to retrieve weather data from provider'
      };

      backendMock.handleMessage(JSON.stringify(errorPayload));

      expect(document.getElementById('weatherError').style.display).toBe('flex');
      expect(document.getElementById('weatherErrorMessage').textContent).toBe('Failed to retrieve weather data from provider');
    });

    it('should request weather from backend on fetchWeather, and fallback to direct API on timeout', async () => {
      // Mock fetch response for fallback API call
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'Hyderabad',
          sys: { country: 'IN' },
          main: { temp: 32.1, feels_like: 34.0, humidity: 50, pressure: 1012 },
          weather: [{ description: 'few clouds', icon: '02d' }],
          wind: { speed: 3.5 },
          visibility: 8000,
          clouds: { all: 20 }
        })
      });

      window.Weather.fetchWeather(17.385, 78.486);

      // Verify WebSocket request sent to backend
      expect(backendMock.ws.send).toHaveBeenCalled();
      const sentPayload = JSON.parse(backendMock.ws.send.mock.calls[0][0]);
      expect(sentPayload.type).toBe('weather_request');
      expect(sentPayload.latitude).toBe(17.385);

      // Fast forward 5 seconds to trigger backend response timeout
      jest.advanceTimersByTime(5100);

      // Wait for promises/fetch resolve
      await Promise.resolve();
      await Promise.resolve();

      // Check fallback direct API fetch called
      expect(global.fetch).toHaveBeenCalled();
      expect(document.getElementById('weatherTemp').textContent).toBe('32°C');
      expect(document.getElementById('weatherDescription').textContent).toBe('few clouds');
    });
  });

  describe('Direct Weather API Fetch (No Backend)', () => {
    it('should query OpenWeatherMap directly and display weather', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'Chennai',
          sys: { country: 'IN' },
          main: { temp: 28.5, feels_like: 31.0, humidity: 80, pressure: 1008 },
          weather: [{ description: 'moderate rain', icon: '10d' }],
          wind: { speed: 6.8 },
          visibility: 5000,
          clouds: { all: 75 }
        })
      });

      window.Weather.fetchWeather(13.0827, 80.2707);

      expect(document.getElementById('weatherLoading').style.display).toBe('flex');

      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('weatherLoading').style.display).toBe('none');
      expect(document.getElementById('weatherContent').style.display).toBe('flex');
      expect(document.getElementById('locationName').textContent).toBe('Chennai, IN');
      expect(document.getElementById('weatherTemp').textContent).toBe('29°C');
      expect(document.getElementById('humidity').textContent).toBe('80%');
    });

    it('should show error screen and log to MsgConsole if direct API fetch fails', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      window.Weather.fetchWeather(13.0827, 80.2707);

      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('weatherError').style.display).toBe('flex');
      expect(document.getElementById('weatherErrorMessage').textContent).toContain('HTTP error! status: 401');
      expect(msgConsoleMock.error).toHaveBeenCalledWith(expect.stringContaining('Weather fetch failed:'));
    });
  });

  describe('Interactive map integration and refresh', () => {
    it('should request weather for click coordinates on onMapClick', () => {
      const spyFetch = jest.spyOn(window.weatherDashboard, 'fetchWeather');
      
      window.weatherDashboard.onMapClick(12.34, 56.78);

      expect(spyFetch).toHaveBeenCalledWith(12.34, 56.78);
      expect(msgConsoleMock.info).toHaveBeenCalledWith('Weather requested: 12.3400, 56.7800');
    });

    it('should refresh weather at same location on refresh if coordinates set', () => {
      const spyFetch = jest.spyOn(window.weatherDashboard, 'fetchWeather');
      
      // No coordinates set yet
      window.Weather.refresh();
      expect(spyFetch).not.toHaveBeenCalled();

      // Click map, setting location coordinates
      window.weatherDashboard.onMapClick(12.34, 56.78);
      expect(spyFetch).toHaveBeenCalledTimes(1);

      // Trigger refresh
      window.Weather.refresh();
      expect(spyFetch).toHaveBeenCalledTimes(2);
      expect(spyFetch).toHaveBeenLastCalledWith(12.34, 56.78);
    });

    it('should reset to initial state on clear', () => {
      window.weatherDashboard.onMapClick(12.34, 56.78);
      expect(window.weatherDashboard.getCurrentLocation().lat).toBe(12.34);

      window.Weather.clear();
      expect(window.weatherDashboard.getCurrentLocation().lat).toBeNull();
      expect(document.getElementById('weatherUpdateTime').textContent).toBe('Click map to load weather');
    });
  });
});