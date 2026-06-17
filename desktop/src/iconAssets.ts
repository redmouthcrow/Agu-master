import { app, nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const DEV_PORT = Number(process.env.AGU_DEV_PORT ?? 5180);
export const isDev = !app.isPackaged;
export const APP_NAME = 'AguMaster';

export function isZhLocale(): boolean {
  return app.getLocale().toLowerCase().startsWith('zh');
}

/** Pick the zh or en string based on the user's locale. */
export function shellText(zh: string, en: string): string {
  return isZhLocale() ? zh : en;
}

export function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

/** Packaged: resources/img; dev: desktop/img (dist/../img) */
export function assetPath(...parts: string[]): string {
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

export function loadPngIcon(filename: string, size?: number): NativeImage {
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

export function appWindowIcon(): NativeImage | undefined {
  const icon = loadPngIcon('icon-256.png');
  return icon.isEmpty() ? undefined : icon;
}

export function createTrayIcon(): NativeImage {
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

export function pageUrl(mode: 'dashboard' | 'widget'): string {
  if (isDev) {
    return `http://127.0.0.1:${DEV_PORT}/?mode=${mode}`;
  }
  const indexHtml = path.join(process.resourcesPath, 'web', 'index.html');
  return `file://${indexHtml}?mode=${mode}`;
}
