import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import { serve, setup } from 'swagger-ui-express';
import { registry } from './registry.js';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

// Builds the OpenAPI 3.1 document from everything registered so far. Route modules register at
// import time, so call this after the app's routers have been imported.
export function generateOpenApiDocument(version: string): OpenApiDocument {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Straight Salon API',
      version,
      description:
        'Salon booking and management API. Errors use RFC 7807 problem details; every response carries X-Request-Id.',
    },
    servers: [{ url: '/' }],
  });
}

// GET /api/docs (Swagger UI) and GET /api/docs/openapi.json (raw document), 03 §6.
export function docsRouter(document: OpenApiDocument): Router {
  const router = Router();
  router.get('/api/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/api/docs', serve, setup(document, { customSiteTitle: 'Straight Salon API' }));
  return router;
}
