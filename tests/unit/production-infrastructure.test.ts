import { readFileSync } from 'node:fs';
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

describe('docker-compose.yml (production)', () => {
  const compose = read('docker-compose.yml');
  const services = composeServices(compose);

  it('defines the expected services', () => {
    expect([...services.keys()].sort()).toEqual(['app', 'migrate', 'postgres', 'proxy', 'redis']);
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
    const nginx = withoutComments(read('deploy/nginx/default.conf'));
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
  const scripts = ['common.sh', 'deploy.sh', 'backup-postgres.sh', 'restore-postgres.sh', 'rollback-app.sh', 'smoke-test.sh'].map(
    (name) => [name, read(`scripts/ops/${name}`)] as const,
  );

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
