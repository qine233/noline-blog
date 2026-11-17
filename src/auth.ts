import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// --- Password hashing (scrypt) -------------------------------------------
// Stored as "saltHex:hashHex". scrypt is memory-hard, built into node:crypto.

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// --- Signed session cookies ----------------------------------------------
// Stateless: cookie = base64url("userId.expiry") + "." + HMAC signature.
// The secret is persisted to disk so sessions survive a server restart.

const DATA_DIR = path.join(process.cwd(), 'data');
const SECRET_PATH = path.join(DATA_DIR, 'session-secret');

function loadSecret(): Buffer {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(SECRET_PATH)) {
    return Buffer.from(readFileSync(SECRET_PATH, 'utf8').trim(), 'hex');
  }
  const secret = randomBytes(32);
  writeFileSync(SECRET_PATH, secret.toString('hex'), { mode: 0o600 });
  return secret;
}

const SECRET = loadSecret();

export const SESSION_COOKIE = 'blog_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function signSession(userId: number): string {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiry}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySession(token: string): number | null {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expected = createHmac('sha256', SECRET)
    .update(payloadB64)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const [userIdStr, expiryStr] = payload.split('.');
  const userId = Number(userIdStr);
  const expiry = Number(expiryStr);
  if (!Number.isInteger(userId) || !Number.isFinite(expiry)) return null;
  if (Date.now() > expiry) return null;
  return userId;
}
