import { buttonClassName } from '@/components/ui/Button';
import type { OrderDocumentKind } from '@/lib/documents/kinds';

export interface OrderDocumentEntry {
  kind: OrderDocumentKind;
  title: string;
  number: string;
  href: string;
  /** Blocking problems (missing/invalid seller configuration). When present
   * the document cannot be generated and no link is rendered. */
  blockers: string[];
  /** Non-blocking remarks shown under the actions. */
  notes: string[];
}

const actionClass = `${buttonClassName('outline', 'md')} min-h-11`;

/**
 * "Документы" on the admin order page: open or download a PDF generated from
 * the saved order. Plain links to the admin document route — no client
 * JavaScript, and nothing about the order is sent from the browser.
 */
export function OrderDocuments({ documents, canGenerate }: { documents: OrderDocumentEntry[]; canGenerate: boolean }) {
  if (!canGenerate) {
    return <p className="text-sm text-steel">Недостаточно прав для формирования документов.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="order-documents">
      {documents.map((doc) => (
        <li
          key={doc.kind}
          data-document-kind={doc.kind}
          className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium">{doc.title}</p>
            <p className="mono break-all text-sm text-steel">№ {doc.number}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:items-end">
            {doc.blockers.length === 0 ? (
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
              <div className="text-sm sm:max-w-md" role="note" data-testid="document-blockers">
                <p className="text-danger">Документ нельзя сформировать: не настроены реквизиты продавца.</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-steel">
                  {doc.blockers.map((blocker) => (
                    <li key={blocker} className="break-words">
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {doc.notes.map((note) => (
              <p key={note} className="text-sm text-steel sm:max-w-md">
                {note}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
