'use client';

import { useRef } from 'react';
import type { PublicProductModel } from '@/lib/types/domain';
import { pick, t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { CT } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Server-rendered filtering: this form's fields double as the query string
 * read by src/app/[locale]/catalog/page.tsx. Works with JS disabled via the submit
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
  useCases: { id: string; ru: string; kk: string }[];
  defaults: Record<string, string | undefined>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const locale = useLocale();

  return (
    <form ref={formRef} method="get" action={localizePath('/catalog', locale)} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Select name="model" label={t(CT['CT-005'], locale)} defaultValue={defaults.model} onSubmit={() => formRef.current?.requestSubmit()}>
        <option value="">{t(CT['CT-006'], locale)}</option>
        {models.map((m) => (
          <option key={m.slug} value={m.slug}>
            {pick(m.name, locale)}
          </option>
        ))}
      </Select>

      <Select name="useCase" label={t(CT['CT-007'], locale)} defaultValue={defaults.useCase} onSubmit={() => formRef.current?.requestSubmit()}>
        <option value="">{t(CT['CT-008'], locale)}</option>
        {useCases.map((u) => (
          <option key={u.id} value={u.id}>
            {pick(u, locale)}
          </option>
        ))}
      </Select>

      <Select
        name="availability"
        label={t(CT['CT-009'], locale)}
        defaultValue={defaults.availability}
        onSubmit={() => formRef.current?.requestSubmit()}
      >
        <option value="">{t(CT['CT-008'], locale)}</option>
        <option value="in_stock">{t(CT['CT-010'], locale)}</option>
      </Select>

      <Select name="sort" label={t(CT['CT-011'], locale)} defaultValue={defaults.sort ?? 'recommended'} onSubmit={() => formRef.current?.requestSubmit()}>
        <option value="recommended">{t(CT['CT-012'], locale)}</option>
        <option value="price_asc">{t(CT['CT-013'], locale)}</option>
        <option value="price_desc">{t(CT['CT-014'], locale)}</option>
        <option value="popularity">{t(CT['CT-015'], locale)}</option>
        <option value="newest">{t(CT['CT-016'], locale)}</option>
      </Select>

      <noscript>
        <button type="submit" className="col-span-2 h-11 border border-foreground px-4 text-sm font-medium sm:col-span-1">
          {t(CT['CT-017'], locale)}
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
