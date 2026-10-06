import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import { ValidationError, type FieldError } from '../errors/index.js';

type Part = 'params' | 'query' | 'body';

export type RequestSchemas = Partial<Record<Part, ZodType>>;

declare module 'express-serve-static-core' {
  interface Request {
    // Parsed, typed input. Express 5 makes req.query a read-only getter, so validated values
    // live here instead of being written back onto req (03 §2).
    validated?: Partial<Record<Part, unknown>>;
  }
}

// Body errors use the field path ("startAt"); query/params are prefixed ("query.page").
export function toFieldErrors(error: ZodError, part: Part): FieldError[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    const prefixed = part === 'body' ? path : [part, path].filter(Boolean).join('.');
    return { path: prefixed || part, message: issue.message };
  });
}

export function validate(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const errors: FieldError[] = [];
    const validated: Partial<Record<Part, unknown>> = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        validated[part] = result.data;
      } else {
        errors.push(...toFieldErrors(result.error, part));
      }
    }
    if (errors.length > 0) {
      next(new ValidationError('The request is invalid.', errors));
      return;
    }
    req.validated = validated;
    next();
  };
}

// Typed access in controllers: `const body = validatedPart<CreateBookingBody>(req, 'body')`.
export function validatedPart<T>(req: Request, part: Part): T {
  if (!req.validated || !(part in req.validated)) {
    throw new Error(
      `Request ${part} was not validated; add validate({ ${part}: schema }) to the route`,
    );
  }
  return req.validated[part] as T;
}
