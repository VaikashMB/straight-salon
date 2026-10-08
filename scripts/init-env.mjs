// `npm run env:init`: creates .env from .env.example (if missing) and replaces placeholder
// secrets with fresh random values. Never overwrites a value that is already real, and never
// prints secrets. Safe to run repeatedly.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const ENV = '.env';
const EXAMPLE = '.env.example';

const generators = {
  JWT_ACCESS_SECRET: () => randomBytes(48).toString('base64url'),
  OUTBOX_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  // SonarQube's policy: 12+ characters with upper and lower case, a digit and a symbol.
  SONAR_ADMIN_PASSWORD: () => `Sq-${randomBytes(18).toString('base64url')}-9a`,
};

const isPlaceholder = (value) => value === '' || value.startsWith('replace-with-');

if (!existsSync(ENV)) {
  copyFileSync(EXAMPLE, ENV);
  process.stdout.write(`[env:init] created ${ENV} from ${EXAMPLE}\n`);
}

const lines = readFileSync(ENV, 'utf8').split('\n');
const generated = [];
const updated = lines.map((line) => {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!match) return line;
  const [, name, value] = match;
  const generate = generators[name];
  if (!generate || !isPlaceholder(value)) return line;
  generated.push(name);
  return `${name}=${generate()}`;
});

writeFileSync(ENV, updated.join('\n'));
process.stdout.write(
  generated.length > 0
    ? `[env:init] generated: ${generated.join(', ')}\n`
    : '[env:init] secrets already set; nothing to do\n',
);
