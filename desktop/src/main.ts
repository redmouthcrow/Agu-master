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
let alertWindow: BrowserWindow | null = null;
let alertDismissTimer: ReturnType<typeof setTimeout> | null = null;
let tray: Tray | null = null;

/**
 * IPC payload for desktop alerts. Structurally mirrors `AlertPayload` in
 * web/src/types/index.ts but uses a looser keyLevel shape (raw IPC JSON, no
 * enum-typed KeyLevel). Keep the two in sync if the contract changes.
 * (Not imported cross-tree to avoid coupling desktop's rootDir to web/.)
 */
interface AlertPayload {
  type: 'price' | 'signal' | 'auth' | 'quote';
  code: string;
  name: string;
  signal?: string;
  keyLevel?: { type: string; label: string; price: number };
  currentPrice?: number;
}

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

const ALERT_WINDOW_WIDTH = 360;
const ALERT_WINDOW_HEIGHT = 200;
const ALERT_DISMISS_MS = 15_000;

function buildAlertHtml(alerts: AlertPayload[]): string {
  const items = alerts
    .sort((a, b) => {
      const order = { price: 0, signal: 1, auth: 2, quote: 3 } as const;
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    })
    .map((a) => {
      if (a.type === 'price') {
        const dir = a.currentPrice != null && a.keyLevel != null && a.currentPrice <= (a.keyLevel.price ?? 0) ? '↓跌破' : '↑突破';
        return `<div class="alert-item alert-price">
          <span class="dot price-dot"></span>
          <span class="alert-name">${escapeHtml(a.name)}</span>
          <span class="alert-detail">${dir}${escapeHtml(a.keyLevel?.label ?? '关键位')} ${a.keyLevel?.price?.toFixed(2)} → 现价 ${a.currentPrice?.toFixed(2)}</span>
        </div>`;
      }
      if (a.type === 'signal') {
        return `<div class="alert-item alert-signal">
          <span class="dot signal-dot"></span>
          <span class="alert-name">${escapeHtml(a.name)}</span>
          <span class="alert-detail">· ${escapeHtml(a.signal ?? '')}</span>
        </div>`;
      }
      if (a.type === 'auth') {
        return `<div class="alert-item alert-error">
          <span class="dot error-dot"></span>
          <span>API Key 校验失败或额度不足</span>
        </div>`;
      }
      return `<div class="alert-item alert-error">
        <span class="dot error-dot"></span>
        <span>行情全部拉取失败</span>
      </div>`;
    })
    .join('');

  const title = alerts.length > 1
    ? `${alerts.length} 条新预警`
    : 'AguMaster 预警';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;color:#fff;
      background:rgba(20,20,20,0.94);border-radius:10px;overflow:hidden;
      user-select:none;-webkit-app-region:no-drag;padding:16px;}
    .title{font-size:13px;font-weight:600;color:#8c8c8c;margin-bottom:10px;}
    .alert-item{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;}
    .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
    .price-dot{background:#faad14;}
    .signal-dot{background:#ff4d4f;}
    .error-dot{background:#ff7875;}
    .alert-name{font-weight:600;white-space:nowrap;}
    .alert-detail{color:#bfbfbf;}
    .footer{margin-top:12px;display:flex;gap:8px;justify-content:flex-end;}
    button{min-height:28px;padding:4px 14px;border-radius:6px;border:1px solid #434343;
      background:#1f1f1f;color:#ccc;font-size:12px;cursor:pointer;}
    button:hover{background:#303030;color:#fff;}
    button.primary{background:#1677ff;border-color:#1677ff;color:#fff;}
    button.primary:hover{background:#4096ff;}
  </style></head><body>
    <div class="title">${escapeHtml(title)}</div>
    <div>${items}</div>
    <div class="footer">
      <button onclick="window.closeAlert()">忽略</button>
      <button class="primary" onclick="window.openDashboard()">查看完整看板</button>
    </div>
    <script>
      const {ipcRenderer}=require('electron');
      window.closeAlert=()=>ipcRenderer.send('agu:close-alert');
      window.openDashboard=()=>{ipcRenderer.send('agu:open-dashboard');ipcRenderer.send('agu:close-alert');};
    <\/script>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showAlertPopup(alerts: AlertPayload[]): void {
  if (alerts.length === 0) {
    return;
  }

  dismissAlertWindow();

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  alertWindow = new BrowserWindow({
    width: ALERT_WINDOW_WIDTH,
    height: ALERT_WINDOW_HEIGHT,
    x: screenW - ALERT_WINDOW_WIDTH - 20,
    y: screenH - ALERT_WINDOW_HEIGHT - 20,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  void alertWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildAlertHtml(alerts))}`);
  alertWindow.once('ready-to-show', () => {
    alertWindow?.show();
    alertDismissTimer = setTimeout(dismissAlertWindow, ALERT_DISMISS_MS);
  });
  alertWindow.on('closed', () => {
    alertWindow = null;
  });
}

function dismissAlertWindow(): void {
  if (alertDismissTimer) {
    clearTimeout(alertDismissTimer);
    alertDismissTimer = null;
  }
  if (alertWindow && !alertWindow.isDestroyed()) {
    alertWindow.close();
  }
  alertWindow = null;
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
