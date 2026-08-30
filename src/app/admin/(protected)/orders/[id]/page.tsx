import { notFound } from 'next/navigation';
import { getOrderById, type AdminOrderItem } from '@/lib/admin/orders';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canChangeOrderStatus } from '@/lib/auth/authorize';
import { ORDER_STATUS_LABEL_RU } from '@/lib/orders/status-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import { METAL_FOOT_PAD_LABEL, SHELF_CORNER_BRACKETS_LABEL } from '@/lib/configurator/additional-options';
import { whatsAppAdminOrderUrl } from '@/lib/whatsapp';
import { formatPrice } from '@/lib/money';
import { Badge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { OrderStatusForm } from '@/components/admin/OrderStatusForm';

const CUSTOMER_TYPE_LABEL_RU: Record<string, string> = {
  INDIVIDUAL: 'Физическое лицо',
  LEGAL_ENTITY: 'Юридическое лицо',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function wallsSummary(section: { rearWall: boolean; leftWall: boolean; rightWall: boolean }): string {
  const walls = [section.rearWall && 'задняя', section.leftWall && 'левая', section.rightWall && 'правая'].filter(
    (w): w is string => Boolean(w),
  );
  return walls.length > 0 ? `${walls.join(' + ')} стенка` : 'без стенок';
}

function ConfigurationSummary({ item }: { item: AdminOrderItem }) {
  const c = item.configuration;
  const anyWalls = c.sections.some((s) => s.rearWall || s.leftWall || s.rightWall);
  const options = [c.metalFootPad && METAL_FOOT_PAD_LABEL, c.shelfCornerBrackets && SHELF_CORNER_BRACKETS_LABEL].filter(
    (v): v is string => Boolean(v),
  );

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
      <div>
        <dt className="tech-label">Модель</dt>
        <dd>{c.modelSlug}</dd>
      </div>
      <div>
        <dt className="tech-label">Высота</dt>
        <dd>{c.height} мм</dd>
      </div>
      <div>
        <dt className="tech-label">Глубина</dt>
        <dd>{c.depth} мм</dd>
      </div>
      <div>
        <dt className="tech-label">Полок</dt>
        <dd>{c.shelves}</dd>
      </div>
      <div>
        <dt className="tech-label">Нагрузка</dt>
        <dd>{c.loadCapacity} кг/полку</dd>
      </div>
      <div>
        <dt className="tech-label">Количество</dt>
        <dd>{item.quantity}</dd>
      </div>
      <div className="col-span-2 sm:col-span-2">
        <dt className="tech-label">Секции ({c.sections.length})</dt>
        <dd>
          {c.sections.map((s, i) => (
            <div key={s.id}>
              {i + 1}. {s.width} мм{anyWalls ? ` — ${wallsSummary(s)}` : ''}
            </div>
          ))}
        </dd>
      </div>
      {options.length > 0 && (
        <div className="col-span-2 sm:col-span-4">
          <dt className="tech-label">Доп. параметры</dt>
          <dd>{options.join(', ')}</dd>
        </div>
      )}
    </dl>
  );
}

function BomTable({ bom }: { bom: AdminOrderItem['bom'] }) {
  if (bom.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-1 pr-3 font-normal tech-label">Компонент</th>
            <th className="py-1 pr-3 font-normal tech-label">SKU</th>
            <th className="py-1 pr-3 font-normal tech-label">Кол-во</th>
          </tr>
        </thead>
        <tbody>
          {bom.map((line, i) => (
            <tr key={`${line.componentId}-${i}`} className="border-b border-line/60 last:border-0">
              <td className="py-1 pr-3">{line.name}</td>
              <td className="py-1 pr-3 mono">{line.sku}</td>
              <td className="py-1 pr-3">{line.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, admin] = await Promise.all([getOrderById(id), getCurrentAdmin()]);
  if (!order) notFound();
  // getCurrentAdmin() cannot be null here — the (protected) layout already
  // redirected any unauthenticated visitor before this page renders.
  const canChangeStatus = admin ? canChangeOrderStatus(admin.role) : false;

  const whatsAppTarget = order.customer.whatsapp || order.customer.phone;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Заказ {order.orderNumber}</h1>
          <p className="text-sm text-steel">{formatDateTime(order.createdAt)}</p>
        </div>
        <Badge tone={order.status === 'CANCELLED' ? 'danger' : order.status === 'PAID' || order.status === 'COMPLETED' ? 'success' : 'neutral'}>
          {ORDER_STATUS_LABEL_RU[order.status]}
        </Badge>
      </div>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Клиент</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="tech-label">ФИО / контактное лицо</dt>
            <dd>{order.customer.fullName}</dd>
          </div>
          <div>
            <dt className="tech-label">Телефон</dt>
            <dd className="mono">{order.customer.phone}</dd>
          </div>
          <div>
            <dt className="tech-label">WhatsApp</dt>
            <dd className="mono">{order.customer.whatsapp || '—'}</dd>
          </div>
          <div>
            <dt className="tech-label">Email</dt>
            <dd>{order.customer.email || '—'}</dd>
          </div>
          <div>
            <dt className="tech-label">Город</dt>
            <dd>{order.customer.city || '—'}</dd>
          </div>
          <div>
            <dt className="tech-label">Тип клиента</dt>
            <dd>{CUSTOMER_TYPE_LABEL_RU[order.customer.type] ?? order.customer.type}</dd>
          </div>
          {order.customer.type === 'LEGAL_ENTITY' && (
            <>
              <div>
                <dt className="tech-label">Компания</dt>
                <dd>{order.customer.companyName || '—'}</dd>
              </div>
              <div>
                <dt className="tech-label">БИН/ИИН</dt>
                <dd className="mono">{order.customer.binIin || '—'}</dd>
              </div>
            </>
          )}
        </dl>
        <div className="mt-4">
          <LinkButton
            href={whatsAppAdminOrderUrl(whatsAppTarget, order.customer.fullName, order.orderNumber)}
            target="_blank"
            rel="noopener noreferrer"
            variant="whatsapp"
            size="sm"
          >
            Написать клиенту в WhatsApp
          </LinkButton>
        </div>
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Заказ</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="tech-label">Способ оплаты</dt>
            <dd>{PAYMENT_METHOD_LABEL[order.paymentPreference] ?? order.paymentPreference}</dd>
          </div>
          <div>
            <dt className="tech-label">Адрес доставки</dt>
            <dd>{order.deliveryAddress || '—'}</dd>
          </div>
          <div>
            <dt className="tech-label">Итого</dt>
            <dd className="mono text-lg font-semibold">{formatPrice(order.grandTotal)}</dd>
          </div>
          {order.comment && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="tech-label">Комментарий</dt>
              <dd>{order.comment}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Изменить статус</h2>
        {canChangeStatus ? (
          <OrderStatusForm orderId={order.id} currentStatus={order.status} />
        ) : (
          <p className="text-sm text-steel">Недостаточно прав для изменения статуса заказа.</p>
        )}
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Позиции заказа</h2>
        <div className="flex flex-col gap-6">
          {order.items.map((item) => (
            <div key={item.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
              <ConfigurationSummary item={item} />
              <div className="mt-2 flex gap-6 text-sm">
                <div>
                  <span className="tech-label">Цена за шт.</span> <span className="mono">{formatPrice(item.unitNetPrice)}</span>
                </div>
                <div>
                  <span className="tech-label">Сумма позиции</span> <span className="mono">{formatPrice(item.totalNetPrice)}</span>
                </div>
              </div>
              <BomTable bom={item.bom} />
            </div>
          ))}
        </div>
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">История статусов</h2>
        {order.statusHistory.length === 0 ? (
          <p className="text-sm text-steel">Нет записей.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {order.statusHistory.map((h) => (
              <li key={h.id} className="mono">
                {formatDateTime(h.createdAt)} — {ORDER_STATUS_LABEL_RU[h.status]}
                {h.changedBy ? ` (${h.changedBy})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
