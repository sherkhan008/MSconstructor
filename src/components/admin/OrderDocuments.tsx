'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClassName } from '@/components/ui/Button';
import type { OrderDocumentKind } from '@/lib/documents/kinds';
import type { OrderDocumentStatus } from '@/lib/documents/readiness';

const actionClass = `${buttonClassName('outline', 'md')} min-h-11`;

const ISSUE_LABEL: Record<OrderDocumentKind, string> = {
  'commercial-proposal': 'Сформировать коммерческое предложение',
  invoice: 'Сформировать счёт',
};

/**
 * "Документы" on the admin order page: issue, then open or download, a PDF
 * of the saved order. Issuing is an explicit POST — no GET request ever
 * creates or mutates anything (see the two document routes). Opening and
 * downloading stay plain `<a>` links to the read-only GET route: no client
 * JavaScript is involved in reading an already-issued document, and nothing
 * about the order is sent from the browser.
 */
export function OrderDocuments({ documents, canGenerate }: { documents: OrderDocumentStatus[]; canGenerate: boolean }) {
  if (!canGenerate) {
    return <p className="text-sm text-steel">Недостаточно прав для формирования документов.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="order-documents">
      {documents.map((doc) => (
        <DocumentRow key={doc.kind} doc={doc} />
      ))}
    </ul>
  );
}

function DocumentRow({ doc }: { doc: OrderDocumentStatus }) {
  const router = useRouter();
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onIssue() {
    setError(null);
    setIssuing(true);
    try {
      const response = await fetch(doc.issueHref, { method: 'POST' });
      const result = await response.json();
      if (!result.ok) {
        setError(result.message ?? 'Не удалось сформировать документ');
        return;
      }
      // The server now holds the issuance; re-fetch this page's server
      // component so the row switches from the action to Open/Download.
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <li
      data-document-kind={doc.kind}
      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <p className="font-medium">{doc.title}</p>
        <p className="mono break-all text-sm text-steel">№ {doc.number}</p>
        {doc.issued && (
          <p className="text-sm text-steel" data-testid="document-issued">
            Выставлен {doc.issued.dateText} · {doc.issued.issuedByName}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:items-end">
        {doc.blocked ? (
          <div className="text-sm sm:max-w-md" role="note" data-testid="document-blockers">
            <p className="text-danger">{doc.blocked.reason}</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-steel">
              {doc.blocked.details.map((detail) => (
                <li key={detail} className="break-words">
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        ) : doc.issued ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={doc.href}
              target="_blank"
              rel="noopener noreferrer"
              className={actionClass}
              aria-label={`Открыть PDF: ${doc.title}`}
            >
              Открыть PDF
            </a>
            <a href={`${doc.href}?download=1`} download className={actionClass} aria-label={`Скачать PDF: ${doc.title}`}>
              Скачать
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={onIssue}
            disabled={issuing}
            className={actionClass}
            data-testid="issue-document"
            aria-label={ISSUE_LABEL[doc.kind]}
          >
            {issuing ? 'Формируем…' : ISSUE_LABEL[doc.kind]}
          </button>
        )}
        {doc.notes.map((note) => (
          <p key={note} className="text-sm text-steel sm:max-w-md">
            {note}
          </p>
        ))}
        {error && (
          <p className="text-sm text-danger" data-testid="document-issue-error">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
