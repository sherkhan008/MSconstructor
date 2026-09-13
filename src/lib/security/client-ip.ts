import { isIP } from 'node:net';
import { env, isProductionRuntime } from '@/lib/env';

/**
 * The single source of truth for "which IP address sent this request" —
 * used by rate limiting (src/lib/rate-limit.ts) and audit logging
 * (src/lib/admin/audit.ts). Nothing else may read forwarding headers.
 *
 * Why this has to be configuration, not inference: a Next.js route handler
 * never sees the TCP peer address, and Next's own server only fills in
 * X-Forwarded-For from the socket when the client did NOT send one
 * (`??=` in next/dist/server/base-server.js). Any forwarding header a route
 * handler reads is therefore client-controlled unless a trusted reverse
 * proxy overwrote it AND the app port is reachable only through that proxy.
 * The app cannot verify either fact itself, so the deployment declares them
 * explicitly — see docs/production-client-ip-and-rate-limiting.md.
 *
 * Trust modes:
 * - `trusted-proxy-header` — TRUSTED_PROXY_CLIENT_IP_HEADER is set. Exactly
 *   that header is read, and it must hold exactly one IP literal (a list
 *   means the proxy appended instead of overwrote, which is rejected).
 * - `development-forwarded-for` — header unset outside production runtime.
 *   Leftmost X-Forwarded-For / X-Real-IP, for local dev, Vitest and the
 *   Playwright server only. Never selectable in production runtime.
 * - `untrusted` — header unset (or invalid) in production runtime. No
 *   header is trusted; every client resolves to `null`, so rate limits
 *   collapse into one shared bucket per limiter (fail closed — cannot be
 *   bypassed) and audit rows record no IP.
 */

export type ClientIpTrustMode = 'trusted-proxy-header' | 'development-forwarded-for' | 'untrusted';

export interface ClientIpPolicy {
  mode: ClientIpTrustMode;
  /** Lowercase header name; only set for `trusted-proxy-header`. */
  header?: string;
  /** True when a header was configured but its name is not a valid token. */
  misconfigured?: boolean;
  productionRuntime: boolean;
}

const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function createClientIpPolicy(input: { trustedHeader?: string; productionRuntime: boolean }): ClientIpPolicy {
  const header = input.trustedHeader?.trim().toLowerCase();
  if (header) {
    if (HEADER_NAME.test(header)) {
      return { mode: 'trusted-proxy-header', header, productionRuntime: input.productionRuntime };
    }
    return {
      mode: input.productionRuntime ? 'untrusted' : 'development-forwarded-for',
      misconfigured: true,
      productionRuntime: input.productionRuntime,
    };
  }
  return {
    mode: input.productionRuntime ? 'untrusted' : 'development-forwarded-for',
    productionRuntime: input.productionRuntime,
  };
}

export const clientIpPolicy: ClientIpPolicy = createClientIpPolicy({
  trustedHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
  productionRuntime: isProductionRuntime,
});

let warnedAboutPolicy = false;
function warnOnceAboutPolicy(policy: ClientIpPolicy): void {
  if (warnedAboutPolicy || !policy.productionRuntime || policy.mode !== 'untrusted') return;
  warnedAboutPolicy = true;
  console.error(
    policy.misconfigured
      ? '[client-ip] TRUSTED_PROXY_CLIENT_IP_HEADER is not a valid header name. No forwarding header is trusted: ' +
          'all clients share one rate-limit bucket per endpoint and audit rows record no IP.'
      : '[client-ip] TRUSTED_PROXY_CLIENT_IP_HEADER is not configured. No forwarding header is trusted: ' +
          'all clients share one rate-limit bucket per endpoint and audit rows record no IP. ' +
          'See docs/production-client-ip-and-rate-limiting.md.',
  );
}

/**
 * Validates and normalizes one IP literal. Returns null for anything that is
 * not exactly one IPv4/IPv6 address (lists, ports, hostnames, garbage).
 * IPv4-mapped IPv6 (`::ffff:192.0.2.1`) is folded to plain IPv4 so the same
 * client never gets two identities; IPv6 zone ids are dropped.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > 64 || /[\s,]/.test(value)) return null;
  const withoutZone = value.split('%')[0].toLowerCase();
  const kind = isIP(withoutZone);
  if (kind === 4) return withoutZone;
  if (kind !== 6) return null;
  const groups = expandIpv6(withoutZone);
  if (!groups) return null;
  const isMappedIpv4 = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMappedIpv4) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return withoutZone;
}

/** Expands an address already validated by `isIP(...) === 6` into 8 groups. */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const tail: number[] = [];
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    tail.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    text = text.slice(0, -dotted[1].length);
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }
  const parse = (part: string) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const [head, rest] = text.split('::');
  const headGroups = parse(head);
  const restGroups = rest === undefined ? [] : parse(rest);
  const missing = 8 - tail.length - headGroups.length - restGroups.length;
  if (rest === undefined && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...headGroups, ...new Array(rest === undefined ? 0 : missing).fill(0), ...restGroups, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** The canonical client IP for this request under `policy`, or null when it
 * cannot be established from trusted input. */
export function resolveClientIp(headers: Headers, policy: ClientIpPolicy = clientIpPolicy): string | null {
  switch (policy.mode) {
    case 'trusted-proxy-header':
      // Headers.get joins repeated headers with ", " — normalizeIp rejects
      // that, so a duplicated/appended canonical header never resolves.
      return normalizeIp(headers.get(policy.header!));
    case 'development-forwarded-for': {
      const forwarded = headers.get('x-forwarded-for');
      if (forwarded) return normalizeIp(forwarded.split(',')[0]);
      return normalizeIp(headers.get('x-real-ip'));
    }
    case 'untrusted':
    default:
      warnOnceAboutPolicy(policy);
      return null;
  }
}

/**
 * Rate-limit identity for a resolved IP. IPv4 is per address. IPv6 is per
 * /64, the smallest prefix routinely assigned to one subscriber — otherwise
 * a single client could rotate through 2^64 addresses to evade limits. An
 * unresolved client maps to one shared `unresolved` identity (fail closed).
 */
export function rateLimitIdentity(ip: string | null): string {
  if (!ip) return 'unresolved';
  if (isIP(ip) === 4) return `ip4:${ip}`;
  const groups = expandIpv6(ip);
  if (!groups) return 'unresolved';
  return `ip6-64:${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}`;
}
