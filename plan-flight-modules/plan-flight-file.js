/**
 * Plan Flight Mode - File Actions Module
 * Handles: New Mission, Open Mission, Save Mission
 */

PlanFlightMode.prototype.handleFileActions = function(action) {
    console.log(`📁 File action: ${action}`);
    
    switch(action) {
        case 'new-mission':
            this.newMission();
            break;
            
        case 'open-mission':
            this.openMission();
            break;
            
        case 'save-mission':
            this.saveMission();
            break;
            
        default:
            console.warn(`Unknown file action: ${action}`);
    }
};

// ========================================================================
// HELPER: Ensure MissionFile is initialized
// ========================================================================

PlanFlightMode.prototype.ensureMissionFileManager = function() {
    if (!window.MissionFile) {
        console.warn('⚠️ MissionFile not found, attempting to initialize...');
        
        if (typeof initializeMissionFileManager === 'function') {
            window.MissionFile = initializeMissionFileManager();
        } else if (typeof MissionFileManager === 'function') {
            window.MissionFile = new MissionFileManager();
        }
        
        if (!window.MissionFile) {
            console.error('❌ Failed to initialize MissionFile');
            return false;
        }
        
        console.log('✅ MissionFile initialized successfully');
    }
    return true;
};

// ========================================================================
// NEW MISSION
// ========================================================================

PlanFlightMode.prototype.newMission = function() {
    console.log('📄 Creating new mission...');
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        if (window.MsgConsole) {
            window.MsgConsole.error('WaypointManager not initialized');
        }
        alert('WaypointManager not initialized. Please reload the page.');
        return;
    }
    
    // Clear frontend state
    window.WaypointManager.clearAllWaypoints();
    window.WaypointManager.clearHomePosition();
    
    if (window.MsgConsole) {
        window.MsgConsole.success('✅ New mission ready');
        window.MsgConsole.info('Click WAYPOINT > Add Waypoint to start planning');
    }
    
    this.showNewMissionNotification();
    
    console.log('✅ New mission ready');
};

PlanFlightMode.prototype.showNewMissionNotification = function() {
    const notification = document.createElement('div');
    notification.className = 'new-mission-notification';
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #f5f8fc 0%, #ebf0f8 100%);
            border-radius: 16px;
            padding: 32px 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            text-align: center;
            animation: slideIn 0.3s ease;
        ">
            <div style="font-size: 48px; margin-bottom: 16px;">✈️</div>
            <h2 style="
                margin: 0 0 12px 0;
                font-size: 24px;
                font-weight: 700;
                color: #1a1a1a;
            ">New Mission Ready</h2>
            <p style="
                margin: 0 0 24px 0;
                font-size: 16px;
                color: #666;
                line-height: 1.5;
            ">
                Start planning your flight path by adding waypoints.<br>
                Use <strong>WAYPOINT > Add Waypoint</strong> or click on the map.
            </p>
            <button onclick="
                this.parentElement.parentElement.remove();
                if (window.WaypointManager) {
                    window.WaypointManager.startAddingWaypoint();
                    if (window.MsgConsole) {
                        window.MsgConsole.info('✈️ Click on map to add waypoints');
                    }
                }
            " style="
                background: linear-gradient(135deg, #E6007E 0%, #FFCC00 100%);
                color: white;
                border: none;
                padding: 12px 32px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(230, 0, 126, 0.3);
            ">Got It! Start Planning</button>
        </div>
        <style>
            @keyframes slideIn {
                from { transform: translate(-50%, -60%); opacity: 0; }
                to { transform: translate(-50%, -50%); opacity: 1; }
            }
        </style>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
};

// ========================================================================
// OPEN MISSION - Load from file
// ========================================================================

PlanFlightMode.prototype.openMission = function() {
    console.log('📂 Opening mission file...');
    
    if (!this.ensureMissionFileManager()) {
        alert('❌ Mission File Manager Not Available');
        return;
    }
    
    window.MissionFile.openMissionFile()
        .then((missionData) => {
            console.log('✅ Mission loaded successfully:', missionData);
        })
        .catch((error) => {
            console.error('❌ Error loading mission:', error);
            if (error.message !== 'No file selected') {
                alert(`Failed to load mission file:\n${error.message}`);
            }
        });
};

// ========================================================================
// SAVE MISSION - Export mission data to file
// ========================================================================

PlanFlightMode.prototype.saveMission = function() {
    console.log('💾 Saving mission...');
    
    if (!this.ensureMissionFileManager()) {
        alert('❌ Mission File Manager Not Available');
        return;
    }
    
    if (!window.WaypointManager) {
        console.error('❌ WaypointManager not available');
        alert('WaypointManager not initialized. Please reload the page.');
        return;
    }
    
    try {
        const waypoints = window.WaypointManager.getWaypoints();
        
        if (!waypoints || waypoints.length === 0) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('No waypoints to save');
            }
            alert('No waypoints to save.\n\nPlease add waypoints first.');
            return;
        }
        
        console.log(`💾 Saving ${waypoints.length} waypoints...`);
        
        // Get filename from user
        let filename = prompt(
            '💾 Save Mission File\n\n' +
            'Enter filename (without extension):\n' +
            'Example: mohan',
            'mission_' + new Date().toISOString().slice(0, 10)
        );
        
        if (filename === null) {
            console.log('❌ Save cancelled by user');
            return;
        }
        
        filename = filename.trim();
        
        if (filename === '') {
            alert('Please enter a valid filename.');
            return;
        }
        
        // Remove .waypoints extension if user added it
        if (filename.endsWith('.waypoints')) {
            filename = filename.slice(0, -10);
        }
        
        filename = filename + '.waypoints';
        
        console.log(`💾 Saving as: ${filename}`);
        
        const missionData = window.MissionFile.exportMission();
        
        const jsonString = JSON.stringify(missionData, null, 2);
        
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`✅ Mission saved: ${filename}`);
        }
        
        console.log(`✅ Mission saved successfully as ${filename}`);
        
        alert(
            `✅ Mission Saved Successfully\n\n` +
            `Filename: ${filename}\n` +
            `Waypoints: ${waypoints.length}\n` +
            `Total Distance: ${(missionData.stats.totalDistance / 1000).toFixed(2)} km`
        );
        
    } catch (error) {
        console.error('❌ Error saving mission:', error);
        
        if (window.MsgConsole) {
            window.MsgConsole.error(`Failed to save mission: ${error.message}`);
        }
        
        alert(`Failed to save mission:\n${error.message}`);
    }
};

console.log('✅ Plan Flight File Actions Module Loaded');