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
        icon: path.join(__dirname, 'resources', 'icon', 'tihan.png'),
        webPreferences: {
            nodeIntegration:  false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('pages/MainWindow.html');
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
    // ── Google Maps tile header fix ──────────────────────────────────────────
    // Electron's default User-Agent is blocked by Google's tile servers.
    // We intercept all requests to mt*.google.com and inject a real browser
    // UA + Referer so tiles are served normally.
    const { session } = require('electron');
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://mt0.google.com/*', 'https://mt1.google.com/*',
                 'https://mt2.google.com/*', 'https://mt3.google.com/*'] },
        (details, callback) => {
            details.requestHeaders['User-Agent'] =
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                'Chrome/124.0.0.0 Safari/537.36';
            details.requestHeaders['Referer'] = 'https://www.google.com/';
            callback({ requestHeaders: details.requestHeaders });
        }
    );


    // ── C++ MAVLink backend ──────────────────────────────────────────────────
    // The backend binary is spawned with its working directory (cwd) set to a
    // writable location so that ./param_cache and any other relative-path data
    // files are created there.
    //
    // • Dev mode  : cwd = directory containing the binary (original behaviour).
    // • Packaged  : cwd = app.getPath('userData')
    //               Windows → %APPDATA%\TiHANFly
    //               Linux   → ~/.config/TiHANFly
    //               macOS   → ~/Library/Application Support/TiHANFly
    //   The resources/ folder inside an asar/AppImage is READ-ONLY, so we
    //   must not use path.dirname(candidate) when packaged.

    const userDataDir = app.getPath('userData');
    // Ensure the userData dir exists (Electron usually creates it, but be safe)
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

    // Candidate list covers: packaged Windows, packaged Linux, dev Windows, dev Linux
    const backendCandidates = [
        // ── Packaged ──────────────────────────────────────────────────────────
        app.isPackaged ? path.join(process.resourcesPath, 'backend', 'TiHANFly.exe')  : null,
        app.isPackaged ? path.join(process.resourcesPath, 'backend', 'TiHANFly')      : null,
        // ── Development ───────────────────────────────────────────────────────
        path.join(__dirname, 'TihanFlyCC-main', 'build', 'Release', 'TiHANFly.exe'),
        path.join(__dirname, 'TihanFlyCC-main', 'build', 'Release', 'TiHANFly'),
        path.join(__dirname, 'build', 'Release', 'TiHANFly.exe'),
        path.join(__dirname, 'build', 'Release', 'TiHANFly'),
        path.join(__dirname, 'tihanfly_server'),
    ].filter(Boolean);

    for (const candidate of backendCandidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            // Use userData as cwd when packaged so param_cache is writable.
            // In dev mode fall back to the binary's own directory (keeps existing behaviour).
            const spawnCwd = app.isPackaged ? userDataDir : path.dirname(candidate);

            backendProcess = spawn(candidate, [], { cwd: spawnCwd });
            backendProcess.stdout && backendProcess.stdout.on('data', d =>
                process.stdout.write('[Backend] ' + d));
            backendProcess.stderr && backendProcess.stderr.on('data', d =>
                process.stderr.write('[Backend] ' + d));
            backendProcess.on('error', err =>
                console.error('[Backend] Process error:', err.message));

            console.log('[Main] Backend started:', candidate);
            console.log('[Main] Backend cwd:', spawnCwd);
            break;
        } catch (err) {
            console.warn('[Main] Could not start backend candidate:', candidate, '-', err.message);
        }
    }

    if (!backendProcess) {
        console.warn('[Main] No backend binary found — start TiHANFly manually.');
    }

    createWindow();
});

app.on('window-all-closed', () => {
    if (backendProcess) {
        try {
            // Graceful shutdown: SIGTERM first, SIGKILL after 3 s if still running
            backendProcess.kill('SIGTERM');
            setTimeout(() => {
                try { backendProcess.kill('SIGKILL'); } catch (_) {}
            }, 3000);
        } catch (_) {}
    }
    app.quit();
});

