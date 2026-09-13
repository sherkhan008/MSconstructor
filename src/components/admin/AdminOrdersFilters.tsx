'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import {
  CUSTOMER_TYPE_FILTER_VALUES,
  ORDER_DATE_RANGE_LABEL_RU,
  ORDER_DATE_RANGE_VALUES,
  UNASSIGNED_MANAGER_VALUE,
  isDefaultOrderListQuery,
  orderListHref,
  parseOrderListQuery,
  type OrderDateRange,
  type OrderListQuery,
} from '@/lib/admin/order-filters';
import { ORDER_STATUS_LABEL_RU, ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';
import { CUSTOMER_TYPE_LABEL_RU } from '@/lib/orders/customer-labels';
import type { AssignableManager } from '@/lib/admin/orders';

/**
 * The /admin/orders filter bar.
 *
 * A plain GET form: submitting it navigates to /admin/orders?… and the server
 * page re-queries the database. That is what makes every filter shareable,
 * bookmarkable and back-button-correct for free, and it is why `page` is
 * deliberately NOT a field here — changing a filter must restart at page 1,
 * and paging links (which do carry the filters) are rendered by the page.
 *
 * The only reason this is a client component at all is the custom date range:
 * the two date inputs are pointless noise unless "Свой период" is selected.
 * Everything else works exactly the same with JavaScript disabled.
 */
export function AdminOrdersFilters({
  query,
  managers,
}: {
  query: OrderListQuery;
  managers: AssignableManager[];
}) {
  const router = useRouter();
  const [range, setRange] = useState<OrderDateRange>(query.range);

  return (
    <form
      method="get"
      action="/admin/orders"
      className="flex flex-col gap-3 border border-line bg-background p-3 sm:p-4"
      onSubmit={(event) => {
        // A browser serializes EVERY named control, so a plain submit would
        // put `range=ALL&manager=&customerType=ALL` into a link someone might
        // share. With JavaScript on, navigate to the canonical URL instead —
        // the same one the paging links are built from. Without it the plain
        // GET above still works; the URL is just noisier.
        event.preventDefault();
        const entries = [...new FormData(event.currentTarget).entries()].map(
          ([key, value]) => [key, String(value)] as const,
        );
        router.push(orderListHref(parseOrderListQuery(Object.fromEntries(entries)), { page: 1 }));
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="tech-label">Поиск</span>
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          autoComplete="off"
          className="input"
          placeholder="Номер заказа, имя, телефон, email, компания, БИН/ИИН"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="tech-label">Статус</span>
          <select name="status" defaultValue={query.status} className="input">
            <option value="ALL">Все статусы</option>
            {ORDER_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABEL_RU[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="tech-label">Период</span>
          <select
            name="range"
            value={range}
            onChange={(event) => setRange(event.target.value as OrderDateRange)}
            className="input"
          >
            {ORDER_DATE_RANGE_VALUES.map((value) => (
              <option key={value} value={value}>
                {ORDER_DATE_RANGE_LABEL_RU[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="tech-label">Ответственный</span>
          <select name="manager" defaultValue={query.manager} className="input">
            <option value="">Любой</option>
            <option value={UNASSIGNED_MANAGER_VALUE}>Без менеджера</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="tech-label">Тип клиента</span>
          <select name="customerType" defaultValue={query.customerType} className="input">
            {CUSTOMER_TYPE_FILTER_VALUES.map((value) => (
              <option key={value} value={value}>
                {value === 'ALL' ? 'Все клиенты' : CUSTOMER_TYPE_LABEL_RU[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {range === 'CUSTOM' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="tech-label">С даты</span>
            <input type="date" name="from" defaultValue={query.from} className="input" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="tech-label">По дату</span>
            <input type="date" name="to" defaultValue={query.to} className="input" />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="md" className="min-h-11">
          Применить
        </Button>
        {!isDefaultOrderListQuery(query) && (
          <Link href="/admin/orders" className="tech-label min-h-11 px-1 py-3 text-steel hover:text-foreground">
            Сбросить
          </Link>
        )}
      </div>
    </form>
  );
}
