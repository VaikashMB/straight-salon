import { describe, expect, it } from 'vitest';
import {
  loginSchema,
  newPasswordSchema,
  phoneSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/features/auth/schemas';

describe('auth form schemas (06 §4, FR-001)', () => {
  it('password policy: ≥ 8 chars, a letter and a number, ≤ 72 bytes', () => {
    expect(newPasswordSchema.safeParse('Fade-and-Trim7').success).toBe(true);
    expect(newPasswordSchema.safeParse('short1').success).toBe(false);
    expect(newPasswordSchema.safeParse('lettersonly').success).toBe(false);
    expect(newPasswordSchema.safeParse('12345678').success).toBe(false);
    expect(newPasswordSchema.safeParse(`a1${'é'.repeat(36)}`).success).toBe(false); // 74 bytes
  });

  it('emails are trimmed and lower-cased; login only needs a password', () => {
    expect(loginSchema.parse({ email: ' Ananya@Example.COM ', password: 'x' })).toEqual({
      email: 'ananya@example.com',
      password: 'x',
    });
    expect(loginSchema.safeParse({ email: 'nope', password: '' }).success).toBe(false);
  });

  it('phone numbers are normalised to E.164 with the default calling code', () => {
    expect(phoneSchema('91').parse('98765 43212')).toBe('+919876543212');
    expect(phoneSchema('44').parse('07946 095800')).toBe('+447946095800');
    expect(phoneSchema('91').safeParse('12').success).toBe(false);
    expect(
      registerSchema.parse({
        name: '  Ananya Rao ',
        email: 'A@B.co',
        phone: '098765-43212',
        password: 'Fade-and-Trim7',
      }),
    ).toEqual({
      name: 'Ananya Rao',
      email: 'a@b.co',
      phone: '+919876543212',
      password: 'Fade-and-Trim7',
    });
  });

  it('the reset form needs matching passwords', () => {
    expect(
      resetPasswordSchema.safeParse({ newPassword: 'Fade-and-Trim7', confirmPassword: 'other' })
        .success,
    ).toBe(false);
  });
});
