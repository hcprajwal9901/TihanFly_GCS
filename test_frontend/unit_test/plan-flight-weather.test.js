describe('GCS Flight Plan Weather High-Fidelity Behavioral Test Suite (plan-flight-weather.js)', () => {
  let modeInstance;
  let originalCreateElement;

  beforeAll(() => {
    // Keep reference to genuine native document.createElement before any spy modifications
    originalCreateElement = document.createElement;

    // Define dummy constructor for PlanFlightMode
    window.PlanFlightMode = function() {
      this.weatherDashboard = null;
      this._weatherClickListener = null;
      this.enableWeatherMapClick = jest.fn();
      this.fetchWeatherForPlanMode = jest.fn();
    };

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-weather.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Neutralize setup.js aggressive DOM guards to restore realistic browser behavior
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      return document.body.querySelector(`#${id}`);
    });
    jest.spyOn(document, 'querySelector').mockImplementation((selector) => {
      return document.body.querySelector(selector);
    });

    // Mock MsgConsole component silently
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Spy on global console warnings and errors silently
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Reset window variables
    delete window.tmap;
    delete window.weatherDashboard;
    delete window.WaypointManager;

    // Mock global and window fetch
    global.fetch = jest.fn();
    if (typeof window !== 'undefined') {
      window.fetch = global.fetch;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Dashboard Movement (moveWeatherToBottomLeft & restoreWeatherPosition)', () => {
    it('should adjust styling styles to bottom-left coordinates on moveWeatherToBottomLeft', () => {
      const mockDashboard = originalCreateElement.call(document, 'div');
      mockDashboard.classList.add('hidden');
      mockDashboard.style.display = 'none';
      modeInstance.weatherDashboard = mockDashboard;

      // Restore enableWeatherMapClick mock to actual prototype implementation
      modeInstance.enableWeatherMapClick = window.PlanFlightMode.prototype.enableWeatherMapClick;
      const spyEnable = jest.spyOn(modeInstance, 'enableWeatherMapClick').mockImplementation(() => {});

      modeInstance.moveWeatherToBottomLeft();

      expect(mockDashboard.style.top).toBe('auto');
      expect(mockDashboard.style.bottom).toBe('20px');
      expect(mockDashboard.style.left).toBe('110px');
      expect(mockDashboard.style.right).toBe('auto');
      expect(mockDashboard.classList.contains('hidden')).toBe(false);
      expect(mockDashboard.style.display).toBe('flex');
      expect(spyEnable).toHaveBeenCalledTimes(1);
    });

    it('should restore styles to top-right and clear click listeners on restoreWeatherPosition', () => {
      const mockDashboard = originalCreateElement.call(document, 'div');
      modeInstance.weatherDashboard = mockDashboard;

      // Setup mock tmap
      window.tmap = {
        map: {
          off: jest.fn()
        },
        disableWeatherClicks: jest.fn()
      };
      
      const mockListener = jest.fn();
      modeInstance._weatherClickListener = mockListener;

      modeInstance.restoreWeatherPosition();

      expect(mockDashboard.style.top).toBe('80px');
      expect(mockDashboard.style.bottom).toBe('auto');
      expect(mockDashboard.style.right).toBe('20px');
      expect(mockDashboard.style.left).toBe('auto');

      expect(window.tmap.map.off).toHaveBeenCalledWith('click', mockListener);
      expect(window.tmap.disableWeatherClicks).toHaveBeenCalledTimes(1);
      expect(modeInstance._weatherClickListener).toBeNull();
    });
  });

  describe('Weather Map Clicks Integration (enableWeatherMapClick)', () => {
    beforeEach(() => {
      modeInstance.enableWeatherMapClick = window.PlanFlightMode.prototype.enableWeatherMapClick;
      modeInstance.fetchWeatherForPlanMode = window.PlanFlightMode.prototype.fetchWeatherForPlanMode;
    });

    it('should register click handler with tmap if registerWeatherClickHandler is present', () => {
      window.tmap = {
        registerWeatherClickHandler: jest.fn(),
        enableWeatherClicks: jest.fn()
      };

      modeInstance.enableWeatherMapClick();

      expect(window.tmap.registerWeatherClickHandler).toHaveBeenCalledTimes(1);
      expect(window.tmap.enableWeatherClicks).toHaveBeenCalledTimes(1);

      // Verify callback works
      const registeredCallback = window.tmap.registerWeatherClickHandler.mock.calls[0][0];
      const spyFetch = jest.spyOn(modeInstance, 'fetchWeatherForPlanMode').mockImplementation(() => {});

      registeredCallback(12.34, 80.56);
      expect(spyFetch).toHaveBeenCalledWith(12.34, 80.56);
      spyFetch.mockRestore();
    });

    it('should fall back to direct map click registration if tmap triggers are missing', () => {
      const mockMap = {
        on: jest.fn(),
        off: jest.fn()
      };
      window.tmap = {
        map: mockMap
      };
      window.WaypointManager = {
        currentMode: null // Not in waypoint adding mode
      };

      modeInstance.enableWeatherMapClick();

      expect(mockMap.on).toHaveBeenCalledWith('click', expect.any(Function));
      expect(modeInstance._weatherClickListener).toBeTruthy();

      // Trigger the direct listener callback
      const spyFetch = jest.spyOn(modeInstance, 'fetchWeatherForPlanMode').mockImplementation(() => {});
      const clickEvent = {
        latlng: { lat: 12.345, lng: 80.678 }
      };

      modeInstance._weatherClickListener(clickEvent);
      expect(spyFetch).toHaveBeenCalledWith(12.345, 80.678);
      spyFetch.mockRestore();
    });

    it('should not trigger weather click fallback callback if actively in waypoint adding mode', () => {
      const mockMap = { on: jest.fn() };
      window.tmap = { map: mockMap };
      window.WaypointManager = {
        currentMode: 'adding' // actively in waypoint mode
      };

      modeInstance.enableWeatherMapClick();

      const spyFetch = jest.spyOn(modeInstance, 'fetchWeatherForPlanMode').mockImplementation(() => {});
      
      modeInstance._weatherClickListener({ latlng: { lat: 12, lng: 80 } });
      expect(spyFetch).not.toHaveBeenCalled();
      
      spyFetch.mockRestore();
    });
  });

  describe('Weather API and Dashboard delegate (fetchWeatherForPlanMode)', () => {
    beforeEach(() => {
      modeInstance.fetchWeatherForPlanMode = window.PlanFlightMode.prototype.fetchWeatherForPlanMode;
    });

    it('should delegate fetching to window.weatherDashboard if available', () => {
      window.weatherDashboard = {
        fetchWeather: jest.fn()
      };

      modeInstance.fetchWeatherForPlanMode(12.34, 80.56);

      expect(window.weatherDashboard.fetchWeather).toHaveBeenCalledWith(12.34, 80.56);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should invoke direct OpenWeatherMap API fetch, toggling loading DOM displays on success', async () => {
      // Mock DOM loading status elements
      const loading = originalCreateElement.call(document, 'div');
      loading.id = 'weatherLoading';
      const error = originalCreateElement.call(document, 'div');
      error.id = 'weatherError';
      const content = originalCreateElement.call(document, 'div');
      content.id = 'weatherContent';

      document.body.appendChild(loading);
      document.body.appendChild(error);
      document.body.appendChild(content);

      // Setup successful OpenWeatherMap mock payload
      const mockPayload = {
        name: 'TiHAN Lab',
        sys: { country: 'IN' },
        main: { temp: 28, feels_like: 30, humidity: 65, pressure: 1012 },
        weather: [{ description: 'clear sky', icon: '01d' }],
        wind: { speed: 4.5 },
        clouds: { all: 10 },
        visibility: 10000
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPayload)
      });

      const spyUpdate = jest.spyOn(modeInstance, 'updateWeatherDisplayInPlanMode').mockImplementation(() => {});

      modeInstance.fetchWeatherForPlanMode(17.601, 78.126);

      expect(loading.style.display).toBe('flex');
      expect(error.style.display).toBe('none');
      expect(content.style.display).toBe('none');

      // Await promise ticks completely
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('lat=17.601&lon=78.126'));
      expect(spyUpdate).toHaveBeenCalledWith(mockPayload, 17.601, 78.126);

      spyUpdate.mockRestore();
    });

    it('should handle API errors and show localized error messages inside status cards', async () => {
      const loading = originalCreateElement.call(document, 'div');
      loading.id = 'weatherLoading';
      const error = originalCreateElement.call(document, 'div');
      error.id = 'weatherError';
      const errorMsg = originalCreateElement.call(document, 'span');
      errorMsg.id = 'weatherErrorMessage';
      
      document.body.appendChild(loading);
      document.body.appendChild(error);
      document.body.appendChild(errorMsg);

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      modeInstance.fetchWeatherForPlanMode(12, 80);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(loading.style.display).toBe('none');
      expect(error.style.display).toBe('flex');
      expect(errorMsg.textContent).toContain('Invalid API key');
      expect(window.MsgConsole.error).toHaveBeenCalledWith('❌ Invalid weather API key');
    });
  });

  describe('UI Content Renderers (updateWeatherDisplayInPlanMode & getWindDirection)', () => {
    it('should inject weather attributes and metrics into appropriate dashboard text fields', () => {
      // Mock DOM metric blocks
      const locationName = originalCreateElement.call(document, 'span');
      locationName.id = 'locationName';
      const locationCoords = originalCreateElement.call(document, 'span');
      locationCoords.id = 'locationCoords';
      const weatherTemp = originalCreateElement.call(document, 'span');
      weatherTemp.id = 'weatherTemp';
      const weatherDescription = originalCreateElement.call(document, 'span');
      weatherDescription.id = 'weatherDescription';
      const feelsLike = originalCreateElement.call(document, 'span');
      feelsLike.id = 'feelsLike';
      const windSpeed = originalCreateElement.call(document, 'span');
      windSpeed.id = 'windSpeed';

      document.body.appendChild(locationName);
      document.body.appendChild(locationCoords);
      document.body.appendChild(weatherTemp);
      document.body.appendChild(weatherDescription);
      document.body.appendChild(feelsLike);
      document.body.appendChild(windSpeed);

      const data = {
        name: 'Kandi',
        sys: { country: 'IN' },
        main: { temp: 31.2, feels_like: 34.6 },
        weather: [{ description: 'few clouds', icon: '02n' }],
        wind: { speed: 6.2 }
      };

      modeInstance.updateWeatherDisplayInPlanMode(data, 17.59, 78.12);

      expect(locationName.textContent).toBe('Kandi, IN');
      expect(locationCoords.textContent).toBe('17.5900, 78.1200');
      expect(weatherTemp.textContent).toBe('31°C');
      expect(weatherDescription.textContent).toBe('few clouds');
      expect(feelsLike.textContent).toBe('35°C');
      expect(windSpeed.textContent).toBe('6.2 m/s');
      expect(window.MsgConsole.success).toHaveBeenCalledWith(expect.stringContaining('Weather loaded for Kandi'));
    });

    it('should calculate correct cardinal wind headings in getWindDirection', () => {
      expect(modeInstance.getWindDirection(0)).toBe('N');
      expect(modeInstance.getWindDirection(45)).toBe('NE');
      expect(modeInstance.getWindDirection(90)).toBe('E');
      expect(modeInstance.getWindDirection(135)).toBe('SE');
      expect(modeInstance.getWindDirection(180)).toBe('S');
      expect(modeInstance.getWindDirection(225)).toBe('SW');
      expect(modeInstance.getWindDirection(270)).toBe('W');
      expect(modeInstance.getWindDirection(315)).toBe('NW');
      expect(modeInstance.getWindDirection(360)).toBe('N');
    });
  });
});