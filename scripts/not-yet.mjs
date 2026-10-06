// Placeholder for root scripts whose implementation lands in a later build phase
// (see docs/specs/13-build-plan.md). Exits 0 so `npm run validate` stays usable.
const [script, phase] = process.argv.slice(2);
process.stdout.write(
  `[not-yet] "${script}" is implemented in Phase ${phase} (docs/specs/13-build-plan.md). Skipping.\n`,
);
