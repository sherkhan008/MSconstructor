import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getOrderById,
  listAssignableManagers,
  type AdminOrderActivityEntry,
  type AdminOrderDelivery,
  type AdminOrderItem,
} from '@/lib/admin/orders';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import {
  canAssignOrder,
  canChangeOrderStatus,
  canClaimUnassignedOrder,
  canEditInternalNotes,
  canGenerateOrderDocuments,
} from '@/lib/auth/authorize';
import { ORDER_STATUS_LABEL_RU } from '@/lib/orders/status-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import { CUSTOMER_TYPE_FULL_LABEL_RU } from '@/lib/orders/customer-labels';
import { METAL_FOOT_PAD_LABEL, SHELF_CORNER_BRACKETS_LABEL } from '@/lib/configurator/additional-options';
import { findDelivery, getCatalog } from '@/lib/data/repository';
import { whatsAppAdminOrderUrl } from '@/lib/whatsapp';
import { formatPrice } from '@/lib/money';
import { Badge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { OrderStatusForm } from '@/components/admin/OrderStatusForm';
import { OrderManagerForm, type OrderManagerMode } from '@/components/admin/OrderManagerForm';
import { OrderInternalNotes } from '@/components/admin/OrderInternalNotes';
import { OrderDocuments, type OrderDocumentEntry } from '@/components/admin/OrderDocuments';
import { ORDER_DOCUMENT_KINDS, ORDER_DOCUMENT_TITLE_RU, orderDocumentNumber } from '@/lib/documents/kinds';
import { describeSellerIssue, readSellerConfig, sellerConfigIssues } from '@/lib/documents/seller';

/**
 * One order, as it was saved.
 *
 * Everything financial on this page — netTotal, vatTotal, discountTotal,
 * grandTotal, every line price and the BOM — is read verbatim from the
 * persisted snapshot. A historical order is NEVER repriced against today's
 * catalog: the numbers here are the numbers the customer was quoted.
 *
 * This is an internal screen, so it deliberately shows what the customer's
 * own views never do: the full internal BOM (production parts included), the
 * responsible manager, internal notes and the assignment/notes trail.
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

function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function wallsSummary(section: { rearWall: boolean; leftWall: boolean; rightWall: boolean }): string {
  const walls = [section.rearWall && 'задняя', section.leftWall && 'левая', section.rightWall && 'правая'].filter(
    (w): w is string => Boolean(w),
  );
  return walls.length > 0 ? `${walls.join(' + ')} стенка` : 'без стенок';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="tech-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ConfigurationSummary({ item }: { item: AdminOrderItem }) {
  const c = item.configuration;
  const anyWalls = c.sections.some((s) => s.rearWall || s.leftWall || s.rightWall);
  const options = [c.metalFootPad && METAL_FOOT_PAD_LABEL, c.shelfCornerBrackets && SHELF_CORNER_BRACKETS_LABEL].filter(
    (v): v is string => Boolean(v),
  );

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
      <Field label="Модель">{c.modelSlug}</Field>
      <Field label="Высота">{c.height} мм</Field>
      <Field label="Глубина">{c.depth} мм</Field>
      <Field label="Полок">{c.shelves}</Field>
      <Field label="Нагрузка">{c.loadCapacity} кг/полку</Field>
      <Field label="Количество">{item.quantity}</Field>
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

/** The internal bill of materials, exactly as it was saved with the order —
 * it intentionally lists production/internal parts the customer-facing kit
 * composition never shows. */
function BomTable({ bom }: { bom: AdminOrderItem['bom'] }) {
  if (bom.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
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

function DeliveryFields({ delivery, methodName }: { delivery: AdminOrderDelivery; methodName?: string }) {
  const hasAny =
    methodName ||
    delivery.address ||
    delivery.city ||
    delivery.floor ||
    delivery.hasLift !== undefined ||
    delivery.date ||
    delivery.comment;

  if (!hasAny) {
    return <p className="text-sm text-steel">Данные о доставке не сохранены.</p>;
  }

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      {methodName && <Field label="Способ доставки">{methodName}</Field>}
      {delivery.city && <Field label="Город доставки">{delivery.city}</Field>}
      {delivery.address && <Field label="Адрес доставки">{delivery.address}</Field>}
      {delivery.floor && <Field label="Этаж">{delivery.floor}</Field>}
      {delivery.hasLift !== undefined && <Field label="Лифт">{delivery.hasLift ? 'Есть' : 'Нет'}</Field>}
      {delivery.date && <Field label="Дата доставки">{formatDateOnly(delivery.date)}</Field>}
      {delivery.comment && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="tech-label">Комментарий к доставке</dt>
          <dd className="whitespace-pre-wrap">{delivery.comment}</dd>
        </div>
      )}
    </dl>
  );
}

function activityText(entry: AdminOrderActivityEntry): string {
  if (entry.action === 'ORDER_INTERNAL_NOTES_UPDATED') return 'изменил(а) внутреннюю заметку';
  if (!entry.newManagerName) {
    return entry.previousManagerName
      ? `снял(а) ответственного (был ${entry.previousManagerName})`
      : 'снял(а) ответственного';
  }
  return entry.previousManagerName
    ? `сменил(а) ответственного: ${entry.previousManagerName} → ${entry.newManagerName}`
    : `назначил(а) ответственного: ${entry.newManagerName}`;
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, admin] = await Promise.all([getOrderById(id), getCurrentAdmin()]);
  if (!order) notFound();
  // getCurrentAdmin() cannot be null here — the (protected) layout already
  // redirected any unauthenticated visitor before this page renders.
  if (!admin) notFound();

  const canChangeStatus = canChangeOrderStatus(admin.role);
  const canAssign = canAssignOrder(admin.role);
  const canEditNotes = canEditInternalNotes(admin.role);

  const managerMode: OrderManagerMode = canAssign
    ? 'assign'
    : canClaimUnassignedOrder(admin.role) && order.manager === null
      ? 'claim'
      : 'read';

  // Only the full-assignment view needs the list of people; a manager who can
  // merely claim an order never sees other accounts' names.
  const managers = managerMode === 'assign' ? await listAssignableManagers() : [];

  // Presentation only: turns the persisted delivery-method id into its
  // Russian name. Nothing about the order is recalculated.
  const deliveryMethodName = order.delivery.methodId
    ? (findDelivery(await getCatalog(), order.delivery.methodId)?.name.ru ?? order.delivery.methodId)
    : undefined;

  const whatsAppTarget = order.customer.whatsapp || order.customer.phone;

  // Readiness only — the PDFs themselves are built by the document route from
  // the persisted order. Seller details come from server-side configuration.
  const sellerConfig = readSellerConfig();
  const documents: OrderDocumentEntry[] = ORDER_DOCUMENT_KINDS.map((kind) => ({
    kind,
    title: ORDER_DOCUMENT_TITLE_RU[kind],
    number: orderDocumentNumber(kind, order.orderNumber),
    href: `/api/admin/orders/${encodeURIComponent(order.id)}/documents/${kind}`,
    blockers: sellerConfigIssues(kind, sellerConfig).map(describeSellerIssue),
    notes:
      kind === 'commercial-proposal' && !sellerConfig.details.legalName
        ? ['Юридические реквизиты продавца не заданы (SELLER_*): в предложении будет указано только название бренда.']
        : [],
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/orders" className="tech-label text-steel hover:text-foreground">
            ← Ко всем заказам
          </Link>
          <h1 className="font-display text-2xl">Заказ {order.orderNumber}</h1>
          <p className="text-sm text-steel">{formatDateTime(order.createdAt)}</p>
        </div>
        <Badge
          tone={
            order.status === 'CANCELLED'
              ? 'danger'
              : order.status === 'PAID' || order.status === 'COMPLETED'
                ? 'success'
                : 'neutral'
          }
        >
          {ORDER_STATUS_LABEL_RU[order.status]}
        </Badge>
      </div>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Клиент</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="ФИО / контактное лицо">{order.customer.fullName}</Field>
          <Field label="Телефон">
            <span className="mono break-all">{order.customer.phone}</span>
          </Field>
          <Field label="WhatsApp">
            <span className="mono break-all">{order.customer.whatsapp || '—'}</span>
          </Field>
          <Field label="Email">
            <span className="break-all">{order.customer.email || '—'}</span>
          </Field>
          <Field label="Город">{order.customer.city || '—'}</Field>
          <Field label="Тип клиента">{CUSTOMER_TYPE_FULL_LABEL_RU[order.customer.type]}</Field>
          {order.customer.type === 'LEGAL_ENTITY' && (
            <>
              <Field label="Компания">{order.customer.companyName || '—'}</Field>
              <Field label="БИН/ИИН">
                <span className="mono">{order.customer.binIin || '—'}</span>
              </Field>
            </>
          )}
        </dl>
        <div className="mt-4">
          <LinkButton
            href={whatsAppAdminOrderUrl(whatsAppTarget, order.customer.fullName, order.orderNumber)}
            target="_blank"
            rel="noopener noreferrer"
            variant="whatsapp"
            size="md"
            className="min-h-11"
          >
            Написать клиенту в WhatsApp
          </LinkButton>
        </div>
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Ответственный</h2>
        <OrderManagerForm
          orderId={order.id}
          mode={managerMode}
          actorId={admin.sub}
          currentManagerId={order.manager?.id ?? null}
          currentManagerName={order.manager?.name ?? null}
          managers={managers}
          expectedUpdatedAt={order.updatedAt}
        />
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Внутренние заметки</h2>
        <OrderInternalNotes
          orderId={order.id}
          initialNotes={order.internalNotes}
          expectedUpdatedAt={order.updatedAt}
          canEdit={canEditNotes}
        />
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Суммы заказа</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Field label="Без НДС">
            <span className="mono">{formatPrice(order.netTotal)}</span>
          </Field>
          <Field label="НДС">
            <span className="mono">{formatPrice(order.vatTotal)}</span>
          </Field>
          <Field label="Скидка">
            <span className="mono">{formatPrice(order.discountTotal)}</span>
          </Field>
          <Field label="Итого">
            <span className="mono text-lg font-semibold" data-testid="order-grand-total">
              {formatPrice(order.grandTotal)}
            </span>
          </Field>
        </dl>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <Field label="Способ оплаты">
            {PAYMENT_METHOD_LABEL[order.paymentPreference] ?? order.paymentPreference}
          </Field>
          {order.comment && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="tech-label">Комментарий клиента</dt>
              <dd className="whitespace-pre-wrap">{order.comment}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Документы</h2>
        <OrderDocuments documents={documents} canGenerate={canGenerateOrderDocuments(admin.role)} />
      </section>

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Доставка</h2>
        <DeliveryFields delivery={order.delivery} methodName={deliveryMethodName} />
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
              <div className="mt-2 flex flex-wrap gap-6 text-sm">
                <div>
                  <span className="tech-label">Цена за шт.</span>{' '}
                  <span className="mono">{formatPrice(item.unitNetPrice)}</span>
                </div>
                <div>
                  <span className="tech-label">Сумма позиции</span>{' '}
                  <span className="mono">{formatPrice(item.totalNetPrice)}</span>
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

      <section className="border border-line bg-background p-4">
        <h2 className="tech-label mb-3">Действия сотрудников</h2>
        {order.activity.length === 0 ? (
          <p className="text-sm text-steel">Нет записей.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="order-activity">
            {order.activity.map((entry) => (
              <li key={entry.id}>
                <span className="mono text-steel">{formatDateTime(entry.createdAt)}</span>{' '}
                {entry.actorName ?? 'Сотрудник'} {activityText(entry)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
