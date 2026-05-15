/**
 * Flight Control Buttons Handler with Takeoff Modal
 * Integrated WebSocket Communication with Command IDs
 */

// Command IDs (must match backend)
const CMD = {
    TAKEOFF: 1,
    LAND: 2,
    RTL: 3,
    ARM: 4,
    DISARM: 5,
    GOTO: 6,
    SET_MODE: 7
};

class FlightControlButtons {
    constructor() {
        this.takeoffBtn = null;
        this.landBtn = null;
        this.rtlBtn = null;
        this.modal = null;
        this.progressSection = null;
        
        this.isExecuting = false;
        this.currentCommand = null;
        
        this.takeoffSettings = {
            altitude: 10,
            speed: 2
        };
        
        this.callbacks = {
            onTakeoff: null,
            onLand: null,
            onRTL: null
        };
        
        // WebSocket connection
        this.ws = null;
        this.isConnected = false;
        
        this.initialize();
        this.initializeWebSocket();
    }

    initialize() {
        this.takeoffBtn = document.getElementById('takeoffBtn');
        this.landBtn = document.getElementById('landBtn');
        this.rtlBtn = document.getElementById('rtlBtn');
        this.modal = document.getElementById('takeoffModal');
        this.progressSection = document.getElementById('progressSection');

        if (!this.takeoffBtn || !this.landBtn || !this.rtlBtn) {
            console.error('❌ Flight control buttons not found in DOM');
            return;
        }

        if (!this.modal) {
            console.error('❌ Takeoff modal not found in DOM');
            return;
        }

        this.attachEventListeners();
        this.attachModalListeners();
        
        console.log('✅ Flight Control Buttons initialized');
    }

    initializeWebSocket() {
        console.log('🔌 Connecting to WebSocket backend...');
        
        this.ws = new WebSocket("ws://localhost:9002");
        
        this.ws.onopen = () => {
            console.log("✅ WebSocket connected to backend");
            this.isConnected = true;
            if (window.MsgConsole) {
                window.MsgConsole.success("🔌 Backend connected");
            }
        };
        
        this.ws.onclose = () => {
            console.log("❌ WebSocket disconnected from backend");
            this.isConnected = false;
            if (window.MsgConsole) {
                window.MsgConsole.error("🔌 Backend disconnected");
            }
            
            // Auto-reconnect after 3 seconds
            setTimeout(() => {
                console.log("🔄 Attempting to reconnect...");
                this.initializeWebSocket();
            }, 3000);
        };
        
        this.ws.onerror = (error) => {
            console.error("❌ WebSocket error:", error);
            if (window.MsgConsole) {
                window.MsgConsole.error("Connection error");
            }
        };
        
        this.ws.onmessage = (e) => {
            this.handleBackendResponse(e.data);
        };
    }

    sendCommand(cmdId, params = {}) {
        if (!this.isConnected) {
            console.error("❌ Backend not connected");
            if (window.MsgConsole) {
                window.MsgConsole.error("Backend not connected");
            }
            return;
        }
        
        const command = {
            cmd_id: cmdId,
            params: params,
            timestamp: Date.now()
        };
        
        console.log("📤 Sending command:", command);
        if (window.sendToSelected) {
            window.sendToSelected(command);
        } else {
            this.ws.send(JSON.stringify(command));
        }
    }

    handleBackendResponse(data) {
        try {
            const response = JSON.parse(data);
            console.log("📩 Backend response:", response);
            
            if (response.success) {
                if (window.MsgConsole) {
                    window.MsgConsole.success(`✅ CMD ${response.cmd_id}: ${response.message}`);
                }
                
                // Handle successful command completion
                this.handleCommandSuccess(response.cmd_id, response);
            } else {
                if (window.MsgConsole) {
                    window.MsgConsole.error(`❌ CMD ${response.cmd_id}: ${response.message}`);
                }
                
                // Handle command failure
                this.handleCommandFailure(response.cmd_id, response);
            }
            
        } catch (error) {
            console.error("Failed to parse backend response:", error);
        }
    }

    handleCommandSuccess(cmdId, response) {
        switch (cmdId) {
            case CMD.TAKEOFF:
                console.log("✅ Takeoff acknowledged by backend");
                // Progress animation already running
                break;
                
            case CMD.LAND:
                console.log("✅ Landing acknowledged by backend");
                setTimeout(() => {
                    this.clearExecutingState();
                }, 3000);
                break;
                
            case CMD.RTL:
                console.log("✅ RTL acknowledged by backend");
                setTimeout(() => {
                    this.clearExecutingState();
                }, 3000);
                break;
        }
    }

   

    attachEventListeners() {
        this.takeoffBtn.addEventListener('click', () => {
            console.log('🚁 Takeoff button clicked');
            if (!this.isExecuting) {
                this.showTakeoffModal();
            }
        });

        this.landBtn.addEventListener('click', () => {
            console.log('🛬 Land button clicked');
            if (!this.isExecuting) {
                this.executeLand();
            }
        });

        this.rtlBtn.addEventListener('click', () => {
            console.log('🏠 RTL button clicked');
            if (!this.isExecuting) {
                this.executeRTL();
            }
        });
    }

    attachModalListeners() {
        const closeBtn = document.getElementById('modalCloseBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const altitudeSlider = document.getElementById('altitudeSlider');
        const speedSlider = document.getElementById('speedSlider');
        const altitudeValue = document.getElementById('altitudeValue');
        const speedValue = document.getElementById('speedValue');
        
        if (!closeBtn || !cancelBtn || !confirmBtn) {
            console.error('❌ Modal buttons not found');
            return;
        }
        
        closeBtn.addEventListener('click', () => {
            console.log('Modal close button clicked');
            this.hideTakeoffModal();
        });
        
        cancelBtn.addEventListener('click', () => {
            console.log('Modal cancel button clicked');
            this.hideTakeoffModal();
        });
        
        confirmBtn.addEventListener('click', () => {
            console.log('Modal confirm button clicked');
            this.confirmTakeoff();
        });
        
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                console.log('Modal backdrop clicked');
                this.hideTakeoffModal();
            }
        });
        
        // Altitude slider listener
        if (altitudeSlider) {
            altitudeSlider.addEventListener('input', (e) => {
                this.takeoffSettings.altitude = parseFloat(e.target.value);
                if (altitudeValue) {
                    altitudeValue.textContent = `${this.takeoffSettings.altitude} m`;
                }
                console.log('Altitude set to:', this.takeoffSettings.altitude);
            });
        }
        
        // Speed slider listener
        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                this.takeoffSettings.speed = parseFloat(e.target.value);
                if (speedValue) {
                    speedValue.textContent = `${this.takeoffSettings.speed.toFixed(1)} m/s`;
                }
                console.log('Speed set to:', this.takeoffSettings.speed);
            });
        }
    }

    showTakeoffModal() {
        console.log('📋 Opening takeoff modal');
        this.modal.classList.add('active');
        this.progressSection.classList.remove('active');
        document.getElementById('modalActions').style.display = 'flex';
        
        // Set slider values
        const altitudeSlider = document.getElementById('altitudeSlider');
        const speedSlider = document.getElementById('speedSlider');
        const altitudeValue = document.getElementById('altitudeValue');
        const speedValue = document.getElementById('speedValue');
        
        if (altitudeSlider) {
            altitudeSlider.value = this.takeoffSettings.altitude;
            if (altitudeValue) {
                altitudeValue.textContent = `${this.takeoffSettings.altitude} m`;
            }
        }
        
        if (speedSlider) {
            speedSlider.value = this.takeoffSettings.speed;
            if (speedValue) {
                speedValue.textContent = `${this.takeoffSettings.speed.toFixed(1)} m/s`;
            }
        }
    }

    hideTakeoffModal() {
        if (!this.isExecuting) {
            console.log('📋 Closing takeoff modal');
            this.modal.classList.remove('active');
        } else {
            console.log('⚠️ Cannot close modal during execution');
        }
    }

    confirmTakeoff() {
        console.log('🚁 TAKEOFF command initiated');
        console.log(`  Altitude: ${this.takeoffSettings.altitude}m`);
        console.log(`  Speed: ${this.takeoffSettings.speed}m/s`);
        
        document.getElementById('modalActions').style.display = 'none';
        this.progressSection.classList.add('active');
        
        this.setExecutingState(this.takeoffBtn, 'TAKEOFF');
        this.simulateTakeoffProgress();
        
        // Send command to backend with CMD ID
        this.sendCommand(CMD.TAKEOFF, {
            altitude: this.takeoffSettings.altitude,
            speed: this.takeoffSettings.speed
        });
        
        if (this.callbacks.onTakeoff) {
            this.callbacks.onTakeoff(this.takeoffSettings);
        }
    }

    simulateTakeoffProgress() {
        const progressFill = document.getElementById('progressBarFill');
        const progressPercentage = document.getElementById('progressPercentage');
        const progressStatus = document.getElementById('progressStatus');
        
        const duration = (this.takeoffSettings.altitude / this.takeoffSettings.speed) * 1000;
        const startTime = Date.now();
        
        const statusMessages = [
            'Initiating takeoff sequence...',
            'Motors armed - lifting off...',
            'Climbing to target altitude...',
            'Approaching target altitude...',
            'Stabilizing at target altitude...',
            'Takeoff complete!'
        ];
        
        const updateProgress = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min((elapsed / duration) * 100, 100);
            
            progressFill.style.width = progress + '%';
            progressPercentage.textContent = Math.round(progress) + '%';
            
            const statusIndex = Math.min(
                Math.floor((progress / 100) * statusMessages.length),
                statusMessages.length - 1
            );
            progressStatus.textContent = statusMessages[statusIndex];
            
            if (progress < 100) {
                requestAnimationFrame(updateProgress);
            } else {
                setTimeout(() => {
                    this.completeTakeoff();
                }, 1000);
            }
        };
        
        updateProgress();
    }

    completeTakeoff() {
        console.log('✅ TAKEOFF completed successfully');
        this.clearExecutingState();
        
        setTimeout(() => {
            this.hideTakeoffModal();
            this.resetProgressBar();
        }, 1500);
    }

    resetProgressBar() {
        document.getElementById('progressBarFill').style.width = '0%';
        document.getElementById('progressPercentage').textContent = '0%';
        document.getElementById('progressStatus').textContent = 'Initiating takeoff...';
    }

    executeLand() {
        console.log('🛬 LAND command initiated');
        this.setExecutingState(this.landBtn, 'LAND');
        
        // Send command to backend with CMD ID
        this.sendCommand(CMD.LAND);
        
        if (this.callbacks.onLand) {
            this.callbacks.onLand();
        }
    }

    executeRTL() {
        console.log('🏠 RTL command initiated');
        this.setExecutingState(this.rtlBtn, 'RTL');
        
        // Send command to backend with CMD ID
        this.sendCommand(CMD.RTL);
        
        if (this.callbacks.onRTL) {
            this.callbacks.onRTL();
        }
    }

    setExecutingState(button, command) {
        this.isExecuting = true;
        this.currentCommand = command;
        button.classList.add('executing');
        this.disableAllButtons();
        console.log(`⏳ Executing ${command}...`);
    }

    clearExecutingState() {
        this.isExecuting = false;
        this.currentCommand = null;
        
        this.takeoffBtn.classList.remove('executing');
        this.landBtn.classList.remove('executing');
        this.rtlBtn.classList.remove('executing');
        
        this.enableAllButtons();
        console.log('✅ Command execution completed');
    }

    disableAllButtons() {
        this.takeoffBtn.disabled = true;
        this.landBtn.disabled = true;
        this.rtlBtn.disabled = true;
    }

    enableAllButtons() {
        this.takeoffBtn.disabled = false;
        this.landBtn.disabled = false;
        this.rtlBtn.disabled = false;
    }

    onTakeoff(callback) {
        this.callbacks.onTakeoff = callback;
        console.log('✅ Takeoff callback registered');
    }

    onLand(callback) {
        this.callbacks.onLand = callback;
        console.log('✅ Land callback registered');
    }

    onRTL(callback) {
        this.callbacks.onRTL = callback;
        console.log('✅ RTL callback registered');
    }

    completeCommand() {
        if (this.isExecuting) {
            console.log(`✅ ${this.currentCommand} command completed`);
            this.clearExecutingState();
        }
    }

    

    show() {
        const container = document.querySelector('.flight-controls-strip');
        if (container) {
            container.style.display = 'flex';
        }
    }

    hide() {
        const container = document.querySelector('.flight-controls-strip');
        if (container) {
            container.style.display = 'none';
        }
    }

    isCommandExecuting() {
        return this.isExecuting;
    }

    getCurrentCommand() {
        return this.currentCommand;
    }

    getTakeoffSettings() {
        return { ...this.takeoffSettings };
    }

    getConnectionStatus() {
        return this.isConnected;
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Flight Control Buttons...');
    window.flightControls = new FlightControlButtons();
    
    // Expose CMD constants globally for debugging
    window.CMD = CMD;
});

// Global helper function for manual testing
window.sendDroneCommand = (cmdId, params = {}) => {
    if (window.flightControls) {
        window.flightControls.sendCommand(cmdId, params);
    } else {
        console.error('Flight controls not initialized');
    }
};

console.log('%c🚁 Flight Control System Ready', 'color: #22c55e; font-size: 14px; font-weight: bold;');
console.log('%cCommand IDs:', 'color: #FFCC00; font-weight: bold;');
console.log('%c  1 = TAKEOFF', 'color: #3b82f6;');
console.log('%c  2 = LAND', 'color: #3b82f6;');
console.log('%c  3 = RTL', 'color: #3b82f6;');
console.log('%cTest commands:', 'color: #FFCC00; font-weight: bold;');
console.log('%c  sendDroneCommand(1, {altitude: 15})', 'color: #22c55e;');
console.log('%c  sendDroneCommand(2)', 'color: #22c55e;');
console.log('%c  sendDroneCommand(3)', 'color: #22c55e;');