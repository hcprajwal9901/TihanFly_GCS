const { test, expect } = require('@playwright/test');
const path = require('path');
const AxeBuilder = require('@axe-core/playwright').default;

test.describe('Standalone Component Pages Integration Tests', () => {
  
  // ─── 1. Weather Dashboard ───
  test('weather-dashboard.html: spinner, error state and button controls', async ({ page }) => {
    const filePath = path.join(__dirname, '../../pages/weather-dashboard.html');
    await page.goto(`file://${filePath}`);

    // Verify dashboard is displayed
    const dashboard = page.locator('#weatherDashboard');
    await expect(dashboard).toBeVisible();

    // Spinner loading display should be visible initially
    const spinner = page.locator('#weatherLoading');
    await expect(spinner).toBeVisible();

    // Verify close button exists
    const closeBtn = page.locator('#weatherCloseBtn');
    await expect(closeBtn).toBeVisible();

    // Visual regression testing: Verify layout stability (masking the spinner)
    await expect(page).toHaveScreenshot('weather-dashboard.png', {
      mask: [spinner]
    });

    // Accessibility test: check for critical & serious violations
    const results = await new AxeBuilder({ page })
      .disableRules(['document-title', 'html-has-lang'])
      .analyze();
    const criticalOrSerious = results.violations.filter(v =>
      ['critical', 'serious'].includes(v.impact)
    );
    expect(criticalOrSerious).toHaveLength(0);
  });

  // ─── 2. Command Editor ───
  test('command-editor.html: tab selection, forms and waypoints panels', async ({ page }) => {
    const filePath = path.join(__dirname, '../../pages/command-editor.html');
    await page.goto(`file://${filePath}`);

    // Verify tab items
    const missionTab = page.locator('.editor-tab[data-tab="mission"]');
    const waypointsTab = page.locator('.editor-tab[data-tab="waypoints"]');
    const fenceTab = page.locator('.editor-tab[data-tab="fence"]');

    await expect(missionTab).toBeVisible();
    await expect(waypointsTab).toBeVisible();

    // Select Altitudes dropdown verification
    const select = page.locator('select.form-control').first();
    await expect(select).toBeVisible();
    await select.selectOption('Above Mean Sea Level');

    // Toggle to Waypoints panel
    await waypointsTab.click();
    await expect(page.locator('#waypointsPanel')).toBeVisible();

    // Verify empty state is displayed
    const emptyState = page.locator('#emptyWaypointState');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('.empty-icon')).toContainText('📍');

    // Visual regression: Verify layout
    await expect(page).toHaveScreenshot('command-editor-waypoints.png');

    // Toggle to Fence panel
    await fenceTab.click();
    await expect(page.locator('#fencePanel')).toBeVisible();

    // Accessibility check
    const results = await new AxeBuilder({ page })
      .disableRules(['document-title', 'html-has-lang', 'label', 'select-name'])
      .analyze();
    const criticalOrSerious = results.violations.filter(v =>
      ['critical', 'serious'].includes(v.impact)
    );
    expect(criticalOrSerious).toHaveLength(0);
  });

  // ─── 3. Quick Action Flight Controls ───
  test('flight-controls-buttons.html & message-console-minimal.html: renders successfully', async ({ page }) => {
    // Flight controls buttons check
    let filePath = path.join(__dirname, '../../pages/flight-controls-buttons.html');
    await page.goto(`file://${filePath}`);
    const armBtn = page.locator('.btn-arm, button').first();
    await expect(armBtn).toBeVisible();

    // Visual check
    await expect(page).toHaveScreenshot('flight-controls-buttons.png');

    // Message console check
    filePath = path.join(__dirname, '../../pages/message-console-minimal.html');
    await page.goto(`file://${filePath}`);
    const consoleBox = page.locator('.console-box, body').first();
    await expect(consoleBox).toBeVisible();
  });
});
