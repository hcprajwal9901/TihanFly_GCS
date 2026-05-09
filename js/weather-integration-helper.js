/**
 * Weather Dashboard Integration Helper
 * Add this code to your app.js file to ensure weather dashboard works with map clicks
 */

// Method 1: Direct integration after map initialization
function integrateWeatherWithMap() {
    console.log('🔧 Starting Weather Dashboard integration...');
    
    // Check if map exists
    if (!window.tmap) {
        console.error('❌ Map (window.tmap) not found!');
        console.log('💡 Make sure tmap.js is loaded before this script');
        return false;
    }
    
    // Check if weather dashboard exists
    if (!window.weatherDashboard) {
        console.error('❌ Weather Dashboard not found!');
        console.log('💡 Make sure weather-dashboard.js is loaded before this script');
        return false;
    }
    
    // Enable map clicking
    window.tmap.enableClick();
    console.log('✅ Map click enabled');
    
    // Set up the click handler
    window.tmap.onClick((lat, lng) => {
        console.log(`🌍 Map clicked at: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        console.log('📡 Fetching weather data...');
        
        // Call weather dashboard
        window.weatherDashboard.onMapClick(lat, lng);
    });
    
    console.log('✅ Weather Dashboard integrated successfully!');
    console.log('👆 Click anywhere on the map to load weather data');
    
    // Show message in console if available
    if (window.MsgConsole) {
        window.MsgConsole.success('Weather Dashboard ready - Click map to load weather');
    }
    
    return true;
}

// Method 2: Auto-integration with retry logic
function autoIntegrateWeather() {
    let attempts = 0;
    const maxAttempts = 50;
    
    const integrationInterval = setInterval(() => {
        attempts++;
        
        // Check if both map and weather dashboard are ready
        if (window.tmap && window.weatherDashboard) {
            console.log(`✅ Found map and weather dashboard (attempt ${attempts})`);
            
            // Perform integration
            const success = integrateWeatherWithMap();
            
            if (success) {
                clearInterval(integrationInterval);
            }
        } else {
            // Log what's missing
            if (!window.tmap) {
                console.log(`⏳ Waiting for map... (attempt ${attempts}/${maxAttempts})`);
            }
            if (!window.weatherDashboard) {
                console.log(`⏳ Waiting for weather dashboard... (attempt ${attempts}/${maxAttempts})`);
            }
        }
        
        // Timeout after max attempts
        if (attempts >= maxAttempts) {
            console.error('❌ Integration timeout - could not find map or weather dashboard');
            console.log('Available:', {
                map: !!window.tmap,
                weather: !!window.weatherDashboard
            });
            clearInterval(integrationInterval);
        }
    }, 200); // Check every 200ms
}

// Method 3: Manual test function
function testWeatherDashboard() {
    console.log('🧪 Testing Weather Dashboard...');
    
    // Test with Hyderabad coordinates
    const testLat = 17.4435;
    const testLng = 78.3772;
    
    if (window.weatherDashboard) {
        console.log(`📡 Fetching weather for Hyderabad (${testLat}, ${testLng})`);
        window.weatherDashboard.fetchWeather(testLat, testLng);
    } else {
        console.error('❌ Weather Dashboard not found!');
    }
}

// Method 4: Debug function to check current state
function debugWeatherIntegration() {
    console.log('🔍 Weather Dashboard Debug Info:');
    console.log('================================');
    console.log('Map (window.tmap):', !!window.tmap);
    console.log('Weather Dashboard:', !!window.weatherDashboard);
    console.log('Weather API:', !!window.Weather);
    
    if (window.tmap) {
        console.log('Map click enabled:', window.tmap.clickEnabled);
        console.log('Map click callback:', !!window.tmap.clickCallback);
    }
    
    if (window.weatherDashboard) {
        console.log('Weather visible:', window.weatherDashboard.isVisible);
        console.log('Weather loading:', window.weatherDashboard.isLoading);
        console.log('Current location:', window.weatherDashboard.getCurrentLocation());
    }
    
    console.log('================================');
}

// ============================================================================
// AUTO-RUN INTEGRATION
// ============================================================================

console.log('🌤️ Weather Integration Helper loaded');
console.log('Available functions:');
console.log('  - integrateWeatherWithMap() - Manual integration');
console.log('  - autoIntegrateWeather() - Auto-integration with retry');
console.log('  - testWeatherDashboard() - Test with Hyderabad location');
console.log('  - debugWeatherIntegration() - Show debug info');

// Automatically try to integrate when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM loaded, starting auto-integration...');
        setTimeout(autoIntegrateWeather, 500);
    });
} else {
    console.log('📄 DOM already loaded, starting auto-integration...');
    setTimeout(autoIntegrateWeather, 500);
}

// Export functions to window for manual access
window.WeatherIntegration = {
    integrate: integrateWeatherWithMap,
    autoIntegrate: autoIntegrateWeather,
    test: testWeatherDashboard,
    debug: debugWeatherIntegration
};