'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ORDER_STATUS_ACTION_LABEL_RU, ORDER_STATUS_LABEL_RU } from '@/lib/orders/status-labels';
import type { OrderStatus } from '@/lib/types/domain';

/**
 * The workflow control on the order detail page.
 *
 * One button per step the order can actually take next — not a dropdown of
 * every status that exists. `allowedNext` is computed on the server from the
 * transition policy, so this component never decides what is legal; it renders
 * the decision. The server checks it again anyway when it writes: hiding a
 * button is never the control.
 *
 * `expectedUpdatedAt` is the order's `updatedAt` as this page rendered it. If
 * anyone moved the order in between, the request comes back 409 and the
 * component says so and reloads, instead of applying a step that was chosen
 * against a state that no longer exists.
 */
export function OrderStatusForm({
  orderId,
  currentStatus,
  allowedNext,
  expectedUpdatedAt,
}: {
  orderId: string;
  currentStatus: OrderStatus;
  allowedNext: OrderStatus[];
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<OrderStatus | null>(null);

  async function submit(status: OrderStatus) {
    setError(null);
    setNotice(null);
    setPending(status);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, expectedUpdatedAt }),
      });
      const result = await response.json();
      if (!result.ok) {
        setError(result.message ?? 'Не удалось изменить статус');
        // A 409 means this page is looking at a state the order has left —
        // pull the current one in so the next attempt starts from reality.
        if (response.status === 409) router.refresh();
        return;
      }
      setNotice(
        result.changed
          ? `Статус изменён: ${ORDER_STATUS_LABEL_RU[status]}.`
          : 'Статус не изменился.',
      );
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="tech-label">Текущий статус</span>{' '}
        <span className="font-semibold" data-testid="order-status-value">
          {ORDER_STATUS_LABEL_RU[currentStatus]}
        </span>
      </p>

      {allowedNext.length === 0 ? (
        <p className="text-sm text-steel">Заказ завершён — дальнейших изменений статуса нет.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowedNext.map((status) => (
            <Button
              key={status}
              type="button"
              size="md"
              // Cancelling is the one step that does not move the order
              // forward, so it never looks like the expected next action.
              variant={status === 'CANCELLED' ? 'outline' : 'primary'}
              className={`min-h-11 ${status === 'CANCELLED' ? 'text-danger' : ''}`}
              data-testid={`order-status-to-${status}`}
              disabled={pending !== null}
              onClick={() => void submit(status)}
            >
              {pending === status ? 'Сохраняем…' : ORDER_STATUS_ACTION_LABEL_RU[status]}
            </Button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" data-testid="order-status-error" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="order-status-notice" className="text-sm text-success">
          {notice}
        </p>
      )}
    </div>
  );
}
