import Link from 'next/link';
import { FOOTER_LINKS, linkLabel, site, siteCopy } from '@/lib/config/site';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { F, HM } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';

const COLUMN_HEADING = 'mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-accent';
const LINK = 'inline-flex min-h-9 items-center text-steel-soft transition-colors hover:text-background';

export function Footer({ locale }: { locale: Locale }) {
  const copy = siteCopy(locale);

  return (
    <footer className="bg-surface-dark text-background [&_:focus-visible]:outline-accent">
      <Container className="grid grid-cols-1 gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_1.2fr_1.2fr] lg:gap-12 lg:py-16">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href={localizePath('/', locale)} className="inline-flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center border-b-[3px] border-accent bg-background text-foreground">
              <span className="font-display text-lg leading-none">MS</span>
            </span>
            <span className="font-display text-2xl leading-none">{copy.name}</span>
          </Link>
          <p className="mt-4 text-sm font-medium text-background">{copy.tagline}</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-steel-soft">{copy.shortDescription}</p>
        </div>

        <div>
          <h2 className={COLUMN_HEADING}>{t(F['F-001'], locale)}</h2>
          <ul className="text-[0.9375rem]">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={localizePath(link.href, locale)} className={LINK}>
                  {linkLabel(link, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className={COLUMN_HEADING}>{t(F['F-002'], locale)}</h2>
          <dl className="space-y-3 text-[0.9375rem]">
            <div>
              <dt className="text-xs text-steel-soft">{t(HM['HM-061'], locale)}</dt>
              <dd>
                <a
                  href={whatsAppContactUrl(locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono inline-flex min-h-9 items-center text-background hover:text-accent"
                >
                  {site.whatsappDisplay}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-steel-soft">{t(HM['HM-062'], locale)}</dt>
              <dd>
                <a href={`mailto:${site.email}`} className="inline-flex min-h-9 items-center break-all text-background hover:text-accent">
                  {site.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-steel-soft">{t(HM['HM-063'], locale)}</dt>
              <dd className="mt-1 text-background">{copy.address}</dd>
            </div>
            <div>
              <dt className="text-xs text-steel-soft">{t(HM['HM-064'], locale)}</dt>
              <dd className="mt-1 text-background">{copy.workingHours}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className={COLUMN_HEADING}>{t(F['F-003'], locale)}</h2>
          <ul className="space-y-2.5 text-sm text-steel-soft">
            <li className="font-medium text-background">{site.legalName}</li>
            <li className="mono">
              {t(F['F-009'], locale)} {site.bin}
            </li>
            <li>{t(F['F-010'], locale)}</li>
            <li>{t(F['F-011'], locale)}</li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-line-dark">
        <Container className="flex flex-col gap-2 py-5 text-xs text-steel-soft sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {site.legalName}. {t(F['F-012'], locale)}
          </span>
          <span className="mono">
            {site.currencySymbol} {site.currency} · {t(F['F-013'], locale)}
          </span>
        </Container>
      </div>
    </footer>
  );
}
