import type { CustomerType } from '@/lib/types/domain';

/** Russian labels for Customer.type. Shared by the admin orders list filter
 * and the order detail page so the two can never drift apart (spec: one
 * centralized label map per enum, never a copy per component). */
export const CUSTOMER_TYPE_LABEL_RU: Record<CustomerType, string> = {
  INDIVIDUAL: 'Физлицо',
  LEGAL_ENTITY: 'Юрлицо',
};

/** The longer form used where there is room for it (order detail). */
export const CUSTOMER_TYPE_FULL_LABEL_RU: Record<CustomerType, string> = {
  INDIVIDUAL: 'Физическое лицо',
  LEGAL_ENTITY: 'Юридическое лицо',
};
