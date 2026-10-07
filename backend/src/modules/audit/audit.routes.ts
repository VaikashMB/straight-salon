import { Router } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { validate } from '../../shared/http/validate.js';
import type { AuditController } from './audit.controller.js';
import { AuditLogListSchema, ListAuditLogsQuerySchema } from './audit.schemas.js';

// ---- OpenAPI (04 §3 Audit, API-073) ------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/api/v1/audit-logs',
  tags: ['Audit'],
  summary: 'Search the audit log (API-073)',
  description:
    'ADMIN. Newest first, filtered by entity, actor, action and salon-local date range (FR-073). User PII in before/after is masked (07 §2.2).',
  security: [{ bearerAuth: [] }],
  request: { query: ListAuditLogsQuerySchema },
  responses: {
    200: {
      description: 'Page of audit entries',
      content: { 'application/json': { schema: AuditLogListSchema } },
    },
    400: problemResponse('Validation failed (VALIDATION_FAILED)'),
    401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
    403: problemResponse('Role not allowed (FORBIDDEN)'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function auditRouter(deps: {
  controller: AuditController;
  accessTokens: AccessTokenService;
}): Router {
  const router = Router();
  router.get(
    '/audit-logs',
    authenticate(deps.accessTokens),
    authorize('audit:read'),
    validate({ query: ListAuditLogsQuerySchema }),
    deps.controller.list,
  );
  return router;
}
