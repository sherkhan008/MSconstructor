import Link from 'next/link';
import { FOOTER_LINKS, site } from '@/lib/config/site';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { Container } from '@/components/ui/Container';

export function Footer() {
  return (
    <footer className="hairline border-b-0 bg-surface-dark text-background">
      <Container className="grid grid-cols-1 gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="font-display text-2xl">{site.name}</span>
          <p className="mt-3 max-w-xs text-sm text-steel-soft">{site.shortDescription}</p>
          <p className="tech-label mt-4 text-steel-soft">{site.legalName}</p>
        </div>

        <div>
          <h3 className="tech-label mb-3 text-accent">Навигация</h3>
          <ul className="space-y-2 text-sm">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-steel-soft transition-colors hover:text-background">
                  {link.labelRu}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="tech-label mb-3 text-accent">Контакты</h3>
          <ul className="space-y-2 text-sm text-steel-soft">
            <li>
              <a
                href={whatsAppContactUrl()}
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
            <li>{site.address}</li>
            <li>{site.workingHours}</li>
          </ul>
        </div>

        <div>
          <h3 className="tech-label mb-3 text-accent">Реквизиты</h3>
          <ul className="space-y-2 text-sm text-steel-soft">
            <li>{site.legalName}</li>
            <li className="mono">БИН: {site.bin}</li>
            <li>Работаем с физическими и юридическими лицами</li>
            <li>Работаем с НДС, предоставляем документы</li>
          </ul>
        </div>
      </Container>

      <div className="hairline border-x-0 border-b-0 border-t-[color:var(--color-steel)]/30">
        <Container className="flex flex-col items-center justify-between gap-2 py-4 text-xs text-steel-soft sm:flex-row">
          <span>© {new Date().getFullYear()} {site.legalName}. Все права защищены.</span>
          <span className="mono">{site.currencySymbol} KZT · Казахстан</span>
        </Container>
      </div>
    </footer>
  );
}
