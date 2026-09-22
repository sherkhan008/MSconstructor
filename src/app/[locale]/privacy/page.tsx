import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { site, siteCopy } from '@/lib/config/site';
import { t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { PV, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({ title: t(SE['SE-036'], locale), description: t(SE['SE-037'], locale), path: '/privacy', locale });
}

export default async function PrivacyPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);

  return (
    <Container className="max-w-3xl py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{t(PV['PV-001'], locale)}</h1>
      <p className="tech-label mt-2">{t(PV['PV-002'], locale)}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <p>{t(PV['PV-003'], locale, { company: site.legalName })}</p>

        <section>
          <h2 className="font-display text-2xl">{t(PV['PV-004'], locale)}</h2>
          <p className="mt-2">{t(PV['PV-005'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(PV['PV-006'], locale)}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t(PV['PV-007'], locale)}</li>
            <li>{t(PV['PV-008'], locale)}</li>
            <li>{t(PV['PV-009'], locale)}</li>
            <li>{t(PV['PV-010'], locale)}</li>
            <li>{t(PV['PV-011'], locale)}</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(PV['PV-012'], locale)}</h2>
          <p className="mt-2">{t(PV['PV-013'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(PV['PV-014'], locale)}</h2>
          <p className="mt-2">{t(PV['PV-015'], locale)}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(PV['PV-016'], locale)}</h2>
          <p className="mt-2">{t(PV['PV-017'], locale, { email: site.email })}</p>
        </section>

        <section>
          <h2 className="font-display text-2xl">{t(PV['PV-018'], locale)}</h2>
          <p className="mt-2">{t(PV['PV-019'], locale, { email: site.email, address: siteCopy(locale).address })}</p>
        </section>
      </div>
    </Container>
  );
}
