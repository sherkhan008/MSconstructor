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
 *
 * What this module can check is limited to what an Edge request can do
 * offline: the signature and the expiry. Whether the session has since been
 * REVOKED is a database question, answered one layer up in
 * src/lib/auth/revocation.ts — which every Node-runtime entry point goes
 * through via getCurrentAdmin(). Keep it that way: importing Prisma here
 * would break the middleware.
 */

export const SESSION_COOKIE_NAME = 'admin_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

/**
 * Marker on /admin/login meaning "a cookie that still passes the signature
 * check was refused by the server-side revocation boundary".
 *
 * The middleware (Edge) can only see that the cookie verifies, so on its own
 * it would bounce such a visitor straight back to /admin/orders, which
 * redirects them here again — a loop. The protected layout appends this, and
 * the middleware stops redirecting when it is present. It grants nothing: the
 * login form is public, and the stale cookie is simply overwritten by the
 * next successful sign-in.
 */
export const SESSION_ENDED_PARAM = 'session';
export const SESSION_ENDED_VALUE = 'ended';
export const LOGIN_PATH_SESSION_ENDED = `/admin/login?${SESSION_ENDED_PARAM}=${SESSION_ENDED_VALUE}`;

export interface AdminSessionPayload {
  sub: string;
  email: string;
  name: string;
  role: AdminRole;
  /**
   * User.sessionVersion as it stood when this token was issued. Optional
   * only for tokens minted before the column existed; those are read as
   * version 0 (src/lib/auth/revocation.ts), so deploying revocation does not
   * sign anyone out. It is inside the signed payload, so a client can neither
   * remove nor lower it.
   */
  ver?: number;
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

export async function createSessionToken(user: {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  sessionVersion?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    ver: user.sessionVersion ?? 0,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies the signature and expiry — and nothing else. Never throws on
 * malformed/tampered/expired input; returns null instead, since an invalid
 * session is simply "not logged in".
 *
 * A payload coming back from here proves only that the cookie was issued by
 * this server and has not expired. It does NOT prove the session is still
 * live: use getCurrentAdmin() (src/lib/auth/current-admin.ts) anywhere a
 * request is actually authorized.
 */
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
