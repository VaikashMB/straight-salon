import { z } from 'zod';

// Subset of 03-backend §3 needed so far. Later phases add their variables here, never read
// process.env anywhere else.
const envSchema = z.object({
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
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
