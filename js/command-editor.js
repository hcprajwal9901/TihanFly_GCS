/**
 * Command Editor Panel Handler - COMPLETE VERSION
 * Manages Mission, Waypoints, Fence, and Rally tabs
 */

class CommandEditor {
    constructor() {
        console.log('📋 CommandEditor constructor called');
        
        this.panel = null;
        this.currentTab = 'mission';
        this.selectedWaypointId = null;
        this.selectedFenceId = null;
        this.selectedRallyId = null;
        this.waypointManager = null;
        this.polygonManager = null; // For fences
        this.rallyPoints = []; // Store rally points
        
        this.initialize();
    }

    initialize() {
        console.log('📋 Initializing Command Editor...');
        
        this.panel = document.getElementById('commandEditorPanel');
        
        if (!this.panel) {
            console.error('❌ Command editor panel not found');
            return;
        }
        
        console.log('✅ Command editor panel found');
        this.hide();
        
        this.attachTabListeners();
        this.attachFormListeners();
        this.attachWaypointListeners();
        this.attachFenceListeners();
        this.attachRallyListeners();
        
        console.log('✅ Command Editor initialized');
    }

    // ========================================================================
    // SHOW/HIDE METHODS
    // ========================================================================
    
    show() {
        if (!this.panel) return;
        this.panel.style.display = 'flex';
        console.log('✅ Command editor shown');
    }
    
    hide() {
        if (!this.panel) return;
        this.panel.style.display = 'none';
        console.log('✅ Command editor hidden');
    }
    
    isVisible() {
        if (!this.panel) return false;
        return this.panel.style.display === 'flex';
    }

    // ========================================================================
    // TAB SWITCHING
    // ========================================================================
    
    attachTabListeners() {
        if (!this.panel) return;
        
        const tabs = this.panel.querySelectorAll('.editor-tab');
        console.log(`Found ${tabs.length} editor tabs`);
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                console.log(`Tab clicked: ${tabName}`);
                this.switchTab(tabName);
            });
        });
        
        console.log('✅ Tab listeners attached');
    }
    
    switchTab(tabName) {
        if (!this.panel) return;
        
        console.log(`Switching to tab: ${tabName}`);
        this.currentTab = tabName;
        
        // Remove active class from all tabs and panels
        this.panel.querySelectorAll('.editor-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        this.panel.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
            panel.style.display = 'none';
        });
        
        // Activate selected tab
        const selectedTab = this.panel.querySelector(`[data-tab="${tabName}"]`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }
        
        const selectedPanel = document.getElementById(`${tabName}Panel`);
        if (selectedPanel) {
            selectedPanel.classList.add('active');
            selectedPanel.style.display = 'block';
        }
        
        // Refresh data based on tab
        if (tabName === 'waypoints') {
            setTimeout(() => this.refreshWaypointList(), 100);
        } else if (tabName === 'fence') {
            setTimeout(() => this.refreshFenceList(), 100);
        } else if (tabName === 'rally') {
            setTimeout(() => this.refreshRallyList(), 100);
        }
        
        console.log(`✅ Switched to ${tabName} tab`);
    }

    // ========================================================================
    // FORM INTERACTIONS
    // ========================================================================
    
    attachFormListeners() {
        if (!this.panel) return;
        
        const formControls = this.panel.querySelectorAll('.form-control');
        console.log(`Found ${formControls.length} form controls`);
        
        formControls.forEach(control => {
            control.addEventListener('change', (e) => {
                this.handleFormChange(e.target);
            });
        });
        
        const checkboxes = this.panel.querySelectorAll('input[type="checkbox"]');
        console.log(`Found ${checkboxes.length} checkboxes`);
        
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.handleCheckboxChange(e.target);
            });
        });
        
        console.log('✅ Form listeners attached');
    }
    
    handleFormChange(control) {
        const label = control.previousElementSibling?.textContent || 'Unknown';
        const value = control.value;
        console.log(`Form changed: ${label} = ${value}`);
    }
    
    handleCheckboxChange(checkbox) {
        const label = checkbox.parentElement?.textContent.trim() || 'Unknown';
        const checked = checkbox.checked;
        console.log(`Checkbox changed: ${label} = ${checked}`);
    }

    // ========================================================================
    // WAYPOINT MANAGEMENT
    // ========================================================================
    
    attachWaypointListeners() {
        if (!this.panel) return;
        
        const refreshBtn = document.getElementById('refreshWaypointsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log('🔄 Refresh waypoints button clicked');
                this.refreshWaypointList();
            });
        }
        
        const backBtn = document.getElementById('backToListBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                console.log('⬅️ Back to list button clicked');
                this.showWaypointList();
            });
        }
        
        const saveBtn = document.getElementById('saveWaypointBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                console.log('💾 Save waypoint button clicked');
                this.saveWaypointChanges();
            });
        }
        
        const deleteBtn = document.getElementById('deleteWaypointBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                console.log('🗑️ Delete waypoint button clicked');
                this.deleteSelectedWaypoint();
            });
        }
        
        console.log('✅ Waypoint listeners attached');
    }
    
    setWaypointManager(waypointManager) {
        this.waypointManager = waypointManager;
        console.log('✅ Waypoint manager set in Command Editor');
        this.refreshWaypointList();
    }
    
    refreshWaypointList() {
        console.log('🔄 Refreshing waypoint list...');
        
        // Auto-wire from global if not explicitly set yet (e.g. during data restoration)
        if (!this.waypointManager) {
            if (window.WaypointManager) {
                console.log('⚡ Auto-wiring WaypointManager from global scope');
                this.waypointManager = window.WaypointManager;
            } else {
                console.warn('⚠️ Waypoint manager not set yet, skipping refresh');
                return;
            }
        }
        
        const waypoints = this.waypointManager.getWaypoints ? 
                          this.waypointManager.getWaypoints() : 
                          this.waypointManager.waypoints;
        
        console.log(`📊 Found ${waypoints.length} waypoints to display`);
        
        const waypointList = document.getElementById('waypointList');
        const emptyState = document.getElementById('emptyWaypointState');
        const countDisplay = document.getElementById('waypointCountDisplay');
        
        if (!waypointList || !emptyState || !countDisplay) {
            console.error('❌ Waypoint list elements not found');
            return;
        }
        
        countDisplay.textContent = `${waypoints.length} Waypoint${waypoints.length !== 1 ? 's' : ''}`;
        
        if (waypoints.length === 0) {
            emptyState.style.display = 'block';
            waypointList.style.display = 'none';
            return;
        }
        
        emptyState.style.display = 'none';
        waypointList.style.display = 'flex';
        waypointList.innerHTML = '';
        
        waypoints.forEach((waypoint, index) => {
            const item = this.createWaypointListItem(waypoint, index + 1);
            waypointList.appendChild(item);
        });
        
        console.log(`✅ Displayed ${waypoints.length} waypoints`);
    }
    
    createWaypointListItem(waypoint, displayNumber) {
        const item = document.createElement('div');
        item.className = 'waypoint-item';
        item.dataset.waypointId = waypoint.id;
        
        const type = waypoint.type || 'waypoint';
        const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        
        item.innerHTML = `
            <div class="waypoint-item-header">
                <span class="waypoint-item-number">WP ${displayNumber}</span>
                <span class="waypoint-item-type">${typeLabel}</span>
            </div>
            <div class="waypoint-item-coords">
                <div><strong>Lat:</strong> <span>${waypoint.lat.toFixed(6)}</span></div>
                <div><strong>Lng:</strong> <span>${waypoint.lng.toFixed(6)}</span></div>
                <div><strong>Alt:</strong> <span>${waypoint.altitude}m</span></div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            console.log(`📍 Waypoint ${waypoint.id} clicked`);
            this.editWaypoint(waypoint.id);
        });
        
        return item;
    }
    
    showWaypointList() {
        const waypointsPanel = document.getElementById('waypointsPanel');
        const detailsPanel = document.getElementById('waypointDetailsPanel');
        
        if (waypointsPanel) waypointsPanel.style.display = 'block';
        if (detailsPanel) detailsPanel.style.display = 'none';
        
        const typeField = document.getElementById('waypointTypeField');
        if (typeField) {
            typeField.disabled = false;
        }
        
        this.selectedWaypointId = null;
    }
    
    editWaypoint(waypointId) {
        if (!this.waypointManager) return;
        
        const waypoint = this.waypointManager.waypoints.find(wp => wp.id === waypointId);
        if (!waypoint) return;
        
        this.selectedWaypointId = waypointId;
        
        const waypointsPanel = document.getElementById('waypointsPanel');
        const detailsPanel = document.getElementById('waypointDetailsPanel');
        
        if (waypointsPanel) waypointsPanel.style.display = 'none';
        if (detailsPanel) detailsPanel.style.display = 'block';
        
        const waypointIndex = this.waypointManager.waypoints.findIndex(wp => wp.id === waypointId);
        document.getElementById('editingWaypointTitle').textContent = `Waypoint ${waypointIndex + 1}`;
        document.getElementById('waypointIdField').value = waypoint.id;
        document.getElementById('waypointLatField').value = waypoint.lat;
        document.getElementById('waypointLngField').value = waypoint.lng;
        document.getElementById('waypointAltField').value = waypoint.altitude || 50;
        
        const typeField = document.getElementById('waypointTypeField');
        if (typeField) {
            typeField.value = waypoint.type || 'waypoint';
            const isFirstTakeoff = waypointIndex === 0 && waypoint.type === 'takeoff';
            typeField.disabled = isFirstTakeoff;
        }
    }
    
    saveWaypointChanges() {
        if (!this.waypointManager || this.selectedWaypointId === null) return;
        
        const waypoint = this.waypointManager.waypoints.find(wp => wp.id === this.selectedWaypointId);
        if (!waypoint) return;
        
        const newLat = parseFloat(document.getElementById('waypointLatField').value);
        const newLng = parseFloat(document.getElementById('waypointLngField').value);
        const newAlt = parseFloat(document.getElementById('waypointAltField').value);
        const newType = document.getElementById('waypointTypeField').value;
        
        if (isNaN(newLat) || isNaN(newLng) || isNaN(newAlt)) {
            if (window.MsgConsole) {
                window.MsgConsole.error('Invalid coordinates or altitude');
            }
            return;
        }
        
        waypoint.lat = newLat;
        waypoint.lng = newLng;
        waypoint.altitude = newAlt;
        
        const isFirstTakeoff = this.waypointManager.waypoints[0]?.id === this.selectedWaypointId && waypoint.type === 'takeoff';
        if (isFirstTakeoff) {
            waypoint.type = 'takeoff';
        } else {
            waypoint.type = newType;
        }
        
        if (waypoint.marker) {
            waypoint.marker.setLatLng([newLat, newLng]);
        }
        
        if (this.waypointManager.updateRoute) {
            this.waypointManager.updateRoute();
        }
        if (this.waypointManager.updateStats) {
            this.waypointManager.updateStats();
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${waypoint.id} updated`);
        }
        
        this.showWaypointList();
        this.refreshWaypointList();
    }
    
    deleteSelectedWaypoint() {
        if (!this.waypointManager || this.selectedWaypointId === null) return;
        
        if (!confirm(`Delete waypoint ${this.selectedWaypointId}?`)) {
            return;
        }
        
        if (this.waypointManager.removeWaypoint) {
            this.waypointManager.removeWaypoint(this.selectedWaypointId);
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`Waypoint ${this.selectedWaypointId} deleted`);
        }
        
        this.showWaypointList();
        this.refreshWaypointList();
    }

    // ========================================================================
    // FENCE MANAGEMENT
    // ========================================================================
    
    attachFenceListeners() {
        const refreshFenceBtn = document.getElementById('refreshFenceBtn');
        if (refreshFenceBtn) {
            refreshFenceBtn.addEventListener('click', () => {
                console.log('🔄 Refresh fence button clicked');
                this.refreshFenceList();
            });
        }
        
        const backToFenceBtn = document.getElementById('backToFenceListBtn');
        if (backToFenceBtn) {
            backToFenceBtn.addEventListener('click', () => {
                this.showFenceList();
            });
        }
        
        const saveFenceBtn = document.getElementById('saveFenceBtn');
        if (saveFenceBtn) {
            saveFenceBtn.addEventListener('click', () => {
                this.saveFenceChanges();
            });
        }
        
        const deleteFenceBtn = document.getElementById('deleteFenceBtn');
        if (deleteFenceBtn) {
            deleteFenceBtn.addEventListener('click', () => {
                this.deleteSelectedFence();
            });
        }
        
        console.log('✅ Fence listeners attached');
    }
    
    setPolygonManager(polygonManager) {
        this.polygonManager = polygonManager;
        console.log('✅ Polygon manager set in Command Editor');
        this.refreshFenceList();
    }
    
    refreshFenceList() {
        console.log('🔄 Refreshing fence list...');
        
        const fenceList = document.getElementById('fenceList');
        const emptyFenceState = document.getElementById('emptyFenceState');
        const fenceCountDisplay = document.getElementById('fenceCountDisplay');
        
        if (!fenceList || !emptyFenceState || !fenceCountDisplay) {
            console.error('❌ Fence list elements not found');
            return;
        }
        
        // Get fences from PolygonManager
        const fences = window.PolygonManager ? (window.PolygonManager.polygons || []) : [];
        
        console.log(`📊 Found ${fences.length} fences to display`);
        
        fenceCountDisplay.textContent = `${fences.length} Fence${fences.length !== 1 ? 's' : ''}`;
        
        if (fences.length === 0) {
            emptyFenceState.style.display = 'block';
            fenceList.style.display = 'none';
            return;
        }
        
        emptyFenceState.style.display = 'none';
        fenceList.style.display = 'flex';
        fenceList.innerHTML = '';
        
        fences.forEach((fence, index) => {
            const item = this.createFenceListItem(fence, index + 1);
            fenceList.appendChild(item);
        });
        
        console.log(`✅ Displayed ${fences.length} fences`);
    }
    
    createFenceListItem(fence, displayNumber) {
        const item = document.createElement('div');
        item.className = 'fence-item';
        item.dataset.fenceId = fence.id;
        
        const pointCount = fence.points ? fence.points.length : 0;
        
        item.innerHTML = `
            <div class="fence-item-header">
                <span class="fence-item-number">🚧 Fence ${displayNumber}</span>
                <span class="fence-item-type">Inclusion</span>
            </div>
            <div class="fence-item-info">
                <div><strong>Points:</strong> <span>${pointCount}</span></div>
                <div><strong>Type:</strong> <span>Polygon</span></div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            console.log(`🚧 Fence ${fence.id} clicked`);
            this.editFence(fence.id);
        });
        
        return item;
    }
    
    showFenceList() {
        const fenceListSection = document.querySelector('.fence-list-section');
        const detailsPanel = document.getElementById('fenceDetailsPanel');
        
        if (fenceListSection) fenceListSection.style.display = 'block';
        if (detailsPanel) detailsPanel.style.display = 'none';
        
        this.selectedFenceId = null;
    }
    
    editFence(fenceId) {
        this.selectedFenceId = fenceId;
        
        const fenceListSection = document.querySelector('.fence-list-section');
        const detailsPanel = document.getElementById('fenceDetailsPanel');
        
        if (fenceListSection) fenceListSection.style.display = 'none';
        if (detailsPanel) detailsPanel.style.display = 'block';
        
        document.getElementById('editingFenceTitle').textContent = `Fence ${fenceId}`;
        document.getElementById('fenceIdField').value = fenceId;
        document.getElementById('fenceTypeField').value = 'inclusion';
        
        const fence = window.PolygonManager?.polygons.find(p => p.id === fenceId);
        if (fence) {
            document.getElementById('fencePointCountField').value = fence.points ? fence.points.length : 0;
        }
    }
    
    saveFenceChanges() {
        if (window.MsgConsole) {
            window.MsgConsole.success('Fence updated');
        }
        this.showFenceList();
    }
    
    deleteSelectedFence() {
        if (!confirm('Delete this fence?')) return;
        
        if (window.PolygonManager) {
            window.PolygonManager.clearPolygon();
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Fence deleted');
        }
        
        this.showFenceList();
        this.refreshFenceList();
    }

    // ========================================================================
    // RALLY MANAGEMENT
    // ========================================================================
    
    attachRallyListeners() {
        const refreshRallyBtn = document.getElementById('refreshRallyBtn');
        if (refreshRallyBtn) {
            refreshRallyBtn.addEventListener('click', () => {
                console.log('🔄 Refresh rally button clicked');
                this.refreshRallyList();
            });
        }
        
        const backToRallyBtn = document.getElementById('backToRallyListBtn');
        if (backToRallyBtn) {
            backToRallyBtn.addEventListener('click', () => {
                this.showRallyList();
            });
        }
        
        const saveRallyBtn = document.getElementById('saveRallyBtn');
        if (saveRallyBtn) {
            saveRallyBtn.addEventListener('click', () => {
                this.saveRallyChanges();
            });
        }
        
        const deleteRallyBtn = document.getElementById('deleteRallyBtn');
        if (deleteRallyBtn) {
            deleteRallyBtn.addEventListener('click', () => {
                this.deleteSelectedRally();
            });
        }
        
        console.log('✅ Rally listeners attached');
    }
    
    refreshRallyList() {
        console.log('🔄 Refreshing rally list...');
        
        const rallyList = document.getElementById('rallyList');
        const emptyRallyState = document.getElementById('emptyRallyState');
        const rallyCountDisplay = document.getElementById('rallyCountDisplay');
        
        if (!rallyList || !emptyRallyState || !rallyCountDisplay) {
            console.error('❌ Rally list elements not found');
            return;
        }
        
        console.log(`📊 Found ${this.rallyPoints.length} rally points`);
        
        rallyCountDisplay.textContent = `${this.rallyPoints.length} Rally Point${this.rallyPoints.length !== 1 ? 's' : ''}`;
        
        if (this.rallyPoints.length === 0) {
            emptyRallyState.style.display = 'block';
            rallyList.style.display = 'none';
            return;
        }
        
        emptyRallyState.style.display = 'none';
        rallyList.style.display = 'flex';
        rallyList.innerHTML = '';
        
        this.rallyPoints.forEach((rally, index) => {
            const item = this.createRallyListItem(rally, index + 1);
            rallyList.appendChild(item);
        });
        
        console.log(`✅ Displayed ${this.rallyPoints.length} rally points`);
    }
    
    createRallyListItem(rally, displayNumber) {
        const item = document.createElement('div');
        item.className = 'rally-item';
        item.dataset.rallyId = rally.id;
        
        item.innerHTML = `
            <div class="rally-item-header">
                <span class="rally-item-number">📍 Rally ${displayNumber}</span>
            </div>
            <div class="rally-item-coords">
                <div><strong>Lat:</strong> <span>${rally.lat.toFixed(6)}</span></div>
                <div><strong>Lng:</strong> <span>${rally.lng.toFixed(6)}</span></div>
                <div><strong>Alt:</strong> <span>${rally.altitude}m</span></div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            console.log(`📍 Rally ${rally.id} clicked`);
            this.editRally(rally.id);
        });
        
        return item;
    }
    
    showRallyList() {
        const rallyListSection = document.querySelector('.rally-list-section');
        const detailsPanel = document.getElementById('rallyDetailsPanel');
        
        if (rallyListSection) rallyListSection.style.display = 'block';
        if (detailsPanel) detailsPanel.style.display = 'none';
        
        this.selectedRallyId = null;
    }
    
    editRally(rallyId) {
        const rally = this.rallyPoints.find(r => r.id === rallyId);
        if (!rally) return;
        
        this.selectedRallyId = rallyId;
        
        const rallyListSection = document.querySelector('.rally-list-section');
        const detailsPanel = document.getElementById('rallyDetailsPanel');
        
        if (rallyListSection) rallyListSection.style.display = 'none';
        if (detailsPanel) detailsPanel.style.display = 'block';
        
        document.getElementById('editingRallyTitle').textContent = `Rally Point ${rallyId}`;
        document.getElementById('rallyIdField').value = rallyId;
        document.getElementById('rallyLatField').value = rally.lat;
        document.getElementById('rallyLngField').value = rally.lng;
        document.getElementById('rallyAltField').value = rally.altitude;
    }
    
    saveRallyChanges() {
        const rally = this.rallyPoints.find(r => r.id === this.selectedRallyId);
        if (!rally) return;
        
        rally.lat = parseFloat(document.getElementById('rallyLatField').value);
        rally.lng = parseFloat(document.getElementById('rallyLngField').value);
        rally.altitude = parseFloat(document.getElementById('rallyAltField').value);
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Rally point updated');
        }
        
        this.showRallyList();
        this.refreshRallyList();
    }
    
    deleteSelectedRally() {
        if (!confirm('Delete this rally point?')) return;
        
        const index = this.rallyPoints.findIndex(r => r.id === this.selectedRallyId);
        if (index !== -1) {
            this.rallyPoints.splice(index, 1);
        }
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Rally point deleted');
        }
        
        this.showRallyList();
        this.refreshRallyList();
    }
    
    addRallyPoint(lat, lng, altitude = 50) {
        const rallyId = this.rallyPoints.length + 1;
        this.rallyPoints.push({
            id: rallyId,
            lat: lat,
            lng: lng,
            altitude: altitude
        });
        
        this.refreshRallyList();
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`Rally point ${rallyId} added`);
        }
    }

    // ========================================================================
    // DATA METHODS
    // ========================================================================
    
    getAllData() {
        return {
            currentTab: this.currentTab,
            waypoints: this.waypointManager ? this.waypointManager.waypoints : [],
            fences: window.PolygonManager ? (window.PolygonManager.polygons || []) : [],
            rallyPoints: this.rallyPoints
        };
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let commandEditor = null;

function initializeCommandEditor() {
    console.log('🎯 Creating CommandEditor instance...');
    
    if (!commandEditor) {
        commandEditor = new CommandEditor();
        
        window.CommandEditor = {
            show: () => commandEditor?.show(),
            hide: () => commandEditor?.hide(),
            isVisible: () => commandEditor?.isVisible(),
            switchTab: (tabName) => commandEditor?.switchTab(tabName),
            setWaypointManager: (wpm) => commandEditor?.setWaypointManager(wpm),
            setPolygonManager: (pm) => commandEditor?.setPolygonManager(pm),
            refreshWaypoints: () => commandEditor?.refreshWaypointList(),
            refreshFences: () => commandEditor?.refreshFenceList(),
            refreshRallies: () => commandEditor?.refreshRallyList(),
            addRallyPoint: (lat, lng, alt) => commandEditor?.addRallyPoint(lat, lng, alt),
            getData: () => commandEditor?.getAllData()
        };
        
        console.log('✅ window.CommandEditor exposed globally');
    }
    
    return commandEditor;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCommandEditor);
} else {
    initializeCommandEditor();
}

console.log('✅ Command Editor Script Loaded');

// ============================================================================
// CSS INJECTION FOR FENCE & RALLY ITEMS
// ============================================================================

const styleId = 'command-editor-fence-rally-styles';
if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Fence List Section */
        .fence-list-section,
        .rally-list-section {
            display: block;
        }
        
        /* Fence & Rally Lists */
        .fence-list,
        .rally-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        /* Fence Items */
        .fence-item,
        .rally-item {
            padding: 8px;
            background: rgba(255, 255, 255, 0.8);
            border: 1.5px solid rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .fence-item:hover,
        .rally-item:hover {
            background: rgba(230, 0, 126, 0.05);
            border-color: #E6007E;
            transform: translateX(3px);
        }
        
        .fence-item-header,
        .rally-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }
        
        .fence-item-number,
        .rally-item-number {
            font-size: 12px;
            font-weight: 700;
            color: #E6007E;
        }
        
        .fence-item-type {
            font-size: 9px;
            padding: 2px 5px;
            background: rgba(230, 0, 126, 0.1);
            border-radius: 3px;
            color: #E6007E;
            text-transform: uppercase;
            font-weight: 600;
        }
        
        .fence-item-info,
        .rally-item-coords {
            font-size: 10px;
            color: rgba(0, 0, 0, 0.6);
            line-height: 1.3;
        }
        
        .fence-item-info div,
        .rally-item-coords div {
            display: flex;
            justify-content: space-between;
        }
        
        .fence-item-info strong,
        .rally-item-coords strong {
            color: rgba(0, 0, 0, 0.8);
            font-weight: 600;
        }
        
        /* Details Panels */
        .fence-details-panel,
        .rally-details-panel {
            animation: slideInRight 0.3s ease;
        }
        
        @keyframes slideInRight {
            from {
                opacity: 0;
                transform: translateX(20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
    `;
    document.head.appendChild(style);
    console.log('✅ Fence & Rally styles injected');
}