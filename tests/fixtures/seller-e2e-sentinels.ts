import { SELLER_BANKING_SENTINELS } from './seller-banking-sentinels';

/** Every server-only seller variable that must not leak in from local `.env`. */
export const SELLER_ENV_NAMES = [
  'SELLER_LEGAL_NAME',
  'SELLER_BIN',
  'SELLER_ADDRESS',
  'SELLER_PHONE',
  'SELLER_BANK_NAME',
  'SELLER_IBAN',
  'SELLER_BIC',
  'SELLER_KBE',
  'SELLER_KNP',
] as const;

/** Minimum valid seller identity for commercial-proposal E2E scenarios. */
export const SELLER_IDENTITY_SENTINELS = {
  SELLER_LEGAL_NAME: 'ТОО «Синтетический E2E Продавец»',
  SELLER_BIN: '987654321098',
  SELLER_ADDRESS: 'г. Тестовый, ул. E2E, 1',
} as const;

/**
 * Complete, synthetic seller environment for the shared Playwright server.
 *
 * Identity and invoice fields stay separate above so proposal tests depend
 * only on the three identity values they actually require. This combined map
 * is used because the same E2E server also runs invoice issuance and the
 * public banking-leak checks. playwright.config.ts removes every ambient
 * SELLER_* value before this map is applied, so optional values stay absent.
 */
export const SELLER_E2E_ENV = {
  ...SELLER_IDENTITY_SENTINELS,
  ...SELLER_BANKING_SENTINELS,
  SELLER_KBE: '17',
} as const;
