// `npm run contract:check` (12 §2): regenerates backend/openapi.json and, from it, the typed
// frontend client (frontend/src/lib/api/schema.d.ts), then fails if either differs from the
// version in git (staged or committed): the API changed without the contract being re-exported,
// or the contract changed without the client being regenerated.
import { execSync } from 'node:child_process';

const FILES = [
  { path: 'backend/openapi.json', regenerate: 'npm run openapi:export --silent -w backend' },
  { path: 'frontend/src/lib/api/schema.d.ts', regenerate: 'npm run api:client --silent' },
];

function fail(reason) {
  process.stderr.write(
    `[contract:check] ${reason}\nRun \`npm run openapi:export && npm run api:client\` and commit ${FILES.map((f) => f.path).join(' and ')}.\n`,
  );
  process.exit(1);
}

for (const file of FILES) execSync(file.regenerate, { stdio: 'inherit' });

for (const { path } of FILES) {
  try {
    execSync(`git ls-files --error-unmatch ${path}`, { stdio: 'ignore' });
  } catch {
    fail(`${path} is not tracked by git.`);
  }
  try {
    execSync(`git diff --quiet -- ${path}`); // working tree (just regenerated) vs index
  } catch {
    fail(`${path} is out of date with the code.`);
  }
}

process.stdout.write(`[contract:check] ${FILES.map((f) => f.path).join(', ')} match the code\n`);
