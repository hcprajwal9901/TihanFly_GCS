/**
 * Command Editor Panel Handler - COMPLETE VERSION WITH REACTIVE UPDATES
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
    // WAYPOINT MANAGEMENT - WITH REACTIVE UPDATES
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
        
        // ✅ NEW: Add real-time change listener for waypoint type dropdown
        const typeField = document.getElementById('waypointTypeField');
        if (typeField) {
            typeField.addEventListener('change', (e) => {
                console.log(`🔄 Waypoint type changed to: ${e.target.value}`);
                // Auto-save when type changes
                this.saveWaypointChanges(true);
            });
        }
        
        // ✅ NEW: Add real-time listeners for other fields (optional)
        const latField = document.getElementById('waypointLatField');
        const lngField = document.getElementById('waypointLngField');
        const altField = document.getElementById('waypointAltField');
        
        [latField, lngField, altField].forEach(field => {
            if (field) {
                field.addEventListener('blur', () => {
                    console.log(`🔄 Field ${field.id} changed, auto-saving...`);
                    this.saveWaypointChanges(true);
                });
            }
        });
        
        console.log('✅ Waypoint listeners attached (with reactive updates)');
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
            const item = this.createWaypointItem(waypoint, index + 1);
            waypointList.appendChild(item);
        });
        
        console.log(`✅ Waypoint list refreshed with ${waypoints.length} items`);
    }
    
    createWaypointItem(waypoint, displayNumber) {
        const item = document.createElement('div');
        item.className = 'waypoint-item';
        
        if (this.selectedWaypointId === waypoint.id) {
            item.classList.add('selected');
        }
        
        const type = waypoint.type || 'waypoint';
        
        item.innerHTML = `
            <div class="waypoint-item-header">
                <div class="waypoint-item-number">#${displayNumber}</div>
                <div class="waypoint-item-type">${type}</div>
            </div>
            <div class="waypoint-item-coords">
                <div><strong>Lat:</strong> <span>${waypoint.lat.toFixed(6)}</span></div>
                <div><strong>Lng:</strong> <span>${waypoint.lng.toFixed(6)}</span></div>
                <div><strong>Alt:</strong> <span>${waypoint.altitude || 50}m</span></div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            console.log(`📍 Waypoint ${waypoint.id} clicked`);
            this.editWaypoint(waypoint.id);
        });
        
        return item;
    }
    
    showWaypointList() {
        const waypointListSection = document.getElementById('waypointsPanel');
        const detailsPanel = document.getElementById('waypointDetailsPanel');
        
        if (waypointListSection) {
            // Show list elements, hide details
            const listElements = waypointListSection.querySelectorAll('.waypoint-list-header, .empty-state, .waypoint-list');
            listElements.forEach(el => el.style.display = '');
        }
        
        if (detailsPanel) {
            detailsPanel.style.display = 'none';
        }
        
        this.selectedWaypointId = null;
        this.refreshWaypointList();
    }
    
    editWaypoint(waypointId) {
        if (!this.waypointManager) return;
        
        const waypoints = this.waypointManager.getWaypoints ? 
                          this.waypointManager.getWaypoints() : 
                          this.waypointManager.waypoints;
        
        const waypoint = waypoints.find(wp => wp.id === waypointId);
        if (!waypoint) {
            console.error(`❌ Waypoint ${waypointId} not found`);
            return;
        }
        
        this.selectedWaypointId = waypointId;
        
        // Hide list elements
        const waypointListSection = document.getElementById('waypointsPanel');
        if (waypointListSection) {
            const listElements = waypointListSection.querySelectorAll('.waypoint-list-header, .empty-state, .waypoint-list');
            listElements.forEach(el => el.style.display = 'none');
        }
        
        // Show details panel
        const detailsPanel = document.getElementById('waypointDetailsPanel');
        if (detailsPanel) {
            detailsPanel.style.display = 'block';
        }
        
        // Populate form fields
        const wpIndex = waypoints.findIndex(wp => wp.id === waypointId);
        document.getElementById('editingWaypointTitle').textContent = `Waypoint ${wpIndex + 1}`;
        document.getElementById('waypointIdField').value = waypointId;
        document.getElementById('waypointLatField').value = waypoint.lat;
        document.getElementById('waypointLngField').value = waypoint.lng;
        document.getElementById('waypointAltField').value = waypoint.altitude || 50;
        document.getElementById('waypointTypeField').value = waypoint.type || 'waypoint';
        
        console.log(`✅ Editing waypoint ${waypointId}`);
    }
    
    /**
     * ✅ ENHANCED: Save waypoint changes with backend communication
     * @param {boolean} silent - If true, don't show success message
     */
    saveWaypointChanges(silent = false) {
        if (!this.waypointManager || !this.selectedWaypointId) {
            console.error('❌ No waypoint selected or manager not set');
            return;
        }
        
        const waypoints = this.waypointManager.getWaypoints ? 
                          this.waypointManager.getWaypoints() : 
                          this.waypointManager.waypoints;
        
        const waypoint = waypoints.find(wp => wp.id === this.selectedWaypointId);
        if (!waypoint) {
            console.error(`❌ Waypoint ${this.selectedWaypointId} not found`);
            return;
        }
        
        // Get updated values from form
        const newLat = parseFloat(document.getElementById('waypointLatField').value);
        const newLng = parseFloat(document.getElementById('waypointLngField').value);
        const newAlt = parseFloat(document.getElementById('waypointAltField').value);
        const newType = document.getElementById('waypointTypeField').value;
        
        console.log(`💾 Saving waypoint ${this.selectedWaypointId}:`, {
            lat: newLat,
            lng: newLng,
            altitude: newAlt,
            type: newType
        });
        
        // Update waypoint object
        waypoint.lat = newLat;
        waypoint.lng = newLng;
        waypoint.altitude = newAlt;
        waypoint.type = newType;
        
        // ✅ Send update to backend
        this.sendWaypointUpdate(waypoint);
        
        // Update the marker on the map if waypointManager has the method
        if (this.waypointManager.updateWaypointMarker) {
            this.waypointManager.updateWaypointMarker(waypoint);
        }
        
        // Refresh the waypoint list to show updated type
        this.refreshWaypointList();
        
        if (!silent && window.MsgConsole) {
            window.MsgConsole.success('Waypoint updated successfully');
        }
        
        console.log(`✅ Waypoint ${this.selectedWaypointId} updated`);
    }
    
    /**
     * ✅ NEW: Send waypoint update to backend
     */
    sendWaypointUpdate(waypoint) {
        if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ WebSocket not connected, cannot send update');
            return;
        }
        
        const message = {
            type: 'plan_flight_mission',
            action: 'update_waypoint',
            id: waypoint.id,
            waypoint: {
                id: waypoint.id,
                lat: waypoint.lat,
                lng: waypoint.lng,
                altitude: waypoint.altitude,
                type: waypoint.type
            }
        };
        
        console.log('📤 Sending waypoint update to backend:', message);
        
        try {
            window.ws.send(JSON.stringify(message));
            console.log('✅ Waypoint update sent to backend');
        } catch (error) {
            console.error('❌ Error sending waypoint update:', error);
        }
    }
    
    deleteSelectedWaypoint() {
        if (!this.waypointManager || !this.selectedWaypointId) {
            console.error('❌ No waypoint selected');
            return;
        }
        
        if (!confirm('Are you sure you want to delete this waypoint?')) {
            return;
        }
        
        console.log(`🗑️ Deleting waypoint ${this.selectedWaypointId}`);
        
        // Delete from waypoint manager
        if (this.waypointManager.deleteWaypoint) {
            this.waypointManager.deleteWaypoint(this.selectedWaypointId);
        } else {
            const waypoints = this.waypointManager.waypoints;
            const index = waypoints.findIndex(wp => wp.id === this.selectedWaypointId);
            if (index !== -1) {
                waypoints.splice(index, 1);
            }
        }
        
        // Send delete to backend
        this.sendWaypointDelete(this.selectedWaypointId);
        
        if (window.MsgConsole) {
            window.MsgConsole.success('Waypoint deleted');
        }
        
        this.showWaypointList();
        this.refreshWaypointList();
    }
    
    /**
     * ✅ NEW: Send waypoint delete to backend
     */
    sendWaypointDelete(waypointId) {
        if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ WebSocket not connected, cannot send delete');
            return;
        }
        
        const message = {
            type: 'plan_flight_mission',
            action: 'delete_waypoint',
            id: waypointId
        };
        
        console.log('📤 Sending waypoint delete to backend:', message);
        
        try {
            window.ws.send(JSON.stringify(message));
            console.log('✅ Waypoint delete sent to backend');
        } catch (error) {
            console.error('❌ Error sending waypoint delete:', error);
        }
    }

    // ========================================================================
    // FENCE MANAGEMENT (PLACEHOLDER)
    // ========================================================================
    
    attachFenceListeners() {
        console.log('✅ Fence listeners attached (placeholder)');
    }
    
    setPolygonManager(polygonManager) {
        this.polygonManager = polygonManager;
        console.log('✅ Polygon manager set in Command Editor');
    }
    
    refreshFenceList() {
        console.log('🔄 Refreshing fence list (placeholder)...');
    }

    // ========================================================================
    // RALLY MANAGEMENT (PLACEHOLDER)
    // ========================================================================
    
    attachRallyListeners() {
        console.log('✅ Rally listeners attached (placeholder)');
    }
    
    refreshRallyList() {
        console.log('🔄 Refreshing rally list (placeholder)...');
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

console.log('✅ Command Editor Script Loaded (with reactive updates)');

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