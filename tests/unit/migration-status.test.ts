import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateSchemaStatus, listExpectedMigrations } from '@/lib/db/migration-status';

const row = (name: string, finished = true, rolledBack = false) => ({
  migration_name: name,
  finished_at: finished ? new Date() : null,
  rolled_back_at: rolledBack ? new Date() : null,
});

describe('evaluateSchemaStatus', () => {
  const expected = ['20260101000000_a', '20260201000000_b'];

  it('is ok when every bundled migration is applied', () => {
    expect(evaluateSchemaStatus(expected, [row(expected[0]), row(expected[1])])).toBe('ok');
  });

  it('is ok when the database also has newer migrations (app-only rollback)', () => {
    expect(evaluateSchemaStatus(expected, [row(expected[0]), row(expected[1]), row('20270101000000_newer')])).toBe('ok');
  });

  it('is pending when a bundled migration is missing', () => {
    expect(evaluateSchemaStatus(expected, [row(expected[0])])).toBe('pending');
  });

  it('is pending when a bundled migration was rolled back (marked via migrate resolve)', () => {
    expect(evaluateSchemaStatus(expected, [row(expected[0]), row(expected[1], true, true)])).toBe('pending');
  });

  it('is failed while any migration is started but unfinished', () => {
    expect(evaluateSchemaStatus(expected, [row(expected[0]), row(expected[1], false)])).toBe('failed');
  });
});

describe('listExpectedMigrations', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ms-migrations-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists only directories that contain migration.sql, sorted', async () => {
    for (const name of ['20260201000000_b', '20260101000000_a', 'not_a_migration']) mkdirSync(path.join(dir, name));
    writeFileSync(path.join(dir, '20260201000000_b', 'migration.sql'), '');
    writeFileSync(path.join(dir, '20260101000000_a', 'migration.sql'), '');
    writeFileSync(path.join(dir, 'migration_lock.toml'), '');
    await expect(listExpectedMigrations(dir)).resolves.toEqual(['20260101000000_a', '20260201000000_b']);
  });

  it('finds the real migration history of this repository', async () => {
    const names = await listExpectedMigrations();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('20260827000000_init');
  });
});
