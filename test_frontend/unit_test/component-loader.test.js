describe('Component Loader Behavioral Test Suite', () => {
  let originalFetch;
  let eventDispatched = false;
  let componentIds = [
    'header-component',
    'flight-controls-component',
    'dropdown-menu-component',
    'plan-flight-menu-component',
    'command-editor-component',
    'message-console-component',
    'weather-dashboard-component',
    'takeoff-modal-component',
    'hud-display-component'
  ];

  beforeAll(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn();

    // Setup window event listener
    window.addEventListener('componentsLoaded', () => {
      eventDispatched = true;
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    eventDispatched = false;

    // Create target containers in DOM
    document.body.innerHTML = '';
    componentIds.forEach(id => {
      const container = document.createElement('div');
      container.id = id;
      document.body.appendChild(container);
    });
  });

  it('should fetch components and inject HTML content when DOM is ready', async () => {
    global.fetch.mockImplementation((url) => {
      const componentName = url.split('/').pop().split('.')[0];
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(`<!-- Mock HTML for ${componentName} -->`)
      });
    });

    // Load Script to trigger immediate execution
    global.loadScript('js/component-loader.js');

    // Wait for all promises/microtasks to resolve
    await Promise.resolve(); // map mapping
    await Promise.resolve(); // loadComponent promise resolution
    await Promise.resolve(); // Promise.all resolution
    await Promise.resolve(); // any subsequent ticks

    // Verify all 9 fetches were called
    expect(global.fetch).toHaveBeenCalledTimes(9);
    expect(global.fetch).toHaveBeenCalledWith('components/header.html');
    expect(global.fetch).toHaveBeenCalledWith('components/hud-display.html');

    // Verify DOM injection
    const headerComponent = document.getElementById('header-component');
    expect(headerComponent.innerHTML).toBe('<!-- Mock HTML for header -->');

    const hudComponent = document.getElementById('hud-display-component');
    expect(hudComponent.innerHTML).toBe('<!-- Mock HTML for hud-display -->');

    // Verify custom event dispatched
    expect(eventDispatched).toBe(true);
  });

  it('should handle fetch failures gracefully and log console error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch.mockImplementation((url) => {
      if (url.includes('header.html')) {
        return Promise.resolve({
          ok: false,
          status: 404
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<div>OK</div>')
      });
    });

    // Load script
    global.loadScript('js/component-loader.js');

    // Wait for promise resolution
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Header container should remain empty (or unmodified)
    const headerComponent = document.getElementById('header-component');
    expect(headerComponent.innerHTML).toBe('');

    // Other containers should succeed and get filled
    const hudComponent = document.getElementById('hud-display-component');
    expect(hudComponent.innerHTML).toBe('<div>OK</div>');

    // Check that console.error was called for the failed component
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error loading component header-component:'),
      expect.any(Error)
    );

    // Should still trigger event for the remaining loaded components
    expect(eventDispatched).toBe(true);

    errorSpy.mockRestore();
  });
});