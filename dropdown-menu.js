/**
 * Dropdown Menu Strip Handler
 * Simplified - Only handles logo click and triggers Plan Flight mode
 */

class DropdownMenuStrip {
    constructor() {
        this.stripContainer = null;
        this.planFlightBtn = null;
        this.analyzeBtn = null;
        this.vehicleConfigBtn = null;
        this.appSettingsBtn = null;
        this.tihanLogo = null;
        this.flightControlsStrip = null;
        
        this.isVisible = false;
        this.activeButton = null;
        
        this.initialize();
    }

    initialize() {
        console.log('🚀 Initializing Dropdown Menu Strip...');
        
        // Get DOM elements
        this.stripContainer = document.getElementById('dropdownMenuStrip');
        this.planFlightBtn = document.getElementById('planFlightBtn');
        this.analyzeBtn = document.getElementById('analyzeBtn');
        this.vehicleConfigBtn = document.getElementById('vehicleConfigBtn');
        this.appSettingsBtn = document.getElementById('appSettingsBtn');
        this.tihanLogo = document.getElementById('tihanLogo');
        this.flightControlsStrip = document.getElementById('flightControlsStrip');

        if (!this.stripContainer) {
            console.error('❌ Dropdown menu strip not found in DOM');
            return;
        }

        // Start with dropdown hidden and flight controls visible
        this.stripContainer.style.display = 'none';
        this.stripContainer.classList.add('hidden');
        if (this.flightControlsStrip) {
            this.flightControlsStrip.style.display = 'flex';
            this.flightControlsStrip.classList.remove('hidden');
        }

        // Attach event listeners
        this.attachEventListeners();
        this.attachLogoClickListener();
        this.attachOutsideClickListener();
        
        console.log('✅ Dropdown Menu Strip initialized');
    }

    attachLogoClickListener() {
        if (this.tihanLogo) {
            this.tihanLogo.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('🖱️ TiHAN Logo clicked - Toggling dropdown menu');
                this.toggleWithFlightControls();
            });
            
            this.tihanLogo.style.cursor = 'pointer';
            console.log('✅ Logo click listener attached');
        } else {
            console.error('❌ TiHAN Logo element not found!');
        }
    }

    attachOutsideClickListener() {
        document.addEventListener('click', (e) => {
            if (this.isVisible && this.stripContainer) {
                const isClickInsideDropdown = this.stripContainer.contains(e.target);
                const isClickOnLogo = this.tihanLogo && this.tihanLogo.contains(e.target);
                
                if (!isClickInsideDropdown && !isClickOnLogo) {
                    console.log('🖱️ Outside click - Hiding dropdown');
                    this.hideAndShowFlightControls();
                }
            }
        });
    }

    toggleWithFlightControls() {
        if (this.isVisible) {
            this.hideAndShowFlightControls();
        } else {
            this.showAndHideFlightControls();
        }
    }

    showAndHideFlightControls() {
        console.log('📋 Showing dropdown menu, hiding flight controls');
        
        if (this.stripContainer) {
            this.stripContainer.style.display = 'flex';
            this.stripContainer.classList.remove('hidden');
            this.isVisible = true;
        }

        if (this.flightControlsStrip) {
            this.flightControlsStrip.style.display = 'none';
            this.flightControlsStrip.classList.add('hidden');
        }

        if (this.tihanLogo) {
            this.tihanLogo.classList.add('menu-active');
        }
    }

    hideAndShowFlightControls() {
        console.log('🎮 Hiding dropdown menu, showing flight controls');
        
        if (this.stripContainer) {
            this.stripContainer.style.display = 'none';
            this.stripContainer.classList.add('hidden');
            this.isVisible = false;
            this.clearActiveStates();
        }

        if (this.flightControlsStrip) {
            this.flightControlsStrip.style.display = 'flex';
            this.flightControlsStrip.classList.remove('hidden');
        }

        if (this.tihanLogo) {
            this.tihanLogo.classList.remove('menu-active');
        }
    }

    attachEventListeners() {
        if (this.planFlightBtn) {
            this.planFlightBtn.addEventListener('click', () => {
                console.log('🗺️ Plan Flight button clicked - Triggering Plan Flight Mode');
                this.hideAndShowFlightControls(); // Hide dropdown first
                
                // Trigger Plan Flight mode from plan-flight.js
                if (window.PlanFlight) {
                    window.PlanFlight.enter();
                } else {
                    console.error('❌ Plan Flight module not loaded!');
                }
            });
        }

        if (this.analyzeBtn) {
            this.analyzeBtn.addEventListener('click', () => {
                console.log('📊 Analyze Tools button clicked');
                this.handleAction('analyze-tools');
            });
        }

        if (this.vehicleConfigBtn) {
            this.vehicleConfigBtn.addEventListener('click', () => {
                console.log('⚙️ Vehicle Configuration button clicked');
                this.handleAction('vehicle-config');
            });
        }

        if (this.appSettingsBtn) {
            this.appSettingsBtn.addEventListener('click', () => {
                console.log('🔧 Application Settings button clicked');
                this.handleAction('app-settings');
            });
        }
    }

    handleAction(action) {
        console.log(`🎯 Action triggered: ${action}`);
        this.clearActiveStates();

        switch (action) {
            case 'analyze-tools':
                this.setActiveButton(this.analyzeBtn);
                this.handleAnalyzeTools();
                break;
            
            case 'vehicle-config':
                this.setActiveButton(this.vehicleConfigBtn);
                this.handleVehicleConfig();
                break;
            
            case 'app-settings':
                this.setActiveButton(this.appSettingsBtn);
                this.handleAppSettings();
                break;
        }
    }

    handleAnalyzeTools() {
        // Hide the dropdown strip first
        this.hideAndShowFlightControls();
        // Open the real Analyze Tools panel
        setTimeout(() => {
            if (window.AnalyzeToolsPanel) {
                window.AnalyzeToolsPanel.showAnalyzePanel();
            } else {
                console.error('❌ AnalyzeToolsPanel not loaded!');
            }
        }, 150);
    }

handleVehicleConfig() {
    this.hideAndShowFlightControls();
    setTimeout(() => {
        if (window.VehicleConfig) {
            window.VehicleConfig.open();
        } else {
            console.error('❌ VehicleConfig not loaded!');
        }
    }, 150);
}

handleAppSettings() {
    SettingsWindow.open();
}

    setActiveButton(button) {
        this.activeButton = button;
        if (button) {
            button.classList.add('active');
        }
    }

    clearActiveStates() {
        const buttons = [
            this.planFlightBtn,
            this.analyzeBtn,
            this.vehicleConfigBtn,
            this.appSettingsBtn
        ];

        buttons.forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
            }
        });

        this.activeButton = null;
    }

    show() {
        this.showAndHideFlightControls();
    }

    hide() {
        this.hideAndShowFlightControls();
    }

    toggle() {
        this.toggleWithFlightControls();
    }
}


// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

let dropdownMenuStrip = null;

function initializeDropdownMenuStrip() {
    console.log('🎯 Creating DropdownMenuStrip instance...');
    if (!dropdownMenuStrip) {
        dropdownMenuStrip = new DropdownMenuStrip();
    }
    return dropdownMenuStrip;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializeDropdownMenuStrip, 500);
    });
} else {
    setTimeout(initializeDropdownMenuStrip, 500);
}

window.DropdownStrip = {
    show: () => {
        if (dropdownMenuStrip) dropdownMenuStrip.show();
    },
    hide: () => {
        if (dropdownMenuStrip) dropdownMenuStrip.hide();
    },
    toggle: () => {
        if (dropdownMenuStrip) dropdownMenuStrip.toggle();
    },
    showPlanStrip: () => {
        if (dropdownMenuStrip) dropdownMenuStrip.showAndHideFlightControls();
    }
};

console.log('✅ Dropdown Menu Strip Ready - Click logo to access menu');