import type { AlertPayload, AppConfig, DiagnosisCacheEntry, LiveSyncPayload } from './index';

export interface AguDesktopBridge {
  isDesktop: true;
  mode: 'dashboard' | 'widget' | null;
  setOpacity: (opacity: number) => void;
  setAlwaysOnTop: (flag: boolean) => void;
  openDashboard: () => void;
  hideWidget: () => void;
  minimizeWidget: () => void;
  requestRefresh: () => void;
  requestRefreshSymbol: (code: string) => void;
  requestSync: () => void;
  onRunRefresh: (callback: () => void) => () => void;
  onRunRefreshSymbol: (callback: (code: string) => void) => () => void;
  onPushSync: (callback: () => void) => () => void;
  broadcastLiveSync: (payload: LiveSyncPayload) => void;
  onLiveSync: (callback: (payload: LiveSyncPayload) => void) => () => void;
  loadUserData: () => Promise<{
    config: AppConfig | null;
    diagnosisCache: Record<string, DiagnosisCacheEntry> | null;
    liveSync: LiveSyncPayload | null;
    encryptionAvailable: boolean;
    userDataPath: string;
  }>;
  saveConfig: (config: AppConfig) => Promise<boolean>;
  saveDiagnosisCache: (cache: Record<string, DiagnosisCacheEntry>) => Promise<boolean>;
  saveLiveSync: (payload: LiveSyncPayload) => Promise<boolean>;
  loadLiveSync: () => Promise<LiveSyncPayload | null>;
  storageGet: <T>(key: string) => Promise<T | null>;
  storageSet: (key: string, value: unknown) => Promise<boolean>;
  storageRemove: (key: string) => Promise<void>;
  cleanupCalendars: (keepYears: number[]) => Promise<void>;
  importMigration: (payload: {
    config?: AppConfig | null;
    diagnosisCache?: Record<string, DiagnosisCacheEntry> | null;
    liveSync?: LiveSyncPayload | null;
  }) => Promise<boolean>;
  exportBackup: () => Promise<{ ok: boolean; path?: string }>;
  sendAlert: (alerts: AlertPayload[]) => void;
}

declare global {
  interface Window {
    aguDesktop?: AguDesktopBridge;
    /** Desktop dashboard: flush userData before main window hides */
    __aguFlushPersistence?: () => Promise<void>;
  }
}

export {};
