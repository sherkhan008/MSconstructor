import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies the correct password against its own hash', () => {
    const hash = hashPassword('CorrectHorseBattery1!');
    expect(verifyPassword('CorrectHorseBattery1!', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('CorrectHorseBattery1!');
    expect(verifyPassword('WrongPassword', hash)).toBe(false);
  });

  it('never stores the password in plaintext', () => {
    const hash = hashPassword('CorrectHorseBattery1!');
    expect(hash).not.toContain('CorrectHorseBattery1!');
  });

  it('produces a different hash each time (random salt)', () => {
    const a = hashPassword('SamePassword123');
    const b = hashPassword('SamePassword123');
    expect(a).not.toBe(b);
    expect(verifyPassword('SamePassword123', a)).toBe(true);
    expect(verifyPassword('SamePassword123', b)).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });
});
