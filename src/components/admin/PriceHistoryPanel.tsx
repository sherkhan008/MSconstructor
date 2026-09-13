'use client';

import { useEffect, useState } from 'react';
import { AdminModal } from '@/components/admin/AdminModal';
import { Button } from '@/components/ui/Button';
import { formatPriceKzt } from '@/lib/admin/price-format';
import {
  PRICE_FIELD_LABEL_RU,
  PRICE_FIELD_UNKNOWN_LABEL_RU,
} from '@/lib/admin/price-labels';
import type { AdminPriceHistoryEntry, AdminPriceRow } from '@/lib/admin/prices';

/**
 * Price-change history of one catalog entity, newest first.
 *
 * Reads GET /api/admin/prices/[entityType]/[id]/history — the same admin-only
 * endpoint that gates purchase-price history behind canManagePrices().
 *
 * Two shapes of legacy row are handled rather than assumed away:
 *   - `field === null` (written before PriceHistory.field existed) renders the
 *     neutral "Изменение цены" — never a guess at which price moved;
 *   - `oldValue === null` renders "—" instead of a fabricated previous price.
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

export function PriceHistoryPanel({ row, onClose }: { row: AdminPriceRow; onClose: () => void }) {
  const [entries, setEntries] = useState<AdminPriceHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setEntries(null);
    setError(null);

    (async () => {
      try {
        const response = await fetch(`/api/admin/prices/${row.entityType}/${row.id}/history`, {
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.location.href = '/admin/login';
          return;
        }
        const result = await response.json();
        if (!result.ok) {
          setError(result.message ?? 'Не удалось загрузить историю изменений.');
          return;
        }
        setEntries(result.entries as AdminPriceHistoryEntry[]);
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') return;
        setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
      }
    })();

    return () => controller.abort();
  }, [row.entityType, row.id, reloadToken]);

  return (
    <AdminModal
      labelId="price-history-title"
      title="История изменений"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mono">{row.sku}</span>
          <span aria-hidden>·</span>
          <span>{row.name}</span>
        </span>
      }
      onClose={onClose}
    >
      {error && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm text-danger">{error}</p>
          <Button type="button" variant="outline" size="md" onClick={() => setReloadToken((n) => n + 1)}>
            Повторить
          </Button>
        </div>
      )}

      {!error && entries === null && (
        <p className="py-6 text-center text-sm text-steel">Загружаем историю…</p>
      )}

      {!error && entries !== null && entries.length === 0 && (
        <p className="py-6 text-center text-sm text-steel">Цена ещё не изменялась.</p>
      )}

      {!error && entries !== null && entries.length > 0 && (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border border-line bg-surface px-3 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="tech-label">
                  {entry.field ? PRICE_FIELD_LABEL_RU[entry.field] : PRICE_FIELD_UNKNOWN_LABEL_RU}
                </span>
                <span className="mono text-xs text-steel">{formatDateTime(entry.createdAt)}</span>
              </div>
              <p className="mono mt-1 text-sm" data-testid="history-change">
                {entry.oldValue === null ? '—' : formatPriceKzt(entry.oldValue)} →{' '}
                {formatPriceKzt(entry.newValue)}
              </p>
              <p className="mt-1 text-sm text-steel">{entry.adminName ?? 'Администратор удалён'}</p>
              {entry.reason && <p className="mt-1 text-sm">{entry.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </AdminModal>
  );
}
