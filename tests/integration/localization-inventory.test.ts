import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ACCESSORIES, ASSEMBLY_SERVICES, CATALOG_PRODUCTS, DELIVERY_METHODS, MODELS } from '@/lib/data/seed-data';
import { CUSTOMER_ACCESSORY_IDS } from '@/components/configurator/AdvancedSettingsAccordion';
import { isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';

/**
 * docs/localization/public-strings.csv is the inventory the Kazakh
 * localization is built from. It must match the CURRENT public source in
 * both directions: every row is still consumed by public code (through the
 * generated dictionary src/lib/i18n/strings, by id — or, for catalogue data,
 * through seed-data's ru/kk values), and every customer-visible Cyrillic
 * string in public source is represented by a row.
 * Owner-reviewed Kazakh text in it must survive every resync untouched.
 */

const CSV_PATH = 'docs/localization/public-strings.csv';
const COLUMNS = ['id', 'section', 'route', 'source_file', 'context', 'ru_text', 'kk_proposed', 'review_status', 'notes'];
const CYRILLIC = /[А-Яа-яЁё]/;
const KAZAKH_LETTERS = /[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/;
const CYRILLIC_WORD_CHAR = 'А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі';

type Row = Record<(typeof COLUMNS)[number], string>;

/** RFC 4180 parser: quoted fields, "" escapes, CRLF records. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { record.push(field); records.push(record); record = []; field = ''; i += 1; }
    else field += ch;
  }
  if (field !== '' || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

const bytes = readFileSync(CSV_PATH);
const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3));
const [header, ...records] = parseCsv(text);
const rows: Row[] = records.map((r) => Object.fromEntries(COLUMNS.map((c, i) => [c, r[i]])) as Row);
const byId = new Map(rows.map((r) => [r.id, r]));
const row = (id: string) => {
  const found = byId.get(id);
  if (!found) throw new Error(`inventory row ${id} is missing`);
  return found;
};

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const sourceCache = new Map<string, string>();
function source(file: string): string {
  if (!sourceCache.has(file)) sourceCache.set(file, ws(readFileSync(file, 'utf8')).replace(/\\"/g, '"').replace(/\\'/g, "'"));
  return sourceCache.get(file)!;
}
const sourceFiles = (r: Row) => r.source_file.split(';').map((f) => f.trim()).filter(Boolean);

describe('encoding and schema', () => {
  it('is UTF-8 with BOM, CRLF-only, 9 comma-separated columns and unique ids', () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const withoutCrlf = text.replace(/\r\n/g, '');
    expect(withoutCrlf.includes('\n')).toBe(false);
    expect(withoutCrlf.includes('\r')).toBe(false);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(header).toEqual(COLUMNS);
    for (const r of records) expect(r, r[0]).toHaveLength(COLUMNS.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.id, r.id).toMatch(/^[A-Z]{1,2}-\d{3}$/);
      expect(r.ru_text, r.id).not.toBe('');
      expect(r.kk_proposed, r.id).not.toBe('');
      expect(r.review_status, r.id).toBe('NEEDS_REVIEW');
    }
  });

  it('has intact Kazakh letters: no U+FFFD, no "?" inside words, no mojibake, no mixed-script words', () => {
    expect(text.includes('�')).toBe(false);
    expect(text.normalize('NFC')).toBe(text);
    const inWordQuestion = new RegExp(`[${CYRILLIC_WORD_CHAR}]\\?[${CYRILLIC_WORD_CHAR}]`);
    for (const r of rows) {
      for (const value of [r.ru_text, r.kk_proposed]) {
        expect(inWordQuestion.test(value), `${r.id}: ${value}`).toBe(false);
        // UTF-8 bytes re-read as Latin-1 / Windows-125x start with these letters.
        expect(/[ÐÑÃÒÓ]/.test(value), `${r.id}: ${value}`).toBe(false);
        for (const word of value.match(/[\p{L}]+/gu) ?? []) {
          expect(/[A-Za-z]/.test(word) && CYRILLIC.test(word), `${r.id}: mixed-script word "${word}"`).toBe(false);
        }
      }
    }
    // Windows-1251 has none of ә ғ қ ң ө ұ ү һ і — a 1251 round trip wipes them all.
    expect(rows.filter((r) => KAZAKH_LETTERS.test(r.kk_proposed)).length).toBeGreaterThan(400);
    expect(row('FQ-004').kk_proposed).toBe('Стандартты емес өлшемге тапсырыс беруге бола ма?');
  });
});

describe('owner-reviewed Kazakh text', () => {
  it('keeps owner corrections on rows whose Russian source did not change, byte for byte', () => {
    // Each of these differs from the seed-data / first-draft wording: the owner edited them.
    const owner: Record<string, string> = {
      'F-001': 'Бөлімдер',
      'F-011': 'ҚҚС төлеушісіміз, қажетті құжаттардың толық пакетін ұсынамыз',
      'HM-048': 'Тауарды алу тәсілдері',
      'CF-084': 'Қоймадан алып кету',
      'CF-090': 'Көлік компаниясына тапсыру',
      'CF-091': 'Сіз таңдаған көлік компаниясының терминалына жеткізу',
      'FQ-002': 'Жинау үшін дәнекерлеу қажет пе?',
      'FQ-004': 'Стандартты емес өлшемге тапсырыс беруге бола ма?',
      'SE-012': 'MS Стандарт стеллаж— модульдік металл стеллажы | Қазақстанда сатып алу',
      // Owner text; only the rack term was corrected (сөре → стеллаж, terminology.md).
      'DL-002':
        'Біз MS стеллаждарын Қазақстан бойынша жеткіземіз және тапсырыс берушінің нысанында кәсіби жинау қызметін ұсынамыз. ' +
        'Алматы, Астана, Қарағанды және Шымкент қалаларында жеткізу — тегін, сол күні. Қазақстанның басқа қалалары мен ' +
        'өңірлеріне жеткізу — 2–3 күн. Жеткізу құны жеке есептеледі. Стеллаждың құны таңдалған жинақтамаға қарай ' +
        'конфигураторда автоматты түрде есептеледі. Тек конфигураторда ұсынылған өлшемдер қолжетімді.',
    };
    for (const [id, kk] of Object.entries(owner)) expect(row(id).kk_proposed, id).toBe(kk);
  });

  it('keeps the approved business wording for delivery, sizes and the configurator hint', () => {
    const fourCities = { ru: 'Доставка по Алматы, Астане, Караганде и Шымкенту — бесплатно, в тот же день.', kk: 'Алматы, Астана, Қарағанды және Шымкент қалаларында жеткізу — тегін, сол күні.' };
    const regional = {
      ru: 'Доставка в другие города и регионы Казахстана — 2–3 дня. Стоимость доставки рассчитывается индивидуально.',
      kk: 'Қазақстанның басқа қалалары мен өңірлеріне жеткізу — 2–3 күн. Жеткізу құны жеке есептеледі.',
    };
    expect(row('CF-087')).toMatchObject({ ru_text: fourCities.ru, kk_proposed: fourCities.kk });
    expect(row('HM-050')).toMatchObject({ ru_text: fourCities.ru.slice(0, -1), kk_proposed: fourCities.kk.slice(0, -1) });
    expect(row('CF-089')).toMatchObject({ ru_text: regional.ru, kk_proposed: regional.kk });
    expect(row('HM-051')).toMatchObject({ ru_text: regional.ru, kk_proposed: regional.kk });
    expect(row('CF-052')).toMatchObject({ ru_text: `${fourCities.ru} ${regional.ru}`, kk_proposed: `${fourCities.kk} ${regional.kk}` });
    expect(row('FQ-005')).toMatchObject({
      ru_text: 'Нет. Доступны только размеры, представленные в конфигураторе.',
      kk_proposed: 'Жоқ. Тек конфигураторда көрсетілген өлшемдер қолжетімді.',
    });
    expect(row('CF-021')).toMatchObject({
      ru_text: 'Нажмите на секцию, чтобы выбрать её, или перетащите точки изменения размера.',
      kk_proposed: 'Секцияны таңдау үшін басыңыз немесе өлшемді өзгерту нүктелерін сүйреңіз.',
    });
  });
});

/**
 * Owner-approved rule (docs/localization/terminology.md): the rack is
 * «стеллаж», a shelf is «сөре». «сөре» must never name the whole rack,
 * because the configurator shows both the rack and its individual shelves.
 */
describe('rack vs shelf terminology', () => {
  const RACK_RU = /стеллаж\p{L}*/giu; // стеллаж, стеллажи, стеллажей, стеллажная…
  const SHELF_RU = /(?<!\p{L})пол(?:к|ок|очк)\p{L}*/giu; // полка, полки, полок, полку, полками…
  const RACK_KK = /стеллаж\p{L}*/giu;
  const SHELF_KK = /(?<!\p{L})сөре\p{L}*/giu; // сөре, сөрелер, сөрені, сөренің, сөреге, сөрелі…
  const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

  it('never uses a сөре-form where the Russian has no shelf (полка) at all', () => {
    const wrong = rows.filter((r) => count(SHELF_KK, r.kk_proposed) > 0 && count(SHELF_RU, r.ru_text) === 0);
    expect(wrong.map((r) => `${r.id}: ${r.ru_text} → ${r.kk_proposed}`)).toEqual([]);
  });

  it('translates every стеллаж-form as «стеллаж», and never uses more сөре-forms than the Russian has shelves', () => {
    // Semantic, not a blind ban: a sentence may mention the rack AND its shelves
    // («архивный стеллаж 4 полки» → «4 сөрелі мұрағат стеллажы»). What is checked is
    // that the rack is named «стеллаж», and that every сөре is backed by a полка.
    const problems: string[] = [];
    for (const r of rows) {
      const racks = count(RACK_RU, r.ru_text);
      const shelves = count(SHELF_RU, r.ru_text);
      if (racks > 0 && count(RACK_KK, r.kk_proposed) === 0) problems.push(`${r.id}: rack not called «стеллаж» → ${r.kk_proposed}`);
      if (count(SHELF_KK, r.kk_proposed) > shelves) problems.push(`${r.id}: more сөре than полка → ${r.kk_proposed}`);
    }
    expect(problems).toEqual([]);
  });

  it('never calls a shelving system a shelf system', () => {
    for (const r of rows) expect(r.kk_proposed, r.id).not.toMatch(/сөре\p{L}* жүйе|сөрелі жүйе/iu);
  });

  it('keeps сөре where the Russian really means a shelf', () => {
    expect(row('G-011').kk_proposed).toBe('{N} сөре');
    expect(row('PR-013').kk_proposed).toBe('Сөрелер');
    expect(row('CF-032').kk_proposed).toBe('Сөрелер');
    expect(row('PR-028').kk_proposed).toBe('MS Стандарт 2000×1000×300, 4 сөре');
    expect(row('HM-038').kk_proposed).toBe('Биіктігі, ені, тереңдігі және сөрелер саны');
    expect(row('CF-100').kk_proposed).toBe('Сөрені күшейту');
    // rack and shelf in one sentence
    expect(row('SE-014').kk_proposed).toBe('MS Стандарт 2000×1000×300 — 4 сөрелі мұрағат стеллажы | сатып алу');
  });

  it('locks the owner-reviewed rack translations', () => {
    const locked: Record<string, string> = {
      'DL-013': 'Стеллаждың құнын есептеу',
      'H-012': 'Стеллажды конфигурациялау',
      'F-004': 'Стеллаждар каталогы',
      'HM-006': 'Стеллаждар {баға}-дан бастап · бір сөреге 150 кг-ға дейін жүктеме',
      'G-001': 'MS Стеллаждар',
      'G-003': 'Модульдік металл стеллаждар',
      'CR-005': 'Тағы бір стеллаж қосу',
      'CF-006': 'Стеллаждың алдынан қарағандағы көрінісінің сызбасы',
    };
    for (const [id, kk] of Object.entries(locked)) expect(row(id).kk_proposed, id).toBe(kk);
    expect(row('G-004').kk_proposed).toContain('MS модульдік металл стеллаждары.');
  });

  it('locks the owner-approved V2.1 limit messages (2026-09-24)', () => {
    const approved: Record<string, string> = {
      'CF-103': 'Бір стеллажда ең көбі {N} секция болуы мүмкін. Артық секцияларды жойыңыз.',
      'CR-018': 'Санын азайтыңыз немесе позицияны жойыңыз.',
      'VL-018': 'Бір тапсырыста ең көбі {N} стеллажға тапсырыс беруге болады.',
    };
    for (const [id, kk] of Object.entries(approved)) {
      expect(row(id).kk_proposed, id).toBe(kk);
      expect(row(id).notes, id).toContain('утверждённая владельцем формулировка (2026-09-24)');
      expect(row(id).notes, id).not.toContain('требует проверки');
    }
  });
});

describe('FAQ inventory', () => {
  // The model page moved under the public locale segment; the CSV keeps the
  // path it was inventoried under.
  const faqFile = 'src/app/catalog/[model]/page.tsx';
  const faqSource = readFileSync('src/app/[locale]/catalog/[model]/page.tsx', 'utf8');
  const faq = [...faqSource.matchAll(/(question|answer):\s*FQ\['(FQ-\d{3})'\]/g)].map((m) => ({ kind: m[1], text: row(m[2]).ru_text }));
  const faqRows = rows.filter((r) => r.section === 'FAQ' && r.id !== 'FQ-001');

  it('has exactly one current inventory row per FAQ question and answer (also FAQPage JSON-LD)', () => {
    expect(faq.length).toBeGreaterThanOrEqual(10);
    expect(faqRows.map((r) => r.ru_text).sort()).toEqual(faq.map((f) => f.text).sort());
    faq.forEach((f, i) => {
      const r = faqRows.find((x) => x.ru_text === f.text)!;
      const n = Math.floor(i / 2) + 1;
      expect(r.context, r.id).toBe(`${f.kind === 'question' ? 'Вопрос' : 'Ответ'} ${n} (также в структурированных данных FAQPage)`);
      expect(r.source_file).toBe(faqFile);
    });
  });

  it('carries the current delivery-time and non-standard-size answers, not the old ones', () => {
    expect(row('FQ-004').ru_text).toBe('Можно ли заказать нестандартный размер?');
    expect(row('FQ-006').ru_text).toBe('Какие сроки доставки?');
    expect(row('FQ-007').ru_text).toBe(
      'По Алматы, Астане, Караганде и Шымкенту доставляем в тот же день. В другие города и регионы Казахстана — в течение 2–3 дней.',
    );
    const all = rows.map((r) => r.ru_text).join('\n');
    for (const stale of ['Какой срок изготовления', 'от 2 до 7 дней', 'свяжитесь с менеджером через WhatsApp для индивидуального', 'Срок изготовления']) {
      expect(all.includes(stale), stale).toBe(false);
    }
  });

  it('contains the delivery-cost question and answer', () => {
    expect(row('FQ-010')).toMatchObject({ section: 'FAQ', ru_text: 'Сколько стоит доставка?' });
    expect(row('FQ-011')).toMatchObject({
      section: 'FAQ',
      ru_text:
        'По Алматы, Астане, Караганде и Шымкенту доставка бесплатная. В другие города и регионы Казахстана стоимость доставки рассчитывается индивидуально.',
    });
    expect(row('FQ-011').kk_proposed).toContain('жеткізу құны жеке есептеледі.');
  });
});

describe('CSV ↔ current public source', () => {
  function listSourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) return listSourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  /** The generated dictionary is the CSV itself, not a consumer of it. */
  const DICTIONARY_DIR = /^src\/lib\/i18n\/strings\//;
  const consumerSource = listSourceFiles('src')
    .filter((f) => !DICTIONARY_DIR.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  /**
   * Catalogue data: the runtime reads it from the catalog (Prisma *Kk
   * columns / seed-data LocalizedText), not from the dictionary. Checked
   * value by value in "public catalogue data from seed-data is in the
   * inventory" and in the seed-data Kazakh test below.
   */
  const isCatalogueDataRow = (r: Row) => sourceFiles(r).every((f) => f === 'src/lib/data/seed-data.ts');

  /** Rows rendered by a formatter that has no words to translate (identical in both languages). */
  const FORMATTER_ROWS: Record<string, string> = {
    'G-009': 'src/lib/money.ts formatKg — "кг" is the same in both languages',
    'G-010': 'src/lib/money.ts formatPrice — the ₸ symbol is never translated',
  };

  /**
   * Two rows inventoried for ONE usage (public-strings-summary.md §5): the
   * not-found model page title is both PR-001 (page) and SE-040 (metadata).
   * The code renders SE-040; both rows must stay textually identical.
   */
  const SAME_USAGE_AS: Record<string, string> = { 'PR-001': 'SE-040' };

  it('every inventory row is consumed by public code (no stale rows)', () => {
    const stale: string[] = [];
    for (const r of rows) {
      if (isCatalogueDataRow(r)) continue;
      if (FORMATTER_ROWS[r.id]) {
        expect(r.ru_text).toBe(r.kk_proposed);
        continue;
      }
      if (SAME_USAGE_AS[r.id]) {
        const twin = row(SAME_USAGE_AS[r.id]);
        expect([r.ru_text, r.kk_proposed], r.id).toEqual([twin.ru_text, twin.kk_proposed]);
        continue;
      }
      if (!consumerSource.includes(`['${r.id}']`)) stale.push(`${r.id}: ${r.ru_text}`);
    }
    expect(stale).toEqual([]);
  });

  it('every catalogue-data row still exists in seed-data', () => {
    const seed = source('src/lib/data/seed-data.ts');
    const stale: string[] = [];
    for (const r of rows.filter(isCatalogueDataRow)) {
      const fragments = r.ru_text.split(/\{[^}]*\}|…/).map((f) => ws(f).replace(/^[\s.,:;«»"()—-]+|[\s.,:;«»"()—-]+$/g, '')).filter((f) => f.length >= 3);
      const pieces = ['CF-094', 'CF-095', 'CF-096'].includes(r.id) ? r.ru_text.match(/[А-Яа-яЁё]{3,}/g) ?? [] : fragments;
      for (const p of pieces) if (!seed.includes(p)) stale.push(`${r.id}: "${p}"`);
    }
    expect(stale).toEqual([]);
  });

  /**
   * Whole files that are never shown on the public site (see
   * public-strings-summary.md §8 for the reasoning behind each).
   */
  const EXCLUDED_FILES = [
    /^src\/(app|components|lib)\/admin\//, /^src\/app\/api\/admin\//, // admin panel
    /^src\/lib\/documents\//, // invoices/waybills/acts issued from the admin panel
    /^src\/lib\/notifications\//, // manager / CRM notifications
    /^src\/lib\/formula\//, // formula-engine errors — server-side internalDetails only
    /^src\/lib\/auth\//, /^src\/lib\/startup\//, /^src\/lib\/db\//, /^src\/lib\/env\.ts$/, /^src\/instrumentation\.ts$/, // server/process
    /^src\/lib\/orders\/(status-labels|customer-labels|db-store)\.ts$/, // admin status names, admin client-type labels, audit log
    /^src\/lib\/payments\/service\.ts$/, // payment audit-log actor name
    /^src\/lib\/data\/seed-data\.ts$/, // checked entry by entry below: most of it is non-public models / colours / accessories / kk
    /^src\/lib\/i18n\/strings\//, // the generated dictionary: the CSV itself (see public-strings-dictionary.test.ts)
  ];

  /** Single literals inside otherwise public files that are intentionally not inventoried. */
  const EXCLUDED_STRINGS: Record<string, string[]> = {
    // Internal BOM diagnostics → PriceResult.internalWarnings / PriceFailure.internalDetails (never sent to the browser).
    'src/lib/pricing/bom.ts': [
      'Не найден компонент для правила «',
      'Ошибка расчёта правила',
      'Правило «',
    ],
    'src/lib/pricing/engine.ts': ['Скидка ограничена минимальной наценкой и была уменьшена'],
    // Message composed by a manager from the admin order card, not by the public site.
    'src/lib/whatsapp.ts': ['! По вашему заказу №', 'хотим уточнить детали.'],
    // Dead code: axisAccusativeRu() is never called.
    'src/components/configurator/resize/dimension-scale.ts': ['глубину'],
    // City-name matching aliases and an unused name map — never rendered.
    'src/lib/delivery/city-delivery.ts': ['Караганда', 'нур-султан', 'нұр-сұлтан'],
    // labelKk — already the target language.
    'src/lib/config/site.ts': ['Жеткізу және төлем', 'Байланыс'],
  };

  function cyrillicLiterals(file: string): { line: number; text: string }[] {
    const code = readFileSync(join(process.cwd(), file), 'utf8');
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: { line: number; text: string }[] = [];
    const push = (node: ts.Node, value: string) => {
      const t = ws(value);
      if (CYRILLIC.test(t)) found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: t });
    };
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) push(node, node.text);
      else if (ts.isTemplateExpression(node)) {
        push(node, node.head.text);
        for (const span of node.templateSpans) push(span, span.literal.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  }

  const inventory = rows.map((r) => ws(r.ru_text)).join('\n');
  const covered = (value: string) => {
    const t = value.replace(/^[•\s.,:;—-]+|[\s.,:;—-]+$/g, '');
    return t === '' || inventory.includes(t);
  };

  it('every customer-visible Cyrillic string in public source is in the inventory', () => {
    const files = listSourceFiles('src').filter((f) => !EXCLUDED_FILES.some((re) => re.test(f)));
    const missing: string[] = [];
    for (const file of files) {
      const allowed = EXCLUDED_STRINGS[file] ?? [];
      for (const { line, text: value } of cyrillicLiterals(file)) {
        if (allowed.includes(value) || covered(value)) continue;
        missing.push(`${file}:${line} ${value}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('public catalogue data from seed-data is in the inventory', () => {
    const values: string[] = [];
    for (const m of DELIVERY_METHODS.filter((d) => d.active)) values.push(m.name.ru, m.description.ru);
    for (const a of ASSEMBLY_SERVICES.filter((s) => s.active)) values.push(a.name.ru, a.description.ru);
    for (const a of ACCESSORIES.filter((x) => (CUSTOMER_ACCESSORY_IDS as readonly string[]).includes(x.id))) values.push(a.name.ru);
    for (const m of MODELS.filter((x) => isModelSlugPubliclyVisible(x.slug))) values.push(m.name.ru, m.seo.title, m.seo.description);
    for (const p of CATALOG_PRODUCTS.filter((x) => x.published && isModelSlugPubliclyVisible(x.modelSlug))) values.push(p.name.ru, p.description.ru, p.seo.title, p.seo.description);
    expect(values.filter((v) => !covered(ws(v)))).toEqual([]);
  });

  it('inventories the new public validation messages', () => {
    expect(row('VL-014').ru_text).toBe('Укажите город');
    expect(source('src/lib/pricing/schema.ts')).toContain("VL['VL-014']");
    expect(row('ER-059').ru_text).toBe('Одна из конфигураций в корзине некорректна. Откройте её в конфигураторе и добавьте в корзину заново.');
    expect(byId.has('CF-063')).toBe(false);
  });
});
