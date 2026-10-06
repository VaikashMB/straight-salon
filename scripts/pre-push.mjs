// Husky pre-push: run unit tests only for workspaces changed since the upstream branch
// (12-automation-and-ci §1). Falls back to all workspaces when there is no upstream yet.
import { execSync } from 'node:child_process';

const WORKSPACES = ['backend', 'frontend'];

function changedFiles() {
  try {
    return execSync('git diff --name-only @{push}...HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null; // no upstream configured
  }
}

const files = changedFiles();
const targets =
  files === null
    ? WORKSPACES
    : WORKSPACES.filter((ws) => files.some((f) => f.startsWith(`${ws}/`)));

for (const ws of targets) {
  process.stdout.write(`[pre-push] running unit tests for ${ws}\n`);
  execSync(`npm run test:unit -w ${ws}`, { stdio: 'inherit' });
}
