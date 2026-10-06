import type { Request } from 'express';

// Low-cardinality route label for logs and metrics: "/api/v1/bookings/:id", never the raw URL.
export function routePattern(req: Request): string {
  const route: unknown = req.route;
  if (route && typeof route === 'object' && 'path' in route && typeof route.path === 'string') {
    return `${req.baseUrl}${route.path}`;
  }
  return 'unmatched';
}
