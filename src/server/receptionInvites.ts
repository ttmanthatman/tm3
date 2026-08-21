import crypto from "node:crypto";

const INVITE_VERSION = 1;
const INVITE_IV_BYTES = 12;
const INVITE_TAG_BYTES = 16;
const INVITE_KEY_CONTEXT = "team-chat:reception-invite:v1";

export type ReceptionInvitePayload = {
  roomId: number;
  expiresAt: number;
  tokenHash: string;
};

type ReceptionInviteRoom = {
  id: number;
  receptionExpiresAt: Date | null;
  receptionTokenHash: string | null;
};

function inviteKey(secret: string) {
  return crypto.createHmac("sha256", secret).update(INVITE_KEY_CONTEXT).digest();
}

function validPayload(value: unknown): value is { c: number; e: number; h: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Number.isInteger(payload.c) && Number(payload.c) > 0
    && Number.isSafeInteger(payload.e) && Number(payload.e) > 0
    && typeof payload.h === "string" && /^[0-9a-f]{64}$/.test(payload.h);
}

function sameSecretValue(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function createReceptionInviteToken(payload: ReceptionInvitePayload, secret: string, iv = crypto.randomBytes(INVITE_IV_BYTES)) {
  if (iv.length !== INVITE_IV_BYTES) throw new Error("会客厅邀请令牌初始化向量无效");
  if (!validPayload({ c: payload.roomId, e: payload.expiresAt, h: payload.tokenHash })) {
    throw new Error("会客厅邀请资料无效");
  }
  const cipher = crypto.createCipheriv("aes-256-gcm", inviteKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ c: payload.roomId, e: payload.expiresAt, h: payload.tokenHash }), "utf8"),
    cipher.final()
  ]);
  return Buffer.concat([
    Buffer.from([INVITE_VERSION]),
    iv,
    cipher.getAuthTag(),
    encrypted
  ]).toString("base64url");
}

export function readReceptionInviteToken(token: string, secret: string): ReceptionInvitePayload {
  if (!/^[A-Za-z0-9_-]{40,512}$/.test(token)) throw new Error("会客厅邀请链接无效");
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes[0] !== INVITE_VERSION || bytes.length <= 1 + INVITE_IV_BYTES + INVITE_TAG_BYTES) {
      throw new Error("invalid reception invite envelope");
    }
    const ivStart = 1;
    const tagStart = ivStart + INVITE_IV_BYTES;
    const bodyStart = tagStart + INVITE_TAG_BYTES;
    const decipher = crypto.createDecipheriv("aes-256-gcm", inviteKey(secret), bytes.subarray(ivStart, tagStart));
    decipher.setAuthTag(bytes.subarray(tagStart, bodyStart));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(bodyStart)), decipher.final()]).toString("utf8");
    const payload: unknown = JSON.parse(plaintext);
    if (!validPayload(payload)) throw new Error("invalid reception invite payload");
    return { roomId: payload.c, expiresAt: payload.e, tokenHash: payload.h };
  } catch {
    throw new Error("会客厅邀请链接无效");
  }
}

export function receptionInviteMatchesRoom(payload: ReceptionInvitePayload, room: ReceptionInviteRoom, now = Date.now()) {
  if (payload.roomId !== room.id || !room.receptionExpiresAt || !room.receptionTokenHash) return false;
  const roomExpiresAt = room.receptionExpiresAt.getTime();
  return payload.expiresAt > now
    && roomExpiresAt > now
    && payload.expiresAt <= roomExpiresAt
    && sameSecretValue(payload.tokenHash, room.receptionTokenHash);
}

export function receptionDurationLabel(durationHours: number) {
  if (durationHours % 24 === 0) return `${durationHours / 24} 天`;
  return `${durationHours} 小时`;
}

export function receptionWelcomeMessage(durationHours: number) {
  return [
    "欢迎来到临时会客厅。",
    `本会客厅有效期为 ${receptionDurationLabel(durationHours)}。`,
    "访问与消息传输使用加密连接保护。",
    "到期后，来访令牌会立即失效，无法再次登录；会客厅以及其中的消息和附件将被自动销毁。"
  ].join("\n");
}

export function receptionInviteUrl(invitePath: string, configuredOrigin?: string) {
  if (!configuredOrigin) return null;
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") {
    throw new Error("RECEPTION_INVITE_ORIGIN must use HTTPS");
  }
  if (origin.username || origin.password || origin.search || origin.hash || !["", "/"].includes(origin.pathname)) {
    throw new Error("RECEPTION_INVITE_ORIGIN must be an origin without a path, query, or credentials");
  }
  return new URL(invitePath, origin).toString();
}
