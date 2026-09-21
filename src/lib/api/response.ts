import { NextResponse } from 'next/server';
import type { ZodIssue } from 'zod';

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

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: string[],
  fieldErrors?: PublicFieldError[],
) {
  return NextResponse.json({ ok: false, code, message, details, ...(fieldErrors ? { fieldErrors } : {}) }, { status });
}

/**
 * One failed form field, as a public API reports it. `field` is the
 * machine-readable top-level field name (for the browser to bind to);
 * `message` is the customer-facing text and never contains a field name,
 * schema path or property name — UI renders `message` only.
 */
export interface PublicFieldError {
  field: string;
  message: string;
}

/**
 * Zod issues → PublicFieldError[]. A nested issue (e.g. items.0.configuration
 * .height) is reported on its top-level field; `nestedMessages` replaces its
 * message with customer wording for fields the customer does not type
 * directly (the cart's configurations). Duplicates are collapsed.
 */
export function toPublicFieldErrors(issues: ZodIssue[], nestedMessages: Record<string, string> = {}): PublicFieldError[] {
  const seen = new Set<string>();
  const result: PublicFieldError[] = [];
  for (const issue of issues) {
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : 'form';
    const message = issue.path.length > 1 && nestedMessages[field] ? nestedMessages[field] : issue.message;
    const key = JSON.stringify([field, message]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ field, message });
  }
  return result;
}

/** 400 VALIDATION_ERROR: `details` carries the messages alone, `fieldErrors` the field ↔ message pairs. */
export function validationError(message: string, fieldErrors: PublicFieldError[]) {
  const details = [...new Set(fieldErrors.map((e) => e.message))];
  return apiError('VALIDATION_ERROR', message, 400, details, fieldErrors);
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
