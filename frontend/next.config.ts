import path from 'node:path';
import type { NextConfig } from 'next';

// npm workspaces hoist dependencies to the repo root, so tracing must start there
// for the standalone Docker output (11-docker-local-dev §5).
const repoRoot = path.resolve(__dirname, '..');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default nextConfig;
