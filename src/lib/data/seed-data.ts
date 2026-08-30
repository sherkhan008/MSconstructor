import type {
  Accessory,
  AssemblyService,
  CatalogProduct,
  ColorOption,
  ConfigurationRule,
  DeliveryMethod,
  DimensionOption,
  LoadCapacityOption,
  PricingSettings,
  ProductModel,
  PromoCode,
  ShelvingComponent,
} from '@/lib/types/domain';

/* ============================================================================
 * SAMPLE / DEVELOPMENT DATA — NOT REAL SUPPLIER PRICING.
 *
 * Every price in this file is illustrative placeholder data used so the
 * application runs end-to-end without external services. Before production
 * launch, replace these figures via the admin panel's price import (CSV/XLSX)
 * or by editing the seeded database rows — never by hand-editing this file
 * for a live deployment.
 *
 * This module is imported by both:
 *   - the in-memory development repository (src/lib/data/repository.ts), used
 *     automatically whenever DATABASE_URL is not configured, and
 *   - prisma/seed.ts, so a freshly migrated PostgreSQL database starts with
 *     the exact same catalog the mock repository serves.
 * ========================================================================== */

// Union of every height ever offered by any model — includes MS Standard's
// current [500..3000] set (see MODELS below) plus MS Strong/Archive MS's
// older values (1600, 1850) that those two models still reference and that
// therefore must keep a real DimensionOption + UPRIGHT/CROSS_BRACE component
// behind them. Each model's own `heights` array is still the authoritative
// per-model allow-list — this is only the catalog-wide superset that
// component generation below iterates over.
export const HEIGHTS: DimensionOption[] = [
  500, 1000, 1200, 1500, 1600, 1800, 1850, 2000, 2200, 2300, 2400, 2500, 3000,
].map((value, i) => ({
  id: `height-${value}`,
  value,
  label: `${value} мм`,
  priceAdjustment: 0,
  leadTimeDays: value >= 2400 ? 5 : 2,
  sortOrder: i,
  active: true,
  models: [],
}));

export const WIDTHS: DimensionOption[] = [700, 1000, 1200, 1500].map((value, i) => ({
  id: `width-${value}`,
  value,
  label: `${value} мм`,
  priceAdjustment: 0,
  leadTimeDays: 2,
  sortOrder: i,
  active: true,
  models: [],
}));

export const DEPTHS: DimensionOption[] = [300, 400, 500, 600, 700, 800].map((value, i) => ({
  id: `depth-${value}`,
  value,
  label: `${value} мм`,
  priceAdjustment: 0,
  leadTimeDays: 2,
  sortOrder: i,
  active: true,
  models: [],
}));

export const LOAD_CAPACITIES: LoadCapacityOption[] = [
  {
    id: 'load-100',
    value: 100,
    label: '100 кг на полку',
    models: ['ms-standard', 'archive-ms'],
    maxWidth: 1500,
    // Raised from 600 alongside MS Standard's new depth ceiling (800mm) —
    // archive-ms never reaches beyond its own depths ([300, 400]), so this
    // only actually widens what MS Standard can select.
    maxDepth: 800,
    sortOrder: 0,
    active: true,
  },
  {
    id: 'load-150',
    value: 150,
    label: '150 кг на полку',
    models: ['ms-standard', 'ms-strong', 'archive-ms'],
    maxWidth: 1500,
    // Same reasoning as load-100 — ms-strong/archive-ms stay within their
    // own (unchanged) depth lists regardless.
    maxDepth: 800,
    sortOrder: 1,
    active: true,
  },
  {
    id: 'load-300',
    value: 300,
    label: '300 кг на полку',
    models: ['ms-strong'],
    maxWidth: 1200,
    maxDepth: 600,
    sortOrder: 2,
    active: true,
    note: {
      ru: 'Доступно только для MS Strong при ширине до 1200 мм',
      kk: 'Тек MS Strong үшін, ені 1200 мм дейін қолжетімді',
    },
  },
];

export const COLORS: ColorOption[] = [
  {
    id: 'color-grey',
    name: { ru: 'Стандартный серый', kk: 'Стандартты сұр' },
    hex: '#8B939D',
    pricePercent: 0,
    leadTimeDays: 0,
    available: true,
    sortOrder: 0,
  },
  {
    id: 'color-light-grey',
    name: { ru: 'Светло-серый', kk: 'Ашық сұр' },
    hex: '#C7CBD1',
    pricePercent: 2,
    leadTimeDays: 3,
    available: true,
    sortOrder: 1,
  },
  {
    id: 'color-dark-grey',
    name: { ru: 'Тёмно-серый', kk: 'Қою сұр' },
    hex: '#4A4F57',
    pricePercent: 2,
    leadTimeDays: 3,
    available: true,
    sortOrder: 2,
  },
  {
    id: 'color-white',
    name: { ru: 'Белый', kk: 'Ақ' },
    hex: '#F2F3F1',
    pricePercent: 4,
    leadTimeDays: 5,
    available: true,
    sortOrder: 3,
  },
  {
    id: 'color-black',
    name: { ru: 'Чёрный', kk: 'Қара' },
    hex: '#1C2024',
    pricePercent: 4,
    leadTimeDays: 5,
    available: true,
    sortOrder: 4,
  },
  {
    id: 'color-blue',
    name: { ru: 'Синий', kk: 'Көк' },
    hex: '#2F5D8A',
    pricePercent: 5,
    leadTimeDays: 7,
    available: true,
    sortOrder: 5,
  },
  {
    id: 'color-ral',
    name: { ru: 'По RAL (индивидуально)', kk: 'RAL бойынша (жеке)' },
    hex: '#A63D40',
    pricePercent: 12,
    leadTimeDays: 14,
    available: true,
    sortOrder: 6,
  },
];

/* -------------------------------------------------------------------------- */
/* Product models                                                              */
/* -------------------------------------------------------------------------- */

export const MODELS: ProductModel[] = [
  {
    id: 'model-ms-standard',
    slug: 'ms-standard',
    name: { ru: 'MS Стандарт', kk: 'MS Стандарт' },
    shortDescription: {
      ru: 'Универсальный болтовой стеллаж для склада, архива и офиса',
      kk: 'Қойма, мұрағат және кеңсеге арналған әмбебап сөрелі жүйе',
    },
    description: {
      ru: 'MS Стандарт — универсальная модульная стеллажная система на болтовом соединении. Подходит для складов, архивов, магазинов и офисов. Быстро собирается без сварки, легко расширяется дополнительными секциями и полками.',
      kk: 'MS Стандарт — бұрандамалы қосылысы бар әмбебап модульді сөрелі жүйе. Қойма, мұрағат, дүкен және кеңсе үшін қолайлы.',
    },
    image: '/images/models/ms-standard.svg',
    gallery: ['/images/models/ms-standard.svg', '/images/gallery/warehouse-1.svg'],
    maxLoadKg: 150,
    loadCapacities: [100, 150],
    // The authoritative current MS Standard matrix — see
    // src/lib/pricing/ms-standard-compatibility.ts for the real,
    // cross-dimensional rules (which depths a given section width
    // supports, which heights allow how many shelves). These flat arrays
    // are the union/ceiling those rules stay within; they are NOT
    // themselves a claim that every width×depth or height×shelves
    // combination they imply is actually valid — the compatibility module
    // is what enforces that everywhere (UI selects, drag allowedValues,
    // normalization, server validation). Old heights 500/1000/1200/2300/
    // 2400 are obsolete for MS Standard as of this matrix and were removed
    // here; they remain valid HeightOption rows for other models (e.g.
    // ms-strong still uses 2400) — see HEIGHTS above, never delete a global
    // dimension row just because one model stops using its value.
    heights: [1500, 1800, 2000, 2200, 2500, 3000],
    widths: [700, 1000, 1200, 1500],
    depths: [300, 400, 500, 600, 700, 800],
    // Customer configurator restriction — PERFORATED/GALVANIZED components
    // stay in the catalog (still real, still generated above) for any other
    // architecture that references them; only this model's own allow-list
    // narrows to what the customer-facing configurator may select. See
    // AdvancedSettingsAccordion.tsx, which no longer renders a shelf-type
    // selector at all now that this is the only option.
    shelfTypes: ['STANDARD'],
    minShelves: 2,
    maxShelves: 8,
    useCases: ['warehouse', 'office', 'shop', 'storage'],
    markupPercent: 22,
    markupFixed: 0,
    sortOrder: 0,
    active: true,
    featured: true,
    seo: {
      title: 'Стеллаж MS Стандарт — модульный металлический стеллаж | купить в Казахстане',
      description:
        'Металлический стеллаж MS Стандарт: нагрузка до 150 кг на полку, любые размеры, сборка без сварки. Рассчитайте цену в конфигураторе и закажите с доставкой по Казахстану.',
    },
  },
  {
    id: 'model-ms-strong',
    slug: 'ms-strong',
    name: { ru: 'MS Стронг', kk: 'MS Strong' },
    shortDescription: {
      ru: 'Усиленный стеллаж для тяжёлых складских нагрузок до 300 кг на полку',
      kk: 'Полкаға 300 кг дейінгі ауыр жүктемеге арналған күшейтілген сөре',
    },
    description: {
      ru: 'MS Стронг — усиленная складская стеллажная система с несущей способностью до 300 кг на полку. Усиленные стойки и балки, увеличенная толщина металла. Используется на производственных складах и в логистических центрах.',
      kk: 'MS Strong — полкаға 300 кг дейін салмақ көтеретін күшейтілген қойма сөресі. Қалыңдатылған металл, күшейтілген тіректер.',
    },
    image: '/images/models/ms-strong.svg',
    gallery: ['/images/models/ms-strong.svg', '/images/gallery/warehouse-2.svg'],
    maxLoadKg: 300,
    loadCapacities: [150, 300],
    heights: [1850, 2000, 2200, 2400, 3000],
    widths: [1000, 1200, 1500],
    depths: [400, 500, 600],
    shelfTypes: ['REINFORCED', 'EXTRA_REINFORCED'],
    minShelves: 2,
    maxShelves: 6,
    useCases: ['warehouse', 'workshop'],
    markupPercent: 25,
    markupFixed: 0,
    sortOrder: 1,
    active: true,
    featured: true,
    seo: {
      title: 'Стеллаж MS Стронг — усиленный складской стеллаж до 300 кг | купить',
      description:
        'Усиленный металлический стеллаж MS Стронг для тяжёлых грузов: до 300 кг на полку. Расчёт стоимости онлайн, доставка и сборка по всему Казахстану.',
    },
  },
  {
    id: 'model-archive-ms',
    slug: 'archive-ms',
    name: { ru: 'Архивный MS', kk: 'Мұрағаттық MS' },
    shortDescription: {
      ru: 'Компактный стеллаж для архивов, документов и малогабаритного хранения',
      kk: 'Мұрағат, құжат және шағын заттарды сақтауға арналған ықшам сөре',
    },
    description: {
      ru: 'Архивный MS — компактная стеллажная система для хранения документов, папок и мелкогабаритных грузов. Узкий шаг полок, увеличенное число уровней хранения на единицу площади.',
      kk: 'Мұрағаттық MS — құжаттар мен қалталарды сақтауға арналған ықшам сөрелі жүйе.',
    },
    image: '/images/models/archive-ms.svg',
    gallery: ['/images/models/archive-ms.svg', '/images/gallery/archive-1.svg'],
    maxLoadKg: 150,
    loadCapacities: [100, 150],
    heights: [1600, 1850, 2000, 2200],
    widths: [700, 1000, 1200],
    depths: [300, 400],
    shelfTypes: ['STANDARD', 'PERFORATED'],
    minShelves: 3,
    maxShelves: 8,
    useCases: ['archive', 'office', 'medical', 'education'],
    markupPercent: 20,
    markupFixed: 0,
    sortOrder: 2,
    active: true,
    featured: true,
    seo: {
      title: 'Архивный стеллаж MS — металлический стеллаж для документов | купить',
      description:
        'Архивный металлический стеллаж MS для документов и папок. Компактный шаг полок, нагрузка до 150 кг. Расчёт цены онлайн, доставка по Казахстану.',
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Components — the physical parts catalog                                    */
/* -------------------------------------------------------------------------- */

let skuCounter = 0;
function nextSku(prefix: string): string {
  skuCounter += 1;
  return `${prefix}-${String(skuCounter).padStart(4, '0')}`;
}

const UPRIGHT_BASE_PRICE = 2800; // ₸ per running metre of upright, sample data
const UPRIGHTS: ShelvingComponent[] = HEIGHTS.flatMap((h) =>
  (['STANDARD', 'HEAVY'] as const).map((tier) => {
    const heavy = tier === 'HEAVY';
    const sellingPrice = Math.round((h.value / 1000) * UPRIGHT_BASE_PRICE * (heavy ? 1.6 : 1));
    return {
      id: `upright-${h.value}-${tier}`,
      sku: nextSku('UPR'),
      type: 'UPRIGHT' as const,
      name: {
        ru: `Стойка ${h.value} мм${heavy ? ', усиленная' : ''}`,
        kk: `Тірек ${h.value} мм${heavy ? ', күшейтілген' : ''}`,
      },
      sellingPrice,
      purchasePrice: Math.round(sellingPrice / 1.42),
      weightKg: Math.round((h.value / 1000) * (heavy ? 4.8 : 3.1) * 10) / 10,
      height: h.value,
      loadCapacity: heavy ? 300 : undefined,
      models: [],
      colors: [],
      inStock: true,
      leadTimeDays: h.leadTimeDays,
      active: true,
    };
  }),
);

const SHELF_BASE = 950; // ₸ per 0.1 m² of shelf area, sample data
function shelfPrice(width: number, depth: number, multiplier: number): number {
  const areaUnits = (width / 100) * (depth / 100);
  return Math.round(areaUnits * SHELF_BASE * multiplier);
}

const SHELF_TYPE_LABEL: Record<string, { ru: string; kk: string; mult: number }> = {
  STANDARD: { ru: 'Стандартная', kk: 'Стандартты', mult: 1 },
  REINFORCED: { ru: 'Усиленная', kk: 'Күшейтілген', mult: 1.35 },
  EXTRA_REINFORCED: { ru: 'Особо усиленная', kk: 'Аса күшейтілген', mult: 1.7 },
  PERFORATED: { ru: 'Перфорированная', kk: 'Тесікті', mult: 1.1 },
  GALVANIZED: { ru: 'Оцинкованная', kk: 'Мырышталған', mult: 1.2 },
};

const SHELVES: ShelvingComponent[] = [];
for (const width of WIDTHS) {
  for (const depth of DEPTHS) {
    const meta = SHELF_TYPE_LABEL.STANDARD;
    const sellingPrice = shelfPrice(width.value, depth.value, meta.mult);
    SHELVES.push({
      id: `shelf-STANDARD-${width.value}-${depth.value}`,
      sku: nextSku('SHF'),
      type: 'SHELF',
      name: { ru: `Полка ${meta.ru} ${width.value}×${depth.value}`, kk: `Сөре ${meta.kk} ${width.value}×${depth.value}` },
      sellingPrice,
      purchasePrice: Math.round(sellingPrice / 1.4),
      weightKg: Math.round((width.value / 1000) * (depth.value / 1000) * 9.5 * 10) / 10,
      width: width.value,
      depth: depth.value,
      shelfType: 'STANDARD',
      models: [],
      colors: [],
      inStock: true,
      leadTimeDays: 2,
      active: true,
    });
  }
}
const REINFORCED_COMBOS: [number, number][] = [
  [1000, 400],
  [1000, 500],
  [1200, 400],
  [1200, 500],
  [1200, 600],
  [1500, 500],
  [1500, 600],
];
for (const [width, depth] of REINFORCED_COMBOS) {
  const meta = SHELF_TYPE_LABEL.REINFORCED;
  const sellingPrice = shelfPrice(width, depth, meta.mult);
  SHELVES.push({
    id: `shelf-REINFORCED-${width}-${depth}`,
    sku: nextSku('SHF'),
    type: 'SHELF',
    name: { ru: `Полка ${meta.ru} ${width}×${depth}`, kk: `Сөре ${meta.kk} ${width}×${depth}` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((width / 1000) * (depth / 1000) * 12.5 * 10) / 10,
    width,
    depth,
    shelfType: 'REINFORCED',
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 3,
    active: true,
  });
}
const EXTRA_REINFORCED_COMBOS: [number, number][] = [
  [1000, 400],
  [1000, 500],
  [1200, 500],
  [1200, 600],
  [1500, 500],
  [1500, 600],
];
for (const [width, depth] of EXTRA_REINFORCED_COMBOS) {
  const meta = SHELF_TYPE_LABEL.EXTRA_REINFORCED;
  const sellingPrice = shelfPrice(width, depth, meta.mult);
  SHELVES.push({
    id: `shelf-EXTRA_REINFORCED-${width}-${depth}`,
    sku: nextSku('SHF'),
    type: 'SHELF',
    name: { ru: `Полка ${meta.ru} ${width}×${depth}`, kk: `Сөре ${meta.kk} ${width}×${depth}` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((width / 1000) * (depth / 1000) * 15 * 10) / 10,
    width,
    depth,
    shelfType: 'EXTRA_REINFORCED',
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 3,
    active: true,
  });
}
const PERFORATED_COMBOS: [number, number][] = [
  [700, 300],
  [1000, 300],
  [1000, 400],
  [1200, 400],
  [1200, 500],
  // New MS Standard depths (600/700/800) for the widths already curated
  // above — without these, selecting shelfType=PERFORATED at one of these
  // depths would pass compatibility but fail BOM/pricing with a missing
  // component.
  [700, 600],
  [700, 700],
  [700, 800],
  [1000, 600],
  [1000, 700],
  [1000, 800],
  [1200, 600],
  [1200, 700],
  [1200, 800],
];
for (const [width, depth] of PERFORATED_COMBOS) {
  const meta = SHELF_TYPE_LABEL.PERFORATED;
  const sellingPrice = shelfPrice(width, depth, meta.mult);
  SHELVES.push({
    id: `shelf-PERFORATED-${width}-${depth}`,
    sku: nextSku('SHF'),
    type: 'SHELF',
    name: { ru: `Полка ${meta.ru} ${width}×${depth}`, kk: `Сөре ${meta.kk} ${width}×${depth}` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((width / 1000) * (depth / 1000) * 8.5 * 10) / 10,
    width,
    depth,
    shelfType: 'PERFORATED',
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 2,
    active: true,
  });
}
const GALVANIZED_COMBOS: [number, number][] = [
  [1000, 400],
  [1000, 500],
  [1200, 400],
  [1200, 500],
  // Same reasoning as PERFORATED_COMBOS — cover the new MS Standard depths
  // for the widths this shelf type already supports.
  [1000, 600],
  [1000, 700],
  [1000, 800],
  [1200, 600],
  [1200, 700],
  [1200, 800],
];
for (const [width, depth] of GALVANIZED_COMBOS) {
  const meta = SHELF_TYPE_LABEL.GALVANIZED;
  const sellingPrice = shelfPrice(width, depth, meta.mult);
  SHELVES.push({
    id: `shelf-GALVANIZED-${width}-${depth}`,
    sku: nextSku('SHF'),
    type: 'SHELF',
    name: { ru: `Полка ${meta.ru} ${width}×${depth}`, kk: `Сөре ${meta.kk} ${width}×${depth}` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((width / 1000) * (depth / 1000) * 10 * 10) / 10,
    width,
    depth,
    shelfType: 'GALVANIZED',
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 4,
    active: true,
  });
}

const BEAMS_LONGITUDINAL: ShelvingComponent[] = WIDTHS.map((w) => {
  const sellingPrice = Math.round((w.value / 1000) * 1650);
  return {
    id: `beam-long-${w.value}`,
    sku: nextSku('BML'),
    type: 'BEAM_LONGITUDINAL' as const,
    name: { ru: `Балка продольная ${w.value} мм`, kk: `Бойлық арқалық ${w.value} мм` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((w.value / 1000) * 2.4 * 10) / 10,
    width: w.value,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 2,
    active: true,
  };
});

const BEAMS_DEPTH: ShelvingComponent[] = DEPTHS.map((d) => {
  const sellingPrice = Math.round((d.value / 1000) * 1450);
  return {
    id: `beam-depth-${d.value}`,
    sku: nextSku('BMD'),
    type: 'BEAM_DEPTH' as const,
    name: { ru: `Балка поперечная ${d.value} мм`, kk: `Көлденең арқалық ${d.value} мм` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((d.value / 1000) * 2.1 * 10) / 10,
    depth: d.value,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 2,
    active: true,
  };
});

const CROSS_BRACES: ShelvingComponent[] = HEIGHTS.map((h) => {
  const sellingPrice = Math.round((h.value / 1000) * 1200);
  return {
    id: `cross-brace-${h.value}`,
    sku: nextSku('CBR'),
    type: 'CROSS_BRACE' as const,
    name: { ru: `Раскос задний ${h.value} мм`, kk: `Артқы диагональ ${h.value} мм` },
    sellingPrice,
    purchasePrice: Math.round(sellingPrice / 1.4),
    weightKg: Math.round((h.value / 1000) * 1.6 * 10) / 10,
    height: h.value,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 2,
    active: true,
  };
});

const REAR_WALLS: ShelvingComponent[] = WIDTHS.flatMap((w) =>
  (['SOLID', 'PERFORATED'] as const).map((kind) => {
    const sellingPrice = Math.round((w.value / 1000) * (kind === 'SOLID' ? 3400 : 2600));
    return {
      id: `rear-${kind}-${w.value}`,
      sku: nextSku('RWL'),
      type: 'REAR_WALL' as const,
      name: {
        ru: `Задняя стенка ${kind === 'SOLID' ? 'сплошная' : 'перфорированная'} ${w.value} мм`,
        kk: `Артқы қабырға ${kind === 'SOLID' ? 'тұтас' : 'тесікті'} ${w.value} мм`,
      },
      sellingPrice,
      purchasePrice: Math.round(sellingPrice / 1.4),
      weightKg: Math.round((w.value / 1000) * (kind === 'SOLID' ? 5.2 : 3.8) * 10) / 10,
      width: w.value,
      variant: kind,
      models: [],
      colors: [],
      inStock: true,
      leadTimeDays: 3,
      active: true,
    };
  }),
);

const SIDE_WALLS: ShelvingComponent[] = DEPTHS.flatMap((d) =>
  (['SOLID', 'PERFORATED'] as const).map((kind) => {
    const sellingPrice = Math.round((d.value / 1000) * (kind === 'SOLID' ? 3200 : 2400));
    return {
      id: `side-${kind}-${d.value}`,
      sku: nextSku('SWL'),
      type: 'SIDE_WALL' as const,
      name: {
        ru: `Боковая стенка ${kind === 'SOLID' ? 'сплошная' : 'перфорированная'} ${d.value} мм`,
        kk: `Бүйір қабырға ${kind === 'SOLID' ? 'тұтас' : 'тесікті'} ${d.value} мм`,
      },
      sellingPrice,
      purchasePrice: Math.round(sellingPrice / 1.4),
      weightKg: Math.round((d.value / 1000) * (kind === 'SOLID' ? 4.6 : 3.4) * 10) / 10,
      depth: d.value,
      variant: kind,
      models: [],
      colors: [],
      inStock: true,
      leadTimeDays: 3,
      active: true,
    };
  }),
);

const GENERIC_COMPONENTS: ShelvingComponent[] = [
  {
    id: 'tie-generic',
    sku: nextSku('TIE'),
    type: 'TIE',
    name: { ru: 'Стяжка рамы', kk: 'Жақтау байланысы' },
    sellingPrice: 780,
    purchasePrice: 540,
    weightKg: 0.6,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 1,
    active: true,
  },
  {
    id: 'fastener-generic',
    sku: nextSku('FST'),
    type: 'FASTENER',
    name: { ru: 'Комплект крепежа (болт+гайка)', kk: 'Бекіту жинағы (болт+сомын)' },
    sellingPrice: 120,
    purchasePrice: 70,
    weightKg: 0.05,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 1,
    active: true,
  },
  {
    id: 'foot-generic',
    sku: nextSku('FOT'),
    type: 'FOOT',
    name: { ru: 'Опора пластиковая', kk: 'Пластик тірек' },
    sellingPrice: 350,
    purchasePrice: 190,
    weightKg: 0.1,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 1,
    active: true,
  },
  {
    id: 'connector-generic',
    sku: nextSku('CNT'),
    type: 'CONNECTOR',
    name: { ru: 'Комплект соединения секций', kk: 'Секция қосу жинағы' },
    sellingPrice: 1450,
    purchasePrice: 950,
    weightKg: 0.4,
    models: [],
    colors: [],
    inStock: true,
    leadTimeDays: 2,
    active: true,
  },
];

export const COMPONENTS: ShelvingComponent[] = [
  ...UPRIGHTS,
  ...SHELVES,
  ...BEAMS_LONGITUDINAL,
  ...BEAMS_DEPTH,
  ...CROSS_BRACES,
  ...REAR_WALLS,
  ...SIDE_WALLS,
  ...GENERIC_COMPONENTS,
];

/* -------------------------------------------------------------------------- */
/* Configuration rules — formula-driven BOM quantities                        */
/* -------------------------------------------------------------------------- */

export const CONFIGURATION_RULES: ConfigurationRule[] = [
  {
    id: 'rule-upright',
    models: [],
    componentType: 'UPRIGHT',
    name: 'Стойки',
    formula: 'sharedUprights == 1 ? (sections + 1) * 2 : sections * 4',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-shelf',
    models: [],
    componentType: 'SHELF',
    name: 'Полки',
    formula: 'shelves * sections',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-beam-longitudinal',
    models: [],
    componentType: 'BEAM_LONGITUDINAL',
    name: 'Балки продольные',
    formula: 'shelves * sections * 2',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-beam-depth',
    models: [],
    componentType: 'BEAM_DEPTH',
    name: 'Балки поперечные',
    formula: 'shelves * sections * 2',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-tie',
    models: [],
    componentType: 'TIE',
    name: 'Стяжки рамы',
    formula: 'sharedUprights == 1 ? (sections + 1) * 4 : sections * 8',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-cross-brace',
    models: [],
    componentType: 'CROSS_BRACE',
    name: 'Раскосы задние',
    formula: 'rearBrace * sections * 2',
    condition: 'rearBrace == 1',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-fastener',
    models: [],
    componentType: 'FASTENER',
    name: 'Крепёж',
    formula: 'shelves * sections * 8 + sections * 16',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-foot',
    models: [],
    componentType: 'FOOT',
    name: 'Опоры',
    formula: 'sharedUprights == 1 ? (sections + 1) * 2 : sections * 4',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-connector',
    models: [],
    componentType: 'CONNECTOR',
    name: 'Соединители секций',
    formula: 'sharedUprights * (sections - 1)',
    condition: 'sharedUprights == 1 && sections > 1',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-rear-wall',
    models: [],
    componentType: 'REAR_WALL',
    name: 'Задние стенки',
    formula: '(rearSolid + rearPerforated) * sections',
    condition: 'rearSolid == 1 || rearPerforated == 1',
    priority: 0,
    active: true,
  },
  {
    id: 'rule-side-wall',
    models: [],
    componentType: 'SIDE_WALL',
    name: 'Боковые стенки',
    formula: 'sideCount',
    condition: 'sideCount > 0',
    priority: 0,
    active: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Accessories                                                                 */
/* -------------------------------------------------------------------------- */

export const ACCESSORIES: Accessory[] = [
  {
    id: 'acc-extra-shelf',
    sku: 'ACC-0001',
    slug: 'extra-shelf',
    name: { ru: 'Дополнительная полка', kk: 'Қосымша сөре' },
    description: { ru: 'Ещё одна полка в пределах имеющихся стоек', kk: 'Бар тіректер шеңберінде қосымша сөре' },
    image: '/images/accessories/extra-shelf.svg',
    unitPrice: 4200,
    purchasePrice: 3000,
    weightKg: 6.5,
    models: [],
    maxQuantityPerSection: 4,
    inStock: true,
    sortOrder: 0,
    active: true,
  },
  {
    id: 'acc-shelf-reinforcement',
    sku: 'ACC-0002',
    slug: 'shelf-reinforcement',
    name: { ru: 'Усиление полки', kk: 'Сөрені күшейту' },
    description: { ru: 'Дополнительная поперечина под полку для повышенной нагрузки', kk: 'Жоғары жүктемеге арналған қосымша көлденеңдік' },
    image: '/images/accessories/reinforcement.svg',
    unitPrice: 1800,
    purchasePrice: 1200,
    weightKg: 1.4,
    models: [],
    maxQuantityPerSection: 8,
    inStock: true,
    sortOrder: 1,
    active: true,
  },
  {
    id: 'acc-rear-wall',
    sku: 'ACC-0003',
    slug: 'rear-wall-panel',
    name: { ru: 'Задняя стенка (доп. панель)', kk: 'Артқы қабырға (қосымша панель)' },
    description: { ru: 'Дополнительная панель задней стенки для отдельного уровня', kk: 'Жеке деңгейге арналған қосымша артқы панель' },
    image: '/images/accessories/rear-wall.svg',
    unitPrice: 3400,
    purchasePrice: 2300,
    weightKg: 5.2,
    models: [],
    inStock: true,
    sortOrder: 2,
    active: true,
  },
  {
    id: 'acc-side-wall',
    sku: 'ACC-0004',
    slug: 'side-wall-panel',
    name: { ru: 'Боковая стенка (доп. панель)', kk: 'Бүйір қабырға (қосымша панель)' },
    description: { ru: 'Дополнительная панель боковой стенки', kk: 'Қосымша бүйір панель' },
    image: '/images/accessories/side-wall.svg',
    unitPrice: 3200,
    purchasePrice: 2100,
    weightKg: 4.6,
    models: [],
    inStock: true,
    sortOrder: 3,
    active: true,
  },
  {
    id: 'acc-cross-brace',
    sku: 'ACC-0005',
    slug: 'cross-brace',
    name: { ru: 'Крестовина жёсткости', kk: 'Қатаңдық айқышы' },
    description: { ru: 'Дополнительная крестовина для повышения устойчивости', kk: 'Тұрақтылықты арттыруға арналған қосымша айқыш' },
    image: '/images/accessories/cross-brace.svg',
    unitPrice: 1600,
    purchasePrice: 1050,
    weightKg: 1.8,
    models: [],
    inStock: true,
    sortOrder: 4,
    active: true,
  },
  {
    id: 'acc-shelf-divider',
    sku: 'ACC-0006',
    slug: 'shelf-divider',
    name: { ru: 'Разделитель полки', kk: 'Сөре бөлгіші' },
    description: { ru: 'Металлический разделитель для сортировки мелких грузов', kk: 'Ұсақ жүктерді сұрыптауға арналған металл бөлгіш' },
    image: '/images/accessories/divider.svg',
    unitPrice: 950,
    purchasePrice: 600,
    weightKg: 0.5,
    models: [],
    maxQuantityPerSection: 20,
    inStock: true,
    sortOrder: 5,
    active: true,
  },
  {
    id: 'acc-book-divider',
    sku: 'ACC-0007',
    slug: 'book-divider',
    name: { ru: 'Книжный разделитель', kk: 'Кітап бөлгіші' },
    description: { ru: 'Разделитель для архивных папок и книг', kk: 'Мұрағат қалталары мен кітаптарға арналған бөлгіш' },
    image: '/images/accessories/book-divider.svg',
    unitPrice: 750,
    purchasePrice: 480,
    weightKg: 0.3,
    models: ['archive-ms'],
    maxQuantityPerSection: 20,
    inStock: true,
    sortOrder: 6,
    active: true,
  },
  {
    id: 'acc-label-holder',
    sku: 'ACC-0008',
    slug: 'label-holder',
    name: { ru: 'Держатель этикеток', kk: 'Жапсырма ұстағышы' },
    description: { ru: 'Пластиковый держатель для маркировки полок', kk: 'Сөрелерді таңбалауға арналған пластик ұстағыш' },
    image: '/images/accessories/label-holder.svg',
    unitPrice: 280,
    purchasePrice: 150,
    weightKg: 0.05,
    models: [],
    maxQuantityPerSection: 20,
    inStock: true,
    sortOrder: 7,
    active: true,
  },
  {
    id: 'acc-plastic-box',
    sku: 'ACC-0009',
    slug: 'plastic-storage-box',
    name: { ru: 'Пластиковый контейнер', kk: 'Пластик контейнер' },
    description: { ru: 'Контейнер для хранения на полке, объём 20 л', kk: 'Сөреде сақтауға арналған контейнер, 20 л' },
    image: '/images/accessories/plastic-box.svg',
    unitPrice: 2400,
    purchasePrice: 1600,
    weightKg: 1.1,
    models: [],
    maxQuantityPerSection: 10,
    inStock: true,
    sortOrder: 8,
    active: true,
  },
  {
    id: 'acc-metal-box',
    sku: 'ACC-0010',
    slug: 'metal-storage-box',
    name: { ru: 'Металлический контейнер', kk: 'Металл контейнер' },
    description: { ru: 'Прочный металлический контейнер для склада', kk: 'Қоймаға арналған берік металл контейнер' },
    image: '/images/accessories/metal-box.svg',
    unitPrice: 5400,
    purchasePrice: 3800,
    weightKg: 3.2,
    models: [],
    maxQuantityPerSection: 10,
    inStock: true,
    sortOrder: 9,
    active: true,
  },
  {
    id: 'acc-adjustable-feet',
    sku: 'ACC-0011',
    slug: 'adjustable-feet',
    name: { ru: 'Регулируемые опоры', kk: 'Реттелетін тіректер' },
    description: { ru: 'Комплект регулируемых опор для неровного пола', kk: 'Тегіс емес еденге арналған реттелетін тіректер жинағы' },
    image: '/images/accessories/adjustable-feet.svg',
    unitPrice: 1200,
    purchasePrice: 800,
    weightKg: 0.4,
    models: [],
    inStock: true,
    sortOrder: 10,
    active: true,
  },
  {
    id: 'acc-floor-fixing',
    sku: 'ACC-0012',
    slug: 'floor-fixing-kit',
    name: { ru: 'Комплект крепления к полу', kk: 'Еденге бекіту жинағы' },
    description: { ru: 'Анкерный крепёж для сейсмоопасных и высоких стеллажей', kk: 'Биік сөрелерге арналған анкерлі бекіткіш' },
    image: '/images/accessories/floor-fixing.svg',
    unitPrice: 2200,
    purchasePrice: 1400,
    weightKg: 0.9,
    models: [],
    inStock: true,
    sortOrder: 11,
    active: true,
  },
  {
    id: 'acc-wall-fixing',
    sku: 'ACC-0013',
    slug: 'wall-fixing-kit',
    name: { ru: 'Комплект крепления к стене', kk: 'Қабырғаға бекіту жинағы' },
    description: { ru: 'Анкерное крепление стеллажа к стене', kk: 'Сөрені қабырғаға анкермен бекіту' },
    image: '/images/accessories/wall-fixing.svg',
    unitPrice: 1900,
    purchasePrice: 1250,
    weightKg: 0.7,
    models: [],
    inStock: true,
    sortOrder: 12,
    active: true,
  },
  {
    id: 'acc-section-connect',
    sku: 'ACC-0014',
    slug: 'section-connecting-kit',
    name: { ru: 'Комплект соединения секций', kk: 'Секцияларды қосу жинағы' },
    description: { ru: 'Дополнительный комплект для объединения секций в ряд', kk: 'Секцияларды қатарға біріктіруге арналған қосымша жинақ' },
    image: '/images/accessories/section-connect.svg',
    unitPrice: 1450,
    purchasePrice: 950,
    weightKg: 0.4,
    models: [],
    inStock: true,
    sortOrder: 13,
    active: true,
  },
  {
    id: 'acc-corner-guard',
    sku: 'ACC-0015',
    slug: 'protective-corner',
    name: { ru: 'Защитный уголок', kk: 'Қорғаныш бұрышы' },
    description: { ru: 'Резиновый защитный уголок на стойку', kk: 'Тірекке арналған резеңке қорғаныш бұрышы' },
    image: '/images/accessories/corner-guard.svg',
    unitPrice: 650,
    purchasePrice: 400,
    weightKg: 0.15,
    models: [],
    maxQuantityPerSection: 8,
    inStock: true,
    sortOrder: 14,
    active: true,
  },
  {
    id: 'acc-fastener-kit',
    sku: 'ACC-0016',
    slug: 'extra-fastener-kit',
    name: { ru: 'Дополнительный крепёж', kk: 'Қосымша бекіткіш' },
    description: { ru: 'Запасной комплект крепежа', kk: 'Қосалқы бекіткіш жинағы' },
    image: '/images/accessories/fastener-kit.svg',
    unitPrice: 900,
    purchasePrice: 550,
    weightKg: 0.5,
    models: [],
    inStock: true,
    sortOrder: 15,
    active: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Assembly, delivery, VAT, discounts                                         */
/* -------------------------------------------------------------------------- */

export const ASSEMBLY_SERVICES: AssemblyService[] = [
  {
    id: 'assembly-self',
    name: { ru: 'Самостоятельная сборка', kk: 'Өз бетінше жинау' },
    description: { ru: 'Стеллаж поставляется в разобранном виде с инструкцией', kk: 'Сөре нұсқаулықпен бірге бөлшектелген түрде жеткізіледі' },
    method: 'FIXED',
    value: 0,
    sortOrder: 0,
    active: true,
  },
  {
    id: 'assembly-professional',
    name: { ru: 'Профессиональная сборка', kk: 'Кәсіби жинау' },
    description: { ru: 'Сборка бригадой на вашем объекте', kk: 'Нысаныңызда бригадамен жинау' },
    method: 'PER_SECTION',
    value: 6000,
    sortOrder: 1,
    active: true,
  },
  {
    id: 'assembly-full-install',
    name: { ru: 'Сборка и монтаж «под ключ»', kk: '«Кілт бойынша» жинау және монтаж' },
    description: { ru: 'Сборка, крепление к стене/полу и уборка упаковки', kk: 'Жинау, қабырғаға/еденге бекіту және қаптаманы жинау' },
    method: 'PERCENT',
    value: 8,
    sortOrder: 2,
    active: true,
  },
  {
    id: 'assembly-individual',
    name: { ru: 'Индивидуальный расчёт', kk: 'Жеке есептеу' },
    description: { ru: 'Для нестандартных объёмов и сложных объектов', kk: 'Стандартты емес көлемдер мен күрделі нысандарға' },
    method: 'INDIVIDUAL',
    value: 0,
    sortOrder: 3,
    active: true,
  },
];

export const DELIVERY_METHODS: DeliveryMethod[] = [
  {
    id: 'delivery-pickup',
    kind: 'PICKUP',
    name: { ru: 'Самовывоз со склада', kk: 'Қоймадан өзі алып кету' },
    description: { ru: 'Бесплатно, склад в г. Алматы', kk: 'Тегін, Алматы қаласындағы қоймадан' },
    basePrice: 0,
    requiresAddress: false,
    sortOrder: 0,
    active: true,
  },
  {
    id: 'delivery-city',
    kind: 'CITY',
    name: { ru: 'Доставка по городу', kk: 'Қала бойынша жеткізу' },
    description: { ru: 'Доставка в пределах Алматы на следующий день', kk: 'Алматы шегінде келесі күні жеткізу' },
    basePrice: null,
    requiresAddress: true,
    sortOrder: 1,
    active: true,
  },
  {
    id: 'delivery-country',
    kind: 'COUNTRY',
    name: { ru: 'Доставка по Казахстану', kk: 'Қазақстан бойынша жеткізу' },
    description: { ru: 'Транспортной компанией в любой регион', kk: 'Кез келген аймаққа тасымал компаниясымен' },
    basePrice: null,
    requiresAddress: true,
    sortOrder: 2,
    active: true,
  },
  {
    id: 'delivery-transport-company',
    kind: 'TRANSPORT_COMPANY',
    name: { ru: 'Передача транспортной компании', kk: 'Тасымал компаниясына беру' },
    description: { ru: 'Отгрузка на терминал транспортной компании по вашему выбору', kk: 'Сіз таңдаған тасымал компаниясының терминалына жүктеу' },
    basePrice: 0,
    requiresAddress: false,
    sortOrder: 3,
    active: true,
  },
  {
    id: 'delivery-individual',
    kind: 'INDIVIDUAL',
    name: { ru: 'Индивидуальный расчёт', kk: 'Жеке есептеу' },
    description: { ru: 'Для крупных и нестандартных заказов', kk: 'Ірі және стандартты емес тапсырыстарға' },
    basePrice: null,
    requiresAddress: true,
    sortOrder: 4,
    active: true,
  },
];

export const PRICING_SETTINGS: PricingSettings = {
  vatPercent: 16,
  pricesIncludeVat: false,
  minMarginPercent: 8,
  defaultMarkupPercent: 22,
  currency: 'KZT',
  priceLevelDiscounts: {
    RETAIL: 0,
    WHOLESALE: 5,
    DEALER: 10,
    CORPORATE: 3,
    GOVERNMENT: 0,
  },
  quantityBreaks: [
    { minQuantity: 3, discountPercent: 3 },
    { minQuantity: 5, discountPercent: 5 },
    { minQuantity: 10, discountPercent: 8 },
  ],
};

export const PROMO_CODES: PromoCode[] = [
  {
    code: 'SKLAD2026',
    discountPercent: 5,
    discountFixed: 0,
    minTotal: 100_000,
    active: true,
    validUntil: '2026-12-31',
  },
  {
    code: 'ARCHIVE10',
    discountPercent: 0,
    discountFixed: 10_000,
    minTotal: 80_000,
    active: true,
    validUntil: '2026-12-31',
  },
];

/* -------------------------------------------------------------------------- */
/* Catalog products — pre-built popular configurations shown on / and /catalog */
/* -------------------------------------------------------------------------- */

export const CATALOG_PRODUCTS: CatalogProduct[] = [
  {
    id: 'product-standard-2000-1000-400',
    slug: 'ms-standard-2000x1000x400',
    modelSlug: 'ms-standard',
    name: { ru: 'MS Стандарт 2000×1000×400, 5 полок', kk: 'MS Стандарт 2000×1000×400, 5 сөре' },
    description: {
      ru: 'Популярная складская конфигурация: высота 2000 мм, ширина 1000 мм, глубина 400 мм, 5 полок, нагрузка 150 кг.',
      kk: 'Танымал қойма конфигурациясы: биіктігі 2000 мм, ені 1000 мм, тереңдігі 400 мм, 5 сөре, 150 кг жүктеме.',
    },
    image: '/images/models/ms-standard.svg',
    gallery: ['/images/models/ms-standard.svg'],
    height: 2000,
    width: 1000,
    depth: 400,
    shelves: 5,
    loadCapacity: 150,
    sections: 1,
    shelfType: 'STANDARD',
    color: 'color-grey',
    useCases: ['warehouse', 'storage'],
    inStock: true,
    popularity: 98,
    featured: true,
    published: true,
    createdAt: '2026-01-15T00:00:00.000Z',
    seo: {
      title: 'MS Стандарт 2000×1000×400 — складской стеллаж 5 полок | купить',
      description: 'Готовая конфигурация MS Стандарт 2000×1000×400 мм, 5 полок, нагрузка 150 кг. Цена, доставка и сборка по Казахстану.',
    },
  },
  {
    id: 'product-strong-2200-1200-500',
    slug: 'ms-strong-2200x1200x500',
    modelSlug: 'ms-strong',
    name: { ru: 'MS Стронг 2200×1200×500, 4 полки', kk: 'MS Strong 2200×1200×500, 4 сөре' },
    description: {
      ru: 'Усиленная конфигурация для тяжёлых грузов: высота 2200 мм, ширина 1200 мм, глубина 500 мм, нагрузка 300 кг на полку.',
      kk: 'Ауыр жүктерге арналған күшейтілген конфигурация: биіктігі 2200 мм, ені 1200 мм, тереңдігі 500 мм, полкаға 300 кг.',
    },
    image: '/images/models/ms-strong.svg',
    gallery: ['/images/models/ms-strong.svg'],
    height: 2200,
    width: 1200,
    depth: 500,
    shelves: 4,
    loadCapacity: 300,
    sections: 1,
    shelfType: 'REINFORCED',
    color: 'color-grey',
    useCases: ['warehouse', 'workshop'],
    inStock: true,
    popularity: 91,
    featured: true,
    published: true,
    createdAt: '2026-01-18T00:00:00.000Z',
    seo: {
      title: 'MS Стронг 2200×1200×500 — усиленный стеллаж 300 кг | купить',
      description: 'Усиленный стеллаж MS Стронг 2200×1200×500 мм, нагрузка 300 кг на полку. Расчёт стоимости и доставка по Казахстану.',
    },
  },
  {
    id: 'product-archive-2000-1000-300',
    slug: 'archive-ms-2000x1000x300',
    modelSlug: 'archive-ms',
    name: { ru: 'Архивный MS 2000×1000×300, 6 полок', kk: 'Мұрағаттық MS 2000×1000×300, 6 сөре' },
    description: {
      ru: 'Компактный архивный стеллаж: высота 2000 мм, ширина 1000 мм, глубина 300 мм, 6 полок для документов.',
      kk: 'Ықшам мұрағаттық сөре: биіктігі 2000 мм, ені 1000 мм, тереңдігі 300 мм, құжаттарға арналған 6 сөре.',
    },
    image: '/images/models/archive-ms.svg',
    gallery: ['/images/models/archive-ms.svg'],
    height: 2000,
    width: 1000,
    depth: 300,
    shelves: 6,
    loadCapacity: 100,
    sections: 1,
    shelfType: 'STANDARD',
    color: 'color-light-grey',
    useCases: ['archive', 'office'],
    inStock: true,
    popularity: 84,
    featured: true,
    published: true,
    createdAt: '2026-01-20T00:00:00.000Z',
    seo: {
      title: 'Архивный стеллаж MS 2000×1000×300 — 6 полок | купить в Казахстане',
      description: 'Архивный стеллаж MS 2000×1000×300 мм, 6 полок для документов. Расчёт цены онлайн, доставка по Казахстану.',
    },
  },
  {
    id: 'product-standard-2400-1200-500-row',
    slug: 'ms-standard-2400x1200x500-row',
    modelSlug: 'ms-standard',
    name: { ru: 'MS Стандарт 2400×1200×500, ряд из 3 секций', kk: 'MS Стандарт 2400×1200×500, 3 секциялы қатар' },
    description: {
      ru: 'Стеллажный ряд из стартовой и двух пристроенных секций с общими стойками, высота 2400 мм.',
      kk: 'Ортақ тіректері бар бастапқы және екі қосымша секциядан тұратын сөрелі қатар, биіктігі 2400 мм.',
    },
    image: '/images/models/ms-standard.svg',
    gallery: ['/images/models/ms-standard.svg'],
    height: 2400,
    width: 1200,
    depth: 500,
    shelves: 5,
    loadCapacity: 150,
    sections: 3,
    shelfType: 'STANDARD',
    color: 'color-grey',
    useCases: ['warehouse'],
    inStock: true,
    popularity: 76,
    featured: false,
    // Unpublished, not deleted/rewritten: 2400mm is no longer a valid MS
    // Standard height under the current matrix (see MODELS above), so this
    // listing can no longer be purchased with its advertised dimensions as
    // a NEW order. The historical record stays intact — only its public
    // storefront visibility changes.
    published: false,
    createdAt: '2026-02-01T00:00:00.000Z',
    seo: {
      title: 'MS Стандарт 2400×1200×500 ряд 3 секции — складской стеллаж',
      description: 'Стеллажный ряд MS Стандарт из 3 секций, высота 2400 мм, ширина 1200 мм. Расчёт и заказ онлайн.',
    },
  },
  {
    // Was 1850mm — no longer one of MS Standard's supported heights (see
    // MODELS above), so this catalog listing now uses the nearest supported
    // value (1800mm) to keep pricing/compatibility passing.
    id: 'product-standard-1800-700-300',
    slug: 'ms-standard-1800x700x300',
    modelSlug: 'ms-standard',
    name: { ru: 'MS Стандарт 1800×700×300, 4 полки', kk: 'MS Стандарт 1800×700×300, 4 сөре' },
    description: {
      ru: 'Компактный стеллаж для гаража и кладовой: высота 1800 мм, ширина 700 мм, глубина 300 мм.',
      kk: 'Гараж бен қоймашаға арналған ықшам сөре: биіктігі 1800 мм, ені 700 мм, тереңдігі 300 мм.',
    },
    image: '/images/models/ms-standard.svg',
    gallery: ['/images/models/ms-standard.svg'],
    height: 1800,
    width: 700,
    depth: 300,
    shelves: 4,
    loadCapacity: 100,
    sections: 1,
    shelfType: 'STANDARD',
    color: 'color-grey',
    useCases: ['garage', 'storage'],
    inStock: true,
    popularity: 70,
    featured: false,
    published: true,
    createdAt: '2026-02-05T00:00:00.000Z',
    seo: {
      title: 'MS Стандарт 1800×700×300 — гаражный стеллаж | купить',
      description: 'Компактный гаражный стеллаж MS Стандарт 1800×700×300 мм, 4 полки. Цена и доставка по Казахстану.',
    },
  },
  {
    id: 'product-strong-3000-1200-600',
    slug: 'ms-strong-3000x1200x600',
    modelSlug: 'ms-strong',
    name: { ru: 'MS Стронг 3000×1200×600, 5 полок', kk: 'MS Strong 3000×1200×600, 5 сөре' },
    description: {
      ru: 'Высокий складской стеллаж для паллетного и коробочного хранения, высота 3000 мм.',
      kk: 'Паллеттік және қораптық сақтауға арналған биік қойма сөресі, биіктігі 3000 мм.',
    },
    image: '/images/models/ms-strong.svg',
    gallery: ['/images/models/ms-strong.svg'],
    height: 3000,
    width: 1200,
    depth: 600,
    shelves: 5,
    loadCapacity: 300,
    sections: 1,
    shelfType: 'EXTRA_REINFORCED',
    color: 'color-grey',
    useCases: ['warehouse'],
    inStock: true,
    popularity: 65,
    featured: false,
    published: true,
    createdAt: '2026-02-10T00:00:00.000Z',
    seo: {
      title: 'MS Стронг 3000×1200×600 — высокий складской стеллаж 300 кг',
      description: 'Высокий усиленный стеллаж MS Стронг 3000×1200×600 мм, нагрузка 300 кг на полку. Расчёт цены онлайн.',
    },
  },
];

export const USE_CASES: { id: string; ru: string; kk: string }[] = [
  { id: 'warehouse', ru: 'Склад', kk: 'Қойма' },
  { id: 'archive', ru: 'Архив', kk: 'Мұрағат' },
  { id: 'office', ru: 'Офис', kk: 'Кеңсе' },
  { id: 'garage', ru: 'Гараж', kk: 'Гараж' },
  { id: 'storage', ru: 'Кладовая', kk: 'Қойма бөлмесі' },
  { id: 'shop', ru: 'Магазин', kk: 'Дүкен' },
  { id: 'workshop', ru: 'Мастерская', kk: 'Шеберхана' },
  { id: 'medical', ru: 'Медицинское учреждение', kk: 'Медициналық мекеме' },
  { id: 'education', ru: 'Учебное заведение', kk: 'Оқу орны' },
];
