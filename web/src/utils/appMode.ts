export type AppMode = 'browser' | 'dashboard' | 'widget';

export function getAppMode(): AppMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'widget') {
    return 'widget';
  }
  if (mode === 'dashboard' && isDesktopRuntime()) {
    return 'dashboard';
  }
  if (isDesktopRuntime()) {
    return 'dashboard';
  }
  return 'browser';
}

export function isDesktopRuntime(): boolean {
  return Boolean(window.aguDesktop?.isDesktop);
}

export function isWidgetMode(): boolean {
  return getAppMode() === 'widget';
}

export function isDashboardDesktopMode(): boolean {
  return getAppMode() === 'dashboard';
}
