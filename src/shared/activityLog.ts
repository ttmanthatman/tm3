export type ActivityLogCategory = "session" | "music" | "usage";

export type MusicProgressState = "started" | "progress" | "paused" | "changed" | "ended" | "error";

export const MUSIC_PROGRESS_LOG_INTERVAL_MS = 5_000;

const SESSION_ACTIVITY_KINDS = new Set(["auth_login", "auth_logout", "session_replaced", "session_revoked", "presence_join", "presence_leave"]);

export function friendlyDeviceName(rawName?: unknown, userAgent = "", maxTouchPoints = 0) {
  const name = String(rawName || "").trim().slice(0, 120);
  const ua = userAgent.toLowerCase();
  const genericPlatform = !name || /^(macintel|win32|win64|linux.*|unknown|未知设备)$/i.test(name);
  if (!genericPlatform) return name;
  if (/macintel/i.test(name) && maxTouchPoints > 1) return "iPad";
  if (/iphone|ipod/.test(ua)) return "iPhone";
  if (/ipad/.test(ua)) return "iPad";
  if (/android/.test(ua) && /mobile/.test(ua)) return "Android 手机";
  if (/android/.test(ua)) return "Android 平板";
  if (/macintosh|mac os/.test(ua) || /^macintel$/i.test(name)) return "Mac";
  if (/windows/.test(ua) || /^win(32|64)$/i.test(name)) return "Windows";
  return "未知设备";
}

export function shouldWriteMusicProgress(state: MusicProgressState, elapsedSinceLastLogMs: number) {
  return state !== "progress" || elapsedSinceLastLogMs >= MUSIC_PROGRESS_LOG_INTERVAL_MS;
}

export function activityLogCategory(kind: string): ActivityLogCategory {
  if (SESSION_ACTIVITY_KINDS.has(kind)) return "session";
  if (kind.startsWith("music_")) return "music";
  return "usage";
}
