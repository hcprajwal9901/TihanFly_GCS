const path = require('path');

const EXPORTS_MAP = {
  'js/tmap.js': ['TMap'],
  'js/waypoint-manager.js': ['WaypointManager', 'initializeWaypointManager'],
  'js/command-editor.js': ['CommandEditor', 'initializeCommandEditor'],
  'js/weather-dashboard.js': ['WeatherDashboard', 'initializeWeatherDashboard'],
  'js/waypoint-context-menu.js': ['WaypointContextMenu', 'initializeWaypointContextMenu'],
  'js/data-persistence.js': ['DataPersistence', 'initializeDataPersistence'],
  'js/flight-controls.js': ['FlightControlButtons', 'FlightModeSelector', 'ArmToggle'],
  'js/video-stream.js': ['VideoStreamController', '_initVideoStream'],
  'js/camera-controls.js': ['CameraControls', '_initCameraControls', 'setGimbalAvailable'],
  'js/analyze-tools.js': ['AnalyzeToolsPanel', 'buildAnalyzePanel', 'buildWindows'],
  'js/review-log.js': ['ReviewLog'],
  'js/login.js': ['TiHANSocket', 'socket', 'updateConnectionStatus', 'switchTab', 'handleLogin', 'handleSignup', 'approveUser', 'rejectUser', 'updateStrength', 'handleAdminLogin', 'renderUsers', 'toggleUserStatus', 'deleteUser', 'showForgot', 'handleGoogleLogin', 'closeGoogleModal'],
  'js/messaage-console.js': ['initializeMinimalConsole', 'MinimalMessageConsole'],
  'js/calib-radio.js': ['init', 'onWsMessage', 'pwmToPct'],
  'js/calib-compass.js': ['init', 'wsSend'],
  'js/calib-accel.js': ['init'],
  'js/calib-level.js': ['init'],
  'js/calib-esc.js': ['init', 'autoInit'],
  'js/failsafe.js': ['init'],
  'js/motor-test.js': ['init'],
  'js/servo-output.js': ['init'],
  'js/param-full.js': ['init'],
  'js/param-switch.js': ['init'],
  'js/i18n.js': ['init', 't', 'applyTranslations'],
  'js/dropdown-menu.js': ['DropdownMenuStrip'],
  'js/component-loader.js': ['components'],
  'js/weather-integration-helper.js': ['integrateWeatherWithMap', 'autoIntegrateWeather'],
  'js/app.js': ['initializeApplication', 'initializeMap', 'haversineDistance', 'initializeDroneWebSocket', 'initializeCompass', 'initializeVideo', 'setHeaderStatus', 'goHome', 'centerOnLocation', 'testWeather', 'initializeVideoMaximize'],
  'plan-flight-modules/plan-flight-core.js': ['PlanFlightMode', 'planFlightMode'],
  'plan-flight-modules/polygon-manager.js': ['initializePolygonManager'],
  'plan-flight-modules/polygon-backend-integration.js': ['initializePolygonExtensions'],
  'plan-flight-modules/plan-flight-mission-send.js': ['actionForWaypoint', 'handleMissionAck', 'handleFlightPlanAck', 'showSentPayloadOverlay'],
  'plan-flight-modules/plan-flight-takeoff.js': ['takeoffHere', '_showTakeoffDialog', 'setHomePosition', 'clearHome'],
  'plan-flight-modules/plan-flight-return.js': ['returnToLaunch', 'landHere'],
  'plan-flight-modules/plan-flight-center.js': ['centerMission', 'centerVehicle', 'centerHome'],
  'plan-flight-modules/plan-flight-file.js': ['ensureMissionFileManager', 'newMission', 'openMission', 'saveMission'],
  'plan-flight-modules/plan-flight-waypoint.js': ['logMarkersToConsole'],
  'plan-flight-modules/plan-flight-weather.js': ['moveWeatherToBottomLeft', 'restoreWeatherPosition', 'enableWeatherMapClick', 'fetchWeatherForPlanMode', 'updateWeatherDisplayInPlanMode', 'getWindDirection'],
  'plan-flight-modules/websocket.js': ['initWebSocket', 'sendCommand', 'sendMission', 'deliverFirmwareMessage', 'flushFirmwareQueue', 'safeSend', 'ws'],
};

module.exports = {
  process(src, filename) {
    const normalizedPath = filename.replace(/\\/g, '/');
    const isSourceFile = normalizedPath.includes('js/') || normalizedPath.includes('plan-flight-modules/');
    const isTestFile = normalizedPath.endsWith('.test.js') || normalizedPath.endsWith('setup.js');

    if (isSourceFile && !isTestFile) {
      let code = src;
      // Strip electron and ws requires that crash JSDOM/Node execution
      code = code.replace(/const\s+\{\s*ipcRenderer\s*\}\s*=\s*require\(['"]electron['"]\);?/g, '');
      code = code.replace(/const\s+ws\s*=\s*require\(['"]ws['"]\);?/g, '');

      // Inject safety IIFE scopes around bare class files to enable JSDOM re-loads without SyntaxErrors
      if (filename.includes('data-persistence.js') && !code.startsWith('(function')) {
        code = `(function() { ${code} })();`;
      }

      // Check if this file is whitelisted for exports
      const fileKey = Object.keys(EXPORTS_MAP).find(key => normalizedPath.endsWith(key));
      if (fileKey) {
        const symbols = EXPORTS_MAP[fileKey];
        console.log(`[Transformer] File: ${normalizedPath} | Whitelisted symbols: ${symbols}`);

        let suffix = '\n\n// Test compatibility layer: Expose whitelisted symbols to global/window scope\n';
        for (const name of symbols) {
          suffix += `if (typeof ${name} !== 'undefined') {\n`;
          suffix += `  if (typeof global.${name} !== 'object') { global.${name} = ${name}; }\n`;
          suffix += `  if (typeof window.${name} !== 'object') { window.${name} = ${name}; }\n`;
          suffix += `}\n`;
        }
        code += suffix;
      }

      return { code };
    }
    return { code: src };
  }
};
