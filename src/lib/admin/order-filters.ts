/**
 * Pure helpers behind the /admin/orders list query.
 *
 * They are deliberately free of Prisma and of `new Date()`-at-import so the
 * search-term and date-window rules can be unit-tested directly, and so the
 * same rules are used by the server page, the list service and the tests
 * instead of being re-derived in each.
 */

import { ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';
import type { OrderStatus } from '@/lib/types/domain';

export const ORDER_DATE_RANGE_VALUES = ['ALL', 'TODAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'CUSTOM'] as const;
export type OrderDateRange = (typeof ORDER_DATE_RANGE_VALUES)[number];

export const ORDER_DATE_RANGE_LABEL_RU: Record<OrderDateRange, string> = {
  ALL: 'За всё время',
  TODAY: 'Сегодня',
  LAST_7_DAYS: 'Последние 7 дней',
  LAST_30_DAYS: 'Последние 30 дней',
  CUSTOM: 'Свой период',
};

/** Sentinel used by the manager filter and by the assignment API for
 * "nobody is responsible for this order". A real cuid can never collide
 * with it, and it keeps the filter a single string-valued <select>. */
export const UNASSIGNED_MANAGER_VALUE = 'UNASSIGNED';

export const CUSTOMER_TYPE_FILTER_VALUES = ['ALL', 'INDIVIDUAL', 'LEGAL_ENTITY'] as const;
export type CustomerTypeFilter = (typeof CUSTOMER_TYPE_FILTER_VALUES)[number];

/**
 * Escapes a user's search term so `%`, `_` and `\` are matched literally.
 *
 * Prisma's `contains` parameterizes the value (so this is not an injection
 * guard — that is already handled), but it passes the string straight into
 * LIKE: without escaping, a term containing `%` would silently match rows the
 * manager never asked for. PostgreSQL's LIKE treats backslash as the escape
 * character by default (no ESCAPE clause needed), which is exactly what
 * Prisma emits. Mirrors likePattern() in src/lib/admin/prices.ts, which does
 * the same for the raw-SQL price search.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, (char) => `\\${char}`);
}

/**
 * The digits to look for when a manager types a phone number.
 *
 * Phones are persisted normalized as `+7XXXXXXXXXX` (see normalizePhoneDigits
 * in src/lib/pricing/schema.ts), but a manager reading a number off a screen
 * may type any of `+7 707 123 45 67`, `87071234567` or just `7071234567`.
 * Stripping every non-digit and then dropping a leading country/trunk prefix
 * leaves the subscriber digits, which are a substring of the stored value in
 * all three cases — so one `contains` covers them all.
 *
 * Returns null when the term has too few digits to be a useful phone probe;
 * two or three stray digits inside a name would otherwise match nearly every
 * customer.
 */
const MIN_PHONE_SEARCH_DIGITS = 4;

export function phoneSearchDigits(term: string): string | null {
  const digits = term.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_SEARCH_DIGITS) return null;
  // "+7…"/"8…" are the same national prefix in front of a 10-digit
  // subscriber number, so a full national number is exactly 11 digits. Only
  // that shape has a prefix to drop: a bare 10-digit number IS the subscriber
  // number, and stripping its first digit (707… → 07…) would search for the
  // wrong thing.
  return /^[78]\d{10}$/.test(digits) ? digits.slice(1) : digits;
}

export interface DateWindow {
  from?: Date;
  to?: Date;
}

/**
 * Resolves a date filter to an absolute `createdAt` window.
 *
 * `now` is injected rather than read from the clock so the windows are
 * testable and so one request cannot straddle two "todays". TODAY means the
 * calendar day in the server's timezone (the business runs in one country);
 * the rolling windows are N×24h back from now, which is what "последние 7
 * дней" means to a manager looking at a queue.
 *
 * A CUSTOM range accepts `YYYY-MM-DD` bounds from <input type="date"> and is
 * inclusive at both ends; an unparseable or absent bound is simply left open
 * rather than rejecting the whole request.
 */
export function resolveDateWindow(
  range: OrderDateRange,
  now: Date,
  custom?: { from?: string; to?: string },
): DateWindow {
  switch (range) {
    case 'TODAY': {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      return { from };
    }
    case 'LAST_7_DAYS':
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    case 'LAST_30_DAYS':
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    case 'CUSTOM': {
      const window: DateWindow = {};
      const from = parseDateOnly(custom?.from);
      if (from) {
        from.setHours(0, 0, 0, 0);
        window.from = from;
      }
      const to = parseDateOnly(custom?.to);
      if (to) {
        to.setHours(23, 59, 59, 999);
        window.to = to;
      }
      return window;
    }
    case 'ALL':
    default:
      return {};
  }
}

function parseDateOnly(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Start of the server's current calendar day — used by the "Сегодня" counter
 * and the TODAY filter alike, so the badge and the filtered list always agree. */
export function startOfToday(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/* -------------------------------------------------------------------------- */
/* The /admin/orders list query                                                */
/* -------------------------------------------------------------------------- */

/**
 * The complete, normalized state of the orders list screen.
 *
 * The list is a server-rendered page driven by a plain GET form, so this
 * object *is* the URL: parseOrderListQuery() reads it out of searchParams and
 * orderListHref() writes it back. Keeping both directions here is what makes
 * "preserve the query parameters when paging/filtering" a property of one
 * tested function instead of a rule each link has to remember.
 */
export interface OrderListQuery {
  /** Free-text term: order number, name, phone, email, company, BIN/IIN. */
  q: string;
  status: OrderStatus | 'ALL';
  range: OrderDateRange;
  /** `YYYY-MM-DD`, only meaningful when range === 'CUSTOM'. */
  from: string;
  to: string;
  /** '' = любой, UNASSIGNED_MANAGER_VALUE = без менеджера, otherwise a user id. */
  manager: string;
  customerType: CustomerTypeFilter;
  page: number;
}

export const DEFAULT_ORDER_LIST_QUERY: OrderListQuery = {
  q: '',
  status: 'ALL',
  range: 'ALL',
  from: '',
  to: '',
  manager: '',
  customerType: 'ALL',
  page: 1,
};

/** Upper bound on the free-text term — a megabyte-long `q` must never reach
 * the database, and no real search needs more than this. */
const MAX_SEARCH_LENGTH = 120;

/** Accepts only what a user id can look like, so a hand-edited URL cannot
 * turn the manager filter into an arbitrary string comparison. */
const MANAGER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type RawOrderListSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseOrderListQuery(raw: RawOrderListSearchParams): OrderListQuery {
  const status = firstValue(raw.status);
  const range = firstValue(raw.range);
  const customerType = firstValue(raw.customerType);
  const manager = firstValue(raw.manager).trim();
  const page = Number.parseInt(firstValue(raw.page), 10);

  return {
    q: firstValue(raw.q).trim().slice(0, MAX_SEARCH_LENGTH),
    status: (ORDER_STATUS_VALUES as readonly string[]).includes(status) ? (status as OrderStatus) : 'ALL',
    range: (ORDER_DATE_RANGE_VALUES as readonly string[]).includes(range) ? (range as OrderDateRange) : 'ALL',
    from: /^\d{4}-\d{2}-\d{2}$/.test(firstValue(raw.from)) ? firstValue(raw.from) : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(firstValue(raw.to)) ? firstValue(raw.to) : '',
    manager:
      manager === UNASSIGNED_MANAGER_VALUE || MANAGER_ID_PATTERN.test(manager) ? manager : '',
    customerType: (CUSTOMER_TYPE_FILTER_VALUES as readonly string[]).includes(customerType)
      ? (customerType as CustomerTypeFilter)
      : 'ALL',
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
  };
}

/**
 * `/admin/orders?…` for the given query, with `overrides` applied on top.
 *
 * Only non-default values are serialized, so the "clean" list stays at a bare
 * `/admin/orders`, and a page-2 link carries every active filter with it.
 * CUSTOM bounds are dropped unless the range actually uses them.
 */
export function orderListHref(query: OrderListQuery, overrides: Partial<OrderListQuery> = {}): string {
  const merged: OrderListQuery = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.status !== 'ALL') params.set('status', merged.status);
  if (merged.range !== 'ALL') params.set('range', merged.range);
  if (merged.range === 'CUSTOM' && merged.from) params.set('from', merged.from);
  if (merged.range === 'CUSTOM' && merged.to) params.set('to', merged.to);
  if (merged.manager) params.set('manager', merged.manager);
  if (merged.customerType !== 'ALL') params.set('customerType', merged.customerType);
  if (merged.page > 1) params.set('page', String(merged.page));
  const qs = params.toString();
  return qs ? `/admin/orders?${qs}` : '/admin/orders';
}

/** True when nothing is filtered — used to decide whether to offer "Сбросить". */
export function isDefaultOrderListQuery(query: OrderListQuery): boolean {
  return (
    query.q === '' &&
    query.status === 'ALL' &&
    query.range === 'ALL' &&
    query.manager === '' &&
    query.customerType === 'ALL'
  );
}
