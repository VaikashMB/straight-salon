// `npm run k8s:up | k8s:down | k8s:seed` (15-kubernetes-basics §3.5): the local Kubernetes
// cluster for FDE step 2. Needs Docker, kind and kubectl (README, "Run on Kubernetes").
//
//   k8s:up             create the kind cluster if missing, install the add-ons, apply
//                      infra/k8s with the image digests pinned in kustomization.yaml
//   k8s:up -- --latest first move those digests to what `main` points at in GHCR (signature
//                      checked with cosign when it's installed), then deploy
//   k8s:seed           demo data, from this machine through port-forwards (the production
//                      image refuses to seed)
//   k8s:down           delete the cluster
//
// Every step prints the kubectl command it runs, so the script doubles as a walkthrough.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CLUSTER = 'straight-salon';
const CONTEXT = `kind-${CLUSTER}`;
const NS = 'straight-salon';
const URL = 'https://salon.localhost';
const KUSTOMIZATION = 'infra/k8s/kustomization.yaml';

// Cluster add-ons, pinned (15 §3.1). Installed from their release manifests (no Helm needed).
const ADDONS = {
  envoyGateway: 'https://github.com/envoyproxy/gateway/releases/download/v1.9.2/install.yaml',
  certManager:
    'https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml',
  metricsServer:
    'https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.0/components.yaml',
};

const IMAGES = ['backend', 'frontend'].map((app) => `ghcr.io/vaikashmb/straight-salon-${app}`);
const SIGNER =
  'https://github.com/VaikashMB/straight-salon/.github/workflows/ci.yml@refs/heads/main';

const say = (message) => process.stdout.write(`\n[k8s] ${message}\n`);
function fail(message) {
  process.stderr.write(`\n[k8s] ${message}\n`);
  process.exit(1);
}

// Runs a command, echoing it; output streams to the terminal unless `capture`.
function run(cmd, args, { capture = false, input, quiet = false } = {}) {
  if (!quiet) process.stdout.write(`  $ ${cmd} ${args.join(' ')}\n`);
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
  });
}
const kubectl = (args, opts) => run('kubectl', ['--context', CONTEXT, ...args], opts);

function has(cmd) {
  try {
    execFileSync(cmd, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execFileSync(cmd, ['version', '--client'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

function requireTools() {
  const missing = ['docker', 'kind', 'kubectl'].filter((tool) => !has(tool));
  if (missing.length) fail(`missing ${missing.join(', ')}. See the README, "Run on Kubernetes".`);
}

// ---- digests ------------------------------------------------------------------------------

function digestOf(ref) {
  const json = run(
    'docker',
    ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'],
    {
      capture: true,
    },
  );
  return JSON.parse(json).digest;
}

// Moves the pinned digests to what `main` points at, after checking each signature (14 §2.7).
function pinLatest() {
  say('Resolving the digests `main` points at in GHCR');
  const cosign = has('cosign');
  if (!cosign)
    say('cosign not installed: pinning WITHOUT verifying signatures (README, "Published images")');
  let text = readFileSync(KUSTOMIZATION, 'utf8');
  for (const image of IMAGES) {
    const digest = digestOf(`${image}:main`);
    if (cosign) {
      run(
        'cosign',
        [
          'verify',
          `${image}@${digest}`,
          '--certificate-identity',
          SIGNER,
          '--certificate-oidc-issuer',
          'https://token.actions.githubusercontent.com',
        ],
        { capture: true },
      );
      process.stdout.write(`  signature ok: ${image}@${digest}\n`);
    }
    const pattern = new RegExp(`(- name: ${image}\\n\\s+digest: )sha256:[0-9a-f]{64}`);
    if (!pattern.test(text)) fail(`${KUSTOMIZATION} has no digest entry for ${image}`);
    text = text.replace(pattern, `$1${digest}`);
  }
  writeFileSync(KUSTOMIZATION, text);
  say(`Pinned in ${KUSTOMIZATION}. Commit it: the deployed version is a decision recorded in git.`);
}

// ---- up -----------------------------------------------------------------------------------

function clusterExists() {
  return run('kind', ['get', 'clusters'], { capture: true, quiet: true })
    .split('\n')
    .includes(CLUSTER);
}

function installAddons() {
  say('Installing cluster add-ons: Envoy Gateway (Gateway API), cert-manager, metrics-server');
  kubectl(['apply', '--server-side', '-f', ADDONS.envoyGateway], { capture: true });
  kubectl(['apply', '--server-side', '-f', ADDONS.certManager], { capture: true });
  kubectl(['apply', '--server-side', '-f', ADDONS.metricsServer], { capture: true });
  // kind's kubelet certificates aren't signed for metrics-server. Never do this on a real cluster.
  const args = kubectl(
    [
      '-n',
      'kube-system',
      'get',
      'deployment',
      'metrics-server',
      '-o',
      'jsonpath={.spec.template.spec.containers[0].args}',
    ],
    { capture: true, quiet: true },
  );
  if (!args.includes('--kubelet-insecure-tls')) {
    kubectl([
      '-n',
      'kube-system',
      'patch',
      'deployment',
      'metrics-server',
      '--type=json',
      '-p',
      '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]',
    ]);
  }
  for (const ns of ['envoy-gateway-system', 'cert-manager']) {
    kubectl([
      '-n',
      ns,
      'wait',
      '--for=condition=Available',
      'deployment',
      '--all',
      '--timeout=300s',
    ]);
  }
  kubectl([
    '-n',
    'kube-system',
    'wait',
    '--for=condition=Available',
    'deployment/metrics-server',
    '--timeout=300s',
  ]);
}

// The Secret is generated here, once, and never written to disk or git (15 §3.4). Kept on
// re-runs, so sessions and encrypted outbox payloads survive a redeploy.
function ensureSecret() {
  const existing = kubectl(
    ['-n', NS, 'get', 'secret', 'backend-secrets', '--ignore-not-found', '-o', 'name'],
    {
      capture: true,
      quiet: true,
    },
  );
  if (existing.trim()) {
    say('Secret backend-secrets exists, keeping it');
    return;
  }
  say('Creating Secret backend-secrets with fresh random values');
  const manifest = kubectl(
    [
      '-n',
      NS,
      'create',
      'secret',
      'generic',
      'backend-secrets',
      `--from-literal=JWT_ACCESS_SECRET=${randomBytes(48).toString('base64url')}`,
      `--from-literal=OUTBOX_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      '--dry-run=client',
      '-o',
      'yaml',
    ],
    { capture: true, quiet: true },
  );
  kubectl(['apply', '-f', '-'], { input: manifest });
}

function up() {
  requireTools();
  if (process.argv.includes('--latest')) pinLatest();

  if (clusterExists()) {
    say(`Cluster ${CLUSTER} exists`);
  } else {
    say(`Creating kind cluster ${CLUSTER} (1 control plane + 2 workers)`);
    run('kind', ['create', 'cluster', '--config', 'infra/k8s/kind-config.yaml']);
  }
  installAddons();

  say('Namespace, Secret and the mongo-init script');
  kubectl(['apply', '-f', 'infra/k8s/namespace.yaml']);
  ensureSecret();
  const initScript = kubectl(
    [
      '-n',
      NS,
      'create',
      'configmap',
      'mongo-init',
      '--from-file=mongo-init.js=infra/docker/mongo-init.js',
      '--dry-run=client',
      '-o',
      'yaml',
    ],
    { capture: true, quiet: true },
  );
  kubectl(['apply', '--server-side', '--field-manager=k8s-up', '-f', '-'], {
    input: initScript,
    capture: true,
  });

  // A Job's pod template can't change after creation: replace last deploy's migration run.
  kubectl(['-n', NS, 'delete', 'job', 'migrate', '--ignore-not-found']);

  say('Applying infra/k8s (server-side apply)');
  kubectl([
    'apply',
    '--server-side',
    '--force-conflicts',
    '--field-manager=k8s-up',
    '-k',
    'infra/k8s',
  ]);

  say('Waiting for the rollout');
  kubectl(['-n', NS, 'wait', '--for=condition=Complete', 'job/migrate', '--timeout=300s']);
  for (const workload of [
    'statefulset/mongo',
    'statefulset/redis',
    'deployment/backend',
    'deployment/worker',
    'deployment/frontend',
    'deployment/mailpit',
  ]) {
    kubectl(['-n', NS, 'rollout', 'status', workload, '--timeout=300s']);
  }
  kubectl(['-n', NS, 'wait', '--for=condition=Programmed', 'gateway/salon', '--timeout=120s']);
  kubectl(['-n', NS, 'get', 'pods', '-o', 'wide']);

  say(`Ready: ${URL}
  Demo data:     npm run k8s:seed
  Emails:        kubectl -n ${NS} port-forward svc/mailpit 8025   → http://localhost:8025
  Look around:   kubectl -n ${NS} get pods,svc,gateway,httproute
  Exercises:     docs/specs/15-kubernetes-basics.md §6`);
}

// ---- seed ---------------------------------------------------------------------------------

function secretValue(key) {
  const b64 = kubectl(
    ['-n', NS, 'get', 'secret', 'backend-secrets', '-o', `jsonpath={.data.${key}}`],
    {
      capture: true,
      quiet: true,
    },
  );
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function seed() {
  requireTools();
  // Local ports that don't clash with the Compose stack's 27017 / 6379.
  const forwards = [
    ['pod/mongo-0', '27018:27017'],
    ['svc/redis', '6380:6379'],
  ].map(([target, ports]) => {
    process.stdout.write(`  $ kubectl -n ${NS} port-forward ${target} ${ports}\n`);
    return spawn('kubectl', ['--context', CONTEXT, '-n', NS, 'port-forward', target, ports], {
      stdio: 'ignore',
    });
  });
  try {
    await sleep(3000);
    say('Seeding through the port-forwards');
    run('npm', ['run', 'db:seed', '-w', 'backend']);
  } finally {
    for (const child of forwards) child.kill();
  }
}

// The seed runs on this machine with the cluster's values (the outbox key must match the
// worker's). directConnection: the replica set advertises mongo-0.mongo.<ns>.svc.cluster.local,
// which this machine can't resolve, so talk to the forwarded member directly.
function seedEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'development',
    MONGO_URI: 'mongodb://127.0.0.1:27018/straight_salon?directConnection=true',
    REDIS_URL: 'redis://127.0.0.1:6380',
    APP_BASE_URL: URL,
    UPLOADS_PUBLIC_URL: `${URL}/uploads`,
    JWT_ACCESS_SECRET: secretValue('JWT_ACCESS_SECRET'),
    OUTBOX_ENCRYPTION_KEY: secretValue('OUTBOX_ENCRYPTION_KEY'),
  });
}

// ---- main ---------------------------------------------------------------------------------

const command = process.argv[2];
if (command === 'up') up();
else if (command === 'seed') {
  seedEnv();
  await seed();
  say(`Seeded. Sign in at ${URL} with customer1@straightsalon.local / Password@123`);
} else if (command === 'down') {
  requireTools();
  run('kind', ['delete', 'cluster', '--name', CLUSTER]);
} else fail('usage: node scripts/k8s.mjs up [--latest] | seed | down');
