import { env, isProduction } from '@/lib/env';
import type { AdminRole } from '@/lib/types/domain';

/**
 * Signed, stateless admin session tokens: `${base64url(payload)}.${base64url(hmac)}`.
 * Uses the Web Crypto API (`crypto.subtle`), not Node's `crypto` module, so
 * the exact same code verifies a session in `src/middleware.ts` (Edge
 * runtime) and in Route Handlers/Server Components (Node runtime) — no
 * separate "edge-safe" implementation to keep in sync, and no new
 * dependency (no next-auth/jose/iron-session) for what is, at its core, one
 * HMAC check.
 *
 * The token is never trusted without verifying its signature against
 * AUTH_SECRET first — a client can read/copy the cookie but cannot forge or
 * edit it without knowing that secret.
 */

export const SESSION_COOKIE_NAME = 'admin_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

export interface AdminSessionPayload {
  sub: string;
  email: string;
  name: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  if (!env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is required to create or verify admin sessions.');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionToken(user: { id: string; email: string; name: string; role: AdminRole }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Verifies the signature and expiry. Never throws on malformed/tampered/expired input — returns null instead, since an invalid session is simply "not logged in". */
export async function verifySessionToken(token: string | undefined | null): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) return null;

  try {
    const payloadBytes = base64UrlDecode(payloadPart);
    const signatureBytes = base64UrlDecode(signaturePart);
    const key = await getHmacKey();
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, payloadBytes);
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as AdminSessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie options shared by every route that sets/clears the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
}
