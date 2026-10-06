import { z } from '../../docs/zod.js';

// Pagination, filtering and sorting conventions (03-backend §8).
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .openapi({ example: DEFAULT_PAGE_SIZE }),
  sort: z
    .string()
    .max(200)
    .refine((value) => value.split(',').every((token) => /^-?[A-Za-z]+$/.test(token)), {
      error: 'Use comma-separated field names, prefixed with "-" for descending',
    })
    .optional()
    .openapi({ example: '-startAt' }),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const PaginationMetaSchema = z
  .object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .openapi({ example: { page: 1, pageSize: 20, total: 134, totalPages: 7 } });

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export function paginated<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return {
    data,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

export function skipFor(query: PaginationQuery): number {
  return (query.page - 1) * query.pageSize;
}

// "-startAt,name" -> { startAt: -1, name: 1 }, keeping only allowed fields (no arbitrary sorts).
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: Record<string, 1 | -1>,
): Record<string, 1 | -1> {
  if (!sort) return fallback;
  const result: Record<string, 1 | -1> = {};
  for (const token of sort.split(',')) {
    const descending = token.startsWith('-');
    const field = descending ? token.slice(1) : token;
    if (allowed.includes(field)) result[field] = descending ? -1 : 1;
  }
  return Object.keys(result).length > 0 ? result : fallback;
}
