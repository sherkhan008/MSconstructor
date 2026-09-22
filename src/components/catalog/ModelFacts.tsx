import { t } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/locales';
import { HM } from '@/lib/i18n/strings';

/** "1000–3000 мм" from a model's supported values. A span, not a claim that
 * every combination inside it is valid — the compatibility rules
 * (src/lib/pricing/ms-standard-compatibility.ts) stay the only authority on
 * which combinations can be ordered. */
function dimensionRange(values: readonly number[], locale: Locale): string {
  return t(HM['HM-030'], locale, { min: Math.min(...values), max: Math.max(...values) });
}

/**
 * The four headline facts of a model — height/width/depth span and load —
 * as a hairline spec grid, the same treatment as the homepage model panel.
 * Takes only the public numbers it prints, never the model row itself, so
 * no internal commercial field can ride along in its props.
 */
export function ModelFacts({
  heights,
  widths,
  depths,
  maxLoadKg,
  locale,
  className = '',
}: {
  heights: readonly number[];
  widths: readonly number[];
  depths: readonly number[];
  maxLoadKg: number;
  locale: Locale;
  className?: string;
}) {
  const facts = [
    { label: t(HM['HM-025'], locale), value: dimensionRange(heights, locale) },
    { label: t(HM['HM-026'], locale), value: dimensionRange(widths, locale) },
    { label: t(HM['HM-027'], locale), value: dimensionRange(depths, locale) },
    { label: t(HM['HM-028'], locale), value: t(HM['HM-029'], locale, { N: maxLoadKg }) },
  ];
  return (
    <dl className={`grid grid-cols-1 gap-px border border-line bg-line min-[360px]:grid-cols-2 ${className}`}>
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-baseline justify-between gap-3 bg-surface px-3.5 py-3 min-[360px]:block sm:px-5 sm:py-4">
          <dt className="text-sm text-steel">{fact.label}</dt>
          <dd className="mono text-right text-sm min-[360px]:mt-1 min-[360px]:text-left font-semibold leading-snug min-[390px]:text-[0.9375rem] sm:text-lg">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
