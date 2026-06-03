describe('Command Editor Panel High-Fidelity Behavioral Test Suite (command-editor.js)', () => {
  let editorInstance;

  beforeAll(() => {
    // Enable fake timers
    jest.useFakeTimers();

    // Stub window confirmation dialogs
    window.confirm = jest.fn().mockReturnValue(true);

    // Mock console messages
    window.MsgConsole = {
      success: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn()
    };

    // Prepare complete DOM tree that matches CommandEditor UI expectations perfectly
    document.body.innerHTML = `
      <div id="commandEditorPanel" style="display: none;">
        <!-- Tabs bar -->
        <div class="editor-tab active" data-tab="mission">Mission</div>
        <div class="editor-tab" data-tab="waypoints">Waypoints</div>
        <div class="editor-tab" data-tab="fence">Fence</div>
        <div class="editor-tab" data-tab="rally">Rally</div>

        <!-- Panels -->
        <div id="missionPanel" class="tab-panel active" style="display: block;"></div>
        
        <div id="waypointsPanel" class="tab-panel" style="display: none;">
          <button id="refreshWaypointsBtn">Refresh</button>
          <span id="waypointCountDisplay">0 Waypoints</span>
          <div id="emptyWaypointState" style="display: block;">No waypoints planned yet.</div>
          <div id="waypointList" style="display: none;"></div>
        </div>

        <div id="waypointDetailsPanel" style="display: none;">
          <h3 id="editingWaypointTitle">Waypoint 1</h3>
          <input id="waypointIdField" type="hidden" />
          <div class="form-group">
            <label>Latitude</label>
            <input id="waypointLatField" class="form-control" type="number" step="any" />
          </div>
          <div class="form-group">
            <label>Longitude</label>
            <input id="waypointLngField" class="form-control" type="number" step="any" />
          </div>
          <div class="form-group">
            <label>Altitude</label>
            <input id="waypointAltField" class="form-control" type="number" />
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="waypointTypeField" class="form-control">
              <option value="waypoint">Waypoint</option>
              <option value="takeoff">Takeoff</option>
              <option value="land">Land</option>
            </select>
          </div>
          <button id="backToListBtn">Back</button>
          <button id="saveWaypointBtn">Save</button>
          <button id="deleteWaypointBtn">Delete</button>
        </div>

        <div id="fencePanel" class="tab-panel" style="display: none;">
          <div class="fence-list-section" style="display: block;">
            <button id="refreshFenceBtn">Refresh Fence</button>
            <span id="fenceCountDisplay">0 Fences</span>
            <div id="emptyFenceState" style="display: block;">No fences created yet.</div>
            <div id="fenceList" style="display: none;"></div>
          </div>
          
          <div id="fenceDetailsPanel" style="display: none;">
            <h3 id="editingFenceTitle">Fence 1</h3>
            <input id="fenceIdField" type="hidden" />
            <input id="fenceTypeField" class="form-control" />
            <input id="fencePointCountField" class="form-control" readonly />
            <button id="backToFenceListBtn">Back</button>
            <button id="saveFenceBtn">Save</button>
            <button id="deleteFenceBtn">Delete</button>
          </div>
        </div>

        <div id="rallyPanel" class="tab-panel" style="display: none;">
          <div class="rally-list-section" style="display: block;">
            <button id="refreshRallyBtn">Refresh Rally</button>
            <span id="rallyCountDisplay">0 Rally Points</span>
            <div id="emptyRallyState" style="display: block;">No rally points created yet.</div>
            <div id="rallyList" style="display: none;"></div>
          </div>
          
          <div id="rallyDetailsPanel" style="display: none;">
            <h3 id="editingRallyTitle">Rally Point 1</h3>
            <input id="rallyIdField" type="hidden" />
            <div class="form-group">
              <label>Lat</label>
              <input id="rallyLatField" class="form-control" type="number" step="any" />
            </div>
            <div class="form-group">
              <label>Lng</label>
              <input id="rallyLngField" class="form-control" type="number" step="any" />
            </div>
            <div class="form-group">
              <label>Alt</label>
              <input id="rallyAltField" class="form-control" type="number" />
            </div>
            <button id="backToRallyListBtn">Back</button>
            <button id="saveRallyBtn">Save</button>
            <button id="deleteRallyBtn">Delete</button>
          </div>
        </div>

        <!-- Checkboxes testing -->
        <label><input type="checkbox" id="testCheckbox" /> Enable Fence</label>
      </div>
    `;

    // Load actual Command Editor script
    global.loadScript('js/command-editor.js');

    // Trigger DOMContentLoaded listener manually to instantiate the editor
    document.dispatchEvent(new Event('DOMContentLoaded'));
    editorInstance = window.CommandEditor;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset list containers
    const waypointList = document.getElementById('waypointList');
    if (waypointList) waypointList.innerHTML = '';
    const fenceList = document.getElementById('fenceList');
    if (fenceList) fenceList.innerHTML = '';
    const rallyList = document.getElementById('rallyList');
    if (rallyList) rallyList.innerHTML = '';

    // Reset views display styling
    const panels = ['waypointsPanel', 'waypointDetailsPanel', 'fenceDetailsPanel', 'rallyDetailsPanel'];
    panels.forEach(p => {
      const el = document.getElementById(p);
      if (el) el.style.display = 'none';
    });

    const countDisplay = document.getElementById('waypointCountDisplay');
    if (countDisplay) countDisplay.textContent = '0 Waypoints';
    
    const emptyState = document.getElementById('emptyWaypointState');
    if (emptyState) emptyState.style.display = 'block';

    if (editorInstance) {
      editorInstance.hide();
    }
  });

  describe('Instantiation & DOM Bindings', () => {
    it('should successfully register CommandEditor on window and hide initially', () => {
      expect(editorInstance).toBeDefined();
      expect(editorInstance.isVisible()).toBe(false);
      expect(document.getElementById('commandEditorPanel').style.display).toBe('none');
    });

    it('should control panel visibility state show and hide APIs', () => {
      editorInstance.show();
      expect(editorInstance.isVisible()).toBe(true);
      expect(document.getElementById('commandEditorPanel').style.display).toBe('flex');

      editorInstance.hide();
      expect(editorInstance.isVisible()).toBe(false);
      expect(document.getElementById('commandEditorPanel').style.display).toBe('none');
    });
  });

  describe('Tab Switching Mechanism', () => {
    it('should toggle active classes and display properties when switching tabs', () => {
      editorInstance.show();

      // Switch to Waypoints Tab
      editorInstance.switchTab('waypoints');

      const waypointsTab = document.querySelector('[data-tab="waypoints"]');
      const missionTab = document.querySelector('[data-tab="mission"]');
      
      expect(waypointsTab.classList.contains('active')).toBe(true);
      expect(missionTab.classList.contains('active')).toBe(false);

      expect(document.getElementById('waypointsPanel').style.display).toBe('block');
      expect(document.getElementById('missionPanel').style.display).toBe('none');
    });

    it('should switch tabs dynamically when tab elements are clicked in JSDOM', () => {
      editorInstance.show();
      
      const fenceTab = document.querySelector('[data-tab="fence"]');
      fenceTab.click();

      expect(fenceTab.classList.contains('active')).toBe(true);
      expect(document.getElementById('fencePanel').style.display).toBe('block');
    });
  });

  describe('Form Control Event Handlers', () => {
    it('should output changes to consoles when form controls change', () => {
      const spyConsole = jest.spyOn(console, 'log');
      const input = document.getElementById('waypointLatField');
      
      input.value = '17.601234';
      input.dispatchEvent(new Event('change'));

      expect(spyConsole).toHaveBeenCalledWith(expect.stringContaining('Form changed: Latitude = 17.601234'));
      spyConsole.mockRestore();
    });

    it('should output changes to consoles when checkboxes toggle states', () => {
      const spyConsole = jest.spyOn(console, 'log');
      const checkbox = document.getElementById('testCheckbox');

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(spyConsole).toHaveBeenCalledWith(expect.stringContaining('Checkbox changed: Enable Fence = true'));
      spyConsole.mockRestore();
    });
  });

  describe('Waypoint Management & Syncing', () => {
    let mockWaypointManager;

    beforeEach(() => {
      mockWaypointManager = {
        waypoints: [
          {
            id: 101,
            type: 'takeoff',
            lat: 17.601,
            lng: 78.125,
            altitude: 10,
            marker: {
              setLatLng: jest.fn()
            }
          },
          {
            id: 102,
            type: 'waypoint',
            lat: 17.602,
            lng: 78.126,
            altitude: 50,
            marker: {
              setLatLng: jest.fn()
            }
          }
        ],
        removeWaypoint: jest.fn(),
        updateRoute: jest.fn(),
        updateStats: jest.fn()
      };

      editorInstance.setWaypointManager(mockWaypointManager);
    });

    it('should refresh count display and render rows correctly', () => {
      const countDisplay = document.getElementById('waypointCountDisplay');
      const list = document.getElementById('waypointList');
      const emptyState = document.getElementById('emptyWaypointState');

      expect(countDisplay.textContent).toBe('2 Waypoints');
      expect(emptyState.style.display).toBe('none');
      expect(list.style.display).toBe('flex');

      const items = list.querySelectorAll('.waypoint-item');
      expect(items.length).toBe(2);
      expect(items[0].querySelector('.waypoint-item-number').textContent).toBe('WP 1');
      expect(items[0].querySelector('.waypoint-item-type').textContent).toBe('Takeoff');
    });

    it('should open edit panel with loaded parameters on clicking waypoint', () => {
      const list = document.getElementById('waypointList');
      const firstWP = list.querySelector('.waypoint-item');
      
      firstWP.click();

      expect(document.getElementById('waypointsPanel').style.display).toBe('none');
      expect(document.getElementById('waypointDetailsPanel').style.display).toBe('block');
      expect(document.getElementById('editingWaypointTitle').textContent).toBe('Waypoint 1');
      expect(document.getElementById('waypointIdField').value).toBe('101');
      expect(document.getElementById('waypointLatField').value).toBe('17.601');
      expect(document.getElementById('waypointTypeField').value).toBe('takeoff');
      
      // Since index 0 is takeoff, the typeField should be disabled
      expect(document.getElementById('waypointTypeField').disabled).toBe(true);
    });

    it('should update waypoint variables, invoke routes recalculations and markers moves on save', () => {
      // Edit second waypoint (index 1)
      editorInstance.switchTab('waypoints');
      editorInstance.refreshWaypoints();
      
      const secondWP = document.getElementById('waypointList').querySelectorAll('.waypoint-item')[1];
      secondWP.click();

      // Verify second waypoint typeField is NOT disabled
      expect(document.getElementById('waypointTypeField').disabled).toBe(false);

      // Modify values
      document.getElementById('waypointLatField').value = '17.608';
      document.getElementById('waypointLngField').value = '78.129';
      document.getElementById('waypointAltField').value = '35';
      document.getElementById('waypointTypeField').value = 'land';

      document.getElementById('saveWaypointBtn').click();

      // Check model changes
      const targetWP = mockWaypointManager.waypoints[1];
      expect(targetWP.lat).toBe(17.608);
      expect(targetWP.lng).toBe(78.129);
      expect(targetWP.altitude).toBe(35);
      expect(targetWP.type).toBe('land');

      // Check Leaflet updates
      expect(targetWP.marker.setLatLng).toHaveBeenCalledWith([17.608, 78.129]);
      expect(mockWaypointManager.updateRoute).toHaveBeenCalledTimes(1);
      expect(mockWaypointManager.updateStats).toHaveBeenCalledTimes(1);

      // Check state transitions back to list
      expect(document.getElementById('waypointsPanel').style.display).toBe('block');
      expect(document.getElementById('waypointDetailsPanel').style.display).toBe('none');
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Waypoint 102 updated');
    });

    it('should delete waypoint and notify on delete confirmation', () => {
      editorInstance.switchTab('waypoints');
      editorInstance.refreshWaypoints();
      
      const secondWP = document.getElementById('waypointList').querySelectorAll('.waypoint-item')[1];
      secondWP.click();

      document.getElementById('deleteWaypointBtn').click();

      expect(window.confirm).toHaveBeenCalledWith('Delete waypoint 102?');
      expect(mockWaypointManager.removeWaypoint).toHaveBeenCalledWith(102);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Waypoint 102 deleted');
      expect(document.getElementById('waypointsPanel').style.display).toBe('block');
    });
  });

  describe('Fence Management integrations', () => {
    beforeEach(() => {
      window.PolygonManager = {
        polygons: [
          {
            id: 'FENCE_01',
            points: [
              { lat: 17.6, lng: 78.1 },
              { lat: 17.7, lng: 78.1 },
              { lat: 17.7, lng: 78.2 }
            ]
          }
        ],
        clearPolygon: jest.fn()
      };
      editorInstance.setPolygonManager(window.PolygonManager);
    });

    afterEach(() => {
      delete window.PolygonManager;
    });

    it('should populate fences table rows and details', () => {
      editorInstance.switchTab('fence');
      jest.advanceTimersByTime(100);

      expect(document.getElementById('fenceCountDisplay').textContent).toBe('1 Fence');
      
      const items = document.getElementById('fenceList').querySelectorAll('.fence-item');
      expect(items.length).toBe(1);
      expect(items[0].querySelector('.fence-item-number').textContent).toBe('🚧 Fence 1');

      // Click to edit
      items[0].click();
      expect(document.getElementById('editingFenceTitle').textContent).toBe('Fence FENCE_01');
      expect(document.getElementById('fenceIdField').value).toBe('FENCE_01');
      expect(document.getElementById('fencePointCountField').value).toBe('3');
    });

    it('should invoke clearPolygon on deleting fence', () => {
      editorInstance.switchTab('fence');
      jest.advanceTimersByTime(100);
      
      document.getElementById('fenceList').querySelector('.fence-item').click();
      document.getElementById('deleteFenceBtn').click();

      expect(window.confirm).toHaveBeenCalledWith('Delete this fence?');
      expect(window.PolygonManager.clearPolygon).toHaveBeenCalledTimes(1);
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Fence deleted');
    });
  });

  describe('Rally Points operations', () => {
    it('should support adding, editing, and deleting rally points locally', () => {
      editorInstance.switchTab('rally');
      
      // 1. Add Rally Point
      editorInstance.addRallyPoint(17.6015, 78.1255, 45);

      expect(document.getElementById('rallyCountDisplay').textContent).toBe('1 Rally Point');
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Rally point 1 added');

      const items = document.getElementById('rallyList').querySelectorAll('.rally-item');
      expect(items.length).toBe(1);
      expect(items[0].querySelector('.rally-item-number').textContent).toBe('📍 Rally 1');

      // 2. Edit Rally Point
      items[0].click();
      expect(document.getElementById('rallyIdField').value).toBe('1');
      expect(document.getElementById('rallyLatField').value).toBe('17.6015');

      document.getElementById('rallyLatField').value = '17.6019';
      document.getElementById('rallyLngField').value = '78.1259';
      document.getElementById('rallyAltField').value = '60';

      document.getElementById('saveRallyBtn').click();
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Rally point updated');

      // 3. Delete Rally Point
      document.getElementById('rallyList').querySelector('.rally-item').click();
      document.getElementById('deleteRallyBtn').click();

      expect(window.confirm).toHaveBeenCalledWith('Delete this rally point?');
      expect(document.getElementById('rallyCountDisplay').textContent).toBe('0 Rally Points');
      expect(window.MsgConsole.success).toHaveBeenCalledWith('Rally point deleted');
    });
  });
});