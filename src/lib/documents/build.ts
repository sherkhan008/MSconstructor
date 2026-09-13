import { CUSTOMER_TYPE_FULL_LABEL_RU } from '@/lib/orders/customer-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders/payment-methods';
import type { PaymentPreference } from '@/lib/types/domain';
import { ORDER_DOCUMENT_TITLE_RU, type OrderDocumentKind } from './kinds';
import { amountInWordsRu, toTiyn, type Tiyn } from './money';
import type { OrderDocumentSource, OrderDocumentSourceItem } from './order-source';
import type { SellerDetails } from './seller';
import {
  parseOrderBuyerSnapshot,
  parseOrderItemDocumentSnapshot,
  type OrderBuyerSnapshot,
  type OrderItemDocumentSnapshot,
} from './snapshots';

/**
 * Persisted order + issuance → document model. Pure functions, no I/O.
 *
 * Everything customer-visible comes from what was frozen when the order was
 * placed (Order.buyerSnapshot, OrderItem.documentSnapshot, the configuration
 * JSON and the Decimal order columns) or when the document was first issued
 * (number, date, seller). Nothing is read from today's Customer row, catalog,
 * pricing settings or SELLER_* environment here.
 *
 * Amounts are never priced, re-priced, re-rounded or derived from a rate.
 * Every printed line is a persisted order-time amount with
 * quantity × unit price = amount holding exactly; services (assembly,
 * delivery) are their own lines and a discount is its own totals row, so the
 * document visibly adds up. The only other arithmetic is consistency checks
 * against the persisted columns: a self-contradictory order is refused
 * (DocumentIntegrityError), never "fixed".
 */

export class DocumentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentIntegrityError';
  }
}

/** The order predates document snapshots: the order-time facts a document
 * needs were never stored, and today's data must not stand in for them. */
export class DocumentUnavailableError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message);
    this.name = 'DocumentUnavailableError';
  }
}

export const LEGACY_ORDER_MESSAGE =
  'Заказ оформлен до того, как система начала сохранять исторические данные для документов. ' +
  'Документ по нему не формируется: подставлять текущие данные клиента, каталога или цен вместо данных на момент заказа нельзя.';

export interface DocumentField {
  label: string;
  value: string;
}

export interface DocumentKitLine {
  name: string;
  quantity: number;
}

/** One configured shelving unit of the order — the descriptive part. */
export interface DocumentItem {
  index: number;
  /** Number of this item's goods row in `lines`. */
  lineIndex: number;
  title: string;
  /** One-paragraph description (the goods row of the table). */
  description: string;
  specs: DocumentField[];
  /** Customer-facing kit composition (name + quantity only). */
  kit: DocumentKitLine[];
  quantity: number;
  unit: string;
  unitPrice: Tiyn;
  goodsAmount: Tiyn;
}

/** A priced table row. Invariant: unitPrice × quantity === amount. */
export interface DocumentLine {
  index: number;
  kind: 'goods' | 'assembly' | 'delivery';
  description: string;
  quantity: number;
  unit: string;
  unitPrice: Tiyn;
  amount: Tiyn;
}

export interface DocumentTotals {
  /** True: line prices and amounts include VAT. False: they exclude it. */
  pricesIncludeVat: boolean;
  vatPercent: number;
  /** Σ line amounts, on the basis above. */
  lines: Tiyn;
  discount: Tiyn;
  net: Tiyn;
  vat: Tiyn;
  grand: Tiyn;
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

/** Everything a document shows that belongs to the order itself. */
export interface OrderDocumentContent {
  orderNumber: string;
  orderDateText: string;
  buyer: DocumentBuyer;
  items: DocumentItem[];
  lines: DocumentLine[];
  totals: DocumentTotals;
  grandTotalInWords: string;
  paymentMethod?: string;
  delivery: DocumentField[];
}

/** What the first issuance froze (OrderDocument row). */
export interface DocumentIssuance {
  number: string;
  issuedAt: Date;
  brandName: string;
  seller: SellerDetails;
}

export interface OrderDocumentModel extends OrderDocumentContent {
  kind: OrderDocumentKind;
  title: string;
  number: string;
  dateText: string;
  /** The persisted issuance instant — also the PDF CreationDate, so repeated
   * generation of an issued document is byte-for-byte identical. */
  issuedAt: Date;
  brandName: string;
  seller: SellerDetails;
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
  height: number;
  depth: number;
  shelves: number;
  loadCapacity?: number;
  sections: PersistedSection[];
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
  return {
    height: c.height,
    depth: c.depth,
    shelves: c.shelves,
    loadCapacity: isPositiveInt(c.loadCapacity) ? c.loadCapacity : undefined,
    sections,
  };
}

function wallsText(section: PersistedSection): string | undefined {
  const walls = [section.rearWall && 'задняя', section.leftWall && 'левая', section.rightWall && 'правая'].filter(
    (w): w is string => Boolean(w),
  );
  return walls.length > 0 ? walls.join(', ') : undefined;
}

interface ItemPricing {
  pricesIncludeVat: boolean;
  vatPercent: number;
  unitPrice: Tiyn;
  goods: Tiyn;
  assembly: Tiyn;
  delivery: Tiyn | null;
  discount: Tiyn;
  net: Tiyn;
  vat: Tiyn;
  total: Tiyn;
}

/** The order-time breakdown, checked against itself and against the
 * persisted OrderItem columns. */
function readItemPricing(item: OrderDocumentSourceItem, snapshot: OrderItemDocumentSnapshot, index: number): ItemPricing {
  const fail = (what: string) => new DocumentIntegrityError(`Позиция ${index}: ${what}.`);
  const p = snapshot.pricing;
  const pricing: ItemPricing = {
    pricesIncludeVat: p.pricesIncludeVat,
    vatPercent: p.vatPercent,
    unitPrice: toTiyn(p.unitPrice),
    goods: toTiyn(p.goodsAmount),
    assembly: toTiyn(p.assembly),
    delivery: p.delivery === null ? null : toTiyn(p.delivery),
    discount: toTiyn(p.discount),
    net: toTiyn(p.net),
    vat: toTiyn(p.vat),
    total: toTiyn(p.total),
  };
  const amounts = [pricing.unitPrice, pricing.goods, pricing.assembly, pricing.delivery ?? 0n, pricing.discount, pricing.net, pricing.vat, pricing.total];
  if (amounts.some((a) => a < 0n)) throw fail('отрицательная сумма');

  if (p.quantity !== item.quantity) throw fail('количество в снимке не совпадает с сохранённым количеством');
  if (pricing.unitPrice !== toTiyn(item.unitNetPrice)) throw fail('цена в снимке не совпадает с сохранённой ценой позиции');
  if (pricing.net !== toTiyn(item.totalNetPrice)) throw fail('сумма без НДС в снимке не совпадает с сохранённой суммой позиции');
  if (pricing.unitPrice * BigInt(item.quantity) !== pricing.goods) throw fail('цена × количество не равно стоимости товара');

  const base = pricing.goods + pricing.assembly + (pricing.delivery ?? 0n) - pricing.discount;
  if (base < 0n) throw fail('скидка превышает стоимость позиции');
  if (pricing.pricesIncludeVat) {
    if (pricing.total !== base || pricing.net + pricing.vat !== pricing.total) {
      throw fail('разбивка цены (с НДС) не сходится с итогом позиции');
    }
  } else if (pricing.net !== base || pricing.net + pricing.vat !== pricing.total) {
    throw fail('разбивка цены (без НДС) не сходится с итогом позиции');
  }
  return pricing;
}

function buildItem(
  item: OrderDocumentSourceItem,
  snapshot: OrderItemDocumentSnapshot,
  index: number,
): { item: DocumentItem; pricing: ItemPricing } {
  const config = readConfiguration(item.configuration, index);
  if (!isPositiveInt(item.quantity)) {
    throw new DocumentIntegrityError(`Позиция ${index}: некорректное количество.`);
  }
  const pricing = readItemPricing(item, snapshot, index);

  const modelName = cleanText(snapshot.modelName, 120);
  const colorName = optionalText(snapshot.colorName, 120);
  const assemblyName = optionalText(snapshot.assemblyName, 120);
  const deliveryName = optionalText(snapshot.deliveryName, 120);
  const options = snapshot.options.map((o) => cleanText(o, 120)).filter(Boolean);

  const totalWidth = config.sections.reduce((sum, s) => sum + s.width, 0);
  const sectionWidths = config.sections.map((s) => s.width).join(' + ');
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
    item: {
      index,
      lineIndex: 0,
      title: `Стеллаж ${modelName}`,
      description: `Стеллаж ${modelName}: ${descriptionParts.join('; ')}`,
      specs,
      kit: snapshot.kit.map((line) => ({ name: cleanText(line.name, 200), quantity: line.quantity })),
      quantity: item.quantity,
      unit: 'компл.',
      unitPrice: pricing.unitPrice,
      goodsAmount: pricing.goods,
    },
    pricing,
  };
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

function buildBuyer(snapshot: OrderBuyerSnapshot): DocumentBuyer {
  const isLegalEntity = snapshot.type === 'LEGAL_ENTITY';
  const fullName = cleanText(snapshot.fullName, 200);
  const companyName = optionalText(snapshot.companyName, 300);
  return {
    typeLabel: CUSTOMER_TYPE_FULL_LABEL_RU[snapshot.type],
    isLegalEntity,
    name: isLegalEntity && companyName ? companyName : fullName,
    contactPerson: isLegalEntity && companyName ? fullName : undefined,
    idLabel: isLegalEntity ? 'БИН' : 'ИИН',
    binIin: optionalText(snapshot.binIin, 20),
    phone: cleanText(snapshot.phone, 40),
    email: optionalText(snapshot.email, 200),
    city: optionalText(snapshot.city, 120),
  };
}

/** Order-specific delivery columns, written at checkout. */
function buildDelivery(source: OrderDocumentSource): DocumentField[] {
  const fields: DocumentField[] = [];
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

/** Why documents for this order cannot be produced from order-time data, or
 * an empty list when the snapshots exist. Absent ≠ malformed: a snapshot
 * that exists but does not parse is an integrity problem, not a legacy order. */
function legacyGaps(source: OrderDocumentSource): string[] {
  const gaps: string[] = [];
  if (source.buyerSnapshot === null || source.buyerSnapshot === undefined) {
    gaps.push('Не сохранены данные покупателя на момент заказа.');
  }
  const missingItems = source.items.filter((item) => item.documentSnapshot === null || item.documentSnapshot === undefined).length;
  if (missingItems > 0) {
    gaps.push(
      `Не сохранены наименования, комплектация и разбивка цены на момент заказа (позиций без снимка: ${missingItems} из ${source.items.length}).`,
    );
  }
  return gaps;
}

/**
 * Validates the persisted order and projects everything a document shows
 * about it. Throws DocumentUnavailableError for a pre-snapshot order,
 * DocumentIntegrityError / DocumentAmountError for contradictory data.
 * Called before a document is issued, so an order that cannot produce a
 * truthful document never receives a document number.
 */
export function buildOrderDocumentContent(source: OrderDocumentSource): OrderDocumentContent {
  if (source.items.length === 0) {
    throw new DocumentIntegrityError('В заказе нет позиций.');
  }
  const gaps = legacyGaps(source);
  if (gaps.length > 0) throw new DocumentUnavailableError(LEGACY_ORDER_MESSAGE, gaps);

  const buyerSnapshot = parseOrderBuyerSnapshot(source.buyerSnapshot);
  if (!buyerSnapshot) throw new DocumentIntegrityError('Сохранённый снимок данных покупателя повреждён.');

  const built = source.items.map((item, i) => {
    const snapshot = parseOrderItemDocumentSnapshot(item.documentSnapshot);
    if (!snapshot) throw new DocumentIntegrityError(`Позиция ${i + 1}: сохранённый снимок позиции повреждён.`);
    return { ...buildItem(item, snapshot, i + 1), snapshot };
  });

  const { pricesIncludeVat, vatPercent } = built[0].pricing;
  if (built.some(({ pricing }) => pricing.pricesIncludeVat !== pricesIncludeVat || pricing.vatPercent !== vatPercent)) {
    throw new DocumentIntegrityError('Позиции заказа рассчитаны по разным правилам НДС.');
  }

  const lines: DocumentLine[] = [];
  const items: DocumentItem[] = [];
  for (const { item, pricing, snapshot } of built) {
    const goodsLine: DocumentLine = {
      index: lines.length + 1,
      kind: 'goods',
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: pricing.unitPrice,
      amount: pricing.goods,
    };
    lines.push(goodsLine);
    items.push({ ...item, lineIndex: goodsLine.index });

    const assemblyName = optionalText(snapshot.assemblyName, 120);
    if (pricing.assembly > 0n) {
      lines.push({
        index: lines.length + 1,
        kind: 'assembly',
        description: `Услуга сборки${assemblyName ? `: ${assemblyName}` : ''} (к поз. ${goodsLine.index})`,
        quantity: 1,
        unit: 'усл.',
        unitPrice: pricing.assembly,
        amount: pricing.assembly,
      });
    }
    const deliveryName = optionalText(snapshot.deliveryName, 120);
    if (pricing.delivery !== null && pricing.delivery > 0n) {
      lines.push({
        index: lines.length + 1,
        kind: 'delivery',
        description: `Доставка${deliveryName ? `: ${deliveryName}` : ''} (к поз. ${goodsLine.index})`,
        quantity: 1,
        unit: 'усл.',
        unitPrice: pricing.delivery,
        amount: pricing.delivery,
      });
    }
  }
  for (const line of lines) {
    // The table invariant, asserted rather than assumed.
    if (line.unitPrice * BigInt(line.quantity) !== line.amount) {
      throw new DocumentIntegrityError(`Строка ${line.index}: цена × количество не равно сумме.`);
    }
  }

  const sum = (pick: (p: ItemPricing) => Tiyn) => built.reduce((acc, b) => acc + pick(b.pricing), 0n);
  const totals: DocumentTotals = {
    pricesIncludeVat,
    vatPercent,
    lines: lines.reduce((acc, line) => acc + line.amount, 0n),
    discount: sum((p) => p.discount),
    net: sum((p) => p.net),
    vat: sum((p) => p.vat),
    grand: sum((p) => p.total),
  };

  const net = toTiyn(source.netTotal);
  const vat = toTiyn(source.vatTotal);
  const discount = toTiyn(source.discountTotal);
  const grand = toTiyn(source.grandTotal);
  if (net < 0n || vat < 0n || discount < 0n || grand < 0n) {
    throw new DocumentIntegrityError('Итоговые суммы заказа содержат отрицательное значение.');
  }
  if (totals.net !== net) throw new DocumentIntegrityError('Сумма позиций не совпадает с сохранённой суммой заказа без НДС.');
  if (totals.vat !== vat) throw new DocumentIntegrityError('НДС позиций не совпадает с сохранённым НДС заказа.');
  if (totals.discount !== discount) throw new DocumentIntegrityError('Скидки позиций не совпадают с сохранённой скидкой заказа.');
  if (totals.grand !== grand || net + vat !== grand) {
    throw new DocumentIntegrityError('Сохранённые суммы заказа не согласованы: сумма без НДС и НДС не равны итогу.');
  }
  if (totals.lines - totals.discount !== (pricesIncludeVat ? grand : net)) {
    throw new DocumentIntegrityError('Строки документа за вычетом скидки не равны итогу заказа.');
  }

  return {
    orderNumber: cleanText(source.orderNumber, 60),
    orderDateText: formatDocumentDate(source.createdAt),
    buyer: buildBuyer(buyerSnapshot),
    items,
    lines,
    totals,
    grandTotalInWords: amountInWordsRu(grand),
    paymentMethod:
      PAYMENT_METHOD_LABEL[source.paymentPreference as PaymentPreference] ?? optionalText(source.paymentPreference, 60),
    delivery: buildDelivery(source),
  };
}

/** Joins validated order content with its persisted issuance. */
export function buildOrderDocument(
  kind: OrderDocumentKind,
  content: OrderDocumentContent,
  issuance: DocumentIssuance,
): OrderDocumentModel {
  return {
    ...content,
    kind,
    title: ORDER_DOCUMENT_TITLE_RU[kind],
    number: cleanText(issuance.number, 100),
    dateText: formatDocumentDate(issuance.issuedAt),
    issuedAt: issuance.issuedAt,
    brandName: cleanText(issuance.brandName, 200),
    seller: issuance.seller,
  };
}
