/**
 * Minimal Message Console Handler
 * Fully transparent background with color-coded messages
 * Green: success/arm/takeoff/land
 * Yellow: warning
 * Red: error
 */

class MinimalMessageConsole {
    constructor() {
        this.messagesContainer = null;
        this.messages = [];
        this.maxMessages = 50;
        this.autoScrollEnabled = true;
        
        this.initialize();
    }

    initialize() {
        this.messagesContainer = document.getElementById('minimalConsoleMessages');

        if (!this.messagesContainer) {
            console.error('❌ Minimal Message Console container not found in DOM');
            return;
        }

        console.log('✅ Minimal Message Console initialized');
    }

    /**
     * Add a message to the console
     * @param {string} text - Message text
     * @param {string} type - Message type: 'success', 'warning', 'error', 'info'
     */
    addMessage(text, type = 'info') {
        const message = {
            text: text,
            type: type,
            timestamp: new Date()
        };

        this.messages.push(message);
        
        // Keep only last maxMessages
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
            // Remove oldest message from DOM
            const firstMessage = this.messagesContainer.firstChild;
            if (firstMessage) {
                firstMessage.remove();
            }
        }

        this.renderMessage(message);
        
        if (this.autoScrollEnabled) {
            this.scrollToBottom();
        }
    }

    renderMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = `minimal-console-message ${message.type}`;
        
        const icon = this.getIcon(message.type);
        const timeStr = this.formatTime(message.timestamp);
        
        messageElement.innerHTML = `
            <span class="minimal-message-icon">${icon}</span>
            <div class="minimal-message-text">${this.escapeHtml(message.text)}</div>
            <span class="minimal-message-time">${timeStr}</span>
        `;

        this.messagesContainer.appendChild(messageElement);
    }

    getIcon(type) {
        const icons = {
            success: '✓',
            warning: '⚠',
            error: '✗',
            info: 'ℹ'
        };
        return icons[type] || icons.info;
    }

    formatTime(date) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    scrollToBottom() {
        if (this.messagesContainer) {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }
    }

    clearMessages() {
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
        this.messages = [];
        console.log('🗑️ Console cleared');
    }

    // Convenience methods for different message types
    success(text) {
        this.addMessage(text, 'success');
    }

    warning(text) {
        this.addMessage(text, 'warning');
    }

    error(text) {
        this.addMessage(text, 'error');
    }

    info(text) {
        this.addMessage(text, 'info');
    }

    // ARM/TAKEOFF/LAND shortcuts (all use success/green color)
    arm(text = 'Drone armed and ready') {
        this.success('🔓 ' + text);
    }

    disarm(text = 'Drone disarmed') {
        this.success('🔒 ' + text);
    }

    takeoff(altitude) {
        this.success(`🚁 Takeoff initiated - Target altitude: ${altitude}m`);
    }

    land(text = 'Landing sequence initiated') {
        this.success('🛬 ' + text);
    }

    rtl(text = 'Return to launch activated') {
        this.success('🏠 ' + text);
    }

    // Get message history
    getMessages() {
        return [...this.messages];
    }

    // Enable/disable auto-scroll
    setAutoScroll(enabled) {
        this.autoScrollEnabled = enabled;
    }

    // Get message count
    getMessageCount() {
        return this.messages.length;
    }

    // Show/hide console
    show() {
        const container = document.querySelector('.minimal-console-container');
        if (container) {
            container.style.display = 'flex';
        }
    }

    hide() {
        const container = document.querySelector('.minimal-console-container');
        if (container) {
            container.style.display = 'none';
        }
    }
}

// ============================================================================
// GLOBAL INSTANCE AND API
// ============================================================================

let minimalConsole = null;

function initializeMinimalConsole() {
    if (!minimalConsole) {
        minimalConsole = new MinimalMessageConsole();
    }
    return minimalConsole;
}

// Global API - Simple usage: MsgConsole.success("text")
window.MsgConsole = {
    log: (text, type = 'info') => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.addMessage(text, type);
    },
    
    success: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.success(text);
    },
    
    warning: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.warning(text);
    },
    
    error: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.error(text);
    },
    
    info: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.info(text);
    },
    
    // Flight command shortcuts
    arm: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.arm(text);
    },
    
    disarm: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.disarm(text);
    },
    
    takeoff: (altitude) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.takeoff(altitude);
    },
    
    land: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.land(text);
    },
    
    rtl: (text) => {
        if (!minimalConsole) initializeMinimalConsole();
        minimalConsole.rtl(text);
    },
    
    clear: () => {
        if (minimalConsole) minimalConsole.clearMessages();
    },
    
    show: () => {
        if (minimalConsole) minimalConsole.show();
    },
    
    hide: () => {
        if (minimalConsole) minimalConsole.hide();
    },
    
    getMessages: () => {
        if (minimalConsole) return minimalConsole.getMessages();
        return [];
    }
};

// ============================================================================
// INTEGRATION WITH FLIGHT CONTROLS (IF AVAILABLE)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeMinimalConsole();
    
    // Add mock messages for demonstration
    setTimeout(() => {
        window.MsgConsole.success('Drone armed and ready');
        window.MsgConsole.success('🚁 Takeoff initiated - Target altitude: 15m');
        window.MsgConsole.success('🛬 Landing sequence complete');
    }, 500);
    
    setTimeout(() => {
        window.MsgConsole.warning('Low battery warning - 25% remaining');
        window.MsgConsole.warning('Strong winds detected - 15 m/s');
        window.MsgConsole.warning('GPS signal weak - 5 satellites');
    }, 1500);
    
    setTimeout(() => {
        window.MsgConsole.error('Connection lost - attempting reconnect');
        window.MsgConsole.error('Failed to arm motors - check battery');
        window.MsgConsole.error('Takeoff aborted - unsafe conditions');
    }, 2500);
    
    // Hook into flight controls if available
    setTimeout(() => {
        if (window.flightControls) {
            // Override flight control callbacks to add console messages
            window.flightControls.onTakeoff((settings) => {
                window.MsgConsole.takeoff(settings.altitude);
            });
            
            window.flightControls.onLand(() => {
                window.MsgConsole.land();
            });
            
            window.flightControls.onRTL(() => {
                window.MsgConsole.rtl();
            });
            
            console.log('✅ Minimal Console integrated with Flight Controls');
        }
    }, 1000);
});

// Auto-initialize if DOM is already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMinimalConsole);
} else {
    initializeMinimalConsole();
}

console.log('%c📟 Minimal Message Console Ready', 'color: #22c55e; font-size: 14px; font-weight: bold;');
console.log('%cUsage Examples:', 'color: #FFCC00; font-weight: bold;');
console.log('%c  MsgConsole.success("text") - Green', 'color: #22c55e;');
console.log('%c  MsgConsole.warning("text") - Yellow', 'color: #FFCC00;');
console.log('%c  MsgConsole.error("text") - Red', 'color: #ef4444;');
console.log('%c  MsgConsole.arm() - ARM command', 'color: #22c55e;');
console.log('%c  MsgConsole.takeoff(10) - TAKEOFF to 10m', 'color: #22c55e;');
console.log('%c  MsgConsole.land() - LAND command', 'color: #22c55e;');
console.log('%c  MsgConsole.rtl() - RTL command', 'color: #22c55e;');