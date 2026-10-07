import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

// npm workspaces hoist dependencies to the repo root, so tracing must start there
// for the standalone Docker output (11-docker-local-dev §5).
const repoRoot = path.resolve(__dirname, '..');

// Host mode (`npm run dev`, 11 §3): the one .env lives at the repo root, where Next does not
// look. Take only the frontend's variables from it (never backend secrets), without overriding
// real environment variables. In Docker there is no .env in the build context; Compose passes
// API_INTERNAL_URL at runtime.
const FRONTEND_VARS = /^(NEXT_PUBLIC_[A-Z0-9_]+|API_INTERNAL_URL)$/;
const rootEnv = path.join(repoRoot, '.env');
if (existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, 'utf8')))) {
    if (FRONTEND_VARS.test(key) && process.env[key] === undefined) process.env[key] = value;
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default nextConfig;
