/**
 * Plan Flight Mode - UI Module
 * Handles UI transformations, element visibility, menu strip, and header modifications
 */

// ========================================================================
// SHOW/HIDE PLAN MENU STRIP
// ========================================================================

PlanFlightMode.prototype.showPlanMenuStrip = function() {
    console.log('🎯 showPlanMenuStrip called');
    console.log('planMenuStrip exists:', !!this.planMenuStrip);
    
    if (this.planMenuStrip) {
        console.log('Before: display =', this.planMenuStrip.style.display);
        this.planMenuStrip.style.display = 'flex';
        console.log('After: display =', this.planMenuStrip.style.display);
        
        // Verify visibility
        const rect = this.planMenuStrip.getBoundingClientRect();
        console.log('Menu position:', {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
        });
        
        console.log('✅ Plan menu strip shown');
    } else {
        console.error('❌ Plan menu strip not found!');
        console.log('💡 Check if HTML is added to MainWindow.html');
    }
};

PlanFlightMode.prototype.hidePlanMenuStrip = function() {
    console.log('🎯 hidePlanMenuStrip called');
    if (this.planMenuStrip) {
        this.planMenuStrip.style.display = 'none';
        console.log('✅ Plan menu strip hidden');
    }
};

// ========================================================================
// HIDE/SHOW ELEMENTS
// ========================================================================

PlanFlightMode.prototype.hideElements = function() {
    // Hide dropdown menu strip
    if (this.stripContainer) {
        this.stripContainer.style.display = 'none';
        console.log('✅ Dropdown menu strip hidden');
    }
    
    // Hide flight controls strip
    if (this.flightControlsStrip) {
        this.flightControlsStrip.style.display = 'none';
        console.log('✅ Flight controls strip hidden');
    }
    
    // Hide message console
    if (this.messageConsole) {
        this.messageConsole.style.display = 'none';
        console.log('✅ Message console hidden');
    }
};

PlanFlightMode.prototype.showElements = function() {
    // Show message console
    if (this.messageConsole) {
        this.messageConsole.style.display = 'flex';
        console.log('✅ Message console shown');
    }
    
    // Show flight controls
    if (this.flightControlsStrip) {
        this.flightControlsStrip.style.display = 'flex';
        console.log('✅ Flight controls shown');
    }
    
    // Show dropdown menu strip
    if (this.stripContainer) {
        this.stripContainer.style.display = 'flex';
        console.log('✅ Dropdown menu strip shown');
    }
};

// ========================================================================
// HEADER TRANSFORMATION
// ========================================================================

PlanFlightMode.prototype.transformHeaderForPlanMode = function() {
    if (!this.headerBar) {
        console.error('❌ headerBar not found');
        return;
    }
    
    // Hide logo and status badge
    if (this.tihanLogo) {
        this.tihanLogo.style.display = 'none';
        console.log('✅ Logo hidden');
    }
    
    if (this.statusBadge) {
        this.statusBadge.style.display = 'none';
        console.log('✅ Status badge hidden');
    }
    
    // Create and insert Exit Plan button
    const exitBtn = this.createExitButton();
    if (this.headerLeft) {
        this.headerLeft.insertBefore(exitBtn, this.headerLeft.firstChild);
        console.log('✅ Exit button added');
    }
    
    // Update header center with mission stats
    this.updateHeaderCenterWithStats();
};

PlanFlightMode.prototype.createExitButton = function() {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'exitPlanBtn';
    exitBtn.className = 'exit-plan-btn';
    exitBtn.innerHTML = `
        <svg class="exit-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 19L8 12L15 5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Exit Plan</span>
    `;
    
    exitBtn.addEventListener('click', () => {
        console.log('🖱️ Exit button clicked');
        this.exit();
    });
    
    console.log('✅ Exit button created');
    return exitBtn;
};

PlanFlightMode.prototype.updateHeaderCenterWithStats = function() {
    if (!this.headerCenter) {
        console.error('❌ headerCenter not found');
        return;
    }
    
    // Store original content for restoration
    if (!this.headerCenter.dataset.originalContent) {
        this.headerCenter.dataset.originalContent = this.headerCenter.innerHTML;
        console.log('✅ Original header content stored');
    }
    
    // Clear and add mission stats
    this.headerCenter.innerHTML = '';
    
    const missionStats = this.createMissionStats();
    const totalMission = this.createTotalMission();
    
    this.headerCenter.appendChild(missionStats);
    this.headerCenter.appendChild(totalMission);
    
    console.log('✅ Header center updated with mission stats');
};

PlanFlightMode.prototype.createMissionStats = function() {
    const missionStats = document.createElement('div');
    missionStats.className = 'plan-mission-stats';
    missionStats.innerHTML = `
        <div class="stat-group">
            <span class="stat-label">Waypoint</span>
            <span class="stat-value">Alt: <strong>0.0 m</strong></span>
        </div>
        <div class="stat-group">
            <span class="stat-label">Azimuth</span>
            <span class="stat-value"><strong>0°</strong></span>
        </div>
        <div class="stat-group">
            <span class="stat-label">Distance</span>
            <span class="stat-value"><strong>0.0 m</strong></span>
        </div>
        <div class="stat-group">
            <span class="stat-label">Gradient</span>
            <span class="stat-value"><strong>--</strong></span>
        </div>
        <div class="stat-group">
            <span class="stat-label">Heading</span>
            <span class="stat-value"><strong>--</strong></span>
        </div>
    `;
    return missionStats;
};

PlanFlightMode.prototype.createTotalMission = function() {
    const totalMission = document.createElement('div');
    totalMission.className = 'plan-total-mission';
    totalMission.innerHTML = `
        <div class="stat-group">
            <span class="stat-label">Mission</span>
            <span class="stat-value"><strong>0 m</strong></span>
        </div>
        <div class="stat-group">
            <span class="stat-label">Time</span>
            <span class="stat-value"><strong>00:00:00</strong></span>
        </div>
        <div class="stat-group">
            <span class="stat-label">Max Dist</span>
            <span class="stat-value"><strong>0 m</strong></span>
        </div>
    `;
    return totalMission;
};

PlanFlightMode.prototype.restoreHeader = function() {
    // Remove exit button
    const exitBtn = document.getElementById('exitPlanBtn');
    if (exitBtn) {
        exitBtn.remove();
        console.log('✅ Exit button removed');
    }
    
    // Show logo
    if (this.tihanLogo) {
        this.tihanLogo.style.display = 'block';
        console.log('✅ Logo shown');
    }
    
    // Show status badge
    if (this.statusBadge) {
        this.statusBadge.style.display = 'flex';
        console.log('✅ Status badge shown');
    }
    
    // Restore header center
    if (this.headerCenter && this.headerCenter.dataset.originalContent) {
        this.headerCenter.innerHTML = this.headerCenter.dataset.originalContent;
        console.log('✅ Header center restored');
    }
};

// ========================================================================
// COMMAND EDITOR PANEL
// ========================================================================

PlanFlightMode.prototype.createCommandEditor = function() {
    console.log('🎯 createCommandEditor called');
    
    // Use the existing command editor if window.CommandEditor is available
    if (window.CommandEditor) {
        console.log('✅ Using existing CommandEditor component');
        window.CommandEditor.show();
    } else {
        console.warn('⚠️ window.CommandEditor not found. Make sure command-editor.js is loaded.');
        console.log('💡 Attempting to show panel directly...');
        
        // Fallback: Try to show the panel directly
        const editor = document.getElementById('commandEditorPanel');
        if (editor) {
            editor.style.display = 'flex';
            console.log('✅ Command editor panel shown directly');
        } else {
            console.error('❌ Command editor panel not found in DOM');
            console.log('💡 Make sure command-editor.html is included in MainWindow.html');
        }
    }
};

PlanFlightMode.prototype.removeCommandEditor = function() {
    console.log('🎯 removeCommandEditor called');
    
    // Use the existing command editor if window.CommandEditor is available
    if (window.CommandEditor) {
        console.log('✅ Using existing CommandEditor component to hide');
        window.CommandEditor.hide();
    } else {
        // Fallback: Try to hide the panel directly
        const editor = document.getElementById('commandEditorPanel');
        if (editor) {
            editor.style.display = 'none';
            console.log('✅ Command editor panel hidden directly');
        }
    }
};

// ========================================================================
// MENU EVENT LISTENERS
// ========================================================================

PlanFlightMode.prototype.attachMenuEventListeners = function() {
    if (!this.planMenuStrip) {
        console.error('❌ Cannot attach listeners - planMenuStrip not found');
        return;
    }
    
    const menuLinks = this.planMenuStrip.querySelectorAll('.plan-menu-content a');
    console.log(`Found ${menuLinks.length} menu links`);
    
    menuLinks.forEach((link, index) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const action = link.dataset.action;
            console.log(`Menu link ${index} clicked: ${action}`);
            this.handleMenuAction(action);
        });
    });
    
    console.log('✅ Menu event listeners attached');
};

console.log('✅ Plan Flight UI Module Loaded');