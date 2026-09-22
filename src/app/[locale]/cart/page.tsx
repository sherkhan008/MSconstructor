import type { Metadata } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { toPublicCatalog } from '@/lib/data/public-catalog';
import { buildMetadata } from '@/lib/seo';
import { t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CR, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';
import { CartClient } from '@/components/cart/CartClient';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-024'], locale), description: t(SE['SE-025'], locale), path: '/cart', locale, noIndex: true });
}

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

export default async function CartPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const catalog = await getCatalog();

  return (
    <Container className="py-10">
      <h1 className="font-display text-4xl">{t(CR['CR-001'], locale)}</h1>
      <div className="mt-8">
        <CartClient catalog={toPublicCatalog(catalog)} />
      </div>
    </Container>
  );
}
