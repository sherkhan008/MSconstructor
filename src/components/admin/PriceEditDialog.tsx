'use client';

import { useCallback, useState } from 'react';
import { AdminModal } from '@/components/admin/AdminModal';
import { Button } from '@/components/ui/Button';
import {
  PRICE_REASON_MAX_LENGTH,
  canonicalPriceString,
  toPriceInputValue,
  validatePriceString,
} from '@/lib/admin/price-format';
import { PRICE_ENTITY_LABEL_RU } from '@/lib/admin/price-labels';
import type { AdminPriceRow } from '@/lib/admin/prices';

/**
 * Edit the selling and/or purchase price of one catalog entity.
 *
 * Three rules drive the implementation:
 *
 *  1. Money stays a string. The fields are `type="text"` with
 *     `inputMode="decimal"`, never `type="number"`: a number input would let
 *     the browser hand back `1e5`, a locale comma or a float-rounded value for
 *     something that is written to Decimal(12, 2).
 *  2. Validation mirrors the server exactly, because both sides call the same
 *     validatePriceString() (src/lib/admin/price-format.ts). Nothing is
 *     rounded or "corrected" — a bad value is refused with a reason.
 *  3. Only fields that actually changed are sent, together with the
 *     `expectedUpdatedAt` the row was loaded with. A 409 therefore never
 *     silently overwrites the other admin's price: the stale request is not
 *     retried, the newer values are fetched and shown first.
 */

interface FieldState {
  value: string;
  error: string | null;
}

function initialField(stored: string): FieldState {
  return { value: toPriceInputValue(stored), error: null };
}

export function PriceEditDialog({
  row,
  onClose,
  onSaved,
  onReloadRow,
}: {
  row: AdminPriceRow;
  onClose: () => void;
  onSaved: (row: AdminPriceRow, message: string) => void;
  /** Re-reads this row from the server; null when it is no longer listed. */
  onReloadRow: (row: AdminPriceRow) => Promise<AdminPriceRow | null>;
}) {
  // The values the dialog is editing *against*. A conflict refresh replaces
  // this baseline, so the next save carries a fresh concurrency token.
  const [baseline, setBaseline] = useState(row);
  const [selling, setSelling] = useState<FieldState>(() => initialField(row.sellingPrice));
  const [purchase, setPurchase] = useState<FieldState>(() => initialField(row.purchasePrice));
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const sellingChanged =
    selling.value.trim() !== '' &&
    canonicalPriceString(selling.value) !== canonicalPriceString(baseline.sellingPrice);
  const purchaseChanged =
    purchase.value.trim() !== '' &&
    canonicalPriceString(purchase.value) !== canonicalPriceString(baseline.purchasePrice);
  const nothingToSave = !sellingChanged && !purchaseChanged;

  const validateField = useCallback((value: string): string | null => {
    const result = validatePriceString(value);
    return result.ok ? null : result.message;
  }, []);

  async function refreshFromServer() {
    setRefreshing(true);
    try {
      const fresh = await onReloadRow(baseline);
      if (!fresh) {
        setFormError('Позиция больше не доступна в текущем списке. Закройте окно и обновите поиск.');
        return;
      }
      setBaseline(fresh);
      setSelling(initialField(fresh.sellingPrice));
      setPurchase(initialField(fresh.purchasePrice));
      setConflict(false);
      setFormError(null);
    } catch {
      setFormError('Не удалось обновить данные. Проверьте соединение и попробуйте снова.');
    } finally {
      setRefreshing(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    const sellingError = sellingChanged ? validateField(selling.value) : null;
    const purchaseError = purchaseChanged ? validateField(purchase.value) : null;
    setSelling((state) => ({ ...state, error: sellingError }));
    setPurchase((state) => ({ ...state, error: purchaseError }));
    if (sellingError || purchaseError) return;

    if (nothingToSave) {
      setFormError('Измените хотя бы одну цену.');
      return;
    }

    setPending(true);
    setFormError(null);
    setConflict(false);
    try {
      const response = await fetch(`/api/admin/prices/${baseline.entityType}/${baseline.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(sellingChanged ? { sellingPrice: selling.value.trim() } : {}),
          ...(purchaseChanged ? { purchasePrice: purchase.value.trim() } : {}),
          expectedUpdatedAt: baseline.updatedAt,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });

      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (response.status === 409) {
        // Never re-send the stale PATCH and never overwrite: the admin has to
        // look at the newer values first.
        setConflict(true);
        return;
      }

      const result = await response.json();
      if (!result.ok) {
        const details = Array.isArray(result.details) ? result.details : [];
        setFormError(
          [result.message, ...details].filter(Boolean).join(' ') || 'Не удалось сохранить цену.',
        );
        return;
      }

      onSaved(
        {
          ...baseline,
          sellingPrice: result.sellingPrice,
          purchasePrice: result.purchasePrice,
          updatedAt: result.updatedAt,
        },
        result.changed ? 'Цена обновлена' : 'Цены не изменились',
      );
    } catch {
      setFormError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      labelId="price-edit-title"
      title="Изменить цену"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mono">{baseline.sku}</span>
          <span aria-hidden>·</span>
          <span>{baseline.name}</span>
          <span aria-hidden>·</span>
          <span>{PRICE_ENTITY_LABEL_RU[baseline.entityType]}</span>
        </span>
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="tech-label">Цена продажи, ₸</span>
          <input
            name="sellingPrice"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="input mono"
            value={selling.value}
            aria-invalid={selling.error ? true : undefined}
            aria-describedby={selling.error ? 'selling-price-error' : undefined}
            onChange={(event) => setSelling({ value: event.target.value, error: null })}
            onBlur={(event) =>
              setSelling((state) => ({ ...state, error: validateField(event.target.value) }))
            }
          />
          {selling.error && (
            <span id="selling-price-error" role="alert" className="text-sm text-danger">
              {selling.error}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="tech-label">Закупочная цена, ₸</span>
          <input
            name="purchasePrice"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="input mono"
            value={purchase.value}
            aria-invalid={purchase.error ? true : undefined}
            aria-describedby={purchase.error ? 'purchase-price-error' : undefined}
            onChange={(event) => setPurchase({ value: event.target.value, error: null })}
            onBlur={(event) =>
              setPurchase((state) => ({ ...state, error: validateField(event.target.value) }))
            }
          />
          {purchase.error && (
            <span id="purchase-price-error" role="alert" className="text-sm text-danger">
              {purchase.error}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="tech-label">Причина изменения (необязательно)</span>
          <textarea
            name="reason"
            rows={2}
            maxLength={PRICE_REASON_MAX_LENGTH}
            className="input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        {conflict && (
          <div role="alert" className="border border-danger bg-danger-soft px-3 py-3 text-sm">
            <p className="text-danger">Цена уже была изменена другим пользователем.</p>
            <Button
              type="button"
              variant="outline"
              size="md"
              className="mt-2"
              disabled={refreshing}
              onClick={refreshFromServer}
            >
              {refreshing ? 'Обновляем…' : 'Обновить данные'}
            </Button>
          </div>
        )}

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" size="md" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" size="md" disabled={pending || nothingToSave || conflict}>
            {pending ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}
