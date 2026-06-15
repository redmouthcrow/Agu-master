import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function readMode(): 'dashboard' | 'widget' | null {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'dashboard' || mode === 'widget') {
    return mode;
  }
  return null;
}

contextBridge.exposeInMainWorld('aguDesktop', {
  isDesktop: true as const,
  mode: readMode(),
  setOpacity: (opacity: number) => {
    ipcRenderer.send('agu:set-opacity', opacity);
  },
  setAlwaysOnTop: (flag: boolean) => {
    ipcRenderer.send('agu:set-always-on-top', flag);
  },
  openDashboard: () => ipcRenderer.send('agu:open-dashboard'),
  hideWidget: () => ipcRenderer.send('agu:hide-widget'),
  minimizeWidget: () => ipcRenderer.send('agu:minimize-widget'),
  requestRefresh: () => ipcRenderer.send('agu:request-refresh'),
  requestRefreshSymbol: (code: string) => ipcRenderer.send('agu:request-refresh-symbol', code),
  requestSync: () => ipcRenderer.send('agu:request-sync'),
  broadcastLiveSync: (payload: unknown) => {
    ipcRenderer.send('agu:broadcast-live-sync', payload);
  },
  loadUserData: () => ipcRenderer.invoke('agu:load-user-data'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('agu:save-config', config),
  saveDiagnosisCache: (cache: unknown) =>
    ipcRenderer.invoke('agu:save-diagnosis-cache', cache),
  saveLiveSync: (payload: unknown) => ipcRenderer.invoke('agu:save-live-sync', payload),
  loadLiveSync: () => ipcRenderer.invoke('agu:load-live-sync'),
  storageGet: (key: string) => ipcRenderer.invoke('agu:storage-get', key),
  storageSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('agu:storage-set', key, value),
  storageRemove: (key: string) => ipcRenderer.invoke('agu:storage-remove', key),
  cleanupCalendars: (keepYears: number[]) =>
    ipcRenderer.invoke('agu:cleanup-calendars', keepYears),
  importMigration: (payload: unknown) => ipcRenderer.invoke('agu:import-migration', payload),
  exportBackup: () => ipcRenderer.invoke('agu:export-backup'),
  sendAlert: (alerts: unknown) => ipcRenderer.send('agu:send-alert', alerts),
  onRunRefresh: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('agu:run-refresh', handler);
    return () => ipcRenderer.removeListener('agu:run-refresh', handler);
  },
  onRunRefreshSymbol: (callback: (code: string) => void) => {
    const handler = (_event: IpcRendererEvent, code: string) => {
      callback(code);
    };
    ipcRenderer.on('agu:run-refresh-symbol', handler);
    return () => ipcRenderer.removeListener('agu:run-refresh-symbol', handler);
  },
  onPushSync: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('agu:push-sync', handler);
    return () => ipcRenderer.removeListener('agu:push-sync', handler);
  },
  onLiveSync: (callback: (payload: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on('agu:live-sync', handler);
    return () => ipcRenderer.removeListener('agu:live-sync', handler);
  },
});
