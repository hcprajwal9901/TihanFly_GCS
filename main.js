'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration:  false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('Login.html');
    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── File-save IPC  (called by camera-controls.js for photos & recordings) ──
ipcMain.handle('save_file', async (event, { defaultName, base64Data, mimeType }) => {
    try {
        const downloadsDir = app.getPath('downloads');
        const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
            title:       'Save File',
            defaultPath: path.join(downloadsDir, defaultName),
            filters:     _filtersFor(mimeType),
        });
        if (canceled || !filePath) return { ok: false, canceled: true };

        const buf = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buf);
        console.log('[Main] File saved:', filePath);
        return { ok: true, filePath };
    } catch (err) {
        console.error('[Main] save_file error:', err.message);
        return { ok: false, error: err.message };
    }
});

function _filtersFor(mimeType) {
    if (!mimeType) return [{ name: 'All Files', extensions: ['*'] }];
    if (mimeType.includes('mp4'))  return [{ name: 'MP4 Video',  extensions: ['mp4']  }];
    if (mimeType.includes('webm')) return [{ name: 'WebM Video', extensions: ['webm'] }];
    if (mimeType.includes('png'))  return [{ name: 'PNG Image',  extensions: ['png']  }];
    if (mimeType.includes('jpeg') || mimeType.includes('jpg'))
                                   return [{ name: 'JPEG Image', extensions: ['jpg']  }];
    return [{ name: 'All Files', extensions: ['*'] }];
}

app.whenReady().then(() => {
    // ── C++ MAVLink backend ──────────────────────────────────────────────────
    // Video streaming is handled by video_server.py (spawned by the backend
    // when the user clicks Connect). No relay server needed.
    const backendCandidates = [
        path.join(__dirname, 'TihanFlyCC-main', 'build', 'Release', 'TiHANFly.exe'),
        path.join(__dirname, 'build', 'Release', 'TiHANFly.exe'),
        path.join(__dirname, 'tihanfly_server'),
    ];

    for (const candidate of backendCandidates) {
        try {
            const fs = require('fs');
            if (!fs.existsSync(candidate)) continue;

            backendProcess = spawn(candidate, [], { cwd: path.dirname(candidate) });
            backendProcess.stdout && backendProcess.stdout.on('data', d =>
                process.stdout.write('[Backend] ' + d));
            backendProcess.stderr && backendProcess.stderr.on('data', d =>
                process.stderr.write('[Backend] ' + d));
            backendProcess.on('error', err =>
                console.error('[Backend] Process error:', err.message));
            console.log('[Main] Backend started:', candidate);
            break;
        } catch (err) {
            console.warn('[Main] Could not start backend candidate:', candidate, '-', err.message);
        }
    }

    if (!backendProcess) {
        console.warn('[Main] No backend binary found — start TiHANFly.exe manually.');
    }

    createWindow();
});

app.on('window-all-closed', () => {
    if (backendProcess) {
        try { backendProcess.kill(); } catch (_) {}
    }
    app.quit();
});
