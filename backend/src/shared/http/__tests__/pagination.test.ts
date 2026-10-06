import { describe, expect, it } from 'vitest';
import { paginated, paginationQuerySchema, parseSort, skipFor } from '../pagination.js';

describe('paginationQuerySchema (03 §8)', () => {
  it('defaults to page 1, pageSize 20', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces query strings and caps pageSize at 100', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50', sort: '-startAt' })).toEqual({
      page: 3,
      pageSize: 50,
      sort: '-startAt',
    });
    expect(paginationQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ sort: 'name;drop' }).success).toBe(false);
  });
});

describe('paginated / skipFor', () => {
  it('builds the envelope with totalPages', () => {
    expect(paginated(['a', 'b'], 134, { page: 2, pageSize: 20 })).toEqual({
      data: ['a', 'b'],
      meta: { page: 2, pageSize: 20, total: 134, totalPages: 7 },
    });
    expect(paginated([], 0, { page: 1, pageSize: 20 }).meta.totalPages).toBe(0);
  });

  it('computes the skip offset', () => {
    expect(skipFor({ page: 3, pageSize: 20 })).toBe(40);
  });
});

describe('parseSort', () => {
  const allowed = ['startAt', 'name'];
  it('parses ascending and descending fields', () => {
    expect(parseSort('-startAt,name', allowed, { _id: 1 })).toEqual({ startAt: -1, name: 1 });
  });

  it('ignores fields that are not allowed, falling back when nothing is left', () => {
    expect(parseSort('passwordHash', allowed, { startAt: -1 })).toEqual({ startAt: -1 });
    expect(parseSort(undefined, allowed, { startAt: -1 })).toEqual({ startAt: -1 });
  });
});
