import type { Request, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/index.js';
import { updateRequestContext } from '../http/requestContext.js';
import type { AccessTokenService, AuthContext } from './accessToken.js';
import { hasPermission, type Permission } from './permissions.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

// authenticate (06 §3): Bearer JWT -> req.auth, and the user into the logging/audit context.
// Expired -> 401 TOKEN_EXPIRED (frontend refreshes); anything else -> 401 UNAUTHENTICATED.
export function authenticate(tokens: AccessTokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const match = header ? /^Bearer (.+)$/i.exec(header) : null;
    if (!match?.[1]) {
      next(new UnauthorizedError());
      return;
    }
    const auth = await tokens.verify(match[1]);
    req.auth = auth;
    updateRequestContext({ userId: auth.userId, role: auth.role });
    next();
  };
}

// For public endpoints that also serve an admin view (e.g. includeInactive=true): no header is
// fine, but a header that is present must be valid, so a stale token is not silently ignored.
export function optionalAuthenticate(tokens: AccessTokenService): RequestHandler {
  const required = authenticate(tokens);
  return (req, res, next) => {
    if (req.get('authorization') === undefined) {
      next();
      return;
    }
    return required(req, res, next);
  };
}

// Admin-only switches on public endpoints: 401 when anonymous, 403 for other roles.
export function assertPermission(auth: AuthContext | undefined, permission: Permission): void {
  if (!auth) throw new UnauthorizedError();
  if (!hasPermission(auth.role, permission)) throw new ForbiddenError();
}

export function canDo(auth: AuthContext | undefined, permission: Permission): boolean {
  return auth !== undefined && hasPermission(auth.role, permission);
}

// authorize: the role must hold at least one of the listed permissions (06 §3).
export function authorize(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(new UnauthorizedError());
      return;
    }
    if (!permissions.some((permission) => hasPermission(auth.role, permission))) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

// CSRF defence for cookie-carrying auth endpoints (06 §4): a custom header that a cross-site
// form or <img> cannot set. Combined with SameSite=Lax and the /api/v1/auth cookie path.
export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'straight-salon-web';

export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    next(new ForbiddenError(`Missing ${CSRF_HEADER}: ${CSRF_HEADER_VALUE} header.`));
    return;
  }
  next();
};
