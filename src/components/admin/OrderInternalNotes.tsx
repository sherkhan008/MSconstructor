'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { INTERNAL_NOTES_MAX_LENGTH } from '@/lib/admin/internal-notes';

/**
 * Internal notes for one order — an admin-only scratchpad ("перезвонить после
 * 18:00", "просит счёт на другое юрлицо").
 *
 * Editable by SUPER_ADMIN/ADMIN/MANAGER, read-only for CONTENT_MANAGER; the
 * same predicate gates this component, the API route and the service, and
 * only the last of those is the control.
 *
 * The note is rendered as text (React escapes it) and is stored as plain text
 * — tags are stripped server-side in toPlainTextNotes() — so nothing typed
 * here can ever become markup on a later screen. `maxLength` is a convenience
 * for the person typing; the 5000-character limit is enforced by the schema.
 *
 * Concurrency: `expectedUpdatedAt` is the order as this page rendered it. If
 * a colleague saved a note meanwhile, the save comes back 409 and their text
 * stays — this component reloads instead of overwriting it.
 */
export function OrderInternalNotes({
  orderId,
  initialNotes,
  expectedUpdatedAt,
  canEdit,
}: {
  orderId: string;
  initialNotes: string;
  expectedUpdatedAt: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [savedValue, setSavedValue] = useState(initialNotes);
  const [value, setValue] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The textarea follows the server when the stored note changes underneath
  // it, but a refresh must never throw away text the admin is still typing —
  // including the text a 409 just refused to save, which is the one copy of
  // it that exists. So the baseline moves; the draft only follows it when
  // there is no draft.
  if (initialNotes !== savedValue) {
    setSavedValue(initialNotes);
    if (value === savedValue) setValue(initialNotes);
  }

  if (!canEdit) {
    return initialNotes ? (
      <p className="whitespace-pre-wrap text-sm" data-testid="internal-notes-text">
        {initialNotes}
      </p>
    ) : (
      <p className="text-sm text-steel" data-testid="internal-notes-text">
        Заметок нет.
      </p>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes: value, expectedUpdatedAt }),
      });
      const result = await response.json();
      if (!result.ok) {
        setError(result.message ?? 'Не удалось сохранить заметку');
        if (response.status === 409) router.refresh();
        return;
      }
      // Adopt the server's normalised text as both the baseline and the
      // visible draft: the admin just committed it, so there is nothing of
      // theirs left to protect, and what is stored is what they should see
      // (markup they pasted has been stripped by now).
      const stored = (result.internalNotes as string | undefined) ?? '';
      setSavedValue(stored);
      setValue(stored);
      setNotice(result.changed ? 'Заметка сохранена.' : 'Заметка не изменилась.');
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="sr-only">Внутренние заметки</span>
        <textarea
          className="input min-h-28 w-full"
          name="internalNotes"
          aria-label="Внутренние заметки"
          data-testid="internal-notes-input"
          maxLength={INTERNAL_NOTES_MAX_LENGTH}
          rows={5}
          placeholder="Видно только сотрудникам. Клиент эту заметку не увидит."
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="md" className="min-h-11" disabled={isSubmitting || value === savedValue}>
          {isSubmitting ? 'Сохраняем…' : 'Сохранить заметку'}
        </Button>
        <span className="tech-label text-steel">
          {value.length} / {INTERNAL_NOTES_MAX_LENGTH}
        </span>
      </div>
      {error && (
        <p role="alert" data-testid="internal-notes-error" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="internal-notes-notice" className="text-sm text-success">
          {notice}
        </p>
      )}
    </form>
  );
}
