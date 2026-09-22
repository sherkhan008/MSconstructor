import type { Metadata } from 'next';
import { buildMetadata, jsonLdScriptProps, organizationJsonLd } from '@/lib/seo';
import { site, siteCopy } from '@/lib/config/site';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { t } from '@/lib/i18n/format';
import { resolveLocale, type LocaleParams } from '@/lib/i18n/page';
import { CN, HM, SE } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';
import { ContactForm } from '@/components/contact/ContactForm';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  return buildMetadata({
    title: t(SE['SE-034'], locale),
    description: t(SE['SE-035'], locale, { brand: siteCopy(locale).name }),
    path: '/contacts',
    locale,
  });
}

export default async function ContactsPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const copy = siteCopy(locale);

  return (
    <Container className="py-10">
      <script {...jsonLdScriptProps(organizationJsonLd(locale))} type="application/ld+json" />
      <h1 className="font-display text-4xl">{t(CN['CN-001'], locale)}</h1>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="tech-label">{t(HM['HM-061'], locale)}</dt>
              <dd className="text-lg">
                <a href={whatsAppContactUrl(locale)} target="_blank" rel="noopener noreferrer" className="mono text-success hover:underline">
                  {site.whatsappDisplay}
                </a>
              </dd>
            </div>
            <div>
              <dt className="tech-label">{t(HM['HM-062'], locale)}</dt>
              <dd>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </dd>
            </div>
            <div>
              <dt className="tech-label">{t(HM['HM-063'], locale)}</dt>
              <dd>{copy.address}</dd>
            </div>
            <div>
              <dt className="tech-label">{t(HM['HM-064'], locale)}</dt>
              <dd>{copy.workingHours}</dd>
            </div>
            <div>
              <dt className="tech-label">{t(CN['CN-002'], locale)}</dt>
              <dd>
                {site.legalName}
                <br />
                <span className="mono">
                  {t(CN['CN-003'], locale)} {site.bin}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="border border-line bg-surface p-6">
          <h2 className="font-display text-xl">{t(CN['CN-004'], locale)}</h2>
          <p className="mt-1 text-sm text-steel">{t(CN['CN-005'], locale)}</p>
          <div className="mt-4">
            <ContactForm />
          </div>
        </div>
      </div>
    </Container>
  );
}
