import type { BomLine, CustomerType, OrderStatus, PaymentPreference, PriceBreakdown, ShelvingConfiguration } from '@/lib/types/domain';

export interface OrderItemRecord {
  configuration: ShelvingConfiguration;
  bom: Omit<BomLine, 'unitCost'>[];
  breakdown: PriceBreakdown;
  modelName: string;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customer: {
    fullName: string;
    phone: string;
    whatsapp?: string;
    email?: string;
    city: string;
    companyName?: string;
    binIin?: string;
    type: CustomerType;
  };
  deliveryAddress?: string;
  paymentPreference: PaymentPreference;
  comment?: string;
  items: OrderItemRecord[];
  netTotal: number;
  vatTotal: number;
  discountTotal: number;
  grandTotal: number;
  createdAt: string;
}
