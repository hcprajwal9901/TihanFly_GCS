/**
 * Weather Dashboard Handler - UPDATED with Backend Integration
 * Fetches and displays weather data with flight safety assessment
 * Integrates with WebSocket backend for real-time updates
 */

class WeatherDashboard {
    constructor() {
        // OpenWeatherMap API key (fallback for direct requests)
        this.apiKey = '4d125d1558963834e00131a295a7bc87';
        this.apiBaseUrl = 'https://api.openweathermap.org/data/2.5/weather';
        
        // DOM Elements
        this.dashboard = null;
        this.loading = null;
        this.error = null;
        this.content = null;
        this.closeBtn = null;
        this.retryBtn = null;
        
        // Current location data
        this.currentLat = null;
        this.currentLng = null;
        this.lastUpdate = null;
        
        // Current weather data
        this.currentWeather = null;
        
        // State
        this.isVisible = true;
        this.isLoading = false;
        
        // Backend connection reference
        this.backend = null;
        
        this.initialize();
    }

    initialize() {
        this.dashboard = document.getElementById('weatherDashboard');
        this.loading = document.getElementById('weatherLoading');
        this.error = document.getElementById('weatherError');
        this.content = document.getElementById('weatherContent');
        this.closeBtn = document.getElementById('weatherCloseBtn');
        this.retryBtn = document.getElementById('weatherRetryBtn');

        if (!this.dashboard) {
            console.error('❌ Weather Dashboard not found in DOM');
            return;
        }

        this.attachEventListeners();
        this.showInitialState();
        
        // Try to connect to backend
        this.connectToBackend();
        
        console.log('✅ Weather Dashboard initialized');
    }

    connectToBackend() {
        // Wait for backend to be available
        const checkBackend = setInterval(() => {
            if (window.compassBackend) {
                this.backend = window.compassBackend;
                console.log('✅ Weather Dashboard connected to backend');
                clearInterval(checkBackend);
                
                // Register weather message handler
                this.registerBackendHandlers();
            }
        }, 500);
        
        // Timeout after 10 seconds
        setTimeout(() => {
            if (!this.backend) {
                console.log('⚠️ Backend not available, using direct API calls');
            }
            clearInterval(checkBackend);
        }, 10000);
    }

    registerBackendHandlers() {
        // Store original handleMessage function
        const originalHandleMessage = this.backend.handleMessage.bind(this.backend);
        
        // Extend handleMessage to handle weather messages
        this.backend.handleMessage = (data) => {
            try {
                const message = JSON.parse(data);
                
                if (message.type === 'weather') {
                    this.handleBackendWeather(message.data);
                    return;
                }
                
                if (message.type === 'weather_warning') {
                    this.showWeatherWarning(message);
                    return;
                }
                
                if (message.type === 'weather_error') {
                    this.showError(message.message);
                    return;
                }
                
                // Call original handler for other messages
                originalHandleMessage(data);
                
            } catch (error) {
                console.error('❌ Error handling weather message:', error);
            }
        };
    }

    handleBackendWeather(data) {
        console.log('🌤️ Received weather data from backend:', data);
        
        this.currentWeather = data;
        this.displayWeatherFromBackend(data);
        this.updateSafetyIndicators(data.safety);
    }

    showWeatherWarning(message) {
        if (window.MsgConsole) {
            window.MsgConsole.warning(message.message);
        }
        console.warn('⚠️', message.message);
    }

    attachEventListeners() {
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                this.hide();
            });
        }

        if (this.retryBtn) {
            this.retryBtn.addEventListener('click', () => {
                if (this.currentLat && this.currentLng) {
                    this.fetchWeather(this.currentLat, this.currentLng);
                }
            });
        }
    }

    showInitialState() {
        this.loading.style.display = 'none';
        this.error.style.display = 'none';
        this.content.style.display = 'flex';
        
        const updateTime = document.getElementById('weatherUpdateTime');
        if (updateTime) {
            updateTime.textContent = 'Click map to load weather';
        }
    }

    validateCoordinates(lat, lng) {
        let normalizedLng = lng;
        while (normalizedLng > 180) normalizedLng -= 360;
        while (normalizedLng < -180) normalizedLng += 360;
        
        if (lat < -90 || lat > 90) {
            console.error(`❌ Invalid latitude: ${lat}`);
            return null;
        }
        
        return { lat: lat, lng: normalizedLng };
    }

    async fetchWeather(lat, lng) {
        if (this.isLoading) {
            console.log('⏳ Weather fetch already in progress');
            return;
        }

        const coords = this.validateCoordinates(lat, lng);
        if (!coords) {
            this.showError(`Invalid coordinates: ${lat.toFixed(2)}, ${lng.toFixed(2)}`);
            return;
        }

        this.currentLat = coords.lat;
        this.currentLng = coords.lng;
        this.isLoading = true;

        console.log(`🌤️ Fetching weather for: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
        this.showLoading();

        // Try backend first, fallback to direct API
        if (this.backend && this.backend.isConnected) {
            console.log('📡 Requesting weather from backend...');
            
            const weatherRequest = {
                type: 'weather_request',
                latitude: coords.lat,
                longitude: coords.lng,
                timestamp: Date.now()
            };
            
            if (this.backend.ws && this.backend.ws.readyState === WebSocket.OPEN) {
                this.backend.ws.send(JSON.stringify(weatherRequest));
                
                // Backend will send response via handleMessage
                // Set timeout for response
                setTimeout(() => {
                    if (this.isLoading) {
                        console.log('⚠️ Backend timeout, falling back to direct API');
                        this.fetchWeatherDirect(coords.lat, coords.lng);
                    }
                }, 5000);
            } else {
                this.fetchWeatherDirect(coords.lat, coords.lng);
            }
        } else {
            this.fetchWeatherDirect(coords.lat, coords.lng);
        }
    }

    async fetchWeatherDirect(lat, lng) {
        try {
            const url = `${this.apiBaseUrl}?lat=${lat}&lon=${lng}&appid=${this.apiKey}&units=metric`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ Weather data received (direct):', data);

            this.displayWeather(data);
            this.lastUpdate = new Date();
            
        } catch (error) {
            console.error('❌ Error fetching weather:', error);
            this.showError(error.message);
            
            if (window.MsgConsole) {
                window.MsgConsole.error(`Weather fetch failed: ${error.message}`);
            }
        } finally {
            this.isLoading = false;
        }
    }

    showLoading() {
        this.loading.style.display = 'flex';
        this.error.style.display = 'none';
        this.content.style.display = 'none';
    }

    showError(message) {
        this.loading.style.display = 'none';
        this.error.style.display = 'flex';
        this.content.style.display = 'none';
        
        const errorMessage = document.getElementById('weatherErrorMessage');
        if (errorMessage) {
            errorMessage.textContent = message || 'Failed to load weather data';
        }
        
        this.isLoading = false;
    }

    displayWeatherFromBackend(data) {
        this.isLoading = false;
        this.loading.style.display = 'none';
        this.error.style.display = 'none';
        this.content.style.display = 'flex';

        // Location
        const locationName = data.location.name || 'Unknown Location';
        const country = data.location.country || '';
        document.getElementById('locationName').textContent = 
            country ? `${locationName}, ${country}` : locationName;
        
        document.getElementById('locationCoords').textContent = 
            `${data.location.latitude.toFixed(4)}, ${data.location.longitude.toFixed(4)}`;

        // Main weather
        const temp = Math.round(data.main.temperature);
        document.getElementById('weatherTemp').textContent = `${temp}°C`;
        document.getElementById('weatherDescription').textContent = data.main.description;
        document.getElementById('weatherMainIcon').src = 
            `https://openweathermap.org/img/wn/${data.main.iconCode}@2x.png`;

        // Weather details
        document.getElementById('feelsLike').textContent = `${Math.round(data.main.feelsLike)}°C`;
        document.getElementById('humidity').textContent = `${data.conditions.humidity}%`;
        document.getElementById('windSpeed').textContent = `${data.wind.speed.toFixed(1)} m/s`;
        document.getElementById('pressure').textContent = `${data.conditions.pressure} hPa`;
        document.getElementById('visibility').textContent = 
            `${(data.conditions.visibility / 1000).toFixed(1)} km`;
        document.getElementById('clouds').textContent = `${data.conditions.clouds}%`;

        // Update time
        const updateTime = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        document.getElementById('weatherUpdateTime').textContent = 
            `Last updated: ${updateTime}`;

        console.log('✅ Weather data displayed (from backend)');
    }

    displayWeather(data) {
        this.isLoading = false;
        this.loading.style.display = 'none';
        this.error.style.display = 'none';
        this.content.style.display = 'flex';

        // Location
        const locationName = data.name || 'Unknown Location';
        const country = data.sys?.country || '';
        document.getElementById('locationName').textContent = 
            country ? `${locationName}, ${country}` : locationName;
        
        document.getElementById('locationCoords').textContent = 
            `${this.currentLat.toFixed(4)}, ${this.currentLng.toFixed(4)}`;

        // Main weather
        const temp = Math.round(data.main?.temp ?? 0);
        const description = data.weather?.[0]?.description || 'N/A';
        const iconCode = data.weather?.[0]?.icon || '01d';
        
        document.getElementById('weatherTemp').textContent = `${temp}°C`;
        document.getElementById('weatherDescription').textContent = description;
        document.getElementById('weatherMainIcon').src = 
            `https://openweathermap.org/img/wn/${iconCode}@2x.png`;

        // Weather details
        const feelsLike = Math.round(data.main?.feels_like ?? 0);
        const humidity = data.main?.humidity ?? 0;
        const windSpeed = data.wind?.speed?.toFixed(1) ?? 0;
        const pressure = data.main?.pressure ?? 0;
        const visibility = ((data.visibility ?? 0) / 1000).toFixed(1);
        const clouds = data.clouds?.all ?? 0;

        document.getElementById('feelsLike').textContent = `${feelsLike}°C`;
        document.getElementById('humidity').textContent = `${humidity}%`;
        document.getElementById('windSpeed').textContent = `${windSpeed} m/s`;
        document.getElementById('pressure').textContent = `${pressure} hPa`;
        document.getElementById('visibility').textContent = `${visibility} km`;
        document.getElementById('clouds').textContent = `${clouds}%`;

        // Update time
        const updateTime = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        document.getElementById('weatherUpdateTime').textContent = 
            `Last updated: ${updateTime}`;

        console.log('✅ Weather data displayed successfully');
    }

    updateSafetyIndicators(safety) {
        // Add safety indicator to weather dashboard
        let safetyDiv = document.getElementById('weatherSafetyIndicator');
        
        if (!safetyDiv) {
            safetyDiv = document.createElement('div');
            safetyDiv.id = 'weatherSafetyIndicator';
            safetyDiv.style.cssText = `
                margin-top: 16px;
                padding: 12px;
                border-radius: 8px;
                background: ${safety.overallColor}22;
                border: 2px solid ${safety.overallColor};
            `;
            
            const weatherContent = document.getElementById('weatherContent');
            if (weatherContent) {
                weatherContent.appendChild(safetyDiv);
            }
        }
        
        safetyDiv.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 18px; font-weight: bold; color: ${safety.overallColor}; margin-bottom: 8px;">
                    ${safety.message}
                </div>
                ${safety.warnings && safety.warnings.length > 0 ? `
                    <div style="font-size: 12px; color: #fff; margin-top: 8px;">
                        ${safety.warnings.map(w => `<div style="margin: 4px 0;">• ${w}</div>`).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Update status badge
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge && safety.overall === 'UNSAFE') {
            statusBadge.textContent = 'Weather Unsafe';
            statusBadge.className = 'status-badge';
            statusBadge.style.background = safety.overallColor;
        }
    }

    onMapClick(lat, lng) {
        console.log(`🗺️ Map clicked at: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        this.show();
        this.fetchWeather(lat, lng);
        
        if (window.MsgConsole) {
            window.MsgConsole.info(`Weather requested: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        }
    }

    refresh() {
        if (this.currentLat && this.currentLng) {
            console.log('🔄 Refreshing weather data');
            this.fetchWeather(this.currentLat, this.currentLng);
        } else {
            console.log('⚠️ No location set, cannot refresh');
        }
    }

    show() {
        if (this.dashboard) {
            this.dashboard.classList.remove('hidden');
            this.isVisible = true;
            console.log('👁️ Weather Dashboard shown');
        }
    }

    hide() {
        if (this.dashboard) {
            this.dashboard.classList.add('hidden');
            this.isVisible = false;
            console.log('🙈 Weather Dashboard hidden');
        }
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    isShown() {
        return this.isVisible;
    }

    getCurrentLocation() {
        return {
            lat: this.currentLat,
            lng: this.currentLng,
            lastUpdate: this.lastUpdate
        };
    }

    getCurrentWeather() {
        return this.currentWeather;
    }

    clear() {
        this.currentLat = null;
        this.currentLng = null;
        this.lastUpdate = null;
        this.currentWeather = null;
        this.showInitialState();
        console.log('🗑️ Weather data cleared');
    }
}

// Auto-initialize
function initializeWeatherDashboard() {
    window.weatherDashboard = new WeatherDashboard();
    console.log('✅ Weather Dashboard ready');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWeatherDashboard);
} else {
    initializeWeatherDashboard();
}

// Global API
window.Weather = {
    show: () => window.weatherDashboard?.show(),
    hide: () => window.weatherDashboard?.hide(),
    toggle: () => window.weatherDashboard?.toggle(),
    refresh: () => window.weatherDashboard?.refresh(),
    fetchWeather: (lat, lng) => window.weatherDashboard?.fetchWeather(lat, lng),
    clear: () => window.weatherDashboard?.clear(),
    isShown: () => window.weatherDashboard?.isShown() || false,
    getLocation: () => window.weatherDashboard?.getCurrentLocation() || null,
    getWeather: () => window.weatherDashboard?.getCurrentWeather() || null
};

console.log('%c🌤️ Weather Dashboard Ready (Backend Integrated)', 'color: #FFCC00; font-size: 14px; font-weight: bold;');