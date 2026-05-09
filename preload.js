'use strict';
/**
 * preload.js — Electron context bridge
 * Exposes a safe, minimal API to the renderer process.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronRTSP', {
    /**
     * Start the RTSP relay.
     * @param {string} rtspUrl  e.g. "rtsp://192.168.1.10:554/stream"
     * @param {number} [port]   WebSocket port (default 9999)
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    start: (rtspUrl, port = 9999) =>
        ipcRenderer.invoke('rtsp-start', { rtspUrl, port }),

    /**
     * Stop the relay.
     * @returns {Promise<{ok:boolean}>}
     */
    stop: () => ipcRenderer.invoke('rtsp-stop'),

    /**
     * Get relay running status.
     * @returns {Promise<{running:boolean}>}
     */
    status: () => ipcRenderer.invoke('rtsp-status'),
});

/**
 * Save a file via native Save dialog (works with contextIsolation: true).
 * Usage: await window.electronSaveFile({ defaultName, base64Data, mimeType })
 */
contextBridge.exposeInMainWorld('electronSaveFile', {
    save: (opts) => ipcRenderer.invoke('save_file', opts),
});
