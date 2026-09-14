import { NextResponse } from 'next/server';

/**
 * Consistent API response envelope (spec §48). Every route returns either
 * `{ ok: true, ...data }` or `{ ok: false, code, message, details? }` with a
 * typed error code — never a raw stack trace or driver error message.
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_MODEL'
  | 'INCOMPATIBLE_CONFIGURATION'
  | 'MISSING_COMPONENT'
  | 'INDIVIDUAL_QUOTE_REQUIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export function apiError(code: ApiErrorCode, message: string, status: number, details?: string[]) {
  return NextResponse.json({ ok: false, code, message, details }, { status });
}

export function apiOk<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/**
 * One-line, secret-free description of an unexpected error for production
 * logs: the error class and, when present, a short machine code (Prisma
 * `P1001`, Node `ECONNREFUSED`). The message is deliberately omitted — Prisma
 * and driver messages can quote query arguments (customer names, phones) or
 * connection details — so an outage stays observable without leaking data.
 */
export function describeErrorForLog(error: unknown): string {
  if (!(error instanceof Error)) return 'non-Error value thrown';
  // PrismaClientKnownRequestError uses `code`, PrismaClientInitializationError `errorCode`.
  const { code: rawCode, errorCode } = error as { code?: unknown; errorCode?: unknown };
  const code = typeof rawCode === 'string' ? rawCode : errorCode;
  const safeCode = typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? ` code=${code}` : '';
  const name = /^[A-Za-z0-9_]{1,80}$/.test(error.name) ? error.name : 'Error';
  return `${name}${safeCode}`;
}

export function internalError(error: unknown) {
  if (process.env.NODE_ENV !== 'production') {

    console.error(error);
  } else {
    console.error(`[api] internal error: ${describeErrorForLog(error)}`);
  }
  return apiError('INTERNAL_ERROR', 'Внутренняя ошибка сервера. Попробуйте позже.', 500);
}
