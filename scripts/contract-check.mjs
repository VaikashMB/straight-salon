// `npm run contract:check` (12 §2): regenerates backend/openapi.json and fails if it differs
// from the version in git (staged or committed), i.e. the API changed without the contract
// being re-exported. Phase 8 extends this to the generated frontend client.
import { execSync } from 'node:child_process';

const CONTRACT = 'backend/openapi.json';

function fail(reason) {
  process.stderr.write(
    `[contract:check] ${reason}\nRun \`npm run openapi:export\` and commit ${CONTRACT}.\n`,
  );
  process.exit(1);
}

execSync('npm run openapi:export --silent -w backend', { stdio: 'inherit' });

try {
  execSync(`git ls-files --error-unmatch ${CONTRACT}`, { stdio: 'ignore' });
} catch {
  fail(`${CONTRACT} is not tracked by git.`);
}

try {
  execSync(`git diff --quiet -- ${CONTRACT}`); // working tree (just regenerated) vs index
} catch {
  fail(`${CONTRACT} is out of date with the code.`);
}

process.stdout.write(`[contract:check] ${CONTRACT} matches the code\n`);
