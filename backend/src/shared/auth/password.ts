// Default import on purpose: members are looked up at call time so tests can spy on
// bcrypt.compare (06 §5 timing test).
/* eslint-disable import-x/no-named-as-default-member */
import bcrypt from 'bcrypt';
import { z } from '../../docs/zod.js';
import { COMMON_PASSWORDS } from './commonPasswords.js';

// Password policy (06 §4): min 8 chars, at least one letter and one number, not a common
// password. Max 72 bytes because bcrypt silently ignores everything after byte 72.
export const PASSWORD_MAX_BYTES = 72;

export const passwordSchema = z
  .string()
  .min(8, 'Must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES, {
    error: `Must be at most ${PASSWORD_MAX_BYTES} bytes`,
  })
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    error: 'Must contain at least one letter and one number',
  })
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    error: 'This password is too common; choose another',
  })
  .openapi({ format: 'password', example: 'Fade-and-Trim7' });

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  // Always runs a bcrypt comparison, even without a stored hash, so response time does not
  // reveal whether an account exists (06 §2 login step 1).
  verify(plain: string, hash: string | undefined | null): Promise<boolean>;
}

export function createPasswordHasher(cost: number): PasswordHasher {
  let dummyHash: string | undefined;
  const dummy = (): string =>
    (dummyHash ??= bcrypt.hashSync('timing-equaliser-not-a-password', cost));

  return {
    hash: (plain) => bcrypt.hash(plain, cost),
    async verify(plain, hash) {
      if (!hash) {
        await bcrypt.compare(plain, dummy());
        return false;
      }
      return bcrypt.compare(plain, hash);
    },
  };
}
