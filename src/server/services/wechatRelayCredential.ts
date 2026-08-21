import crypto from "node:crypto";

export type WeChatRelayCredential = {
  version: 1;
  salt: string;
  digest: string;
};

const TOKEN_BYTES = 32;

export function generateWeChatRelayToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashWeChatRelayToken(token: string): WeChatRelayCredential {
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(token, salt, TOKEN_BYTES);
  return {
    version: 1,
    salt: salt.toString("base64url"),
    digest: digest.toString("base64url")
  };
}

export function parseWeChatRelayCredential(value: string): WeChatRelayCredential | null {
  try {
    const parsed = JSON.parse(value) as Partial<WeChatRelayCredential>;
    if (parsed.version !== 1 || typeof parsed.salt !== "string" || typeof parsed.digest !== "string") return null;
    const salt = Buffer.from(parsed.salt, "base64url");
    const digest = Buffer.from(parsed.digest, "base64url");
    if (salt.length !== 16 || digest.length !== TOKEN_BYTES) return null;
    return { version: 1, salt: parsed.salt, digest: parsed.digest };
  } catch {
    return null;
  }
}

export function verifyWeChatRelayToken(token: string, credential: WeChatRelayCredential) {
  if (!token) return false;
  const expected = Buffer.from(credential.digest, "base64url");
  const actual = crypto.scryptSync(token, Buffer.from(credential.salt, "base64url"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
