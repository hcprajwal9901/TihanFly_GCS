describe('Dropdown Menu Strip Behavioral Test Suite', () => {
  let container;
  let logo;
  let flightControls;
  let planBtn, analyzeBtn, vehicleBtn, settingsBtn;
  let planFlightMock, analyzeToolsMock, vehicleConfigMock, settingsWindowMock;

  beforeAll(() => {
    jest.useFakeTimers();

    // Mock global window objects
    planFlightMock = { enter: jest.fn() };
    analyzeToolsMock = { showAnalyzePanel: jest.fn() };
    vehicleConfigMock = { open: jest.fn() };
    settingsWindowMock = { open: jest.fn() };

    window.PlanFlight = planFlightMock;
    window.AnalyzeToolsPanel = analyzeToolsMock;
    window.VehicleConfig = vehicleConfigMock;
    global.SettingsWindow = settingsWindowMock;

    // Create DOM structure ONCE so singleton reference is never lost
    document.body.innerHTML = `
      <div id="dropdownMenuStrip" class="hidden" style="display: none;">
        <button id="planFlightBtn"></button>
        <button id="analyzeBtn"></button>
        <button id="vehicleConfigBtn"></button>
        <button id="appSettingsBtn"></button>
      </div>
      <div id="flightControlsStrip"></div>
      <img id="tihanLogo" />
    `;

    container = document.getElementById('dropdownMenuStrip');
    logo = document.getElementById('tihanLogo');
    flightControls = document.getElementById('flightControlsStrip');
    planBtn = document.getElementById('planFlightBtn');
    analyzeBtn = document.getElementById('analyzeBtn');
    vehicleBtn = document.getElementById('vehicleConfigBtn');
    settingsBtn = document.getElementById('appSettingsBtn');

    // Load Script once
    global.loadScript('js/dropdown-menu.js');

    // Trigger auto-initialization via timers
    jest.advanceTimersByTime(600);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset DOM states manually instead of replacing innerHTML (which breaks singleton references)
    if (container) {
      container.style.display = 'none';
      container.className = 'hidden';
    }
    if (flightControls) {
      flightControls.style.display = 'flex';
      flightControls.className = '';
    }
    if (logo) {
      logo.className = '';
    }

    [planBtn, analyzeBtn, vehicleBtn, settingsBtn].forEach(btn => {
      if (btn) {
        btn.className = '';
      }
    });

    // Reset the internal state of the singleton by manually triggering a hide if available
    if (window.DropdownStrip && window.DropdownStrip.hide) {
      window.DropdownStrip.hide();
    }
  });

  it('should auto-initialize DropdownMenuStrip and expose window.DropdownStrip API', () => {
    expect(window.DropdownStrip).toBeDefined();
    expect(typeof window.DropdownStrip.show).toBe('function');
    
    // Check initial state: dropdown hidden, flight controls visible
    expect(container.style.display).toBe('none');
    expect(container.classList.contains('hidden')).toBe(true);
    expect(flightControls.style.display).toBe('flex');
  });

  describe('Logo click toggling', () => {
    it('should show dropdown and hide flight controls when logo is clicked, and toggle back on second click', () => {
      // Click logo to show
      logo.click();
      
      expect(container.style.display).toBe('flex');
      expect(container.classList.contains('hidden')).toBe(false);
      expect(flightControls.style.display).toBe('none');
      expect(flightControls.classList.contains('hidden')).toBe(true);
      expect(logo.classList.contains('menu-active')).toBe(true);

      // Click logo again to hide
      logo.click();
      
      expect(container.style.display).toBe('none');
      expect(container.classList.contains('hidden')).toBe(true);
      expect(flightControls.style.display).toBe('flex');
      expect(flightControls.classList.contains('hidden')).toBe(false);
      expect(logo.classList.contains('menu-active')).toBe(false);
    });
  });

  describe('Outside click hiding behavior', () => {
    it('should close dropdown menu if user clicks outside the menu strip and logo', () => {
      // Open dropdown
      logo.click();
      expect(container.style.display).toBe('flex');

      // Click on container itself - should not close
      const innerEvent = new MouseEvent('click', { bubbles: true });
      container.dispatchEvent(innerEvent);
      expect(container.style.display).toBe('flex');

      // Click outside (e.g. document body)
      const outsideEvent = new MouseEvent('click', { bubbles: true });
      document.body.dispatchEvent(outsideEvent);

      expect(container.style.display).toBe('none');
      expect(flightControls.style.display).toBe('flex');
    });
  });

  describe('Dropdown action buttons clicks', () => {
    it('planFlightBtn should trigger PlanFlight.enter and hide dropdown', () => {
      // Open dropdown first
      logo.click();

      // Click planBtn
      planBtn.click();

      expect(container.style.display).toBe('none');
      expect(flightControls.style.display).toBe('flex');
      expect(planFlightMock.enter).toHaveBeenCalled();
    });

    it('analyzeBtn should trigger showAnalyzePanel with 150ms timeout', () => {
      logo.click();

      analyzeBtn.click();

      expect(analyzeToolsMock.showAnalyzePanel).not.toHaveBeenCalled();

      // Tick the 150ms timeout
      jest.advanceTimersByTime(200);

      expect(analyzeToolsMock.showAnalyzePanel).toHaveBeenCalled();
      expect(container.style.display).toBe('none');
      expect(flightControls.style.display).toBe('flex');
    });

    it('vehicleConfigBtn should trigger VehicleConfig.open with 150ms timeout', () => {
      logo.click();

      vehicleBtn.click();

      expect(vehicleConfigMock.open).not.toHaveBeenCalled();

      jest.advanceTimersByTime(200);

      expect(vehicleConfigMock.open).toHaveBeenCalled();
      expect(container.style.display).toBe('none');
    });

    it('appSettingsBtn should trigger SettingsWindow.open directly and highlight active state', () => {
      logo.click();

      settingsBtn.click();

      expect(settingsBtn.classList.contains('active')).toBe(true);
      expect(settingsWindowMock.open).toHaveBeenCalled();
    });
  });

  describe('Global API calls', () => {
    it('window.DropdownStrip.show / hide / toggle wrappers should delegate correctly', () => {
      window.DropdownStrip.show();
      expect(container.style.display).toBe('flex');

      window.DropdownStrip.hide();
      expect(container.style.display).toBe('none');

      window.DropdownStrip.toggle();
      expect(container.style.display).toBe('flex');

      window.DropdownStrip.showPlanStrip();
      expect(container.style.display).toBe('flex');
    });
  });
});