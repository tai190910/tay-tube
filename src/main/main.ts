import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TayTubeCore } from '../core/index.js';
import { AppDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensures a CommonJS preload script (preload.cjs) exists so BrowserWindow works reliably
 * with `sandbox: true` even when package.json has `"type": "module"`.
 */
function ensureSandboxedPreloadCjs(): string {
  const cjsPath = path.join(__dirname, 'preload.cjs');
  const cjsContent = `'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const api = {
  getVideoDetails: (urlOrId, options) => ipcRenderer.invoke('video:getDetails', urlOrId, options),
  searchVideos: (query) => ipcRenderer.invoke('video:search', query),
  getTrendingVideos: () => ipcRenderer.invoke('video:getTrending'),
  getVideoComments: (videoId) => ipcRenderer.invoke('video:getComments', videoId),
  getHistory: (limit) => ipcRenderer.invoke('db:getHistory', limit),
  addToHistory: (item) => ipcRenderer.invoke('db:addToHistory', item),
  clearHistory: () => ipcRenderer.invoke('db:clearHistory'),
  deleteHistoryItem: (id) => ipcRenderer.invoke('db:deleteHistoryItem', id),
  getResume: (id) => ipcRenderer.invoke('db:getResume', id),
  getAllResumes: () => ipcRenderer.invoke('db:getAllResumes'),
  saveResume: (id, positionMs, durationMs) => ipcRenderer.invoke('db:saveResume', id, positionMs, durationMs),
  getFavorites: () => ipcRenderer.invoke('db:getFavorites'),
  isFavorite: (id) => ipcRenderer.invoke('db:isFavorite', id),
  toggleFavorite: (item) => ipcRenderer.invoke('db:toggleFavorite', item),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
};
contextBridge.exposeInMainWorld('electronAPI', api);
`;
  try {
    fs.writeFileSync(cjsPath, cjsContent, 'utf-8');
    return cjsPath;
  } catch {
    return path.join(__dirname, 'preload.js');
  }
}

/**
 * Resolves the built production index.html path across dist-renderer/ and dist/.
 */
function resolveProductionIndexHtml(): string {
  const candidates = [
    path.join(__dirname, '../../dist-renderer/index.html'),
    path.join(__dirname, '../../dist/index.html'),
    path.join(__dirname, '../index.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * Polls the Vite dev server (http://localhost:5173) via Node http before calling mainWindow.loadURL
 * so Chromium never throws ERR_CONNECTION_REFUSED.
 */
function waitForDevServer(url: string, maxAttempts: number = 50, intervalMs: number = 200): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          resolve(false);
        } else {
          setTimeout(check, intervalMs);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    check();
  });
}

// ============================================================================
// 1. CRITICAL: Unblock Autoplay & Optimize GPU for smooth 60fps
// ============================================================================
// Required by user prompt: Must be added before app.whenReady()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow: BrowserWindow | null = null;
let core: TayTubeCore | null = null;
let database: AppDatabase | null = null;

async function createWindow() {
  // Initialize Core and start local Chunked Range Proxy
  core = new TayTubeCore();
  const proxyPort = await core.startProxy();
  console.log(`[TayTube Main] Chunked Range Proxy active on port ${proxyPort}`);

  // Initialize SQLite Database in userData directory
  const userDataPath = app.getPath('userData');
  database = new AppDatabase(userDataPath);
  console.log(`[TayTube Main] SQLite Database initialized at ${userDataPath}`);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    frame: false, // Modern frameless custom titlebar
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: ensureSandboxedPreloadCjs(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Needed for local proxy video/audio streaming and CORS
    },
  });

  // Setup IPC Handlers
  setupIpcHandlers();

  // Load URL: clearly separate Development (http://localhost:5173) from Production (built index.html)
  const isProduction = app.isPackaged || process.env.NODE_ENV === 'production';
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const prodHtmlPath = resolveProductionIndexHtml();

  if (isProduction) {
    // Production mode: load built index.html directly without connecting to localhost
    await mainWindow.loadFile(prodHtmlPath);
  } else {
    // Development mode: verify Vite dev server is ready before calling loadURL
    const isExplicitDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);
    const isViteReady = await waitForDevServer(devServerUrl, isExplicitDev ? 50 : 3, 200);
    if (isViteReady) {
      await mainWindow.loadURL(devServerUrl);
    } else if (fs.existsSync(prodHtmlPath)) {
      await mainWindow.loadFile(prodHtmlPath);
    } else {
      await mainWindow.loadURL(devServerUrl);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpcHandlers() {
  if (!core || !database) return;

  // Video Extraction
  ipcMain.handle('video:getDetails', async (_, urlOrId: string, options?: any) => {
    return core!.getVideoDetails(urlOrId, options);
  });

  ipcMain.handle('video:search', async (_, query: string) => {
    return core!.search(query);
  });

  ipcMain.handle('video:getTrending', async () => {
    return core!.getTrending();
  });

  ipcMain.handle('video:getComments', async (_, videoId: string) => {
    return core!.getComments(videoId);
  });

  // Database IPCs
  ipcMain.handle('db:getHistory', async (_, limit?: number) => {
    return database!.getHistory(limit);
  });

  ipcMain.handle('db:addToHistory', async (_, item: any) => {
    return database!.addToHistory(item);
  });

  ipcMain.handle('db:clearHistory', async () => {
    return database!.clearHistory();
  });

  ipcMain.handle('db:deleteHistoryItem', async (_, id: string) => {
    return database!.deleteHistoryItem(id);
  });

  ipcMain.handle('db:getResume', async (_, id: string) => {
    return database!.getResume(id);
  });

  ipcMain.handle('db:getAllResumes', async () => {
    return database!.getAllResumes();
  });

  ipcMain.handle('db:saveResume', async (_, id: string, positionMs: number, durationMs: number) => {
    return database!.saveResume(id, positionMs, durationMs);
  });

  ipcMain.handle('db:getFavorites', async () => {
    return database!.getFavorites();
  });

  ipcMain.handle('db:isFavorite', async (_, id: string) => {
    return database!.isFavorite(id);
  });

  ipcMain.handle('db:toggleFavorite', async (_, item: any) => {
    return database!.toggleFavorite(item);
  });

  // Window Controls
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:toggleFullscreen', () => {
    if (!mainWindow) return false;
    const isFull = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(isFull);
    return isFull;
  });

  ipcMain.handle('window:isFullscreen', () => {
    return mainWindow?.isFullScreen() || false;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    core?.stopProxy().finally(() => {
      app.quit();
    });
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
