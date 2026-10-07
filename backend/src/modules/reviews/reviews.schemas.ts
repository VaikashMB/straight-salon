import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { paginationQuerySchema, PaginationMetaSchema } from '../../shared/http/pagination.js';
import { dateTimeSchema, objectIdSchema, queryFlagSchema } from '../../shared/http/schemas.js';

// Reviews (04 §3 API-060..062, BR-012, FR-060..062)

const example = {
  id: '6712c0f9a1b2c3d4e5f60c01',
  rating: 5,
  comment: 'Great fade, very relaxed atmosphere.',
  customer: { name: 'Ananya' },
  staff: { id: '6712c0f9a1b2c3d4e5f60601', displayName: 'Ravi' },
  services: [{ id: '6712c0f9a1b2c3d4e5f60501', name: 'Haircut' }],
  createdAt: '2026-10-12T12:02:11.000Z',
};

export const ReviewSchema = registry.register(
  'Review',
  z
    .object({
      id: objectIdSchema,
      rating: z.number().int().min(1).max(5),
      comment: z.string().optional(),
      customer: z.object({
        id: objectIdSchema.optional().openapi({ description: 'ADMIN view only' }),
        name: z.string().openapi({ description: 'First name only, except in the ADMIN view' }),
      }),
      staff: z.object({ id: objectIdSchema, displayName: z.string() }),
      services: z.array(z.object({ id: objectIdSchema, name: z.string() })),
      createdAt: dateTimeSchema,
      // ADMIN view only (includeHidden=true, API-062)
      bookingId: objectIdSchema.optional(),
      isHidden: z.boolean().optional(),
      hiddenReason: z.string().optional(),
    })
    .openapi({ example }),
);

export const ReviewListSchema = registry.register(
  'ReviewList',
  z.object({ data: z.array(ReviewSchema), meta: PaginationMetaSchema }),
);

// API-060
export const CreateReviewBodySchema = z
  .object({
    rating: z.number().int().min(1).max(5).openapi({ example: 5 }),
    comment: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .openapi({ example: 'Great fade, very relaxed atmosphere.' }),
  })
  .strict();

// API-061: newest first. includeHidden is the ADMIN moderation view (04 §1 pattern).
export const ListReviewsQuerySchema = paginationQuerySchema
  .omit({ sort: true })
  .extend({
    staffId: objectIdSchema.optional(),
    serviceId: objectIdSchema.optional(),
    includeHidden: queryFlagSchema
      .optional()
      .openapi({ description: 'ADMIN only: also list hidden reviews' }),
  })
  .strict();

// API-062
export const UpdateReviewBodySchema = z
  .object({
    isHidden: z.boolean(),
    hiddenReason: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .openapi({ example: 'Abusive language' }),
  })
  .strict()
  .refine((body) => !body.isHidden || Boolean(body.hiddenReason), {
    error: 'Hiding a review needs a reason',
    path: ['hiddenReason'],
  })
  .refine((body) => body.isHidden || body.hiddenReason === undefined, {
    error: 'Only hiding a review takes a reason',
    path: ['hiddenReason'],
  });

export type ReviewDto = z.infer<typeof ReviewSchema>;
export type CreateReviewBody = z.infer<typeof CreateReviewBodySchema>;
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;
export type UpdateReviewBody = z.infer<typeof UpdateReviewBodySchema>;
