import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * AES-256-GCM encryption for secrets at rest (API keys, gateway credentials, line passwords).
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
function loadKey(rawKey?: string): Buffer {
  const raw = rawKey ?? process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return key;
}

export function encrypt(plain: string, rawKey?: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(payload: string, rawKey?: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Malformed encrypted payload");
  const key = loadKey(rawKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, rawKey?: string): string {
  return encrypt(JSON.stringify(value), rawKey);
}

export function decryptJson<T>(payload: string, rawKey?: string): T {
  return JSON.parse(decrypt(payload, rawKey)) as T;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacHex(algo: "sha256" | "sha512", secret: string, data: string): string {
  return createHmac(algo, secret).update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Show only the last 4 characters of a secret, e.g. for UI display. */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 6) return "••••";
  return "••••••••" + secret.slice(-4);
}
