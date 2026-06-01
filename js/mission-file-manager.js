/**
 * Mission File Manager - Handle multiple waypoint file formats
 * Supports: .waypoints (JSON), .txt (Mission Planner), .mission (QGC)
 */

class MissionFileManager {
    constructor() {
        console.log('📁 MissionFileManager initializing...');
        
        this.currentMissionFile = null;
        this.currentMissionName = 'Untitled Mission';
        this.hasUnsavedChanges = false;
        
        // File input element (hidden)
        this.fileInput = null;
        
        // Supported formats
        this.formats = {
            waypoints: '.waypoints',  // Custom JSON format
            txt: '.txt',             // Mission Planner format
            mission: '.mission'      // QGroundControl format
        };
        
        this.initialize();
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    initialize() {
        this.createFileInput();
        console.log('✅ MissionFileManager initialized');
    }

    createFileInput() {
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.waypoints,.txt,.mission';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        document.body.appendChild(this.fileInput);
        
        console.log('✅ File input element created');
    }

    // ========================================================================
    // NEW MISSION
    // ========================================================================
    
    newMission() {
        console.log('📝 Creating new mission...');
        
        if (this.hasUnsavedChanges) {
            const confirmNew = confirm('You have unsaved changes. Create a new mission anyway?');
            if (!confirmNew) {
                console.log('❌ New mission cancelled by user');
                return;
            }
        }
        
        if (window.WaypointManager) {
            window.WaypointManager.clearAllWaypoints();
            window.WaypointManager.clearHomePosition();
            console.log('✅ Cleared all waypoints and home position');
        }
        
        this.currentMissionFile = null;
        this.currentMissionName = 'Untitled Mission';
        this.hasUnsavedChanges = false;
        
        if (window.MsgConsole) {
            window.MsgConsole.success('✅ New mission created');
        }
        
        this.updateMissionTitle();
        console.log('✅ New mission created successfully');
    }

    // ========================================================================
    // OPEN MISSION - WITH FORMAT DETECTION
    // ========================================================================
    
    openMission() {
        console.log('📂 Opening mission file...');
        
        if (this.hasUnsavedChanges) {
            const confirmOpen = confirm('You have unsaved changes. Open a different mission anyway?');
            if (!confirmOpen) {
                console.log('❌ Open mission cancelled by user');
                return;
            }
        }
        
        this.fileInput.click();
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) {
            console.log('❌ No file selected');
            return;
        }
        
        console.log(`📄 Selected file: ${file.name}`);
        
        // Detect file format
        const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        console.log(`📋 File extension: ${extension}`);
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                this.loadMissionByFormat(content, file.name, extension);
            } catch (error) {
                console.error('❌ Error reading file:', error);
                if (window.MsgConsole) {
                    window.MsgConsole.error('Failed to read mission file');
                }
            }
        };
        
        reader.onerror = (error) => {
            console.error('❌ FileReader error:', error);
            if (window.MsgConsole) {
                window.MsgConsole.error('Failed to open file');
            }
        };
        
        reader.readAsText(file);
        event.target.value = '';
    }

    loadMissionByFormat(content, filename, extension) {
        console.log(`📥 Loading mission from ${extension} format...`);
        
        let missionData = null;
        
        try {
            switch(extension) {
                case '.waypoints':
                    missionData = this.parseWaypointsJSON(content);
                    break;
                    
                case '.txt':
                    missionData = this.parseMissionPlannerTXT(content);
                    break;
                    
                case '.mission':
                    missionData = this.parseQGCMission(content);
                    break;
                    
                default:
                    throw new Error(`Unsupported file format: ${extension}`);
            }
            
            if (missionData) {
                this.loadMissionData(missionData, filename);
            }
            
        } catch (error) {
            console.error('❌ Error parsing mission file:', error);
            if (window.MsgConsole) {
                window.MsgConsole.error(`Failed to load mission: ${error.message}`);
            }
        }
    }

    // ========================================================================
    // PARSE .waypoints FORMAT (Custom JSON)
    // ========================================================================
    
    parseWaypointsJSON(content) {
        console.log('📋 Parsing .waypoints JSON format...');
        const data = JSON.parse(content);
        
        if (!data.waypoints && !data.home) {
            throw new Error('Invalid waypoints file: missing waypoints and home');
        }
        
        return data;
    }

    // ========================================================================
    // PARSE .txt FORMAT (Mission Planner)
    // ========================================================================
    
    parseMissionPlannerTXT(content) {
        console.log('📋 Parsing Mission Planner .txt format...');
        
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        const missionData = {
            home: null,
            waypoints: []
        };
        
        lines.forEach((line, index) => {
            // Skip header line
            if (line.startsWith('QGC') || line.startsWith('#')) {
                console.log(`⏭️ Skipping header: ${line}`);
                return;
            }
            
            // Parse waypoint line
            // Format: index current_wp coord_frame command param1 param2 param3 param4 lat lng alt autocontinue
            const parts = line.split(/\s+/);
            
            if (parts.length < 12) {
                console.warn(`⚠️ Line ${index + 1} has insufficient data: ${line}`);
                return;
            }
            
            const wpIndex = parseInt(parts[0]);
            const isHome = parseInt(parts[1]) === 1; // current_wp flag
            const command = parseInt(parts[3]);
            const lat = parseFloat(parts[8]);
            const lng = parseFloat(parts[9]);
            const alt = parseFloat(parts[10]);
            
            // Validate coordinates
            if (isNaN(lat) || isNaN(lng) || isNaN(alt)) {
                console.warn(`⚠️ Invalid coordinates on line ${index + 1}`);
                return;
            }
            
            // Check if this is home position (command 16 = MAV_CMD_NAV_WAYPOINT at index 0)
            if (wpIndex === 0 || isHome) {
                missionData.home = { lat, lng, alt };
                console.log(`🏠 Home position: ${lat}, ${lng}, ${alt}m`);
            } else {
                // Regular waypoint
                missionData.waypoints.push({
                    lat,
                    lng,
                    alt,
                    speed: 10, // Default speed
                    command: command
                });
                console.log(`📍 Waypoint ${wpIndex}: ${lat}, ${lng}, ${alt}m`);
            }
        });
        
        console.log(`✅ Parsed ${missionData.waypoints.length} waypoints`);
        return missionData;
    }

    // ========================================================================
    // PARSE .mission FORMAT (QGroundControl)
    // ========================================================================
    
    parseQGCMission(content) {
        console.log('📋 Parsing QGroundControl .mission format...');
        
        const data = JSON.parse(content);
        
        const missionData = {
            home: null,
            waypoints: []
        };
        
        if (data.mission && data.mission.items) {
            data.mission.items.forEach((item, index) => {
                const lat = item.params[4];
                const lng = item.params[5];
                const alt = item.params[6];
                
                if (index === 0 || item.command === 16) {
                    missionData.home = { lat, lng, alt };
                    console.log(`🏠 Home position: ${lat}, ${lng}, ${alt}m`);
                } else {
                    missionData.waypoints.push({
                        lat,
                        lng,
                        alt,
                        speed: 10
                    });
                    console.log(`📍 Waypoint ${index}: ${lat}, ${lng}, ${alt}m`);
                }
            });
        }
        
        return missionData;
    }

    // ========================================================================
    // LOAD MISSION DATA TO MAP
    // ========================================================================
    
    loadMissionData(missionData, filename) {
        console.log('🗺️ Loading mission to map...');
        
        if (window.WaypointManager) {
            window.WaypointManager.clearAllWaypoints();
            window.WaypointManager.clearHomePosition();
        }
        
        // Load home position
        if (missionData.home) {
            console.log('🏠 Loading home position:', missionData.home);
            if (window.WaypointManager) {
                window.WaypointManager.setHomePosition(
                    missionData.home.lat,
                    missionData.home.lng,
                    missionData.home.alt || 0
                );
            }
        }
        
        // Load waypoints
        if (missionData.waypoints && missionData.waypoints.length > 0) {
            console.log(`📍 Loading ${missionData.waypoints.length} waypoints...`);
            
            missionData.waypoints.forEach((wp, index) => {
                if (window.WaypointManager) {
                    window.WaypointManager.addWaypoint(
                        wp.lat,
                        wp.lng,
                        wp.alt || 50,
                        wp.speed || 10
                    );
                }
            });
        }
        
        // Update state
        this.currentMissionFile = filename;
        this.currentMissionName = filename.substring(0, filename.lastIndexOf('.'));
        this.hasUnsavedChanges = false;
        
        // Center map
        if (window.WaypointManager) {
            setTimeout(() => {
                window.WaypointManager.centerMission();
            }, 500);
        }
        
        this.updateMissionTitle();
        
        if (window.MsgConsole) {
            window.MsgConsole.success(`✅ Mission loaded: ${this.currentMissionName} (${missionData.waypoints.length} waypoints)`);
        }
        
        console.log('✅ Mission loaded successfully');
    }

    // ========================================================================
    // SAVE MISSION - WITH FORMAT SELECTION
    // ========================================================================
    
    saveMission() {
        console.log('💾 Saving mission...');
        
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            if (window.MsgConsole) {
                window.MsgConsole.error('Cannot save: Waypoint system not ready');
            }
            return;
        }
        
        const missionData = window.WaypointManager.exportMission();
        
        if (!missionData.home && (!missionData.waypoints || missionData.waypoints.length === 0)) {
            if (window.MsgConsole) {
                window.MsgConsole.warning('Mission is empty. Add waypoints before saving.');
            }
            return;
        }
        
        if (!this.currentMissionFile) {
            this.saveMissionAs();
            return;
        }
        
        // Detect format from current filename
        const extension = this.currentMissionFile.substring(this.currentMissionFile.lastIndexOf('.'));
        this.saveMissionToFile(missionData, this.currentMissionFile, extension);
    }

    saveMissionAs() {
        console.log('💾 Save mission as...');
        this.showSaveDialog();
    }

    showSaveDialog() {
        // Create modal for save options
        const modal = document.createElement('div');
        modal.className = 'save-dialog-modal';
        modal.innerHTML = `
            <div class="save-dialog-content">
                <div class="save-dialog-header">
                    <h3>💾 Save Mission</h3>
                    <button class="save-dialog-close">×</button>
                </div>
                <div class="save-dialog-body">
                    <div class="form-group">
                        <label>Mission Name:</label>
                        <input type="text" id="missionNameInput" class="form-control" value="${this.currentMissionName}" placeholder="Enter mission name">
                    </div>
                    <div class="form-group">
                        <label>File Format:</label>
                        <select id="fileFormatSelect" class="form-control">
                            <option value=".waypoints">TiHANFly Format (.waypoints) - Recommended</option>
                            <option value=".txt">Mission Planner (.txt)</option>
                            <option value=".mission">QGroundControl (.mission)</option>
                        </select>
                    </div>
                </div>
                <div class="save-dialog-footer">
                    <button class="btn btn-cancel">Cancel</button>
                    <button class="btn btn-save">Save Mission</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add styles dynamically
        this.addSaveDialogStyles();
        
        // Event listeners
        const closeBtn = modal.querySelector('.save-dialog-close');
        const cancelBtn = modal.querySelector('.btn-cancel');
        const saveBtn = modal.querySelector('.btn-save');
        const nameInput = modal.querySelector('#missionNameInput');
        const formatSelect = modal.querySelector('#fileFormatSelect');
        
        const closeDialog = () => {
            modal.remove();
        };
        
        closeBtn.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);
        
        saveBtn.addEventListener('click', () => {
            const name = nameInput.value.trim();
            const format = formatSelect.value;
            
            if (!name) {
                alert('Please enter a mission name');
                return;
            }
            
            const filename = name + format;
            
            if (window.WaypointManager) {
                const missionData = window.WaypointManager.exportMission();
                this.saveMissionToFile(missionData, filename, format);
            }
            
            closeDialog();
        });
        
        // Focus name input
        nameInput.focus();
        nameInput.select();
    }

    saveMissionToFile(missionData, filename, format) {
        console.log(`💾 Saving mission to: ${filename} (${format})`);
        
        try {
            let content = '';
            
            switch(format) {
                case '.waypoints':
                    content = this.generateWaypointsJSON(missionData);
                    break;
                    
                case '.txt':
                    content = this.generateMissionPlannerTXT(missionData);
                    break;
                    
                case '.mission':
                    content = this.generateQGCMission(missionData);
                    break;
                    
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }
            
            // Download file
            this.downloadFile(content, filename);
            
            // Update state
            this.currentMissionFile = filename;
            this.currentMissionName = filename.substring(0, filename.lastIndexOf('.'));
            this.hasUnsavedChanges = false;
            
            this.updateMissionTitle();
            
            if (window.MsgConsole) {
                window.MsgConsole.success(`💾 Mission saved: ${filename}`);
            }
            
            console.log('✅ Mission saved successfully');
            
        } catch (error) {
            console.error('❌ Error saving mission:', error);
            if (window.MsgConsole) {
                window.MsgConsole.error('Failed to save mission');
            }
        }
    }

    // ========================================================================
    // GENERATE .waypoints FORMAT
    // ========================================================================
    
    generateWaypointsJSON(missionData) {
        const fileData = {
            version: '1.0',
            created: new Date().toISOString(),
            name: this.currentMissionName,
            ...missionData
        };
        
        return JSON.stringify(fileData, null, 2);
    }

    // ========================================================================
    // GENERATE .txt FORMAT (Mission Planner)
    // ========================================================================
    
    generateMissionPlannerTXT(missionData) {
        console.log('📝 Generating Mission Planner .txt format...');
        
        const lines = [];
        
        // Header
        lines.push('QGC WPL 110');
        
        let index = 0;
        
        // Home position (index 0)
        if (missionData.home) {
            const home = missionData.home;
            // Format: index current_wp coord_frame command p1 p2 p3 p4 lat lng alt autocontinue
            lines.push(`${index}\t1\t0\t16\t0\t0\t0\t0\t${home.lat}\t${home.lng}\t${home.alt}\t1`);
            index++;
        }
        
        // Waypoints
        if (missionData.waypoints) {
            missionData.waypoints.forEach(wp => {
                const cmd = wp.type === 'takeoff' ? 22 : (wp.type === 'rtl' ? 20 : (wp.type === 'hover' ? 17 : (wp.type === 'landing' ? 21 : 16)));
                lines.push(`${index}\t0\t0\t${cmd}\t0\t0\t0\t0\t${wp.lat}\t${wp.lng}\t${wp.alt}\t1`);
                index++;
            });
        }
        
        console.log(`✅ Generated ${index} waypoint lines`);
        return lines.join('\n');
    }

    // ========================================================================
    // GENERATE .mission FORMAT (QGroundControl)
    // ========================================================================
    
    generateQGCMission(missionData) {
        console.log('📝 Generating QGroundControl .mission format...');
        
        const mission = {
            fileType: 'Plan',
            geoFence: {
                circles: [],
                polygons: [],
                version: 2
            },
            groundStation: 'TiHANFly',
            mission: {
                cruiseSpeed: 10,
                firmwareType: 3,
                globalPlanAltitudeMode: 1,
                hoverSpeed: 5,
                items: [],
                plannedHomePosition: missionData.home ? [
                    missionData.home.lat,
                    missionData.home.lng,
                    missionData.home.alt
                ] : [0, 0, 0],
                vehicleType: 2,
                version: 2
            },
            rallyPoints: {
                points: [],
                version: 2
            },
            version: 1
        };
        
        let seq = 0;
        
        // Home position
        if (missionData.home) {
            mission.mission.items.push({
                autoContinue: true,
                command: 16,
                doJumpId: seq + 1,
                frame: 3,
                params: [0, 0, 0, 0, missionData.home.lat, missionData.home.lng, missionData.home.alt],
                type: 'SimpleItem'
            });
            seq++;
        }
        
        // Waypoints
        if (missionData.waypoints) {
            missionData.waypoints.forEach(wp => {
                const cmd = wp.type === 'takeoff' ? 22 : (wp.type === 'rtl' ? 20 : (wp.type === 'hover' ? 17 : (wp.type === 'landing' ? 21 : 16)));
                mission.mission.items.push({
                    autoContinue: true,
                    command: cmd,
                    doJumpId: seq + 1,
                    frame: 3,
                    params: [0, 0, 0, 0, wp.lat, wp.lng, wp.alt],
                    type: 'SimpleItem'
                });
                seq++;
            });
        }
        
        return JSON.stringify(mission, null, 2);
    }

    // ========================================================================
    // DOWNLOAD FILE
    // ========================================================================
    
    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    // ========================================================================
    // STYLES FOR SAVE DIALOG
    // ========================================================================
    
    addSaveDialogStyles() {
        if (document.getElementById('saveDialogStyles')) return;
        
        const style = document.createElement('style');
        style.id = 'saveDialogStyles';
        style.textContent = `
            .save-dialog-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.2s ease;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            .save-dialog-content {
                background: linear-gradient(135deg, #f5f8fc 0%, #ebf0f8 100%);
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                width: 90%;
                max-width: 480px;
                animation: slideUp 0.3s ease;
            }
            
            @keyframes slideUp {
                from {
                    transform: translateY(20px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            
            .save-dialog-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 2px solid rgba(0, 0, 0, 0.1);
            }
            
            .save-dialog-header h3 {
                margin: 0;
                font-size: 20px;
                font-weight: 700;
                color: #1a1a1a;
            }
            
            .save-dialog-close {
                background: none;
                border: none;
                font-size: 28px;
                color: #666;
                cursor: pointer;
                padding: 0;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s ease;
            }
            
            .save-dialog-close:hover {
                background: rgba(230, 0, 126, 0.1);
                color: #E6007E;
            }
            
            .save-dialog-body {
                padding: 24px;
            }
            
            .save-dialog-body .form-group {
                margin-bottom: 20px;
            }
            
            .save-dialog-body label {
                display: block;
                margin-bottom: 8px;
                font-size: 14px;
                font-weight: 600;
                color: #333;
            }
            
            .save-dialog-body .form-control {
                width: 100%;
                padding: 12px 16px;
                border: 2px solid rgba(0, 0, 0, 0.1);
                border-radius: 8px;
                font-size: 14px;
                font-family: inherit;
                transition: all 0.2s ease;
                background: white;
            }
            
            .save-dialog-body .form-control:focus {
                outline: none;
                border-color: #E6007E;
                box-shadow: 0 0 0 3px rgba(230, 0, 126, 0.1);
            }
            
            .save-dialog-footer {
                display: flex;
                gap: 12px;
                padding: 20px 24px;
                border-top: 2px solid rgba(0, 0, 0, 0.1);
                justify-content: flex-end;
            }
            
            .save-dialog-footer .btn {
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .btn-cancel {
                background: rgba(0, 0, 0, 0.05);
                color: #333;
            }
            
            .btn-cancel:hover {
                background: rgba(0, 0, 0, 0.1);
            }
            
            .btn-save {
                background: linear-gradient(135deg, #E6007E 0%, #c4006a 100%);
                color: white;
                box-shadow: 0 4px 12px rgba(230, 0, 126, 0.3);
            }
            
            .btn-save:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(230, 0, 126, 0.4);
            }
            
            .btn-save:active {
                transform: translateY(0);
            }
        `;
        document.head.appendChild(style);
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================
    
    markAsModified() {
        if (!this.hasUnsavedChanges) {
            this.hasUnsavedChanges = true;
            this.updateMissionTitle();
            console.log('📝 Mission marked as modified');
        }
    }

    updateMissionTitle() {
        const titleElement = document.querySelector('.mission-title');
        if (titleElement) {
            const unsavedIndicator = this.hasUnsavedChanges ? ' *' : '';
            titleElement.textContent = this.currentMissionName + unsavedIndicator;
        }
        
        console.log(`📋 Mission: ${this.currentMissionName}${this.hasUnsavedChanges ? ' (modified)' : ''}`);
    }

    getCurrentMissionName() {
        return this.currentMissionName;
    }

    getMissionStats() {
        if (!window.WaypointManager) {
            return {
                waypoints: 0,
                hasHome: false,
                distance: 0
            };
        }
        
        const waypoints = window.WaypointManager.getWaypoints();
        const home = window.WaypointManager.getHomePosition();
        
        return {
            waypoints: waypoints.length,
            hasHome: !!home,
            distance: window.WaypointManager.getTotalDistance()
        };
    }
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

let missionFileManager = null;

function initializeMissionFileManager() {
    console.log('🎯 Creating MissionFileManager instance...');
    
    if (!missionFileManager) {
        missionFileManager = new MissionFileManager();
        
        window.MissionFile = {
            new: () => missionFileManager?.newMission(),
            open: () => missionFileManager?.openMission(),
            save: () => missionFileManager?.saveMission(),
            saveAs: () => missionFileManager?.saveMissionAs(),
            markModified: () => missionFileManager?.markAsModified(),
            getCurrentName: () => missionFileManager?.getCurrentMissionName() || 'Unknown',
            getStats: () => missionFileManager?.getMissionStats() || null
        };
        
        console.log('✅ window.MissionFile exposed globally');
        console.log('💡 Supported formats: .waypoints, .txt (Mission Planner), .mission (QGC)');
    }
    
    return missionFileManager;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMissionFileManager);
} else {
    initializeMissionFileManager();
}

console.log('✅ Mission File Manager Script Loaded');