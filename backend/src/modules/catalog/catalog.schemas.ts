import { MoneySchema, registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { paginationQuerySchema, PaginationMetaSchema } from '../../shared/http/pagination.js';
import { objectIdSchema, queryFlagSchema } from '../../shared/http/schemas.js';

// Catalog (04 §3 API-021..027, FR-010..013)

const includeInactive = queryFlagSchema.optional().openapi({
  description: 'ADMIN only: also return deactivated entries (401/403 for anyone else)',
  example: false,
});

const imageUrlSchema = z
  .url({ protocol: /^https?$/, error: 'Must be an http(s) URL, e.g. from POST /uploads/images' })
  .max(500)
  .openapi({ example: 'http://localhost:4000/uploads/images/9f1c2a8e.webp' });

const atLeastOne = { error: 'Send at least one field to change' };
const hasFields = (body: object) => Object.keys(body).length > 0;

// ---- Categories -------------------------------------------------------------------------------

export const CategorySchema = registry.register(
  'Category',
  z
    .object({
      id: objectIdSchema,
      name: z.string(),
      slug: z.string(),
      description: z.string().optional(),
      sortOrder: z.number().int(),
      isActive: z.boolean(),
    })
    .openapi({
      example: {
        id: '6712c0f9a1b2c3d4e5f60401',
        name: 'Hair',
        slug: 'hair',
        description: 'Cuts, colour and treatments',
        sortOrder: 1,
        isActive: true,
      },
    }),
);

export const CategoryListSchema = registry.register('CategoryList', z.array(CategorySchema));

export const ListCategoriesQuerySchema = z.object({ includeInactive }).strict();

export const CreateCategoryBodySchema = z
  .object({
    name: z.string().trim().min(2).max(60).openapi({ example: 'Hair' }),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional().openapi({ example: 1 }),
  })
  .strict();

export const UpdateCategoryBodySchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOne);

// ---- Services ---------------------------------------------------------------------------------

const serviceExample = {
  id: '6712c0f9a1b2c3d4e5f60501',
  slug: 'haircut',
  name: 'Haircut',
  description: 'Consultation, wash, cut and style',
  categoryId: '6712c0f9a1b2c3d4e5f60401',
  durationMin: 45,
  price: { amountMinor: 40000, currency: 'INR' },
  isActive: true,
  ratingAvg: 4.6,
  ratingCount: 18,
};

const serviceShape = {
  id: objectIdSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  categoryId: objectIdSchema,
  durationMin: z.number().int(),
  price: MoneySchema,
  imageUrl: z.string().optional(),
  isActive: z.boolean(),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
};

export const ServiceSchema = registry.register(
  'Service',
  z.object(serviceShape).openapi({ example: serviceExample }),
);

export const ServiceListSchema = registry.register(
  'ServiceList',
  z.object({ data: z.array(ServiceSchema), meta: PaginationMetaSchema }),
);

export const StylistSummarySchema = registry.register(
  'StylistSummary',
  z
    .object({
      id: objectIdSchema,
      displayName: z.string(),
      photoUrl: z.string().optional(),
      ratingAvg: z.number(),
      ratingCount: z.number().int(),
    })
    .openapi({
      example: {
        id: '6712c0f9a1b2c3d4e5f60601',
        displayName: 'Ravi',
        ratingAvg: 4.8,
        ratingCount: 31,
      },
    }),
);

export const ServiceDetailSchema = registry.register(
  'ServiceDetail',
  z.object({ ...serviceShape, stylists: z.array(StylistSummarySchema) }).openapi({
    example: {
      ...serviceExample,
      stylists: [
        { id: '6712c0f9a1b2c3d4e5f60601', displayName: 'Ravi', ratingAvg: 4.8, ratingCount: 31 },
      ],
    },
  }),
);

export const ListServicesQuerySchema = paginationQuerySchema
  .extend({
    categoryId: objectIdSchema.optional(),
    q: z
      .string()
      .trim()
      .max(100)
      .optional()
      .openapi({ description: 'Words in the name or description', example: 'haircut' }),
    includeInactive,
  })
  .strict();

export const ServiceParamsSchema = z
  .object({
    idOrSlug: z
      .string()
      .regex(/^[a-z0-9-]{1,120}$/i, 'Must be a service id or slug')
      .openapi({ example: 'haircut' }),
  })
  .strict();

export const CreateServiceBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80).openapi({ example: 'Haircut' }),
    categoryId: objectIdSchema,
    description: z.string().trim().max(1000).optional(),
    durationMin: z
      .number()
      .int()
      .min(5)
      .max(600)
      .openapi({ description: 'Multiple of the slot granularity (BR-013)', example: 45 }),
    priceMinor: z.number().int().min(0).max(100_000_000).openapi({ example: 40000 }),
    imageUrl: imageUrlSchema.optional(),
    isActive: z.boolean().optional().openapi({ description: 'Default true' }),
  })
  .strict();

export const UpdateServiceBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    categoryId: objectIdSchema.optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    durationMin: z.number().int().min(5).max(600).optional(),
    priceMinor: z.number().int().min(0).max(100_000_000).optional(),
    imageUrl: imageUrlSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOne);

// ---- Uploads (API-027) ------------------------------------------------------------------------

export const UploadImageBodySchema = z.object({
  file: z
    .string()
    .openapi({ type: 'string', format: 'binary', description: 'PNG, JPEG or WebP, max 2 MB' }),
});

export const UploadedImageSchema = registry.register(
  'UploadedImage',
  z
    .object({ url: z.string() })
    .openapi({ example: { url: 'http://localhost:4000/uploads/images/9f1c2a8e.webp' } }),
);

export type CategoryDto = z.infer<typeof CategorySchema>;
export type ListCategoriesQuery = z.infer<typeof ListCategoriesQuerySchema>;
export type CreateCategoryBody = z.infer<typeof CreateCategoryBodySchema>;
export type UpdateCategoryBody = z.infer<typeof UpdateCategoryBodySchema>;
export type ServiceDto = z.infer<typeof ServiceSchema>;
export type ServiceDetailDto = z.infer<typeof ServiceDetailSchema>;
export type StylistSummaryDto = z.infer<typeof StylistSummarySchema>;
export type ListServicesQuery = z.infer<typeof ListServicesQuerySchema>;
export type CreateServiceBody = z.infer<typeof CreateServiceBodySchema>;
export type UpdateServiceBody = z.infer<typeof UpdateServiceBodySchema>;
export type UploadedImageDto = z.infer<typeof UploadedImageSchema>;
