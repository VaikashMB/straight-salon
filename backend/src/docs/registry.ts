import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { PaginationMetaSchema } from '../shared/http/pagination.js';
import { z } from './zod.js';

// The single OpenAPI registry (04 §2). Each module registers its paths in *.routes.ts at import
// time; src/docs/openapi.ts turns the registry into the document. Never hand-write OpenAPI.
export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});
registry.registerComponent('securitySchemes', 'refreshCookie', {
  type: 'apiKey',
  in: 'cookie',
  name: 'ss_rt',
});

// ---- Reusable components (04 §2). Role and BookingStatus arrive with their modules. --------

export const FieldErrorSchema = z.object({
  path: z.string().openapi({ example: 'startAt' }),
  message: z.string().openapi({ example: 'Invalid ISO datetime' }),
});

export const ProblemSchema = registry.register(
  'Problem',
  z
    .object({
      type: z.string().openapi({ example: 'https://straightsalon.dev/errors/slot-unavailable' }),
      title: z.string().openapi({ example: 'Conflict' }),
      status: z.number().int().openapi({ example: 409 }),
      code: z.string().openapi({ example: 'SLOT_UNAVAILABLE' }),
      detail: z.string().openapi({ example: 'The selected stylist is no longer free at 11:00.' }),
      instance: z.string().openapi({ example: '/api/v1/bookings' }),
      requestId: z.string().optional().openapi({ example: '6f1c2a8e-4d1b-4c0e-9a57-2b8f0e1d3c4a' }),
      errors: z.array(FieldErrorSchema).optional(),
    })
    .openapi({ description: 'RFC 7807 problem details (03-backend §4)' }),
);

export const MoneySchema = registry.register(
  'Money',
  z.object({
    amountMinor: z
      .number()
      .int()
      .openapi({ example: 50000, description: 'Smallest currency unit' }),
    currency: z.string().length(3).openapi({ example: 'INR', description: 'ISO 4217' }),
  }),
);

registry.register('PaginationMeta', PaginationMetaSchema);

// Public endpoints where a bearer token unlocks an admin view (e.g. includeInactive=true):
// an empty requirement means "no auth" is also acceptable.
export const OPTIONAL_BEARER: Record<string, string[]>[] = [{}, { bearerAuth: [] }];

// Standard error response entry for registerPath({ responses }).
export function problemResponse(description: string) {
  return {
    description,
    content: { 'application/problem+json': { schema: ProblemSchema } },
  };
}
