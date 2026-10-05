import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guards for the production deployment contract. They read the
 * committed files as text (no YAML dependency) and pin the properties the
 * runtime cannot verify itself: what is published, where secrets come from,
 * and that nothing sensitive can enter an image or git.
 * The live proof is scripts/ops/smoke-test.sh against a running stack.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
/** Drops whole-line `#` comments (YAML, nginx, shell). */
const withoutComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

/** Top-level service blocks of a compose file: name -> block text. */
function composeServices(text: string): Map<string, string> {
  const services = new Map<string, string>();
  const body = text.split(/^services:\n/m)[1] ?? '';
  let current: string | null = null;
  let lines: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\S/.test(line)) break; // next top-level key
    const header = line.match(/^ {2}([a-z0-9_-]+):\s*$/);
    if (header) {
      if (current) services.set(current, lines.join('\n'));
      current = header[1];
      lines = [];
    } else if (current) {
      lines.push(line);
    }
  }
  if (current) services.set(current, lines.join('\n'));
  return services;
}

/** Top-level `server { ... }` blocks of an nginx file (brace-matched, comments dropped). */
function nginxServers(text: string): string[] {
  const code = withoutComments(text);
  const servers: string[] = [];
  for (const match of code.matchAll(/^server\s*\{/gm)) {
    let depth = 0;
    for (let i = match.index; i < code.length; i++) {
      if (code[i] === '{') depth++;
      if (code[i] === '}' && --depth === 0) {
        servers.push(code.slice(match.index, i + 1));
        break;
      }
    }
  }
  return servers;
}

/** Items of a compose list key (`ports:`, `volumes:`, `environment:`) in a service block. */
function composeList(block: string, key: string): string[] {
  const section = block.split(new RegExp(`^ {4}${key}:\\n`, 'm'))[1] ?? '';
  const items: string[] = [];
  for (const line of section.split('\n')) {
    if (/^ {6}#/.test(line)) continue;
    const item = line.match(/^ {6}- "?([^"]*)"?$/);
    if (!item) break;
    items.push(item[1]);
  }
  return items;
}

describe('docker-compose.yml (production)', () => {
  const compose = read('docker-compose.yml');
  const services = composeServices(compose);

  it('defines the expected services', () => {
    expect([...services.keys()].sort()).toEqual(['app', 'migrate', 'notifications-worker', 'postgres', 'proxy', 'redis']);
  });

  it('runs the notifications retry worker as its own long-running service from the migrate image', () => {
    const worker = services.get('notifications-worker') ?? '';
    expect(worker).toMatch(/target: migrator/);
    expect(worker).toMatch(/image: ms-shelving-migrate:\$\{APP_IMAGE_TAG:-latest\}/);
    expect(worker).toMatch(/command: \["\.\/node_modules\/\.bin\/tsx", "scripts\/notification-retry-worker\.ts"\]/);
    expect(worker).toMatch(/restart: unless-stopped/);
    expect(worker).toMatch(/^ {4}networks: \[edge, backend\]$/m);
    expect(worker).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
    expect(withoutComments(worker)).not.toMatch(/ADMIN_INITIAL_PASSWORD|AUTH_SECRET/);
    // Same notification channel variables as the app, so a retry uses the same configuration.
    const channelVars = (block: string) =>
      [...block.matchAll(/^ {6}- ((?:TELEGRAM|WHATSAPP|SMTP)_[A-Z_]+)$/gm)].map((m) => m[1]).sort();
    expect(channelVars(worker)).toEqual(channelVars(services.get('app') ?? ''));
    expect(channelVars(worker).length).toBeGreaterThan(0);
    const deploy = withoutComments(read('scripts/ops/deploy.sh'));
    expect(deploy).toMatch(/compose up -d --no-deps --no-build notifications-worker/);
  });

  it('publishes host ports only for the nginx proxy', () => {
    for (const [name, block] of services) {
      const publishes = /^ {4}ports:/m.test(block);
      expect({ service: name, publishes }).toEqual({ service: name, publishes: name === 'proxy' });
    }
  });

  it('keeps PostgreSQL and Redis on the internal backend network only', () => {
    expect(compose).toMatch(/^ {2}backend:\n {4}internal: true/m);
    for (const name of ['postgres', 'redis', 'migrate']) {
      expect(services.get(name)).toMatch(/^ {4}networks: \[backend\]$/m);
    }
    expect(services.get('proxy')).toMatch(/^ {4}networks: \[edge\]$/m);
  });

  it('has no default value for any secret and requires each one explicitly', () => {
    for (const secret of ['AUTH_SECRET', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'APP_URL']) {
      expect(compose).not.toMatch(new RegExp(`\\$\\{${secret}:?-`));
      expect(compose).toMatch(new RegExp(`\\$\\{${secret}:\\?`));
    }
    expect(compose).not.toMatch(/change-?me/i);
    expect(compose).not.toMatch(/ChangeMe123/);
    expect(compose).not.toMatch(/POSTGRES_PASSWORD: ms_shelving/);
  });

  it('never passes the one-time admin seed password to the running app', () => {
    expect(withoutComments(services.get('app') ?? '')).not.toMatch(/ADMIN_INITIAL_PASSWORD/);
  });

  it('declares the trusted client-IP header that nginx overwrites', () => {
    expect(services.get('app')).toMatch(/- TRUSTED_PROXY_CLIENT_IP_HEADER=x-real-ip$/m);
    const nginx = withoutComments(read('deploy/nginx/app-proxy.conf'));
    expect(nginx).toMatch(/proxy_set_header X-Real-IP \$remote_addr;/);
    expect(nginx).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/);
    expect(nginx).not.toMatch(/\$proxy_add_x_forwarded_for/);
  });

  it('runs migrations before the app starts, in a separate one-shot service', () => {
    expect(services.get('app')).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
    expect(services.get('migrate')).toMatch(/target: migrator/);
    expect(services.get('migrate')).toMatch(/restart: "no"/);
  });

  it('disables Redis persistence and requires a Redis password', () => {
    const redis = services.get('redis') ?? '';
    expect(redis).toMatch(/--save ""/);
    expect(redis).toMatch(/--appendonly no/);
    expect(redis).toMatch(/--requirepass/);
    expect(redis).not.toMatch(/volumes:/);
  });

  it('rotates container logs for every service', () => {
    for (const [name, block] of services) {
      expect({ service: name, logging: /^ {4}logging: \*logging$/m.test(block) }).toEqual({ service: name, logging: true });
    }
  });
});

describe('TLS-ready proxy (deploy/nginx + docker-compose.yml)', () => {
  const proxy = composeServices(read('docker-compose.yml')).get('proxy') ?? '';
  const nginxDir = 'deploy/nginx';
  const nginxFiles = readdirSync(path.join(root, nginxDir)).sort();
  const appProxy = withoutComments(read(`${nginxDir}/app-proxy.conf`));
  const common = withoutComments(read(`${nginxDir}/common.conf`));
  const httpServers = nginxServers(read(`${nginxDir}/http.conf`));
  const httpsServers = nginxServers(read(`${nginxDir}/https.conf.template`));
  const entrypoint = withoutComments(read(`${nginxDir}/entrypoint.sh`));
  const readiness = withoutComments(read(`${nginxDir}/readiness.sh`));
  const byListen = (servers: string[], listen: RegExp) => {
    const found = servers.filter((s) => listen.test(s));
    expect(found).toHaveLength(1);
    return found[0];
  };

  it('ships exactly the tracked proxy files: no certificate, key or old hand-edit template', () => {
    expect(nginxFiles).toEqual(['app-proxy.conf', 'common.conf', 'entrypoint.sh', 'http.conf', 'https.conf.template', 'readiness.sh']);
  });

  it('publishes exactly public HTTP (80→8080) and HTTPS (443→8443), never the internal listener', () => {
    expect(composeList(proxy, 'ports')).toEqual(['${PUBLIC_HTTP_BIND:-80}:8080', '${PUBLIC_HTTPS_BIND:-443}:8443']);
    expect(withoutComments(proxy)).not.toMatch(/8081/);
  });

  it('mounts the tracked config and the host certificate storage read-only, and nothing else', () => {
    expect(composeList(proxy, 'volumes')).toEqual([
      './deploy/nginx:/etc/nginx/ms-shelving:ro',
      '${LETSENCRYPT_DIR:-/etc/letsencrypt}:/etc/letsencrypt:ro',
      '${ACME_WEBROOT:-/var/www/certbot}:/var/www/certbot:ro',
    ]);
  });

  it('selects the TLS mode from the env file, with no secret in the proxy environment', () => {
    expect(composeList(proxy, 'environment')).toEqual([
      'APP_URL=${APP_URL:?APP_URL is required}',
      'PROXY_TLS_ENABLED=${PROXY_TLS_ENABLED:-false}',
    ]);
    expect(proxy).toMatch(/^ {4}entrypoint: \["\/bin\/sh", "\/etc\/nginx\/ms-shelving\/entrypoint\.sh"\]$/m);
    expect(proxy).toMatch(/^ {4}command: \["nginx", "-g", "daemon off;"\]$/m);
    expect(read('.env.production.example')).toMatch(/^PROXY_TLS_ENABLED=false$/m);
  });

  it('renders http.conf or https.conf.template by mode and fails closed otherwise', () => {
    expect(entrypoint).toMatch(/^ {2}false\)\n {4}cp "\$src\/http\.conf" "\$out"$/m);
    expect(entrypoint).toMatch(/^ {2}true\)$/m);
    // Only ${TLS_DOMAIN} is substituted, so nginx's own $variables survive.
    expect(entrypoint).toMatch(/envsubst '\$\{TLS_DOMAIN\}' <"\$src\/https\.conf\.template" >"\$out"/);
    expect(entrypoint).toMatch(/^ {2}\*\)\n {4}fail "PROXY_TLS_ENABLED must be exactly true or false"$/m);
    // The domain comes from APP_URL and must be a bare https host; the certificate must exist.
    expect(entrypoint).toMatch(/domain="\$\{domain#https:\/\/\}"/);
    expect(entrypoint).toMatch(/\[ -r "\/etc\/letsencrypt\/live\/\$domain\/\$file" \]/);
    expect(entrypoint).toMatch(/^exec \/docker-entrypoint\.sh "\$@"$/m);
    expect(entrypoint).toMatch(/^set -eu$/m);
  });

  it('contains no hardcoded production domain — the domain is configuration', () => {
    for (const file of nginxFiles) {
      const code = withoutComments(read(`${nginxDir}/${file}`));
      expect({ file, domain: /\b[a-z0-9-]+\.(kz|com|ru|net|org)\b/i.test(code) }).toEqual({ file, domain: false });
    }
  });

  it('after TLS activation, public HTTP redirects to the canonical HTTPS origin except ACME challenges', () => {
    const http = byListen(httpsServers, /listen 8080 default_server;/);
    expect(http).toMatch(/location \^~ \/\.well-known\/acme-challenge\/ \{\s*root \/var\/www\/certbot;/);
    expect(http).toMatch(/location \/ \{\s*return 301 https:\/\/\$\{TLS_DOMAIN\}\$request_uri;\s*\}/);
    // The redirect target is fixed: a client-supplied Host is never reflected, and nothing is proxied on plain HTTP.
    expect(http).not.toMatch(/https:\/\/\$host|https:\/\/\$http_host/);
    expect(http).not.toMatch(/app-proxy\.conf|proxy_pass/);
  });

  it('after TLS activation, HTTPS serves the app with the Let\'s Encrypt certificate for the APP_URL host', () => {
    const https = byListen(httpsServers, /listen 8443 ssl default_server;/);
    expect(https).toMatch(/ssl_certificate {5}\/etc\/letsencrypt\/live\/\$\{TLS_DOMAIN\}\/fullchain\.pem;/);
    expect(https).toMatch(/ssl_certificate_key \/etc\/letsencrypt\/live\/\$\{TLS_DOMAIN\}\/privkey\.pem;/);
    expect(https).toMatch(/ssl_protocols TLSv1\.2 TLSv1\.3;/);
    expect(https).toMatch(/if \(\$host != "\$\{TLS_DOMAIN\}"\) \{\s*return 301 https:\/\/\$\{TLS_DOMAIN\}\$request_uri;/);
    expect(https).toMatch(/location \/ \{\s*include \/etc\/nginx\/ms-shelving\/app-proxy\.conf;\s*\}/);
    // HSTS stays the application's (next.config.ts); nginx must not remove or duplicate it.
    expect(withoutComments(read('next.config.ts'))).toMatch(/Strict-Transport-Security/);
    expect(https).not.toMatch(/Strict-Transport-Security|proxy_hide_header/i);
  });

  it('in HTTP bootstrap mode, serves the app and ACME challenges without redirecting', () => {
    const http = byListen(httpServers, /listen 8080 default_server;/);
    expect(http).toMatch(/location \^~ \/\.well-known\/acme-challenge\/ \{\s*root \/var\/www\/certbot;/);
    expect(http).toMatch(/location \/ \{\s*include \/etc\/nginx\/ms-shelving\/app-proxy\.conf;\s*\}/);
    expect(http).not.toMatch(/return 301|ssl/);
  });

  it('keeps an internal /api/health listener on container loopback in both modes, never redirected', () => {
    for (const file of ['http.conf', 'https.conf.template']) {
      expect(withoutComments(read(`${nginxDir}/${file}`))).toMatch(/^include \/etc\/nginx\/ms-shelving\/common\.conf;$/m);
    }
    const internal = byListen(nginxServers(read(`${nginxDir}/common.conf`)), /listen 127\.0\.0\.1:8081;/);
    expect(internal).toMatch(/location = \/api\/health \{\s*include \/etc\/nginx\/ms-shelving\/app-proxy\.conf;\s*\}/);
    expect(internal).toMatch(/location \/ \{\s*return 404;\s*\}/);
    expect(internal).not.toMatch(/return 30[12]|ssl/);
    expect(common).not.toMatch(/listen (?!127\.0\.0\.1:)/);
    expect(readiness).toMatch(/wget -q -O \/dev\/null -T 5 http:\/\/127\.0\.0\.1:8081\/api\/health/);
    // With TLS on, readiness also verifies the TLS listener and certificate, without DNS.
    expect(readiness).toMatch(/--resolve "\$domain:8443:127\.0\.0\.1" "https:\/\/\$domain:8443\/api\/health"/);
    expect(readiness).not.toMatch(/--insecure|\s-k\s/);
  });

  it('preserves the proxy header contract identically on every path to the app', () => {
    // proxy_pass lives only in app-proxy.conf; every other file reaches the app through it.
    for (const file of nginxFiles.filter((f) => f !== 'app-proxy.conf')) {
      expect({ file, proxyPass: /proxy_pass/.test(withoutComments(read(`${nginxDir}/${file}`))) }).toEqual({ file, proxyPass: false });
    }
    expect(appProxy).toMatch(/^proxy_pass http:\/\/ms_shelving_app;$/m);
    expect(appProxy).toMatch(/^proxy_set_header X-Real-IP \$remote_addr;$/m);
    expect(appProxy).toMatch(/^proxy_set_header X-Forwarded-For \$remote_addr;$/m);
    expect(appProxy).toMatch(/^proxy_set_header X-Forwarded-Proto \$scheme;$/m);
    for (const stripped of ['Forwarded', 'X-Forwarded-Port', 'X-Client-IP', 'True-Client-IP', 'CF-Connecting-IP']) {
      expect(appProxy).toMatch(new RegExp(`^proxy_set_header ${stripped} "";$`, 'm'));
    }
    // Nothing trusts a client-supplied forwarding header.
    for (const file of nginxFiles) {
      const code = withoutComments(read(`${nginxDir}/${file}`));
      expect({ file, trusts: /real_ip_header|set_real_ip_from|\$proxy_add_x_forwarded_for|\$http_x_/.test(code) }).toEqual({
        file,
        trusts: false,
      });
    }
  });

  it('keeps certificates and private keys out of git and images', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    const secrets = tracked.filter((f) => /\.(pem|key|crt|p12|pfx)$|(^|\/)(letsencrypt|privkey|fullchain)/i.test(f));
    expect(secrets).toEqual([]);
    for (const file of ['.gitignore', '.dockerignore']) {
      const lines = read(file).split('\n').map((l) => l.trim());
      expect(lines.some((l) => /^(\*\*\/)?\*\.pem$/.test(l))).toBe(true);
      expect(lines.some((l) => /^(\*\*\/)?\*\.key$/.test(l))).toBe(true);
    }
    // LF endings for everything the Linux host executes or parses.
    const attributes = read('.gitattributes');
    expect(attributes).toMatch(/^\*\.sh\s+text eol=lf$/m);
    expect(attributes).toMatch(/^deploy\/\*\*\s+text eol=lf$/m);
  });

  it('deploy.sh tests the proxy config before changing anything and verifies internal readiness at the end', () => {
    const deploy = withoutComments(read('scripts/ops/deploy.sh'));
    const at = (pattern: RegExp) => deploy.search(pattern);
    expect(at(/^proxy_preflight \|\| die/m)).toBeGreaterThan(-1);
    expect(at(/^proxy_preflight \|\| die/m)).toBeLessThan(at(/backup-postgres\.sh/));
    expect(at(/^proxy_preflight \|\| die/m)).toBeLessThan(at(/compose build/));
    expect(deploy).toMatch(/compose up -d --no-deps --force-recreate proxy \|\| die/);
    expect(at(/^if ! proxy_ready; then$/m)).toBeGreaterThan(at(/--force-recreate proxy/));
    expect(at(/^if ! proxy_ready; then\n.*\n {2}die /m)).toBeGreaterThan(-1);
    const common = withoutComments(read('scripts/ops/common.sh'));
    expect(common).toMatch(/compose run --rm --no-deps -T -e NGINX_ENTRYPOINT_QUIET_LOGS=1 proxy nginx -t/);
    expect(common).toMatch(/compose ps --status running --services 2>\/dev\/null \| grep -qx proxy/);
    expect(common).toMatch(/compose exec -T proxy sh \/etc\/nginx\/ms-shelving\/readiness\.sh/);
    // The old check hit the public listener, which redirects once TLS is on.
    for (const name of ['deploy.sh', 'common.sh', 'proxy.sh', 'rollback-app.sh']) {
      expect({ name, publicListener: /127\.0\.0\.1:8080/.test(read(`scripts/ops/${name}`)) }).toEqual({ name, publicListener: false });
    }
  });

  it('proxy.sh reload (certbot deploy hook) tests nginx before a graceful reload', () => {
    const ops = withoutComments(read('scripts/ops/proxy.sh'));
    const reload = ops.slice(ops.indexOf('  reload)'));
    expect(reload.indexOf('nginx -t')).toBeGreaterThan(-1);
    expect(reload.indexOf('nginx -t')).toBeLessThan(reload.indexOf('nginx -s reload'));
    expect(reload).toMatch(/compose exec -T proxy nginx -t \\\n\s+\|\| die/);
    expect(reload).not.toMatch(/restart|down|--force-recreate/);
    const apply = ops.slice(ops.indexOf('  apply)'), ops.indexOf('  reload)'));
    expect(apply.indexOf('proxy_preflight')).toBeLessThan(apply.indexOf('--force-recreate proxy'));
  });

  it('smoke-test.sh validates the public HTTPS origin and never defaults production to internal HTTP', () => {
    const smoke = withoutComments(read('scripts/ops/smoke-test.sh'));
    expect(smoke).toMatch(/if \[ "\$tls" = "true" \]; then\n\s+BASE_URL="\$\(setting APP_URL ''\)"/);
    expect(smoke).toMatch(/http:\/\/\*\)\n\s+\[ "\$tls" != "true" \] \\\n\s+\|\| die "BASE_URL is http:\/\/ but PROXY_TLS_ENABLED=true/);
    expect(smoke).toMatch(/"301 https:\/\/"\*"\/catalog\?smoke=1"\) pass "public HTTP redirects to HTTPS/);
    expect(smoke).toMatch(/\/\.well-known\/acme-challenge\/smoke-probe/);
    expect(smoke).toMatch(/strict-transport-security/i);
    expect(smoke).toMatch(/8080\/tcp\|8443\/tcp\) ;;/);
  });

  it('runbook activates TLS through the env file and scripts, not by editing tracked files', () => {
    const runbook = read('docs/production-deployment.md');
    expect(runbook).not.toMatch(/tls\.conf\.example|deploy\/nginx\/default\.conf/);
    expect(runbook).toMatch(/PROXY_TLS_ENABLED=true/);
    expect(runbook).toMatch(/bash scripts\/ops\/proxy\.sh apply/);
    expect(runbook).toMatch(/--deploy-hook "bash \/opt\/ms-shelving\/scripts\/ops\/proxy\.sh reload"/);
    expect(runbook).toMatch(/certbot certonly --webroot -w \/var\/www\/certbot/);
  });
});

describe('docker-compose.dev.yml (local development)', () => {
  it('binds every published port to loopback only', () => {
    const ports = [...read('docker-compose.dev.yml').matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]);
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port).toMatch(/^127\.0\.0\.1:/);
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');

  it('has a migrator target that only runs prisma migrate deploy', () => {
    expect(dockerfile).toMatch(/^FROM base AS migrator$/m);
    expect(dockerfile).toMatch(/CMD \["\.\/node_modules\/\.bin\/prisma", "migrate", "deploy"\]/);
  });

  it('keeps the web runtime as the default (last) stage, running as a non-root user', () => {
    const stages = [...dockerfile.matchAll(/^FROM .+ AS (\w+)$/gm)].map((m) => m[1]);
    expect(stages.at(-1)).toBe('runner');
    expect(dockerfile.slice(dockerfile.indexOf('AS runner'))).toMatch(/^USER nextjs$/m);
  });

  it('never bakes a secret into an image layer', () => {
    expect(dockerfile).not.toMatch(/^(ARG|ENV)\s+\S*(SECRET|PASSWORD|TOKEN|DATABASE_URL|REDIS_URL)/m);
  });
});

describe('secret files stay out of images and git', () => {
  it('.dockerignore excludes every env file', () => {
    const lines = read('.dockerignore').split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
  });

  it('.gitignore ignores real env files but keeps the templates', () => {
    const lines = read('.gitignore').split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
    expect(lines).toContain('!.env.example');
    expect(lines).toContain('!.env.production.example');
    expect(lines).toContain('backups/');
  });

  it('.env.production.example contains no usable secret and no empty assignment', () => {
    const example = read('.env.production.example');
    const assignments = [...example.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)];
    expect(assignments.length).toBeGreaterThan(0);
    for (const [, name, value] of assignments) {
      expect({ name, empty: value.trim() === '' || value.trim() === '""' }).toEqual({ name, empty: false });
    }
    for (const name of ['AUTH_SECRET', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD']) {
      expect(example).toMatch(new RegExp(`^${name}="CHANGE_ME"$`, 'm'));
    }
    expect(example).not.toMatch(/^ADMIN_INITIAL_PASSWORD=/m);
  });
});

describe('operations scripts', () => {
  const scripts = ['common.sh', 'deploy.sh', 'backup-postgres.sh', 'restore-postgres.sh', 'rollback-app.sh', 'smoke-test.sh', 'proxy.sh']
    .map((name) => [name, read(`scripts/ops/${name}`)] as const)
    .concat(['entrypoint.sh', 'readiness.sh'].map((name) => [name, read(`deploy/nginx/${name}`)] as const));

  it('never use destructive schema commands or shell tracing', () => {
    for (const [name, text] of scripts) {
      const code = withoutComments(text);
      expect({ name, dbPush: /db push/.test(code) }).toEqual({ name, dbPush: false });
      expect({ name, reset: /migrate reset/.test(code) }).toEqual({ name, reset: false });
      expect({ name, dropDatabase: /DROP DATABASE|dropdb/.test(code.replace(/die "[^"]*"/g, '')) }).toEqual({ name, dropDatabase: false });
      expect({ name, trace: /set -[a-z]*x/.test(code) }).toEqual({ name, trace: false });
    }
  });

  it('prune backups only by the exact backup file pattern inside BACKUP_DIR', () => {
    const backup = read('scripts/ops/backup-postgres.sh');
    const removals = backup.split('\n').filter((line) => /\brm\b/.test(line) && !line.trim().startsWith('#'));
    for (const line of removals) expect(line).toMatch(/rm -f -- ("\$partial"|"\$\{BACKUP_DIR:\?\}\/\$file")/);
    expect(backup).toMatch(/-name 'ms_shelving_\[0-9\]\*T\[0-9\]\*Z\.dump'/);
  });
});
