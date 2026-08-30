import { describe, expect, it } from 'vitest';
import { canChangeOrderStatus } from '@/lib/auth/authorize';

describe('canChangeOrderStatus', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER'] as const)('allows %s', (role) => {
    expect(canChangeOrderStatus(role)).toBe(true);
  });

  it('does not allow CONTENT_MANAGER', () => {
    expect(canChangeOrderStatus('CONTENT_MANAGER')).toBe(false);
  });
});
