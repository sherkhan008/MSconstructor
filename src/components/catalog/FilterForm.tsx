'use client';

import { useRef } from 'react';
import type { PublicProductModel } from '@/lib/types/domain';

/**
 * Server-rendered filtering: this form's fields double as the query string
 * read by src/app/catalog/page.tsx. Works with JS disabled via the submit
 * button; auto-submits on change when JS is available.
 *
 * This is a Client Component, so `models` must already be the public-safe
 * shape (no markupPercent/markupFixed) — the type below is what enforces
 * that at the call site.
 */
export function FilterForm({
  models,
  useCases,
  defaults,
}: {
  models: PublicProductModel[];
  useCases: { id: string; ru: string }[];
  defaults: Record<string, string | undefined>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} method="get" action="/catalog" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Select name="model" label="Модель" defaultValue={defaults.model} onSubmit={() => formRef.current?.requestSubmit()}>
        <option value="">Все модели</option>
        {models.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.name.ru}
          </option>
        ))}
      </Select>

      <Select name="useCase" label="Применение" defaultValue={defaults.useCase} onSubmit={() => formRef.current?.requestSubmit()}>
        <option value="">Любое</option>
        {useCases.map((u) => (
          <option key={u.id} value={u.id}>
            {u.ru}
          </option>
        ))}
      </Select>

      <Select
        name="availability"
        label="Наличие"
        defaultValue={defaults.availability}
        onSubmit={() => formRef.current?.requestSubmit()}
      >
        <option value="">Любое</option>
        <option value="in_stock">В наличии</option>
      </Select>

      <Select name="sort" label="Сортировка" defaultValue={defaults.sort ?? 'recommended'} onSubmit={() => formRef.current?.requestSubmit()}>
        <option value="recommended">Рекомендуемые</option>
        <option value="price_asc">Сначала дешевле</option>
        <option value="price_desc">Сначала дороже</option>
        <option value="popularity">По популярности</option>
        <option value="newest">Сначала новые</option>
      </Select>

      <noscript>
        <button type="submit" className="col-span-2 h-11 border border-foreground px-4 text-sm font-medium sm:col-span-1">
          Применить
        </button>
      </noscript>
    </form>
  );
}

function Select({
  name,
  label,
  defaultValue,
  onSubmit,
  children,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="tech-label">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        onChange={onSubmit}
        className="h-11 border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
      >
        {children}
      </select>
    </label>
  );
}
