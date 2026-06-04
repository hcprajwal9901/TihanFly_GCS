describe('Multi-Language Support Unit Tests (i18n.js)', () => {
  beforeEach(() => {
    // 1. Reset standard DOM structure with test elements
    document.body.innerHTML = `
      <div id="langSelectorWrap"></div>
      <div id="status" data-i18n="status.ready"></div>
      <input id="inputTest" data-i18n="plan.new-mission" type="text" />
    `;
    
    // Clear localStorage mock
    global.localStorage.clear();
    
    // Reset global namespace
    jest.clearAllMocks();
    
    // 2. Load i18n script
    global.loadScript('js/i18n.js');
  });

  it('should read initial language configuration from localStorage', () => {
    // Should default to English
    expect(global.localStorage.getItem).toHaveBeenCalledWith('tihan_lang');
  });

  describe('t(key) translation retrieval', () => {
    it('should translate keys correctly in English (default)', () => {
      // Direct access inside scope is not exported, but it updates DOM.
      // Let's verify via DOM elements translations
      const el = document.getElementById('status');
      
      // Trigger translations
      document.dispatchEvent(new Event('DOMContentLoaded'));
      
      expect(el.textContent).toBe('Ready To Fly');
    });

    it('should dynamically update DOM translation properties on translation execution', () => {
      const el = document.getElementById('status');
      const input = document.getElementById('inputTest');
      
      // Inject language change
      global.localStorage.setItem('tihan_lang', 'kn'); // Kannada
      
      // Reload script to pick up change
      global.loadScript('js/i18n.js');
      
      expect(el.textContent).toBe('ಹಾರಲು ಸಿದ್ಧ');
      expect(input.placeholder).toBe('ಹೊಸ ಮಿಷನ್');
    });
  });

  describe('Language Selector UI widgets builder', () => {
    it('should build interactive combobox buttons and listing dropdowns', () => {
      // Initialise the UI widget
      const wrap = document.getElementById('langSelectorWrap');
      expect(wrap.innerHTML).not.toBe('');
      
      // Find and run selector builder
      // Note: buildSelector is an internal function run automatically when DOM loads.
      // Let's check if the button is loaded:
      expect(document.getElementById('langToggleBtn')).toBeDefined();
      expect(document.getElementById('langDropdown')).toBeDefined();
      
      // Should show English as the active label initially
      const toggleBtn = document.getElementById('langToggleBtn');
      expect(toggleBtn.textContent).toContain('English');
    });
  });

  describe('Public API methods (setLang, getLang, t)', () => {
    it('should set and get language correctly', () => {
      expect(window.i18n.getLang()).toBe('en');
      
      window.i18n.setLang('ta');
      expect(window.i18n.getLang()).toBe('ta');
      expect(global.localStorage.getItem('tihan_lang')).toBe('ta');
      
      // Invalid lang code should be ignored
      window.i18n.setLang('invalid_code');
      expect(window.i18n.getLang()).toBe('ta');
    });

    it('should translate keys using t(key)', () => {
      window.i18n.setLang('en');
      expect(window.i18n.t('status.ready')).toBe('Ready To Fly');
      expect(window.i18n.t('nonexistent_key')).toBe('nonexistent_key');

      window.i18n.setLang('hi');
      expect(window.i18n.t('status.ready')).toBe('उड़ान के लिए तैयार');
    });
  });

  describe('Dropdown UI interactions and language selection', () => {
    it('should toggle dropdown open/close on button click and close on clicking outside', () => {
      const toggleBtn = document.getElementById('langToggleBtn');
      const dropdown = document.getElementById('langDropdown');

      expect(dropdown.style.display).toBe('none');

      // Click to open
      toggleBtn.dispatchEvent(new Event('click'));
      expect(dropdown.style.display).toBe('block');
      expect(toggleBtn.classList.contains('active-lang')).toBe(true);

      // Click again to close
      toggleBtn.dispatchEvent(new Event('click'));
      expect(dropdown.style.display).toBe('none');
      expect(toggleBtn.classList.contains('active-lang')).toBe(false);

      // Click to open again
      toggleBtn.dispatchEvent(new Event('click'));
      expect(dropdown.style.display).toBe('block');

      // Click outside to close
      document.dispatchEvent(new Event('click'));
      expect(dropdown.style.display).toBe('none');
    });

    it('should select language from dropdown menu options', () => {
      const dropdown = document.getElementById('langDropdown');
      
      // Find Kannada option (code 'kn')
      const options = dropdown.querySelectorAll('.lang-option');
      const knOpt = Array.from(options).find(opt => opt.querySelector('.lang-label').textContent === 'Kannada');
      
      expect(knOpt).toBeDefined();

      // Click to select
      knOpt.dispatchEvent(new Event('click'));

      expect(window.i18n.getLang()).toBe('kn');
      expect(document.getElementById('status').textContent).toBe('ಹಾರಲು ಸಿದ್ಧ');
    });

    it('should warn and skip dropdown build if langSelectorWrap is missing', () => {
      // Mock console.warn
      const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const spyGetElementById = jest.spyOn(document, 'getElementById').mockReturnValue(null);
      
      // Clear DOM
      document.body.innerHTML = `
        <div id="status" data-i18n="status.ready"></div>
      `;

      // Reload script
      global.loadScript('js/i18n.js');

      expect(spyWarn).toHaveBeenCalledWith(
        expect.stringContaining('i18n: #langSelectorWrap not found in HTML')
      );
      spyWarn.mockRestore();
      spyGetElementById.mockRestore();
    });
  });

  describe('DOM auto-injection matching', () => {
    it('should automatically inject data-i18n attributes for mapped selectors', () => {
      document.body.innerHTML = `
        <div id="langSelectorWrap"></div>
        <div id="tihanLogo"></div>
        <div class="status-badge ready"></div>
        <div id="armBtnLabel"></div>
        <button id="takeoffBtn"><span class="btn-label"></span></button>
        <div class="indicator-item"><span class="indicator-text"></span></div>
        <button id="planFlightBtn"><span class="dropdown-btn-label"></span></button>
        <div class="flight-mode-panel-header"><span></span></div>
        <div class="weather-title"><span></span></div>
        <div class="modal-title"></div>
        <div class="editor-title"><span></span></div>
        <div id="planFlightMenuStrip">
          <div class="plan-menu-dropdown"><span class="plan-menu-label"></span></div>
        </div>
        <div class="vc-title-text"></div>
        <div class="weather-details-grid">
          <div class="weather-detail-item"><span class="detail-label"></span></div>
          <div class="weather-detail-item"><span class="detail-label"></span></div>
        </div>
        <div data-action="new-mission"></div>
        <div class="mode-item" data-mode="Stabilize">
          <span class="mode-name"></span>
          <span class="mode-tag basic"></span>
        </div>
        <div class="input-label">Target Altitude</div>
        <div id="waypointDetailsPanel">
          <div class="form-group"><label>Waypoint ID</label></div>
        </div>
        <div id="fenceDetailsPanel">
          <div class="form-group"><label>Fence ID</label></div>
        </div>
        <div id="rallyDetailsPanel">
          <div class="form-group"><label>Rally Point ID</label></div>
        </div>
        <div class="vc-section-header">Serial Port</div>
        <div class="vc-progress-label">Erase</div>
      `;

      global.loadScript('js/i18n.js');

      // Verify that data-i18n attributes have been injected
      expect(document.querySelector('.status-badge').getAttribute('data-i18n')).toBe('status.ready');
      expect(document.getElementById('armBtnLabel').getAttribute('data-i18n')).toBe('btn.arm');
      expect(document.querySelector('#takeoffBtn .btn-label').getAttribute('data-i18n')).toBe('btn.takeoff');
      expect(document.querySelector('[data-action="new-mission"]').getAttribute('data-i18n')).toBe('plan.new-mission');
      expect(document.querySelector('.mode-name').getAttribute('data-i18n')).toBe('mode.stabilize');
      expect(document.querySelector('.mode-tag').getAttribute('data-i18n')).toBe('mode.tag.basic');
      expect(document.querySelector('.input-label').getAttribute('data-i18n')).toBe('takeoff.altitude.label');
      expect(document.querySelector('#waypointDetailsPanel label').getAttribute('data-i18n')).toBe('editor.wp-id');
      expect(document.querySelector('#fenceDetailsPanel label').getAttribute('data-i18n')).toBe('fence.id');
      expect(document.querySelector('#rallyDetailsPanel label').getAttribute('data-i18n')).toBe('rally.id');
      expect(document.querySelector('.vc-section-header').getAttribute('data-i18n')).toBe('vc.serial-port');
      expect(document.querySelector('.vc-progress-label').getAttribute('data-i18n')).toBe('vc.erase-progress');
    });
  });
});
