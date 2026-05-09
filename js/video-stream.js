/**
 * ULTRA-SMOOTH Video Stream Handler - ZERO LAG, TV-QUALITY
 * Optimized for real-time, buttery-smooth streaming like live TV
 */

class UltraSmoothVideoHandler {
    constructor(containerId, placeholderImage = null) {
        this.container = document.getElementById(containerId);
        this.placeholderImage = placeholderImage;
        this.imgElement = null;
        this.isStreaming = false;
        this.streamUrl = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.healthCheckInterval = null;
        this.serverCheckDelay = 15000; // Only check server health every 15 seconds
        
        this.init();
    }

    init() {
        if (this.placeholderImage) {
            this.showPlaceholder();
        }
    }

    /**
     * Start ULTRA-SMOOTH stream - Maximum performance, minimum lag
     */
    startStream(url) {
        console.log('⚡ Starting ULTRA-SMOOTH stream:', url);
        
        this.stopStream();
        this.streamUrl = url;
        this.clearContainer();

        // Create OPTIMIZED image element for live streaming
        this.imgElement = document.createElement('img');
        
        // ULTRA-CRITICAL: Maximum performance CSS
        this.imgElement.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            image-rendering: auto;
            image-rendering: -webkit-optimize-contrast;
            backface-visibility: hidden;
            transform: translateZ(0);
            will-change: contents;
        `;

        // CRITICAL: Fastest loading settings
        this.imgElement.loading = 'eager';
        this.imgElement.decoding = 'async';
        
        // Connection handler - SIMPLE, no heavy processing
        this.imgElement.onload = () => {
            if (!this.isStreaming) {
                console.log('✅ Stream LIVE - Smooth playback active');
                this.isStreaming = true;
                this.reconnectAttempts = 0;
                this.updateStatus('LIVE', true);
            }
        };

        // Error handler - ONLY show placeholder on real errors
        this.imgElement.onerror = (e) => {
            console.error('❌ Stream connection error');
            this.isStreaming = false;
            this.updateStatus('NO SIGNAL', false);
            this.showPlaceholder();
            this.scheduleReconnect();
        };

        // CRITICAL: NO cache busting for maximum speed
        // Cache busting causes reconnections and lag
        
        // Append to container
        this.container.appendChild(this.imgElement);
        
        // Set source to start streaming
        this.imgElement.src = url;
        
        // Start lightweight health monitoring
        this.startLightweightHealthCheck();
    }

    /**
     * Lightweight health check - only check server, don't interfere with stream
     */
    startLightweightHealthCheck() {
        this.stopHealthCheck();
        
        // Only check if server is alive every 15 seconds
        // Don't touch the stream itself
        this.healthCheckInterval = setInterval(() => {
            if (!this.isStreaming && this.streamUrl) {
                // Only try to reconnect if we're not streaming
                this.checkServerHealth();
            }
        }, this.serverCheckDelay);
    }

    /**
     * Check if server is responding (only when not streaming)
     */
    async checkServerHealth() {
        if (!this.streamUrl) return;
        
        const statusUrl = this.streamUrl.replace('/video_feed', '/status');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch(statusUrl, { 
                signal: controller.signal,
                cache: 'no-cache'
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                if (data.camera_active && !this.isStreaming) {
                    console.log('🔄 Server back online - reconnecting...');
                    this.startStream(this.streamUrl);
                }
            }
        } catch (error) {
            // Silent fail - server not ready yet
        }
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('⛔ Max reconnect attempts - waiting for server...');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = 3000 * this.reconnectAttempts; // 3s, 6s, 9s
        
        console.log(`🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(() => {
            if (this.streamUrl && !this.isStreaming) {
                this.startStream(this.streamUrl);
            }
        }, delay);
    }

    /**
     * Stop health monitoring
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Stop stream and show placeholder
     */
    stopStream() {
        console.log('🛑 Stopping stream');
        
        this.isStreaming = false;
        this.streamUrl = null;
        this.reconnectAttempts = 0;
        this.stopHealthCheck();
        
        if (this.imgElement) {
            this.imgElement.onload = null;
            this.imgElement.onerror = null;
            this.imgElement.src = '';
        }
        
        this.clearContainer();
        this.showPlaceholder();
        this.updateStatus('NO SIGNAL', false);
    }

    /**
     * Show placeholder image - FULL SCREEN
     */
    showPlaceholder() {
        console.log('🖼️ Showing placeholder image');
        
        if (this.imgElement && this.imgElement.parentNode) {
            this.imgElement.parentNode.removeChild(this.imgElement);
            this.imgElement = null;
        } else {
            this.clearContainer();
        }

        if (this.placeholderImage) {
            const placeholder = document.createElement('img');
            placeholder.src = this.placeholderImage;
            placeholder.alt = 'No Signal - Waiting for video stream';
            placeholder.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: cover;
                object-position: center;
                opacity: 1;
                background: #000;
                display: block;
                position: absolute;
                top: 0;
                left: 0;
            `;
            
            placeholder.onerror = () => {
                console.error('❌ Placeholder failed to load');
                this.showTextFallback();
            };
            
            placeholder.onload = () => {
                console.log('✅ Placeholder displayed');
            };
            
            this.container.appendChild(placeholder);
        } else {
            this.showTextFallback();
        }
    }
    
    /**
     * Text fallback
     */
    showTextFallback() {
        this.clearContainer();
        
        const div = document.createElement('div');
        div.style.cssText = `
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 24px;
            font-weight: bold;
            background: #000;
            text-align: center;
            padding: 20px;
        `;
        div.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 20px;">📡</div>
            <div>NO SIGNAL</div>
            <div style="font-size: 14px; margin-top: 10px; opacity: 0.7;">Waiting for video stream...</div>
        `;
        this.container.appendChild(div);
    }

    /**
     * Clear container
     */
    clearContainer() {
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        this.imgElement = null;
    }

    /**
     * Take snapshot
     */
    takeSnapshot() {
        if (!this.isStreaming || !this.imgElement) {
            console.warn('⚠️ No active stream');
            alert('No active video stream to capture!');
            return null;
        }

        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.imgElement.naturalWidth || 1280;
            canvas.height = this.imgElement.naturalHeight || 720;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(this.imgElement, 0, 0);
            
            const dataUrl = canvas.toDataURL('image/png');
            
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            link.click();
            
            console.log('✅ Snapshot saved');
            return dataUrl;
        } catch (error) {
            console.error('❌ Snapshot failed:', error);
            alert('Failed to capture snapshot!');
            return null;
        }
    }

    /**
     * Update UI status
     */
    updateStatus(text, isActive) {
        const statusElement = document.querySelector('.video-status');
        if (!statusElement) return;

        const statusText = statusElement.querySelector('span');
        if (statusText) {
            statusText.textContent = text;
        }

        statusElement.classList.toggle('live', isActive);
        statusElement.classList.toggle('no-signal', !isActive);
    }

    /**
     * Status check
     */
    isVideoStreaming() {
        return this.isStreaming;
    }

    /**
     * Force reconnect
     */
    reconnect() {
        if (this.streamUrl) {
            console.log('🔄 Manual reconnect');
            this.reconnectAttempts = 0;
            this.startStream(this.streamUrl);
        }
    }
}

// ============================================================================
// ULTRA-SMOOTH VIDEO MANAGER
// ============================================================================

class UltraSmoothVideoManager {
    constructor() {
        this.config = {
            serverUrls: [
                'http://192.168.20.205:5000/video_feed',
                'http://localhost:5000/video_feed',
                'http://127.0.0.1:5000/video_feed',
            ],
            currentServerIndex: 0,
            autoConnect: true,
            placeholderImage: 'resources/chakrahyoh.jpg',
            serverTestTimeout: 2000
        };

        this.handler = null;
        this.activeServerUrl = null;
    }

    /**
     * Test server
     */
    async testServer(url) {
        const statusUrl = url.replace('/video_feed', '/status');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.serverTestTimeout);
            
            const response = await fetch(statusUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                if (data.camera_active) {
                    console.log(`✅ Server found: ${url}`);
                    return true;
                }
            }
        } catch (error) {
            // Silent fail
        }
        
        return false;
    }

    /**
     * Find active server
     */
    async findActiveServer() {
        console.log('🔍 Finding video server...');
        
        for (const url of this.config.serverUrls) {
            if (await this.testServer(url)) {
                this.activeServerUrl = url;
                return url;
            }
        }
        
        console.error('❌ No active server found');
        return null;
    }

    /**
     * Initialize
     */
    async initialize() {
        console.log('⚡ Initializing ULTRA-SMOOTH Video System');

        this.handler = new UltraSmoothVideoHandler(
            'videoStream',
            this.config.placeholderImage
        );

        this.handler.showPlaceholder();

        if (this.config.autoConnect) {
            const serverUrl = await this.findActiveServer();
            
            if (serverUrl) {
                setTimeout(() => {
                    console.log('🔌 Connecting to video server...');
                    this.connectToServer(serverUrl);
                }, 500);
            } else {
                console.log('📝 Waiting for server to start...');
            }
        }
        
        console.log('✅ ULTRA-SMOOTH Video System Ready');
    }

    /**
     * Connect to server
     */
    connectToServer(url) {
        console.log(`🔌 Connecting: ${url}`);
        this.activeServerUrl = url;
        this.handler.startStream(url);
    }

    /**
     * Connect
     */
    connect() {
        if (this.activeServerUrl) {
            this.connectToServer(this.activeServerUrl);
        } else {
            this.findActiveServer().then(url => {
                if (url) {
                    this.connectToServer(url);
                }
            });
        }
    }

    /**
     * Disconnect
     */
    disconnect() {
        console.log('🔌 Disconnecting');
        this.handler.stopStream();
    }

    /**
     * Reconnect
     */
    reconnect() {
        this.handler.reconnect();
    }

    /**
     * Snapshot
     */
    takeSnapshot() {
        return this.handler.takeSnapshot();
    }

    /**
     * Status
     */
    isStreaming() {
        return this.handler ? this.handler.isVideoStreaming() : false;
    }

    /**
     * Change source
     */
    changeSource(url) {
        console.log('🔄 Changing source:', url);
        this.activeServerUrl = url;
        this.handler.stopStream();
        this.connectToServer(url);
    }

    /**
     * Info
     */
    getServerInfo() {
        return {
            activeUrl: this.activeServerUrl,
            isStreaming: this.isStreaming(),
            availableServers: this.config.serverUrls
        };
    }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let ultraSmoothVideo = null;

async function initializeUltraSmoothVideo() {
    if (!ultraSmoothVideo) {
        ultraSmoothVideo = new UltraSmoothVideoManager();
        await ultraSmoothVideo.initialize();
    }
    return ultraSmoothVideo;
}

function getUltraSmoothVideo() {
    return ultraSmoothVideo || initializeUltraSmoothVideo();
}

// ============================================================================
// GLOBAL API
// ============================================================================

window.VideoStream = {
    connect: () => getUltraSmoothVideo().then(v => v.connect()),
    disconnect: () => getUltraSmoothVideo().then(v => v.disconnect()),
    reconnect: () => getUltraSmoothVideo().then(v => v.reconnect()),
    takeSnapshot: () => getUltraSmoothVideo().then(v => v.takeSnapshot()),
    changeSource: (url) => getUltraSmoothVideo().then(v => v.changeSource(url)),
    isStreaming: () => ultraSmoothVideo ? ultraSmoothVideo.isStreaming() : false,
    getManager: () => getUltraSmoothVideo(),
    getServerInfo: () => ultraSmoothVideo ? ultraSmoothVideo.getServerInfo() : null
};

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUltraSmoothVideo);
} else {
    initializeUltraSmoothVideo();
}

console.log('%c⚡ ULTRA-SMOOTH VIDEO READY - TV-QUALITY STREAMING', 'color: #0f0; font-weight: bold; font-size: 16px;');
console.log('%c📺 Zero-lag, buttery smooth video like live TV', 'color: #0af;');