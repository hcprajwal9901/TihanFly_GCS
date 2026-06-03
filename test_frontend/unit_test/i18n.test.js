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
});
