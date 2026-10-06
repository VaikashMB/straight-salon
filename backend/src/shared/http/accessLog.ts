import type { RequestHandler } from 'express';
import type { Logger } from '../logger/index.js';
import { routePattern } from './routePattern.js';

type Level = 'error' | 'warn' | 'info';

// 07-logging §1.3: 5xx -> error, 4xx -> warn except 401/404 -> info, everything else -> info.
export function accessLogLevel(status: number): Level {
  if (status >= 500) return 'error';
  if (status >= 400 && status !== 401 && status !== 404) return 'warn';
  return 'info';
}

const SKIPPED_PREFIXES = ['/health/', '/metrics'];

// One line per response, logged on finish with the route pattern (not the raw URL, to keep
// cardinality low and keep IDs/PII out of logs). requestId/userId come from the logger mixin.
export function accessLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    if (SKIPPED_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const responseTimeMs = Number(process.hrtime.bigint() - start) / 1e6;
      const contentLength = Number(res.getHeader('content-length') ?? 0);
      logger[accessLogLevel(res.statusCode)](
        {
          method: req.method,
          route: routePattern(req),
          status: res.statusCode,
          responseTimeMs: Math.round(responseTimeMs * 10) / 10,
          contentLength,
          userAgent: req.get('user-agent'),
        },
        'Request completed',
      );
    });
    next();
  };
}
