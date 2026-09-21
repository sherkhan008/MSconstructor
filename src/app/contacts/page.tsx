import type { Metadata } from 'next';
import { buildMetadata, jsonLdScriptProps, organizationJsonLd } from '@/lib/seo';
import { site } from '@/lib/config/site';
import { whatsAppContactUrl } from '@/lib/whatsapp';
import { Container } from '@/components/ui/Container';
import { ContactForm } from '@/components/contact/ContactForm';

export const metadata: Metadata = buildMetadata({
  title: 'Контакты',
  description: `Свяжитесь с ${site.name}: WhatsApp, email и адрес.`,
  path: '/contacts',
});

export default function ContactsPage() {
  return (
    <Container className="py-10">
      <script {...jsonLdScriptProps(organizationJsonLd())} type="application/ld+json" />
      <h1 className="font-display text-4xl">Контакты</h1>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="tech-label">WhatsApp</dt>
              <dd className="text-lg">
                <a href={whatsAppContactUrl()} target="_blank" rel="noopener noreferrer" className="mono text-success hover:underline">
                  {site.whatsappDisplay}
                </a>
              </dd>
            </div>
            <div>
              <dt className="tech-label">Email</dt>
              <dd>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </dd>
            </div>
            <div>
              <dt className="tech-label">Адрес</dt>
              <dd>{site.address}</dd>
            </div>
            <div>
              <dt className="tech-label">Режим работы</dt>
              <dd>{site.workingHours}</dd>
            </div>
            <div>
              <dt className="tech-label">Реквизиты</dt>
              <dd>
                {site.legalName}
                <br />
                <span className="mono">БИН {site.bin}</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="border border-line bg-surface p-6">
          <h2 className="font-display text-xl">Написать нам</h2>
          <p className="mt-1 text-sm text-steel">Заполните форму, и мы перезвоним в рабочее время.</p>
          <div className="mt-4">
            <ContactForm />
          </div>
        </div>
      </div>
    </Container>
  );
}
