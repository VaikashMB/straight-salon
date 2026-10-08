// `npm run sonar` (10-testing-and-quality §5.3): runs sonar-scanner in Docker against the
// SonarQube in SONAR_HOST_URL (default: the local one from `npm run sonar:up`) and waits for the
// quality gate, so a red gate fails the command. Reads SONAR_HOST_URL / SONAR_TOKEN from the
// environment or the repo-root .env (`npm run sonar:setup` creates the token).
// Run `npm run test:coverage` first: the scan reads backend/ and frontend/coverage/lcov.info.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';

const SCANNER_IMAGE = 'sonarsource/sonar-scanner-cli:11';
const host = process.env.SONAR_HOST_URL || 'http://localhost:9000';
const token = process.env.SONAR_TOKEN;

if (!token) {
  process.stderr.write('[sonar] SONAR_TOKEN is not set. Run `npm run sonar:setup` first.\n');
  process.exit(1);
}
for (const report of ['backend/coverage/lcov.info', 'frontend/coverage/lcov.info']) {
  if (!existsSync(report)) {
    process.stderr.write(`[sonar] ${report} is missing. Run \`npm run test:coverage\` first.\n`);
    process.exit(1);
  }
}

const { uid, gid } = userInfo();
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    'host', // reach a SonarQube published on the host's localhost
    '--user',
    `${uid}:${gid}`, // scanner files (.scannerwork) stay owned by the developer
    '-e',
    `SONAR_HOST_URL=${host}`,
    '-e',
    'SONAR_TOKEN', // passed through from this process's environment, never on the command line
    '-e',
    'SONAR_USER_HOME=/usr/src/.sonar-cache', // plugin cache, kept between runs
    '-v',
    `${process.cwd()}:/usr/src`,
    SCANNER_IMAGE,
    '-Dsonar.working.directory=/usr/src/.scannerwork', // the image default (/tmp) is root-owned
    '-Dsonar.qualitygate.wait=true',
  ],
  { stdio: 'inherit', env: { ...process.env, SONAR_TOKEN: token } },
);
process.exit(result.status ?? 1);
