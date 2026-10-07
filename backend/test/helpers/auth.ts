import { hash } from 'bcrypt';
import type { Role } from '../../src/config/constants.js';
import { usersRepository } from '../../src/modules/users/users.repository.js';
import type { UserDoc } from '../../src/modules/users/users.model.js';
import { createAccessTokenService } from '../../src/shared/auth/accessToken.js';
import { TEST_ACCESS_TOKEN } from '../setup/testApp.js';

// 10-testing §3 helpers/auth.ts: create a user straight in the DB and get a bearer token for it.

export const TEST_PASSWORD = 'Fade-and-Trim7';
// Signed on the real clock but valid for a year, so apps running on a frozen test clock
// (e.g. booking scenarios dated after today) still accept them. Expiry itself is tested with
// tokens the app issues.
const accessTokens = createAccessTokenService({ ...TEST_ACCESS_TOKEN, ttl: '365d' });
let counter = 0;

export async function createUser(
  overrides: Partial<UserDoc> & { password?: string } = {},
): Promise<UserDoc> {
  counter++;
  const { password = TEST_PASSWORD, ...rest } = overrides;
  return usersRepository.create({
    name: `Test User ${counter}`,
    email: `user${counter}-${Date.now()}@example.com`,
    phone: `+9198${String(Date.now()).slice(-6)}${String(counter).padStart(2, '0')}`,
    passwordHash: await hash(password, 4),
    role: 'CUSTOMER',
    isWalkIn: false,
    ...rest,
  });
}

export async function loginAs(
  role: Role,
  overrides: Partial<UserDoc> = {},
  claims: { staffId?: string } = {},
): Promise<{ user: UserDoc; token: string; header: string }> {
  const user = await createUser({ role, ...overrides });
  const token = await accessTokens.sign({ userId: user._id.toHexString(), role, ...claims });
  return { user, token, header: `Bearer ${token}` };
}

// A bearer header for an existing user (e.g. a stylist whose profile was created first).
export async function bearerFor(user: UserDoc, claims: { staffId?: string } = {}): Promise<string> {
  return `Bearer ${await accessTokens.sign({ userId: user._id.toHexString(), role: user.role, ...claims })}`;
}

export const CSRF = { 'X-Requested-With': 'straight-salon-web' } as const;
