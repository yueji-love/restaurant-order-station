import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = 'restaurant_session';
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().normalize('NFKC') : '';
}

export async function createPasswordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return {
    passwordSalt: salt,
    passwordHash: Buffer.from(derivedKey).toString('hex'),
  };
}

export async function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const derivedKey = Buffer.from(await scryptAsync(password, user.passwordSalt, 64));
  const storedKey = Buffer.from(user.passwordHash, 'hex');
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function readCookie(request, name) {
  const header = request.headers.cookie ?? '';
  const entry = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

export function createSessionCookie(request, token, maxAgeSeconds) {
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const secure = request.secure || forwardedProtocol === 'https';
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}
