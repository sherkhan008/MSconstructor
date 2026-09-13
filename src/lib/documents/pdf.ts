import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { DocumentField, DocumentItem, OrderDocumentModel } from './build';
import { formatAmount, formatAmountWithCurrency } from './money';

/**
 * Document model → A4 PDF, server-side, with pdfkit.
 *
 * Text is drawn as real PDF text in an embedded (subsetted) Noto Sans, so
 * Cyrillic, Kazakh letters and ₸ render and stay selectable/searchable. The
 * renderer never interprets its input as markup — there is no HTML step to
 * inject into — and it creates no links, actions or scripts.
 *
 * Layout is manual and explicit: every block measures itself before it is
 * drawn and moves to a new page when it does not fit, table headers repeat
 * on continuation pages, and page numbers are stamped once the page count is
 * known. The PDF CreationDate is the order's creation date, which makes
 * repeated generation of the same document byte-for-byte identical.
 */

const FONT_DIR = join(process.cwd(), 'assets', 'fonts', 'noto-sans');
let fontCache: { regular: Buffer; bold: Buffer } | null = null;

function fonts() {
  if (!fontCache) {
    fontCache = {
      regular: readFileSync(join(FONT_DIR, 'NotoSans-Regular.ttf')),
      bold: readFileSync(join(FONT_DIR, 'NotoSans-Bold.ttf')),
    };
  }
  return fontCache;
}

// Palette: the site's own tokens (src/app/globals.css) — foreground, steel,
// line, surface-muted and accent.
const INK = '#1c2024';
const MUTED = '#5b6470';
const LINE = '#d8dce0';
const SOFT = '#eceee9';
const ACCENT = '#f0a202';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { left: 42, right: 42, top: 44, bottom: 58 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const LINE_GAP = 1.5;

type FontName = 'regular' | 'bold';
type Align = 'left' | 'right' | 'center';

interface TextStyle {
  font?: FontName;
  size?: number;
  color?: string;
  align?: Align;
}

type Doc = InstanceType<typeof PDFDocument>;

class Writer {
  y = MARGIN.top;
  /** Redrawn at the top of every page after the first (continuation header). */
  private pageHeader: (() => void) | null = null;
  /** Redrawn after the page header while a table is being drawn. */
  private tableHeader: (() => void) | null = null;

  constructor(readonly doc: Doc) {}

  get bottom(): number {
    return PAGE.height - MARGIN.bottom;
  }

  setPageHeader(draw: () => void) {
    this.pageHeader = draw;
  }

  private apply(style: TextStyle) {
    this.doc
      .font(style.font === 'bold' ? 'bold' : 'regular')
      .fontSize(style.size ?? 9)
      .fillColor(style.color ?? INK);
  }

  measure(text: string, width: number, style: TextStyle = {}): number {
    if (!text) return 0;
    this.apply(style);
    return this.doc.heightOfString(text, { width, lineGap: LINE_GAP });
  }

  text(text: string, x: number, y: number, width: number, style: TextStyle = {}) {
    if (!text) return;
    this.apply(style);
    this.doc.text(text, x, y, { width, align: style.align ?? 'left', lineGap: LINE_GAP });
  }

  hLine(y: number, x1 = MARGIN.left, x2 = PAGE.width - MARGIN.right, color = LINE, width = 0.6) {
    this.doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.doc.save().rect(x, y, w, h).fill(fill).restore();
  }

  strokeRect(x: number, y: number, w: number, h: number, color = LINE) {
    this.doc.save().rect(x, y, w, h).lineWidth(0.6).strokeColor(color).stroke().restore();
  }

  newPage() {
    this.doc.addPage();
    this.y = MARGIN.top;
    this.pageHeader?.();
    this.tableHeader?.();
  }

  /** Starts a new page unless `height` still fits on this one. */
  ensure(height: number) {
    if (this.y + height > this.bottom) this.newPage();
  }

  gap(points: number) {
    this.y += points;
  }

  withTableHeader(draw: () => void, body: () => void) {
    this.tableHeader = draw;
    try {
      draw();
      body();
    } finally {
      this.tableHeader = null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Shared blocks                                                               */
/* -------------------------------------------------------------------------- */

interface Column {
  header: string;
  width: number;
  align: Align;
}

interface Cell {
  text: string;
  note?: string;
  bold?: boolean;
}

const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;
const TABLE_FONT = 8.5;

function cellHeight(w: Writer, cell: Cell, width: number): number {
  const inner = width - CELL_PAD_X * 2;
  const main = w.measure(cell.text, inner, { size: TABLE_FONT, font: cell.bold ? 'bold' : 'regular' });
  const note = cell.note ? w.measure(cell.note, inner, { size: 7.5 }) + 1 : 0;
  return main + note + CELL_PAD_Y * 2;
}

function drawTable(w: Writer, columns: Column[], rows: Cell[][], grid: boolean) {
  const headerHeight = Math.max(
    ...columns.map((c) => w.measure(c.header, c.width - CELL_PAD_X * 2, { size: 7.5, font: 'bold' })),
  ) + CELL_PAD_Y * 2;

  const drawHeader = () => {
    const y = w.y;
    w.rect(MARGIN.left, y, CONTENT_WIDTH, headerHeight, SOFT);
    let x = MARGIN.left;
    for (const column of columns) {
      w.text(column.header, x + CELL_PAD_X, y + CELL_PAD_Y, column.width - CELL_PAD_X * 2, {
        size: 7.5,
        font: 'bold',
        color: MUTED,
        align: column.align,
      });
      if (grid) w.strokeRect(x, y, column.width, headerHeight);
      x += column.width;
    }
    if (!grid) w.hLine(y + headerHeight, MARGIN.left, PAGE.width - MARGIN.right, INK, 0.8);
    w.y = y + headerHeight;
  };

  w.ensure(headerHeight + 40);
  w.withTableHeader(drawHeader, () => {
    for (const row of rows) {
      const height = Math.max(...row.map((cell, i) => cellHeight(w, cell, columns[i].width)));
      // A row is never split across pages; the header is redrawn above it.
      if (w.y + height > w.bottom) w.newPage();
      const y = w.y;
      let x = MARGIN.left;
      row.forEach((cell, i) => {
        const column = columns[i];
        const inner = column.width - CELL_PAD_X * 2;
        w.text(cell.text, x + CELL_PAD_X, y + CELL_PAD_Y, inner, {
          size: TABLE_FONT,
          font: cell.bold ? 'bold' : 'regular',
          align: column.align,
        });
        if (cell.note) {
          const mainHeight = w.measure(cell.text, inner, { size: TABLE_FONT, font: cell.bold ? 'bold' : 'regular' });
          w.text(cell.note, x + CELL_PAD_X, y + CELL_PAD_Y + mainHeight + 1, inner, { size: 7.5, color: MUTED });
        }
        if (grid) w.strokeRect(x, y, column.width, height);
        x += column.width;
      });
      if (!grid) w.hLine(y + height);
      w.y = y + height;
    }
  });
}

const ADJUSTMENT_NOTE = '* сумма включает услуги и скидки по позиции';

function itemRows(items: DocumentItem[]): Cell[][] {
  return items.map((item) => [
    { text: String(item.index) },
    { text: item.description, note: item.amountIncludesAdjustments ? ADJUSTMENT_NOTE : undefined },
    { text: String(item.quantity) },
    { text: item.unit },
    { text: formatAmount(item.unitPrice) },
    { text: `${formatAmount(item.amount)}${item.amountIncludesAdjustments ? '*' : ''}` },
  ]);
}

const ITEM_COLUMNS: Column[] = [
  { header: '№', width: 24, align: 'center' },
  { header: 'Наименование', width: CONTENT_WIDTH - 24 - 42 - 42 - 86 - 90, align: 'left' },
  { header: 'Кол-во', width: 42, align: 'right' },
  { header: 'Ед.', width: 42, align: 'center' },
  { header: 'Цена, ₸', width: 86, align: 'right' },
  { header: 'Сумма, ₸', width: 90, align: 'right' },
];

interface TotalRow {
  label: string;
  value: string;
  strong?: boolean;
}

function totalRows(model: OrderDocumentModel, finalLabel: string): TotalRow[] {
  const rows: TotalRow[] = [{ label: 'Итого без НДС', value: formatAmountWithCurrency(model.totals.net) }];
  if (model.totals.discount > 0n) {
    rows.push({ label: 'Скидка (учтена в суммах позиций)', value: formatAmountWithCurrency(model.totals.discount) });
  }
  rows.push({ label: 'НДС', value: formatAmountWithCurrency(model.totals.vat) });
  rows.push({ label: finalLabel, value: formatAmountWithCurrency(model.totals.grand), strong: true });
  return rows;
}

/** `keepWith`: height of whatever must stay on the same page as the totals. */
function drawTotals(w: Writer, rows: TotalRow[], keepWith = 0) {
  const labelWidth = 200;
  const valueWidth = 120;
  const x = PAGE.width - MARGIN.right - labelWidth - valueWidth;
  const heights = rows.map((row) =>
    Math.max(
      w.measure(row.label, labelWidth - 8, { size: row.strong ? 10.5 : 9, font: row.strong ? 'bold' : 'regular' }),
      w.measure(row.value, valueWidth, { size: row.strong ? 10.5 : 9, font: 'bold' }),
    ) + 5,
  );
  w.ensure(heights.reduce((a, b) => a + b, 0) + 8 + keepWith);
  w.gap(6);
  rows.forEach((row, i) => {
    const size = row.strong ? 10.5 : 9;
    if (row.strong) w.hLine(w.y - 1, x, PAGE.width - MARGIN.right, INK, 0.8);
    w.text(row.label, x, w.y + 2, labelWidth - 8, { size, font: row.strong ? 'bold' : 'regular', align: 'right', color: row.strong ? INK : MUTED });
    w.text(row.value, x + labelWidth, w.y + 2, valueWidth, { size, font: 'bold', align: 'right' });
    w.y += heights[i];
  });
}

/** label: value rows in a fixed label column. */
function drawFieldRows(w: Writer, fields: DocumentField[], x: number, width: number, labelWidth: number, size = 9) {
  for (const field of fields) {
    const height = Math.max(
      w.measure(field.label, labelWidth - 6, { size: size - 0.5, color: MUTED }),
      w.measure(field.value, width - labelWidth, { size }),
    );
    w.ensure(height + 3);
    w.text(field.label, x, w.y, labelWidth - 6, { size: size - 0.5, color: MUTED });
    w.text(field.value, x + labelWidth, w.y, width - labelWidth, { size });
    w.y += height + 3;
  }
}

function measureFieldRows(w: Writer, fields: DocumentField[], width: number, labelWidth: number, size = 9): number {
  return fields.reduce(
    (sum, field) =>
      sum +
      Math.max(
        w.measure(field.label, labelWidth - 6, { size: size - 0.5 }),
        w.measure(field.value, width - labelWidth, { size }),
      ) +
      3,
    0,
  );
}

function sectionTitle(w: Writer, title: string, keepWith = 40) {
  w.ensure(22 + keepWith);
  w.gap(8);
  w.text(title.toUpperCase(), MARGIN.left, w.y, CONTENT_WIDTH, { size: 8, font: 'bold', color: MUTED });
  w.y += 13;
}

function sellerFields(model: OrderDocumentModel): DocumentField[] {
  const s = model.seller;
  const fields: DocumentField[] = [{ label: 'Наименование', value: s.legalName ?? model.brandName }];
  if (s.bin) fields.push({ label: 'БИН', value: s.bin });
  if (s.address) fields.push({ label: 'Адрес', value: s.address });
  if (s.phone) fields.push({ label: 'Телефон', value: s.phone });
  if (s.email) fields.push({ label: 'Email', value: s.email });
  return fields;
}

function buyerFields(model: OrderDocumentModel): DocumentField[] {
  const b = model.buyer;
  const fields: DocumentField[] = [{ label: 'Тип клиента', value: b.typeLabel }];
  if (b.isLegalEntity) {
    fields.push({ label: 'Компания', value: b.name });
    if (b.contactPerson) fields.push({ label: 'Контактное лицо', value: b.contactPerson });
  } else {
    fields.push({ label: 'ФИО', value: b.name });
  }
  if (b.binIin) fields.push({ label: b.idLabel, value: b.binIin });
  fields.push({ label: 'Телефон', value: b.phone });
  if (b.email) fields.push({ label: 'Email', value: b.email });
  if (b.city) fields.push({ label: 'Город', value: b.city });
  return fields;
}

function drawParties(w: Writer, left: { title: string; fields: DocumentField[] }, right: { title: string; fields: DocumentField[] }) {
  const columnGap = 20;
  const colWidth = (CONTENT_WIDTH - columnGap) / 2;
  const labelWidth = 92;
  const height =
    Math.max(measureFieldRows(w, left.fields, colWidth, labelWidth), measureFieldRows(w, right.fields, colWidth, labelWidth)) + 16;
  w.ensure(height);
  const top = w.y;
  const columns = [
    { block: left, x: MARGIN.left },
    { block: right, x: MARGIN.left + colWidth + columnGap },
  ];
  let maxY = top;
  for (const { block, x } of columns) {
    w.y = top;
    w.text(block.title.toUpperCase(), x, w.y, colWidth, { size: 8, font: 'bold', color: MUTED });
    w.hLine(w.y + 12, x, x + colWidth);
    w.y += 16;
    drawFieldRows(w, block.fields, x, colWidth, labelWidth);
    maxY = Math.max(maxY, w.y);
  }
  w.y = maxY;
}

function stampPageFooters(w: Writer, model: OrderDocumentModel) {
  const range = w.doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    w.doc.switchToPage(i);
    const y = PAGE.height - MARGIN.bottom + 18;
    w.hLine(y - 5);
    w.text(`${model.title} № ${model.number}`, MARGIN.left, y, CONTENT_WIDTH - 90, { size: 7.5, color: MUTED });
    w.text(`Стр. ${i - range.start + 1} из ${range.count}`, PAGE.width - MARGIN.right - 90, y, 90, {
      size: 7.5,
      color: MUTED,
      align: 'right',
    });
  }
}

function continuationHeader(w: Writer, model: OrderDocumentModel) {
  return () => {
    w.text(`${model.title} № ${model.number} от ${model.dateText} (продолжение)`, MARGIN.left, w.y, CONTENT_WIDTH, {
      size: 8,
      color: MUTED,
    });
    w.y += 16;
  };
}

/* -------------------------------------------------------------------------- */
/* Commercial proposal                                                         */
/* -------------------------------------------------------------------------- */

function drawProposal(w: Writer, model: OrderDocumentModel) {
  const s = model.seller;

  // Letterhead: brand left, configured contacts right.
  const contacts = [s.phone, s.email, s.address].filter((v): v is string => Boolean(v)).join('\n');
  const contactsWidth = 220;
  const brandWidth = CONTENT_WIDTH - contactsWidth - 16;
  const top = w.y;
  w.text(model.brandName, MARGIN.left, top, brandWidth, { size: 18, font: 'bold' });
  let leftBottom = top + w.measure(model.brandName, brandWidth, { size: 18, font: 'bold' });
  if (s.legalName) {
    w.text(s.legalName, MARGIN.left, leftBottom, brandWidth, { size: 9, color: MUTED });
    leftBottom += w.measure(s.legalName, brandWidth, { size: 9 });
  }
  const rightBottom = top + w.measure(contacts, contactsWidth, { size: 8.5 });
  w.text(contacts, PAGE.width - MARGIN.right - contactsWidth, top + 3, contactsWidth, { size: 8.5, color: MUTED, align: 'right' });
  w.y = Math.max(leftBottom, rightBottom) + 8;
  w.rect(MARGIN.left, w.y, 48, 3, ACCENT);
  w.hLine(w.y + 3);
  w.y += 18;

  w.text(model.title, MARGIN.left, w.y, CONTENT_WIDTH, { size: 16, font: 'bold' });
  w.y += 22;
  const subtitle = `№ ${model.number} от ${model.dateText} · по заказу № ${model.orderNumber}`;
  w.text(subtitle, MARGIN.left, w.y, CONTENT_WIDTH, { size: 9.5, color: MUTED });
  w.y += w.measure(subtitle, CONTENT_WIDTH, { size: 9.5 }) + 14;

  drawParties(w, { title: 'Поставщик', fields: sellerFields(model) }, { title: 'Покупатель', fields: buyerFields(model) });

  sectionTitle(w, 'Спецификация', 60);
  drawTable(w, ITEM_COLUMNS, itemRows(model.items), false);
  drawTotals(w, totalRows(model, 'Итого с НДС'));

  if (model.items.some((item) => item.amountIncludesAdjustments)) {
    const note = '* Сумма позиции включает выбранные по заказу услуги (сборка, доставка) и применённые скидки.';
    w.gap(6);
    w.ensure(w.measure(note, CONTENT_WIDTH, { size: 8 }));
    w.text(note, MARGIN.left, w.y, CONTENT_WIDTH, { size: 8, color: MUTED });
    w.y += w.measure(note, CONTENT_WIDTH, { size: 8 });
  }

  sectionTitle(w, 'Параметры позиций', itemDetailsKeepHeight(w, model.items[0]));
  for (const item of model.items) drawItemDetails(w, item);

  const terms: DocumentField[] = [];
  if (model.paymentMethod) terms.push({ label: 'Способ оплаты', value: model.paymentMethod });
  terms.push(...model.delivery);
  if (terms.length > 0) {
    sectionTitle(w, 'Оплата и доставка');
    drawFieldRows(w, terms, MARGIN.left, CONTENT_WIDTH, 130);
  }

  // dateText already ends with "г." — no extra period after it.
  const closing = `Цены указаны в тенге (₸). Предложение сформировано по данным заказа № ${model.orderNumber} от ${model.dateText}`;
  w.gap(12);
  w.ensure(w.measure(closing, CONTENT_WIDTH, { size: 8.5 }) + 4);
  w.text(closing, MARGIN.left, w.y, CONTENT_WIDTH, { size: 8.5, color: MUTED });
  w.y += w.measure(closing, CONTENT_WIDTH, { size: 8.5 });
}

const DETAIL_COLUMN_GAP = 20;
const DETAIL_COLUMN_WIDTH = (CONTENT_WIDTH - DETAIL_COLUMN_GAP) / 2;
const DETAIL_LABEL_WIDTH = 100;

function itemDetailsLayout(w: Writer, item: DocumentItem) {
  const heading = `${item.index}. ${item.title}`;
  const priceLine = `${item.quantity} ${item.unit} × ${formatAmountWithCurrency(item.unitPrice)} = ${formatAmountWithCurrency(item.amount)}${item.amountIncludesAdjustments ? '*' : ''}`;
  // Specs in two side-by-side label/value columns.
  const half = Math.ceil(item.specs.length / 2);
  const leftSpecs = item.specs.slice(0, half);
  const rightSpecs = item.specs.slice(half);
  const specsHeight = Math.max(
    measureFieldRows(w, leftSpecs, DETAIL_COLUMN_WIDTH, DETAIL_LABEL_WIDTH),
    measureFieldRows(w, rightSpecs, DETAIL_COLUMN_WIDTH, DETAIL_LABEL_WIDTH),
  );
  const headingHeight = Math.max(
    w.measure(heading, CONTENT_WIDTH - 200, { size: 10, font: 'bold' }),
    w.measure(priceLine, 200, { size: 8.5 }),
  );
  return { heading, priceLine, leftSpecs, rightSpecs, headingHeight, keepHeight: headingHeight + specsHeight + 16 };
}

/** Heading, price line and the whole spec grid of one item stay together. */
function itemDetailsKeepHeight(w: Writer, item: DocumentItem): number {
  return itemDetailsLayout(w, item).keepHeight;
}

function drawItemDetails(w: Writer, item: DocumentItem) {
  const { heading, priceLine, leftSpecs, rightSpecs, headingHeight, keepHeight } = itemDetailsLayout(w, item);
  const columnGap = DETAIL_COLUMN_GAP;
  const colWidth = DETAIL_COLUMN_WIDTH;
  const labelWidth = DETAIL_LABEL_WIDTH;

  w.ensure(keepHeight);
  w.gap(4);
  w.hLine(w.y);
  w.y += 6;
  w.text(heading, MARGIN.left, w.y, CONTENT_WIDTH - 200, { size: 10, font: 'bold' });
  w.text(priceLine, PAGE.width - MARGIN.right - 200, w.y + 1, 200, { size: 8.5, align: 'right', color: MUTED });
  w.y += headingHeight + 4;

  const top = w.y;
  drawFieldRows(w, leftSpecs, MARGIN.left, colWidth, labelWidth);
  const leftEnd = w.y;
  w.y = top;
  drawFieldRows(w, rightSpecs, MARGIN.left + colWidth + columnGap, colWidth, labelWidth);
  w.y = Math.max(leftEnd, w.y);

  if (item.kit.length > 0) {
    w.ensure(30);
    w.gap(3);
    w.text('Комплектация', MARGIN.left, w.y, CONTENT_WIDTH, { size: 8, font: 'bold', color: MUTED });
    w.y += 12;
    // Two columns, filled row by row so a page break never reorders lines.
    for (let i = 0; i < item.kit.length; i += 2) {
      const pair = item.kit.slice(i, i + 2);
      const texts = pair.map((line) => `${line.name} — ${line.quantity} шт.`);
      const height = Math.max(...texts.map((t) => w.measure(t, colWidth, { size: 8.5 }))) + 2;
      w.ensure(height);
      texts.forEach((t, j) => {
        w.text(t, MARGIN.left + j * (colWidth + columnGap), w.y, colWidth, { size: 8.5 });
      });
      w.y += height;
    }
  }
  w.gap(6);
}

/* -------------------------------------------------------------------------- */
/* Invoice                                                                     */
/* -------------------------------------------------------------------------- */

function drawInvoice(w: Writer, model: OrderDocumentModel) {
  const s = model.seller;

  w.text(s.legalName ?? '', MARGIN.left, w.y, CONTENT_WIDTH, { size: 11, font: 'bold' });
  w.y += w.measure(s.legalName ?? '', CONTENT_WIDTH, { size: 11, font: 'bold' }) + 2;
  if (s.address) {
    w.text(s.address, MARGIN.left, w.y, CONTENT_WIDTH, { size: 8.5, color: MUTED });
    w.y += w.measure(s.address, CONTENT_WIDTH, { size: 8.5 });
  }
  w.y += 10;

  w.text('Образец платёжного поручения', MARGIN.left, w.y, CONTENT_WIDTH, { size: 8, font: 'bold', color: MUTED });
  w.y += 13;

  // Beneficiary grid: [name + BIN | ИИК | Кбе] / [bank | БИК | КНП].
  const widths = [CONTENT_WIDTH - 170 - 90, 170, 90];
  const grid: { label: string; value: string; sub?: string }[][] = [
    [
      { label: 'Бенефициар', value: s.legalName ?? '', sub: s.bin ? `БИН ${s.bin}` : undefined },
      { label: 'ИИК', value: s.iban ?? '' },
      { label: 'Кбе', value: s.kbe ?? '' },
    ],
    [
      { label: 'Банк бенефициара', value: s.bankName ?? '' },
      { label: 'БИК', value: s.bic ?? '' },
      { label: 'Код назначения платежа', value: s.knp ?? '' },
    ],
  ];
  for (const row of grid) {
    const heights = row.map((cell, i) => {
      const inner = widths[i] - CELL_PAD_X * 2;
      return (
        w.measure(cell.label, inner, { size: 7.5 }) +
        w.measure(cell.value, inner, { size: 9, font: 'bold' }) +
        (cell.sub ? w.measure(cell.sub, inner, { size: 8.5 }) : 0) +
        CELL_PAD_Y * 2 +
        2
      );
    });
    const height = Math.max(...heights);
    w.ensure(height);
    let x = MARGIN.left;
    row.forEach((cell, i) => {
      const inner = widths[i] - CELL_PAD_X * 2;
      let y = w.y + CELL_PAD_Y;
      w.text(cell.label, x + CELL_PAD_X, y, inner, { size: 7.5, color: MUTED });
      y += w.measure(cell.label, inner, { size: 7.5 }) + 1;
      w.text(cell.value, x + CELL_PAD_X, y, inner, { size: 9, font: 'bold' });
      y += w.measure(cell.value, inner, { size: 9, font: 'bold' }) + 1;
      if (cell.sub) w.text(cell.sub, x + CELL_PAD_X, y, inner, { size: 8.5 });
      w.strokeRect(x, w.y, widths[i], height, INK);
      x += widths[i];
    });
    w.y += height;
  }

  w.y += 18;
  const title = `${model.title} № ${model.number} от ${model.dateText}`;
  w.text(title, MARGIN.left, w.y, CONTENT_WIDTH, { size: 14, font: 'bold' });
  w.y += w.measure(title, CONTENT_WIDTH, { size: 14, font: 'bold' }) + 4;
  w.hLine(w.y, MARGIN.left, PAGE.width - MARGIN.right, INK, 1.4);
  w.y += 10;

  const b = model.buyer;
  const supplier = [
    s.bin ? `БИН ${s.bin}` : undefined,
    s.legalName,
    s.address,
    s.phone ? `тел. ${s.phone}` : undefined,
    s.email,
  ].filter((v): v is string => Boolean(v));
  const buyer = [
    b.binIin ? `${b.idLabel} ${b.binIin}` : undefined,
    b.name,
    b.contactPerson ? `контактное лицо: ${b.contactPerson}` : undefined,
    b.phone ? `тел. ${b.phone}` : undefined,
    b.email,
  ].filter((v): v is string => Boolean(v));
  drawFieldRows(
    w,
    [
      { label: 'Поставщик:', value: supplier.join(', ') },
      { label: 'Покупатель:', value: buyer.join(', ') },
      { label: 'Основание:', value: `Заказ № ${model.orderNumber}` },
    ],
    MARGIN.left,
    CONTENT_WIDTH,
    80,
    9,
  );
  w.y += 8;

  drawTable(w, ITEM_COLUMNS, itemRows(model.items), true);

  const summary = `Всего наименований ${model.items.length}, на сумму ${formatAmountWithCurrency(model.totals.grand)}`;
  const words = `Всего к оплате: ${model.grandTotalInWords}`;
  const notes: string[] = [];
  if (model.items.some((item) => item.amountIncludesAdjustments)) {
    notes.push('* Сумма позиции включает выбранные по заказу услуги (сборка, доставка) и применённые скидки.');
  }
  const blockHeight =
    w.measure(summary, CONTENT_WIDTH, { size: 9 }) +
    w.measure(words, CONTENT_WIDTH, { size: 9.5, font: 'bold' }) +
    notes.reduce((sum, n) => sum + w.measure(n, CONTENT_WIDTH, { size: 8 }), 0) +
    90;
  // Totals, the amount in words and the signature line are one block: an
  // invoice never ends a page on its totals and continues with "прописью".
  drawTotals(w, totalRows(model, 'Всего к оплате'), blockHeight + 10);
  w.gap(10);
  w.ensure(blockHeight);
  w.text(summary, MARGIN.left, w.y, CONTENT_WIDTH, { size: 9 });
  w.y += w.measure(summary, CONTENT_WIDTH, { size: 9 }) + 2;
  w.text(words, MARGIN.left, w.y, CONTENT_WIDTH, { size: 9.5, font: 'bold' });
  w.y += w.measure(words, CONTENT_WIDTH, { size: 9.5, font: 'bold' }) + 4;
  for (const note of notes) {
    w.text(note, MARGIN.left, w.y, CONTENT_WIDTH, { size: 8, color: MUTED });
    w.y += w.measure(note, CONTENT_WIDTH, { size: 8 });
  }
  w.hLine(w.y + 6, MARGIN.left, PAGE.width - MARGIN.right, INK, 1.4);
  w.y += 40;
  w.text('Исполнитель', MARGIN.left, w.y, 80, { size: 9, font: 'bold' });
  w.hLine(w.y + 11, MARGIN.left + 80, MARGIN.left + 260, INK, 0.6);
  w.text('/', MARGIN.left + 266, w.y, 10, { size: 9 });
  w.hLine(w.y + 11, MARGIN.left + 280, MARGIN.left + 440, INK, 0.6);
  w.text('/', MARGIN.left + 446, w.y, 10, { size: 9 });
  w.y += 20;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function renderOrderDocumentPdf(model: OrderDocumentModel): Promise<Buffer> {
  const { regular, bold } = fonts();
  const doc = new PDFDocument({
    size: 'A4',
    // Zero document margins: the layout above owns every coordinate, so
    // pdfkit never starts an unplanned page on its own.
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    autoFirstPage: true,
    font: regular as unknown as string,
    lang: 'ru-RU',
    displayTitle: true,
    info: {
      Title: `${model.title} № ${model.number}`,
      Author: model.seller.legalName ?? model.brandName,
      Creator: model.brandName,
      CreationDate: model.issuedAt,
    },
  });
  doc.registerFont('regular', regular);
  doc.registerFont('bold', bold);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const w = new Writer(doc);
  w.setPageHeader(continuationHeader(w, model));
  if (model.kind === 'invoice') {
    drawInvoice(w, model);
  } else {
    drawProposal(w, model);
  }
  stampPageFooters(w, model);
  doc.end();
  return done;
}
