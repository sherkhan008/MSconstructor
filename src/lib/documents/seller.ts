import { env } from '@/lib/env';
import type { OrderDocumentKind } from './kinds';

/**
 * Seller (our company) details for order documents.
 *
 * Source of truth: server-only SELLER_* environment variables. There is
 * deliberately no fallback to src/lib/config/site.ts — its legal name and
 * BIN are launch placeholders, and a placeholder BIN or IBAN printed on an
 * invoice is worse than no invoice. When a value a document needs is absent
 * or malformed, the document is not generated and the admin is told exactly
 * which variable to set.
 */

export interface SellerDetails {
  legalName?: string;
  bin?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  /** ИИК — the Kazakhstan IBAN, KZ + 18 characters. */
  iban?: string;
  bic?: string;
  /** Кбе — beneficiary code, two digits. */
  kbe?: string;
  /** КНП — payment purpose code, three digits. Optional on an invoice. */
  knp?: string;
}

type SellerKey = keyof SellerDetails;

interface SellerFieldSpec {
  key: SellerKey;
  envName: string;
  label: string;
  /** Normalises a raw value; returns null when it is malformed. */
  normalize: (raw: string) => string | null;
  hint?: string;
}

const text = (max: number) => (raw: string) => {
  const value = raw.replace(/\s+/g, ' ').trim();
  return value.length > 0 && value.length <= max ? value : null;
};

const SELLER_FIELDS: readonly SellerFieldSpec[] = [
  { key: 'legalName', envName: 'SELLER_LEGAL_NAME', label: 'Юридическое наименование продавца', normalize: text(300) },
  {
    key: 'bin',
    envName: 'SELLER_BIN',
    label: 'БИН/ИИН продавца',
    normalize: (raw) => (/^\d{12}$/.test(raw.trim()) ? raw.trim() : null),
    hint: '12 цифр',
  },
  { key: 'address', envName: 'SELLER_ADDRESS', label: 'Юридический адрес продавца', normalize: text(500) },
  { key: 'phone', envName: 'SELLER_PHONE', label: 'Телефон продавца', normalize: text(60) },
  {
    key: 'email',
    envName: 'SELLER_EMAIL',
    label: 'Email продавца',
    normalize: (raw) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim()) && raw.trim().length <= 200 ? raw.trim() : null),
  },
  { key: 'bankName', envName: 'SELLER_BANK_NAME', label: 'Банк продавца', normalize: text(300) },
  {
    key: 'iban',
    envName: 'SELLER_IBAN',
    label: 'ИИК (IBAN) продавца',
    normalize: (raw) => {
      const value = raw.replace(/\s+/g, '').toUpperCase();
      return /^KZ\d{2}[A-Z0-9]{16}$/.test(value) ? value : null;
    },
    hint: 'KZ и 18 символов',
  },
  {
    key: 'bic',
    envName: 'SELLER_BIC',
    label: 'БИК банка продавца',
    normalize: (raw) => {
      const value = raw.trim().toUpperCase();
      return /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(value) ? value : null;
    },
    hint: '8 или 11 символов',
  },
  {
    key: 'kbe',
    envName: 'SELLER_KBE',
    label: 'Кбе продавца',
    normalize: (raw) => (/^\d{2}$/.test(raw.trim()) ? raw.trim() : null),
    hint: '2 цифры',
  },
  {
    key: 'knp',
    envName: 'SELLER_KNP',
    label: 'КНП (код назначения платежа)',
    normalize: (raw) => (/^\d{3}$/.test(raw.trim()) ? raw.trim() : null),
    hint: '3 цифры',
  },
];

/** What each document cannot be issued without. A commercial proposal is a
 * non-binding offer, so it prints whatever seller details exist; an invoice
 * is a payment document and needs the full beneficiary block. */
const REQUIRED_FIELDS: Record<OrderDocumentKind, readonly SellerKey[]> = {
  'commercial-proposal': [],
  invoice: ['legalName', 'bin', 'address', 'bankName', 'iban', 'bic', 'kbe'],
};

export interface SellerConfigIssue {
  envName: string;
  label: string;
  problem: 'missing' | 'invalid';
  hint?: string;
}

export interface SellerConfig {
  details: SellerDetails;
  /** Values that are set but malformed — never printed, always reported. */
  invalid: SellerConfigIssue[];
}

export type SellerEnv = Partial<Record<string, string | undefined>>;

export function readSellerConfig(source: SellerEnv = env as SellerEnv): SellerConfig {
  const details: SellerDetails = {};
  const invalid: SellerConfigIssue[] = [];
  for (const field of SELLER_FIELDS) {
    const raw = source[field.envName];
    if (raw === undefined || raw.trim() === '') continue;
    const value = field.normalize(raw);
    if (value === null) {
      invalid.push({ envName: field.envName, label: field.label, problem: 'invalid', hint: field.hint });
    } else {
      details[field.key] = value;
    }
  }
  return { details, invalid };
}

/**
 * Everything that blocks `kind` from being generated: required values that
 * are absent, plus any value that is set but malformed (a typo in an
 * optional KNP must not silently disappear from an invoice either).
 */
export function sellerConfigIssues(kind: OrderDocumentKind, config: SellerConfig): SellerConfigIssue[] {
  const issues: SellerConfigIssue[] = [];
  for (const key of REQUIRED_FIELDS[kind]) {
    const field = SELLER_FIELDS.find((f) => f.key === key)!;
    const alreadyInvalid = config.invalid.some((issue) => issue.envName === field.envName);
    if (config.details[key] === undefined && !alreadyInvalid) {
      issues.push({ envName: field.envName, label: field.label, problem: 'missing', hint: field.hint });
    }
  }
  return [...issues, ...config.invalid];
}

export function describeSellerIssue(issue: SellerConfigIssue): string {
  const hint = issue.hint ? ` (${issue.hint})` : '';
  return issue.problem === 'missing'
    ? `${issue.label}: не задано — ${issue.envName}${hint}`
    : `${issue.label}: некорректное значение — ${issue.envName}${hint}`;
}
