import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { PY, SE } from '@/lib/i18n/strings';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-032'], locale), description: t(SE['SE-033'], locale), path: '/payment', locale });
}

const METHODS = [
  { title: PY['PY-003'], description: PY['PY-004'], available: true },
  { title: PY['PY-005'], description: PY['PY-006'], available: true },
  { title: PY['PY-007'], description: PY['PY-008'], available: true },
  // "Kaspi Pay" is a product name, identical in every language.
  { title: { ru: 'Kaspi Pay', kk: 'Kaspi Pay' }, description: PY['PY-009'], available: false },
];

export default async function PaymentPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);

  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">{t(PY['PY-001'], locale)}</h1>
      <p className="mt-3 max-w-2xl text-steel">{t(PY['PY-002'], locale)}</p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {METHODS.map((method) => (
          <div key={method.title.ru} className="border border-line p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{t(method.title, locale)}</h3>
              {!method.available && <Badge tone="accent">{t(PY['PY-010'], locale)}</Badge>}
            </div>
            <p className="mt-1 text-sm text-steel">{t(method.description, locale)}</p>
          </div>
        ))}
      </div>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-2xl">{t(PY['PY-011'], locale)}</h2>
        <p className="mt-2 max-w-2xl text-sm text-steel">{t(PY['PY-012'], locale)}</p>
      </section>
    </Container>
  );
}
