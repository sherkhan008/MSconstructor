import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_LIST_QUERY,
  UNASSIGNED_MANAGER_VALUE,
  escapeLikeTerm,
  isDefaultOrderListQuery,
  orderListHref,
  parseOrderListQuery,
  phoneSearchDigits,
  resolveDateWindow,
  startOfToday,
} from '@/lib/admin/order-filters';

describe('escapeLikeTerm', () => {
  it('escapes the LIKE wildcards so they match literally', () => {
    expect(escapeLikeTerm('50%')).toBe(String.raw`50\%`);
    expect(escapeLikeTerm('a_b')).toBe(String.raw`a\_b`);
  });

  it('escapes the escape character itself', () => {
    expect(escapeLikeTerm('a\\b')).toBe(String.raw`a\\b`);
  });

  it('leaves an ordinary term untouched', () => {
    expect(escapeLikeTerm('MS-20260827-00001')).toBe('MS-20260827-00001');
    expect(escapeLikeTerm('Айгуль')).toBe('Айгуль');
  });
});

describe('phoneSearchDigits', () => {
  it.each([
    ['+7 707 123 45 67', '7071234567'],
    ['87071234567', '7071234567'],
    ['7071234567', '7071234567'],
    ['+77071234567', '7071234567'],
  ])('reduces %s to the subscriber digits', (input, expected) => {
    expect(phoneSearchDigits(input)).toBe(expected);
  });

  it('accepts a partial number a manager remembers', () => {
    expect(phoneSearchDigits('1234')).toBe('1234');
  });

  it('returns null when there are too few digits to be a phone probe', () => {
    expect(phoneSearchDigits('Иван')).toBeNull();
    expect(phoneSearchDigits('12')).toBeNull();
  });
});

describe('resolveDateWindow', () => {
  const now = new Date('2026-09-12T15:30:00');

  it('opens TODAY at local midnight', () => {
    const { from, to } = resolveDateWindow('TODAY', now);
    expect(from?.getHours()).toBe(0);
    expect(from?.getDate()).toBe(12);
    expect(to).toBeUndefined();
  });

  it('rolls 7 and 30 days back from now', () => {
    expect(resolveDateWindow('LAST_7_DAYS', now).from?.getTime()).toBe(
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    expect(resolveDateWindow('LAST_30_DAYS', now).from?.getTime()).toBe(
      now.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
  });

  it('makes a CUSTOM range inclusive at both ends', () => {
    const { from, to } = resolveDateWindow('CUSTOM', now, { from: '2026-09-01', to: '2026-09-10' });
    expect(from?.getHours()).toBe(0);
    expect(to?.getHours()).toBe(23);
    expect(to?.getMinutes()).toBe(59);
    expect(to?.getDate()).toBe(10);
  });

  it('leaves an unparseable or missing bound open instead of rejecting', () => {
    expect(resolveDateWindow('CUSTOM', now, { from: 'вчера' })).toEqual({});
    expect(resolveDateWindow('CUSTOM', now, { to: '2026-09-10' }).from).toBeUndefined();
  });

  it('matches the "Сегодня" counter boundary', () => {
    expect(resolveDateWindow('TODAY', now).from?.getTime()).toBe(startOfToday(now).getTime());
  });

  it('ALL filters nothing', () => {
    expect(resolveDateWindow('ALL', now)).toEqual({});
  });
});

describe('parseOrderListQuery', () => {
  it('defaults everything when the URL is bare', () => {
    expect(parseOrderListQuery({})).toEqual(DEFAULT_ORDER_LIST_QUERY);
  });

  it('reads a full query', () => {
    expect(
      parseOrderListQuery({
        q: '  Айгуль  ',
        status: 'PAID',
        range: 'CUSTOM',
        from: '2026-09-01',
        to: '2026-09-10',
        manager: 'ckl9d1',
        customerType: 'LEGAL_ENTITY',
        page: '3',
      }),
    ).toEqual({
      q: 'Айгуль',
      status: 'PAID',
      range: 'CUSTOM',
      from: '2026-09-01',
      to: '2026-09-10',
      manager: 'ckl9d1',
      customerType: 'LEGAL_ENTITY',
      page: 3,
    });
  });

  it('keeps the UNASSIGNED sentinel as a manager value', () => {
    expect(parseOrderListQuery({ manager: UNASSIGNED_MANAGER_VALUE }).manager).toBe(
      UNASSIGNED_MANAGER_VALUE,
    );
  });

  // A hand-edited URL must never become a database predicate of its own.
  it('drops values that are not part of the vocabulary', () => {
    const query = parseOrderListQuery({
      status: 'DROP TABLE',
      range: 'FOREVER',
      customerType: 'ROBOT',
      manager: "'; delete from orders; --",
      from: '01.09.2026',
      page: '-4',
    });
    expect(query.status).toBe('ALL');
    expect(query.range).toBe('ALL');
    expect(query.customerType).toBe('ALL');
    expect(query.manager).toBe('');
    expect(query.from).toBe('');
    expect(query.page).toBe(1);
  });

  it('caps a very long search term', () => {
    expect(parseOrderListQuery({ q: 'а'.repeat(500) }).q).toHaveLength(120);
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parseOrderListQuery({ status: ['PAID', 'NEW'] }).status).toBe('PAID');
  });
});

describe('orderListHref', () => {
  it('is a bare path when nothing is filtered', () => {
    expect(orderListHref(DEFAULT_ORDER_LIST_QUERY)).toBe('/admin/orders');
  });

  // The whole point of paging links: a filtered view must survive them.
  it('carries every active filter into the next page', () => {
    const query = parseOrderListQuery({ q: 'Айгуль', status: 'NEW', manager: UNASSIGNED_MANAGER_VALUE });
    const href = orderListHref(query, { page: 2 });
    expect(href).toContain('q=%D0%90%D0%B9%D0%B3%D1%83%D0%BB%D1%8C');
    expect(href).toContain('status=NEW');
    expect(href).toContain('manager=UNASSIGNED');
    expect(href).toContain('page=2');
  });

  it('omits page=1', () => {
    expect(orderListHref(DEFAULT_ORDER_LIST_QUERY, { status: 'NEW', page: 1 })).toBe(
      '/admin/orders?status=NEW',
    );
  });

  it('serializes custom bounds only for a CUSTOM range', () => {
    const custom = orderListHref(DEFAULT_ORDER_LIST_QUERY, {
      range: 'CUSTOM',
      from: '2026-09-01',
      to: '2026-09-10',
    });
    expect(custom).toContain('from=2026-09-01');
    expect(custom).toContain('to=2026-09-10');

    const rolling = orderListHref(DEFAULT_ORDER_LIST_QUERY, {
      range: 'LAST_7_DAYS',
      from: '2026-09-01',
      to: '2026-09-10',
    });
    expect(rolling).not.toContain('from=');
  });

  it('round-trips through parseOrderListQuery', () => {
    const query = parseOrderListQuery({
      q: 'ТОО Ромашка',
      status: 'PAID',
      range: 'CUSTOM',
      from: '2026-09-01',
      to: '2026-09-10',
      manager: 'user7',
      customerType: 'LEGAL_ENTITY',
      page: '4',
    });
    const href = orderListHref(query);
    const raw = Object.fromEntries(new URL(href, 'http://x').searchParams.entries());
    expect(parseOrderListQuery(raw)).toEqual(query);
  });
});

describe('isDefaultOrderListQuery', () => {
  it('ignores the page number — page 2 of an unfiltered list is still unfiltered', () => {
    expect(isDefaultOrderListQuery({ ...DEFAULT_ORDER_LIST_QUERY, page: 2 })).toBe(true);
  });

  it('is false once anything is filtered', () => {
    expect(isDefaultOrderListQuery({ ...DEFAULT_ORDER_LIST_QUERY, status: 'NEW' })).toBe(false);
    expect(isDefaultOrderListQuery({ ...DEFAULT_ORDER_LIST_QUERY, q: 'x' })).toBe(false);
  });
});
