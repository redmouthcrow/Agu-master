import { BrowserWindow } from 'electron';

/**
 * IPC payload for desktop alerts. Structurally mirrors `AlertPayload` in
 * web/src/types/index.ts but uses a looser keyLevel shape (raw IPC JSON, no
 * enum-typed KeyLevel). Keep the two in sync if the contract changes.
 * (Not imported cross-tree to avoid coupling desktop's rootDir to web/.)
 */
export interface AlertPayload {
  type: 'price' | 'signal' | 'auth' | 'quote';
  code: string;
  name: string;
  signal?: string;
  keyLevel?: { type: string; label: string; price: number };
  currentPrice?: number;
}

const ALERT_WINDOW_WIDTH = 360;
const ALERT_WINDOW_HEIGHT = 200;
const ALERT_DISMISS_MS = 15_000;

let alertWindow: BrowserWindow | null = null;
let alertDismissTimer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

export function showAlertPopup(alerts: AlertPayload[]): void {
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

export function dismissAlertWindow(): void {
  if (alertDismissTimer) {
    clearTimeout(alertDismissTimer);
    alertDismissTimer = null;
  }
  if (alertWindow && !alertWindow.isDestroyed()) {
    alertWindow.close();
  }
  alertWindow = null;
}
