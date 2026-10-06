import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Zod with the `.openapi()` method (04 §2). Import `z` from here in every schema file, so the
// same schemas drive validation, TypeScript types and the OpenAPI document.
extendZodWithOpenApi(z);

export { z };
