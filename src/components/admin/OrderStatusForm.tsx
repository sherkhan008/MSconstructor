'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ORDER_STATUS_LABEL_RU, ORDER_STATUS_VALUES } from '@/lib/orders/status-labels';
import type { OrderStatus } from '@/lib/types/domain';

export function OrderStatusForm({ orderId, currentStatus }: { orderId: string; currentStatus: OrderStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus>(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!result.ok) {
        setError(result.message ?? 'Не удалось изменить статус');
        return;
      }
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="tech-label">Статус заказа</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)} className="input">
          {ORDER_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {ORDER_STATUS_LABEL_RU[value]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" disabled={isSubmitting || status === currentStatus}>
        {isSubmitting ? 'Сохраняем…' : 'Изменить статус'}
      </Button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
