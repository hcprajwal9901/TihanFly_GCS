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

test.describe('GCS Multi-Vehicle End-to-End Validation (Phase 5)', () => {
  test.describe.configure({ mode: 'serial' });

  let orchestrator;
  let electronApp;
  let page;

  // Track results for reporting
  const testResults = {
    discovery: 'FAIL',
    vehicle_isolation: 'FAIL',
    command_isolation: 'FAIL',
    parameter_isolation: 'FAIL',
    mission_isolation: 'FAIL',
    simultaneous_ops: 'FAIL',
    disconnect_recovery: 'FAIL',
    reconnect_recovery: 'FAIL'
  };

  test.beforeAll(async () => {
    // 1. Initialize and start 3 WSL SITL instances and aggregated proxy
    orchestrator = new SITLOrchestrator();
    await orchestrator.start({ numVehicles: 3 });

    // 2. Launch GCS Electron application
    console.log('[MultiVehicleTest] Launching GCS Electron app...');
    const mainPath = path.join(__dirname, '../../main.js');
    electronApp = await electron.launch({
      args: [mainPath, '--enable-precise-memory-info'],
      env: { ...process.env }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.beforeEach(async () => {
    // Reset WSL proxy stats/muted lists before each test
    try {
      await postRequest('/reset');
      console.log('[MultiVehicleTest] WSL proxy reset.');
    } catch (e) {
      console.warn('[MultiVehicleTest] Failed to reset proxy:', e.message);
    }
    // Ensure dropdown is visible for element state checks
    try {
      await page.evaluate(() => {
        const wrap = document.getElementById('vehicleSelectorWrap');
        if (wrap) wrap.classList.add('show-dropdown');
      });
    } catch (e) {}
  });

  test.afterAll(async () => {
    // 1. Update kpis.json with multi-vehicle results
    const kpiPath = path.join(__dirname, '../reports/kpis.json');
    let kpis = { build: 'Local-KPI', metrics: {}, reliability: {} };
    if (fs.existsSync(kpiPath)) {
      try {
        kpis = JSON.parse(fs.readFileSync(kpiPath, 'utf8'));
      } catch (err) {
        console.error('[MultiVehicleTest] Failed to read kpis.json:', err.message);
      }
    }

    kpis.multi_vehicle = {
      vehicle_count: 3,
      discovery_success_rate: testResults.discovery === 'PASS' ? 100 : 0,
      vehicle_isolation: testResults.vehicle_isolation,
      command_isolation: testResults.command_isolation,
      parameter_isolation: testResults.parameter_isolation,
      mission_isolation: testResults.mission_isolation,
      simultaneous_ops: testResults.simultaneous_ops,
      disconnect_recovery: testResults.disconnect_recovery,
      reconnect_recovery: testResults.reconnect_recovery
    };

    try {
      fs.writeFileSync(kpiPath, JSON.stringify(kpis, null, 2), 'utf8');
      console.log('[MultiVehicleTest] Written KPIs to kpis.json.');
    } catch (err) {
      console.error('[MultiVehicleTest] Failed to write kpis.json:', err.message);
    }

    // 2. Close GCS
    if (electronApp) {
      console.log('[MultiVehicleTest] Closing GCS app...');
      await electronApp.close();
    }

    // 3. Stop simulation
    if (orchestrator) {
      console.log('[MultiVehicleTest] Stopping orchestrator...');
      orchestrator.stop();
    }
  });

  test('Multi-Vehicle: Auto-discover three vehicles on shared port 14550', async () => {
    console.log('[MultiVehicleTest] Waiting for GCS to discover 3 vehicles...');
    
    // Wait for the three tabs representing SysID 1, 2, and 3 to be visible in the selector wrap
    const tab1 = page.locator('.mv-drone-tab[data-sysid="1"]');
    const tab2 = page.locator('.mv-drone-tab[data-sysid="2"]');
    const tab3 = page.locator('.mv-drone-tab[data-sysid="3"]');

    // SITL instances bootup and download can take up to 45 seconds total
    await expect(tab1).toBeVisible({ timeout: 45000 });
    await expect(tab2).toBeVisible({ timeout: 45000 });
    await expect(tab3).toBeVisible({ timeout: 45000 });

    console.log('[MultiVehicleTest] Verified: 3 vehicles discovered successfully!');

    // Check active vehicles list inside the page context
    const activeSysids = await page.evaluate(() => window.activeSysids);
    console.log(`[MultiVehicleTest] Active SysIDs in frontend: ${JSON.stringify(activeSysids)}`);
    expect(activeSysids).toContain(1);
    expect(activeSysids).toContain(2);
    expect(activeSysids).toContain(3);

    testResults.discovery = 'PASS';
  });

  test('Multi-Vehicle: Cross-Vehicle Telemetry/Vehicle Isolation', async () => {
    console.log('[MultiVehicleTest] Verifying telemetry isolation...');

    // 1. Select Vehicle 1 and configure spy flags
    await page.evaluate(() => {
      window.setSelectedSysId(1);
      window.TelemetryStore.matched50 = false;
      window.TelemetryStore.matched10 = false;
      window.TelemetryStore._lastAltVal = 0.0;
      Object.defineProperty(window.TelemetryStore, 'altitude', {
        get: () => window.TelemetryStore._lastAltVal,
        set: (val) => {
          window.TelemetryStore._lastAltVal = val;
          if (val === 50.0) {
            window.TelemetryStore.matched50 = true;
          }
          if (val === 10.0) {
            window.TelemetryStore.matched10 = true;
          }
        },
        configurable: true
      });
    });

    // 2. Dispatch telemetry for Vehicle 2
    await page.evaluate(() => {
      const ws = window.__mv_sockets[0];
      if (ws) {
        ws.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'telemetry',
            sysid: 2,
            altitude: 50.0
          })
        }));
      }
    });
    await page.waitForTimeout(200);

    // Verify Vehicle 1's altitude was NOT updated to 50.0 (matched50 remains false)
    const matched50 = await page.evaluate(() => window.TelemetryStore.matched50);
    expect(matched50).toBe(false);
    console.log('[MultiVehicleTest] Telemetry for SysID 2 was successfully isolated (did not write to SysID 1).');

    // 3. Dispatch telemetry for Vehicle 1
    await page.evaluate(() => {
      const ws = window.__mv_sockets[0];
      if (ws) {
        ws.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'telemetry',
            sysid: 1,
            altitude: 10.0
          })
        }));
      }
    });
    await page.waitForTimeout(200);

    // Verify Vehicle 1's altitude WAS updated to 10.0 (matched10 becomes true)
    const matched10 = await page.evaluate(() => window.TelemetryStore.matched10);
    expect(matched10).toBe(true);
    console.log('[MultiVehicleTest] Telemetry for SysID 1 correctly updated UI store.');

    // Cleanup descriptor
    await page.evaluate(() => {
      delete window.TelemetryStore.altitude;
      window.TelemetryStore.altitude = 0.0;
    });

    testResults.vehicle_isolation = 'PASS';
  });

  test('Multi-Vehicle: Cross-Vehicle Command Isolation', async () => {
    console.log('[MultiVehicleTest] Verifying command isolation...');

    const tab1Badge = page.locator('.mv-drone-tab[data-sysid="1"] .mv-arm-badge');
    const tab2Badge = page.locator('.mv-drone-tab[data-sysid="2"] .mv-arm-badge');
    const tab3Badge = page.locator('.mv-drone-tab[data-sysid="3"] .mv-arm-badge');
    const armBtn = page.locator('#armBtn');

    // 1. Target Vehicle 1
    console.log('[MultiVehicleTest] Targeting Vehicle 1...');
    await page.evaluate(() => window.setSelectedSysId(1));
    await page.waitForTimeout(500);
    await armBtn.click();
    await expect(tab1Badge).toHaveText('ARMED', { timeout: 15000 });
    await expect(tab2Badge).toHaveText('DSRM');
    await expect(tab3Badge).toHaveText('DSRM');
    console.log('[MultiVehicleTest] Disarming Vehicle 1...');
    await armBtn.click();
    await expect(tab1Badge).toHaveText('DSRM', { timeout: 15000 });
    await expect(tab2Badge).toHaveText('DSRM');
    await expect(tab3Badge).toHaveText('DSRM');

    // 2. Target Vehicle 2
    console.log('[MultiVehicleTest] Targeting Vehicle 2...');
    await page.evaluate(() => window.setSelectedSysId(2));
    await page.waitForTimeout(500);
    await armBtn.click();
    await expect(tab2Badge).toHaveText('ARMED', { timeout: 15000 });
    await expect(tab1Badge).toHaveText('DSRM');
    await expect(tab3Badge).toHaveText('DSRM');
    console.log('[MultiVehicleTest] Disarming Vehicle 2...');
    await armBtn.click();
    await expect(tab2Badge).toHaveText('DSRM', { timeout: 15000 });
    await expect(tab1Badge).toHaveText('DSRM');
    await expect(tab3Badge).toHaveText('DSRM');

    // 3. Target Vehicle 3
    console.log('[MultiVehicleTest] Targeting Vehicle 3...');
    await page.evaluate(() => window.setSelectedSysId(3));
    await page.waitForTimeout(500);
    await armBtn.click();
    await expect(tab3Badge).toHaveText('ARMED', { timeout: 15000 });
    await expect(tab1Badge).toHaveText('DSRM');
    await expect(tab2Badge).toHaveText('DSRM');
    console.log('[MultiVehicleTest] Disarming Vehicle 3...');
    await armBtn.click();
    await expect(tab3Badge).toHaveText('DSRM', { timeout: 15000 });
    await expect(tab1Badge).toHaveText('DSRM');
    await expect(tab2Badge).toHaveText('DSRM');

    testResults.command_isolation = 'PASS';
  });

  test('Multi-Vehicle: Cross-Vehicle Parameter Isolation', async () => {
    console.log('[MultiVehicleTest] Setting distinct parameters per vehicle...');

    // Set Vehicle 1 RTL_ALT_M = 10 (10 meters)
    await page.evaluate(() => {
      window.setSelectedSysId(1);
      window.safeSend({ type: 'param_set', param_id: 'RTL_ALT_M', value: 10 });
    });
    await page.waitForTimeout(1000);

    // Set Vehicle 2 RTL_ALT_M = 20 (20 meters)
    await page.evaluate(() => {
      window.setSelectedSysId(2);
      window.safeSend({ type: 'param_set', param_id: 'RTL_ALT_M', value: 20 });
    });
    await page.waitForTimeout(1000);

    // Set Vehicle 3 RTL_ALT_M = 30 (30 meters)
    await page.evaluate(() => {
      window.setSelectedSysId(3);
      window.safeSend({ type: 'param_set', param_id: 'RTL_ALT_M', value: 30 });
    });
    await page.waitForTimeout(2000);

    console.log('[MultiVehicleTest] Reloading GCS window to clear session context...');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      const wrap = document.getElementById('vehicleSelectorWrap');
      if (wrap) wrap.classList.add('show-dropdown');
    });

    // Wait for discovery recovery
    const tab1 = page.locator('.mv-drone-tab[data-sysid="1"]');
    const tab2 = page.locator('.mv-drone-tab[data-sysid="2"]');
    const tab3 = page.locator('.mv-drone-tab[data-sysid="3"]');
    await expect(tab1).toBeVisible({ timeout: 25000 });
    await expect(tab2).toBeVisible({ timeout: 25000 });
    await expect(tab3).toBeVisible({ timeout: 25000 });

    console.log('[MultiVehicleTest] Opening Full Parameters panel...');
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="param-full"]').click();

    // Verify RTL_ALT_M values are isolated correctly in the UI
    const rtlAltInput = page.locator('#fpBody tr[data-param="RTL_ALT_M"] .param-val-input');
    
    // Vehicle 1 parameter verification
    console.log('[MultiVehicleTest] Checking RTL_ALT_M for Vehicle 1...');
    await page.evaluate(() => window.setSelectedSysId(1));
    await expect(rtlAltInput).toHaveValue('10', { timeout: 5000 });

    // Vehicle 2 parameter verification
    console.log('[MultiVehicleTest] Checking RTL_ALT_M for Vehicle 2...');
    await page.evaluate(() => window.setSelectedSysId(2));
    await expect(rtlAltInput).toHaveValue('20', { timeout: 5000 });

    // Vehicle 3 parameter verification
    console.log('[MultiVehicleTest] Checking RTL_ALT_M for Vehicle 3...');
    await page.evaluate(() => window.setSelectedSysId(3));
    await expect(rtlAltInput).toHaveValue('30', { timeout: 5000 });

    // Cleanup and close settings
    await page.evaluate(() => window.SettingsWindow.close());
    await page.waitForTimeout(500);

    testResults.parameter_isolation = 'PASS';
  });

  test('Multi-Vehicle: Cross-Vehicle Mission Isolation', async () => {
    console.log('[MultiVehicleTest] Planning and uploading separate missions...');

    // Mission A -> Vehicle 1 (1 waypoint)
    await page.evaluate(() => {
      window.setSelectedSysId(1);
      window.sendMission([{ seq: 0, x: 17.601, y: 78.126, z: 10 }]);
    });
    await page.waitForTimeout(3000);

    // Mission B -> Vehicle 2 (2 waypoints)
    await page.evaluate(() => {
      window.setSelectedSysId(2);
      window.sendMission([
        { seq: 0, x: 17.601, y: 78.126, z: 20 },
        { seq: 1, x: 17.602, y: 78.127, z: 25 }
      ]);
    });
    await page.waitForTimeout(3000);

    // Mission C -> Vehicle 3 (3 waypoints)
    await page.evaluate(() => {
      window.setSelectedSysId(3);
      window.sendMission([
        { seq: 0, x: 17.601, y: 78.126, z: 30 },
        { seq: 1, x: 17.602, y: 78.127, z: 35 },
        { seq: 2, x: 17.603, y: 78.128, z: 40 }
      ]);
    });
    await page.waitForTimeout(3000);

    // Verify mission download transaction separation via proxy endpoints
    console.log('[MultiVehicleTest] Downloading missions back to verify isolation...');

    // Vehicle 1 download verification
    await postRequest('/trigger_download?sysid=1');
    let completed = false, count = 0;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);
      const stats = await getRequest('/stats');
      const vStats = stats.vehicles && stats.vehicles["1"];
      if (vStats && vStats.download_completed) {
        completed = true;
        count = vStats.download_item_count;
        break;
      }
    }
    expect(completed).toBe(true);
    expect(count).toBe(1);
    console.log('[MultiVehicleTest] Verified: Mission A on Vehicle 1 has 1 item.');

    // Vehicle 2 download verification
    completed = false;
    await postRequest('/trigger_download?sysid=2');
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);
      const stats = await getRequest('/stats');
      const vStats = stats.vehicles && stats.vehicles["2"];
      if (vStats && vStats.download_completed) {
        completed = true;
        count = vStats.download_item_count;
        break;
      }
    }
    expect(completed).toBe(true);
    expect(count).toBe(2);
    console.log('[MultiVehicleTest] Verified: Mission B on Vehicle 2 has 2 items.');

    // Vehicle 3 download verification
    completed = false;
    await postRequest('/trigger_download?sysid=3');
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);
      const stats = await getRequest('/stats');
      const vStats = stats.vehicles && stats.vehicles["3"];
      if (vStats && vStats.download_completed) {
        completed = true;
        count = vStats.download_item_count;
        break;
      }
    }
    expect(completed).toBe(true);
    expect(count).toBe(3);
    console.log('[MultiVehicleTest] Verified: Mission C on Vehicle 3 has 3 items.');

    testResults.mission_isolation = 'PASS';
  });

  test('Multi-Vehicle: Simultaneous Operations', async () => {
    console.log('[MultiVehicleTest] Dispatching parallel operations across the fleet...');

    // Send simultaneous WS messages: ARM (Vehicle 1), Guided (Vehicle 2), RTL (Vehicle 3)
    await page.evaluate(() => {
      window.ws.send(JSON.stringify({ type: 'command', command: 'ARM', sysid: 1, params: {} }));
      window.ws.send(JSON.stringify({ type: 'command', command: 'SET_MODE', sysid: 2, params: { mode: 'Guided' } }));
      window.ws.send(JSON.stringify({ type: 'command', command: 'SET_MODE', sysid: 3, params: { mode: 'RTL' } }));
    });

    // Wait for telemetry transactions to complete
    await page.waitForTimeout(2000);

    // Verify Vehicle 1 armed
    const tab1Badge = page.locator('.mv-drone-tab[data-sysid="1"] .mv-arm-badge');
    await expect(tab1Badge).toHaveText('ARMED');

    // Verify Vehicle 2 is in Guided mode
    // Switch selection to Vehicle 2 and verify flight mode indicator
    await page.evaluate(() => window.setSelectedSysId(2));
    await page.waitForTimeout(200);
    const modeText = page.locator('#modeIndicatorText');
    await expect(modeText).toHaveText('Guided');

    // Verify Vehicle 3 is in RTL mode
    await page.evaluate(() => window.setSelectedSysId(3));
    await page.waitForTimeout(200);
    await expect(modeText).toHaveText('RTL');

    // Clean up: disarm Vehicle 1
    console.log('[MultiVehicleTest] Cleaning up simultaneous armed state...');
    await page.evaluate(() => window.setSelectedSysId(1));
    await page.waitForTimeout(200);
    const armBtn = page.locator('#armBtn');
    await armBtn.click();
    await expect(tab1Badge).toHaveText('DSRM', { timeout: 5000 });

    testResults.simultaneous_ops = 'PASS';
  });

  test('Multi-Vehicle: Vehicle Disconnect & Reconnect Recovery', async () => {
    console.log('[MultiVehicleTest] Simulating disconnect of Vehicle 2...');
    await postRequest('/mute?sysid=2');

    // Wait for telemetry timeout (eviction threshold is 5s)
    console.log('[MultiVehicleTest] Waiting 7 seconds for heartbeat timeout...');
    await page.waitForTimeout(7000);

    // Verify Vehicle 2 tab is evicted/hidden in GCS
    const tab1 = page.locator('.mv-drone-tab[data-sysid="1"]');
    const tab2 = page.locator('.mv-drone-tab[data-sysid="2"]');
    const tab3 = page.locator('.mv-drone-tab[data-sysid="3"]');

    await expect(tab1).toBeVisible();
    await expect(tab3).toBeVisible();
    await expect(tab2).not.toBeVisible();

    console.log('[MultiVehicleTest] Verified: Vehicle 2 evicted, Vehicles 1 and 3 remain active.');
    testResults.disconnect_recovery = 'PASS';

    // Reconnect Vehicle 2
    console.log('[MultiVehicleTest] Reconnecting Vehicle 2...');
    await postRequest('/unmute?sysid=2');

    // Wait for rediscovery
    console.log('[MultiVehicleTest] Waiting for Vehicle 2 auto-rediscovery...');
    await expect(tab2).toBeVisible({ timeout: 15000 });

    // Verify parameter cache persistence after reconnect
    console.log('[MultiVehicleTest] Checking parameter persistence for Vehicle 2 after reconnect...');
    await page.evaluate(() => window.setSelectedSysId(2));
    await page.evaluate(() => window.SettingsWindow.open());
    await page.locator('.settings-nav-btn[data-panel="param-full"]').click();
    const rtlAltInput = page.locator('#fpBody tr[data-param="RTL_ALT_M"] .param-val-input');
    await expect(rtlAltInput).toHaveValue('20', { timeout: 10000 });
    await page.evaluate(() => window.SettingsWindow.close());

    console.log('[MultiVehicleTest] Vehicle 2 fully recovered and parameter state verified.');
    testResults.reconnect_recovery = 'PASS';
  });
});
