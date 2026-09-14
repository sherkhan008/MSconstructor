import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeErrorForLog, internalError } from '@/lib/api/response';

/**
 * Production API error logging (src/lib/api/response.ts): an unexpected
 * failure must be visible in the logs, but only as class + code — never the
 * message, which can quote connection strings or customer data.
 */

describe('describeErrorForLog', () => {
  it('keeps the error class and a Prisma request error code', () => {
    const error = Object.assign(new Error('Unique constraint failed on phone +77001234567'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    expect(describeErrorForLog(error)).toBe('PrismaClientKnownRequestError code=P2002');
  });

  it('keeps a Prisma initialization errorCode', () => {
    const error = Object.assign(new Error("Can't reach database server at postgres:5432"), {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
    });
    expect(describeErrorForLog(error)).toBe('PrismaClientInitializationError code=P1001');
  });

  it('never includes the message, a connection string or an unsafe code', () => {
    const error = Object.assign(new Error('connect failed postgresql://u:secret-pass@db:5432/x'), {
      code: 'postgresql://u:secret-pass@db',
    });
    const line = describeErrorForLog(error);
    expect(line).toBe('Error');
    expect(line).not.toContain('secret-pass');
  });

  it('handles non-Error throws', () => {
    expect(describeErrorForLog('postgresql://u:secret@db')).toBe('non-Error value thrown');
  });
});

describe('internalError in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs one sanitized line and returns the generic 500 envelope', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = internalError(
      Object.assign(new Error('Invalid value for customer "Иван Иванов" +77001234567'), { name: 'PrismaClientValidationError' }),
    );
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toBe('[api] internal error: PrismaClientValidationError');
    expect(line).not.toContain('77001234567');
    const json = await response.json();
    expect(json).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });
});
