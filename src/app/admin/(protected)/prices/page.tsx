import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canManagePrices } from '@/lib/auth/authorize';
import { getCatalog } from '@/lib/data/repository';
import { PRICE_ENTITY_TYPES, type PriceEntityType } from '@/lib/admin/prices';
import { AdminPrices } from '@/components/admin/AdminPrices';

/**
 * Catalog price management (ADMIN/SUPER_ADMIN only).
 *
 * Authorization is resolved here, on the server, *before* anything renders:
 * an unauthorized admin gets the notice below and no price markup is ever
 * produced for them — not even an empty table that would then fetch. The
 * client component that follows reads every row from /api/admin/prices, which
 * re-checks canManagePrices() on its own; this page is not the security
 * boundary, it just avoids a pointless flash of a page they cannot use.
 *
 * Purchase prices exist only inside this authenticated admin flow. Nothing on
 * this page is shared with, or imported by, any customer-facing component.
 */

const ENTITY_FILTER_VALUES = ['ALL', ...PRICE_ENTITY_TYPES] as const;

function parseEntityType(value: string | undefined): PriceEntityType | 'ALL' {
  return (ENTITY_FILTER_VALUES as readonly string[]).includes(value ?? '')
    ? (value as PriceEntityType | 'ALL')
    : 'ALL';
}

export default async function AdminPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; entityType?: string; componentType?: string; model?: string; page?: string }>;
}) {
  const admin = await getCurrentAdmin();
  // The layout above already redirected anyone without a session; this is the
  // role check on top of it.
  if (!admin || !canManagePrices(admin.role)) {
    return (
      <div className="mx-auto max-w-lg border border-line bg-background p-6 text-center">
        <h1 className="font-display text-xl">Доступ запрещён</h1>
        <p className="mt-2 text-sm text-steel">
          Управление ценами доступно только администраторам. Обратитесь к главному администратору,
          если вам нужен доступ.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const catalog = await getCatalog();
  // Only slug + Russian name reach the browser — a ProductModel also carries
  // markupPercent/markupFixed, which must never leave the server.
  const models = catalog.models.map((model) => ({ slug: model.slug, name: model.name.ru }));

  return (
    <AdminPrices
      models={models}
      initialQuery={{
        q: params.q ?? '',
        entityType: parseEntityType(params.entityType),
        componentType: params.componentType ?? '',
        model: params.model ?? '',
        page: Math.max(1, Number(params.page) || 1),
      }}
    />
  );
}
