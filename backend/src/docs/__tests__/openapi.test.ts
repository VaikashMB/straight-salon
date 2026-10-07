import { describe, expect, it } from 'vitest';
import '../../modules/health/health.routes.js';
import { generateOpenApiDocument } from '../openapi.js';
import { problemResponse, ProblemSchema } from '../registry.js';

describe('OpenAPI document (04 §2)', () => {
  const doc = generateOpenApiDocument('1.2.3');

  it('is OpenAPI 3.1 with API info', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: 'Straight Salon API', version: '1.2.3' });
  });

  it('documents the Ops endpoints with tags, public security and all responses', () => {
    const live = doc.paths?.['/health/live']?.get;
    const ready = doc.paths?.['/health/ready']?.get;
    expect(live).toMatchObject({ tags: ['Ops'], security: [] });
    expect(Object.keys(ready?.responses ?? {}).sort()).toEqual(['200', '503']);
    expect(doc.paths?.['/metrics']?.get?.tags).toEqual(['Ops']);
  });

  it('registers the reusable components and security schemes', () => {
    const schemas = Object.keys(doc.components?.schemas ?? {});
    expect(schemas).toEqual(
      expect.arrayContaining(['Problem', 'Money', 'PaginationMeta', 'Liveness', 'Readiness']),
    );
    expect(doc.components?.securitySchemes).toMatchObject({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      refreshCookie: { type: 'apiKey', in: 'cookie', name: 'ss_rt' },
    });
  });
});

describe('problemResponse', () => {
  it('describes an RFC 7807 error response for registerPath', () => {
    expect(problemResponse('Slot taken')).toEqual({
      description: 'Slot taken',
      content: { 'application/problem+json': { schema: ProblemSchema } },
    });
  });
});
