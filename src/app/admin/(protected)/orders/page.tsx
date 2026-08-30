import Link from 'next/link';
import { listOrders } from '@/lib/admin/orders';
import { ORDER_STATUS_LABEL_RU, ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import { formatPrice } from '@/lib/money';
import { Badge } from '@/components/ui/Badge';
import type { OrderStatus } from '@/lib/types/domain';

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUS_VALUES as readonly string[]).includes(value);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = params.status && isOrderStatus(params.status) ? params.status : undefined;
  const page = params.page ? Math.max(1, Number(params.page) || 1) : 1;

  const { orders, total, totalPages } = await listOrders({ status, page });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Заказы</h1>
        <p className="text-sm text-steel">Всего: {total}</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="tech-label">Статус</span>
          <select name="status" defaultValue={status ?? ''} className="input">
            <option value="">Все статусы</option>
            {ORDER_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABEL_RU[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="tech-label border border-line px-3 py-2 hover:border-foreground">
          Применить
        </button>
      </form>

      <div className="overflow-x-auto border border-line bg-background">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-muted text-left">
              <th className="px-3 py-2 font-normal tech-label">№ заказа</th>
              <th className="px-3 py-2 font-normal tech-label">Дата</th>
              <th className="px-3 py-2 font-normal tech-label">Клиент</th>
              <th className="px-3 py-2 font-normal tech-label">Телефон</th>
              <th className="px-3 py-2 font-normal tech-label">Город</th>
              <th className="px-3 py-2 font-normal tech-label">Оплата</th>
              <th className="px-3 py-2 font-normal tech-label">Сумма</th>
              <th className="px-3 py-2 font-normal tech-label">Статус</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-line last:border-0 hover:bg-surface-muted">
                <td className="px-3 py-2">
                  <Link href={`/admin/orders/${order.id}`} className="mono font-semibold hover:text-blueprint">
                    {order.orderNumber}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(order.createdAt)}</td>
                <td className="px-3 py-2">{order.customerName}</td>
                <td className="px-3 py-2 mono">{order.customerPhone}</td>
                <td className="px-3 py-2">{order.customerCity}</td>
                <td className="px-3 py-2">{PAYMENT_METHOD_LABEL[order.paymentPreference] ?? order.paymentPreference}</td>
                <td className="px-3 py-2 mono">{formatPrice(order.grandTotal)}</td>
                <td className="px-3 py-2">
                  <Badge tone={order.status === 'CANCELLED' ? 'danger' : order.status === 'PAID' || order.status === 'COMPLETED' ? 'success' : 'neutral'}>
                    {ORDER_STATUS_LABEL_RU[order.status]}
                  </Badge>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-steel">
                  Заказов не найдено.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 && (
            <Link
              href={`/admin/orders?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page - 1) })}`}
              className="tech-label border border-line px-3 py-2 hover:border-foreground"
            >
              ← Назад
            </Link>
          )}
          <span className="tech-label text-steel">
            Стр. {page} из {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/orders?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page + 1) })}`}
              className="tech-label border border-line px-3 py-2 hover:border-foreground"
            >
              Вперёд →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
