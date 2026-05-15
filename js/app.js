/**
 * Main Application Script - app.js
 * UPDATED: Added Compass Backend Integration for WebSocket telemetry
 */

console.log('🚀 TiHANFly GCS Application Starting...');

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

var tmap = null;
var compass = null;
var compassBackend = null; // NEW: Backend integration
var videoStream = null;
var flightControls = null;
var messageConsole = null;
var weatherDashboard = null;
var waypointManager = null;
var homeMarker = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeApplication() {
    console.log('⚙️ Initializing application components...');
    
    // Step 1: Initialize Map FIRST
    initializeMap();
    
    // Step 2: Wait for map to be ready, then initialize other components
    setTimeout(() => {
        initializeCompass();
        initializeVideo();
        initializeVideoMaximize();
        
        // Step 3: Wait a bit more, then integrate everything
        setTimeout(() => {
            integrateComponents();
        }, 500);
    }, 500);
}

// ============================================================================
// MAP INITIALIZATION - MUST BE FIRST
// ============================================================================

function initializeMap() {
    console.log('🗺️ Initializing map...');
    
    try {
        const defaultLat = 17.60172258544661;
        const defaultLng = 78.12699163814133;
        const defaultZoom = 18;
        
        tmap = new TMap('map', [defaultLat, defaultLng], defaultZoom, false);
        window.tmap = tmap;
        
        console.log('✅ Map initialized');
        console.log('✅ window.tmap is now available');
        
        // Add static locations with simple home marker
        addStaticLocations();
        
    } catch (error) {
        console.error('❌ Error initializing map:', error);
    }
}

// ============================================================================
// STATIC LOCATIONS WITH SIMPLE PNG HOME MARKER
// ============================================================================

function addStaticLocations() {
    console.log('📍 Adding static location markers...');
    
    if (!tmap) {
        console.error('❌ Map not initialized, cannot add static locations');
        return;
    }
    
    try {
        // Add Simple Home Marker
        homeMarker = tmap.addRotatingHomeMarker(
            17.60244305205114,
            78.12687671185479,
            'Home Location',
            {
                iconSize: [80, 80],
                iconAnchor: [20, 40],
                iconUrl: 'resources/icon/home.png',
                labelOffset: [0, 5],
                permanentLabel: false,
                labelColor: '#FFCC00',
            }
        );
        
        console.log('✅ Simple Home Marker added: Home Location');
        console.log(`📍 Total markers on map: ${tmap.getMarkerCount()}`);
        
        if (window.MsgConsole) {
            window.MsgConsole.success('🏠 Home Marker loaded');
            window.MsgConsole.info('📍 Static locations loaded');
        }
        
    } catch (error) {
        console.error('❌ Error adding static locations:', error);
    }
}

// ============================================================================
// COMPASS INITIALIZATION
// ============================================================================

function initializeCompass() {
    console.log('🧭 Initializing compass...');
    
    try {
        compass = new CompassEnhanced('map');
        window.compass = compass;
        
        compass.updateTelemetry({
            latitude: 17.60172258544661,
            longitude: 78.12699163814133,
            altitude: 0,
            speed: 0,
            distance: 0,
            satellites: 12
        });
        
        console.log('✅ Compass initialized');
        
        // Initialize compass backend integration
        initializeCompassBackend();
        
    } catch (error) {
        console.error('❌ Error initializing compass:', error);
    }
}

// ============================================================================
// COMPASS BACKEND INTEGRATION - NEW
// ============================================================================

function initializeCompassBackend() {
    console.log('📡 Initializing Compass Backend Integration...');
    
    if (!compass) {
        console.error('❌ Compass not initialized, cannot start backend');
        return;
    }
    
    try {
        compassBackend = new CompassBackend(compass, 'ws://localhost:9002');
        window.compassBackend = compassBackend;
        console.log('✅ Compass Backend initialized');
    } catch (error) {
        console.error('❌ Error initializing compass backend:', error);
    }
}

/**
 * CompassBackend Class - Handles WebSocket communication for telemetry
 */
class CompassBackend {
    constructor(compassInstance, websocketUrl = 'ws://localhost:9002') {
        this.compass = compassInstance;
        this.ws = null;
        this.websocketUrl = websocketUrl;
        this.isConnected = false;
        this.reconnectInterval = 3000;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        // Telemetry data cache
        this.telemetryCache = {
            heading: 0,
            latitude: 0,
            longitude: 0,
            altitude: 0,
            speed: 0,
            distance: 0,
            satellites: 0,
            battery: 100
        };
        
        // Connection status indicator elements
        this.statusBadge = document.querySelector('.status-badge');
        this.batteryIndicator = document.querySelector('.battery-indicator .indicator-text');
        this.gpsIndicator = document.querySelector('.indicator-item img[alt="GPS"]')?.parentElement;
        
        this.init();
    }

    init() {
        console.log('📡 Starting WebSocket connection...');
        this.connect();
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('⚠️  Already connected to WebSocket');
            return;
        }

        try {
            console.log(`🔌 Connecting to ${this.websocketUrl}...`);
            this.ws = new WebSocket(this.websocketUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log('✅ WebSocket connected - Telemetry streaming active');
                
                this.updateConnectionStatus(true);
                
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                
                if (window.MsgConsole) {
                    window.MsgConsole.success('📡 Backend connected');
                }
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                console.log('🔌 WebSocket disconnected');
                
                this.updateConnectionStatus(false);
                
                if (window.MsgConsole) {
                    window.MsgConsole.warning('📡 Backend disconnected');
                }
                
                this.scheduleReconnect();
            };

        } catch (error) {
            console.error('❌ Failed to create WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Max reconnection attempts reached');
            if (window.MsgConsole) {
                window.MsgConsole.error('Connection failed - Max attempts reached');
            }
            return;
        }

        if (!this.reconnectTimer) {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnecting in ${this.reconnectInterval / 1000}s... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, this.reconnectInterval);
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'telemetry':
                    this.handleTelemetry(message.data);
                    break;
                    
                case 'status':
                    this.handleStatus(message);
                    break;
                    
                case 'command_response':
                    this.handleCommandResponse(message);
                    break;
                    
                default:
                    console.log('📨 Received message:', message);
            }
            
        } catch (error) {
            console.error('❌ Error parsing message:', error);
        }
    }

    handleTelemetry(data) {
        // Update cache
        Object.assign(this.telemetryCache, data);
        
        // Update compass heading
        if (data.heading !== undefined) {
            this.compass.setHeading(data.heading);
        }
        
        // Update all telemetry values in compass
        this.compass.updateTelemetry({
            latitude: data.latitude,
            longitude: data.longitude,
            altitude: data.altitude,
            speed: data.speed,
            distance: data.distance,
            satellites: data.satellites
        });
        
        // Update header indicators
        this.updateHeaderIndicators(data);
    }

    handleStatus(message) {
        console.log('📊 Status:', message);
        
        if (window.MsgConsole) {
            const statusText = message.result || message.message || 'Status update';
            const statusType = message.result === 'accepted' ? 'success' : 'info';
            window.MsgConsole.addMessage(statusText, statusType);
        }
    }

    handleCommandResponse(message) {
        console.log('📝 Command Response:', message);
        
        if (window.MsgConsole) {
            const cmdText = `${message.command}: ${message.message || message.result}`;
            const cmdType = message.success ? 'success' : 'error';
            window.MsgConsole.addMessage(cmdText, cmdType);
        }
    }

    updateConnectionStatus(connected) {
        if (this.statusBadge) {
            if (connected) {
                this.statusBadge.textContent = 'Connected';
                this.statusBadge.className = 'status-badge ready';
            } else {
                this.statusBadge.textContent = 'Disconnected';
                this.statusBadge.className = 'status-badge';
            }
        }
    }

    updateHeaderIndicators(data) {
        // Update battery indicator
        if (data.battery !== undefined && this.batteryIndicator) {
            this.batteryIndicator.textContent = `${data.battery}%`;
            
            // Change battery icon based on level (if you have different battery icons)
            const batteryIcon = this.batteryIndicator.previousElementSibling;
            if (batteryIcon) {
                if (data.battery < 20) {
                    batteryIcon.src = 'resources/BatteryRed.svg';
                } else if (data.battery < 50) {
                    batteryIcon.src = 'resources/BatteryYellow.svg';
                } else {
                    batteryIcon.src = 'resources/BatteryGreen.svg';
                }
            }
        }
        
        // Update GPS satellite count
        if (data.satellites !== undefined) {
            const gpsText = document.querySelector('.indicator-item img[alt="GPS"]')?.parentElement?.querySelector('.indicator-text');
            if (gpsText) {
                gpsText.textContent = data.satellites;
            }
        }
    }

    sendCommand(command, params = {}) {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️  Cannot send command: WebSocket not connected');
            if (window.MsgConsole) {
                window.MsgConsole.warning('Cannot send command: Not connected');
            }
            return false;
        }

        const message = {
            type: 'command',
            command: command,
            params: params,
            timestamp: Date.now()
        };

        try {
            if (window.sendToSelected) {
                window.sendToSelected(message);
            } else {
                message.sysid = window.selectedSysId || 1;
                this.ws.send(JSON.stringify(message));
            }
            console.log('📤 Sent command:', command, params);
            return true;
        } catch (error) {
            console.error('❌ Error sending command:', error);
            if (window.MsgConsole) {
                window.MsgConsole.error('Error sending command');
            }
            return false;
        }
    }

    requestTelemetry() {
        const request = {
            type: 'request',
            request: 'telemetry',
            timestamp: Date.now()
        };
        
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(request));
        }
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        this.updateConnectionStatus(false);
        console.log('🔌 Disconnected from WebSocket');
    }

    getTelemetry() {
        return { ...this.telemetryCache };
    }

    isConnectionActive() {
        return this.isConnected;
    }
}

// ============================================================================
// VIDEO STREAM INITIALIZATION
// ============================================================================

function initializeVideo() {
    console.log('📹 Initializing video stream...');
    
    try {
        if (typeof VideoStream !== 'undefined') {
            videoStream = new VideoStream('videoStream');
            window.videoStream = videoStream;
            console.log('✅ Video stream initialized');
        } else {
            console.log('ℹ️ VideoStream class not found, skipping video initialization');
        }
        
    } catch (error) {
        console.error('❌ Error initializing video:', error);
    }
}

// ============================================================================
// VIDEO MAXIMIZE/MINIMIZE HANDLER
// ============================================================================

function initializeVideoMaximize() {
    console.log('📺 Initializing Click-to-Maximize Video Handler...');
    
    let isVideoMaximized = false;
    
    const videoContainer = document.getElementById('videoContainer');
    const mapContainer = document.getElementById('map');
    
    if (!videoContainer || !mapContainer) {
        console.error('❌ Required elements not found for video maximize');
        return;
    }
    
    const maxBtn = document.getElementById('videoMaxBtn');
    if (maxBtn) {
        maxBtn.style.display = 'none';
        console.log('🔒 Maximize button hidden - using click to toggle');
    }
    
    function toggleVideoMaximize() {
        isVideoMaximized = !isVideoMaximized;
        
        if (isVideoMaximized) {
            console.log('🔲 Maximizing video...');
            
            videoContainer.classList.add('maximized');
            mapContainer.classList.add('minimized');
            videoContainer.style.cursor = 'zoom-out';
            
            console.log('✅ Video maximized, map minimized');
            
            if (window.MsgConsole) {
                window.MsgConsole.info('Video maximized - Click video or map to restore');
            }
            
            setTimeout(() => {
                if (window.tmap && window.tmap.map) {
                    window.tmap.map.invalidateSize();
                    console.log('🗺️ Map resized for PIP mode');
                }
            }, 100);
            
        } else {
            console.log('🔳 Restoring default view...');
            
            videoContainer.classList.remove('maximized');
            mapContainer.classList.remove('minimized');
            videoContainer.style.cursor = 'zoom-in';
            
            console.log('✅ Default view restored');
            
            if (window.MsgConsole) {
                window.MsgConsole.info('Default view restored');
            }
            
            const resizeAttempts = [100, 300, 500, 800];
            resizeAttempts.forEach((delay) => {
                setTimeout(() => {
                    if (window.tmap && window.tmap.map) {
                        window.tmap.map.invalidateSize();
                        
                        window.tmap.map.eachLayer((layer) => {
                            if (layer.redraw) {
                                layer.redraw();
                            }
                        });
                        
                        console.log(`🔄 Map resize attempt at ${delay}ms`);
                    }
                }, delay);
            });
        }
    }
    
    videoContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }
        
        console.log('🖱️ Video container clicked - toggling view');
        toggleVideoMaximize();
    });
    
    mapContainer.addEventListener('click', (e) => {
        if (mapContainer.classList.contains('minimized')) {
            console.log('🗺️ Minimized map clicked - restoring...');
            
            toggleVideoMaximize();
            
            setTimeout(() => {
                if (window.tmap && window.tmap.map) {
                    console.log('🔄 Force reloading map...');
                    window.tmap.map.invalidateSize();
                    
                    window.tmap.map.eachLayer((layer) => {
                        if (layer.redraw) {
                            layer.redraw();
                        }
                    });
                    
                    console.log('✅ Map reloaded successfully');
                }
            }, 200);
            
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'v' || e.key === 'V') {
            if (document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.tagName !== 'TEXTAREA') {
                toggleVideoMaximize();
            }
        }
    });
    
    videoContainer.style.cursor = 'zoom-in';
    videoContainer.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    
    window.VideoMaximize = {
        toggle: toggleVideoMaximize,
        isMaximized: () => isVideoMaximized,
        maximize: () => {
            if (!isVideoMaximized) toggleVideoMaximize();
        },
        minimize: () => {
            if (isVideoMaximized) toggleVideoMaximize();
        }
    };
    
    console.log('✅ Click-to-Maximize Video Handler Ready');
}

// ============================================================================
// COMPONENT INTEGRATION
// ============================================================================

function integrateComponents() {
    console.log('🔗 Integrating components...');
    
    flightControls = window.flightControls;
    messageConsole = window.minimalConsole || window.MsgConsole;
    weatherDashboard = window.weatherDashboard;
    
    // ✅ IMPORTANT: Wait for WaypointManager to initialize
    waypointManager = window.WaypointManager;
    
    if (!waypointManager) {
        console.warn('⚠️ WaypointManager not initialized yet, waiting...');
        
        // Wait and retry
        let retries = 0;
        const checkInterval = setInterval(() => {
            retries++;
            
            if (window.WaypointManager) {
                clearInterval(checkInterval);
                waypointManager = window.WaypointManager;
                console.log('✅ WaypointManager found after', retries, 'retries');
                finishIntegration();
            } else if (retries > 50) {
                clearInterval(checkInterval);
                console.error('❌ WaypointManager not found after 50 retries');
                finishIntegration(); // Continue anyway
            }
        }, 200);
        
        return;
    }
    
    finishIntegration();
}

function finishIntegration() {
    console.log('🔗 Finishing component integration...');
    
    integrateWeatherDashboard();
    integrateFlightControls();
    integrateWaypointManager();
    
    // Initialize MissionFile if not already initialized
    if (!window.MissionFile && typeof initializeMissionFileManager === 'function') {
        console.log('📄 Initializing MissionFile...');
        initializeMissionFileManager();
    }
    
    // Don't start demo updates if backend is connected
    if (!compassBackend || !compassBackend.isConnected) {
        startDemoUpdates();
    }
    
    console.log('✅ All components integrated');
    
    if (window.MsgConsole) {
        window.MsgConsole.success('🚁 TiHANFly GCS Ready');
        window.MsgConsole.info('🏠 Simple home marker active');
        window.MsgConsole.info('Click video to maximize - Click PLAN to enter flight planning');
        
        if (compassBackend && compassBackend.isConnected) {
            window.MsgConsole.success('📡 Backend telemetry active');
        }
    }
}

// ============================================================================
// WEATHER DASHBOARD INTEGRATION
// ============================================================================

function integrateWeatherDashboard() {
    console.log('🌤️ Integrating Weather Dashboard with priority system...');
    
    if (!tmap) {
        console.error('❌ Map not found, cannot integrate weather dashboard');
        return;
    }
    
    if (!weatherDashboard) {
        console.error('❌ Weather Dashboard not found');
        return;
    }
    
    tmap.enableClick();
    console.log('✅ Map click enabled');
    
    tmap.onClick((lat, lng, e) => {
        console.log(`🖱️ Map clicked at: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        
        if (window.WaypointManager && window.WaypointManager.currentMode) {
            console.log(`📍 WAYPOINT MODE ACTIVE: ${window.WaypointManager.currentMode}`);
            console.log('Routing click to WaypointManager...');
            window.WaypointManager.handleMapClick(lat, lng, e);
            return;
        }
        
        if (window.PlanFlight && window.PlanFlight.isActive && window.PlanFlight.isActive()) {
            console.log('🗺️ Plan Flight mode active but no waypoint action - ignoring click');
            return;
        }
        
        console.log('🌤️ Normal mode - showing weather');
        weatherDashboard.onMapClick(lat, lng);
        
        if (window.MsgConsole) {
            window.MsgConsole.info(`Weather: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        }
    });
    
    console.log('✅ Weather Dashboard integrated with smart priority system');
}

// ============================================================================
// FLIGHT CONTROLS INTEGRATION - UPDATED WITH BACKEND
// ============================================================================

function integrateFlightControls() {
    console.log('🎮 Integrating Flight Controls...');
    
    if (!flightControls) {
        console.log('ℹ️ Flight Controls not found, skipping integration');
        return;
    }
    
    flightControls.onTakeoff((settings) => {
        console.log('🚀 TAKEOFF initiated:', settings);
        
        // Send to backend if connected
        if (compassBackend && compassBackend.isConnected) {
            compassBackend.sendCommand('TAKEOFF', { altitude: settings.altitude });
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.takeoff(settings.altitude);
        }
    });
    
    flightControls.onLand(() => {
        console.log('🛬 LAND initiated');
        
        // Send to backend if connected
        if (compassBackend && compassBackend.isConnected) {
            compassBackend.sendCommand('LAND');
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.land();
        }
    });
    
    flightControls.onRTL(() => {
        console.log('🏠 RTL initiated');
        
        // Send to backend if connected
        if (compassBackend && compassBackend.isConnected) {
            compassBackend.sendCommand('RTL');
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.rtl();
        }
    });
    
    console.log('✅ Flight Controls integrated with backend support');
}

// ============================================================================
// WAYPOINT MANAGER INTEGRATION
// ============================================================================

function integrateWaypointManager() {
    console.log('📍 Integrating Waypoint Manager...');
    
    if (!waypointManager) {
        console.warn('⚠️ Waypoint Manager not found, skipping integration');
        return;
    }
    
    console.log('✅ Waypoint Manager integrated');
}

// ============================================================================
// DEMO DATA UPDATES (Only if backend not connected)
// ============================================================================

function startDemoUpdates() {
    console.log('📊 Starting demo data updates...');
    
    let currentHeading = 0;
    setInterval(() => {
        if (compass && (!compassBackend || !compassBackend.isConnected)) {
            currentHeading = (currentHeading + 5) % 360;
            compass.setHeading(currentHeading);
        }
    }, 2000);
    
    setInterval(() => {
        if (compass && (!compassBackend || !compassBackend.isConnected)) {
            const randomAlt = (Math.random() * 50).toFixed(1);
            const randomSpeed = (Math.random() * 10).toFixed(1);
            
            compass.updateTelemetry({
                altitude: parseFloat(randomAlt),
                speed: parseFloat(randomSpeed),
                satellites: Math.floor(Math.random() * 5) + 10
            });
        }
    }, 5000);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function addCustomLocation(lat, lng, name, options = {}) {
    if (!tmap) {
        console.error('❌ Map not initialized');
        return null;
    }
    
    const defaultOptions = {
        iconColor: '#E6007E',
        labelDirection: 'right',
        labelOffset: [15, 0],
        permanentLabel: true,
        ...options
    };
    
    const marker = tmap.addStaticLocation(lat, lng, name, defaultOptions);
    console.log(`✅ Added custom location: ${name} at ${lat}, ${lng}`);
    
    if (window.MsgConsole) {
        window.MsgConsole.success(`📍 Added: ${name}`);
    }
    
    return marker;
}

function addCustomHomeMarker(lat, lng, name = 'Home', options = {}) {
    if (!tmap) {
        console.error('❌ Map not initialized');
        return null;
    }
    
    const defaultOptions = {
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        iconUrl: 'resources/icon/home.png',
        labelDirection: 'bottom',
        labelOffset: [0, 5],
        permanentLabel: true,
        labelColor: '#FFCC00',
        labelBgColor: 'rgba(230, 0, 126, 0.9)',
        ...options
    };
    
    const marker = tmap.addRotatingHomeMarker(lat, lng, name, defaultOptions);
    console.log(`✅ Added home marker: ${name} at ${lat}, ${lng}`);
    
    if (window.MsgConsole) {
        window.MsgConsole.success(`🏠 Added: ${name}`);
    }
    
    return marker;
}

function goHome() {
    if (homeMarker) {
        homeMarker.center();
        console.log('🏠 Centered on home location');
        if (window.MsgConsole) {
            window.MsgConsole.info('🏠 Centered on home');
        }
    } else {
        console.warn('⚠️ Home marker not set');
    }
}

function centerOnLocation(lat, lng, zoom = 15) {
    if (tmap) {
        tmap.setCenter(lat, lng, zoom);
        console.log(`🎯 Map centered on ${lat}, ${lng}`);
    }
}

function testWeather() {
    if (window.weatherDashboard) {
        console.log('🧪 Testing weather with your location...');
        window.weatherDashboard.fetchWeather(17.60172258544661, 78.12699163814133);
    } else {
        console.error('❌ Weather Dashboard not found');
    }
}

function debugComponents() {
    console.log('🔍 Component Debug Information:');
    console.log('================================');
    console.log('Map (tmap):', !!tmap);
    console.log('Compass:', !!compass);
    console.log('Compass Backend:', !!compassBackend);
    console.log('Backend Connected:', compassBackend?.isConnected || false);
    console.log('Video Stream:', !!videoStream);
    console.log('Flight Controls:', !!flightControls);
    console.log('Message Console:', !!messageConsole);
    console.log('Weather Dashboard:', !!weatherDashboard);
    console.log('Waypoint Manager:', !!waypointManager);
    console.log('Mission File:', !!window.MissionFile);
    console.log('Video Maximize:', !!window.VideoMaximize);
    console.log('Home Marker:', !!homeMarker);
    console.log('================================');
    
    if (tmap) {
        console.log('Map click enabled:', tmap.clickEnabled);
        console.log('Total markers:', tmap.getMarkerCount());
        console.log('Marker coordinates:', tmap.getMarkerCoordinates());
    }
    
    if (homeMarker) {
        console.log('Home marker location:', homeMarker.lat, homeMarker.lng);
    }
    
    if (waypointManager) {
        console.log('Waypoints:', waypointManager.getWaypoints().length);
        console.log('Current mode:', waypointManager.currentMode);
    }
    
    if (compassBackend) {
        console.log('Telemetry Cache:', compassBackend.getTelemetry());
    }
}

// ============================================================================
// BACKEND CONTROL FUNCTIONS - NEW
// ============================================================================

function sendTakeoffCommand(altitude = 10) {
    if (compassBackend && compassBackend.isConnected) {
        return compassBackend.sendCommand('TAKEOFF', { altitude: altitude });
    } else {
        console.warn('⚠️  Backend not connected');
        if (window.MsgConsole) {
            window.MsgConsole.warning('Backend not connected');
        }
        return false;
    }
}

function sendLandCommand() {
    if (compassBackend && compassBackend.isConnected) {
        return compassBackend.sendCommand('LAND');
    } else {
        console.warn('⚠️  Backend not connected');
        return false;
    }
}

function sendRTLCommand() {
    if (compassBackend && compassBackend.isConnected) {
        return compassBackend.sendCommand('RTL');
    } else {
        console.warn('⚠️  Backend not connected');
        return false;
    }
}

function getBackendStatus() {
    if (!compassBackend) {
        return { connected: false, message: 'Backend not initialized' };
    }
    
    return {
        connected: compassBackend.isConnected,
        url: compassBackend.websocketUrl,
        reconnectAttempts: compassBackend.reconnectAttempts,
        telemetry: compassBackend.getTelemetry()
    };
}

// ============================================================================
// GLOBAL API
// ============================================================================

window.GCS = {
    // Component references
    map: () => tmap,
    compass: () => compass,
    backend: () => compassBackend,
    video: () => videoStream,
    flightControls: () => flightControls,
    weather: () => weatherDashboard,
    waypoints: () => waypointManager,
    home: () => homeMarker,
    
    // Utility functions
    testWeather: testWeather,
    debug: debugComponents,
    
    // Location functions
    addLocation: addCustomLocation,
    addHomeMarker: addCustomHomeMarker,
    centerOn: centerOnLocation,
    goHome: goHome,
    
    // Quick actions
    showWeather: () => window.Weather?.show(),
    hideWeather: () => window.Weather?.hide(),
    
    // Video actions
    maximizeVideo: () => window.VideoMaximize?.maximize(),
    minimizeVideo: () => window.VideoMaximize?.minimize(),
    toggleVideo: () => window.VideoMaximize?.toggle(),
    
    // Waypoint actions
    addWaypoint: () => {
        if (waypointManager) {
            waypointManager.startAddingWaypoint();
            console.log('✅ Click on map to add waypoints');
        }
    },
    clearWaypoints: () => waypointManager?.clearAllWaypoints(),
    
    // Mode switching
    enterPlanMode: () => window.PlanFlight?.enter(),
    exitPlanMode: () => window.PlanFlight?.exit(),
    
    // Backend commands - NEW
    takeoff: sendTakeoffCommand,
    land: sendLandCommand,
    rtl: sendRTLCommand,
    backendStatus: getBackendStatus,
    reconnect: () => compassBackend?.connect(),
    disconnect: () => compassBackend?.disconnect(),
    getTelemetry: () => compassBackend?.getTelemetry() || null,
};

// ============================================================================
// AUTO-START
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
} else {
    initializeApplication();
}

window.app = {
    tmap,
    compass,
    compassBackend,
    videoStream,
    flightControls,
    weatherDashboard,
    waypointManager,
    homeMarker
};

console.log('✅ Application script loaded');
console.log('');
console.log('📋 Available commands:');
console.log('  GCS.goHome()             - Center on home location');
console.log('  GCS.testWeather()        - Test weather with home location');
console.log('  GCS.debug()              - Show component status');
console.log('  GCS.addHomeMarker(lat, lng, name) - Add home marker');
console.log('  GCS.addLocation(lat, lng, name) - Add static location');
console.log('  GCS.centerOn(lat, lng)   - Center map on location');
console.log('  GCS.toggleVideo()        - Toggle video size');
console.log('  GCS.addWaypoint()        - Start waypoint mode');
console.log('');
console.log('📡 Backend Commands (NEW):');
console.log('  GCS.takeoff(altitude)    - Send takeoff command to backend');
console.log('  GCS.land()               - Send land command to backend');
console.log('  GCS.rtl()                - Send RTL command to backend');
console.log('  GCS.backendStatus()      - Get backend connection status');
console.log('  GCS.getTelemetry()       - Get current telemetry data');
console.log('  GCS.reconnect()          - Reconnect to backend');
console.log('  GCS.disconnect()         - Disconnect from backend');
console.log('');
console.log('🏠 Simple PNG Home Marker Features:');
console.log('  - Clean PNG icon display');
console.log('  - Click home marker to center map');
console.log('  - Simple shadow effect');
console.log('');
console.log('💡 TIP: Click anywhere on video to maximize/minimize!');
console.log('💡 TIP: Backend auto-connects to ws://localhost:9002');