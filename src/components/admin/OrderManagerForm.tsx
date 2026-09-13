'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import type { AssignableManager } from '@/lib/admin/orders';

/**
 * "Ответственный" on the order detail page.
 *
 * Three different controls, one component, because they are three views of
 * the same field and the server rules behind them are decided in one place
 * (assignOrderManager):
 *
 *   mode="assign" — SUPER_ADMIN/ADMIN: a <select> of every active operational
 *                   user plus "Не назначен", so an order can be handed over
 *                   or released.
 *   mode="claim"  — MANAGER on an order nobody holds: a single "Взять заказ"
 *                   button that can only ever send their own id. A manager
 *                   looking at an order somebody already holds gets the
 *                   read-only view instead — there is no control to press,
 *                   and the API would refuse it anyway.
 *   mode="read"   — CONTENT_MANAGER, and any manager on a taken order.
 *
 * `expectedUpdatedAt` is the order's `updatedAt` as this page rendered it. If
 * anyone changed the order in between, the request comes back 409 and the
 * component says so instead of overwriting their decision.
 */
export type OrderManagerMode = 'assign' | 'claim' | 'read';

const UNASSIGNED_OPTION = '';

export function OrderManagerForm({
  orderId,
  mode,
  actorId,
  currentManagerId,
  currentManagerName,
  managers,
  expectedUpdatedAt,
}: {
  orderId: string;
  mode: OrderManagerMode;
  /** The signed-in admin's own id — the only value "Взять заказ" may send. */
  actorId: string;
  currentManagerId: string | null;
  currentManagerName: string | null;
  managers: AssignableManager[];
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const serverValue = currentManagerId ?? UNASSIGNED_OPTION;
  const [lastServerValue, setLastServerValue] = useState(serverValue);
  const [selected, setSelected] = useState(serverValue);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The <select> follows the server when the order's manager changes
  // underneath it — but never at the cost of a choice the admin has already
  // made. A refresh can land at any moment (their own save, or a 409 pulling
  // in a colleague's change); if it silently reset the dropdown, the next
  // click would save the wrong person, or save nothing at all because the
  // button just went back to "unchanged".
  if (serverValue !== lastServerValue) {
    setLastServerValue(serverValue);
    if (selected === lastServerValue) setSelected(serverValue);
  }

  async function submit(managerId: string | null) {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/manager`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId, expectedUpdatedAt }),
      });
      const result = await response.json();
      if (!result.ok) {
        setError(result.message ?? 'Не удалось изменить ответственного');
        // A 409 means the page is looking at stale data — pull the current
        // state in so the next attempt starts from what is really stored.
        if (response.status === 409) router.refresh();
        return;
      }
      setNotice(result.changed ? 'Ответственный обновлён.' : 'Ответственный не изменился.');
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentLabel = currentManagerName ?? 'Не назначен';

  /**
   * Rendered in every mode on purpose.
   *
   * A losing claim is exactly the case where the mode changes underneath the
   * message: the 409 handler refreshes, the order now has someone on it, and
   * this component re-renders as the read-only view. If the notice lived
   * inside the claim branch it would disappear in the same frame, leaving the
   * manager with a new name on screen and no idea why their click did
   * nothing.
   */
  const messages = (
    <>
      {error && (
        <p role="alert" data-testid="order-manager-error" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="order-manager-notice" className="text-sm text-success">
          {notice}
        </p>
      )}
    </>
  );

  if (mode === 'read') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm" data-testid="order-manager-value">
          {currentLabel}
        </p>
        {messages}
      </div>
    );
  }

  if (mode === 'claim') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-steel" data-testid="order-manager-value">
          {currentLabel}
        </p>
        <div>
          <Button
            type="button"
            size="md"
            className="min-h-11"
            disabled={isSubmitting}
            onClick={() => submit(actorId)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Взять заказ'}
          </Button>
        </div>
        {messages}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(selected === UNASSIGNED_OPTION ? null : selected);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 sm:flex-none">
          <span className="tech-label">Ответственный менеджер</span>
          <select
            className="input"
            name="managerId"
            aria-label="Ответственный менеджер"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value={UNASSIGNED_OPTION}>Не назначен</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          size="md"
          className="min-h-11"
          disabled={isSubmitting || selected === serverValue}
        >
          {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </div>
      {messages}
    </form>
  );
}
