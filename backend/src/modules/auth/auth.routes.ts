import { Router, type RequestHandler } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import {
  authenticate,
  CSRF_HEADER_VALUE,
  requireCsrfHeader,
} from '../../shared/auth/middleware.js';
import { validate } from '../../shared/http/validate.js';
import { UserSchema } from '../users/users.schemas.js';
import type { AuthController } from './auth.controller.js';
import {
  AccessTokenResponseSchema,
  ChangePasswordBodySchema,
  ForgotPasswordBodySchema,
  LoginBodySchema,
  RegisterBodySchema,
  ResetPasswordBodySchema,
  SessionResponseSchema,
} from './auth.schemas.js';

// ---- OpenAPI (04 §3 Auth, API-001..009) ------------------------------------------------------

const csrfHeaders = z.object({
  'x-requested-with': z
    .literal(CSRF_HEADER_VALUE)
    .openapi({ description: 'CSRF guard for auth endpoints (06 §4)' }),
});
const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const setsCookies = {
  'Set-Cookie': {
    description: 'ss_rt (httpOnly, Path=/api/v1/auth) and ss_session',
    schema: { type: 'string' as const },
  },
};
const common = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  403: problemResponse('Missing X-Requested-With header (FORBIDDEN)'),
  429: problemResponse('Rate limited (RATE_LIMITED)'),
};
const tags = ['Auth'];

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register',
  tags,
  summary: 'Register a customer account (API-001)',
  security: [],
  request: { headers: csrfHeaders, body: { required: true, ...json(RegisterBodySchema) } },
  responses: {
    201: {
      description: 'Registered and signed in',
      headers: setsCookies,
      ...json(SessionResponseSchema),
    },
    ...common,
    409: problemResponse('Email or phone already registered (DUPLICATE, PHONE_ALREADY_REGISTERED)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  tags,
  summary: 'Log in (API-002)',
  description: '5 failed attempts for one email lock it for 15 minutes (429).',
  security: [],
  request: { headers: csrfHeaders, body: { required: true, ...json(LoginBodySchema) } },
  responses: {
    200: { description: 'Signed in', headers: setsCookies, ...json(SessionResponseSchema) },
    ...common,
    401: problemResponse('Invalid email or password (UNAUTHENTICATED)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags,
  summary: 'Rotate the refresh token (API-003)',
  description: 'Reusing a rotated token revokes every session of that login (06 §2).',
  security: [{ refreshCookie: [] }],
  request: { headers: csrfHeaders },
  responses: {
    200: {
      description: 'New access token; new refresh cookie',
      headers: setsCookies,
      ...json(AccessTokenResponseSchema),
    },
    401: problemResponse('Missing, expired, revoked or reused refresh token (UNAUTHENTICATED)'),
    403: common[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags,
  summary: 'Log out of this device (API-004)',
  security: [{ refreshCookie: [] }],
  request: { headers: csrfHeaders },
  responses: { 204: { description: 'Session ended; cookies cleared' }, 403: common[403] },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout-all',
  tags,
  summary: 'Log out of all devices (API-005)',
  security: [{ bearerAuth: [] }],
  request: { headers: csrfHeaders },
  responses: {
    204: { description: 'All sessions ended' },
    401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
    403: common[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/forgot-password',
  tags,
  summary: 'Request a password reset email (API-006)',
  description: 'Always 202, whether or not the email has an account (no user enumeration).',
  security: [],
  request: { headers: csrfHeaders, body: { required: true, ...json(ForgotPasswordBodySchema) } },
  responses: { 202: { description: 'Accepted' }, ...common },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/reset-password',
  tags,
  summary: 'Set a new password with a reset token (API-007)',
  description: 'Ends every session of the account.',
  security: [],
  request: { headers: csrfHeaders, body: { required: true, ...json(ResetPasswordBodySchema) } },
  responses: {
    204: { description: 'Password changed' },
    400: problemResponse(
      'Invalid input, or invalid/expired/used token (VALIDATION_FAILED, INVALID_RESET_TOKEN)',
    ),
    403: common[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/change-password',
  tags,
  summary: 'Change password (API-008)',
  description: 'Ends every other session; this device receives a fresh refresh cookie.',
  security: [{ bearerAuth: [] }],
  request: { headers: csrfHeaders, body: { required: true, ...json(ChangePasswordBodySchema) } },
  responses: {
    204: { description: 'Password changed', headers: setsCookies },
    400: problemResponse('Validation failed or current password incorrect (VALIDATION_FAILED)'),
    401: problemResponse('Not authenticated'),
    403: common[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/me',
  tags,
  summary: 'Current user profile (API-009)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Profile', ...json(UserSchema) },
    401: problemResponse('Not authenticated'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function authRouter(deps: {
  controller: AuthController;
  accessTokens: AccessTokenService;
  authLimiter: RequestHandler;
}): Router {
  const { controller: c, accessTokens, authLimiter } = deps;
  const router = Router();
  const auth = authenticate(accessTokens);

  router.post(
    '/auth/register',
    authLimiter,
    requireCsrfHeader,
    validate({ body: RegisterBodySchema }),
    c.register,
  );
  router.post(
    '/auth/login',
    authLimiter,
    requireCsrfHeader,
    validate({ body: LoginBodySchema }),
    c.login,
  );
  router.post('/auth/refresh', requireCsrfHeader, c.refresh);
  router.post('/auth/logout', requireCsrfHeader, c.logout);
  router.post('/auth/logout-all', requireCsrfHeader, auth, c.logoutAll);
  router.post(
    '/auth/forgot-password',
    authLimiter,
    requireCsrfHeader,
    validate({ body: ForgotPasswordBodySchema }),
    c.forgotPassword,
  );
  router.post(
    '/auth/reset-password',
    requireCsrfHeader,
    validate({ body: ResetPasswordBodySchema }),
    c.resetPassword,
  );
  router.post(
    '/auth/change-password',
    requireCsrfHeader,
    auth,
    validate({ body: ChangePasswordBodySchema }),
    c.changePassword,
  );
  router.get('/auth/me', auth, c.me);
  return router;
}
