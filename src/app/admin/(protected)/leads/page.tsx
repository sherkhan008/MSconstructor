import Link from 'next/link';
import {
  listContactLeads,
  type AdminContactLead,
  type AdminLeadNotification,
  type LeadNotificationState,
} from '@/lib/admin/contact-leads';
import { Badge } from '@/components/ui/Badge';

/**
 * Contact-form leads, newest first. Read-only: a lead is stored by the
 * contact API before any notification is attempted, so this list is the
 * authoritative record even when a WhatsApp/Telegram alert failed — the
 * "Уведомление" column shows what happened to that alert.
 *
 * Everything the customer typed is rendered as React text (escaped), never
 * as HTML.
 */

export const dynamic = 'force-dynamic';

const PREVIEW_LENGTH = 140;

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', email: 'Email' };

const STATE_LABEL: Record<LeadNotificationState, string> = {
  SENT: 'отправлено',
  PENDING: 'отправляется',
  RETRYING: 'повтор запланирован',
  FAILED: 'не доставлено',
};

function stateTone(state: LeadNotificationState): 'success' | 'danger' | 'neutral' {
  if (state === 'SENT') return 'success';
  if (state === 'FAILED') return 'danger';
  return 'neutral';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Notifications({ items }: { items: AdminLeadNotification[] }) {
  if (items.length === 0) return <span className="text-steel">Не отправлялось</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item.channel} tone={stateTone(item.state)}>
          {CHANNEL_LABEL[item.channel] ?? item.channel}: {STATE_LABEL[item.state]}
        </Badge>
      ))}
    </span>
  );
}

function Message({ lead }: { lead: AdminContactLead }) {
  if (lead.message.length <= PREVIEW_LENGTH) {
    return <p className="whitespace-pre-wrap break-words">{lead.message}</p>;
  }
  return (
    <details>
      <summary className="cursor-pointer break-words">{lead.message.slice(0, PREVIEW_LENGTH).trimEnd()}…</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{lead.message}</p>
    </details>
  );
}

function parsePage(raw: string | string[] | undefined): number {
  const page = Number.parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ''), 10);
  return Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1;
}

const pageHref = (page: number) => (page > 1 ? `/admin/leads?page=${page}` : '/admin/leads');

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { leads, total, page, totalPages } = await listContactLeads({ page: parsePage((await searchParams).page) });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Заявки</h1>
        <p className="text-sm text-steel">
          Всего: <span className="mono font-semibold text-foreground">{total}</span>
        </p>
      </div>

      {leads.length === 0 ? (
        <p className="border border-line bg-background px-3 py-8 text-center text-sm text-steel">Заявок пока нет.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto border border-line bg-background lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left">
                  <th className="px-3 py-2 font-normal tech-label">Дата</th>
                  <th className="px-3 py-2 font-normal tech-label">Имя</th>
                  <th className="px-3 py-2 font-normal tech-label">Телефон</th>
                  <th className="px-3 py-2 font-normal tech-label">Сообщение</th>
                  <th className="px-3 py-2 font-normal tech-label">Уведомление</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} data-testid="lead-row" className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(lead.createdAt)}</td>
                    <td className="px-3 py-2 break-words">{lead.name}</td>
                    <td className="px-3 py-2 mono whitespace-nowrap">{lead.phone}</td>
                    <td className="max-w-md px-3 py-2">
                      <Message lead={lead} />
                    </td>
                    <td className="px-3 py-2">
                      <Notifications items={lead.notifications} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 lg:hidden">
            {leads.map((lead) => (
              <li key={lead.id} data-testid="lead-card" className="border border-line bg-background p-3 text-sm">
                <p className="text-xs text-steel">{formatDateTime(lead.createdAt)}</p>
                <p className="mt-1 break-words font-semibold">{lead.name}</p>
                <p className="mono mt-1 break-all">{lead.phone}</p>
                <div className="mt-2 border-t border-line pt-2">
                  <Message lead={lead} />
                </div>
                <div className="mt-2">
                  <Notifications items={lead.notifications} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {totalPages > 1 && (
        <nav aria-label="Страницы" className="flex flex-wrap items-center justify-center gap-3">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              className="tech-label inline-flex min-h-11 items-center border border-line px-3 hover:border-foreground"
            >
              ← Назад
            </Link>
          )}
          <span className="tech-label text-steel">
            Стр. {page} из {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={pageHref(page + 1)}
              className="tech-label inline-flex min-h-11 items-center border border-line px-3 hover:border-foreground"
            >
              Вперёд →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
