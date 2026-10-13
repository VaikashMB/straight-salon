// `npm run images:verify -- [tag]` (14-container-registry §3.5): checks the published backend
// and frontend images for one tag (default `main`). For each image it prints the digest the tag
// points at, verifies the cosign signature was made by this repo's CI workflow on main, and shows
// what the attestations say: the SBOM's package count and the commit in the image labels.
// Exits non-zero if any check fails. Needs cosign (https://docs.sigstore.dev/cosign/system_config/installation/)
// and Docker Buildx; public images need no login.
import { execFileSync } from 'node:child_process';

const tag = process.argv[2] ?? 'main';
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

function run(cmd, args) {
  // SBOMs are large (the backend's lists hundreds of packages): allow 64 MB, not the 1 MB default.
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function fail(message) {
  process.stderr.write(`[images:verify] ${message}\n`);
  process.exit(1);
}

// "git@github.com:VaikashMB/straight-salon.git" or "https://github.com/VaikashMB/straight-salon"
// (an ssh host alias works too) -> "VaikashMB/straight-salon"
function githubRepo() {
  const url = run('git', ['remote', 'get-url', 'origin']).trim();
  const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) fail(`can't read the GitHub repository from the origin remote (${url})`);
  return match[1];
}

function inspect(ref, field) {
  return JSON.parse(
    run('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', `{{json .${field}}}`]),
  );
}

try {
  run('cosign', ['version']);
} catch {
  fail('cosign is not installed. See the README section "Published images".');
}

const repo = githubRepo();
const identity = `https://github.com/${repo}/.github/workflows/ci.yml@refs/heads/main`;
const namespace = `ghcr.io/${repo.split('/')[0].toLowerCase()}`;
let failed = false;

for (const app of ['backend', 'frontend']) {
  const image = `${namespace}/straight-salon-${app}`;
  process.stdout.write(`\n${image}:${tag}\n`);
  try {
    // 1. Tag -> digest. Everything below is checked against the digest, never the tag.
    const digest = inspect(`${image}:${tag}`, 'Manifest').digest;
    const pinned = `${image}@${digest}`;
    process.stdout.write(`  digest     ${digest}\n`);

    // 2. Signature: made by our CI workflow on main, recorded in the public Rekor log.
    run('cosign', [
      'verify',
      pinned,
      '--certificate-identity',
      identity,
      '--certificate-oidc-issuer',
      OIDC_ISSUER,
    ]);
    process.stdout.write(`  signature  ok (${identity})\n`);

    // 3. What the image says about itself: commit label, SBOM, provenance.
    const labels = inspect(pinned, 'Image').config?.Labels ?? {};
    process.stdout.write(
      `  commit     ${labels['org.opencontainers.image.revision'] ?? 'unknown'}\n`,
    );
    const sbom = inspect(pinned, 'SBOM');
    process.stdout.write(`  sbom       ${sbom?.SPDX?.packages?.length ?? 0} packages\n`);
    const provenance = inspect(pinned, 'Provenance');
    process.stdout.write(`  provenance ${provenance?.SLSA ? 'present' : 'missing'}\n`);
    if (!sbom?.SPDX || !provenance?.SLSA) throw new Error('attestation missing');
  } catch (error) {
    failed = true;
    const detail = error.stderr?.toString().trim() || error.message;
    process.stdout.write(`  FAILED     ${detail.split('\n').slice(-3).join('\n             ')}\n`);
  }
}

if (failed) fail(`one or more images failed verification for tag "${tag}"`);
process.stdout.write(`\n[images:verify] both images for "${tag}" are signed by ${repo} CI\n`);
