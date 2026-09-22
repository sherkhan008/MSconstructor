import { notFound } from 'next/navigation';

/**
 * Any path inside a locale that no page claims (e.g. /ru/api/…, /ru/admin,
 * /ru/ru/…) is a 404 rendered inside the public layout. APIs and the admin
 * panel exist once, outside the locale tree.
 */
export default function UnknownPublicPage() {
  notFound();
}
