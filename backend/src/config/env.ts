import { z } from 'zod';

// Subset of 03-backend §3 needed so far. Later phases add their variables here, never read
// process.env anywhere else.

const booleanFlag = (fallback: boolean) => z.stringbool().default(fallback);

const positiveInt = (fallback: number) =>
  z
    .string()
    .regex(/^\d+$/, 'Must be a whole number')
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(fallback);

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
    // ---- Auth (06) ----
    JWT_ACCESS_SECRET: z
      .string({ error: 'Required (run `npm run env:init` to create .env with one)' })
      .min(32, 'Must be at least 32 characters')
      .refine((value) => !value.startsWith('replace-with-'), {
        error: 'Still the .env.example placeholder (run `npm run env:init`)',
      }),
    JWT_ACCESS_TTL: z
      .string()
      .regex(/^\d+[smhd]$/, 'Use a duration like 15m, 900s or 1h')
      .default('15m'),
    JWT_ISSUER: z.string().min(1).default('straight-salon-api'),
    JWT_AUDIENCE: z.string().min(1).default('straight-salon-web'),
    REFRESH_TOKEN_TTL_DAYS: positiveInt(7),
    // Empty = host-only cookies (recommended; browsers reject Domain=localhost).
    COOKIE_DOMAIN: z.string().optional(),
    // Defaults to true in production (06 §1: Secure in prod).
    COOKIE_SECURE: z.stringbool().optional(),
    BCRYPT_COST: positiveInt(12).pipe(z.number().int().min(4).max(15)),
    RATE_LIMIT_WINDOW_MS: positiveInt(60_000),
    RATE_LIMIT_MAX: positiveInt(300),
    // Run pending migrations when the API starts. Defaults to on outside production (12 §4).
    MIGRATE_ON_START: z.stringbool().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.BCRYPT_COST < 10 && env.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['BCRYPT_COST'],
        message: 'Costs below 10 are only allowed when NODE_ENV=test (NFR-009 requires 12)',
      });
    }
  })
  .transform(({ SWAGGER_ENABLED, COOKIE_SECURE, MIGRATE_ON_START, COOKIE_DOMAIN, ...rest }) => {
    const production = rest.NODE_ENV === 'production';
    return {
      ...rest,
      SWAGGER_ENABLED: SWAGGER_ENABLED ?? !production,
      COOKIE_SECURE: COOKIE_SECURE ?? production,
      MIGRATE_ON_START: MIGRATE_ON_START ?? !production,
      COOKIE_DOMAIN: COOKIE_DOMAIN?.trim() ? COOKIE_DOMAIN.trim() : undefined,
    };
  });

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
