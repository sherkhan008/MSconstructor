import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ORDER_MANAGER_ROLES,
  canAssignOrder,
  canChangeOrderStatus,
  canClaimUnassignedOrder,
  canEditInternalNotes,
  canManagePrices,
  isAssignableOrderManagerRole,
} from '@/lib/auth/authorize';

describe('canChangeOrderStatus', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'] as const)('allows %s', (role) => {
    expect(canChangeOrderStatus(role)).toBe(true);
  });

  it('does not allow CONTENT_MANAGER', () => {
    expect(canChangeOrderStatus('CONTENT_MANAGER')).toBe(false);
  });
});

describe('canManagePrices', () => {
  it.each(['SUPER_ADMIN', 'ADMIN'] as const)('allows %s', (role) => {
    expect(canManagePrices(role)).toBe(true);
  });

  // Price management exposes supplier purchase prices and margin, so it is
  // deliberately narrower than order handling: MANAGER may move an order
  // through its statuses but may not see or change what a part costs us.
  it.each(['MANAGER', 'CONTENT_MANAGER'] as const)('does not allow %s', (role) => {
    expect(canManagePrices(role)).toBe(false);
  });

  it('is strictly narrower than order-status permission', () => {
    expect(canChangeOrderStatus('MANAGER')).toBe(true);
    expect(canManagePrices('MANAGER')).toBe(false);
  });
});

describe('order assignment', () => {
  it.each(['SUPER_ADMIN', 'ADMIN'] as const)('lets %s assign, reassign and unassign', (role) => {
    expect(canAssignOrder(role)).toBe(true);
  });

  // A manager's right is NOT a weaker version of "can assign": they may only
  // put their own name on a free order, which canClaimUnassignedOrder marks
  // and assignOrderManager() enforces against the actual order.
  it('does not let MANAGER assign freely — only claim', () => {
    expect(canAssignOrder('MANAGER')).toBe(false);
    expect(canClaimUnassignedOrder('MANAGER')).toBe(true);
  });

  it('gives CONTENT_MANAGER neither right', () => {
    expect(canAssignOrder('CONTENT_MANAGER')).toBe(false);
    expect(canClaimUnassignedOrder('CONTENT_MANAGER')).toBe(false);
  });

  it('does not offer the claim path to roles that can already assign', () => {
    expect(canClaimUnassignedOrder('ADMIN')).toBe(false);
    expect(canClaimUnassignedOrder('SUPER_ADMIN')).toBe(false);
  });
});

describe('canEditInternalNotes', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'] as const)('allows %s', (role) => {
    expect(canEditInternalNotes(role)).toBe(true);
  });

  it('keeps CONTENT_MANAGER read-only', () => {
    expect(canEditInternalNotes('CONTENT_MANAGER')).toBe(false);
  });

  it('matches the roles that may move an order through its statuses', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONTENT_MANAGER'] as const) {
      expect(canEditInternalNotes(role)).toBe(canChangeOrderStatus(role));
    }
  });
});

describe('isAssignableOrderManagerRole', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'] as const)('accepts %s as an assignee', (role) => {
    expect(isAssignableOrderManagerRole(role)).toBe(true);
  });

  // An order is operational work; a content manager can read it but is never
  // the person responsible for it.
  it('never accepts CONTENT_MANAGER as an assignee', () => {
    expect(isAssignableOrderManagerRole('CONTENT_MANAGER')).toBe(false);
    expect(ASSIGNABLE_ORDER_MANAGER_ROLES).not.toContain('CONTENT_MANAGER');
  });
});
