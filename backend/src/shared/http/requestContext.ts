import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Per-request (or per-job) context carried through async calls (01-architecture §5, 07 §1.1).
// The logger mixin, audit service and outbox read it, so business code never passes it around.
export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  // Set by `authenticate` (Phase 3).
  userId?: string;
  role?: string;
  // Set for queue jobs (07 §1.1).
  jobId?: string;
  queue?: string;
  eventType?: string;
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Accept a caller-supplied ID only if it is short and safe to echo into headers and logs.
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

// Adds fields (e.g. the authenticated user) to the current context, if there is one.
export function updateRequestContext(fields: Partial<Omit<RequestContext, 'requestId'>>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}

export function resolveRequestId(incoming: string | undefined): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.get(REQUEST_ID_HEADER));
  res.setHeader(REQUEST_ID_HEADER, requestId);
  const context: RequestContext = { requestId };
  if (req.ip) context.ip = req.ip;
  const userAgent = req.get('user-agent');
  if (userAgent) context.userAgent = userAgent;
  storage.run(context, () => next());
}
