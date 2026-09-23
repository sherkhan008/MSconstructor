import type { Metadata } from 'next';
import { getOrderByNumber } from '@/lib/orders/store';
import { buildMetadata } from '@/lib/seo';
import { formatPrice } from '@/lib/money';
import { whatsAppOrderUrl } from '@/lib/whatsapp';
import { paymentMethodLabel } from '@/lib/orders/payment-methods';
import { t, type Entry } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { OS, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';

const ORDER_STATUS_LABEL: Record<string, Entry> = {
  NEW: OS['OS-006'],
};

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({
    title: t(SE['SE-028'], locale),
    description: t(SE['SE-029'], locale),
    path: '/order/success',
    locale,
    noIndex: true,
  });
}

export default async function OrderSuccessPage({
  params,
  searchParams,
}: {
  params: LocaleParams;
  searchParams: Promise<{ number?: string }>;
}) {
  const locale = await resolveLocale(params);
  const { number } = await searchParams;
  const order = number ? await getOrderByNumber(number) : undefined;

  return (
    <div className="border-b border-line bg-surface">
      <Container className="pb-10 pt-12 sm:pb-14 sm:pt-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center border-2 border-success text-2xl text-success sm:h-16 sm:w-16 sm:text-3xl">✓</div>
          <h1 className="mt-6 font-display text-[2rem] text-success sm:text-4xl lg:text-5xl">{t(OS['OS-001'], locale)}</h1>

          {number ? (
            <p className="mt-4 text-steel">
              {t(OS['OS-002'], locale)}{' '}
              <span className="mono inline-block whitespace-nowrap font-semibold text-foreground">{number}</span>
            </p>
          ) : (
            <p className="mt-4 text-steel">{t(OS['OS-003'], locale)}</p>
          )}

          {order && (
            <dl className="mt-8 grid w-full grid-cols-1 border border-line border-t-2 border-t-success text-left sm:grid-cols-2">
              <div className="border-b border-line p-4 sm:col-span-2 sm:p-5">
                <dt className="text-sm text-steel">{t(OS['OS-004'], locale)}</dt>
                <dd className="mono mt-1 text-2xl font-semibold sm:text-3xl">{formatPrice(order.grandTotal)}</dd>
              </div>
              <div className="border-b border-line p-4 sm:border-r sm:p-5">
                <dt className="text-sm text-steel">{t(OS['OS-005'], locale)}</dt>
                <dd className="mt-1 font-medium">{t(ORDER_STATUS_LABEL[order.status] ?? OS['OS-007'], locale)}</dd>
              </div>
              <div className="border-b border-line p-4 sm:p-5">
                <dt className="text-sm text-steel">{t(OS['OS-009'], locale)}</dt>
                <dd className="mono mt-1 font-medium">{order.items.length}</dd>
              </div>
              <div className="p-4 sm:col-span-2 sm:p-5">
                <dt className="text-sm text-steel">{t(OS['OS-008'], locale)}</dt>
                <dd className="mt-1 font-medium">{paymentMethodLabel(order.paymentPreference, locale)}</dd>
              </div>
            </dl>
          )}

          {/* Closing block: what happens next and every way onward. The
              floating WhatsApp button steps aside for all of it, so it never
              crowds the text above the actions. */}
          <div className="flex w-full flex-col items-center pb-6" data-fab-avoid>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-steel">{t(OS['OS-010'], locale)}</p>

            <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
              {number && (
                <LinkButton
                  href={whatsAppOrderUrl(number, order?.grandTotal, locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="whatsapp"
                  className="min-h-12 px-6"
                >
                  {t(OS['OS-011'], locale)}
                </LinkButton>
              )}
              <LinkButton href={localizePath('/catalog', locale)} variant="outline" className="min-h-12 bg-surface px-6">
                {t(OS['OS-012'], locale)}
              </LinkButton>
              <LinkButton href={localizePath('/', locale)} variant="ghost" className="min-h-12 px-6">
                {t(OS['OS-013'], locale)}
              </LinkButton>
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}
