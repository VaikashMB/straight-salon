import { Router } from 'express';
import { OPTIONAL_BEARER, problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize, optionalAuthenticate } from '../../shared/auth/middleware.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { singleFileUpload } from '../../shared/http/upload.js';
import { validate } from '../../shared/http/validate.js';
import { MAX_IMAGE_BYTES } from '../../shared/storage/image.js';
import type { CatalogController } from './catalog.controller.js';
import {
  CategoryListSchema,
  CategorySchema,
  CreateCategoryBodySchema,
  CreateServiceBodySchema,
  ListCategoriesQuerySchema,
  ListServicesQuerySchema,
  ServiceDetailSchema,
  ServiceListSchema,
  ServiceParamsSchema,
  ServiceSchema,
  UpdateCategoryBodySchema,
  UpdateServiceBodySchema,
  UploadedImageSchema,
  UploadImageBodySchema,
} from './catalog.schemas.js';

// ---- OpenAPI (04 §3 Catalog, API-021..027) ----------------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Catalog'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};
const notFound = problemResponse('Not found (NOT_FOUND)');

registry.registerPath({
  method: 'get',
  path: '/api/v1/categories',
  tags,
  summary: 'List categories (API-021)',
  description:
    'Active categories by sortOrder, then name. Cached 30 min. ADMIN may pass includeInactive=true.',
  security: OPTIONAL_BEARER,
  request: { query: ListCategoriesQuerySchema },
  responses: { 200: { description: 'Categories', ...json(CategoryListSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/categories',
  tags,
  summary: 'Create a category (API-022)',
  description: 'ADMIN. The slug is generated from the name.',
  security: bearer,
  request: { body: { required: true, ...json(CreateCategoryBodySchema) } },
  responses: {
    201: { description: 'Category created', ...json(CategorySchema) },
    ...errors,
    409: problemResponse('Name already used (DUPLICATE)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/categories/{id}',
  tags,
  summary: 'Update a category (API-022)',
  description: 'ADMIN. isActive: true reactivates a deactivated category.',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(UpdateCategoryBodySchema) } },
  responses: {
    200: { description: 'Updated category', ...json(CategorySchema) },
    ...errors,
    404: notFound,
    409: problemResponse('Name already used (DUPLICATE)'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/categories/{id}',
  tags,
  summary: 'Deactivate a category (API-022)',
  description: 'ADMIN. Soft delete: the category is hidden from the public list.',
  security: bearer,
  request: { params: idParamsSchema },
  responses: { 204: { description: 'Deactivated' }, ...errors, 404: notFound },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/services',
  tags,
  summary: 'List services (API-023)',
  description:
    'Active services, paginated, sorted by name by default. Filter by category, search words with q. Cached 10 min. ADMIN may pass includeInactive=true.',
  security: OPTIONAL_BEARER,
  request: { query: ListServicesQuerySchema },
  responses: { 200: { description: 'Page of services', ...json(ServiceListSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/services/{idOrSlug}',
  tags,
  summary: 'Service detail (API-024)',
  description:
    'By id or slug, with the active stylists who perform it and its rating. Deactivated services are not found, except for ADMIN.',
  security: OPTIONAL_BEARER,
  request: { params: ServiceParamsSchema },
  responses: {
    200: { description: 'Service', ...json(ServiceDetailSchema) },
    400: errors[400],
    401: errors[401],
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/services',
  tags,
  summary: 'Create a service (API-025)',
  description: 'ADMIN. durationMin must be a multiple of the slot granularity (BR-013).',
  security: bearer,
  request: { body: { required: true, ...json(CreateServiceBodySchema) } },
  responses: {
    201: { description: 'Service created', ...json(ServiceSchema) },
    ...errors,
    409: problemResponse('An active service has this name (DUPLICATE)'),
    422: problemResponse('Duration is not a multiple of the slot granularity (INVALID_DURATION)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/services/{id}',
  tags,
  summary: 'Update a service (API-025)',
  description:
    'ADMIN. null clears description or imageUrl. isActive: true reactivates (BR-013 re-checked).',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(UpdateServiceBodySchema) } },
  responses: {
    200: { description: 'Updated service', ...json(ServiceSchema) },
    ...errors,
    404: notFound,
    409: problemResponse(
      'Name used by an active service (DUPLICATE) or changed concurrently (STALE_VERSION)',
    ),
    422: problemResponse('Duration is not a multiple of the slot granularity (INVALID_DURATION)'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/services/{id}',
  tags,
  summary: 'Deactivate a service (API-026)',
  description:
    'ADMIN. Hidden from the catalogue; historical bookings keep their snapshot (FR-013).',
  security: bearer,
  request: { params: idParamsSchema },
  responses: { 204: { description: 'Deactivated' }, ...errors, 404: notFound },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/uploads/images',
  tags,
  summary: 'Upload an image (API-027)',
  description:
    'ADMIN. One `file` field: PNG, JPEG or WebP up to 2 MB. The type is detected from the content, the image is re-encoded without metadata and stored under a random name. Set the returned url as services.imageUrl or staff.photoUrl.',
  security: bearer,
  request: {
    body: { required: true, content: { 'multipart/form-data': { schema: UploadImageBodySchema } } },
  },
  responses: {
    201: { description: 'Stored image', ...json(UploadedImageSchema) },
    400: problemResponse('Missing, unreadable or unsupported file (INVALID_FILE)'),
    401: errors[401],
    403: errors[403],
    413: problemResponse('File larger than 2 MB (INVALID_FILE)'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function catalogRouter(deps: {
  controller: CatalogController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c, accessTokens } = deps;
  const admin = [authenticate(accessTokens), authorize('catalog:manage')];
  const optional = optionalAuthenticate(accessTokens);
  const byId = validate({ params: idParamsSchema });
  const router = Router();

  router.get(
    '/categories',
    optional,
    validate({ query: ListCategoriesQuerySchema }),
    c.listCategories,
  );
  router.post(
    '/categories',
    ...admin,
    validate({ body: CreateCategoryBodySchema }),
    c.createCategory,
  );
  router.patch(
    '/categories/:id',
    ...admin,
    validate({ params: idParamsSchema, body: UpdateCategoryBodySchema }),
    c.updateCategory,
  );
  router.delete('/categories/:id', ...admin, byId, c.deactivateCategory);

  router.get('/services', optional, validate({ query: ListServicesQuerySchema }), c.listServices);
  router.get(
    '/services/:idOrSlug',
    optional,
    validate({ params: ServiceParamsSchema }),
    c.getService,
  );
  router.post('/services', ...admin, validate({ body: CreateServiceBodySchema }), c.createService);
  router.patch(
    '/services/:id',
    ...admin,
    validate({ params: idParamsSchema, body: UpdateServiceBodySchema }),
    c.updateService,
  );
  router.delete('/services/:id', ...admin, byId, c.deactivateService);

  router.post(
    '/uploads/images',
    authenticate(accessTokens),
    authorize('uploads:create'),
    singleFileUpload('file', MAX_IMAGE_BYTES),
    c.uploadImage,
  );
  return router;
}
