import { describe, expect, it } from 'vitest';
import {
  buildOrderDocument,
  buildOrderDocumentContent,
  DocumentIntegrityError,
  DocumentUnavailableError,
  type DocumentIssuance,
  type OrderDocumentModel,
} from '@/lib/documents/build';
import { ORDER_DOCUMENT_KINDS, type OrderDocumentKind } from '@/lib/documents/kinds';
import type { OrderDocumentSource } from '@/lib/documents/order-source';
import { renderOrderDocumentPdf } from '@/lib/documents/pdf';
import { readSellerConfig, sellerConfigIssues, type SellerDetails } from '@/lib/documents/seller';
import { configuration, decimal, issuance, item, orderSource } from './helpers/order-document-fixtures';
import { pdfSyntax, readPdfText } from './helpers/pdf-text';

/**
 * Commercial proposal and invoice PDFs, read back as text.
 *
 * Everything customer-visible is asserted against the generated PDF itself
 * (via PDF.js), not against the intermediate model: what matters is what the
 * customer and the accountant see. Arithmetic invariants are additionally
 * checked on the model, where they can be checked exhaustively.
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

const NUMBER: Record<OrderDocumentKind, string> = {
  'commercial-proposal': 'KP-MS-20260830-4HB57',
  invoice: 'INV-MS-20260830-4HB57',
};

/** Serialises a source including its Decimal-like money objects. */
function snapshotOf(source: OrderDocumentSource): string {
  return JSON.stringify(source, (_key, value) =>
    value && typeof value === 'object' && typeof value.toFixed === 'function' ? `D:${value.toFixed(2)}` : value,
  );
}

function model(kind: OrderDocumentKind, source: OrderDocumentSource, overrides: Partial<DocumentIssuance> = {}): OrderDocumentModel {
  return buildOrderDocument(kind, buildOrderDocumentContent(source), issuance(NUMBER[kind], { seller: SELLER, ...overrides }));
}

async function render(kind: OrderDocumentKind, source: OrderDocumentSource, overrides: Partial<DocumentIssuance> = {}) {
  const bytes = await renderOrderDocumentPdf(model(kind, source, overrides));
  return { bytes, text: await readPdfText(bytes) };
}

/** Every printed row: quantity × unit price = amount; rows − discount = the
 * total on the table's VAT basis; and the basis identities hold. */
function expectReconciles(m: OrderDocumentModel) {
  for (const line of m.lines) {
    expect(line.unitPrice * BigInt(line.quantity), `line ${line.index}`).toBe(line.amount);
  }
  const t = m.totals;
  expect(m.lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(t.lines);
  expect(t.lines - t.discount).toBe(t.pricesIncludeVat ? t.grand : t.net);
  expect(t.net + t.vat).toBe(t.grand);
}

describe('commercial proposal — individual customer', () => {
  it('prints seller, issued number/date, the order reference, buyer, configuration and persisted amounts', async () => {
    const { bytes, text } = await render('commercial-proposal', orderSource());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const t = text.flat;

    expect(t).toContain('Коммерческое предложение');
    // Document date = first issuance; the order keeps its own date.
    expect(t).toContain('№ KP-MS-20260830-4HB57 от 13 сентября 2026 г. · по заказу № MS-20260830-4HB57 от 30 августа 2026 г.');
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
    for (const header of ['Цена без НДС, ₸', 'Сумма без НДС, ₸']) expect(t).toContain(header);
    expect(t).toContain('1 компл. × 191 979,00 ₸ = 191 979,00 ₸');
    expect(t).toContain('Итого без НДС 191 979,00 ₸');
    expect(t).toContain('НДС 16% 30 717,00 ₸');
    expect(t).toContain('Итого с НДС 222 696,00 ₸');
    expect(t).toContain('без НДС, НДС начисляется сверху');
    expect(t).not.toContain('Скидка');
    expect(t).not.toContain('*');
  });

  it('shows the order-time customer-facing kit only: no SKUs, no component prices, no folded production parts', async () => {
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
    for (const internal of ['Наценка', 'наценка', 'маржа', 'Маржа', 'закуп', 'Закуп', 'себестоим', 'поставщик:']) {
      expect(t).not.toContain(internal);
    }
  });

  it('prints the labels frozen in the order snapshot, whatever those names are called today', async () => {
    const renamed = orderSource({
      items: [item({ snapshot: { modelName: 'MS Стандарт (архивное имя)', colorName: 'Графит 2026', assemblyName: 'Сборка «Лето»' } })],
    });
    const { text } = await render('commercial-proposal', renamed);
    expect(text.flat).toContain('Стеллаж MS Стандарт (архивное имя)');
    expect(text.flat).toContain('Графит 2026');
    expect(text.flat).toContain('Сборка «Лето»');
  });
});

describe('legal entity, BIN/IIN', () => {
  const legal = orderSource({
    buyer: {
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
    expect(t).toContain('Счёт на оплату № INV-MS-20260830-4HB57 от 13 сентября 2026 г.');
    expect(t).toContain('Образец платёжного поручения');
    expect(t).toContain('KZ000000000000000000');
    expect(t).toContain('TESTKZKA');
    expect(t).toContain('АО «Тестовый Банк»');
    expect(t).toContain('БИН 987654321098');
    expect(t).toMatch(/Кбе\s*17/);
    expect(t).toContain('Покупатель: БИН 123456789012, ТОО «Ромашка Логистик Қазақстан», контактное лицо: Сериков Ержан Болатович');
    expect(t).toContain('Основание: Заказ № MS-20260830-4HB57');
    for (const header of ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена без НДС, ₸', 'Сумма без НДС, ₸']) expect(t).toContain(header);
    expect(t).toContain('компл.');
    expect(t).toContain('Всего к оплате 222 696,00 ₸');
    expect(t).toContain('Всего наименований 1, на сумму 222 696,00 ₸');
    expect(t).toContain('Всего к оплате: Двести двадцать две тысячи шестьсот девяносто шесть тенге 00 тиын');
  });

  it('an individual with an IIN is labelled ИИН', async () => {
    const { text } = await render('invoice', orderSource({ buyer: { binIin: '900101300123' } }));
    expect(text.flat).toContain('Покупатель: ИИН 900101300123, Айгуль Тестова');
  });
});

describe('invoice lines — every row reconciles, services and discounts are explicit', () => {
  it('VAT-exclusive: goods, assembly and delivery rows, a discount row and VAT on top', async () => {
    // 3 × 100 000 goods + 15 000 assembly + 5 000 delivery − 9 000 discount = 311 000 net.
    const source = orderSource({
      items: [item({ unit: 100000, quantity: 3, assembly: 15000, delivery: 5000, discount: 9000, snapshot: { assemblyName: 'Профессиональная сборка', deliveryName: 'Доставка по городу' } })],
    });
    const m = model('invoice', source);
    expectReconciles(m);
    expect(m.lines.map((l) => [l.kind, l.quantity, l.unitPrice, l.amount])).toEqual([
      ['goods', 3, 10000000n, 30000000n],
      ['assembly', 1, 1500000n, 1500000n],
      ['delivery', 1, 500000n, 500000n],
    ]);

    const { text } = await render('invoice', source);
    const t = text.flat;
    expect(t).toContain('Цена без НДС, ₸');
    expect(t).toMatch(/1 Стеллаж MS Стандарт: .*? 3 компл\. 100 000,00 300 000,00/);
    expect(t).toContain('2 Услуга сборки: Профессиональная сборка (к поз. 1) 1 усл. 15 000,00 15 000,00');
    expect(t).toContain('3 Доставка: Доставка по городу (к поз. 1) 1 усл. 5 000,00 5 000,00');
    expect(t).toContain('Итого по строкам без НДС 320 000,00 ₸');
    expect(t).toContain('Скидка −9 000,00 ₸');
    expect(t).toContain('Итого без НДС 311 000,00 ₸');
    expect(t).toContain('НДС 16% 49 760,00 ₸');
    expect(t).toContain('Всего к оплате 360 760,00 ₸');
    expect(t).toContain('Всего наименований 3, на сумму 360 760,00 ₸');
    expect(t).not.toContain('*');
  });

  it('VAT-inclusive: VAT-inclusive rows add up to the total, VAT shown as included — never mixed with net amounts', async () => {
    // 2 × 58 000 + 4 000 assembly − 6 000 discount = 114 000 incl. VAT; VAT 16/116 = 15 724.
    const source = orderSource({
      items: [item({ unit: 58000, quantity: 2, assembly: 4000, discount: 6000, pricesIncludeVat: true, snapshot: { assemblyName: 'Профессиональная сборка' } })],
    });
    const m = model('invoice', source);
    expectReconciles(m);
    expect(m.totals).toMatchObject({ pricesIncludeVat: true, lines: 12000000n, discount: 600000n, grand: 11400000n, vat: 1572400n, net: 9827600n });

    for (const kind of ['invoice', 'commercial-proposal'] as const) {
      const { text } = await render(kind, source);
      const t = text.flat;
      expect(t).toContain('Цена с НДС, ₸');
      expect(t).toContain('Сумма с НДС, ₸');
      expect(t).not.toContain('без НДС');
      expect(t).toContain('Итого по строкам с НДС 120 000,00 ₸');
      expect(t).toContain('Скидка −6 000,00 ₸');
      expect(t).toContain(`${kind === 'invoice' ? 'Всего к оплате' : 'Итого с НДС'} 114 000,00 ₸`);
      expect(t).toContain('в том числе НДС 16% 15 724,00 ₸');
      // The net amount (98 276) is never printed as a row price.
      expect(t).not.toContain('98 276');
    }
  });

  it('reconciles for every combination of services, discount, quantity and VAT basis', () => {
    for (const pricesIncludeVat of [false, true]) {
      for (const quantity of [1, 2, 7]) {
        for (const assembly of [0, 1234.56]) {
          for (const delivery of [null, 0, 5000]) {
            for (const discount of [0, 777.77]) {
              const source = orderSource({
                items: [
                  item({ id: 'a', unit: '84321.37', quantity, assembly, delivery, discount, pricesIncludeVat }),
                  item({ id: 'b', unit: 1500, quantity: 2, pricesIncludeVat }),
                ],
              });
              for (const kind of ['invoice', 'commercial-proposal'] as const) expectReconciles(model(kind, source));
            }
          }
        }
      }
    }
  });

  it('item detail headings carry their table row number, so "к поз. N" points at the right item', async () => {
    const source = orderSource({
      items: [
        item({ id: 'a', assembly: 5000, snapshot: { assemblyName: 'Сборка и монтаж «под ключ»' } }),
        item({ id: 'b', unit: 150000, quantity: 2, assembly: 7000, snapshot: { assemblyName: 'Сборка и монтаж «под ключ»' } }),
      ],
    });
    const { text } = await render('commercial-proposal', source);
    const t = text.flat;
    expect(t).toContain('2 Услуга сборки: Сборка и монтаж «под ключ» (к поз. 1)');
    expect(t).toContain('4 Услуга сборки: Сборка и монтаж «под ключ» (к поз. 3)');
    expect(t).toContain('1. Стеллаж MS Стандарт 1 компл. × 191 979,00 ₸ = 191 979,00 ₸');
    expect(t).toContain('3. Стеллаж MS Стандарт 2 компл. × 150 000,00 ₸ = 300 000,00 ₸');
    expect(t).not.toContain('««');
    expect(t).not.toContain('»»');
  });

  it('an unpriced delivery (confirmed later by a manager) is not invoiced as a row', () => {
    const m = model('invoice', orderSource({ items: [item({ delivery: null, snapshot: { deliveryName: 'Доставка по Казахстану' } })] }));
    expect(m.lines.map((l) => l.kind)).toEqual(['goods']);
  });
});

describe('optional seller fields that are not configured', () => {
  /** SELLER_PHONE and SELLER_KNP are optional. When the seller has not
   * supplied them, both documents must simply leave them out — never a
   * placeholder, a dummy code or the word "undefined" on a payment
   * document. */
  const WITHOUT_OPTIONAL: SellerDetails = readSellerConfig({
    SELLER_LEGAL_NAME: 'ИП "Тестовый Продавец"',
    SELLER_BIN: '987654321098',
    SELLER_ADDRESS: 'г. Астана, ул. Тестовая, 1',
    SELLER_EMAIL: 'sales@example.invalid',
    SELLER_BANK_NAME: 'АО "Тестовый Банк"',
    SELLER_IBAN: 'KZ00TEST000000000000',
    SELLER_BIC: 'TESTKZKA',
    SELLER_KBE: '17',
  }).details;

  it('still allows an invoice to be issued', () => {
    expect(WITHOUT_OPTIONAL.phone).toBeUndefined();
    expect(WITHOUT_OPTIONAL.knp).toBeUndefined();
    expect(sellerConfigIssues('invoice', { details: WITHOUT_OPTIONAL, invalid: [] })).toEqual([]);
  });

  it.each([...ORDER_DOCUMENT_KINDS])('%s omits them instead of printing a placeholder', async (kind) => {
    const { text } = await render(kind, orderSource(), { seller: WITHOUT_OPTIONAL });
    expect(text.flat).not.toMatch(/undefined|null|—\s*—/);
    // The supplier block carries no phone; the buyer's own phone still does.
    const supplier = text.flat.slice(text.flat.indexOf('ПОСТАВЩИК'), text.flat.indexOf('ПОКУПАТЕЛЬ'));
    expect(supplier).not.toContain('Телефон');
    expect(text.flat).toContain('Тестовый Продавец');
  });

  it('invoice prints the beneficiary block with an empty КНП cell, and quotes/IBAN intact', async () => {
    const { text } = await render('invoice', orderSource(), { seller: WITHOUT_OPTIONAL });
    const t = text.flat;
    expect(t).toContain('ИП "Тестовый Продавец"');
    expect(t).toContain('АО "Тестовый Банк"');
    // IBAN on one unbroken run — never hyphenated or split across lines.
    expect(t).toContain('KZ00TEST000000000000');
    expect(t).toContain('БИК TESTKZKA');
    expect(t).toContain('Кбе 17');
    expect(t).toMatch(/Код назначения платежа Счёт на оплату/);
    expect(t.slice(t.indexOf('Поставщик:'), t.indexOf('Покупатель:'))).not.toContain('тел.');
  });
});

describe('persisted totals are printed verbatim', () => {
  it('uses the persisted VAT even when it is not the rate applied to today\'s net — VAT is never recalculated', async () => {
    const source = orderSource({ items: [item({ vat: 12345 })] });
    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const { text } = await render(kind, source);
      expect(text.flat).toContain('НДС 16% 12 345,00 ₸');
      expect(text.flat).toContain('204 324,00 ₸');
      expect(text.flat).not.toContain('30 717');
    }
  });

  it('prints kopeck-level (tiyn) amounts exactly, without rounding to whole tenge', async () => {
    const source = orderSource({ items: [item({ unit: '1000.55', vat: '160.09' })] });
    const { text } = await render('invoice', source);
    expect(text.flat).toContain('1 000,55');
    expect(text.flat).toContain('Всего к оплате 1 160,64 ₸');
    expect(text.flat).toContain('Одна тысяча сто шестьдесят тенге 64 тиын');
  });
});

describe('multiple items and multiple shelving sections', () => {
  it('lists every item with its sections, walls and order-time options', async () => {
    const source = orderSource({
      items: [
        item({
          id: 'a',
          configuration: configuration([1000, 700, 1200], {
            sections: [
              { id: 's1', width: 1000, height: 2000, shelves: 5, rearWall: true, leftWall: false, rightWall: false },
              { id: 's2', width: 700, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false },
              { id: 's3', width: 1200, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: true },
            ],
            metalFootPad: true,
          }),
          snapshot: { options: ['Металлический подпятник'] },
          unit: 484962,
        }),
        item({ id: 'b', configuration: configuration([800], {
            depth: 600,
            quantity: 2,
            sections: [{ id: 'sec-0', width: 800, height: 2500, shelves: 6, rearWall: false, leftWall: false, rightWall: false }],
          }), unit: 150000, quantity: 2 }),
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
      expectReconciles(model(kind, source));
    }
    const { text } = await render('commercial-proposal', source);
    expect(text.flat).toContain('Ширина секций 1000 + 700 + 1200 мм');
    expect(text.flat).toContain('Секций 3');
    expect(text.flat).toContain('Дополнительно Металлический подпятник');
    expect(text.flat).toContain('2 компл. × 150 000,00 ₸ = 300 000,00 ₸');
  });
});

describe('layout robustness', () => {
  it('wraps very long names and unbroken strings without losing text', async () => {
    const longCompany = `ТОО «${'Очень длинное название компании Қазақстан '.repeat(7).trim()}»`.slice(0, 300);
    const unbroken = 'А'.repeat(180);
    const source = orderSource({
      buyer: { type: 'LEGAL_ENTITY', companyName: longCompany, fullName: unbroken, binIin: '123456789012' },
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
      orderSource({ buyer: { fullName: 'Әсел Ұлықбекқызы Өмірзақова', city: 'Шымкент' } }),
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
      buyer: {
        type: 'LEGAL_ENTITY',
        fullName: '<script>alert("xss")</script>',
        companyName: ') Tj /JavaScript (app.alert(1)) /S /JavaScript /OpenAction',
        binIin: '123456789012',
        email: 'x@example.com"><img src=x onerror=alert(1)>',
        city: 'Алматы‮такса 0‬',
      },
      delivery: { methodId: null, address: '{{constructor.constructor("alert(1)")()}} ', city: null, floor: null, hasLift: null, date: null },
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

describe('idempotency, purity and dates', () => {
  it('the same order and issuance yield identical bytes, and building never touches the persisted source', async () => {
    const source = orderSource({ items: [item({ id: 'a', assembly: 3000 }), item({ id: 'b', unit: 5000, quantity: 3, discount: 100 })] });
    const before = snapshotOf(source);
    for (const kind of ['commercial-proposal', 'invoice'] as const) {
      const first = await render(kind, source);
      const second = await render(kind, source);
      expect(Buffer.compare(first.bytes, second.bytes)).toBe(0);
    }
    expect(snapshotOf(source)).toBe(before);
  });

  it('dates the document by its persisted issuance in Kazakhstan time — not by the order, not by the server clock', async () => {
    const late = orderSource({ createdAt: new Date('2026-08-30T08:00:00.000Z') });
    const { text } = await render('invoice', late, { issuedAt: new Date('2026-09-13T21:30:00.000Z') });
    expect(text.flat).toContain('Счёт на оплату № INV-MS-20260830-4HB57 от 14 сентября 2026 г.');
    expect(text.flat).not.toContain('от 30 августа 2026 г. ');
  });

  it('prints the seller and brand from the issuance snapshot it is given', async () => {
    const { text } = await render('commercial-proposal', orderSource(), {
      brandName: 'Старый бренд',
      seller: { ...SELLER, legalName: 'ТОО «Продавец на дату выставления»' },
    });
    expect(text.flat).toContain('Старый бренд');
    expect(text.flat).toContain('ТОО «Продавец на дату выставления»');
    expect(text.flat).not.toContain('ТОО «Тестовый Продавец»');
  });
});

describe('legacy orders — placed before document snapshots existed', () => {
  it('refuses both documents when the buyer snapshot is missing, and says why', () => {
    const legacy = orderSource({ buyerSnapshot: null });
    const attempt = () => buildOrderDocumentContent(legacy);
    expect(attempt).toThrow(DocumentUnavailableError);
    try {
      attempt();
    } catch (error) {
      expect((error as DocumentUnavailableError).message).toContain('до того, как система начала сохранять исторические данные');
      expect((error as DocumentUnavailableError).details).toEqual(['Не сохранены данные покупателя на момент заказа.']);
    }
  });

  it('refuses when any item lacks its order-time snapshot — no partial reconstruction', () => {
    const legacy = orderSource({ items: [item({ id: 'a' }), item({ id: 'b', documentSnapshot: null })] });
    try {
      buildOrderDocumentContent(legacy);
      expect.unreachable('a legacy order must not produce a document');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentUnavailableError);
      expect((error as DocumentUnavailableError).details.join(' ')).toContain('позиций без снимка: 1 из 2');
    }
  });
});

describe('integrity guard — a self-contradictory order is refused, never "fixed"', () => {
  const refuses = (source: OrderDocumentSource) => expect(() => buildOrderDocumentContent(source)).toThrow(DocumentIntegrityError);

  it('refuses when line totals do not add up to netTotal', () => {
    const source = orderSource();
    source.netTotal = decimal(191980);
    source.grandTotal = decimal(191980 + 30717);
    refuses(source);
  });

  it('refuses when netTotal + VAT is not grandTotal', () => {
    const source = orderSource();
    source.grandTotal = decimal(1);
    refuses(source);
  });

  it('refuses when the snapshot disagrees with the persisted item columns', () => {
    const wrongUnit = item();
    wrongUnit.unitNetPrice = decimal(191978);
    refuses(orderSource({ items: [wrongUnit] }));

    const wrongQuantity = item();
    wrongQuantity.quantity = 2;
    refuses(orderSource({ items: [wrongQuantity] }));
  });

  it('refuses a breakdown that does not reconcile with its own totals', () => {
    const broken = item({ assembly: 1000 });
    const snapshot = broken.documentSnapshot as { pricing: { goodsAmount: string } };
    snapshot.pricing.goodsAmount = '191000.00';
    refuses(orderSource({ items: [broken] }));
  });

  it('refuses items priced under different VAT rules, or a corrupted snapshot', () => {
    refuses(orderSource({ items: [item({ id: 'a' }), item({ id: 'b', pricesIncludeVat: true })] }));
    refuses(orderSource({ items: [item({ id: 'a' }), item({ id: 'b', vatPercent: 12 })] }));
    refuses(orderSource({ items: [item({ documentSnapshot: { version: 1, modelName: 'x' } })] }));
    refuses(orderSource({ buyerSnapshot: { version: 1, fullName: 'Без типа' } }));
  });

  it('refuses an unreadable configuration or an empty order', () => {
    refuses(orderSource({ items: [item({ configuration: { modelSlug: 'ms-standard' } })] }));
    refuses({ ...orderSource(), items: [] });
  });
});
