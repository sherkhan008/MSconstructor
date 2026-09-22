import Link from 'next/link';
import { FOOTER_LINKS, linkLabel, site, siteCopy } from '@/lib/config/site';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { t } from '@/lib/i18n/format';
import { localizePath, type Locale } from '@/lib/i18n/locales';
import { F } from '@/lib/i18n/strings';
import { Container } from '@/components/ui/Container';

export function Footer({ locale }: { locale: Locale }) {
  const copy = siteCopy(locale);

  return (
    <footer className="hairline border-b-0 bg-surface-dark text-background">
      <Container className="grid grid-cols-1 gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="font-display text-2xl">{copy.name}</span>
          <p className="mt-3 max-w-xs text-sm text-steel-soft">{copy.shortDescription}</p>
          <p className="tech-label mt-4 text-steel-soft">{site.legalName}</p>
        </div>

        <div>
          <h3 className="tech-label mb-3 text-accent">{t(F['F-001'], locale)}</h3>
          <ul className="space-y-2 text-sm">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={localizePath(link.href, locale)} className="text-steel-soft transition-colors hover:text-background">
                  {linkLabel(link, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="tech-label mb-3 text-accent">{t(F['F-002'], locale)}</h3>
          <ul className="space-y-2 text-sm text-steel-soft">
            <li>
              <a
                href={whatsAppContactUrl(locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="mono hover:text-background"
              >
                WhatsApp {site.whatsappDisplay}
              </a>
            </li>
            <li>
              <a href={`mailto:${site.email}`} className="hover:text-background">
                {site.email}
              </a>
            </li>
            <li>{copy.address}</li>
            <li>{copy.workingHours}</li>
          </ul>
        </div>

        <div>
          <h3 className="tech-label mb-3 text-accent">{t(F['F-003'], locale)}</h3>
          <ul className="space-y-2 text-sm text-steel-soft">
            <li>{site.legalName}</li>
            <li className="mono">
              {t(F['F-009'], locale)} {site.bin}
            </li>
            <li>{t(F['F-010'], locale)}</li>
            <li>{t(F['F-011'], locale)}</li>
          </ul>
        </div>
      </Container>

      <div className="hairline border-x-0 border-b-0 border-t-[color:var(--color-steel)]/30">
        <Container className="flex flex-col items-center justify-between gap-2 py-4 text-xs text-steel-soft sm:flex-row">
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
