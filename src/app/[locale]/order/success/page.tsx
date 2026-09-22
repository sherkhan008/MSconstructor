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
    <Container className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center border-2 border-success text-3xl text-success">✓</div>
      <h1 className="font-display text-4xl text-success">{t(OS['OS-001'], locale)}</h1>

      {number ? (
        <p className="text-steel">
          {t(OS['OS-002'], locale)} <span className="mono font-semibold text-foreground">{number}</span>
        </p>
      ) : (
        <p className="text-steel">{t(OS['OS-003'], locale)}</p>
      )}

      {order && (
        <div className="w-full max-w-md border border-line p-5 text-left">
          <div className="tech-label">{t(OS['OS-004'], locale)}</div>
          <p className="mono text-2xl font-semibold">{formatPrice(order.grandTotal)}</p>
          <div className="tech-label mt-3">{t(OS['OS-005'], locale)}</div>
          <p>{t(ORDER_STATUS_LABEL[order.status] ?? OS['OS-007'], locale)}</p>
          <div className="tech-label mt-3">{t(OS['OS-008'], locale)}</div>
          <p>{paymentMethodLabel(order.paymentPreference, locale)}</p>
          <div className="tech-label mt-3">{t(OS['OS-009'], locale)}</div>
          <p>{order.items.length}</p>
        </div>
      )}

      <p className="max-w-md text-sm text-steel">{t(OS['OS-010'], locale)}</p>

      <div className="flex flex-wrap justify-center gap-3">
        {number && (
          <LinkButton
            href={whatsAppOrderUrl(number, order?.grandTotal, locale)}
            target="_blank"
            rel="noopener noreferrer"
            variant="whatsapp"
          >
            {t(OS['OS-011'], locale)}
          </LinkButton>
        )}
        <LinkButton href={localizePath('/catalog', locale)} variant="outline">
          {t(OS['OS-012'], locale)}
        </LinkButton>
        <LinkButton href={localizePath('/', locale)} variant="ghost">
          {t(OS['OS-013'], locale)}
        </LinkButton>
      </div>
    </Container>
  );
}
