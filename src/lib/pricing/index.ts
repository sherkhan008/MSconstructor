export { calculatePrice } from './engine';
export type { PricingContext } from './engine';
export { validateCompatibility } from './compatibility';
export { buildBom, stripBomCosts } from './bom';
export {
  shelvingConfigurationSchema,
  configurationAccessorySchema,
  parseConfiguration,
  orderRequestSchema,
  orderFormSchema,
  phoneSchema,
  customerTypeSchema,
  paymentPreferenceSchema,
  customerPaymentPreferenceSchema,
  CUSTOMER_PAYMENT_METHODS,
} from './schema';
export type { ShelvingConfigurationInput, OrderRequestInput, OrderFormInput } from './schema';
