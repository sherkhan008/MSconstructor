import Link from 'next/link';
import { listAssignableManagers, listOrders, type AdminOrderSummary } from '@/lib/admin/orders';
import {
  DEFAULT_ORDER_LIST_QUERY,
  UNASSIGNED_MANAGER_VALUE,
  orderListHref,
  parseOrderListQuery,
  type RawOrderListSearchParams,
} from '@/lib/admin/order-filters';
import { ORDER_STATUS_LABEL_RU } from '@/lib/orders/status-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import { CUSTOMER_TYPE_LABEL_RU } from '@/lib/orders/customer-labels';
import { formatPrice } from '@/lib/money';
import { Badge } from '@/components/ui/Badge';
import { AdminOrdersFilters } from '@/components/admin/AdminOrdersFilters';
import type { OrderStatus } from '@/lib/types/domain';

/**
 * The order queue.
 *
 * Every filter, the search, the ordering and the paging happen in PostgreSQL
 * (see buildOrderWhere in src/lib/admin/orders.ts) — the page never loads more
 * than the 20 rows it shows, and never filters an already-fetched page in JS.
 * The customer columns come from one join, so the list costs a fixed number
 * of queries no matter how many orders are on screen.
 *
 * The URL is the state: the filter form is a GET form and every paging link
 * carries the active filters, so a manager can bookmark or share "новые
 * заказы без менеджера" and land on exactly that.
 */

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTone(status: OrderStatus): 'danger' | 'success' | 'neutral' {
  if (status === 'CANCELLED') return 'danger';
  if (status === 'PAID' || status === 'DELIVERED') return 'success';
  return 'neutral';
}

/** New orders are the ones nobody has looked at yet, so they carry a light
 * accent wash — enough to find them while scanning, never so much that the
 * rest of the queue reads as disabled. */
function rowHighlight(status: OrderStatus): string {
  return status === 'NEW' ? 'bg-accent-soft' : 'hover:bg-surface-muted';
}

function managerLabel(order: AdminOrderSummary): string {
  return order.manager?.name ?? 'Не назначен';
}

function Counter({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link
      href={href}
      className="tech-label inline-flex min-h-11 items-center gap-2 border border-line bg-background px-3 hover:border-foreground"
    >
      {label}
      <span className="mono text-sm font-semibold text-foreground">{value}</span>
    </Link>
  );
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawOrderListSearchParams>;
}) {
  const query = parseOrderListQuery(await searchParams);

  const [{ orders, total, totalPages, counters }, managers] = await Promise.all([
    listOrders({
      search: query.q || undefined,
      status: query.status === 'ALL' ? undefined : query.status,
      dateRange: query.range,
      dateFrom: query.from || undefined,
      dateTo: query.to || undefined,
      managerId: query.manager || undefined,
      customerType: query.customerType,
      page: query.page,
    }),
    listAssignableManagers(),
  ]);

  const page = Math.min(query.page, totalPages);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Заказы</h1>
        <p className="text-sm text-steel">
          Найдено: <span className="mono font-semibold text-foreground">{total}</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Counter
          href={orderListHref(DEFAULT_ORDER_LIST_QUERY, { status: 'NEW' })}
          label="Новые"
          value={counters.newOrders}
        />
        <Counter
          href={orderListHref(DEFAULT_ORDER_LIST_QUERY, { manager: UNASSIGNED_MANAGER_VALUE })}
          label="Без менеджера"
          value={counters.unassigned}
        />
        <Counter
          href={orderListHref(DEFAULT_ORDER_LIST_QUERY, { range: 'TODAY' })}
          label="Сегодня"
          value={counters.today}
        />
      </div>

      <AdminOrdersFilters query={query} managers={managers} />

      {orders.length === 0 ? (
        <p className="border border-line bg-background px-3 py-8 text-center text-sm text-steel">
          Заказов не найдено.
        </p>
      ) : (
        <>
          {/* Desktop: the full queue in one table. */}
          <div className="hidden overflow-x-auto border border-line bg-background lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left">
                  <th className="px-3 py-2 font-normal tech-label">№ заказа</th>
                  <th className="px-3 py-2 font-normal tech-label">Дата</th>
                  <th className="px-3 py-2 font-normal tech-label">Клиент</th>
                  <th className="px-3 py-2 font-normal tech-label">Телефон</th>
                  <th className="px-3 py-2 font-normal tech-label">Город</th>
                  <th className="px-3 py-2 font-normal tech-label">Ответственный</th>
                  <th className="px-3 py-2 font-normal tech-label">Оплата</th>
                  <th className="px-3 py-2 font-normal tech-label">Сумма</th>
                  <th className="px-3 py-2 font-normal tech-label">Статус</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    data-testid="order-row"
                    data-order-number={order.orderNumber}
                    data-status={order.status}
                    className={`border-b border-line last:border-0 ${rowHighlight(order.status)}`}
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="mono font-semibold hover:text-blueprint"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(order.createdAt)}</td>
                    <td className="px-3 py-2">
                      {order.customerName}
                      <span className="block text-xs text-steel">
                        {CUSTOMER_TYPE_LABEL_RU[order.customerType]}
                        {order.customerCompanyName ? ` · ${order.customerCompanyName}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 mono whitespace-nowrap">{order.customerPhone}</td>
                    <td className="px-3 py-2">{order.customerCity || '—'}</td>
                    <td className="px-3 py-2" data-testid="order-manager">
                      {order.manager ? (
                        managerLabel(order)
                      ) : (
                        <span className="text-steel">{managerLabel(order)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {PAYMENT_METHOD_LABEL[order.paymentPreference] ?? order.paymentPreference}
                    </td>
                    <td className="px-3 py-2 mono whitespace-nowrap">{formatPrice(order.grandTotal)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABEL_RU[order.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tablet and phone: one card per order. A nine-column table cannot
              be made readable at 412px, and shrinking it would only produce
              horizontal page scrolling. */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {orders.map((order) => (
              <li
                key={order.id}
                data-testid="order-card"
                data-order-number={order.orderNumber}
                data-status={order.status}
                className={`border border-line p-3 ${
                  order.status === 'NEW' ? 'bg-accent-soft' : 'bg-background'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="mono font-semibold hover:text-blueprint"
                  >
                    {order.orderNumber}
                  </Link>
                  <Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABEL_RU[order.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-steel">{formatDateTime(order.createdAt)}</p>

                <p className="mt-2 text-sm">
                  {order.customerName}
                  <span className="block text-xs text-steel">
                    {CUSTOMER_TYPE_LABEL_RU[order.customerType]}
                    {order.customerCompanyName ? ` · ${order.customerCompanyName}` : ''}
                    {order.customerCity ? ` · ${order.customerCity}` : ''}
                  </span>
                </p>
                <p className="mono mt-1 text-sm break-all">{order.customerPhone}</p>

                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
                  <div>
                    <dt className="tech-label">Сумма</dt>
                    <dd className="mono font-semibold">{formatPrice(order.grandTotal)}</dd>
                  </div>
                  <div>
                    <dt className="tech-label">Оплата</dt>
                    <dd>{PAYMENT_METHOD_LABEL[order.paymentPreference] ?? order.paymentPreference}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="tech-label">Ответственный</dt>
                    <dd data-testid="order-manager" className={order.manager ? '' : 'text-steel'}>
                      {managerLabel(order)}
                    </dd>
                  </div>
                </dl>

                <Link
                  href={`/admin/orders/${order.id}`}
                  className="tech-label mt-3 inline-flex min-h-11 w-full items-center justify-center border border-line px-3 hover:border-foreground"
                >
                  Открыть заказ
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {totalPages > 1 && (
        <nav aria-label="Страницы" className="flex flex-wrap items-center justify-center gap-3">
          {page > 1 && (
            <Link
              href={orderListHref(query, { page: page - 1 })}
              className="tech-label inline-flex min-h-11 items-center border border-line px-3 hover:border-foreground"
            >
              ← Назад
            </Link>
          )}
          <span className="tech-label text-steel">
            Стр. {page} из {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={orderListHref(query, { page: page + 1 })}
              className="tech-label inline-flex min-h-11 items-center border border-line px-3 hover:border-foreground"
            >
              Вперёд →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
