import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/errors';
import { makeQueryClient, shouldRetry } from '@/lib/query-client';

describe('query client defaults (05 §6)', () => {
  it('never retries 4xx; retries other failures twice', () => {
    expect(shouldRetry(0, new ApiError({ status: 404, code: 'NOT_FOUND' }))).toBe(false);
    expect(shouldRetry(0, new ApiError({ status: 503, code: 'TEMPORARILY_UNAVAILABLE' }))).toBe(
      true,
    );
    expect(shouldRetry(1, new Error('network'))).toBe(true);
    expect(shouldRetry(2, new Error('network'))).toBe(false);
    expect(makeQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});
