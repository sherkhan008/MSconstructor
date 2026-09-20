import type { OrderStatus } from '@/lib/types/domain';

/**
 * The order lifecycle policy: which status may follow which, and which callers
 * are trusted to ask for it. Pure — no database, no session, no request — so
 * the rule is one testable thing that the service layer enforces and the admin
 * UI merely renders.
 *
 * THE ALLOWED GRAPH (this is the whole graph; anything not listed is rejected):
 *
 *   NEW              → CONFIRMED         | CANCELLED
 *   CONFIRMED        → AWAITING_PAYMENT  | CANCELLED
 *   AWAITING_PAYMENT → PAID              | CANCELLED
 *   PAID             → IN_PROGRESS       | CANCELLED
 *   IN_PROGRESS      → READY             | CANCELLED
 *   READY            → DELIVERED         | CANCELLED
 *   DELIVERED        → (terminal)
 *   CANCELLED        → (terminal)
 *
 * Cancellation is deliberate, not a catch-all: an order can be cancelled from
 * any state it is still being worked in, including after PAID (the refund
 * itself happens outside this system and is not modelled here). It is NOT
 * reachable from DELIVERED — a delivered order that comes back is a return,
 * a different business event, and inventing a state for it here would be
 * guessing. Both terminal states are dead ends: nothing reopens an order, so
 * a mistake is corrected by placing a new one, which keeps every historical
 * order's trail honest.
 */

/**
 * The path a status change arrives through. This is NOT a role (roles are
 * src/lib/auth/authorize.ts) — it is the trust level of the code path itself,
 * which is what the PAID boundary is actually about.
 *
 *   ADMIN            — an authenticated admin session, role already checked.
 *   PAYMENT_PROVIDER — a server-side payment adapter that has *verified* a
 *                      payment with the provider. Nothing implements this yet;
 *                      it exists so the future adapter has a named seam to use
 *                      instead of widening the public surface.
 *   PUBLIC           — anything a browser/customer can reach. Trusted with
 *                      NOTHING: every transition from this channel is rejected.
 */
export type OrderStatusChannel = 'ADMIN' | 'PAYMENT_PROVIDER' | 'PUBLIC';

const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Money statuses. "This order has been paid for" is a commercial claim, so it
 * may only ever be made by a path that can actually know it: a signed-in admin
 * who has seen the money arrive, or a server-side adapter that has verified
 * the payment with the provider. A customer's browser is never such a path —
 * no request a client can originate may produce PAID, regardless of what it
 * posts, what totals it claims, or what query parameters it carries.
 */
const PAID_CHANNELS: readonly OrderStatusChannel[] = ['ADMIN', 'PAYMENT_PROVIDER'];

/** Every channel that may drive the workflow at all. PUBLIC is absent on
 * purpose — the public site creates orders (always at NEW) and never moves
 * them. */
const WORKFLOW_CHANNELS: readonly OrderStatusChannel[] = ['ADMIN', 'PAYMENT_PROVIDER'];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[status].length === 0;
}

/** Graph question only — says nothing about who is asking. */
export function isAllowedOrderStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** Trust question only — says nothing about the order's current state. */
export function mayChannelSetOrderStatus(channel: OrderStatusChannel, status: OrderStatus): boolean {
  if (!WORKFLOW_CHANNELS.includes(channel)) return false;
  if (status === 'PAID') return PAID_CHANNELS.includes(channel);
  return true;
}

export type OrderStatusTransitionRejection =
  /** The requested status is the one the order already has. */
  | 'SAME_STATUS'
  /** This channel is not trusted to set this status (e.g. PUBLIC → PAID). */
  | 'UNTRUSTED_CHANNEL'
  /** The order is finished; nothing follows it. */
  | 'TERMINAL'
  /** Both states are real, but this step is not in the graph. */
  | 'INVALID_TRANSITION';

export type OrderStatusTransitionCheck =
  | { ok: true }
  | { ok: false; reason: OrderStatusTransitionRejection };

/**
 * The single decision point. Trust is checked BEFORE anything else, so an
 * untrusted channel cannot learn anything about the order (not even whether
 * its request was a no-op) by reading the rejection.
 */
export function checkOrderStatusTransition(params: {
  from: OrderStatus;
  to: OrderStatus;
  channel: OrderStatusChannel;
}): OrderStatusTransitionCheck {
  const { from, to, channel } = params;
  if (!mayChannelSetOrderStatus(channel, to)) return { ok: false, reason: 'UNTRUSTED_CHANNEL' };
  if (from === to) return { ok: false, reason: 'SAME_STATUS' };
  if (!isAllowedOrderStatusTransition(from, to)) {
    return { ok: false, reason: isTerminalOrderStatus(from) ? 'TERMINAL' : 'INVALID_TRANSITION' };
  }
  return { ok: true };
}

/**
 * The statuses this channel may actually move the order to right now — what
 * the admin screen offers as buttons. The UI showing only these is a
 * convenience, never the control: checkOrderStatusTransition() runs again in
 * the service that writes.
 */
export function nextOrderStatuses(from: OrderStatus, channel: OrderStatusChannel): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[from].filter((to) => mayChannelSetOrderStatus(channel, to));
}
