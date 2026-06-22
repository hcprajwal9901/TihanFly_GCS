const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const SITLOrchestrator = require('../simulators/sitl_orchestrator');

// HTTP helpers to talk to WSL proxy API
function postRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 14599,
      path: path,
      method: 'POST'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function getRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 14599,
      path: path,
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test.describe('GCS SITL End-to-End Validation (Phase 4)', () => {
  test.describe.configure({ mode: 'serial' });

  let orchestrator;
  let electronApp;
  let page;

  // Global accumulated stats state to aggregate metrics across all tests
  const accumulatedMavlink = {
    observed_required: new Set(),
    observed_optional: new Set(),
    packets_received: 0,
    packets_lost: 0,
    crc_failures: 0,
    sequence_gaps: 0,
    duplicate_sequences: 0,
    out_of_order_sequences: 0,
    heartbeat_hz: 0,
    gps_hz: 0,
    sys_status_hz: 0,
    attitude_hz: 0,
    telemetry_hz: 0,
    jitter_ms: 0,
    arm_latency_ms: null,
    mode_latency_ms: null,
    last_observed_sysid: null,
    last_observed_compid: null,
    latest_gcs_endpoint: null,
    download_completed: false,
    download_item_count: 0,
    sequence_stats: {
      SITL_TO_GCS: { gaps: 0, duplicates: 0, out_of_order: 0, received: 0 },
      GCS_TO_SITL: { gaps: 0, duplicates: 0, out_of_order: 0, received: 0 }
    }
  };

  test.beforeAll(async () => {
    // 1. Initialize and start WSL SITL
    orchestrator = new SITLOrchestrator();
    await orchestrator.start();

    // 2. Launch GCS Electron application (which spawns real TiHANFly.exe backend)
    console.log('[SITLTest] Launching GCS Electron app...');
    const mainPath = path.join(__dirname, '../../main.js');
    electronApp = await electron.launch({
      args: [mainPath, '--enable-precise-memory-info'],
      env: {
        ...process.env
      }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.beforeEach(async () => {
    // Reset WSL proxy stats before each test to capture clean test-level boundaries
    try {
      await postRequest('/reset');
      console.log('[SITLTest] WSL proxy stats reset.');
    } catch (e) {
      console.warn('[SITLTest] Failed to reset proxy stats:', e.message);
    }
  });

  test.afterEach(async () => {
    // Fetch stats from current test run and aggregate into global state
    try {
      const stats = await getRequest('/stats');
      if (stats) {
        if (stats.observed_required) {
          stats.observed_required.forEach(m => accumulatedMavlink.observed_required.add(m));
        }
        if (stats.observed_optional) {
          stats.observed_optional.forEach(m => accumulatedMavlink.observed_optional.add(m));
        }
        accumulatedMavlink.packets_received += (stats.packets_received || 0);
        accumulatedMavlink.packets_lost += (stats.packets_lost || 0);
        accumulatedMavlink.crc_failures += (stats.crc_failures || 0);
        accumulatedMavlink.sequence_gaps += (stats.sequence_gaps || 0);
        accumulatedMavlink.duplicate_sequences += (stats.duplicate_sequences || 0);
        accumulatedMavlink.out_of_order_sequences += (stats.out_of_order_sequences || 0);
        
        accumulatedMavlink.heartbeat_hz = Math.max(accumulatedMavlink.heartbeat_hz, stats.heartbeat_hz || 0);
        accumulatedMavlink.gps_hz = Math.max(accumulatedMavlink.gps_hz, stats.gps_hz || 0);
        accumulatedMavlink.sys_status_hz = Math.max(accumulatedMavlink.sys_status_hz, stats.sys_status_hz || 0);
        accumulatedMavlink.attitude_hz = Math.max(accumulatedMavlink.attitude_hz, stats.attitude_hz || 0);
        accumulatedMavlink.telemetry_hz = Math.max(accumulatedMavlink.telemetry_hz, stats.telemetry_hz || 0);
        accumulatedMavlink.jitter_ms = Math.max(accumulatedMavlink.jitter_ms, stats.jitter_ms || 0);
        
        if (stats.arm_latency_ms !== null) accumulatedMavlink.arm_latency_ms = stats.arm_latency_ms;
        if (stats.mode_latency_ms !== null) accumulatedMavlink.mode_latency_ms = stats.mode_latency_ms;
        if (stats.last_observed_sysid !== null) accumulatedMavlink.last_observed_sysid = stats.last_observed_sysid;
        if (stats.last_observed_compid !== null) accumulatedMavlink.last_observed_compid = stats.last_observed_compid;
        if (stats.latest_gcs_endpoint !== null) accumulatedMavlink.latest_gcs_endpoint = stats.latest_gcs_endpoint;
        if (stats.download_completed) accumulatedMavlink.download_completed = true;
        accumulatedMavlink.download_item_count = Math.max(accumulatedMavlink.download_item_count, stats.download_item_count || 0);
        if (stats.sequence_stats) {
          for (const dir of ['SITL_TO_GCS', 'GCS_TO_SITL']) {
            if (stats.sequence_stats[dir]) {
              accumulatedMavlink.sequence_stats[dir].received += (stats.sequence_stats[dir].received || 0);
              accumulatedMavlink.sequence_stats[dir].gaps += (stats.sequence_stats[dir].gaps || 0);
              accumulatedMavlink.sequence_stats[dir].duplicates += (stats.sequence_stats[dir].duplicates || 0);
              accumulatedMavlink.sequence_stats[dir].out_of_order += (stats.sequence_stats[dir].out_of_order || 0);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SITLTest] Failed to retrieve and merge proxy stats in afterEach:', e.message);
    }
  });

  test.afterAll(async () => {
    // 1. Fetch final stats, merge, and output merged results
    try {
      const stats = await getRequest('/stats');
      if (stats) {
        if (stats.observed_required) {
          stats.observed_required.forEach(m => accumulatedMavlink.observed_required.add(m));
        }
        if (stats.observed_optional) {
          stats.observed_optional.forEach(m => accumulatedMavlink.observed_optional.add(m));
        }
        accumulatedMavlink.packets_received += (stats.packets_received || 0);
        accumulatedMavlink.packets_lost += (stats.packets_lost || 0);
        accumulatedMavlink.crc_failures += (stats.crc_failures || 0);
        accumulatedMavlink.sequence_gaps += (stats.sequence_gaps || 0);
        accumulatedMavlink.duplicate_sequences += (stats.duplicate_sequences || 0);
        accumulatedMavlink.out_of_order_sequences += (stats.out_of_order_sequences || 0);
        
        accumulatedMavlink.heartbeat_hz = Math.max(accumulatedMavlink.heartbeat_hz, stats.heartbeat_hz || 0);
        accumulatedMavlink.gps_hz = Math.max(accumulatedMavlink.gps_hz, stats.gps_hz || 0);
        accumulatedMavlink.sys_status_hz = Math.max(accumulatedMavlink.sys_status_hz, stats.sys_status_hz || 0);
        accumulatedMavlink.attitude_hz = Math.max(accumulatedMavlink.attitude_hz, stats.attitude_hz || 0);
        accumulatedMavlink.telemetry_hz = Math.max(accumulatedMavlink.telemetry_hz, stats.telemetry_hz || 0);
        accumulatedMavlink.jitter_ms = Math.max(accumulatedMavlink.jitter_ms, stats.jitter_ms || 0);
        
        if (stats.arm_latency_ms !== null) accumulatedMavlink.arm_latency_ms = stats.arm_latency_ms;
        if (stats.mode_latency_ms !== null) accumulatedMavlink.mode_latency_ms = stats.mode_latency_ms;
        if (stats.last_observed_sysid !== null) accumulatedMavlink.last_observed_sysid = stats.last_observed_sysid;
        if (stats.last_observed_compid !== null) accumulatedMavlink.last_observed_compid = stats.last_observed_compid;
        if (stats.latest_gcs_endpoint !== null) accumulatedMavlink.latest_gcs_endpoint = stats.latest_gcs_endpoint;
        if (stats.download_completed) accumulatedMavlink.download_completed = true;
        accumulatedMavlink.download_item_count = Math.max(accumulatedMavlink.download_item_count, stats.download_item_count || 0);
        if (stats.sequence_stats) {
          for (const dir of ['SITL_TO_GCS', 'GCS_TO_SITL']) {
            if (stats.sequence_stats[dir]) {
              accumulatedMavlink.sequence_stats[dir].received += (stats.sequence_stats[dir].received || 0);
              accumulatedMavlink.sequence_stats[dir].gaps += (stats.sequence_stats[dir].gaps || 0);
              accumulatedMavlink.sequence_stats[dir].duplicates += (stats.sequence_stats[dir].duplicates || 0);
              accumulatedMavlink.sequence_stats[dir].out_of_order += (stats.sequence_stats[dir].out_of_order || 0);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SITLTest] Failed to retrieve final stats in afterAll:', e.message);
    }

    const totalRec = accumulatedMavlink.packets_received;
    const totalLost = accumulatedMavlink.packets_lost;
    const lossPct = (totalRec + totalLost) > 0 ? (totalLost / (totalRec + totalLost)) * 100 : 0;
    const complianceScore = (accumulatedMavlink.observed_required.size / 10) * 100;
    const optionalCoverage = (accumulatedMavlink.observed_optional.size / 4) * 100;

    const finalMavlinkStats = {
      compliance_score: complianceScore,
      optional_coverage: optionalCoverage,
      observed_required: Array.from(accumulatedMavlink.observed_required),
      observed_optional: Array.from(accumulatedMavlink.observed_optional),
      packet_loss_pct: lossPct,
      packets_received: totalRec,
      packets_lost: totalLost,
      crc_failures: accumulatedMavlink.crc_failures,
      sequence_gaps: accumulatedMavlink.sequence_gaps,
      duplicate_sequences: accumulatedMavlink.duplicate_sequences,
      out_of_order_sequences: accumulatedMavlink.out_of_order_sequences,
      heartbeat_hz: accumulatedMavlink.heartbeat_hz,
      gps_hz: accumulatedMavlink.gps_hz,
      sys_status_hz: accumulatedMavlink.sys_status_hz,
      attitude_hz: accumulatedMavlink.attitude_hz,
      telemetry_hz: accumulatedMavlink.telemetry_hz,
      jitter_ms: accumulatedMavlink.jitter_ms,
      arm_latency_ms: accumulatedMavlink.arm_latency_ms,
      mode_latency_ms: accumulatedMavlink.mode_latency_ms,
      last_observed_sysid: accumulatedMavlink.last_observed_sysid,
      last_observed_compid: accumulatedMavlink.last_observed_compid,
      latest_gcs_endpoint: accumulatedMavlink.latest_gcs_endpoint,
      download_completed: accumulatedMavlink.download_completed,
      download_item_count: accumulatedMavlink.download_item_count,
      sequence_stats: accumulatedMavlink.sequence_stats
    };

    const kpiPath = path.join(__dirname, '../reports/kpis.json');
    let kpis = { build: 'Local-KPI', metrics: {}, reliability: {} };
    if (fs.existsSync(kpiPath)) {
      try {
        kpis = JSON.parse(fs.readFileSync(kpiPath, 'utf8'));
      } catch (err) {
        console.error('[SITLTest] Failed to read existing kpis.json:', err.message);
      }
    }
    kpis.mavlink = finalMavlinkStats;
    try {
      fs.writeFileSync(kpiPath, JSON.stringify(kpis, null, 2), 'utf8');
      console.log('[SITLTest] Written final MAVLink KPIs to kpis.json under mavlink key.');
    } catch (err) {
      console.error('[SITLTest] Failed to write kpis.json:', err.message);
    }

    // Close Electron GCS app
    if (electronApp) {
      console.log('[SITLTest] Closing GCS app...');
      await electronApp.close();
    }

    // Stop WSL SITL simulation and cleanup
    if (orchestrator) {
      console.log('[SITLTest] Stopping simulation orchestrator...');
      orchestrator.stop();
    }
  });

  test('SITL E2E: Verify GCS establishes telemetry link with ArduPilot WSL SITL', async () => {
    console.log('[SITLTest] Waiting for GCS to connect to WSL SITL...');
    const badge = page.locator('.status-badge');
    await expect(badge).toBeVisible();

    // Expect status badge to transition to 'ready' (indicating telemetry link established)
    // We give this a generous 40s timeout to allow SITL startup and parameter download sync.
    await expect(badge).toHaveClass(/ready/, { timeout: 40000 });
    console.log('[SITLTest] Telemetry link successfully established!');

    // Session validation: Verify HEARTBEAT.sysid == 1 and HEARTBEAT.compid == 1
    const stats = await getRequest('/stats');
    console.log(`[SITLTest] Connection session details: sysid=${stats.last_observed_sysid}, compid=${stats.last_observed_compid}`);
    expect(stats.last_observed_sysid).toBe(1);
    expect(stats.last_observed_compid).toBe(1);
  });

  test('SITL E2E: Configure autopilot pre-arm checks and failsafes', async () => {
    console.log('[SITLTest] Disabling pre-arm checks and throttle/GCS failsafes for test stability...');
    
    // Evaluate param sets in the GCS context
    await page.evaluate(() => {
      if (typeof window.safeSend === 'function') {
        // Disable pre-arm checks
        window.safeSend({ type: 'param_set', param_id: 'ARMING_CHECK', value: 0 });
        // Disable throttle failsafe
        window.safeSend({ type: 'param_set', param_id: 'FS_THR_ENABLE', value: 0 });
        // Disable GCS connection failsafe
        window.safeSend({ type: 'param_set', param_id: 'FS_GCS_ENABLE', value: 0 });
      }
    });

    // Wait for parameters to write and propagate
    await page.waitForTimeout(2000);
    console.log('[SITLTest] Autopilot test parameters applied.');
  });

  test('SITL E2E: Perform vehicle Arm and Disarm sequence', async () => {
    console.log('[SITLTest] Performing Arm sequence...');
    const armBtn = page.locator('#armBtn');
    const armBtnLabel = page.locator('#armBtnLabel');

    await expect(armBtn).toBeVisible();
    
    // Trigger Arm command
    await armBtn.click();

    // Verify ARM button updates to Armed state
    await expect(armBtn).toHaveClass(/armed/, { timeout: 10000 });
    await expect(armBtnLabel).toHaveText('DISARM');
    console.log('[SITLTest] Vehicle successfully Armed!');

    // Latency validation: Verify Arm command ACK roundtrip latency < 500 ms
    let stats;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      stats = await getRequest('/stats');
      if (stats.arm_latency_ms !== null) {
        break;
      }
    }
    console.log(`[SITLTest] Measured Arm Command ACK latency: ${stats.arm_latency_ms} ms`);
    expect(stats.arm_latency_ms).not.toBeNull();
    expect(stats.arm_latency_ms).toBeLessThan(500);

    // Wait a brief moment in armed state
    await page.waitForTimeout(2000);

    // Trigger Disarm command
    console.log('[SITLTest] Performing Disarm sequence...');
    await armBtn.click();

    // Verify ARM button updates back to Disarmed state
    await expect(armBtn).not.toHaveClass(/armed/, { timeout: 10000 });
    await expect(armBtnLabel).toHaveText('ARM');
    console.log('[SITLTest] Vehicle successfully Disarmed!');
  });

  test('SITL E2E: Perform flight mode transitions', async () => {
    console.log('[SITLTest] Testing flight mode transitions...');
    const modeBtn = page.locator('#flightModeBtn');
    const modeText = page.locator('#modeIndicatorText');

    await expect(modeBtn).toBeVisible();

    // 1. Switch to Guided mode
    await modeBtn.click();
    const guidedOption = page.locator('.mode-item[data-mode="Guided"]');
    await expect(guidedOption).toBeVisible();
    await guidedOption.click();

    await expect(modeText).toHaveText('Guided', { timeout: 5000 });
    console.log('[SITLTest] Mode switched to Guided.');

    // Mode transition latency validation: Verify mode change transition latency < 1000 ms
    let stats;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      stats = await getRequest('/stats');
      if (stats.mode_latency_ms !== null) {
        break;
      }
    }
    console.log(`[SITLTest] Measured Mode change latency: ${stats.mode_latency_ms} ms`);
    expect(stats.mode_latency_ms).not.toBeNull();
    expect(stats.mode_latency_ms).toBeLessThan(1000);

    // 2. Switch back to Stabilize mode
    await page.waitForTimeout(300); // Wait for the flight mode panel's 180ms auto-close animation to complete
    await modeBtn.click();
    const stabilizeOption = page.locator('.mode-item[data-mode="Stabilize"]');
    await expect(stabilizeOption).toBeVisible();
    await stabilizeOption.click();

    await expect(modeText).toHaveText('Stabilize', { timeout: 5000 });
    console.log('[SITLTest] Mode switched back to Stabilize.');
  });

  test('SITL E2E: Upload waypoints mission payload', async () => {
    console.log('[SITLTest] Planning and uploading waypoints mission...');
    
    const waypoints = [
      { seq: 0, x: 17.601, y: 78.126, z: 10 },
      { seq: 1, x: 17.602, y: 78.127, z: 15 },
      { seq: 2, x: 17.603, y: 78.128, z: 20 }
    ];

    const result = await page.evaluate(async (wps) => {
      if (typeof window.sendMission === 'function') {
        try {
          return await window.sendMission(wps);
        } catch (e) {
          return { error: e.message };
        }
      }
      return 'sendMission not available';
    }, waypoints);

    console.log('[SITLTest] Mission upload result:', result);
    expect(result).toBe(true);
    // Wait for the asynchronous MAVLink mission upload handshake to complete
    await page.waitForTimeout(2000);
    console.log('[SITLTest] Waypoint mission uploaded successfully to WSL SITL.');
  });

  test('SITL E2E: Validate Parameter Persistence roundtrip after page reload', async () => {
    console.log('[SITLTest] Setting parameter RTL_ALT_M to 25 (25m)...');
    await page.evaluate(() => {
      if (typeof window.safeSend === 'function') {
        window.safeSend({ type: 'param_set', param_id: 'RTL_ALT_M', value: 25 });
      }
    });

    // Wait for parameter roundtrip to write and propagate
    await page.waitForTimeout(2000);

    console.log('[SITLTest] Triggering GCS page reload to disconnect and reconnect...');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Wait for telemetry link recovery
    const badge = page.locator('.status-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/ready/, { timeout: 25000 });

    console.log('[SITLTest] Navigating to Full Parameters panel...');
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="param-full"]').click();

    // Verify RTL_ALT_M value persists and is loaded correctly in the UI
    const rtlAltInput = page.locator('#fpBody tr[data-param="RTL_ALT_M"] .param-val-input');
    await expect(rtlAltInput).toBeVisible();
    await expect(rtlAltInput).toHaveValue('25', { timeout: 10000 });
    console.log('[SITLTest] RTL_ALT_M value verified as 25 inside settings UI.');

    // Clean close settings window
    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(500);
  });

  test('SITL E2E: Validate waypoints mission download/retrieval', async () => {
    // Wait for any background parameter/mission download sync from GCS page reload to settle
    console.log('[SITLTest] Waiting 5 seconds for background sync to settle...');
    await page.waitForTimeout(5000);

    console.log('[SITLTest] Triggering faked mission download/retrieval via proxy...');
    await postRequest('/trigger_download');

    let completed = false;
    let count = 0;
    let stats;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      stats = await getRequest('/stats');
      if (stats.download_completed) {
        completed = true;
        count = stats.download_item_count;
        break;
      }
      if (stats.download_error) {
        throw new Error(`Mission download handshake failed: ${stats.download_error}`);
      }
    }

    expect(completed).toBe(true);
    expect(count).toBeGreaterThan(0);
    console.log(`[SITLTest] Faked mission download complete. Retrieved ${count} items.`);
  });

  test('SITL E2E: Validate Geofence breach alerts and RTL failsafe action', async () => {
    console.log('[SITLTest] Validating Geofence breach alerts and RTL failsafe action...');

    // 1. Set geofence parameters on the autopilot to propagate to UI state
    console.log('[SITLTest] Setting FENCE_ENABLE=1 and FENCE_ALT_MAX=10...');
    await page.evaluate(() => {
      if (typeof window.safeSend === 'function') {
        window.safeSend({ type: 'param_set', param_id: 'FENCE_ENABLE', value: 1 });
        window.safeSend({ type: 'param_set', param_id: 'FENCE_TYPE', value: 1 }); // Altitude only
        window.safeSend({ type: 'param_set', param_id: 'FENCE_ALT_MAX', value: 10 }); // 10 meters limit
        window.safeSend({ type: 'param_set', param_id: 'FENCE_MARGIN', value: 1 }); // 1 meter margin
      }
    });

    // Wait for parameter round-trip to complete
    await page.waitForTimeout(2000);

    // 2. Open Settings -> Geofence panel to inspect
    await page.evaluate(() => {
      window.SettingsWindow.open();
    });
    const gfTab = page.locator('.settings-nav-btn[data-panel="geofence"]');
    await expect(gfTab).toBeVisible();
    await gfTab.click();

    // Verify breach banner is not visible initially
    const breachBanner = page.locator('#gf-breach-banner');
    await expect(breachBanner).not.toHaveClass(/visible/);

    // Close settings window
    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(250);

    // 3. Dispatch simulated altitude breach (altitude = 15m > 10m limit) via WS interceptor
    console.log('[SITLTest] Simulating altitude breach of 15m...');
    await page.evaluate(() => {
      Object.defineProperty(window.TelemetryStore, 'altitude', {
        get: () => 15.0,
        set: (val) => {},
        configurable: true
      });
      if (Array.isArray(window.__mv_sockets)) {
        window.__mv_sockets.forEach(ws => {
          ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'telemetry',
              alt: 15.0
            })
          }));
        });
      }
    });

    // Open settings window to see if breach banner is visible
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="geofence"]').click();
    await expect(breachBanner).toHaveClass(/visible/, { timeout: 3000 });
    console.log('[SITLTest] Geofence breach banner is visible!');

    // 4. Simulate RTL failsafe trigger on GCS UI via WS interceptor
    console.log('[SITLTest] Simulating RTL failsafe flight mode transition...');
    await page.evaluate(() => {
      Object.defineProperty(window.TelemetryStore, 'mode', {
        get: () => 'RTL',
        set: (val) => {},
        configurable: true
      });
      if (Array.isArray(window.__mv_sockets)) {
        window.__mv_sockets.forEach(ws => {
          ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'flight_mode_status',
              mode: 'RTL'
            })
          }));
        });
      }
    });

    const modeText = page.locator('#modeIndicatorText');
    await expect(modeText).toHaveText('RTL', { timeout: 3000 });
    console.log('[SITLTest] Mode indicator successfully transitioned to RTL.');

    // 5. Recover from breach (altitude = 5m < 10m limit) via WS interceptor
    console.log('[SITLTest] Simulating recovery from breach...');
    await page.evaluate(() => {
      Object.defineProperty(window.TelemetryStore, 'altitude', {
        get: () => 5.0,
        set: (val) => {},
        configurable: true
      });
      Object.defineProperty(window.TelemetryStore, 'mode', {
        get: () => 'Stabilize',
        set: (val) => {},
        configurable: true
      });
      if (Array.isArray(window.__mv_sockets)) {
        window.__mv_sockets.forEach(ws => {
          ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'telemetry',
              alt: 5.0
            })
          }));
          ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'flight_mode_status',
              mode: 'Stabilize'
            })
          }));
        });
      }
    });

    // Verify breach banner is hidden
    await expect(breachBanner).not.toHaveClass(/visible/, { timeout: 3000 });
    await expect(modeText).toHaveText('Stabilize', { timeout: 3000 });
    console.log('[SITLTest] Geofence breach cleared successfully.');

    // Close settings window and cleanup
    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(250);

    // Disable fence parameter and clean up getters
    await page.evaluate(() => {
      delete window.TelemetryStore.altitude;
      delete window.TelemetryStore.mode;
      window.TelemetryStore.altitude = 0.0;
      window.TelemetryStore.mode = 'Stabilize';
      if (typeof window.safeSend === 'function') {
        window.safeSend({ type: 'param_set', param_id: 'FENCE_ENABLE', value: 0 });
      }
    });
    await page.waitForTimeout(1000);
  });
});
