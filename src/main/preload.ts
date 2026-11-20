import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  // Video Core APIs
  getVideoDetails: (urlOrId: string, options?: { targetQuality?: number; preferHdr?: boolean }) => Promise<any>;
  searchVideos: (query: string) => Promise<any>;
  getTrendingVideos: () => Promise<any>;
  getVideoComments: (videoId: string) => Promise<any>;

  // Database APIs
  getHistory: (limit?: number) => Promise<any>;
  addToHistory: (item: any) => Promise<void>;
  clearHistory: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;

  getResume: (id: string) => Promise<any>;
  getAllResumes: () => Promise<Record<string, any>>;
  saveResume: (id: string, positionMs: number, durationMs: number) => Promise<void>;

  getFavorites: () => Promise<any>;
  isFavorite: (id: string) => Promise<boolean>;
  toggleFavorite: (item: any) => Promise<boolean>;

  // Window Controls
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  toggleFullscreen: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
}

const api: ElectronAPI = {
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
