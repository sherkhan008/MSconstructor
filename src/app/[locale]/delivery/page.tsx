import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';
import { quotedDeliveryPrice } from '@/lib/delivery/city-delivery';
import type { DeliveryMethod } from '@/lib/types/domain';
import { pick, t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { DL, SE } from '@/lib/i18n/strings';

/** Regional methods have no quoted price (see quotedDeliveryPrice), so they
 * read "calculated individually" even if a 0 is stored for them. The amount
 * is grouped the same way on every locale — only the words differ. */
function deliveryPriceLabel(method: DeliveryMethod, locale: Locale): string {
  const price = quotedDeliveryPrice(method);
  if (price === null) return t(DL['DL-004'], locale);
  return price === 0 ? t(DL['DL-005'], locale) : t(DL['DL-006'], locale, { amount: price.toLocaleString('ru-RU') });
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-030'], locale), description: t(SE['SE-031'], locale), path: '/delivery', locale });
}

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export default async function DeliveryPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const catalog = await getCatalog();

  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">{t(DL['DL-001'], locale)}</h1>
      <p className="mt-3 max-w-2xl text-steel">{t(DL['DL-002'], locale)}</p>

      <section className="mt-10">
        <h2 className="font-display text-2xl">{t(DL['DL-003'], locale)}</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {catalog.deliveryMethods.map((method) => (
            <div key={method.id} className="border border-line p-4">
              <h3 className="font-medium">{pick(method.name, locale)}</h3>
              <p className="mt-1 text-sm text-steel">{pick(method.description, locale)}</p>
              <p className="tech-label mt-2">
                {deliveryPriceLabel(method, locale)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">{t(DL['DL-007'], locale)}</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {catalog.assemblyServices.map((service) => (
            <div key={service.id} className="border border-line p-4">
              <h3 className="font-medium">{pick(service.name, locale)}</h3>
              <p className="mt-1 text-sm text-steel">{pick(service.description, locale)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-2xl">{t(DL['DL-008'], locale)}</h2>
        <ul className="mt-4 max-w-2xl list-disc space-y-1 pl-5 text-sm text-steel">
          <li>{t(DL['DL-009'], locale)}</li>
          <li>{t(DL['DL-010'], locale)}</li>
          <li>{t(DL['DL-011'], locale)}</li>
          <li>{t(DL['DL-012'], locale)}</li>
        </ul>
      </section>

      <div className="mt-10">
        <LinkButton href={localizePath('/configurator', locale)} size="lg" className="!whitespace-normal text-center">
          {t(DL['DL-013'], locale)}
        </LinkButton>
      </div>
    </Container>
  );
}
