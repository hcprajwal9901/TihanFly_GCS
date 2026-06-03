describe('GCS Flight Plan UI High-Fidelity Behavioral Test Suite (plan-flight-ui.js)', () => {
  let modeInstance;
  let originalCreateElement;

  beforeAll(() => {
    // Keep reference to genuine native document.createElement before any spy modifications
    originalCreateElement = document.createElement;

    // Define dummy constructor for PlanFlightMode
    window.PlanFlightMode = function() {
      this.planMenuStrip = null;
      this.stripContainer = null;
      this.flightControlsStrip = null;
      this.messageConsole = null;
      this.headerBar = null;
      this.tihanLogo = null;
      this.statusBadge = null;
      this.headerLeft = null;
      this.headerCenter = null;
      this.exit = jest.fn();
      this.handleMenuAction = jest.fn();
    };

    // Load target script
    global.loadScript('plan-flight-modules/plan-flight-ui.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Neutralize setup.js aggressive DOM guards to restore realistic browser behavior
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      return document.body.querySelector(`#${id}`);
    });
    jest.spyOn(document, 'querySelector').mockImplementation((selector) => {
      return document.body.querySelector(selector);
    });

    // Create an instance of PlanFlightMode
    modeInstance = new window.PlanFlightMode();

    // Reset window variables
    delete window.DropdownStrip;
    delete window.CommandEditor;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Menu Strip Visibility (showPlanMenuStrip & hidePlanMenuStrip)', () => {
    it('should set style display to flex and verify position metrics on show', () => {
      const mockStrip = originalCreateElement.call(document, 'div');
      mockStrip.style.display = 'none';
      mockStrip.getBoundingClientRect = jest.fn(() => ({
        top: 10, left: 20, width: 300, height: 50
      }));
      modeInstance.planMenuStrip = mockStrip;

      // Spy on console to check debug prints
      jest.spyOn(console, 'log').mockImplementation(() => {});

      modeInstance.showPlanMenuStrip();

      expect(mockStrip.style.display).toBe('flex');
      expect(mockStrip.getBoundingClientRect).toHaveBeenCalledTimes(1);
    });

    it('should set style display to none on hidePlanMenuStrip', () => {
      const mockStrip = originalCreateElement.call(document, 'div');
      mockStrip.style.display = 'flex';
      modeInstance.planMenuStrip = mockStrip;

      modeInstance.hidePlanMenuStrip();

      expect(mockStrip.style.display).toBe('none');
    });

    it('should log error if showPlanMenuStrip is called without menu strip in DOM', () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      modeInstance.planMenuStrip = null;

      modeInstance.showPlanMenuStrip();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Plan menu strip not found'));
    });
  });

  describe('Visibility Synchronization (hideElements & showElements)', () => {
    beforeEach(() => {
      modeInstance.stripContainer = originalCreateElement.call(document, 'div');
      modeInstance.flightControlsStrip = originalCreateElement.call(document, 'div');
      modeInstance.messageConsole = originalCreateElement.call(document, 'div');

      window.DropdownStrip = {
        hide: jest.fn()
      };
    });

    it('should hide all container elements and invoke DropdownStrip sync on hideElements', () => {
      modeInstance.hideElements();

      expect(modeInstance.stripContainer.style.display).toBe('none');
      expect(modeInstance.stripContainer.classList.contains('hidden')).toBe(true);

      expect(modeInstance.flightControlsStrip.style.display).toBe('none');
      expect(modeInstance.flightControlsStrip.classList.contains('hidden')).toBe(true);

      expect(modeInstance.messageConsole.style.display).toBe('none');
      expect(window.DropdownStrip.hide).toHaveBeenCalledTimes(1);
    });

    it('should restore message console, flight controls, and reset DropdownStrip sync on showElements', () => {
      modeInstance.showElements();

      expect(modeInstance.messageConsole.style.display).toBe('flex');
      expect(modeInstance.flightControlsStrip.style.display).toBe('flex');
      expect(modeInstance.flightControlsStrip.classList.contains('hidden')).toBe(false);

      expect(modeInstance.stripContainer.style.display).toBe('none');
      expect(window.DropdownStrip.hide).toHaveBeenCalledTimes(1);
    });
  });

  describe('Header Transformation & Exit Route (transformHeaderForPlanMode & restoreHeader)', () => {
    beforeEach(() => {
      modeInstance.headerBar = originalCreateElement.call(document, 'div');
      modeInstance.tihanLogo = originalCreateElement.call(document, 'img');
      modeInstance.statusBadge = originalCreateElement.call(document, 'span');
      modeInstance.headerLeft = originalCreateElement.call(document, 'div');
      
      modeInstance.headerCenter = originalCreateElement.call(document, 'div');
      modeInstance.headerCenter.innerHTML = '<span>Original Content</span>';
    });

    it('should hide logos, inject exit button, and update header center stats', () => {
      modeInstance.transformHeaderForPlanMode();

      expect(modeInstance.tihanLogo.style.display).toBe('none');
      expect(modeInstance.statusBadge.style.display).toBe('none');

      // Verify exit button was prepended to headerLeft
      const insertedExitBtn = modeInstance.headerLeft.firstChild;
      expect(insertedExitBtn).toBeTruthy();
      expect(insertedExitBtn.id).toBe('exitPlanBtn');

      // Verify stats divs were injected to headerCenter
      expect(modeInstance.headerCenter.querySelector('.plan-mission-stats')).toBeTruthy();
      expect(modeInstance.headerCenter.querySelector('.plan-total-mission')).toBeTruthy();
      
      // Verify original content dataset cache was stored
      expect(modeInstance.headerCenter.dataset.originalContent).toBe('<span>Original Content</span>');
    });

    it('should execute exit() route callback when exit button click is triggered', () => {
      modeInstance.transformHeaderForPlanMode();
      const exitBtn = modeInstance.headerLeft.querySelector('#exitPlanBtn');
      expect(exitBtn).toBeTruthy();

      exitBtn.click();
      expect(modeInstance.exit).toHaveBeenCalledTimes(1);
    });

    it('should clean up exit button, restore logos, and restore center content on restoreHeader', () => {
      modeInstance.transformHeaderForPlanMode();
      
      // Append elements to actual document body so getElementById can find exit button cleanly
      document.body.appendChild(modeInstance.headerLeft);

      expect(document.body.querySelector('#exitPlanBtn')).toBeTruthy();

      modeInstance.restoreHeader();

      expect(document.body.querySelector('#exitPlanBtn')).toBeNull();
      expect(modeInstance.tihanLogo.style.display).toBe('block');
      expect(modeInstance.statusBadge.style.display).toBe('flex');
      expect(modeInstance.headerCenter.innerHTML).toBe('<span>Original Content</span>');
    });
  });

  describe('Command Editor Integrations (createCommandEditor & removeCommandEditor)', () => {
    it('should delegate to window.CommandEditor component show/hide if defined', () => {
      window.CommandEditor = {
        show: jest.fn(),
        hide: jest.fn()
      };

      modeInstance.createCommandEditor();
      expect(window.CommandEditor.show).toHaveBeenCalledTimes(1);

      modeInstance.removeCommandEditor();
      expect(window.CommandEditor.hide).toHaveBeenCalledTimes(1);
    });

    it('should query #commandEditorPanel directly and toggle display style as fallback', () => {
      const panel = originalCreateElement.call(document, 'div');
      panel.id = 'commandEditorPanel';
      panel.style.display = 'none';
      document.body.appendChild(panel);

      modeInstance.createCommandEditor();
      expect(panel.style.display).toBe('flex');

      modeInstance.removeCommandEditor();
      expect(panel.style.display).toBe('none');
    });
  });

  describe('Menu Anchors click interception (attachMenuEventListeners)', () => {
    it('should intercept anchor click events, call preventDefault, and route action dataset to handleMenuAction', () => {
      const menuStrip = originalCreateElement.call(document, 'div');
      menuStrip.className = 'plan-menu-strip';
      
      const content = originalCreateElement.call(document, 'div');
      content.className = 'plan-menu-content';
      
      const link1 = originalCreateElement.call(document, 'a');
      link1.dataset.action = 'action-one';
      
      const link2 = originalCreateElement.call(document, 'a');
      link2.dataset.action = 'action-two';

      content.appendChild(link1);
      content.appendChild(link2);
      menuStrip.appendChild(content);

      modeInstance.planMenuStrip = menuStrip;

      modeInstance.attachMenuEventListeners();

      // Trigger real DOM event and verify e.preventDefault()
      const clickEvent = new window.MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });
      jest.spyOn(clickEvent, 'preventDefault');

      link1.dispatchEvent(clickEvent);
      
      expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(modeInstance.handleMenuAction).toHaveBeenCalledWith('action-one');
    });
  });
});