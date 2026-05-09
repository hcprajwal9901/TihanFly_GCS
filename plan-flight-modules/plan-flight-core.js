/**
 * Plan Flight Mode - Core Module
 * Main class structure and initialization
 */

class PlanFlightMode {
    constructor() {
        console.log('🔧 PlanFlightMode constructor called');
        
        this.isActive = false;
        
        // DOM elements
        this.headerBar = null;
        this.headerLeft = null;
        this.headerCenter = null;
        this.statusBadge = null;
        this.messageConsole = null;
        this.weatherDashboard = null;
        this.tihanLogo = null;
        this.stripContainer = null;
        this.flightControlsStrip = null;
        this.planMenuStrip = null;
        
        // Weather click listener reference
        this._weatherClickListener = null;
        
        this.initialize();
    }

    initialize() {
        console.log('🗺️ Initializing Plan Flight Mode...');
        
        // Get DOM elements with detailed logging
        this.headerBar = document.querySelector('.header-bar');
        console.log('headerBar found:', !!this.headerBar);
        
        this.headerLeft = document.querySelector('.header-left');
        console.log('headerLeft found:', !!this.headerLeft);
        
        this.headerCenter = document.querySelector('.header-center');
        console.log('headerCenter found:', !!this.headerCenter);
        
        this.statusBadge = document.querySelector('.status-badge');
        console.log('statusBadge found:', !!this.statusBadge);
        
        this.messageConsole = document.querySelector('.minimal-console-container');
        console.log('messageConsole found:', !!this.messageConsole);
        
        this.weatherDashboard = document.getElementById('weatherDashboard');
        console.log('weatherDashboard found:', !!this.weatherDashboard);
        
        this.tihanLogo = document.getElementById('tihanLogo');
        console.log('tihanLogo found:', !!this.tihanLogo);
        
        this.stripContainer = document.getElementById('dropdownMenuStrip');
        console.log('stripContainer found:', !!this.stripContainer);
        
        this.flightControlsStrip = document.getElementById('flightControlsStrip');
        console.log('flightControlsStrip found:', !!this.flightControlsStrip);
        
        this.planMenuStrip = document.getElementById('planFlightMenuStrip');
        console.log('planMenuStrip found:', !!this.planMenuStrip);
        
        // Hide plan menu strip initially
        if (this.planMenuStrip) {
            this.planMenuStrip.style.display = 'none';
            console.log('✅ Plan menu strip hidden initially');
        } else {
            console.error('❌ CRITICAL: planFlightMenuStrip element NOT FOUND in DOM!');
            console.log('💡 Make sure you have added the HTML to MainWindow.html');
        }
        
        console.log('✅ Plan Flight Mode initialized');
    }

    // ========================================================================
    // ENTER PLAN FLIGHT MODE
    // ========================================================================
    
    enter() {
        console.log('🗺️ Entering Plan Flight Mode');
        console.log('Current isActive:', this.isActive);
        
        this.isActive = true;
        
        // Add body class for styling
        document.body.classList.add('plan-mode-active');
        
        // Hide elements
        console.log('Step 1: Hiding elements...');
        this.hideElements();
        
        // Transform header
        console.log('Step 2: Transforming header...');
        this.transformHeaderForPlanMode();
        
        // Show plan menu strip
        console.log('Step 3: Showing plan menu strip...');
        this.showPlanMenuStrip();
        
        // Move weather to bottom left
        console.log('Step 4: Moving weather...');
        this.moveWeatherToBottomLeft();
        
        // Create command editor
        console.log('Step 5: Creating command editor...');
        this.createCommandEditor();
        
        // Wait a moment for everything to initialize, then connect managers
        setTimeout(() => {
            console.log('Step 6: Connecting WaypointManager to CommandEditor...');
            
            if (!window.CommandEditor) {
                console.error('❌ window.CommandEditor not found!');
                console.log('Available:', Object.keys(window).filter(k => k.includes('Command')));
                return;
            }
            
            if (!window.WaypointManager) {
                console.error('❌ window.WaypointManager not found!');
                console.log('Available:', Object.keys(window).filter(k => k.includes('Waypoint')));
                return;
            }
            
            // ✅ Connect WaypointManager to CommandEditor
            window.CommandEditor.setWaypointManager(window.WaypointManager);
            console.log('✅ WaypointManager connected to Command Editor');
            
            // Force initial refresh
            window.CommandEditor.refreshWaypoints();
            console.log('✅ Initial waypoint list refresh complete');
            
        }, 500);
        
        // Attach menu event listeners
        console.log('Step 7: Attaching menu listeners...');
        this.attachMenuEventListeners();
        
        // Show success message
        if (window.MsgConsole) {
            window.MsgConsole.success('Plan Flight Mode activated');
        }
        
        console.log('✅ Plan Flight Mode active - isActive:', this.isActive);
    }

    // ========================================================================
    // EXIT PLAN FLIGHT MODE
    // ========================================================================
    
    exit() {
        console.log('👋 Exiting Plan Flight Mode');
        
        this.isActive = false;
        
        // ── Cancel any active polygon drawing ──────────────────────────────
        if (window.PolygonManager && window.PolygonManager.isDrawing) {
            console.log('🛑 Cancelling active polygon drawing on exit');
            window.PolygonManager.cancelDrawing();
        }
        
        // ── Cancel any active waypoint mode (add/insert/delete/takeoff etc) ─
        if (window.WaypointManager && window.WaypointManager.currentMode) {
            console.log('🛑 Cancelling active waypoint mode on exit:', window.WaypointManager.currentMode);
            window.WaypointManager.cancelCurrentOperation();
        }
        
        // Remove body class
        document.body.classList.remove('plan-mode-active');
        
        // Restore header
        console.log('Step 1: Restoring header...');
        this.restoreHeader();
        
        // Restore weather position
        console.log('Step 2: Restoring weather...');
        this.restoreWeatherPosition();
        
        // Remove UI elements
        console.log('Step 3: Removing command editor...');
        this.removeCommandEditor();
        
        console.log('Step 4: Hiding plan menu strip...');
        this.hidePlanMenuStrip();
        
        // Show hidden elements
        console.log('Step 5: Showing hidden elements...');
        this.showElements();
        
        console.log('✅ Plan Flight Mode exited');
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================
    
    getIsActive() {
        return this.isActive;
    }
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

let planFlightMode = null;

function initializePlanFlightMode() {
    console.log('🎯 Creating PlanFlightMode instance...');
    
    if (!planFlightMode) {
        planFlightMode = new PlanFlightMode();
        
        window.PlanFlight = {
            enter: () => {
                console.log('🎯 window.PlanFlight.enter() called');
                if (planFlightMode) {
                    planFlightMode.enter();
                } else {
                    console.error('❌ Plan Flight mode not initialized!');
                }
            },
            exit: () => {
                console.log('🎯 window.PlanFlight.exit() called');
                if (planFlightMode) {
                    planFlightMode.exit();
                }
            },
            isActive: () => {
                return planFlightMode ? planFlightMode.getIsActive() : false;
            },
            debug: () => {
                console.log('=== PLAN FLIGHT DEBUG INFO ===');
                console.log('Instance exists:', !!planFlightMode);
                console.log('Is active:', planFlightMode?.isActive);
                console.log('Menu element exists:', !!document.getElementById('planFlightMenuStrip'));
                const menu = document.getElementById('planFlightMenuStrip');
                if (menu) {
                    console.log('Menu display:', menu.style.display);
                    console.log('Menu computed display:', getComputedStyle(menu).display);
                }
                console.log('MissionFile available:', !!window.MissionFile);
                console.log('WaypointManager available:', !!window.WaypointManager);
            }
        };
        
        console.log('✅ window.PlanFlight exposed globally');
        console.log('💡 Use window.PlanFlight.debug() for troubleshooting');
    }
    
    return planFlightMode;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlanFlightMode);
} else {
    initializePlanFlightMode();
}

console.log('✅ Plan Flight Mode Core Script Loaded');