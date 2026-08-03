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
  | 'INTERNAL_ERROR';

export function apiError(code: ApiErrorCode, message: string, status: number, details?: string[]) {
  return NextResponse.json({ ok: false, code, message, details }, { status });
}

export function apiOk<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function internalError(error: unknown) {
  if (process.env.NODE_ENV !== 'production') {
     
    console.error(error);
  }
  return apiError('INTERNAL_ERROR', 'Внутренняя ошибка сервера. Попробуйте позже.', 500);
}
