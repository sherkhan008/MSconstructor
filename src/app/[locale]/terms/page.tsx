import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { site, siteCopy } from '@/lib/config/site';
import { t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CN, PV, SE, TM } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-038'], locale), description: t(SE['SE-039'], locale), path: '/terms', locale });
}

export default async function TermsPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);

  return (
    <Container className="max-w-3xl py-10">
      <h1 className="font-display text-4xl">{t(TM['TM-001'], locale)}</h1>
      <p className="tech-label mt-2">{t(PV['PV-002'], locale)}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <p>{t(TM['TM-002'], locale, { company: site.legalName })}</p>

        <section>
          <h2 className="font-display text-2xl">{t(TM['TM-003'], locale)}</h2>
          <p className="mt-2">{t(TM['TM-004'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(TM['TM-005'], locale)}</h2>
          <p className="mt-2">{t(TM['TM-006'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(TM['TM-007'], locale)}</h2>
          <p className="mt-2">{t(TM['TM-008'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(TM['TM-009'], locale)}</h2>
          <p className="mt-2">{t(TM['TM-010'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(TM['TM-011'], locale)}</h2>
          <p className="mt-2">{t(TM['TM-012'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(TM['TM-013'], locale)}</h2>
          <p className="mt-2">
            {site.legalName}
            <br />
            {t(CN['CN-003'], locale)} {site.bin}
            <br />
            {siteCopy(locale).address}
            <br />
            {site.email}
          </p>
        </section>
      </div>
    </Container>
  );
}
