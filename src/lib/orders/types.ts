import type { BomLine, CustomerType, OrderStatus, PaymentPreference, PriceBreakdown, ShelvingConfiguration } from '@/lib/types/domain';
import type { OrderBuyerSnapshot, OrderItemDocumentSnapshot } from '@/lib/documents/snapshots';

export interface OrderItemRecord {
  configuration: ShelvingConfiguration;
  bom: Omit<BomLine, 'unitCost'>[];
  breakdown: PriceBreakdown;
  modelName: string;
  /** Present for all newly-created database orders; legacy test/in-memory records may omit it. */
  documentSnapshot?: OrderItemDocumentSnapshot;
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
  /** Present for all newly-created database orders; legacy records are not silently reconstructed. */
  buyerSnapshot?: OrderBuyerSnapshot;
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
