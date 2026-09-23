import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { filterPubliclyVisibleModels } from '@/lib/config/launch-visibility';
import { buildMetadata } from '@/lib/seo';
import { t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CK, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';
import { OrderForm } from '@/components/order/OrderForm';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-026'], locale), description: t(SE['SE-027'], locale), path: '/order', locale, noIndex: true });
}

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const catalog = await getCatalog();

  return (
    <>
      <div className="border-b border-line bg-surface">
        <Container className="py-6 sm:py-8 lg:py-10">
          <h1 className="font-display text-[2rem] sm:text-4xl lg:text-5xl">{t(CK['CK-001'], locale)}</h1>
        </Container>
      </div>
      <Container className="pb-12 pt-6 sm:pb-10 sm:pt-8 lg:pb-12 lg:pt-10">
        <OrderForm
          deliveryMethods={catalog.deliveryMethods}
          models={filterPubliclyVisibleModels(catalog.models).map((m) => ({ slug: m.slug, name: m.name }))}
        />
      </Container>
    </>
  );
}
