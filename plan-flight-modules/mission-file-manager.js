/**
 * Mission File Manager
 * Handles loading, saving, and exporting mission files in .waypoints format
 * FIXED: Match backend's expected mission data format
 */

class MissionFileManager {
    constructor() {
        console.log('📁 MissionFileManager constructor called');
        this.currentMission = null;
        this.initialize();
    }

    initialize() {
        console.log('📁 Initializing Mission File Manager...');
        console.log('✅ Mission File Manager initialized');
    }

    // ========================================================================
    // EXPORT MISSION - Get current mission data (matches backend format)
    // ========================================================================
    
    /**
     * Export current mission data from WaypointManager
     * Format matches backend's MissionData structure
     * @returns {object} Mission data object
     */
    exportMission() {
        console.log('📤 Exporting mission...');
        
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            throw new Error('WaypointManager not initialized');
        }
        
        const waypoints = window.WaypointManager.getWaypoints();
        const homePosition = window.WaypointManager.getHomePosition();
        const totalDistance = window.WaypointManager.getTotalDistance();
        
        // Format exactly as backend expects (MissionData structure)
        const missionData = {
            version: '1.0',
            type: 'mission',
            created: new Date().toISOString(),
            home: homePosition ? {
                lat: homePosition.lat,
                lng: homePosition.lng,
                altitude: homePosition.altitude || 0
            } : null,
            waypoints: waypoints.map((wp, index) => ({
                id: wp.id,
                index: index,
                lat: wp.lat,
                lng: wp.lng,
                altitude: wp.altitude || 50,
                type: wp.type || 'waypoint'
            })),
            stats: {
                totalWaypoints: waypoints.length,
                totalDistance: totalDistance,
                hasHome: !!homePosition
            }
        };
        
        console.log('✅ Mission exported:', missionData);
        this.currentMission = missionData;
        
        return missionData;
    }

    // ========================================================================
    // SAVE MISSION - Save to .waypoints file
    // ========================================================================
    
    /**
     * Save mission to .waypoints file
     * @param {string} filename - Optional custom filename
     */
    saveMissionToFile(filename = null) {
        console.log('💾 Saving mission to file...');
        
        try {
            // Get mission data
            const missionData = this.exportMission();
            
            if (!missionData.waypoints || missionData.waypoints.length === 0) {
                console.warn('⚠️ No waypoints to save');
                if (window.MsgConsole) {
                    window.MsgConsole.warning('No waypoints to save');
                }
                alert('No waypoints to save. Please add waypoints first.');
                return false;
            }
            
            // Convert to JSON string
            const jsonString = JSON.stringify(missionData, null, 2);
            
            // Create blob
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            // Create download link
            const a = document.createElement('a');
            a.href = url;
            
            // Generate filename
            if (!filename) {
                const timestamp = new Date().toISOString()
                    .replace(/[:.]/g, '-')
                    .substring(0, 19);
                filename = `mission_${timestamp}.waypoints`;
            } else if (!filename.endsWith('.waypoints')) {
                filename += '.waypoints';
            }
            
            a.download = filename;
            
            // Trigger download
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Cleanup
            URL.revokeObjectURL(url);
            
            console.log('✅ Mission saved to file:', filename);
            
            if (window.MsgConsole) {
                window.MsgConsole.success(`✅ Mission saved: ${filename}`);
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Error saving mission:', error);
            
            if (window.MsgConsole) {
                window.MsgConsole.error(`Failed to save mission: ${error.message}`);
            }
            
            alert(`Error saving mission:\n${error.message}`);
            throw error;
        }
    }

    // ========================================================================
    // LOAD MISSION - Load from .waypoints file
    // ========================================================================
    
    /**
     * Load mission from .waypoints file
     * @param {object} missionData - Mission data object from file
     */
    loadMission(missionData) {
        console.log('📂 Loading mission...', missionData);
        
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            throw new Error('WaypointManager not initialized');
        }
        
        try {
            // Validate mission data
            const validation = this.validateMission(missionData);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            
            // Clear existing mission
            console.log('🗑️ Clearing existing mission...');
            window.WaypointManager.clearAllWaypoints();
            window.WaypointManager.clearHomePosition();
            
            // Load home position
            if (missionData.home) {
                console.log('🏠 Loading home position:', missionData.home);
                window.WaypointManager.setHomePosition(
                    missionData.home.lat,
                    missionData.home.lng
                );
            }
            
            // Load waypoints
            console.log(`📍 Loading ${missionData.waypoints.length} waypoints...`);
            
            // Sort waypoints by index to maintain order
            const sortedWaypoints = [...missionData.waypoints].sort((a, b) => 
                (a.index || 0) - (b.index || 0)
            );
            
            sortedWaypoints.forEach((wp, index) => {
                console.log(`  Adding waypoint ${index + 1}/${missionData.waypoints.length}:`, wp);
                
                window.WaypointManager.addWaypoint(
                    wp.lat,
                    wp.lng,
                    wp.altitude || 50
                );
            });
            
            // Center map on mission
            if (missionData.waypoints.length > 0) {
                window.WaypointManager.centerMission();
            }
            
            this.currentMission = missionData;
            
            console.log('✅ Mission loaded successfully');
            
            if (window.MsgConsole) {
                window.MsgConsole.success(`✅ Mission loaded: ${missionData.waypoints.length} waypoints`);
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Error loading mission:', error);
            
            if (window.MsgConsole) {
                window.MsgConsole.error(`Failed to load mission: ${error.message}`);
            }
            
            alert(`Error loading mission:\n${error.message}`);
            throw error;
        }
    }

    // ========================================================================
    // OPEN MISSION FILE - Show file picker
    // ========================================================================
    
    /**
     * Open file picker to load .waypoints file
     */
    openMissionFile() {
        console.log('📂 Opening file picker...');
        
        return new Promise((resolve, reject) => {
            // Create file input
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.waypoints,.json';
            
            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) {
                    console.log('❌ No file selected');
                    reject(new Error('No file selected'));
                    return;
                }
                
                console.log(`📂 Reading file: ${file.name}`);
                
                // Validate file extension
                if (!file.name.endsWith('.waypoints') && !file.name.endsWith('.json')) {
                    const errorMsg = 'Invalid file type. Please select a .waypoints file.';
                    console.error('❌', errorMsg);
                    if (window.MsgConsole) {
                        window.MsgConsole.error(errorMsg);
                    }
                    alert(errorMsg);
                    reject(new Error(errorMsg));
                    return;
                }
                
                try {
                    // Read file
                    const text = await file.text();
                    
                    // Parse JSON
                    const missionData = JSON.parse(text);
                    
                    // Load mission
                    this.loadMission(missionData);
                    
                    resolve(missionData);
                    
                } catch (error) {
                    console.error('❌ Error reading file:', error);
                    
                    if (window.MsgConsole) {
                        window.MsgConsole.error(`Failed to load file: ${error.message}`);
                    }
                    
                    alert(`Failed to load file:\n${error.message}`);
                    reject(error);
                }
            });
            
            // Trigger file picker
            input.click();
        });
    }

    // ========================================================================
    // NEW MISSION - Clear current mission
    // ========================================================================
    
    /**
     * Create new mission (clear current)
     */
    newMission() {
        console.log('📄 Creating new mission...');
        
        if (!window.WaypointManager) {
            console.error('❌ WaypointManager not available');
            throw new Error('WaypointManager not initialized');
        }
        
        // Clear waypoints
        window.WaypointManager.clearAllWaypoints();
        
        // Clear home position
        window.WaypointManager.clearHomePosition();
        
        // Clear current mission
        this.currentMission = null;
        
        console.log('✅ New mission created');
        
        if (window.MsgConsole) {
            window.MsgConsole.success('✅ New mission created');
        }
        
        return true;
    }

    // ========================================================================
    // GET CURRENT MISSION
    // ========================================================================
    
    getCurrentMission() {
        return this.currentMission;
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================
    
    /**
     * Validate mission data matches backend expected format
     */
    validateMission(missionData) {
        if (!missionData) {
            return { valid: false, error: 'Mission data is null or undefined' };
        }
        
        if (!missionData.waypoints) {
            return { valid: false, error: 'Missing waypoints array' };
        }
        
        if (!Array.isArray(missionData.waypoints)) {
            return { valid: false, error: 'Waypoints is not an array' };
        }
        
        if (missionData.waypoints.length === 0) {
            return { valid: false, error: 'No waypoints in mission' };
        }
        
        // Validate each waypoint has required fields
        for (let i = 0; i < missionData.waypoints.length; i++) {
            const wp = missionData.waypoints[i];
            
            if (typeof wp.lat !== 'number' || typeof wp.lng !== 'number') {
                return { 
                    valid: false, 
                    error: `Invalid coordinates for waypoint ${i + 1} (lat/lng must be numbers)` 
                };
            }
            
            // Check coordinate ranges
            if (wp.lat < -90 || wp.lat > 90) {
                return {
                    valid: false,
                    error: `Invalid latitude ${wp.lat} for waypoint ${i + 1} (must be -90 to 90)`
                };
            }
            
            if (wp.lng < -180 || wp.lng > 180) {
                return {
                    valid: false,
                    error: `Invalid longitude ${wp.lng} for waypoint ${i + 1} (must be -180 to 180)`
                };
            }
        }
        
        // Validate home position if present
        if (missionData.home) {
            if (typeof missionData.home.lat !== 'number' || 
                typeof missionData.home.lng !== 'number') {
                return {
                    valid: false,
                    error: 'Invalid home position coordinates'
                };
            }
        }
        
        console.log('✅ Mission validation passed');
        return { valid: true };
    }
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

console.log('📁 Mission File Manager script loading...');

function initializeMissionFileManager() {
    console.log('📁 Initializing Mission File Manager...');
    
    if (window.MissionFile) {
        console.log('✅ MissionFile already exists');
        return window.MissionFile;
    }
    
    try {
        const missionFileManager = new MissionFileManager();
        window.MissionFile = missionFileManager;
        
        console.log('✅ MissionFile available globally');
        console.log('📋 Available methods:');
        console.log('  - MissionFile.exportMission()');
        console.log('  - MissionFile.saveMissionToFile()');
        console.log('  - MissionFile.loadMission(data)');
        console.log('  - MissionFile.openMissionFile()');
        console.log('  - MissionFile.newMission()');
        console.log('  - MissionFile.validateMission(data)');
        
        if (window.MsgConsole) {
            window.MsgConsole.success('✅ Mission File Manager ready');
        }
        
        return missionFileManager;
        
    } catch (error) {
        console.error('❌ Error initializing Mission File Manager:', error);
        return null;
    }
}

// Initialize immediately or wait for DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMissionFileManager);
} else {
    // DOM already loaded, initialize now
    initializeMissionFileManager();
}

// Also expose initialization function globally
window.initializeMissionFileManager = initializeMissionFileManager;

console.log('✅ Mission File Manager Script Loaded');