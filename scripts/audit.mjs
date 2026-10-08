// `npm run audit` (06 §4, 10 §6, 12 §3): `npm audit --audit-level=high`, except advisories listed
// in scripts/audit-allowlist.json. npm audit cannot skip a single advisory, and an advisory with
// no patched release would otherwise block CI with nothing to upgrade to. Each allowlist entry
// names the advisory (GHSA id), why it is acceptable, and an expiry date after which it fails
// again, so every exception is reviewed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BLOCKING = new Set(['high', 'critical']);
const allowlist = JSON.parse(readFileSync(new URL('./audit-allowlist.json', import.meta.url)));
const today = new Date().toISOString().slice(0, 10);

let report;
try {
  report = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
} catch (err) {
  report = err.stdout; // npm audit exits non-zero when it finds anything
}
const { vulnerabilities = {} } = JSON.parse(report);

// Advisories are the object entries in `via`; string entries only point at another package.
const advisories = new Map();
for (const vuln of Object.values(vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via === 'object' && BLOCKING.has(via.severity)) {
      const id = via.url?.split('/').pop() ?? String(via.source);
      advisories.set(id, { id, name: via.name, title: via.title, severity: via.severity });
    }
  }
}

const allowed = (id) => allowlist.find((entry) => entry.advisory === id && entry.until >= today);
const blocking = [...advisories.values()].filter((a) => !allowed(a.id));
const accepted = [...advisories.values()].filter((a) => allowed(a.id));

for (const a of accepted) {
  process.stdout.write(
    `[audit] allowed until ${allowed(a.id).until}: ${a.id} ${a.name} (${a.severity})\n`,
  );
}
for (const entry of allowlist.filter((e) => e.until < today)) {
  process.stdout.write(`[audit] allowlist entry ${entry.advisory} expired on ${entry.until}\n`);
}
if (blocking.length > 0) {
  for (const a of blocking) {
    process.stderr.write(`[audit] ${a.severity}: ${a.id} ${a.name}: ${a.title}\n`);
  }
  process.stderr.write(`[audit] ${blocking.length} high/critical advisories. Run \`npm audit\`.\n`);
  process.exit(1);
}
process.stdout.write('[audit] no high or critical advisories outside the allowlist\n');
