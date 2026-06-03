describe('Minimal Message Console Behavioral Test Suite', () => {
  let container;
  let panelContainer;

  beforeAll(() => {
    jest.useFakeTimers();
    // Load Script once
    global.loadScript('js/messaage-console.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup DOM elements
    document.body.innerHTML = `
      <div class="minimal-console-container" style="display: none;">
        <div id="minimalConsoleMessages"></div>
      </div>
    `;
    container = document.getElementById('minimalConsoleMessages');
    panelContainer = document.querySelector('.minimal-console-container');

    // Reset the message list in the console instance if it exists
    if (window.MsgConsole && window.MsgConsole.clear) {
      window.MsgConsole.clear();
      // Access the internal console to reset options/autoScroll
      const consoleInstance = window.initializeMinimalConsole();
      consoleInstance.messagesContainer = container;
      consoleInstance.autoScrollEnabled = true;
      consoleInstance.messages = [];
    }
  });

  it('should auto-initialize MinimalMessageConsole and define window.MsgConsole', () => {
    expect(window.MsgConsole).toBeDefined();
    expect(typeof window.MsgConsole.success).toBe('function');
  });

  describe('Message Creation and Rendering', () => {
    it('should add an info message to the console by default', () => {
      window.MsgConsole.log('Normal info log message');

      const messageElements = container.querySelectorAll('.minimal-console-message');
      expect(messageElements.length).toBe(1);

      const msgEl = messageElements[0];
      expect(msgEl.className).toContain('info');
      expect(msgEl.querySelector('.minimal-message-icon').textContent).toBe('ℹ');
      expect(msgEl.querySelector('.minimal-message-text').textContent).toBe('Normal info log message');
      expect(msgEl.querySelector('.minimal-message-time')).toBeDefined();
    });

    it('should escape HTML strings correctly to prevent XSS injection', () => {
      window.MsgConsole.error('<script>alert("hack")</script> & testing');

      const msgTextEl = container.querySelector('.minimal-message-text');
      // Should show escaped HTML content in innerHTML
      expect(msgTextEl.innerHTML).toBe('&lt;script&gt;alert("hack")&lt;/script&gt; &amp; testing');
      expect(msgTextEl.textContent).toBe('<script>alert("hack")</script> & testing');
    });

    it('should support severity shortcuts (success, warning, error, info)', () => {
      window.MsgConsole.success('Done successfully');
      window.MsgConsole.warning('Warning message');
      window.MsgConsole.error('Fatal error');
      window.MsgConsole.info('Information note');

      const messages = container.querySelectorAll('.minimal-console-message');
      expect(messages.length).toBe(4);

      expect(messages[0].className).toContain('success');
      expect(messages[0].querySelector('.minimal-message-icon').textContent).toBe('✓');

      expect(messages[1].className).toContain('warning');
      expect(messages[1].querySelector('.minimal-message-icon').textContent).toBe('⚠');

      expect(messages[2].className).toContain('error');
      expect(messages[2].querySelector('.minimal-message-icon').textContent).toBe('✗');

      expect(messages[3].className).toContain('info');
      expect(messages[3].querySelector('.minimal-message-icon').textContent).toBe('ℹ');
    });

    it('should respect maximum message buffer limit (50 messages) and drop oldest', () => {
      // Access direct console instance if possible via window.MsgConsole.getMessages()
      // Let's add 55 messages
      for (let i = 1; i <= 55; i++) {
        window.MsgConsole.log(`Message number ${i}`);
      }

      const elements = container.querySelectorAll('.minimal-console-message');
      expect(elements.length).toBe(50);
      expect(window.MsgConsole.getMessages().length).toBe(50);

      // Oldest message should be "Message number 6"
      expect(elements[0].querySelector('.minimal-message-text').textContent).toBe('Message number 6');
      // Newest message should be "Message number 55"
      expect(elements[49].querySelector('.minimal-message-text').textContent).toBe('Message number 55');
    });
  });

  describe('Flight Command Shortcuts', () => {
    it('should format ARM message correctly', () => {
      window.MsgConsole.arm('Armed vehicle');
      const el = container.querySelector('.minimal-console-message');
      expect(el.className).toContain('success');
      expect(el.querySelector('.minimal-message-text').textContent).toBe('🔓 Armed vehicle');
    });

    it('should format DISARM message correctly', () => {
      window.MsgConsole.disarm('Disarmed vehicle');
      const el = container.querySelector('.minimal-console-message');
      expect(el.className).toContain('success');
      expect(el.querySelector('.minimal-message-text').textContent).toBe('🔒 Disarmed vehicle');
    });

    it('should format TAKEOFF message correctly', () => {
      window.MsgConsole.takeoff(15);
      const el = container.querySelector('.minimal-console-message');
      expect(el.className).toContain('success');
      expect(el.querySelector('.minimal-message-text').textContent).toBe('🚁 Takeoff initiated - Target altitude: 15m');
    });

    it('should format LAND message correctly', () => {
      window.MsgConsole.land('Landing drone now');
      const el = container.querySelector('.minimal-console-message');
      expect(el.className).toContain('success');
      expect(el.querySelector('.minimal-message-text').textContent).toBe('🛬 Landing drone now');
    });

    it('should format RTL message correctly', () => {
      window.MsgConsole.rtl('RTL mode triggered');
      const el = container.querySelector('.minimal-console-message');
      expect(el.className).toContain('success');
      expect(el.querySelector('.minimal-message-text').textContent).toBe('🏠 RTL mode triggered');
    });
  });

  describe('Helper Console Operations', () => {
    it('should clear messages from array and DOM element', () => {
      window.MsgConsole.log('Message 1');
      window.MsgConsole.log('Message 2');
      expect(container.children.length).toBe(2);

      window.MsgConsole.clear();
      expect(container.children.length).toBe(0);
      expect(window.MsgConsole.getMessages().length).toBe(0);
    });

    it('should toggle console visibility (show / hide)', () => {
      window.MsgConsole.show();
      expect(panelContainer.style.display).toBe('flex');

      window.MsgConsole.hide();
      expect(panelContainer.style.display).toBe('none');
    });
  });

  describe('Flight Controls Integration Hooks', () => {
    let takeoffCallback;
    let landCallback;
    let rtlCallback;

    beforeEach(() => {
      // Mock window.flightControls
      window.flightControls = {
        onTakeoff: jest.fn(cb => { takeoffCallback = cb; }),
        onLand: jest.fn(cb => { landCallback = cb; }),
        onRTL: jest.fn(cb => { rtlCallback = cb; })
      };

      // Re-trigger script load to setup DOMContentLoaded listeners & timeouts
      // In this setup, we can dispatch DOMContentLoaded on document
      document.dispatchEvent(new Event('DOMContentLoaded'));
      jest.advanceTimersByTime(1100); // Wait for the 1000ms delay hook
    });

    afterEach(() => {
      delete window.flightControls;
    });

    it('should hook flightControls listeners and log messages on callbacks', () => {
      expect(window.flightControls.onTakeoff).toHaveBeenCalled();
      expect(window.flightControls.onLand).toHaveBeenCalled();
      expect(window.flightControls.onRTL).toHaveBeenCalled();

      // Trigger takeoff callback
      takeoffCallback({ altitude: 25 });
      let message = container.querySelector('.minimal-console-message');
      expect(message.querySelector('.minimal-message-text').textContent).toBe('🚁 Takeoff initiated - Target altitude: 25m');

      // Trigger land callback
      landCallback();
      let messages = container.querySelectorAll('.minimal-console-message');
      expect(messages[1].querySelector('.minimal-message-text').textContent).toBe('🛬 Landing sequence initiated');

      // Trigger RTL callback
      rtlCallback();
      messages = container.querySelectorAll('.minimal-console-message');
      expect(messages[2].querySelector('.minimal-message-text').textContent).toBe('🏠 Return to launch activated');
    });
  });
});