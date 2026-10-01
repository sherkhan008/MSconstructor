/**
 * Synthetic stand-ins for the seller's server-only banking variables.
 *
 * The public-legal-identity tests inject these as SELLER_* (into the module
 * environment for the SSR test, into the web server for the e2e spec) and
 * then assert that no public page, structured data or client bundle carries
 * them. They are format-valid — src/lib/documents/seller.ts accepts each one —
 * so a public page wired to the seller config by mistake would print them and
 * the tests would fail. The real values live only in the deployment
 * environment and never in this repository.
 */
export const SELLER_BANKING_SENTINELS = {
  SELLER_BANK_NAME: 'TEST_BANK_NAME_NOT_PUBLIC',
  SELLER_IBAN: 'KZ00TESTIBANSENTINEL',
  SELLER_BIC: 'TESTBICXXXX',
} as const;
