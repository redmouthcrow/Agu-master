import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanupOldCalendars as cleanupCalendarsInStore,
  exportUserDataForBackup,
  importMigration,
  isEncryptionAvailable,
  loadLiveSync,
  loadUserDataSnapshot,
  saveAppConfig,
  saveDiagnosisCache,
  saveLiveSync,
  storageGet,
  storageRemove,
  storageSet,
  getUserDataPath,
} from './userDataStore';

const DEV_PORT = Number(process.env.AGU_DEV_PORT ?? 5180);
const isDev = !app.isPackaged;
const APP_NAME = 'AguMaster';

function isZhLocale(): boolean {
  return app.getLocale().toLowerCase().startsWith('zh');
}

function shellText(zh: string, en: string): string {
  return isZhLocale() ? zh : en;
}

let dashboardWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

/** Packaged: resources/img; dev: desktop/img (dist/../img) */
function assetPath(...parts: string[]): string {
  const candidates = isDev
    ? [path.join(__dirname, '..', ...parts)]
    : [path.join(process.resourcesPath, ...parts), path.join(app.getAppPath(), ...parts)];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function loadPngIcon(filename: string, size?: number): NativeImage {
  const filePath = assetPath('img', filename);
  let image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    console.warn('[AguMaster] Icon not found or invalid:', filePath);
    return nativeImage.createEmpty();
  }
  if (size) {
    image = image.resize({ width: size, height: size, quality: 'best' });
  }
  return image;
}

function appWindowIcon(): NativeImage | undefined {
  const icon = loadPngIcon('icon-256.png');
  return icon.isEmpty() ? undefined : icon;
}

function createTrayIcon(): NativeImage {
  const tray16 = loadPngIcon('tray-16.png', 16);
  if (!tray16.isEmpty()) {
    return tray16;
  }
  const tray32 = loadPngIcon('tray-32.png', 16);
  if (!tray32.isEmpty()) {
    return tray32;
  }
  const appIcon = loadPngIcon('icon-256.png', 16);
  return appIcon.isEmpty() ? nativeImage.createEmpty() : appIcon;
}

function pageUrl(mode: 'dashboard' | 'widget'): string {
  if (isDev) {
    return `http://127.0.0.1:${DEV_PORT}/?mode=${mode}`;
  }
  const indexHtml = path.join(process.resourcesPath, 'web', 'index.html');
  return `file://${indexHtml}?mode=${mode}`;
}

function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: appWindowIcon(),
    title: shellText(`${APP_NAME} 完整看板`, `${APP_NAME} Dashboard`),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void win.loadURL(pageUrl('dashboard'));
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('close', (event) => {
    event.preventDefault();
    if (win.webContents.isDestroyed()) {
      return;
    }
    void win.webContents
      .executeJavaScript(
        `typeof window.__aguFlushPersistence === 'function' ? window.__aguFlushPersistence() : Promise.resolve()`,
        true,
      )
      .catch(() => undefined)
      .finally(() => {
        if (!win.isDestroyed()) {
          win.hide();
        }
      });
  });
  return win;
}

function createWidgetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 480,
    resizable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    show: false,
    icon: appWindowIcon(),
    title: shellText(`${APP_NAME} 悬浮窗`, `${APP_NAME} Widget`),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void win.loadURL(pageUrl('widget'));
  win.webContents.on('did-finish-load', () => {
    pushLiveSyncToWidget();
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('close', (event) => {
    event.preventDefault();
    win.hide();
  });
  return win;
}

function ensureDashboard(): void {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }
  dashboardWindow = createDashboardWindow();
}

function ensureWidgetVisible(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = createWidgetWindow();
    return;
  }
  widgetWindow.show();
  pushLiveSyncToWidget();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: shellText('显示悬浮窗', 'Show widget'),
      click: () => ensureWidgetVisible(),
    },
    {
      label: shellText('隐藏悬浮窗', 'Hide widget'),
      click: () => widgetWindow?.hide(),
    },
    { type: 'separator' },
    {
      label: shellText('打开完整看板', 'Open dashboard'),
      click: () => ensureDashboard(),
    },
    { type: 'separator' },
    {
      label: shellText('退出', 'Quit'),
      click: () => app.quit(),
    },
  ]);
}

function setupTray(): void {
  const icon = createTrayIcon();
  if (icon.isEmpty()) {
    console.error('[AguMaster] Tray icon unavailable — run npm run build:icons');
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => ensureWidgetVisible());
}

function registerIpc(): void {
  ipcMain.on('agu:set-opacity', (_event, opacity: number) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setOpacity(Math.min(1, Math.max(0.1, opacity)));
    }
  });

  ipcMain.on('agu:set-always-on-top', (_event, flag: boolean) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setAlwaysOnTop(flag);
    }
  });

  ipcMain.on('agu:open-dashboard', () => {
    ensureDashboard();
  });

  ipcMain.on('agu:hide-widget', () => {
    widgetWindow?.hide();
  });

  ipcMain.on('agu:minimize-widget', () => {
    widgetWindow?.minimize();
  });

  ipcMain.on('agu:request-refresh', () => {
    dashboardWindow?.webContents.send('agu:run-refresh');
  });

  ipcMain.on('agu:request-refresh-symbol', (_event, code: unknown) => {
    if (typeof code !== 'string' || !code.trim()) {
      return;
    }
    dashboardWindow?.webContents.send('agu:run-refresh-symbol', code);
  });

  ipcMain.on('agu:request-sync', () => {
    dashboardWindow?.webContents.send('agu:push-sync');
  });

  ipcMain.on('agu:broadcast-live-sync', (_event, payload: unknown) => {
    const ts =
      payload && typeof payload === 'object' && 'ts' in payload
        ? Number((payload as { ts: number }).ts)
        : 0;
    if (ts > 0 && ts <= lastLiveSyncTs) {
      return;
    }
    if (ts > 0) {
      lastLiveSyncTs = ts;
    }
    lastLiveSyncPayload = payload;
    saveLiveSync(payload);
    pushLiveSyncToWidget();
  });

  ipcMain.handle('agu:load-user-data', () => {
    const snap = loadUserDataSnapshot();
    return {
      ...snap,
      encryptionAvailable: isEncryptionAvailable(),
      userDataPath: getUserDataPath(),
    };
  });

  ipcMain.handle('agu:save-config', (_event, config: unknown) => {
    if (!config || typeof config !== 'object') {
      return false;
    }
    return saveAppConfig(config as Parameters<typeof saveAppConfig>[0]);
  });

  ipcMain.handle('agu:save-diagnosis-cache', (_event, cache: unknown) => {
    if (!cache || typeof cache !== 'object') {
      return false;
    }
    return saveDiagnosisCache(cache as Record<string, unknown>);
  });

  ipcMain.handle('agu:save-live-sync', (_event, payload: unknown) => {
    return saveLiveSync(payload);
  });

  ipcMain.handle('agu:load-live-sync', () => loadLiveSync());

  ipcMain.handle('agu:storage-get', (_event, key: string) => storageGet(key));

  ipcMain.handle('agu:storage-set', (_event, key: string, value: unknown) =>
    storageSet(key, value),
  );

  ipcMain.handle('agu:storage-remove', (_event, key: string) => {
    storageRemove(key);
  });

  ipcMain.handle('agu:cleanup-calendars', (_event, keepYears: number[]) => {
    cleanupCalendarsInStore(keepYears);
  });

  ipcMain.handle('agu:import-migration', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    return importMigration(payload as Parameters<typeof importMigration>[0]);
  });

  ipcMain.handle('agu:export-backup', () => exportUserDataForBackup());
}

let lastLiveSyncPayload: unknown = null;
let lastLiveSyncTs = 0;

function pushLiveSyncToWidget(): void {
  if (!lastLiveSyncPayload || !widgetWindow || widgetWindow.isDestroyed()) {
    return;
  }
  if (widgetWindow.webContents.isDestroyed() || !widgetWindow.isVisible()) {
    return;
  }
  widgetWindow.webContents.send('agu:live-sync', lastLiveSyncPayload);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    ensureDashboard();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.agu.desktop');
    }
    const savedSync = loadLiveSync();
    if (savedSync && typeof savedSync === 'object' && 'ts' in savedSync) {
      lastLiveSyncPayload = savedSync;
      lastLiveSyncTs = Number((savedSync as { ts: number }).ts) || 0;
    }
    Menu.setApplicationMenu(null);
    registerIpc();
    setupTray();
    dashboardWindow = createDashboardWindow();
    widgetWindow = createWidgetWindow();
  });

  app.on('window-all-closed', () => {
    /* keep tray alive on Windows */
  });

  app.on('before-quit', () => {
    for (const win of [dashboardWindow, widgetWindow]) {
      if (win && !win.isDestroyed()) {
        win.removeAllListeners('close');
        win.destroy();
      }
    }
  });
}
