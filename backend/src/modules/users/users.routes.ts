import { Router } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { validate } from '../../shared/http/validate.js';
import type { UsersController } from './users.controller.js';
import {
  AdminUpdateBodySchema,
  CreateUserBodySchema,
  ListUsersQuerySchema,
  UpdateMeBodySchema,
  UserListSchema,
  UserSchema,
  WalkInBodySchema,
} from './users.schemas.js';

// ---- OpenAPI (04 §3 Users, API-010..015) ------------------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Users'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  tags,
  summary: 'Update my profile (API-010)',
  security: bearer,
  request: { body: { required: true, ...json(UpdateMeBodySchema) } },
  responses: {
    200: { description: 'Updated profile', ...json(UserSchema) },
    400: errors[400],
    401: errors[401],
    409: problemResponse('Phone already used (DUPLICATE, PHONE_ALREADY_REGISTERED)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  tags,
  summary: 'List and search users (API-011)',
  description: 'ADMIN, RECEPTIONIST. Receptionists only ever see customers.',
  security: bearer,
  request: { query: ListUsersQuerySchema },
  responses: { 200: { description: 'Page of users', ...json(UserListSchema) }, ...errors },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/users',
  tags,
  summary: 'Create a staff, receptionist or admin account (API-012)',
  description: 'ADMIN. Sets a temporary password that the person changes via API-008.',
  security: bearer,
  request: { body: { required: true, ...json(CreateUserBodySchema) } },
  responses: {
    201: { description: 'Account created', ...json(UserSchema) },
    ...errors,
    409: problemResponse('Email or phone already used (DUPLICATE, PHONE_ALREADY_REGISTERED)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/users/walk-in',
  tags,
  summary: 'Find or create a walk-in customer by phone (API-013)',
  description: 'ADMIN, RECEPTIONIST. 201 when created, 200 when a customer with that phone exists.',
  security: bearer,
  request: { body: { required: true, ...json(WalkInBodySchema) } },
  responses: {
    200: { description: 'Existing customer', ...json(UserSchema) },
    201: { description: 'Walk-in customer created', ...json(UserSchema) },
    ...errors,
    409: problemResponse('Phone belongs to a staff account (DUPLICATE)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{id}',
  tags,
  summary: 'Get a user (API-014)',
  description: 'ADMIN, RECEPTIONIST (customers only; others look not found).',
  security: bearer,
  request: { params: idParamsSchema },
  responses: {
    200: { description: 'User', ...json(UserSchema) },
    ...errors,
    404: problemResponse('Not found (NOT_FOUND)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/{id}',
  tags,
  summary: 'Change role or activate/deactivate (API-015)',
  description:
    'ADMIN. Not on your own account. A deactivated user is signed out at their next token refresh.',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(AdminUpdateBodySchema) } },
  responses: {
    200: { description: 'Updated user', ...json(UserSchema) },
    ...errors,
    404: problemResponse('Not found (NOT_FOUND)'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function usersRouter(deps: {
  controller: UsersController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c } = deps;
  const router = Router();
  router.use('/users', authenticate(deps.accessTokens));

  router.patch('/users/me', validate({ body: UpdateMeBodySchema }), c.updateMe);
  router.get('/users', authorize('users:read'), validate({ query: ListUsersQuerySchema }), c.list);
  router.post(
    '/users',
    authorize('users:manage'),
    validate({ body: CreateUserBodySchema }),
    c.create,
  );
  router.post(
    '/users/walk-in',
    authorize('walkin:create'),
    validate({ body: WalkInBodySchema }),
    c.walkIn,
  );
  router.get('/users/:id', authorize('users:read'), validate({ params: idParamsSchema }), c.get);
  router.patch(
    '/users/:id',
    authorize('users:manage'),
    validate({ params: idParamsSchema, body: AdminUpdateBodySchema }),
    c.adminUpdate,
  );
  return router;
}
