import { beforeAll, describe, expect, it } from 'vitest';
import { getCatalog } from '@/lib/data/repository';
import { buildOrderDocument, DocumentIntegrityError, type DocumentLabels } from '@/lib/documents/build';
import type { OrderDocumentKind } from '@/lib/documents/kinds';
import { documentLabelsFromCatalog } from '@/lib/documents/labels';
import type { OrderDocumentSource } from '@/lib/documents/order-source';
import { renderOrderDocumentPdf } from '@/lib/documents/pdf';
import { readSellerConfig, type SellerDetails } from '@/lib/documents/seller';
import { configuration, decimal, item, orderSource } from './helpers/order-document-fixtures';
import { pdfSyntax, readPdfText } from './helpers/pdf-text';

/**
 * Commercial proposal and invoice PDFs, read back as text.
 *
 * Everything is asserted against the generated PDF itself (via PDF.js), not
 * against the intermediate model: what matters is what the customer sees.
 */

const SELLER: SellerDetails = readSellerConfig({
  SELLER_LEGAL_NAME: 'ТОО «Тестовый Продавец»',
  SELLER_BIN: '987654321098',
  SELLER_ADDRESS: 'г. Астана, ул. Тестовая, 1',
  SELLER_PHONE: '+7 700 000 00 00',
  SELLER_EMAIL: 'sales@example.invalid',
  SELLER_BANK_NAME: 'АО «Тестовый Банк»',
  SELLER_IBAN: 'KZ000000000000000000',
  SELLER_BIC: 'TESTKZKA',
  SELLER_KBE: '17',
  SELLER_KNP: '710',
}).details;

let labels: DocumentLabels;

/** Serialises a source including its Decimal-like money objects. */
function snapshotOf(source: OrderDocumentSource): string {
  return JSON.stringify(source, (_key, value) =>
    value && typeof value === 'object' && typeof value.toFixed === 'function' ? `D:${value.toFixed(2)}` : value,
  );
}

beforeAll(async () => {
  labels = documentLabelsFromCatalog(await getCatalog());
});

async function render(kind: OrderDocumentKind, source: OrderDocumentSource, seller: SellerDetails = SELLER) {
  const bytes = await renderOrderDocumentPdf(buildOrderDocument(kind, source, seller, labels));
  return { bytes, text: await readPdfText(bytes) };
}

describe('commercial proposal — individual customer', () => {
  it('prints seller, document number/date, customer, configuration and persisted amounts', async () => {
    const { bytes, text } = await render('commercial-proposal', orderSource());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const t = text.flat;

    expect(t).toContain('Коммерческое предложение');
    expect(t).toContain('№ KP-MS-20260830-4HB57 от 30 августа 2026 г.');
    expect(t).toContain('по заказу № MS-20260830-4HB57');
    expect(t).toContain('ТОО «Тестовый Продавец»');
    expect(t).toContain('987654321098');

    expect(t).toContain('Физическое лицо');
    expect(t).toContain('Айгуль Тестова');
    expect(t).toContain('+77001234567');
    expect(t).toContain('aigul@example.com');

    expect(t).toContain('Стеллаж MS Стандарт');
    expect(t).toContain('В×Ш×Г 2000×1000×400 мм');
    expect(t).toContain('Стандартный серый');
    expect(t).toContain('Самостоятельная сборка');

    // 191 979 net, VAT 30 717 (persisted), 222 696 total.
    expect(t).toContain('191 979,00');
    expect(t).toContain('Итого без НДС 191 979,00 ₸');
    expect(t).toContain('НДС 30 717,00 ₸');
    expect(t).toContain('Итого с НДС 222 696,00 ₸');
    expect(t).not.toContain('Скидка');
  });

  it('shows the customer-facing kit only: no SKUs, no component prices, no folded production parts', async () => {
    const { text } = await render('commercial-proposal', orderSource());
    const t = text.flat;
    expect(t).toContain('Стойка 2000 мм — 4 шт.');
    expect(t).toContain('Полка Стандартная 1000×400 — 5 шт.');
    expect(t).toContain('Болт с гайкой М6 — 36 шт.');

    for (const hidden of ['Балка поперечная', 'Стяжка рамы', 'Балка продольная']) {
      expect(t, `hidden MS Standard part "${hidden}" leaked`).not.toContain(hidden);
    }
    for (const sku of ['UPR-0015', 'BMD-0093', 'TIE-0131', 'SHF-0310']) {
      expect(t).not.toContain(sku);
    }
    // Snapshot component selling prices sit below the markup — never printed.
    for (const componentPrice of ['22 400', '5 600', '20 500', '4 100']) {
      expect(t).not.toContain(componentPrice);
    }
    for (const internal of ['Наценка', 'наценка', 'маржа', 'Маржа', 'закуп', 'Закуп', 'себестоим', 'поставщик:']) {
      expect(t).not.toContain(internal);
    }
  });
});

describe('legal entity, BIN/IIN', () => {
  const legal = orderSource({
    customer: {
      type: 'LEGAL_ENTITY',
      fullName: 'Сериков Ержан Болатович',
      companyName: 'ТОО «Ромашка Логистик Қазақстан»',
      binIin: '123456789012',
      email: 'zakup@romashka.kz',
    },
  });

  it('commercial proposal names the company, the contact person and the BIN', async () => {
    const { text } = await render('commercial-proposal', legal);
    expect(text.flat).toContain('Юридическое лицо');
    expect(text.flat).toContain('Компания ТОО «Ромашка Логистик Қазақстан»');
    expect(text.flat).toContain('Контактное лицо Сериков Ержан Болатович');
    expect(text.flat).toContain('БИН 123456789012');
  });

  it('invoice prints the full beneficiary block, buyer BIN, order link and "Всего к оплате"', async () => {
    const { text } = await render('invoice', legal);
    const t = text.flat;
    expect(t).toContain('Счёт на оплату № INV-MS-20260830-4HB57 от 30 августа 2026 г.');
    expect(t).toContain('Образец платёжного поручения');
    expect(t).toContain('KZ000000000000000000');
    expect(t).toContain('TESTKZKA');
    expect(t).toContain('АО «Тестовый Банк»');
    expect(t).toContain('БИН 987654321098');
    expect(t).toMatch(/Кбе\s*17/);
    expect(t).toContain('Покупатель: БИН 123456789012, ТОО «Ромашка Логистик Қазақстан», контактное лицо: Сериков Ержан Болатович');
    expect(t).toContain('Основание: Заказ № MS-20260830-4HB57');
    for (const header of ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена, ₸', 'Сумма, ₸']) expect(t).toContain(header);
    expect(t).toContain('компл.');
    expect(t).toContain('Всего к оплате 222 696,00 ₸');
    expect(t).toContain('Всего наименований 1, на сумму 222 696,00 ₸');
    expect(t).toContain('Всего к оплате: Двести двадцать две тысячи шестьсот девяносто шесть тенге 00 тиын');
  });

  it('an individual with an IIN is labelled ИИН', async () => {
    const { text } = await render('invoice', orderSource({ customer: { binIin: '900101300123' } }));
    expect(text.flat).toContain('Покупатель: ИИН 900101300123, Айгуль Тестова');
  });
});

describe('persisted totals are printed verbatim', () => {
  it('uses the stored VAT even when it is not 16% of the net — VAT is never recalculated', async () => {
    const source = orderSource({ vat: 12345 });
    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const { text } = await render(kind, source);
      expect(text.flat).toContain('НДС 12 345,00 ₸');
      expect(text.flat).toContain('204 324,00 ₸');
      expect(text.flat).not.toContain('30 717');
    }
  });

  it('prints kopeck-level (tiyn) amounts exactly, without rounding to whole tenge', async () => {
    const source = orderSource({
      items: [item({ unitNetPrice: decimal('1000.55'), totalNetPrice: decimal('1000.55') })],
      netTotal: decimal('1000.55'),
      vatTotal: decimal('160.09'),
      grandTotal: decimal('1160.64'),
    });
    const { text } = await render('invoice', source);
    expect(text.flat).toContain('1 000,55');
    expect(text.flat).toContain('Всего к оплате 1 160,64 ₸');
    expect(text.flat).toContain('Одна тысяча сто шестьдесят тенге 64 тиын');
  });

  it('shows a non-zero discount as already included in the line amounts', async () => {
    // Quantity 3 at 100 000 with a 9 000 discount folded into the line total.
    const source = orderSource({
      items: [item({ unit: 100000, quantity: 3, total: 291000 })],
      discount: 9000,
    });
    const { text } = await render('invoice', source);
    const t = text.flat;
    expect(t).toContain('Скидка (учтена в суммах позиций) 9 000,00 ₸');
    expect(t).toContain('100 000,00');
    expect(t).toContain('291 000,00*');
    expect(t).toContain('* Сумма позиции включает выбранные по заказу услуги (сборка, доставка) и применённые скидки.');
    expect(t).toContain('Итого без НДС 291 000,00 ₸');
    expect(t).toContain('НДС 46 560,00 ₸');
    expect(t).toContain('Всего к оплате 337 560,00 ₸');
  });
});

describe('multiple items and multiple shelving sections', () => {
  it('lists every item with its sections, walls and options', async () => {
    const source = orderSource({
      items: [
        item({
          id: 'a',
          configuration: configuration([1000, 700, 1200], {
            sections: [
              { id: 's1', width: 1000, rearWall: true, leftWall: false, rightWall: false },
              { id: 's2', width: 700, rearWall: false, leftWall: false, rightWall: false },
              { id: 's3', width: 1200, rearWall: false, leftWall: false, rightWall: true },
            ],
            metalFootPad: true,
          }),
          unit: 484962,
        }),
        item({ id: 'b', configuration: configuration([800], { height: 2500, depth: 600, shelves: 6 }), unit: 150000, quantity: 2 }),
      ],
    });
    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const { text } = await render(kind, source);
      const t = text.flat;
      expect(t).toContain('В×Ш×Г 2000×2900×400 мм');
      expect(t).toContain('секций: 3 (1000 + 700 + 1200 мм)');
      expect(t).toContain('стенки: секция 1: задняя; секция 2: без стенок; секция 3: правая');
      expect(t).toContain('металлический подпятник');
      expect(t).toContain('В×Ш×Г 2500×800×600 мм');
      expect(t).toContain('484 962,00');
      expect(t).toContain('300 000,00');
      expect(t).toContain('Итого без НДС 784 962,00 ₸');
    }
    const { text } = await render('commercial-proposal', source);
    expect(text.flat).toContain('Ширина секций 1000 + 700 + 1200 мм');
    expect(text.flat).toContain('Секций 3');
    expect(text.flat).toContain('2 компл. × 150 000,00 ₸ = 300 000,00 ₸');
  });
});

describe('layout robustness', () => {
  it('wraps very long names and unbroken strings without losing text', async () => {
    const longCompany = `ТОО «${'Очень длинное название компании Қазақстан '.repeat(7).trim()}»`.slice(0, 300);
    const unbroken = 'А'.repeat(180);
    const source = orderSource({
      customer: { type: 'LEGAL_ENTITY', companyName: longCompany, fullName: unbroken, binIin: '123456789012' },
      delivery: { methodId: 'delivery-city', address: `ул. ${'Длинная '.repeat(60)}`, city: 'Алматы', floor: '12', hasLift: false, date: null },
    });
    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const { text } = await render(kind, source);
      const compact = text.pages.join('').replace(/\s/g, '');
      expect(compact).toContain(unbroken);
      expect(compact).toContain(longCompany.replace(/\s/g, ''));
    }
  });

  it('paginates a large order across A4 pages with repeated headers, page numbers and no lost rows', async () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      item({ id: `i-${String(i).padStart(2, '0')}`, configuration: configuration(i % 2 ? [1000] : [1000, 700, 1200]), unit: 100000 + i }),
    );
    const source = orderSource({ items });
    const net = items.reduce((sum, _, i) => sum + 100000 + i, 0);

    for (const kind of ['invoice', 'commercial-proposal'] as const) {
      const { bytes, text } = await render(kind, source);
      expect(text.numPages).toBeGreaterThanOrEqual(3);

      text.pages.forEach((page, i) => {
        expect(page.replace(/\s+/g, ' ')).toContain(`Стр. ${i + 1} из ${text.numPages}`);
        if (i > 0) expect(page).toContain('(продолжение)');
      });
      // Every row made it into the document, in order.
      let cursor = 0;
      for (let i = 0; i < 40; i += 1) {
        const amount = `${(100000 + i).toLocaleString('ru-RU').replace(/\s/g, ' ')},00`;
        const at = text.flat.indexOf(amount, cursor);
        expect(at, `row ${i + 1} (${amount}) missing or out of order in ${kind}`).toBeGreaterThanOrEqual(0);
        cursor = at;
      }
      expect(text.flat).toContain(`Итого без НДС ${net.toLocaleString('ru-RU').replace(/\s/g, ' ')},00 ₸`);

      // Every page is A4 portrait.
      const mediaBoxes = pdfSyntax(bytes).match(/\/MediaBox \[0 0 595\.28 841\.89\]/g) ?? [];
      expect(mediaBoxes.length).toBe(text.numPages);
    }

    // Continuation pages of the invoice repeat the table header.
    const { text } = await render('invoice', source);
    for (const page of text.pages.slice(1)) {
      if (/\d{3} \d{3},00/.test(page)) expect(page).toContain('Наименование');
    }
    expect(text.flat).toContain('Всего наименований 40');
  });

  it('renders Cyrillic, Kazakh letters and the tenge sign as searchable text', async () => {
    const { bytes, text } = await render(
      'commercial-proposal',
      orderSource({ customer: { fullName: 'Әсел Ұлықбекқызы Өмірзақова', city: 'Шымкент' } }),
    );
    expect(text.flat).toContain('Әсел Ұлықбекқызы Өмірзақова');
    expect(text.flat).toContain('₸');
    expect(text.flat).toContain('Шымкент');
    // Embedded, subsetted TrueType font — not a standard 14 font without Cyrillic.
    const syntax = pdfSyntax(bytes);
    expect(syntax).toMatch(/\/FontFile2/);
    expect(syntax).not.toMatch(/\/BaseFont \/Helvetica/);
  });
});

describe('injection safety', () => {
  it('prints hostile customer text literally and the PDF carries no active content', async () => {
    const hostile = orderSource({
      customer: {
        type: 'LEGAL_ENTITY',
        fullName: '<script>alert("xss")</script>',
        companyName: ') Tj /JavaScript (app.alert(1)) /S /JavaScript /OpenAction',
        binIin: '123456789012',
        email: 'x@example.com"><img src=x onerror=alert(1)>',
        city: 'Алматы‮такса 0‬',
      },
      delivery: { methodId: null, address: '{{constructor.constructor("alert(1)")()}} ', city: null, floor: null, hasLift: null, date: null },
    });

    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const { bytes, text } = await render(kind, hostile);
      expect(text.flat).toContain('<script>alert("xss")</script>');
      // Whitespace-insensitive: the long value wraps, and a line break may fall after "/".
      expect(text.flat.replace(/\s/g, '')).toContain(')Tj/JavaScript(app.alert(1))/S/JavaScript/OpenAction');
      expect(text.flat).not.toContain('‮');

      const syntax = pdfSyntax(bytes);
      for (const active of ['/JavaScript', '/JS ', '/JS(', '/OpenAction', '/Launch', '/URI', '/EmbeddedFile', '/AA ', '/SubmitForm', '/RichMedia']) {
        expect(syntax, `${kind} contains ${active}`).not.toContain(active);
      }
    }
  });
});

describe('idempotency and purity', () => {
  it('generating the same document twice yields identical bytes and does not touch the snapshot', async () => {
    const source = orderSource({ items: [item({ id: 'a' }), item({ id: 'b', unit: 5000, quantity: 3 })] });
    const before = snapshotOf(source);
    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const first = await render(kind, source);
      const second = await render(kind, source);
      expect(Buffer.compare(first.bytes, second.bytes)).toBe(0);
    }
    expect(snapshotOf(source)).toBe(before);
  });

  it('dates the document by the order in Kazakhstan time, not by the server clock', async () => {
    const late = orderSource({ createdAt: new Date('2026-08-30T21:30:00.000Z') });
    const { text } = await render('invoice', late);
    expect(text.flat).toContain('от 31 августа 2026 г.');
  });
});

describe('integrity guard — a self-contradictory snapshot is refused, never "fixed"', () => {
  it('refuses when line totals do not add up to netTotal', () => {
    const source = orderSource();
    source.netTotal = decimal(191980);
    source.grandTotal = decimal(191980 + 30717);
    expect(() => buildOrderDocument('invoice', source, SELLER, labels)).toThrow(DocumentIntegrityError);
  });

  it('refuses when netTotal + VAT is not grandTotal', () => {
    const source = orderSource();
    source.grandTotal = decimal(1);
    expect(() => buildOrderDocument('commercial-proposal', source, SELLER, labels)).toThrow(DocumentIntegrityError);
  });

  it('refuses an unreadable configuration or an empty order', () => {
    expect(() =>
      buildOrderDocument('invoice', orderSource({ items: [item({ configuration: { modelSlug: 'ms-standard' } })] }), SELLER, labels),
    ).toThrow(DocumentIntegrityError);
    expect(() => buildOrderDocument('invoice', { ...orderSource(), items: [] }, SELLER, labels)).toThrow(DocumentIntegrityError);
  });
});
