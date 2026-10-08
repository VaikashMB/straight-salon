import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { request, type FullConfig } from '@playwright/test';

// Runs once before the suite:
// 1. Waits until the frontend and, through its /api proxy, the API answer.
// 2. Clears the API's auth and booking rate-limit counters in the stack's Redis, so repeated
//    local runs within 15 minutes do not hit 429 (06 §4). Only these counters are touched.
//    Set E2E_RESET_RATE_LIMITS=false when the stack is not the local docker-compose one.

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RATE_LIMIT_PATTERNS = ['ss:v1:rl:auth:*', 'ss:v1:rl:bookings:*'];
const READY_TIMEOUT_MS = 120_000;

async function waitForStack(baseURL: string): Promise<void> {
  const api = await request.newContext({ baseURL });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  try {
    for (;;) {
      try {
        const res = await api.get('/api/v1/settings/public');
        if (res.ok()) return;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        throw new Error(
          `The stack at ${baseURL} is not ready. Run \`npm run up && npm run seed\`.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  } finally {
    await api.dispose();
  }
}

function redisCli(args: string[]): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resetRateLimits(): void {
  try {
    for (const pattern of RATE_LIMIT_PATTERNS) {
      const keys = redisCli(['--scan', '--pattern', pattern]).split('\n').filter(Boolean);
      if (keys.length > 0) redisCli(['del', ...keys]);
    }
  } catch (err) {
    process.stderr.write(
      `[e2e] could not reset rate limits (${(err as Error).message.split('\n')[0]}); continuing\n`,
    );
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  await waitForStack(baseURL);
  if (process.env.E2E_RESET_RATE_LIMITS !== 'false') resetRateLimits();
}
