import { describe, expect, it } from 'vitest';
import {
  createClientIpPolicy,
  normalizeIp,
  rateLimitIdentity,
  resolveClientIp,
} from '@/lib/security/client-ip';

/**
 * Trusted client-IP resolution (src/lib/security/client-ip.ts). Policies are
 * built explicitly here so production and development trust models are both
 * proven regardless of the NODE_ENV Vitest itself runs under.
 */

const productionProxy = createClientIpPolicy({ trustedHeader: 'X-Real-IP', productionRuntime: true });
const productionNoProxy = createClientIpPolicy({ productionRuntime: true });
const development = createClientIpPolicy({ productionRuntime: false });

const h = (init: Record<string, string> | [string, string][]) => new Headers(init);

describe('policy selection', () => {
  it('uses only the configured header when a trusted proxy is declared', () => {
    expect(productionProxy).toMatchObject({ mode: 'trusted-proxy-header', header: 'x-real-ip' });
  });

  it('never falls back to X-Forwarded-For in production runtime', () => {
    expect(productionNoProxy.mode).toBe('untrusted');
    expect(createClientIpPolicy({ trustedHeader: 'bad header!', productionRuntime: true })).toMatchObject({
      mode: 'untrusted',
      misconfigured: true,
    });
  });

  it('allows the X-Forwarded-For fallback only outside production runtime', () => {
    expect(development.mode).toBe('development-forwarded-for');
  });
});

describe('production trust model (trusted proxy header)', () => {
  it('respects the canonical IP written by the trusted proxy', () => {
    expect(resolveClientIp(h({ 'x-real-ip': '203.0.113.9' }), productionProxy)).toBe('203.0.113.9');
  });

  it('ignores arbitrary client X-Forwarded-For and other forwarding headers', () => {
    const headers = h({
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '1.1.1.1, 2.2.2.2',
      forwarded: 'for=3.3.3.3',
      'cf-connecting-ip': '4.4.4.4',
      'true-client-ip': '5.5.5.5',
    });
    expect(resolveClientIp(headers, productionProxy)).toBe('203.0.113.9');
  });

  it('rotating X-Forwarded-For never changes the identity', () => {
    const identities = new Set(
      Array.from({ length: 50 }, (_, i) =>
        rateLimitIdentity(resolveClientIp(h({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': `10.0.0.${i}` }), productionProxy)),
      ),
    );
    expect([...identities]).toEqual(['ip4:203.0.113.9']);
  });

  it('rejects a spoofed chain in the canonical header (proxy appended instead of overwrote)', () => {
    expect(resolveClientIp(h({ 'x-real-ip': '6.6.6.6, 203.0.113.9' }), productionProxy)).toBeNull();
    // Repeated header lines are joined by Headers.get — also rejected.
    expect(resolveClientIp(h([['x-real-ip', '6.6.6.6'], ['x-real-ip', '203.0.113.9']]), productionProxy)).toBeNull();
  });

  it('rejects non-IP values', () => {
    for (const value of ['unknown', 'example.com', '203.0.113.9:443', '[::1]:443', '999.1.1.1', '']) {
      expect(resolveClientIp(h({ 'x-real-ip': value }), productionProxy)).toBeNull();
    }
  });

  it('with no trusted proxy declared, forwarding headers are never trusted', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' }), productionNoProxy)).toBeNull();
    expect(rateLimitIdentity(null)).toBe('unresolved');
  });
});

describe('development/test fallback', () => {
  it('uses the leftmost X-Forwarded-For, then X-Real-IP', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '10.1.2.3, 10.9.9.9' }), development)).toBe('10.1.2.3');
    expect(resolveClientIp(h({ 'x-real-ip': '10.4.5.6' }), development)).toBe('10.4.5.6');
    expect(resolveClientIp(h({}), development)).toBeNull();
  });
});

describe('normalization and identities', () => {
  it('folds IPv4-mapped IPv6 to IPv4 so one client has one identity', () => {
    expect(normalizeIp('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(normalizeIp('::FFFF:c633:6407')).toBe('198.51.100.7');
  });

  it('groups IPv6 clients by /64 so address rotation inside one subscriber prefix does not help', () => {
    const a = rateLimitIdentity(normalizeIp('2001:db8:1:2::1'));
    const b = rateLimitIdentity(normalizeIp('2001:0db8:0001:0002:ffff:ffff:ffff:fffe'));
    const other = rateLimitIdentity(normalizeIp('2001:db8:1:3::1'));
    expect(a).toBe('ip6-64:2001:db8:1:2');
    expect(b).toBe(a);
    expect(other).not.toBe(a);
  });

  it('keeps distinct IPv4 clients distinct', () => {
    expect(rateLimitIdentity('198.51.100.1')).not.toBe(rateLimitIdentity('198.51.100.2'));
  });
});
