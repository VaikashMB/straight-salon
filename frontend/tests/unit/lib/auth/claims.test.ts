import { describe, expect, it } from 'vitest';
import { readClaims } from '@/lib/auth/claims';
import { tokenWith } from '../../helpers/fixtures';

describe('access-token claims for the UI (06 §1)', () => {
  it('reads staffId from a STAFF token', () => {
    expect(readClaims(tokenWith({ sub: 'u1', role: 'STAFF', staffId: 'abc' }))).toEqual({
      staffId: 'abc',
    });
  });

  it('is null for other roles, no token or a malformed one', () => {
    expect(readClaims(tokenWith({ sub: 'u1', role: 'CUSTOMER' })).staffId).toBeNull();
    expect(readClaims(null).staffId).toBeNull();
    expect(readClaims('not-a-jwt').staffId).toBeNull();
    expect(readClaims('a.%%%.c').staffId).toBeNull();
  });
});
