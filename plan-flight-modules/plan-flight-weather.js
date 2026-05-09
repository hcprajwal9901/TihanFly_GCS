/**
 * Plan Flight Mode - Weather Module (FIXED)
 * Handles weather dashboard positioning and click integration
 * FIX: Updated element IDs to match MainWindow.html structure
 */

// ========================================================================
// WEATHER DASHBOARD MOVEMENT
// ========================================================================

PlanFlightMode.prototype.moveWeatherToBottomLeft = function() {
    if (!this.weatherDashboard) {
        console.error('❌ weatherDashboard element not found');
        return;
    }
    
    console.log('🗺️ Moving weather dashboard to bottom left for plan mode');
    
    // Move to bottom left - positioned to not overlap with flight menu
    this.weatherDashboard.style.top = 'auto';
    this.weatherDashboard.style.bottom = '20px';
    this.weatherDashboard.style.right = 'auto';
    this.weatherDashboard.style.left = '110px';
    this.weatherDashboard.style.maxHeight = 'calc(100vh - 350px)';
    
    // Make sure weather dashboard is visible
    this.weatherDashboard.classList.remove('hidden');
    this.weatherDashboard.style.display = 'flex';
    
    console.log('✅ Weather dashboard repositioned');
    
    // ✅ Enable weather map click functionality
    this.enableWeatherMapClick();
};

PlanFlightMode.prototype.restoreWeatherPosition = function() {
    if (!this.weatherDashboard) {
        console.error('❌ weatherDashboard not found');
        return;
    }
    
    console.log('🔄 Restoring weather dashboard to original position');
    
    // Restore to top right
    this.weatherDashboard.style.top = '80px';
    this.weatherDashboard.style.bottom = 'auto';
    this.weatherDashboard.style.right = '20px';
    this.weatherDashboard.style.left = 'auto';
    this.weatherDashboard.style.maxHeight = 'calc(100vh - 100px)';
    
    // Remove weather click listener
    if (this._weatherClickListener && window.tmap && window.tmap.map) {
        window.tmap.map.off('click', this._weatherClickListener);
        this._weatherClickListener = null;
        console.log('✅ Weather click listener removed');
    }
    
    // Disable weather clicks via TMap
    if (window.tmap && window.tmap.disableWeatherClicks) {
        window.tmap.disableWeatherClicks();
        console.log('✅ Weather clicks disabled via TMap');
    }
    
    console.log('✅ Weather restored to top right');
};

// ========================================================================
// WEATHER MAP CLICK INTEGRATION
// ========================================================================

PlanFlightMode.prototype.enableWeatherMapClick = function() {
    console.log('🌦️ Enabling weather map click for plan mode');
    
    if (!window.tmap) {
        console.error('❌ TMap not available');
        return;
    }
    
    // Create weather click handler
    const weatherClickHandler = (lat, lng) => {
        console.log(`🌦️ Weather map click: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        
        // Fetch weather data
        this.fetchWeatherForPlanMode(lat, lng);
    };
    
    // Register with TMap
    if (window.tmap.registerWeatherClickHandler) {
        window.tmap.registerWeatherClickHandler(weatherClickHandler);
        console.log('✅ Weather click handler registered with TMap');
    } else {
        console.warn('⚠️ TMap.registerWeatherClickHandler not available');
    }
    
    // Enable weather clicks on map
    if (window.tmap.enableWeatherClicks) {
        window.tmap.enableWeatherClicks();
        console.log('✅ Weather clicks enabled via TMap');
    } else {
        console.warn('⚠️ TMap.enableWeatherClicks not available, adding direct listener');
        
        // Fallback: Add click listener directly to map
        if (window.tmap.map && !this._weatherClickListener) {
            this._weatherClickListener = (e) => {
                // Only trigger if not in waypoint mode
                const inWaypointMode = window.WaypointManager && window.WaypointManager.currentMode;
                if (!inWaypointMode) {
                    weatherClickHandler(e.latlng.lat, e.latlng.lng);
                }
            };
            window.tmap.map.on('click', this._weatherClickListener);
            console.log('✅ Weather click listener added directly to map');
        }
    }
    
    console.log('✅ Weather click handler fully enabled');
};

// ========================================================================
// WEATHER DATA FETCHING
// ========================================================================

PlanFlightMode.prototype.fetchWeatherForPlanMode = function(lat, lng) {
    console.log(`🌦️ Fetching weather for plan mode: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    
    // Use the weather dashboard's existing functionality
    if (window.weatherDashboard) {
        console.log('📡 Using weatherDashboard.fetchWeather()');
        window.weatherDashboard.fetchWeather(lat, lng);
        return;
    }
    
    // Fallback: Direct API call if weather dashboard not available
    const API_KEY = '4d125d1558963834e00131a295a7bc87';
    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${API_KEY}&units=metric`;
    
    // Get DOM elements - FIXED: Use correct IDs from MainWindow.html
    const loading = document.getElementById('weatherLoading');
    const error = document.getElementById('weatherError');
    const content = document.getElementById('weatherContent');
    
    // Show loading state
    if (loading) {
        loading.style.display = 'flex';
        console.log('📡 Showing loading state...');
    }
    if (error) error.style.display = 'none';
    if (content) content.style.display = 'none';
    
    fetch(apiUrl)
        .then(response => {
            console.log('📡 Weather API response status:', response.status);
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid API key. Get a free key from openweathermap.org');
                }
                throw new Error(`Weather API error: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('✅ Weather data received:', data);
            this.updateWeatherDisplayInPlanMode(data, lat, lng);
        })
        .catch(err => {
            console.error('❌ Error fetching weather:', err);
            
            // Show error state
            if (loading) loading.style.display = 'none';
            if (error) {
                error.style.display = 'flex';
                const errorMsg = document.getElementById('weatherErrorMessage');
                if (errorMsg) {
                    errorMsg.textContent = err.message || 'Failed to load weather data';
                }
            }
            
            // Show user-friendly message
            if (window.MsgConsole) {
                if (err.message.includes('API key')) {
                    window.MsgConsole.error('❌ Invalid weather API key');
                } else {
                    window.MsgConsole.error('❌ Failed to load weather data');
                }
            }
        });
};

PlanFlightMode.prototype.updateWeatherDisplayInPlanMode = function(data, lat, lng) {
    console.log('🌦️ Updating weather display in plan mode');
    
    const loading = document.getElementById('weatherLoading');
    const error = document.getElementById('weatherError');
    const content = document.getElementById('weatherContent');
    
    // Hide loading, show content
    if (loading) loading.style.display = 'none';
    if (error) error.style.display = 'none';
    if (content) content.style.display = 'flex';
    
    // Update location
    const locationName = document.getElementById('locationName');
    const locationCoords = document.getElementById('locationCoords');
    
    if (locationName) {
        const name = data.name || 'Unknown Location';
        const country = data.sys?.country || '';
        locationName.textContent = country ? `${name}, ${country}` : name;
    }
    
    if (locationCoords) {
        locationCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
    
    // Update temperature
    const weatherTemp = document.getElementById('weatherTemp');
    if (weatherTemp) {
        const temp = Math.round(data.main?.temp ?? 0);
        weatherTemp.textContent = `${temp}°C`;
    }
    
    // Update description
    const weatherDescription = document.getElementById('weatherDescription');
    if (weatherDescription) {
        weatherDescription.textContent = data.weather?.[0]?.description || 'N/A';
    }
    
    // Update icon
    const weatherMainIcon = document.getElementById('weatherMainIcon');
    if (weatherMainIcon) {
        const iconCode = data.weather?.[0]?.icon || '01d';
        weatherMainIcon.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
    }
    
    // Update feels like
    const feelsLike = document.getElementById('feelsLike');
    if (feelsLike) {
        const feels = Math.round(data.main?.feels_like ?? 0);
        feelsLike.textContent = `${feels}°C`;
    }
    
    // Update humidity
    const humidity = document.getElementById('humidity');
    if (humidity) {
        humidity.textContent = `${data.main?.humidity ?? 0}%`;
    }
    
    // Update wind speed
    const windSpeed = document.getElementById('windSpeed');
    if (windSpeed) {
        const speed = (data.wind?.speed ?? 0).toFixed(1);
        windSpeed.textContent = `${speed} m/s`;
    }
    
    // Update pressure
    const pressure = document.getElementById('pressure');
    if (pressure) {
        pressure.textContent = `${data.main?.pressure ?? 0} hPa`;
    }
    
    // Update visibility
    const visibility = document.getElementById('visibility');
    if (visibility) {
        const vis = ((data.visibility ?? 0) / 1000).toFixed(1);
        visibility.textContent = `${vis} km`;
    }
    
    // Update clouds
    const clouds = document.getElementById('clouds');
    if (clouds) {
        clouds.textContent = `${data.clouds?.all ?? 0}%`;
    }
    
    // Update time
    const updateTime = document.getElementById('weatherUpdateTime');
    if (updateTime) {
        const now = new Date();
        updateTime.textContent = `Last updated: ${now.toLocaleTimeString()}`;
    }
    
    console.log('✅ Weather display updated');
    
    // Show success message
    if (window.MsgConsole) {
        window.MsgConsole.success(`🌦️ Weather loaded for ${data.name || 'location'}`);
    }
};

PlanFlightMode.prototype.getWindDirection = function(degrees) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
};

console.log('✅ Plan Flight Weather Module Loaded (FIXED)');