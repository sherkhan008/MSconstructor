'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PriceEditDialog } from '@/components/admin/PriceEditDialog';
import { PriceHistoryPanel } from '@/components/admin/PriceHistoryPanel';
import { formatPriceKzt } from '@/lib/admin/price-format';
import {
  COMPONENT_TYPE_LABEL_RU,
  COMPONENT_TYPE_VALUES,
  PRICE_ENTITY_LABEL_RU,
  componentTypeLabel,
} from '@/lib/admin/price-labels';
import type { AdminPriceRow, PriceEntityType } from '@/lib/admin/prices';

/**
 * Catalog price management table.
 *
 * Every read goes through GET /api/admin/prices, which does the searching,
 * filtering, ordering and pagination in PostgreSQL: the browser never holds
 * the whole catalog, and filtering is never faked client-side over one page of
 * results. Search is debounced so typing does not fire a request per keystroke.
 *
 * The query lives in this component and is mirrored into the URL with
 * history.replaceState — a reload or a shared link reopens the same view
 * without turning every keystroke into a Next.js navigation.
 *
 * ADMIN-ONLY: rows include purchasePrice. Nothing here is imported by, or
 * shared with, any customer-facing component.
 */

const SEARCH_DEBOUNCE_MS = 400;

export interface PriceQuery {
  q: string;
  entityType: PriceEntityType | 'ALL';
  componentType: string;
  model: string;
  page: number;
}

interface ListState {
  rows: AdminPriceRow[];
  total: number;
  page: number;
  totalPages: number;
}

const ENTITY_FILTER_OPTIONS: { value: PriceEntityType | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'COMPONENT', label: 'Комплектующие' },
  { value: 'ACCESSORY', label: 'Аксессуары' },
];

function buildQueryString(query: PriceQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.entityType !== 'ALL') params.set('entityType', query.entityType);
  if (query.componentType) params.set('componentType', query.componentType);
  if (query.model) params.set('model', query.model);
  if (query.page > 1) params.set('page', String(query.page));
  return params.toString();
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

/** "1000 × 400 × 2000 мм" from whichever dimensions the row actually has. */
function describeVariant(row: AdminPriceRow): string {
  const dimensions = [row.width, row.depth, row.height].filter((value): value is number => value !== null);
  const parts: string[] = [];
  if (dimensions.length > 0) parts.push(`${dimensions.join(' × ')} мм`);
  if (row.loadCapacity !== null) parts.push(`${row.loadCapacity} кг`);
  if (row.variant) parts.push(row.variant);
  if (row.shelfType) parts.push(row.shelfType);
  return parts.join(', ');
}

function describeModels(row: AdminPriceRow, modelNames: Map<string, string>): string {
  if (row.models.length === 0) return 'Все модели';
  return row.models.map((slug) => modelNames.get(slug) ?? slug).join(', ');
}

function StatusBadges({ row }: { row: AdminPriceRow }) {
  if (row.active && row.inStock) return null;
  return (
    <span className="ml-2 inline-flex gap-1 align-middle">
      {!row.active && <Badge tone="danger">Отключено</Badge>}
      {!row.inStock && <Badge tone="neutral">Нет в наличии</Badge>}
    </span>
  );
}

export function AdminPrices({
  models,
  initialQuery,
}: {
  models: { slug: string; name: string }[];
  initialQuery: PriceQuery;
}) {
  const [query, setQuery] = useState<PriceQuery>(initialQuery);
  const [searchInput, setSearchInput] = useState(initialQuery.q);
  const [list, setList] = useState<ListState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [editing, setEditing] = useState<AdminPriceRow | null>(null);
  const [historyFor, setHistoryFor] = useState<AdminPriceRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const modelNames = useMemo(
    () => new Map(models.map((model) => [model.slug, model.name])),
    [models],
  );

  /** Debounce the search box: a request per keystroke would hammer the API. */
  const isFirstSearchRender = useRef(true);
  useEffect(() => {
    if (isFirstSearchRender.current) {
      isFirstSearchRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      // A new search term always restarts at page 1 — page 7 of the previous
      // result set is meaningless for a different query.
      setQuery((current) => (current.q === searchInput ? current : { ...current, q: searchInput, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const queryString = buildQueryString(query);
        const response = await fetch(`/api/admin/prices${queryString ? `?${queryString}` : ''}`, {
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.location.href = '/admin/login';
          return;
        }
        if (response.status === 403) {
          setForbidden(true);
          return;
        }
        const result = await response.json();
        if (!result.ok) {
          setError(result.message ?? 'Не удалось загрузить цены.');
          return;
        }
        setList({
          rows: result.rows as AdminPriceRow[],
          total: result.total as number,
          page: result.page as number,
          totalPages: result.totalPages as number,
        });
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') return;
        setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [query, reloadToken]);

  /** The success confirmation is transient — it must not linger over a later,
   * unrelated row and read as if that one had just been saved. */
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Keep the address bar in step without triggering a navigation. */
  useEffect(() => {
    const queryString = buildQueryString(query);
    window.history.replaceState(null, '', queryString ? `?${queryString}` : window.location.pathname);
  }, [query]);

  const applyFilter = useCallback((patch: Partial<PriceQuery>) => {
    // Any filter change restarts at page 1 and reloads from the server.
    setQuery((current) => ({ ...current, ...patch, page: 1 }));
  }, []);

  const replaceRow = useCallback((updated: AdminPriceRow) => {
    setList((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === updated.id && row.entityType === updated.entityType ? updated : row,
            ),
          }
        : current,
    );
  }, []);

  /**
   * Re-reads one row from the server after a 409. Queries by its own SKU so the
   * answer does not depend on the row still being on the current page.
   */
  const reloadRow = useCallback(async (row: AdminPriceRow): Promise<AdminPriceRow | null> => {
    const params = new URLSearchParams({ q: row.sku, entityType: row.entityType });
    const response = await fetch(`/api/admin/prices?${params.toString()}`);
    if (response.status === 401) {
      window.location.href = '/admin/login';
      return null;
    }
    const result = await response.json();
    if (!result.ok) throw new Error(result.message ?? 'reload failed');
    const fresh = (result.rows as AdminPriceRow[]).find(
      (candidate) => candidate.id === row.id && candidate.entityType === row.entityType,
    );
    if (fresh) replaceRow(fresh);
    return fresh ?? null;
  }, [replaceRow]);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-lg border border-line bg-background p-6 text-center">
        <h1 className="font-display text-xl">Доступ запрещён</h1>
        <p className="mt-2 text-sm text-steel">Управление ценами доступно только администраторам.</p>
      </div>
    );
  }

  const rows = list?.rows ?? [];
  const showEmpty = !loading && !error && rows.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Цены</h1>
        {list && <p className="text-sm text-steel">Всего позиций: {list.total}</p>}
      </div>

      {notice && (
        <p role="status" className="border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3 border border-line bg-background p-3 sm:p-4">
        <label className="flex flex-col gap-1">
          <span className="tech-label">Поиск</span>
          <input
            type="search"
            name="search"
            autoComplete="off"
            className="input"
            placeholder="Поиск по SKU или названию"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="tech-label">Тип позиции</span>
            <select
              name="entityType"
              className="input"
              value={query.entityType}
              onChange={(event) => {
                const entityType = event.target.value as PriceEntityType | 'ALL';
                // A component-type filter cannot describe an accessory, so it
                // is dropped rather than silently returning nothing.
                applyFilter({
                  entityType,
                  ...(entityType === 'ACCESSORY' ? { componentType: '' } : {}),
                });
              }}
            >
              {ENTITY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="tech-label">Вид комплектующего</span>
            <select
              name="componentType"
              className="input"
              value={query.componentType}
              disabled={query.entityType === 'ACCESSORY'}
              onChange={(event) => applyFilter({ componentType: event.target.value })}
            >
              <option value="">Все виды</option>
              {COMPONENT_TYPE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {COMPONENT_TYPE_LABEL_RU[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="tech-label">Модель</span>
            <select
              name="model"
              className="input"
              value={query.model}
              onChange={(event) => applyFilter({ model: event.target.value })}
            >
              <option value="">Все модели</option>
              {models.map((model) => (
                <option key={model.slug} value={model.slug}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border border-danger bg-danger-soft px-3 py-3">
          <p className="text-sm text-danger">{error}</p>
          <Button type="button" variant="outline" size="md" onClick={() => setReloadToken((n) => n + 1)}>
            Повторить
          </Button>
        </div>
      )}

      {loading && (
        <p role="status" className="border border-line bg-background px-3 py-8 text-center text-sm text-steel">
          Загружаем цены…
        </p>
      )}

      {showEmpty && (
        <p className="border border-line bg-background px-3 py-8 text-center text-sm text-steel">
          Ничего не найдено
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          {/* Desktop: the full table. */}
          <div className="hidden overflow-x-auto border border-line bg-background lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left">
                  <th className="px-3 py-2 font-normal tech-label">SKU</th>
                  <th className="px-3 py-2 font-normal tech-label">Название</th>
                  <th className="px-3 py-2 font-normal tech-label">Тип</th>
                  <th className="px-3 py-2 font-normal tech-label">Размер / вариант</th>
                  <th className="px-3 py-2 font-normal tech-label">Модель</th>
                  <th className="px-3 py-2 font-normal tech-label">Цена продажи</th>
                  <th className="px-3 py-2 font-normal tech-label">Закупочная цена</th>
                  <th className="px-3 py-2 font-normal tech-label">Последнее изменение</th>
                  <th className="px-3 py-2 font-normal tech-label">Действие</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.entityType}:${row.id}`}
                    data-testid="price-row"
                    data-sku={row.sku}
                    className="border-b border-line last:border-0 hover:bg-surface-muted"
                  >
                    <td className="px-3 py-2 mono whitespace-nowrap">{row.sku}</td>
                    <td className="px-3 py-2">
                      {row.name}
                      <StatusBadges row={row} />
                    </td>
                    <td className="px-3 py-2">
                      {componentTypeLabel(row.componentType) ?? PRICE_ENTITY_LABEL_RU[row.entityType]}
                    </td>
                    <td className="px-3 py-2 mono text-xs">{describeVariant(row) || '—'}</td>
                    <td className="px-3 py-2 text-xs">{describeModels(row, modelNames)}</td>
                    <td className="px-3 py-2 mono whitespace-nowrap" data-testid="selling-price">
                      {formatPriceKzt(row.sellingPrice)}
                    </td>
                    <td className="px-3 py-2 mono whitespace-nowrap text-steel" data-testid="purchase-price">
                      {formatPriceKzt(row.purchasePrice)}
                    </td>
                    <td className="px-3 py-2 mono whitespace-nowrap text-xs text-steel">
                      {formatDateTime(row.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(row)}>
                          Изменить
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryFor(row)}>
                          История
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tablet and phone: one card per position — an 9-column table is
              unreadable at 390px, and every action must stay reachable. */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {rows.map((row) => (
              <li
                key={`${row.entityType}:${row.id}`}
                data-testid="price-card"
                data-sku={row.sku}
                className="border border-line bg-background p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="mono text-xs text-steel">{row.sku}</span>
                  <span className="tech-label">
                    {componentTypeLabel(row.componentType) ?? PRICE_ENTITY_LABEL_RU[row.entityType]}
                  </span>
                </div>
                <p className="mt-1">
                  {row.name}
                  <StatusBadges row={row} />
                </p>
                {describeVariant(row) && (
                  <p className="mono mt-1 text-xs text-steel">{describeVariant(row)}</p>
                )}
                <p className="mt-1 text-xs text-steel">{describeModels(row, modelNames)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
                  <div>
                    <dt className="tech-label">Цена продажи</dt>
                    <dd className="mono" data-testid="selling-price">
                      {formatPriceKzt(row.sellingPrice)}
                    </dd>
                  </div>
                  <div>
                    <dt className="tech-label">Закупочная цена</dt>
                    <dd className="mono text-steel" data-testid="purchase-price">
                      {formatPriceKzt(row.purchasePrice)}
                    </dd>
                  </div>
                </dl>
                <p className="mono mt-2 text-xs text-steel">Изменено: {formatDateTime(row.updatedAt)}</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="md"
                    variant="outline"
                    className="min-h-11 flex-1"
                    onClick={() => setEditing(row)}
                  >
                    Изменить
                  </Button>
                  <Button
                    type="button"
                    size="md"
                    variant="ghost"
                    className="min-h-11 flex-1"
                    onClick={() => setHistoryFor(row)}
                  >
                    История
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {list && list.totalPages > 1 && (
        <nav aria-label="Страницы" className="flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-11"
            disabled={query.page <= 1 || loading}
            onClick={() => setQuery((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
          >
            ← Назад
          </Button>
          <span className="tech-label text-steel">
            Стр. {list.page} из {list.totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="min-h-11"
            disabled={query.page >= list.totalPages || loading}
            onClick={() =>
              setQuery((current) => ({ ...current, page: Math.min(list.totalPages, current.page + 1) }))
            }
          >
            Вперёд →
          </Button>
        </nav>
      )}

      {editing && (
        <PriceEditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onReloadRow={reloadRow}
          onSaved={(updated, message) => {
            replaceRow(updated);
            setEditing(null);
            setNotice(message);
          }}
        />
      )}

      {historyFor && <PriceHistoryPanel row={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}
