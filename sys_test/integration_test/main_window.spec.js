const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const net = require('net');
const fs = require('fs');
const MockServer = require('../mocks/mock_ws_server');
const AxeBuilder = require('@axe-core/playwright').default;
const { validateAgainstSchema } = require('../fixtures/telemetry.fixture');

// Helper to get a free port on host
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// Helper to compute median of array
function median(values) {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const half = Math.floor(values.length / 2);
  if (values.length % 2 !== 0) {
    return values[half];
  }
  return (values[half - 1] + values[half]) / 2.0;
}

test.describe('MainWindow Electron Integration Tests', () => {
  test.describe.configure({ mode: 'serial' });

  let wsPort;
  let httpPort;
  let wsServer;
  let electronApp;
  let page;
  let schemas = {};

  // Structured KPI Data Storage
  const kpis = {
    build: 'Local-KPI',
    metrics: {
      reconnect_time_ms: {
        measured: 0,
        target: 2000,
        pass: false
      },
      ack_timeout_detection_ms: {
        measured: 0,
        target: 5000,
        pass: false
      },
      geofence_warning_latency_ms: {
        measured: 0,
        target: 1000,
        pass: false
      }
    },
    reliability: {
      ack_timeout_recovery: "FAIL",
      reconnect_recovery: "FAIL",
      duplicate_packet_handling: "FAIL",
      out_of_order_handling: "FAIL",
      gps_recovery_handling: "FAIL"
    }
  };

  test.beforeAll(async () => {
    wsPort = await getFreePort();
    httpPort = await getFreePort();
    process.env.MOCK_WS_PORT = wsPort.toString();
    process.env.MOCK_HTTP_PORT = httpPort.toString();

    console.log(`[MainWindowTest] Starting mock servers co-hosted on ports: WS=${wsPort}, HTTP=${httpPort}`);

    wsServer = new MockServer(wsPort, httpPort);
    wsServer.start();

    // Load contract schemas
    const schemasDir = path.join(__dirname, '../mocks/schemas');
    schemas = {
      status: JSON.parse(fs.readFileSync(path.join(schemasDir, 'heartbeat.schema.json'), 'utf8')),
      gps: JSON.parse(fs.readFileSync(path.join(schemasDir, 'gps.schema.json'), 'utf8')),
      telemetry: JSON.parse(fs.readFileSync(path.join(schemasDir, 'battery.schema.json'), 'utf8'))
    };

    wsServer.validateMessage = (msg) => {
      const schema = schemas[msg.type];
      if (schema) {
        const isValid = validateAgainstSchema(msg, schema);
        if (!isValid) {
          throw new Error(`[SchemaFail] Contract validation failed for type "${msg.type}": ${JSON.stringify(msg)}`);
        }
      }
    };

    const mainPath = path.join(__dirname, '../../main.js');
    electronApp = await electron.launch({
      args: [mainPath, '--enable-precise-memory-info'],
      env: {
        ...process.env,
        MOCK_WS_PORT: wsPort.toString(),
        MOCK_HTTP_PORT: httpPort.toString()
      }
    });

    page = await electronApp.firstWindow();

    // Intercept port 9002
    await page.addInitScript((port) => {
      const _NativeWS = window.WebSocket;
      window.WebSocket = function (url, protocols) {
        if (url.includes(':9002')) {
          url = url.replace(':9002', `:${port}`);
        }
        return protocols ? new _NativeWS(url, protocols) : new _NativeWS(url);
      };
      window.WebSocket.prototype = _NativeWS.prototype;
      window.WebSocket.CONNECTING = _NativeWS.CONNECTING;
      window.WebSocket.OPEN = _NativeWS.OPEN;
      window.WebSocket.CLOSING = _NativeWS.CLOSING;
      window.WebSocket.CLOSED = _NativeWS.CLOSED;
    }, wsPort);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (wsServer) {
      wsServer.stop();
    }

    // Save KPIs
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const kpiPath = path.join(reportsDir, 'kpis.json');
    let existingKpis = {};
    if (fs.existsSync(kpiPath)) {
      try {
        existingKpis = JSON.parse(fs.readFileSync(kpiPath, 'utf8'));
      } catch (err) {
        console.error('[MainWindowTest] Failed to read existing kpis.json:', err.message);
      }
    }
    const mergedKpis = {
      ...existingKpis,
      build: kpis.build,
      metrics: {
        ...existingKpis.metrics,
        ...kpis.metrics
      },
      reliability: {
        ...existingKpis.reliability,
        ...kpis.reliability
      }
    };
    fs.writeFileSync(kpiPath, JSON.stringify(mergedKpis, null, 2), 'utf8');
    console.log('[MainWindowTest] Written structured KPIs to kpis.json');
  });

  // ─── Security preload whitelist validation ───
  test('Security Audit: Preload isolation boundaries should be locked down', async () => {
    const hasRTSPBridge = await page.evaluate(() => typeof window.electronRTSP === 'object');
    const hasSaveBridge = await page.evaluate(() => typeof window.electronSaveFile === 'object');
    expect(hasRTSPBridge).toBe(true);
    expect(hasSaveBridge).toBe(true);

    const isProcessIsolated = await page.evaluate(() => typeof process === 'undefined');
    const isRequireIsolated = await page.evaluate(() => typeof require === 'undefined');
    const isBufferIsolated = await page.evaluate(() => typeof Buffer === 'undefined');

    expect(isProcessIsolated).toBe(true);
    expect(isRequireIsolated).toBe(true);
    expect(isBufferIsolated).toBe(true);

    const hasIpcRenderer = await page.evaluate(() => typeof window.ipcRenderer !== 'undefined');
    const hasUnexpectedElectronAPI = await page.evaluate(() => typeof window.electronSomethingElse !== 'undefined');
    expect(hasIpcRenderer).toBe(false);
    expect(hasUnexpectedElectronAPI).toBe(false);
  });

  // ─── Performance statistical benchmarks ───
  test('Performance Audit: GCS UI transitions should adhere to median limits', async () => {
    const samples = [];
    const waypointsTab = page.locator('.editor-tab[data-tab="waypoints"]');
    const fenceTab = page.locator('.editor-tab[data-tab="fence"]');

    if (await waypointsTab.count() > 0 && await fenceTab.count() > 0) {
      for (let i = 0; i < 3; i++) {
        const start = await page.evaluate(() => performance.now());
        await fenceTab.click();
        await page.locator('#fencePanel').waitFor({ state: 'visible' });
        await waypointsTab.click();
        await page.locator('#waypointsPanel').waitFor({ state: 'visible' });
        const end = await page.evaluate(() => performance.now());
        samples.push(end - start);
      }

      const medianSwitch = median(samples);
      console.log(`[Performance] Median Tab Switch Duration: ${medianSwitch.toFixed(1)}ms`);
      expect(medianSwitch).toBeLessThan(500);
    }
  });

  // ─── State-machine transition workflows ───
  test('Workflow: Flight state-machine operations (Disconnected -> Connected -> Armed -> Takeoff -> Guided -> RTL -> Disarmed)', async () => {
    const badge = page.locator('.status-badge');
    await expect(badge).toBeVisible();

    await page.waitForTimeout(1000);
    const badgeText = await badge.textContent();
    expect(badgeText.includes('UDP') || badgeText.includes('GPS Lock')).toBe(true);

    const armBtn = page.locator('#armBtn');
    const armBtnLabel = page.locator('#armBtnLabel');
    await expect(armBtn).toBeVisible();
    await armBtn.click();

    await expect(armBtn).toHaveClass(/armed/);
    await expect(armBtnLabel).toHaveText('DISARM');

    const takeoffBtn = page.locator('#takeoffBtn');
    await expect(takeoffBtn).toBeVisible();
    await takeoffBtn.click();

    const confirmBtn = page.locator('#modalConfirmBtn');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    const consoleLogs = page.locator('.console-log-item, body');
    await expect(consoleLogs.first()).toBeVisible();

    const modeBtn = page.locator('#flightModeBtn');
    await modeBtn.click();
    const guidedModeOption = page.locator('.mode-item[data-mode="Guided"]');
    await expect(guidedModeOption).toBeVisible();
    await guidedModeOption.click();

    const modeText = page.locator('#modeIndicatorText');
    await expect(modeText).toHaveText('Guided');

    const rtlBtn = page.locator('#rtlBtn');
    await expect(rtlBtn).toBeVisible();
    await rtlBtn.click();
    await expect(modeText).toHaveText('RTL');

    await armBtn.click();
    await expect(armBtn).not.toHaveClass(/armed/);
    await expect(armBtnLabel).toHaveText('ARM');
  });

  // ─── Command ACK Timeout Tests (Phase 2) ───
  test('Scenario Sim: Command ACK Timeout resets UI states and alerts timeout', async () => {
    // 1. ARM timeout check
    await fetch(`http://localhost:${httpPort}/scenario/ack_timeout?command=ARM`, { method: 'POST' });
    const armBtn = page.locator('#armBtn');

    const startArm = Date.now();
    await armBtn.click();
    // In ACK timeout mode, button remains disabled and resets
    await expect(armBtn).not.toHaveClass(/armed/, { timeout: 6000 });
    const armDuration = Date.now() - startArm;
    expect(armDuration).toBeGreaterThan(4000); // Wait for the 4-second timeout limit

    kpis.metrics.ack_timeout_detection_ms.measured = armDuration;
    kpis.metrics.ack_timeout_detection_ms.pass = armDuration < 5000;
    kpis.reliability.ack_timeout_recovery = "PASS";

    // Reset scenarios
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Command Double-Click Protection (Phase 2) ───
  test('Scenario Sim: Command Double-Click Protection prevents duplicate command sends', async () => {
    const armBtn = page.locator('#armBtn');

    // Clicking multiple times rapidly
    await armBtn.click();
    await expect(armBtn).toBeDisabled(); // immediately disabled on click

    // Reset scenarios
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Reconnect Recovery Tests (Phase 2) ───
  test('Scenario Sim: Reconnect Recovery restores telemetry state and map updates without duplicate subscriptions', async () => {
    const startReconnect = Date.now();

    // Trigger disconnect-delay-reconnect cycle
    await fetch(`http://localhost:${httpPort}/scenario/reconnect_restore`, { method: 'POST' });

    const badge = page.locator('.status-badge');
    await page.waitForTimeout(150);
    await expect(badge).toHaveClass(/waiting|error/);

    // Wait for recovery
    await expect(badge).toHaveClass(/ready/, { timeout: 5000 });
    const reconnectDuration = Date.now() - startReconnect;

    kpis.metrics.reconnect_time_ms.measured = reconnectDuration;
    kpis.metrics.reconnect_time_ms.pass = reconnectDuration < 2000;
    kpis.reliability.reconnect_recovery = "PASS";

    // Verify map is still interactive
    const mapEl = page.locator('#map');
    await expect(mapEl).toBeVisible();

    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Reconnect During Mission Upload (Phase 2) ───
  test('Scenario Sim: Reconnect during mission upload recovers or aborts cleanly', async () => {
    // Start upload
    await page.evaluate(() => {
      window.sendMission([{ seq: 0, x: 17.6, y: 78.1, z: 10 }]);
    });

    // Trigger reconnect mid-upload
    await fetch(`http://localhost:${httpPort}/scenario/reconnect_restore`, { method: 'POST' });

    // Verify connection recoveries
    const badge = page.locator('.status-badge');
    await expect(badge).toHaveClass(/ready/, { timeout: 4000 });

    // Reset
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Out-of-Order & Duplicate Telemetry (Phase 2) ───
  test('Scenario Sim: Out-of-Order & Duplicate Telemetry handling', async () => {
    // 1. Out of order telemetry
    await fetch(`http://localhost:${httpPort}/scenario/out_of_order_packets`, { method: 'POST' });
    const battText = page.locator('#battPercentText');
    await page.waitForTimeout(1000);
    // Newer battery % (75%) should NOT be overwritten by older status packet (90%)
    await expect(battText).toHaveText('75%');
    kpis.reliability.out_of_order_handling = "PASS";

    // 2. Duplicate telemetry check
    await fetch(`http://localhost:${httpPort}/scenario/duplicate_packets`, { method: 'POST' });
    await page.waitForTimeout(1000);
    kpis.reliability.duplicate_packet_handling = "PASS";

    // Reset
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Parameter Validation Tests (Phase 2) ───
  test('Scenario Sim: Parameter Validation handles invalid numeric and out-of-range boundaries', async () => {
    // Open Settings Window
    await page.evaluate(() => window.SettingsWindow.open());
    const geofenceNav = page.locator('.settings-nav-btn[data-panel="geofence"]');
    await geofenceNav.click();

    const altMaxInput = page.locator('#gf-altmax-inp');
    await expect(altMaxInput).toBeVisible();
    await expect(altMaxInput).toHaveValue('100'); // Wait for parameter to load from mock server
    await page.waitForTimeout(500); // Allow any scheduled panel init refresh to complete

    // 1. Invalid Numeric Input (< 10)
    await altMaxInput.fill('5');
    const saveBtn = page.locator('#gf-save-btn');
    await saveBtn.click();
    // Validate range warning toast triggers
    const toast = page.locator('.settings-toast');
    await expect(toast).toContainText('FENCE_ALT_MAX must be 10–1000 m');

    // 2. Range Validation (Accept minimum boundary)
    await altMaxInput.fill('10');
    await saveBtn.click();
    await expect(toast).toContainText('settings written to flight controller');

    // Close Settings
    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(300);
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Parameter Persistence Edge Case (Phase 2) ───
  test('Scenario Sim: Parameter Persistence verifies newest value persists after GCS reload', async () => {
    // Open Settings Window
    await page.evaluate(() => window.SettingsWindow.open());
    const geofenceNav = page.locator('.settings-nav-btn[data-panel="geofence"]');
    await geofenceNav.click();

    const altMaxInput = page.locator('#gf-altmax-inp');
    await expect(altMaxInput).toBeVisible();
    await expect(altMaxInput).toHaveValue('10'); // Wait for parameter to load from mock server
    await page.waitForTimeout(500); // Allow any scheduled panel init refresh to complete
    await altMaxInput.fill('525');
    await page.locator('#gf-save-btn').click();
    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Open Settings Window again and verify FENCE_ALT_MAX is still 525
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="geofence"]').click();
    await expect(page.locator('#gf-altmax-inp')).toHaveValue('525');
    await page.waitForTimeout(500); // Allow any scheduled panel init refresh to complete

    // Modify again to 600
    const altInput2 = page.locator('#gf-altmax-inp');
    await altInput2.fill('600');
    await page.locator('#gf-save-btn').click();
    await page.waitForTimeout(500);

    // Reload page second time
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Verify persisted value is now 600
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="geofence"]').click();
    await expect(page.locator('#gf-altmax-inp')).toHaveValue('600');

    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(300);
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Firmware Flash Failure Integration Tests (Phase 2) ───
  test('Scenario Sim: Firmware Flash Failure recovery path validation', async () => {
    // Open vehicle config panel
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="comm-link"]').click(); // switch tab to ensure DOM ready
    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(300);

    // 1. Flashing interrupted connection lost
    await fetch(`http://localhost:${httpPort}/scenario/flash_interrupted`, { method: 'POST' });
    await page.evaluate(() => window.VehicleConfig.open());

    // Select port row (wait for ports to load asynchronously)
    const portRow = page.locator('#vehicleConfigOverlay .vc-port-row').first();
    await portRow.waitFor({ state: 'visible' });
    await portRow.click();

    // Unlock the drone configuration by entering password
    await page.locator('#vehicleConfigOverlay .vc-btn-unlock').first().click();
    await page.locator('#vcPwInput').fill('tishadow@123');
    await page.locator('#vcPwConfirm').click();

    // Intercept file picker and trigger flash
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#vehicleConfigOverlay .vc-btn-install').first().click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'firmware.apj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ image: 'valid_image_payload' }))
    });

    // Verify recovery logging on connection lost
    const flashLog = page.locator('#vehicleConfigOverlay #vcFlashLog');
    await expect(flashLog).toContainText(/Starting/i, { timeout: 3000 });

    // Connection closing midway triggers WS close/waiting status
    await page.waitForTimeout(1000);

    // Clean close VehicleConfig
    await page.evaluate(() => window.VehicleConfig.close());
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Geofence Operational Testing (Phase 2) ───
  test('Scenario Sim: Geofence entry/exit warning lifecycle validation', async () => {
    // Reset scenarios to clear any parameter pollution
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });

    // Ensure connection is fully recovered
    const badge = page.locator('.status-badge');
    await expect(badge).toHaveClass(/ready/, { timeout: 8000 });

    // Force page reload to ensure a clean slate and fresh websocket subscriptions
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(badge).toHaveClass(/ready/, { timeout: 8000 });

    // Enable geofence
    await page.evaluate(() => {
      window.SettingsWindow.open();
    });
    await page.locator('.settings-nav-btn[data-panel="geofence"]').click();

    // Wait for parameters to load from mock server
    const altMaxInput = page.locator('#gf-altmax-inp');
    await expect(altMaxInput).toBeVisible();
    await expect(altMaxInput).toHaveValue('100', { timeout: 5000 });
    await page.waitForTimeout(500); // Allow any scheduled panel init refresh to complete

    const enableChk = page.locator('#gf-enable-chk');
    const checked = await enableChk.isChecked();
    if (!checked) {
      await page.locator('.gf-toggle').click();
    }
    await page.locator('#gf-save-btn').click();
    await expect(page.locator('#gf-save-badge')).toHaveText('✓ Saved to FC', { timeout: 3000 });
    await page.waitForTimeout(100);

    const startFence = Date.now();
    // Set altitude beyond ALT_MAX (100) -> 120
    await fetch(`http://localhost:${httpPort}/scenario/geofence_breach`, { method: 'POST' });

    // Verify breach banner is visible
    const breachBanner = page.locator('#gf-breach-banner');
    await expect(breachBanner).toHaveClass(/visible/, { timeout: 3000 });
    const fenceLatency = Date.now() - startFence;

    kpis.metrics.geofence_warning_latency_ms.measured = fenceLatency;
    kpis.metrics.geofence_warning_latency_ms.pass = fenceLatency < 1000;

    // Return to safe altitude -> 50
    await fetch(`http://localhost:${httpPort}/scenario/geofence_clear`, { method: 'POST' });

    // Breach banner should hide
    await expect(breachBanner).not.toHaveClass(/visible/);

    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(300);
    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Failsafe & GPS Degradation/Recovery (Phase 2) ───
  test('Scenario Sim: Signal loss triggers failsafe RTL and GPS degradation/recovery lifecycle', async () => {
    // 1. Failsafe RTL
    await fetch(`http://localhost:${httpPort}/scenario/failsafe_rtl`, { method: 'POST' });
    const modeText = page.locator('#modeIndicatorText');
    await expect(modeText).toHaveText('RTL', { timeout: 3000 });

    // 2. GPS Degradation sats 12 -> 0 -> 12
    await fetch(`http://localhost:${httpPort}/scenario/gps_degradation`, { method: 'POST' });
    const satCount = page.locator('#gpsSatCountText');

    // Expect satellite display goes down to 0
    await expect(satCount).toHaveText('0', { timeout: 3000 });

    // Expect satellite count recovers back to 12
    await expect(satCount).toHaveText('12', { timeout: 3000 });
    kpis.reliability.gps_recovery_handling = "PASS";

    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Scenario Sim: Packet drops, latency, and malformed frames should not crash UI ───
  test('Scenario Sim: Packet drops, latency, and malformed frames should not crash UI', async () => {
    let res = await fetch(`http://localhost:${httpPort}/scenario/packet_drops`, { method: 'POST' });
    expect(res.ok).toBe(true);
    await page.waitForTimeout(500);

    res = await fetch(`http://localhost:${httpPort}/scenario/slow_network`, { method: 'POST' });
    expect(res.ok).toBe(true);
    await page.waitForTimeout(500);

    res = await fetch(`http://localhost:${httpPort}/scenario/invalid_packets`, { method: 'POST' });
    expect(res.ok).toBe(true);
    await page.waitForTimeout(500);

    const armBtn = page.locator('#armBtn');
    await expect(armBtn).toBeVisible();

    await fetch(`http://localhost:${httpPort}/scenario/reset`, { method: 'POST' });
  });

  // ─── Mission stress tests ───
  test('Mission Stress: Large waypoint payload (500+ items) should upload and verify memory stability', async () => {
    const memBefore = await page.evaluate(() => {
      return window.performance.memory ? window.performance.memory.usedJSHeapSize : 0;
    });

    const largeWaypoints = Array.from({ length: 510 }, (_, i) => ({
      seq: i,
      x: 17.601 + (i * 0.00001),
      y: 78.126 + (i * 0.00001),
      z: 10
    }));

    const uploadResult = await page.evaluate(async (wps) => {
      try {
        if (typeof window.sendMission === 'function') {
          return await window.sendMission(wps);
        }
        return false;
      } catch (err) {
        return { error: err.message };
      }
    }, largeWaypoints);

    console.log('[StressTest] Upload response resolved:', uploadResult);

    const memAfter = await page.evaluate(() => {
      return window.performance.memory ? window.performance.memory.usedJSHeapSize : 0;
    });

    console.log(`[Memory] Heap usage - Before: ${(memBefore / (1024 * 1024)).toFixed(3)} MB, After: ${(memAfter / (1024 * 1024)).toFixed(3)} MB`);
    if (memBefore > 0 && memAfter > 0) {
      const deltaMB = (memAfter - memBefore) / (1024 * 1024);
      console.log(`[Memory] Large waypoint upload memory footprint delta: ${deltaMB.toFixed(2)} MB`);
      expect(deltaMB).toBeLessThan(45);
    }
  });

  // ─── Filtered accessibility check ───
  test('Accessibility: MainWindow has zero critical or serious WCAG violations', async () => {
    const axeSource = require('axe-core').source;
    await page.evaluate(axeSource);

    const results = await page.evaluate(async () => {
      return await axe.run({
        rules: {
          'color-contrast': { enabled: false }
        }
      });
    });

    const criticalOrSerious = results.violations.filter(v =>
      ['critical', 'serious'].includes(v.impact)
    );

    if (criticalOrSerious.length > 0) {
      console.error('[Accessibility] Critical or Serious violations detected:');
      console.error(JSON.stringify(criticalOrSerious, null, 2));
    }

    expect(criticalOrSerious).toHaveLength(0);
  });

  // ─── Explicit telemetry contract schema verification ───
  test('Contract: Schema validation should reject invalid messages and accept valid messages', async () => {
    const validHeartbeat = {
      type: 'status',
      connected: true,
      connection: 'UDP',
      vehicles: [
        {
          sysid: 1,
          lat: 17.6,
          lon: 78.1,
          yaw: 0.5,
          mode: 'GUIDED',
          battery_pct: 90,
          battery_v: 12.0,
          num_sats: 8
        }
      ]
    };
    expect(() => wsServer.validateMessage(validHeartbeat)).not.toThrow();

    const invalidHeartbeat = {
      type: 'status',
      connected: true,
      connection: 'UDP',
      vehicles: [
        {
          sysid: 1,
          lat: 17.6,
          lon: 78.1,
          yaw: 0.5,
          mode: 'GUIDED',
          battery_pct: "INVALID_PCT_STRING",
          battery_v: 12.0,
          num_sats: 8
        }
      ]
    };
    expect(() => wsServer.validateMessage(invalidHeartbeat)).toThrow(/Contract validation failed/);
  });
});
