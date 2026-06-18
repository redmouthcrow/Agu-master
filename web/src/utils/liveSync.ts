import type { LiveSyncPayload } from '../types';

/** IPC / localStorage 需要纯 JSON 对象，避免 Vue Proxy 序列化失败 */
export function cloneLiveSyncPayload(payload: LiveSyncPayload): LiveSyncPayload {
  return JSON.parse(JSON.stringify(payload)) as LiveSyncPayload;
}

export function isNewerLiveSync(
  incoming: LiveSyncPayload,
  lastAppliedTs: number,
): boolean {
  return incoming.ts > lastAppliedTs;
}
