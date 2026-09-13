import { site } from '@/lib/config/site';
import { METAL_FOOT_PAD_LABEL, SHELF_CORNER_BRACKETS_LABEL } from '@/lib/configurator/additional-options';
import { CUSTOMER_TYPE_FULL_LABEL_RU } from '@/lib/orders/customer-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import { toPublicBom } from '@/lib/pricing/bom';
import type { BomLine, CustomerType, PaymentPreference } from '@/lib/types/domain';
import { ORDER_DOCUMENT_TITLE_RU, orderDocumentNumber, type OrderDocumentKind } from './kinds';
import { amountInWordsRu, toTiyn, type Tiyn } from './money';
import type { OrderDocumentSource, OrderDocumentSourceItem } from './order-source';
import type { SellerDetails } from './seller';

/**
 * Order snapshot → document model. A pure function.
 *
 * Every amount in the result is a persisted value read through toTiyn():
 * OrderItem.unitNetPrice / totalNetPrice and Order.netTotal / vatTotal /
 * discountTotal / grandTotal. Nothing is priced, re-priced, re-rounded or
 * derived from a rate — there is no catalog price, markup, VAT percent or
 * pricing-engine call anywhere on this path. The only arithmetic is a
 * consistency check (lines add up to netTotal, netTotal + VAT = grandTotal),
 * which refuses to print a self-contradictory document rather than "fixing"
 * any number.
 *
 * `labels` only turns persisted ids into Russian names (model, colour,
 * assembly, delivery) — presentation, the same lookup the admin order page
 * does — and never contributes an amount.
 */

export interface DocumentLabels {
  modelName(slug: string): string | undefined;
  colorName(id: string): string | undefined;
  assemblyName(id: string): string | undefined;
  deliveryName(id: string): string | undefined;
}

export const NO_LABELS: DocumentLabels = {
  modelName: () => undefined,
  colorName: () => undefined,
  assemblyName: () => undefined,
  deliveryName: () => undefined,
};

export class DocumentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentIntegrityError';
  }
}

export interface DocumentField {
  label: string;
  value: string;
}

export interface DocumentKitLine {
  name: string;
  quantity: number;
}

export interface DocumentItem {
  index: number;
  title: string;
  /** One-paragraph description for a table row (invoice, KP summary). */
  description: string;
  specs: DocumentField[];
  /** Customer-facing kit composition (name + quantity only). */
  kit: DocumentKitLine[];
  quantity: number;
  unit: string;
  unitPrice: Tiyn;
  amount: Tiyn;
  /** True when the persisted line total is not unit price × quantity — the
   * engine folds the item's assembly, delivery and discount into the line
   * total, and the snapshot does not store that split. */
  amountIncludesAdjustments: boolean;
}

export interface DocumentBuyer {
  typeLabel: string;
  isLegalEntity: boolean;
  name: string;
  contactPerson?: string;
  idLabel: string;
  binIin?: string;
  phone: string;
  email?: string;
  city?: string;
}

export interface OrderDocumentModel {
  kind: OrderDocumentKind;
  title: string;
  number: string;
  dateText: string;
  /** The order's creation instant — also the PDF CreationDate, so repeated
   * generation is byte-for-byte identical. */
  issuedAt: Date;
  orderNumber: string;
  brandName: string;
  seller: SellerDetails;
  buyer: DocumentBuyer;
  items: DocumentItem[];
  totals: { net: Tiyn; discount: Tiyn; vat: Tiyn; grand: Tiyn };
  grandTotalInWords: string;
  paymentMethod?: string;
  delivery: DocumentField[];
}

/* -------------------------------------------------------------------------- */
/* Text hygiene                                                                */
/* -------------------------------------------------------------------------- */

// C0/C1 control characters and Unicode bidi overrides/isolates: invisible,
// and the bidi ones can visually reorder a printed amount or name.
const UNSAFE_CHARS = new RegExp('[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]', 'g');

/** Plain, single-line, length-capped text. Documents are drawn as PDF text
 * objects, never parsed as HTML/markup, so this is not escaping — it keeps a
 * customer-typed value from carrying invisible characters or growing a table
 * row past a page. */
export function cleanText(value: unknown, max = 300): string {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function optionalText(value: unknown, max?: number): string | undefined {
  const text = cleanText(value, max);
  return text.length > 0 ? text : undefined;
}

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Almaty',
});

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Almaty',
});

/** "30 августа 2026 г." in Kazakhstan time, whatever the server's zone. */
export function formatDocumentDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

interface PersistedSection {
  width: number;
  rearWall?: boolean;
  leftWall?: boolean;
  rightWall?: boolean;
}

interface PersistedConfiguration {
  modelSlug: string;
  height: number;
  depth: number;
  shelves: number;
  loadCapacity?: number;
  colorId?: string;
  assemblyId?: string;
  deliveryId?: string;
  sections: PersistedSection[];
  metalFootPad?: boolean;
  shelfCornerBrackets?: boolean;
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

function readConfiguration(raw: unknown, index: number): PersistedConfiguration {
  const fail = () => new DocumentIntegrityError(`Позиция ${index}: сохранённая конфигурация не распознана.`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail();
  const c = raw as Record<string, unknown>;
  if (typeof c.modelSlug !== 'string' || !isPositiveInt(c.height) || !isPositiveInt(c.depth) || !isPositiveInt(c.shelves)) {
    throw fail();
  }
  if (!Array.isArray(c.sections) || c.sections.length === 0) throw fail();
  const sections = c.sections.map((s) => {
    if (!s || typeof s !== 'object' || !isPositiveInt((s as PersistedSection).width)) throw fail();
    const section = s as PersistedSection;
    return {
      width: section.width,
      rearWall: section.rearWall === true,
      leftWall: section.leftWall === true,
      rightWall: section.rightWall === true,
    };
  });
  const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    modelSlug: c.modelSlug,
    height: c.height,
    depth: c.depth,
    shelves: c.shelves,
    loadCapacity: isPositiveInt(c.loadCapacity) ? c.loadCapacity : undefined,
    colorId: str(c.colorId),
    assemblyId: str(c.assemblyId),
    deliveryId: str(c.deliveryId),
    sections,
    metalFootPad: c.metalFootPad === true,
    shelfCornerBrackets: c.shelfCornerBrackets === true,
  };
}

/** The customer-facing kit, through the same projection the configurator
 * uses (toPublicBom): for one-piece-assembly models the structural parts a
 * customer never orders separately are folded away. Only name and quantity
 * survive — the snapshot's component prices are never printed, since they
 * sit below the markup. A malformed snapshot yields no kit rather than a
 * guessed one. */
function readKit(raw: unknown, modelSlug: string): DocumentKitLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: BomLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return [];
    const line = entry as Partial<BomLine>;
    if (typeof line.name !== 'string' || typeof line.type !== 'string' || !isPositiveInt(line.quantity)) return [];
    lines.push({
      componentId: String(line.componentId ?? ''),
      sku: String(line.sku ?? ''),
      type: line.type,
      name: line.name,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice) || 0,
      totalPrice: Number(line.totalPrice) || 0,
      weightKg: Number(line.weightKg) || 0,
    });
  }
  return toPublicBom(lines, modelSlug).map((line) => ({ name: cleanText(line.name, 200), quantity: line.quantity }));
}

function wallsText(section: PersistedSection): string | undefined {
  const walls = [section.rearWall && 'задняя', section.leftWall && 'левая', section.rightWall && 'правая'].filter(
    (w): w is string => Boolean(w),
  );
  return walls.length > 0 ? walls.join(', ') : undefined;
}

function buildItem(item: OrderDocumentSourceItem, index: number, labels: DocumentLabels): DocumentItem {
  const config = readConfiguration(item.configuration, index);
  if (!isPositiveInt(item.quantity)) {
    throw new DocumentIntegrityError(`Позиция ${index}: некорректное количество.`);
  }

  const unitPrice = toTiyn(item.unitNetPrice);
  const amount = toTiyn(item.totalNetPrice);
  if (unitPrice < 0n || amount < 0n) {
    throw new DocumentIntegrityError(`Позиция ${index}: отрицательная сумма.`);
  }

  const modelName = cleanText(labels.modelName(config.modelSlug) ?? config.modelSlug, 120);
  const colorName = config.colorId ? optionalText(labels.colorName(config.colorId), 120) : undefined;
  const assemblyName = config.assemblyId ? optionalText(labels.assemblyName(config.assemblyId), 120) : undefined;
  const deliveryName = config.deliveryId ? optionalText(labels.deliveryName(config.deliveryId), 120) : undefined;

  const totalWidth = config.sections.reduce((sum, s) => sum + s.width, 0);
  const sectionWidths = config.sections.map((s) => s.width).join(' + ');
  const options = [config.metalFootPad && METAL_FOOT_PAD_LABEL, config.shelfCornerBrackets && SHELF_CORNER_BRACKETS_LABEL].filter(
    (v): v is string => Boolean(v),
  );
  const anyWalls = config.sections.some((s) => wallsText(s));
  const wallsSummary = anyWalls
    ? config.sections
        .map((s, i) => `${config.sections.length > 1 ? `секция ${i + 1}: ` : ''}${wallsText(s) ?? 'без стенок'}`)
        .join('; ')
    : undefined;

  const specs: DocumentField[] = [
    { label: 'Модель', value: modelName },
    { label: 'Высота', value: `${config.height} мм` },
    { label: 'Ширина', value: `${totalWidth} мм` },
    { label: 'Глубина', value: `${config.depth} мм` },
    { label: 'Секций', value: String(config.sections.length) },
    { label: config.sections.length > 1 ? 'Ширина секций' : 'Ширина секции', value: `${sectionWidths} мм` },
    { label: 'Полок', value: String(config.shelves) },
  ];
  if (config.loadCapacity) specs.push({ label: 'Нагрузка на полку', value: `до ${config.loadCapacity} кг` });
  if (colorName) specs.push({ label: 'Цвет', value: colorName });
  if (wallsSummary) specs.push({ label: 'Стенки', value: wallsSummary });
  if (options.length > 0) specs.push({ label: 'Дополнительно', value: options.join(', ') });
  if (assemblyName) specs.push({ label: 'Сборка', value: assemblyName });
  if (deliveryName) specs.push({ label: 'Доставка', value: deliveryName });

  const descriptionParts = [
    `В×Ш×Г ${config.height}×${totalWidth}×${config.depth} мм`,
    config.sections.length > 1 ? `секций: ${config.sections.length} (${sectionWidths} мм)` : 'секций: 1',
    `полок: ${config.shelves}`,
    config.loadCapacity ? `нагрузка на полку до ${config.loadCapacity} кг` : undefined,
    colorName ? `цвет: ${colorName}` : undefined,
    wallsSummary ? `стенки: ${wallsSummary}` : undefined,
    options.length > 0 ? options.join(', ').toLowerCase() : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    index,
    title: `Стеллаж ${modelName}`,
    description: `Стеллаж ${modelName}: ${descriptionParts.join('; ')}`,
    specs,
    kit: readKit(item.bomSnapshot, config.modelSlug),
    quantity: item.quantity,
    unit: 'компл.',
    unitPrice,
    amount,
    amountIncludesAdjustments: unitPrice * BigInt(item.quantity) !== amount,
  };
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

function buildBuyer(customer: OrderDocumentSource['customer']): DocumentBuyer {
  const isLegalEntity = customer.type === 'LEGAL_ENTITY';
  const fullName = cleanText(customer.fullName, 200);
  const companyName = optionalText(customer.companyName, 300);
  const typeLabel = CUSTOMER_TYPE_FULL_LABEL_RU[customer.type as CustomerType] ?? cleanText(customer.type, 40);
  return {
    typeLabel,
    isLegalEntity,
    name: isLegalEntity && companyName ? companyName : fullName,
    contactPerson: isLegalEntity && companyName ? fullName : undefined,
    idLabel: isLegalEntity ? 'БИН' : 'ИИН',
    binIin: optionalText(customer.binIin, 20),
    phone: cleanText(customer.phone, 40),
    email: optionalText(customer.email, 200),
    city: optionalText(customer.city, 120),
  };
}

function buildDelivery(source: OrderDocumentSource, labels: DocumentLabels): DocumentField[] {
  const fields: DocumentField[] = [];
  const methodId = source.delivery.methodId ?? undefined;
  const methodName = methodId ? optionalText(labels.deliveryName(methodId), 120) : undefined;
  if (methodName) fields.push({ label: 'Способ доставки', value: methodName });
  const city = optionalText(source.delivery.city, 120);
  if (city) fields.push({ label: 'Город доставки', value: city });
  const address = optionalText(source.delivery.address, 500);
  if (address) fields.push({ label: 'Адрес доставки', value: address });
  const floor = optionalText(source.delivery.floor, 40);
  if (floor) fields.push({ label: 'Этаж', value: floor });
  if (source.delivery.hasLift !== null) fields.push({ label: 'Лифт', value: source.delivery.hasLift ? 'есть' : 'нет' });
  if (source.delivery.date) fields.push({ label: 'Дата доставки', value: SHORT_DATE_FORMAT.format(source.delivery.date) });
  return fields;
}

export function buildOrderDocument(
  kind: OrderDocumentKind,
  source: OrderDocumentSource,
  seller: SellerDetails,
  labels: DocumentLabels = NO_LABELS,
): OrderDocumentModel {
  if (source.items.length === 0) {
    throw new DocumentIntegrityError('В заказе нет позиций.');
  }

  const items = source.items.map((item, i) => buildItem(item, i + 1, labels));

  const net = toTiyn(source.netTotal);
  const vat = toTiyn(source.vatTotal);
  const discount = toTiyn(source.discountTotal);
  const grand = toTiyn(source.grandTotal);

  if (net < 0n || vat < 0n || discount < 0n || grand < 0n) {
    throw new DocumentIntegrityError('Итоговые суммы заказа содержат отрицательное значение.');
  }
  const linesTotal = items.reduce((sum, item) => sum + item.amount, 0n);
  if (linesTotal !== net) {
    throw new DocumentIntegrityError('Сумма позиций не совпадает с сохранённой суммой заказа без НДС.');
  }
  if (net + vat !== grand) {
    throw new DocumentIntegrityError('Сохранённые суммы заказа не согласованы: сумма без НДС и НДС не равны итогу.');
  }

  const orderNumber = cleanText(source.orderNumber, 60);
  const paymentMethod =
    PAYMENT_METHOD_LABEL[source.paymentPreference as PaymentPreference] ?? optionalText(source.paymentPreference, 60);

  return {
    kind,
    title: ORDER_DOCUMENT_TITLE_RU[kind],
    number: orderDocumentNumber(kind, orderNumber),
    dateText: formatDocumentDate(source.createdAt),
    issuedAt: source.createdAt,
    orderNumber,
    brandName: site.name,
    seller,
    buyer: buildBuyer(source.customer),
    items,
    totals: { net, discount, vat, grand },
    grandTotalInWords: amountInWordsRu(grand),
    paymentMethod,
    delivery: buildDelivery(source, labels),
  };
}
