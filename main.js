'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path   = require('path');
const { spawn } = require('child_process');
const RtspRelay = require('./rtsp-relay');

let mainWindow;
let backendProcess;
const relay = new RtspRelay();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('Login.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // 🔥 Start C++ Backend
    backendProcess = spawn('./tihanfly_server');

    createWindow();
});

app.on('window-all-closed', () => {
    relay.stop();
    if (backendProcess) backendProcess.kill();
    app.quit();
});

// ── IPC: RTSP relay control ──────────────────────────────────────────────────

// Start relay: { rtspUrl: 'rtsp://...', port: 9999 }
ipcMain.handle('rtsp-start', (_event, { rtspUrl, port }) => {
    try {
        relay.start(rtspUrl, port || 9999);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// Stop relay
ipcMain.handle('rtsp-stop', () => {
    relay.stop();
    return { ok: true };
});

// Status
ipcMain.handle('rtsp-status', () => {
    return { running: relay.isRunning() };
});
