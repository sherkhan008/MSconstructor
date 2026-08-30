import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * scrypt password hashing — Node's built-in `crypto`, no dependency needed.
 * Stored format is `${saltHex}:${derivedKeyHex}`. Shared by prisma/seed.ts
 * (initial admin bootstrap) and the admin login route so there is exactly
 * one hashing implementation in the whole project.
 */

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, derivedHex] = storedHash.split(':');
  if (!salt || !derivedHex) return false;

  const derived = scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(derivedHex, 'hex');
  if (derived.length !== stored.length) return false;

  return timingSafeEqual(derived, stored);
}
