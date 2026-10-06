import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import type { Logger } from '../logger/index.js';
import { getRequestContext } from '../http/requestContext.js';
import { AppError, NotFoundError, PayloadTooLargeError, ValidationError } from './AppError.js';
import { buildProblem, PROBLEM_CONTENT_TYPE } from './problem.js';

const MONGO_DUPLICATE_KEY = 11000;

function hasCode(err: unknown, code: number): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

function bodyParserType(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string') {
    return err.type;
  }
  return undefined;
}

// Maps anything thrown to a known AppError, or undefined for unexpected errors (03 §4).
export function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (hasCode(err, MONGO_DUPLICATE_KEY)) {
    return new AppError(409, 'DUPLICATE', 'A record with the same unique value already exists.');
  }
  if (err instanceof mongoose.Error.VersionError) {
    return new AppError(
      409,
      'STALE_VERSION',
      'The record was changed by someone else. Reload and try again.',
    );
  }
  const type = bodyParserType(err);
  if (type === 'entity.parse.failed')
    return new ValidationError('The request body is not valid JSON.');
  if (type === 'entity.too.large') return new PayloadTooLargeError();
  return undefined;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}.`));
};

// Last middleware: converts every error into RFC 7807 problem JSON. Unknown errors become a
// generic 500 and are logged with their stack; stacks and driver messages never reach clients.
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const known = toAppError(err);
    const status = known?.statusCode ?? 500;
    if (known) {
      logger.debug({ code: known.code, status }, 'Request failed with a handled error');
    } else {
      logger.error({ err }, 'Unhandled error');
    }

    const problem = buildProblem({
      status,
      code: known?.code ?? 'INTERNAL_ERROR',
      detail: known?.message ?? 'Something went wrong. Please try again later.',
      instance: req.originalUrl,
      requestId: getRequestContext()?.requestId,
      errors: known?.errors,
    });
    res.status(status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  };
}
