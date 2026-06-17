import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import {
  cleanupOldCalendars as cleanupCalendarsInStore,
  exportUserDataForBackup,
  importMigration,
  isEncryptionAvailable,
  loadLiveSync,
  loadUserDataSnapshot,
  loadWidgetBounds,
  saveAppConfig,
  saveDiagnosisCache,
  saveLiveSync,
  saveWidgetBounds,
  storageGet,
  storageRemove,
  storageSet,
  getUserDataPath,
  type WidgetWindowBounds,
} from './userDataStore';
import {
  APP_NAME,
  appWindowIcon,
  createTrayIcon,
  isDev,
  pageUrl,
  preloadPath,
  shellText,
} from './iconAssets';
import {
  dismissAlertWindow,
  showAlertPopup,
  type AlertPayload,
} from './alertWindow';

let dashboardWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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
  const savedBounds = loadWidgetBounds();
  const win = new BrowserWindow({
    width: savedBounds?.width ?? 420,
    height: savedBounds?.height ?? 560,
    minWidth: 360,
    minHeight: 480,
    ...(savedBounds
      ? { x: savedBounds.x, y: savedBounds.y }
      : {}),
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
  attachWidgetBoundsPersistence(win);
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

let widgetBoundsSaveTimer: ReturnType<typeof setTimeout> | null = null;

function persistWidgetBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  const bounds = win.getBounds() as WidgetWindowBounds;
  saveWidgetBounds(bounds);
}

function attachWidgetBoundsPersistence(win: BrowserWindow): void {
  const scheduleSave = () => {
    if (widgetBoundsSaveTimer) {
      clearTimeout(widgetBoundsSaveTimer);
    }
    widgetBoundsSaveTimer = setTimeout(() => {
      widgetBoundsSaveTimer = null;
      persistWidgetBounds(win);
    }, 400);
  };

  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('close', () => {
    if (widgetBoundsSaveTimer) {
      clearTimeout(widgetBoundsSaveTimer);
      widgetBoundsSaveTimer = null;
    }
    persistWidgetBounds(win);
  });
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

  ipcMain.on('agu:send-alert', (_event, alerts: AlertPayload[]) => {
    if (!Array.isArray(alerts) || alerts.length === 0) {
      return;
    }
    showAlertPopup(alerts);
  });

  ipcMain.on('agu:close-alert', () => {
    dismissAlertWindow();
  });
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
    dismissAlertWindow();
    for (const win of [dashboardWindow, widgetWindow]) {
      if (win && !win.isDestroyed()) {
        win.removeAllListeners('close');
        win.destroy();
      }
    }
  });
}
