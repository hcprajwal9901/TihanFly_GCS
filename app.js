/**
 * Main Application Script - app.js
 * Frontend Only (Backend/WebSocket removed)
 */

console.log('🚀 TiHANFly GCS Application Starting...');

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

var tmap = null;
var compass = null;
var videoStream = null;
var flightControls = null;
var messageConsole = null;
var weatherDashboard = null;
var waypointManager = null;
var homeMarker = null;
var droneWebSocket = null;

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

    // Step 4: Connect to backend WebSocket for live drone GPS
    initializeDroneWebSocket();

    // Note: data-persistence override guard is handled inside data-persistence.js
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

    } catch (error) {
        console.error('❌ Error initializing map:', error);
    }
}

// ============================================================================
// DRONE WEBSOCKET - Receive live GPS from backend
// ============================================================================

// Flag: true once drone is MAVLink-connected (status.connected = true)
var droneConnected = false;

// Flag: true once we get at least one real GPS fix (lat/lon non-zero)
var droneGpsActive = false;

// Flag: true once map has been snapped to the real drone position at least once.
// Prevents data-persistence.js from restoring an old saved view and overriding the drone snap.
var droneMapSnapped = false;

// Home position — set on first GPS fix, used to compute DIST on compass.
var droneHomePosition = null;  // { lat, lon }

// ── Haversine great-circle distance (metres) ─────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R  = 6371000; // Earth radius in metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a  = Math.sin(Δφ / 2) * Math.sin(Δφ / 2)
             + Math.cos(φ1) * Math.cos(φ2)
             * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initializeDroneWebSocket() {
    const WS_URL = 'ws://localhost:9002';
    const RECONNECT_DELAY_MS = 3000;

    // Tracks drone connection state — only log to console on actual changes
    let droneConnectionState = null;  // e.g. 'connected:UDP', 'disconnected'

    function connect() {
        console.log('🔌 Connecting to drone backend WebSocket...');

        droneWebSocket = new WebSocket(WS_URL);

        droneWebSocket.onopen = () => {
            console.log('✅ Drone WebSocket connected');
            setHeaderStatus('Connecting...', 'connecting');
            if (window.MsgConsole) {
                window.MsgConsole.success('🔌 Backend connected');
            }
        };

        droneWebSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // ── GPS position update ─────────────────────────────────────
                if (data.type === 'gps') {
                    const { latitude, longitude, altitude, heading } = data;

                    if (typeof latitude === 'number' && typeof longitude === 'number'
                        && (latitude !== 0 || longitude !== 0)) {

                        // ── First GPS fix — record as home position ─────────
                        if (!droneGpsActive) {
                            droneGpsActive = true;
                            droneHomePosition = { lat: latitude, lon: longitude };
                            console.log(`🏠 Home position set: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
                            setHeaderStatus('GPS Lock', 'ready');
                        }

                        // ── Snap map to drone on very first fix ─────────────
                        if (!droneMapSnapped && tmap) {
                            droneMapSnapped = true;
                            tmap._droneSetViewInProgress = true;
                            tmap.map.setView([latitude, longitude], 18, { animate: false });
                            tmap._droneSetViewInProgress = false;
                            if (typeof tmap.setDroneAutoPan === 'function') {
                                tmap.setDroneAutoPan(true);
                            } else {
                                tmap.droneAutoPan = true;
                                tmap._gpsFixCount = 0;
                            }
                            console.log(`🎯 MAP SNAPPED to drone: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
                            if (window.MsgConsole) {
                                window.MsgConsole.success(`🎯 Map locked to drone GPS`);
                            }
                        }

                        // ── Distance from home (Haversine) ──────────────────
                        let distFromHome = 0;
                        if (droneHomePosition) {
                            distFromHome = haversineDistance(
                                droneHomePosition.lat, droneHomePosition.lon,
                                latitude, longitude
                            );
                        }

                        // Update drone marker on map
                        if (tmap) {
                            tmap.updateDronePosition(latitude, longitude, heading || 0);
                        }

                        // Update compass lat/lon/alt/speed/heading/distance/satellites
                        if (compass) {
                            compass.updateTelemetry({
                                latitude,
                                longitude,
                                altitude: altitude || 0,
                                distance: distFromHome,
                                speed: typeof data.groundspeed === 'number'
                                    ? parseFloat(data.groundspeed.toFixed(1)) : undefined,
                                satellites: typeof data.satellites === 'number'
                                    ? data.satellites : undefined
                            });
                            // GPS heading takes priority over attitude yaw
                            if (typeof heading === 'number') {
                                compass.setHeading(heading);
                            }
                        }

                        console.log(`📡 GPS: lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}, alt=${(altitude||0).toFixed(1)}m, hdg=${(heading||0).toFixed(1)}°, spd=${(data.groundspeed||0).toFixed(1)}m/s, dist=${distFromHome.toFixed(0)}m`);
                    }
                }

                // ── ATTITUDE — heading/yaw available immediately on connect ─
                // Use yaw from ATTITUDE when GPS heading is not yet available.
                // att.yaw is in radians (-π to +π, North=0, clockwise positive).
                else if (data.type === 'attitude') {
                    if (compass && !droneGpsActive) {
                        // Convert radian yaw → degrees, normalise to 0–360
                        const yawDeg = ((data.yaw * 180 / Math.PI) + 360) % 360;
                        compass.setHeading(yawDeg);
                    }
                }

                // ── Real-time telemetry — VFR_HUD speed, GPS_RAW_INT sats ──
                // Accept any time drone is connected (not just after GPS lock).
                else if (data.type === 'telemetry') {
                    if (compass && droneConnected) {
                        const update = {};
                        if (typeof data.groundspeed === 'number')
                            update.speed = parseFloat(data.groundspeed.toFixed(1));
                        if (typeof data.satellites  === 'number')
                            update.satellites = data.satellites;
                        if (typeof data.altitude    === 'number')
                            update.altitude = parseFloat(data.altitude.toFixed(1));
                        if (Object.keys(update).length > 0) compass.updateTelemetry(update);
                    }
                }

                // ── Connection status update ────────────────────────────────
                else if (data.type === 'status') {
                    const connected = data.connected;
                    const connection = data.connection || 'NONE';
                    const stateKey = connected ? `connected:${connection}` : 'disconnected';

                    if (stateKey !== droneConnectionState) {
                        droneConnectionState = stateKey;

                        if (connected) {
                            droneConnected = true;
                            setHeaderStatus(`${connection}`, 'ready');
                            if (window.MsgConsole) {
                                window.MsgConsole.success(`🚁 Drone connected via ${connection}`);
                            }
                        } else {
                            droneConnected = false;
                            droneGpsActive = false;
                            droneHomePosition = null;   // clear so next connect re-captures home
                            setHeaderStatus('Waiting for Drone', 'waiting');
                            // ── Reset compass to zeros when drone goes offline ─
                            if (compass) {
                                compass.setHeading(0);
                                compass.updateTelemetry({
                                    latitude: 0, longitude: 0,
                                    altitude: 0, speed: 0,
                                    distance: 0, satellites: 0
                                });
                            }
                            if (tmap && homeMarker) {
                                droneMapSnapped = false;
                                tmap._droneSetViewInProgress = true;
                                tmap.map.setView([homeMarker.lat, homeMarker.lng], 18, { animate: true });
                                tmap._droneSetViewInProgress = false;
                            }
                            if (window.MsgConsole) {
                                window.MsgConsole.info('⏳ Waiting for drone...');
                            }
                        }
                    } else {
                        if (connected) setHeaderStatus(`${connection}`, 'ready');
                        else           setHeaderStatus('Waiting for Drone', 'waiting');
                    }
                }

                // ── Drone MAVProxy console message ──────────────────────────
                // NOTE: drone_console is handled exclusively by websocket.js
                // (plan-flight-modules/websocket.js) which is the canonical WS
                // manager. Handling it here too caused every STATUSTEXT from the
                // drone to appear TWICE in the message console.
                // else if (data.type === 'drone_console') { ... }

            } catch (e) {
                console.warn('⚠️ WS message parse error:', e);
            }
        };

        droneWebSocket.onclose = () => {
            console.warn('⚠️ Drone WebSocket disconnected. Retrying in 3s...');
            setHeaderStatus('Disconnected', 'error');
            droneConnected = false;
            droneGpsActive = false;
            droneHomePosition = null;
            droneMapSnapped = false;
            droneConnectionState = null;
            // ── Reset compass to zeros on backend disconnect ───────────────
            if (compass) {
                compass.setHeading(0);
                compass.updateTelemetry({
                    latitude: 0, longitude: 0,
                    altitude: 0, speed: 0,
                    distance: 0, satellites: 0
                });
            }
            if (window.MsgConsole) {
                window.MsgConsole.warning('🔌 Backend disconnected — reconnecting...');
            }
            // ── Snap map back to static home location ─────────────────────
            if (tmap && homeMarker) {
                tmap._droneSetViewInProgress = true;
                tmap.map.setView([homeMarker.lat, homeMarker.lng], 18, { animate: true });
                tmap._droneSetViewInProgress = false;
                console.log('🏠 GPS lost — map snapped back to home location');
            }
            droneWebSocket = null;
            setTimeout(connect, RECONNECT_DELAY_MS);
        };


        droneWebSocket.onerror = (err) => {
            console.error('❌ Drone WebSocket error:', err);
        };
    }

    connect();

    // Expose for debugging
    window.DroneWS = {
        send: (msg) => {
            if (droneWebSocket && droneWebSocket.readyState === WebSocket.OPEN) {
                droneWebSocket.send(JSON.stringify(msg));
            } else {
                console.warn('⚠️ WebSocket not connected');
            }
        },
        status: () => droneWebSocket ? droneWebSocket.readyState : 'null'
    };

    console.log('✅ Drone WebSocket handler initialized');
}



// // ============================================================================
// // STATIC LOCATIONS WITH SIMPLE PNG HOME MARKER
// // ============================================================================

// function addStaticLocations() {
//     console.log('📍 Adding static location markers...');

//     if (!tmap) {
//         console.error('❌ Map not initialized, cannot add static locations');
//         return;
//     }

//     try {
//         // Add Simple Home Marker
//         homeMarker = tmap.addRotatingHomeMarker(
//             17.60244305205114,
//             78.12687671185479,
//             'Home Location',
//             {
//                 iconSize: [80, 80],
//                 iconAnchor: [20, 40],
//                 iconUrl: 'resources/icon/home.png',
//                 labelOffset: [0, 5],
//                 permanentLabel: false,
//                 labelColor: '#FFCC00',
//             }
//         );

//         console.log('✅ Simple Home Marker added: Home Location');
//         console.log(`📍 Total markers on map: ${tmap.getMarkerCount()}`);

//         if (window.MsgConsole) {
//             window.MsgConsole.success('🏠 Home Marker loaded');
//             window.MsgConsole.info('📍 Static locations loaded');
//         }

//     } catch (error) {
//         console.error('❌ Error adding static locations:', error);
//     }
// }

// ============================================================================
// COMPASS INITIALIZATION
// ============================================================================

function initializeCompass() {
    console.log('🧭 Initializing compass...');

    try {
        compass = new CompassEnhanced('map');
        window.compass = compass;

        // Start at zero — real values arrive once the drone connects.
        // Do NOT seed with static lat/lon; that would show mock data.
        compass.updateTelemetry({
            latitude: 0,
            longitude: 0,
            altitude: 0,
            speed: 0,
            distance: 0,
            satellites: 0
        });

        console.log('✅ Compass initialized');

    } catch (error) {
        console.error('❌ Error initializing compass:', error);
    }
}

// ============================================================================
// VIDEO STREAM INITIALIZATION
// ============================================================================

function initializeVideo() {
    console.log('📹 Initializing video stream...');

    try {
        // video-stream.js exposes window.VideoStream as a plain object (not a class).
        // The old code tried to call `new VideoStream(...)` which throws.
        // UltraSmoothVideoManager auto-initialises via initializeUltraSmoothVideo()
        // which is called by video-stream.js itself on DOMContentLoaded.
        // We just store a reference here for GCS.video() to return.
        if (typeof initializeUltraSmoothVideo !== 'undefined') {
            initializeUltraSmoothVideo().then(mgr => {
                videoStream = mgr;
                window.videoStream = mgr;
                console.log('✅ Video stream manager ready');
            });
        } else {
            console.log('ℹ️ video-stream.js not loaded, skipping video initialization');
        }

        // ── Inject webcam toggle button into the video container ─────────────
        const videoContainer = document.getElementById('videoContainer');
        if (videoContainer && !document.getElementById('webcamToggleBtn')) {
            const btn = document.createElement('button');
            btn.id = 'webcamToggleBtn';
            btn.title = 'Toggle Webcam';
            btn.innerHTML = '📷 Webcam';
            btn.style.cssText = `
                position: absolute;
                top: 8px; right: 8px;
                z-index: 999;
                background: rgba(0,0,0,0.65);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.3);
                border-radius: 6px;
                padding: 4px 10px;
                font-size: 12px;
                cursor: pointer;
                backdrop-filter: blur(4px);
                transition: background 0.2s;
            `;
            btn.onmouseenter = () => btn.style.background = 'rgba(0,180,80,0.75)';
            btn.onmouseleave = () => btn.style.background = 'rgba(0,0,0,0.65)';
            btn.onclick = () => {
                window.VideoStream.toggleWebcam().then(() => {
                    const on = window.VideoStream.isWebcamActive();
                    btn.innerHTML = on ? '🔴 Stop Webcam' : '📷 Webcam';
                    btn.style.background = on
                        ? 'rgba(200,0,0,0.75)'
                        : 'rgba(0,0,0,0.65)';
                });
            };
            // Make sure the container is position:relative so absolute child works
            if (getComputedStyle(videoContainer).position === 'static')
                videoContainer.style.position = 'relative';
            videoContainer.appendChild(btn);
            console.log('✅ Webcam toggle button injected');
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


    console.log('✅ All components integrated');

    if (window.MsgConsole) {
        window.MsgConsole.success('🚁 TiHANFly GCS Ready');
        window.MsgConsole.info('🏠 Simple home marker active');
        window.MsgConsole.info('Click video to maximize - Click PLAN to enter flight planning');
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
// FLIGHT CONTROLS INTEGRATION
// ============================================================================

function integrateFlightControls() {
    console.log('🎮 Integrating Flight Controls...');

    if (!flightControls) {
        console.log('ℹ️ Flight Controls not found, skipping integration');
        return;
    }

    flightControls.onTakeoff((settings) => {
        console.log('🚀 TAKEOFF initiated:', settings);
        if (window.MsgConsole) {
            window.MsgConsole.takeoff(settings.altitude);
        }
    });

    flightControls.onLand(() => {
        console.log('🛬 LAND initiated');
        if (window.MsgConsole) {
            window.MsgConsole.land();
        }
    });

    flightControls.onRTL(() => {
        console.log('🏠 RTL initiated');
        if (window.MsgConsole) {
            window.MsgConsole.rtl();
        }
    });

    console.log('✅ Flight Controls integrated');
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

// (Demo data simulator removed — compass shows real drone data or zeros only)

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Update the header status badge text and style.
 * @param {string} text    - Label to show
 * @param {'ready'|'waiting'|'connecting'|'error'} state
 */
function setHeaderStatus(text, state = 'ready') {
    const badge = document.querySelector('.status-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'status-badge ' + state;
}

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
}

// ============================================================================
// GLOBAL API
// ============================================================================

window.GCS = {
    // Component references
    map: () => tmap,
    compass: () => compass,
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

    // Webcam actions
    startWebcam: () => window.VideoStream?.startWebcam(),
    stopWebcam: () => window.VideoStream?.stopWebcam(),
    toggleWebcam: () => window.VideoStream?.toggleWebcam(),
    isWebcamActive: () => window.VideoStream?.isWebcamActive() ?? false,

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

    // Drone GPS helpers
    centerOnDrone: () => {
        if (tmap && tmap.droneMarker) {
            const pos = tmap.droneMarker.getLatLng();
            tmap.setCenter(pos.lat, pos.lng, 18);
            console.log(`🚁 Centered on drone: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`);
        } else {
            console.warn('⚠️ No drone marker yet');
        }
    },
    droneAutoPan: (on) => tmap?.setDroneAutoPan(on),
    isDroneActive: () => droneGpsActive,
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
    videoStream,
    flightControls,
    weatherDashboard,
    waypointManager,
    homeMarker
};

console.log('✅ Application script loaded');
console.log('');
console.log('📋 Available commands:');
console.log('  GCS.goHome()                  - Center on home location');
console.log('  GCS.centerOnDrone()           - Jump map to live drone position');
console.log('  GCS.droneAutoPan(true/false)  - Toggle auto-follow drone');
console.log('  GCS.isDroneActive()           - True if real GPS is flowing');
console.log('  GCS.testWeather()             - Test weather with home location');
console.log('  GCS.debug()                   - Show component status');
console.log('  GCS.addHomeMarker(lat,lng,name) - Add home marker');
console.log('  GCS.addLocation(lat,lng,name)   - Add static location');
console.log('  GCS.centerOn(lat,lng)           - Center map on location');
console.log('  GCS.toggleVideo()               - Toggle video size');
console.log('  GCS.addWaypoint()               - Start waypoint mode');
console.log('');
console.log('🚁 Live Drone GPS:');
console.log('  - Backend sends { type:"gps", latitude, longitude, altitude, heading }');
console.log('  - Drone marker auto-created on first GPS fix');
console.log('  - Right-click drone marker to toggle auto-pan');
console.log('  - Demo simulator pauses automatically when real GPS flows');
console.log('');
console.log('💡 TIP: Click anywhere on video to maximize/minimize!');
