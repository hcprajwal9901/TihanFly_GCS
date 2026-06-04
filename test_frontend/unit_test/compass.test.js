describe('Telemetry Display Overlay High-Fidelity Behavioral Test Suite (compass.js)', () => {
  beforeAll(() => {
    // Enable Jest fake timers
    jest.useFakeTimers();

    // Prepare JSDOM container elements
    const mapContainer = document.createElement('div');
    mapContainer.id = 'map';
    document.body.appendChild(mapContainer);

    // Delete mock class from setup.js so we load the real implementation
    delete global.CompassEnhanced;
    if (typeof window !== 'undefined') {
      delete window.CompassEnhanced;
    }

    // Load actual telemetry display compass script via global.loadScript
    global.loadScript('js/compass.js');
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  let compass;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clear any previous container leftovers
    document.querySelectorAll('.compass-telemetry-container').forEach(el => el.remove());

    // Recreate fresh instance
    const CompassClass = window.CompassEnhanced;
    compass = new CompassClass('map');
  });

  describe('Instantiation & DOM Layout', () => {
    it('should successfully append the compass-telemetry-container DOM to the map element', () => {
      const overlay = document.querySelector('.compass-telemetry-container');
      expect(overlay).toBeDefined();
      expect(overlay.querySelector('.gcs-compass-panel')).toBeDefined();
      expect(overlay.querySelector('.left-group')).toBeDefined();
      expect(overlay.querySelector('.right-group')).toBeDefined();
      expect(overlay.querySelector('#compassArrow')).toBeDefined();
    });

    it('should inject custom CSS styling into the document head', () => {
      const styles = document.querySelectorAll('style');
      let found = false;
      styles.forEach(s => {
        if (s.textContent.includes('.compass-telemetry-container')) found = true;
      });
      expect(found).toBe(true);
    });
  });

  describe('Needle Headings & Shortest-Path Rotations', () => {
    it('should set rotations angle and update heading golden labels', () => {
      compass.setHeading(90);
      expect(compass.getHeading()).toBe(90);
      expect(document.getElementById('headingValue').textContent).toBe('90°');
      expect(compass.compassElement.style.transform).toBe('translate(-50%, -50%) rotate(90deg)');
    });

    it('should normalize negative degrees and angles greater than 360', () => {
      compass.setHeading(-45); // normalized to 315
      expect(compass.getHeading()).toBe(315);
      expect(document.getElementById('headingValue').textContent).toBe('315°');

      compass.setHeading(400); // normalized to 40
      expect(compass.getHeading()).toBe(40);
      expect(document.getElementById('headingValue').textContent).toBe('40°');
    });

    it('should calculate shortest path rotation diffs to avoid backwards spins when crossing 360 boundary', () => {
      // Starting heading: 350
      compass.setHeading(350);
      expect(compass.compassElement.style.transform).toBe('translate(-50%, -50%) rotate(-10deg)');

      // Set to 10. The shortest distance is +20 deg (from 350 -> 360/0 -> 10).
      // Standard spin would decrease by 340 deg.
      // Shortest-path should increase rotation property to 10 deg.
      compass.setHeading(10);
      expect(compass.compassElement.style.transform).toBe('translate(-50%, -50%) rotate(10deg)');
      expect(compass.getHeading()).toBe(10);
    });
  });

  describe('Telemetry Updates & Unit Conversions', () => {
    it('should update float and integer elements coordinates', () => {
      compass.updateTelemetry({
        latitude: 17.601234,
        longitude: 78.126567,
        altitude: 45.28,
        speed: 12.34,
        satellites: 11
      });

      expect(document.getElementById('latValue').textContent).toBe('17.601234');
      expect(document.getElementById('lonValue').textContent).toBe('78.126567');
      expect(document.getElementById('altValue').textContent).toBe('45.3');
      expect(document.getElementById('spdValue').textContent).toBe('12.3');
      expect(document.getElementById('satValue').textContent).toBe('11');

      expect(compass.getTelemetry()).toEqual({
        latitude: 17.601234,
        longitude: 78.126567,
        altitude: 45.28,
        speed: 12.34,
        satellites: 11,
        distance: 0
      });
    });

    it('should automatically convert meters to kilometers if distance is >= 1000m', () => {
      const distVal = document.getElementById('distValue');

      // Distance under 1000m shows rounded integer meters
      compass.updateTelemetry({ distance: 450.6 });
      expect(distVal.textContent).toBe('451');
      expect(distVal.nextElementSibling.textContent).toBe('m');

      // Distance over 1000m shows km representation with two decimal places
      compass.updateTelemetry({ distance: 2548 });
      expect(distVal.textContent).toBe('2.55');
      expect(distVal.nextElementSibling.textContent).toBe('km');
    });
  });

  describe('Interval Rotation & Controls', () => {
    it('should set an interval for active rotation', () => {
      const spySet = jest.spyOn(compass, 'setHeading');
      
      compass.startRotation(2); // rotates +2 deg per tick
      
      jest.advanceTimersByTime(100); // 2 intervals (50ms each)
      
      expect(spySet).toHaveBeenCalledTimes(2);
      compass.stopRotation();
    });

    it('should control container visibility show, hide and destroy bindings', () => {
      const overlay = document.querySelector('.compass-telemetry-container');
      
      compass.hide();
      expect(overlay.style.display).toBe('none');

      compass.show();
      expect(overlay.style.display).toBe('block');

      compass.destroy();
      expect(document.body.innerHTML.includes('compass-telemetry-container')).toBe(false);
    });
  });
});