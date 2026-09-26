import { parseOrderBuyerSnapshot } from '@/lib/documents/snapshots';
import type { CustomerType } from '@/lib/types/domain';
import type { OrderRecord } from './types';

/** The shared Customer row's columns an order view can fall back to. */
export interface CustomerRowFields {
  fullName: string;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  city?: string | null;
  companyName?: string | null;
  binIin?: string | null;
  type: string;
}

/**
 * Who placed THIS order, as they entered it at checkout.
 *
 * The buyer snapshot frozen with the order is authoritative. The Customer row
 * is shared by every order from one phone number + customer type and keeps
 * the details it was first created with (a public checkout proves nothing
 * about who owns a phone number, so it never rewrites them — see
 * saveOrderToDb), so it is only the fallback for orders placed before
 * snapshots existed.
 */
export function orderBuyer(buyerSnapshot: unknown, customer: CustomerRowFields): OrderRecord['customer'] {
  const snapshot = parseOrderBuyerSnapshot(buyerSnapshot);
  if (snapshot) {
    return {
      fullName: snapshot.fullName,
      phone: snapshot.phone,
      whatsapp: snapshot.whatsapp,
      email: snapshot.email,
      city: snapshot.city ?? '',
      companyName: snapshot.companyName,
      binIin: snapshot.binIin,
      type: snapshot.type,
    };
  }
  return {
    fullName: customer.fullName,
    phone: customer.phone,
    whatsapp: customer.whatsapp ?? undefined,
    email: customer.email ?? undefined,
    city: customer.city ?? '',
    companyName: customer.companyName ?? undefined,
    binIin: customer.binIin ?? undefined,
    type: customer.type as CustomerType,
  };
}
