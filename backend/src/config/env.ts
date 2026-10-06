import { z } from 'zod';

// Subset of 03-backend §3 needed so far. Later phases add their variables here, never read
// process.env anywhere else.

const booleanFlag = (fallback: boolean) => z.stringbool().default(fallback);

const envSchema = z
  .object({
    MONGO_URI: z
      .string({ error: 'Required' })
      .regex(/^mongodb(\+srv)?:\/\//, 'Must be a mongodb:// or mongodb+srv:// URI'),
    REDIS_URL: z
      .string({ error: 'Required' })
      .regex(/^rediss?:\/\//, 'Must be a redis:// or rediss:// URL'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z
      .string({ error: 'Required' })
      .regex(/^\d+$/, 'Must be a whole number')
      .transform(Number)
      .pipe(z.number().int().min(1).max(65535)),
    APP_VERSION: z.string().min(1).default('0.0.0-dev'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFlag(false),
    // Comma-separated allow-list of browser origins (06 §4 CORS). Empty = no cross-origin access.
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url({ error: 'Each origin must be a URL' }))),
    CACHE_ENABLED: booleanFlag(true),
    METRICS_ENABLED: booleanFlag(true),
    // Defaults to on outside production (06 §4: disabled in prod unless protected).
    SWAGGER_ENABLED: z.stringbool().optional(),
    RUN_RELAY_IN_WORKER: booleanFlag(true),
    // 32 random bytes, base64. Encrypts secrets carried in outbox payloads (09 §7).
    OUTBOX_ENCRYPTION_KEY: z
      .string({ error: 'Required (run `npm run env:init` to create .env with one)' })
      .refine((value) => Buffer.from(value, 'base64').length === 32, {
        error: 'Must be 32 bytes, base64-encoded (run `npm run env:init` to generate one)',
      }),
  })
  .transform(({ SWAGGER_ENABLED, ...rest }) => ({
    ...rest,
    SWAGGER_ENABLED: SWAGGER_ENABLED ?? rest.NODE_ENV !== 'production',
  }));

export type Env = z.infer<typeof envSchema>;

export interface EnvIssue {
  path: string;
  message: string;
}

export class EnvValidationError extends Error {
  constructor(readonly issues: EnvIssue[]) {
    super(`Invalid environment configuration: ${issues.map((i) => i.path).join(', ')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
