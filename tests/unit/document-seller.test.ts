import { describe, expect, it } from 'vitest';
import { canGenerateOrderDocuments } from '@/lib/auth/authorize';
import { orderDocumentFileName, orderDocumentNumber } from '@/lib/documents/kinds';
import { describeSellerIssue, readSellerConfig, sellerConfigIssues } from '@/lib/documents/seller';

const COMPLETE = {
  SELLER_LEGAL_NAME: 'ТОО «Тестовый Продавец»',
  SELLER_BIN: '987654321098',
  SELLER_ADDRESS: 'г. Астана, ул. Тестовая, 1',
  SELLER_BANK_NAME: 'АО «Тестовый Банк»',
  SELLER_IBAN: 'KZ00 0000 0000 0000 0000',
  SELLER_BIC: 'testkzka',
  SELLER_KBE: '17',
};

describe('seller configuration', () => {
  it('is empty — never a placeholder — when nothing is configured', () => {
    const config = readSellerConfig({});
    expect(config.details).toEqual({});
    expect(config.invalid).toEqual([]);
  });

  it('a commercial proposal needs no seller legal details; an invoice needs the full beneficiary block', () => {
    const config = readSellerConfig({});
    expect(sellerConfigIssues('commercial-proposal', config)).toEqual([]);
    const missing = sellerConfigIssues('invoice', config).map((issue) => issue.envName);
    expect(missing).toEqual([
      'SELLER_LEGAL_NAME',
      'SELLER_BIN',
      'SELLER_ADDRESS',
      'SELLER_BANK_NAME',
      'SELLER_IBAN',
      'SELLER_BIC',
      'SELLER_KBE',
    ]);
  });

  it('normalises valid values and reports an invoice as ready', () => {
    const config = readSellerConfig(COMPLETE);
    expect(config.details.iban).toBe('KZ000000000000000000');
    expect(config.details.bic).toBe('TESTKZKA');
    expect(sellerConfigIssues('invoice', config)).toEqual([]);
  });

  it('reports malformed values instead of printing them — for every document kind', () => {
    const config = readSellerConfig({ ...COMPLETE, SELLER_BIN: '12345', SELLER_IBAN: 'DE89370400440532013000', SELLER_KNP: '7a0' });
    expect(config.details.bin).toBeUndefined();
    expect(config.details.iban).toBeUndefined();
    const invoiceIssues = sellerConfigIssues('invoice', config);
    expect(invoiceIssues.map((i) => [i.envName, i.problem])).toEqual([
      ['SELLER_BIN', 'invalid'],
      ['SELLER_IBAN', 'invalid'],
      ['SELLER_KNP', 'invalid'],
    ]);
    expect(sellerConfigIssues('commercial-proposal', config)).toHaveLength(3);
    expect(describeSellerIssue(invoiceIssues[0])).toContain('SELLER_BIN');
    expect(describeSellerIssue(invoiceIssues[0])).toContain('12 цифр');
  });
});

describe('document numbering', () => {
  it('is derived from the unique order number — deterministic, no counter', () => {
    expect(orderDocumentNumber('commercial-proposal', 'MS-20260830-4HB57')).toBe('KP-MS-20260830-4HB57');
    expect(orderDocumentNumber('invoice', 'MS-20260830-4HB57')).toBe('INV-MS-20260830-4HB57');
    expect(orderDocumentNumber('invoice', 'MS-20260830-4HB57')).toBe(orderDocumentNumber('invoice', 'MS-20260830-4HB57'));
  });

  it('builds a header-safe, path-free file name', () => {
    expect(orderDocumentFileName('invoice', 'MS-20260830-4HB57')).toBe('INV-MS-20260830-4HB57.pdf');
    expect(orderDocumentFileName('invoice', '../../etc/passwd"\r\nX: y')).toBe('INV-______etc_passwd___X__y.pdf');
  });
});

describe('document authorization', () => {
  it.each([
    ['SUPER_ADMIN', true],
    ['ADMIN', true],
    ['MANAGER', true],
    ['CONTENT_MANAGER', false],
  ] as const)('%s may generate order documents: %s', (role, allowed) => {
    expect(canGenerateOrderDocuments(role)).toBe(allowed);
  });
});
