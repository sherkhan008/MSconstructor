# Client IP trust and rate limiting in production

This document is the deployment contract for how MS Shelving identifies a
client and enforces rate limits. Code: `src/lib/security/client-ip.ts`,
`src/lib/rate-limit.ts`, `src/lib/redis/resp-client.ts`,
`deploy/nginx/default.conf`.

## Why this needs explicit configuration

A Next.js route handler never sees the TCP peer address. Next's server only
fills `X-Forwarded-For` from the socket when the request does **not** already
carry one, so a client can send any value it likes. The application cannot
tell a proxy-written header from a client-written one. Only the deployment
can guarantee that, so the deployment has to declare it.

## Proxy contract

| Item | Value |
| --- | --- |
| Trusted proxy | The `proxy` service in `docker-compose.yml` (nginx, `deploy/nginx/default.conf`). No CDN is configured in this repository. |
| Canonical client-IP header | `X-Real-IP` (`TRUSTED_PROXY_CLIENT_IP_HEADER=x-real-ip`) |
| Overwrite or append | **Overwrite.** `proxy_set_header X-Real-IP $remote_addr;` and `X-Forwarded-For $remote_addr;`. Client-supplied values, including repeated headers, are discarded. `Forwarded`, `X-Forwarded-Port`, `X-Client-IP`, `True-Client-IP` and `CF-Connecting-IP` are stripped. |
| App port exposure | The `app` service publishes **no** host port (`expose: 3000` only). Port 3000 on the host belongs to nginx. The app must never be reachable except through the proxy. |
| Header value format | Exactly one IPv4 or IPv6 literal. A list, a port or a hostname is rejected. The request is then treated as unresolved. |

### Requirements for any other deployment

If you deploy without this compose file (a PaaS, Kubernetes, a separate
load balancer), you must provide the same guarantees yourself before you set
`TRUSTED_PROXY_CLIENT_IP_HEADER`:

1. A proxy you control sets the chosen header to the connecting client's IP
   and **replaces** any value the client sent.
2. The application port accepts connections only from that proxy (a private
   network, a security group or firewall rule, or a Kubernetes NetworkPolicy).
3. If there is more than one hop (for example CDN → nginx → app), the hop
   next to the app must itself trust only the previous hop. With nginx, use
   `ngx_http_realip_module`: `set_real_ip_from` with that hop's published
   address ranges, and `real_ip_header` with its canonical header. Never
   trust a forwarding header from arbitrary sources.

If you cannot guarantee 1 and 2, leave `TRUSTED_PROXY_CLIENT_IP_HEADER`
unset. The limits then stay safe but become global (see below).

Docker Desktop note: behind Docker Desktop's port forwarding, `$remote_addr`
is the VM gateway (for example `172.19.0.1`), so every local client shares
one identity. On a Linux host with the default iptables port publishing,
nginx sees the real client address.

## Trust modes

| Runtime | `TRUSTED_PROXY_CLIENT_IP_HEADER` | Client IP used |
| --- | --- | --- |
| production runtime | set (valid header name) | That header only. It must hold a single IP. |
| production runtime | unset or invalid | **None.** Every client is `unresolved` and shares one bucket per limiter. Audit rows store no IP. A one-time error is logged. |
| development / test / build | set | That header only, the same as production. |
| development / test / build | unset | Leftmost `X-Forwarded-For`, otherwise `X-Real-IP`. Local dev, Vitest and the Playwright server use this. |

"Production runtime" means `NODE_ENV=production` outside the
`next build` phase. The development fallback cannot be selected in production
runtime.

Rate limiting and audit logging use the same resolver:
`rateLimitIdentity(resolveClientIp(headers))` and
`requestMeta(headers).ipAddress`.

- For rate limiting, an IPv6 client is grouped by its `/64` prefix, so one
  subscriber cannot rotate through its own address block.
- An IPv4-mapped IPv6 address is folded to IPv4.

## Rate limits

The numbers did not change.

| Limiter | Limit | Window | If Redis is unavailable |
| --- | --- | --- | --- |
| `pricing` | 60 | 60 s | local memory fallback |
| `orders` | 5 | 60 s | local memory fallback |
| `contact` | 5 | 60 s | local memory fallback |
| `promoCode` | 20 | 60 s | local memory fallback |
| `adminLogin` | 10 | 60 s | **deny (HTTP 503)** |

### Storage

- **`REDIS_URL` set:** counters are shared by every app instance. Each hit
  is one atomic `MULTI/EXEC`: `SET key 0 PX <window> NX`, `INCR key`,
  `PTTL key`.
  - The TTL is set only when a window opens, so every key expires on its own.
  - Key format: `ms-shelving:rate-limit:v1:<limiter>:<identity>`. Each
    limiter has its own namespace.
  - Nothing is ever bulk-deleted or flushed.
- **`REDIS_URL` unset:** per-process memory with a separate bounded map for
  each limiter (50,000 windows each).
  - When a map is full, expired windows are dropped first.
  - If it is still full, only the single oldest window is evicted. There is
    no global clear.
  - This mode is correct for a single instance only.

### Failure policy (Redis configured but unreachable or erroring)

- Connect and command timeouts are 1 s each. After a failure, Redis is
  skipped for 5 s so that requests do not queue up behind timeouts.
- **Public endpoints** keep enforcing the same limits from per-instance
  memory. With N instances, the effective ceiling during an outage is
  N × limit. Limits never become unlimited, and the storefront stays up.
- **Admin login** is refused with HTTP 503 until Redis answers again.
  Otherwise an outage would multiply the brute-force allowance by the
  instance count. Existing admin sessions are unaffected because they are
  verified by HMAC and do not use Redis.

## Required production configuration

1. Set `NODE_ENV=production` (the Docker image already does).
2. Set `TRUSTED_PROXY_CLIENT_IP_HEADER=x-real-ip` and put the app behind the
   nginx proxy, or behind an equivalent proxy that meets the contract above.
3. Do not publish the app port. Only the proxy is public.
4. Set `REDIS_URL` whenever more than one app instance runs. Keep Redis on
   a private network or loopback, and use a password or ACL user (and
   `rediss://`) whenever Redis is reachable beyond one host.
5. Terminate TLS in front of nginx or inside it. If TLS terminates at an
   upstream load balancer or CDN, apply requirement 3 above.

## Known limitations

- The application cannot detect a proxy misconfiguration on its own. If the
  app port is exposed directly while `TRUSTED_PROXY_CLIENT_IP_HEADER` is set,
  clients can forge that header. Keeping the port private is an
  infrastructure responsibility.
- Admin login is limited per client IP only, not per account. An attacker
  with many real IP addresses gets 10 attempts per minute from each one.
- Fixed windows allow up to 2 × limit requests across a window boundary.
  This is the same behaviour as before.
- Clients behind one NAT or carrier-grade NAT share a bucket.
