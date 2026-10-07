import { Router } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { validate } from '../../shared/http/validate.js';
import type { ReportsController } from './reports.controller.js';
import {
  DashboardQuerySchema,
  DashboardSchema,
  ReportCsvSchema,
  ReportSummarySchema,
  SummaryQuerySchema,
} from './reports.schemas.js';

// ---- OpenAPI (04 §3 Reports, API-070..072) -----------------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Reports'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/reports/dashboard',
  tags,
  summary: 'Day dashboard (API-070)',
  description:
    'ADMIN, RECEPTIONIST. Live counts by status, revenue recorded so far and a per-stylist timeline for one salon-local date (default today, FR-070). Cached 30 s.',
  security: bearer,
  request: { query: DashboardQuerySchema },
  responses: { 200: { description: 'Dashboard', ...json(DashboardSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/reports/summary',
  tags,
  summary: 'Report for a date range (API-071)',
  description:
    'ADMIN. Revenue, bookings, cancellations, no-show rate, revenue by service and stylist, utilisation (FR-071), for appointment dates from..to inclusive, at most 366 days. Built from daily_stats; cached 5 min.',
  security: bearer,
  request: { query: SummaryQuerySchema },
  responses: { 200: { description: 'Summary', ...json(ReportSummarySchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/reports/summary.csv',
  tags,
  summary: 'Report as CSV (API-072)',
  description: 'ADMIN. The API-071 summary as a CSV download (FR-072).',
  security: bearer,
  request: { query: SummaryQuerySchema },
  responses: {
    200: {
      description: 'CSV file (Content-Disposition: attachment)',
      content: { 'text/csv': { schema: ReportCsvSchema } },
    },
    ...errors,
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function reportsRouter(deps: {
  controller: ReportsController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c } = deps;
  const router = Router();
  router.use('/reports', authenticate(deps.accessTokens));
  router.get(
    '/reports/dashboard',
    authorize('reports:dashboard'),
    validate({ query: DashboardQuerySchema }),
    c.dashboard,
  );
  router.get(
    '/reports/summary',
    authorize('reports:read'),
    validate({ query: SummaryQuerySchema }),
    c.summary,
  );
  router.get(
    '/reports/summary.csv',
    authorize('reports:read'),
    validate({ query: SummaryQuerySchema }),
    c.summaryCsv,
  );
  return router;
}
