// Staged-file checks run by the Husky pre-commit hook (12-automation-and-ci §1).
// lint-staged passes absolute paths, so ESLint can run inside each workspace.
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

const workspace = (name) => (files) => [
  `npm exec -w ${name} -- eslint --fix --max-warnings=0 ${quote(files)}`,
  `prettier --write ${quote(files)}`,
  `npm run typecheck -w ${name}`,
];

export default {
  'backend/**/*.ts': workspace('backend'),
  'frontend/**/*.{ts,tsx}': workspace('frontend'),
  '*.{js,mjs,cjs,mts,json,md,yml,yaml,css}': (files) =>
    `prettier --write --ignore-unknown ${quote(files)}`,
};
