// `npm run k8s:up | k8s:down | k8s:seed` (15-kubernetes-basics §3.5): the local Kubernetes
// cluster for FDE step 2. Needs Docker, kind and kubectl (README, "Run on Kubernetes").
//
//   k8s:up             create the kind cluster if missing, install the add-ons, apply
//                      infra/k8s with the image digests pinned in kustomization.yaml
//   k8s:up -- --latest first move those digests to what `main` points at in GHCR (signature
//                      checked with cosign when it's installed), then deploy
//   k8s:up -- --local  build the images from this checkout and load them into the kind nodes
//                      (no registry), for code that isn't published yet; the committed digests
//                      stay as they are
//   k8s:seed           demo data, from this machine through port-forwards (the production
//                      image refuses to seed)
//   k8s:backup         run the nightly MongoDB backup now (16 §3.5)
//   k8s:restore-drill  restore the newest backup into a scratch database and check it
//   k8s:restore -- <archive> <collection>  put one collection back from a backup (no args: list)
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
  // kind's kubelet certificates aren't signed for metrics-server, so it needs
  // --kubelet-insecure-tls (never on a real cluster). Added to the manifest before applying,
  // not patched afterwards: a later `kubectl patch` would own that field, and the next
  // server-side apply would refuse to touch it (a field-manager conflict, 15 §3.5).
  const metricsServer = run('curl', ['-fsSL', '--retry', '5', ADDONS.metricsServer], {
    capture: true,
    quiet: true,
  }).replace('- --secure-port=10250', '- --secure-port=10250\n        - --kubelet-insecure-tls');
  if (!metricsServer.includes('--kubelet-insecure-tls'))
    fail('metrics-server manifest changed shape');
  kubectl(['apply', '--server-side', '--force-conflicts', '-f', '-'], {
    input: metricsServer,
    capture: true,
  });
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

// Secrets (15 §3.4, 16 §2.5). Generated here, never written to disk or git, and REUSED on every
// re-run: a changed password would lock the app out of its own database, a changed outbox key
// would make queued payloads unreadable. Several secrets share values (the app's Mongo password
// is in mongo-auth and inside backend-secrets' MONGO_URI; the S3 keys are in three places), so
// they're all built from one set of values.
const MONGO_HOSTS = [0, 1, 2]
  .map((i) => `mongo-${i}.mongo.${NS}.svc.cluster.local:27017`)
  .join(',');

function readSecret(name) {
  const json = kubectl(['-n', NS, 'get', 'secret', name, '--ignore-not-found', '-o', 'json'], {
    capture: true,
    quiet: true,
  });
  if (!json.trim()) return {};
  const data = JSON.parse(json).data ?? {};
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, Buffer.from(v, 'base64').toString('utf8')]),
  );
}

function applySecret(name, values) {
  const manifest = kubectl(
    [
      '-n',
      NS,
      'create',
      'secret',
      'generic',
      name,
      ...Object.entries(values).map(([k, v]) => `--from-literal=${k}=${v}`),
      '--dry-run=client',
      '-o',
      'yaml',
    ],
    { capture: true, quiet: true },
  );
  kubectl(['apply', '--server-side', '--force-conflicts', '--field-manager=k8s-up', '-f', '-'], {
    input: manifest,
    capture: true,
    quiet: true,
  });
}

function ensureSecrets() {
  const mongo = readSecret('mongo-auth');
  const backend = readSecret('backend-secrets');
  const rclone = readSecret('rclone-s3');
  const hex = (n) => randomBytes(n).toString('hex'); // URI-safe passwords
  const v = {
    rootPassword: mongo['root-password'] ?? hex(24),
    appPassword: mongo['app-password'] ?? hex(24),
    backupPassword: mongo['backup-password'] ?? hex(24),
    keyfile: mongo.keyfile ?? randomBytes(756).toString('base64'),
    jwt: backend.JWT_ACCESS_SECRET ?? randomBytes(48).toString('base64url'),
    outbox: backend.OUTBOX_ENCRYPTION_KEY ?? randomBytes(32).toString('base64'),
    s3Key: rclone.RCLONE_CONFIG_S3_ACCESS_KEY_ID ?? hex(10),
    s3Secret: rclone.RCLONE_CONFIG_S3_SECRET_ACCESS_KEY ?? hex(20),
  };
  const fresh = !mongo['app-password'];
  say(fresh ? 'Generating secrets' : 'Secrets exist, reusing their values');

  applySecret('mongo-auth', {
    'root-password': v.rootPassword,
    'app-password': v.appPassword,
    'backup-password': v.backupPassword,
    keyfile: v.keyfile,
    // Backups and the drill log in as ss_backup (admin database).
    'backup-uri': `mongodb://ss_backup:${v.backupPassword}@${MONGO_HOSTS}/?replicaSet=rs0&authSource=admin`,
  });
  applySecret('backend-secrets', {
    JWT_ACCESS_SECRET: v.jwt,
    OUTBOX_ENCRYPTION_KEY: v.outbox,
    // w=majority: an acknowledged write is on two of three members (16 §2.3).
    MONGO_URI: `mongodb://ss_app:${v.appPassword}@${MONGO_HOSTS}/straight_salon?replicaSet=rs0&authSource=straight_salon&w=majority`,
    S3_ACCESS_KEY_ID: v.s3Key,
    S3_SECRET_ACCESS_KEY: v.s3Secret,
  });
  // SeaweedFS's access rules: one key with full rights, anonymous read on `uploads` only.
  applySecret('seaweedfs-s3', {
    's3.json': JSON.stringify({
      identities: [
        {
          name: 'straight-salon',
          credentials: [{ accessKey: v.s3Key, secretKey: v.s3Secret }],
          actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
        },
        { name: 'anonymous', actions: ['Read:uploads'] },
      ],
    }),
  });
  // rclone (bucket Job, backups) reads its whole configuration from these variables.
  applySecret('rclone-s3', {
    RCLONE_CONFIG_S3_TYPE: 's3',
    RCLONE_CONFIG_S3_PROVIDER: 'SeaweedFS',
    RCLONE_CONFIG_S3_ENDPOINT: 'http://seaweedfs:8333',
    RCLONE_CONFIG_S3_ACCESS_KEY_ID: v.s3Key,
    RCLONE_CONFIG_S3_SECRET_ACCESS_KEY: v.s3Secret,
  });
}

// The inner loop (16 §3.4): run code that CI hasn't published. Build locally, copy the images
// into every kind node's container runtime, deploy those tags instead of the pinned digests.
function buildLocalImages() {
  say('Building local images (inner loop: not signed, not published)');
  const sha = run('git', ['rev-parse', '--short', 'HEAD'], { capture: true, quiet: true }).trim();
  const tags = {};
  for (const app of ['backend', 'frontend']) {
    const build = `straight-salon/${app}:local-build`;
    run('docker', [
      'build',
      '-f',
      `${app}/Dockerfile`,
      '--target',
      'runtime',
      '-t',
      build,
      '--build-arg',
      `GIT_SHA=${sha}`,
      '.',
    ]);
    // Tag by content (the image ID), not by commit: with uncommitted changes the commit stays
    // the same, and an unchanged tag would make Kubernetes keep running the old image.
    const id = run('docker', ['image', 'inspect', '-f', '{{.Id}}', build], {
      capture: true,
      quiet: true,
    })
      .trim()
      .replace('sha256:', '')
      .slice(0, 12);
    const tag = `straight-salon/${app}:local-${id}`;
    run('docker', ['tag', build, tag], { quiet: true });
    run('kind', ['load', 'docker-image', tag, '--name', CLUSTER]);
    tags[app] = tag;
  }
  return tags;
}

// The manifests with the pinned GHCR digests swapped for the local tags.
function renderWithLocalImages(tags) {
  let yaml = kubectl(['kustomize', 'infra/k8s'], { capture: true });
  for (const [app, tag] of Object.entries(tags)) {
    yaml = yaml.replaceAll(
      new RegExp(`ghcr\\.io/vaikashmb/straight-salon-${app}@sha256:[0-9a-f]{64}`, 'g'),
      tag,
    );
  }
  return yaml;
}

// kind nodes share this machine's kernel, and the kernel limits file watchers (inotify) per
// user. Four nodes outgrow the Linux defaults; when they run out, components such as kube-proxy
// fail with "too many open files" (we saw it after a node restart: pod networking on that node
// stopped). kind's documentation recommends these values.
function checkInotifyLimits() {
  const wanted = { max_user_instances: 512, max_user_watches: 524288 };
  const low = Object.entries(wanted).filter(([key, min]) => {
    try {
      return Number(readFileSync(`/proc/sys/fs/inotify/${key}`, 'utf8')) < min;
    } catch {
      return false; // not Linux (Docker Desktop has its own VM): nothing to check
    }
  });
  if (low.length === 0) return;
  say(`WARNING: low inotify limits; nodes may fail with "too many open files". Raise them with:
  sudo sysctl fs.inotify.max_user_instances=512 fs.inotify.max_user_watches=524288
  (to keep them after a reboot, add both lines to /etc/sysctl.d/99-kind.conf)`);
}

function up() {
  requireTools();
  checkInotifyLimits();
  const local = process.argv.includes('--local');
  if (local && process.argv.includes('--latest')) fail('use --latest or --local, not both');
  if (process.argv.includes('--latest')) pinLatest();

  if (clusterExists()) {
    say(`Cluster ${CLUSTER} exists`);
  } else {
    say(`Creating kind cluster ${CLUSTER} (1 control plane + 3 workers)`);
    run('kind', ['create', 'cluster', '--config', 'infra/k8s/kind-config.yaml']);
  }
  installAddons();
  const localTags = local ? buildLocalImages() : null;

  say('Namespace, secrets and the mongo-init script');
  kubectl(['apply', '-f', 'infra/k8s/namespace.yaml']);
  ensureSecrets();
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

  say(`Applying infra/k8s (server-side apply${local ? ', local images' : ''})`);
  const applyArgs = ['apply', '--server-side', '--force-conflicts', '--field-manager=k8s-up'];
  if (localTags) kubectl([...applyArgs, '-f', '-'], { input: renderWithLocalImages(localTags) });
  else kubectl([...applyArgs, '-k', 'infra/k8s']);

  say('Waiting for the rollout');
  for (const job of ['mongo-init', 'buckets', 'migrate']) {
    kubectl(['-n', NS, 'wait', '--for=condition=Complete', `job/${job}`, '--timeout=600s']);
  }
  for (const workload of [
    'statefulset/mongo',
    'statefulset/seaweedfs',
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
  Backups:       npm run k8s:backup && npm run k8s:restore-drill
  Exercises:     docs/specs/15-kubernetes-basics.md §6, 16-stateful-services.md §6`);
}

// ---- seed ---------------------------------------------------------------------------------

function secretValue(name, key) {
  const value = readSecret(name)[key];
  if (!value) fail(`secret ${name} has no ${key}. Run npm run k8s:up first.`);
  return value;
}

// The member that is primary right now ("mongo-1.mongo.<ns>.svc...:27017" -> "mongo-1").
// `hello` needs no login.
function primaryPod() {
  const primary = kubectl(
    [
      '-n',
      NS,
      'exec',
      'mongo-0',
      '-c',
      'mongo',
      '--',
      'mongosh',
      '--quiet',
      '--eval',
      'db.hello().primary',
    ],
    { capture: true, quiet: true },
  ).trim();
  if (!primary) fail('the replica set has no primary right now');
  return primary.split('.')[0];
}

// The seed runs on this machine (the production image refuses to seed), through port-forwards,
// with the cluster's values: the app user's password, and the outbox key the worker uses.
// directConnection: the replica set advertises cluster-internal names this machine can't
// resolve, so talk to the forwarded primary directly.
async function seed() {
  requireTools();
  const primary = primaryPod();
  Object.assign(process.env, {
    NODE_ENV: 'development',
    MONGO_URI: `mongodb://ss_app:${secretValue('mongo-auth', 'app-password')}@127.0.0.1:27018/straight_salon?directConnection=true&authSource=straight_salon`,
    REDIS_URL: 'redis://127.0.0.1:6380',
    APP_BASE_URL: URL,
    UPLOADS_PUBLIC_URL: `${URL}/uploads`,
    JWT_ACCESS_SECRET: secretValue('backend-secrets', 'JWT_ACCESS_SECRET'),
    OUTBOX_ENCRYPTION_KEY: secretValue('backend-secrets', 'OUTBOX_ENCRYPTION_KEY'),
  });
  // Local ports that don't clash with the Compose stack's 27017 / 6379.
  const forwards = [
    [`pod/${primary}`, '27018:27017'],
    ['svc/redis', '6380:6379'],
  ].map(([target, ports]) => {
    process.stdout.write(`  $ kubectl -n ${NS} port-forward ${target} ${ports}\n`);
    return spawn('kubectl', ['--context', CONTEXT, '-n', NS, 'port-forward', target, ports], {
      stdio: 'ignore',
    });
  });
  try {
    await sleep(3000);
    say(`Seeding the primary (${primary}) through the port-forwards`);
    run('npm', ['run', 'db:seed', '-w', 'backend']);
  } finally {
    for (const child of forwards) child.kill();
  }
}

// Runs a CronJob now, as a one-off Job, and shows its output (16 §3.5).
function runCronJob(cronJob) {
  requireTools();
  const job = `${cronJob}-manual-${Date.now().toString(36)}`;
  kubectl(['-n', NS, 'create', 'job', job, `--from=cronjob/${cronJob}`]);
  try {
    kubectl(['-n', NS, 'wait', '--for=condition=Complete', `job/${job}`, '--timeout=300s'], {
      capture: true,
    });
    kubectl(['-n', NS, 'logs', `job/${job}`, '--all-containers']);
    say(`${cronJob}: succeeded`);
  } catch {
    kubectl(['-n', NS, 'logs', `job/${job}`, '--all-containers']);
    fail(`${cronJob}: FAILED (kubectl -n ${NS} describe job ${job})`);
  }
}

// Restores one collection from a named backup into the live database (16 §2.6): the recovery
// a backup exists for. A one-off Job: fetch the archive (rclone), then mongorestore only that
// collection (it refuses to overwrite documents that still exist; drop the collection first
// if you mean to replace it). Lists the backups when called without arguments.
function restore(archive, collection) {
  requireTools();
  if (!archive || !collection) {
    say('Usage: npm run k8s:restore -- <archive> <collection>. Backups (newest first):');
    const pod = `list-backups-${Date.now().toString(36)}`;
    const overrides = {
      spec: {
        containers: [
          {
            name: pod,
            image: 'rclone/rclone:1.75.1',
            args: ['lsf', 's3:backups/mongo/'],
            envFrom: [{ secretRef: { name: 'rclone-s3' } }],
          },
        ],
      },
    };
    kubectl(
      [
        '-n',
        NS,
        'run',
        pod,
        '--restart=Never',
        '--image=rclone/rclone:1.75.1',
        `--overrides=${JSON.stringify(overrides)}`,
      ],
      { capture: true, quiet: true },
    );
    kubectl(
      [
        '-n',
        NS,
        'wait',
        `pod/${pod}`,
        '--for=jsonpath={.status.phase}=Succeeded',
        '--timeout=120s',
      ],
      { capture: true, quiet: true },
    );
    const list = kubectl(['-n', NS, 'logs', pod], { capture: true, quiet: true });
    kubectl(['-n', NS, 'delete', 'pod', pod, '--wait=false'], { capture: true, quiet: true });
    process.stdout.write(
      list
        .split('\n')
        .filter(Boolean)
        .sort()
        .reverse()
        .map((f) => `  ${f}\n`)
        .join(''),
    );
    return;
  }
  if (!/^[\w.-]+\.archive\.gz$/.test(archive) || !/^\w+$/.test(collection))
    fail('bad archive or collection name');
  const name = `mongo-restore-${Date.now().toString(36)}`;
  const job = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name, namespace: NS },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        spec: {
          restartPolicy: 'Never',
          volumes: [{ name: 'backup', emptyDir: {} }],
          initContainers: [
            {
              name: 'fetch',
              image: 'rclone/rclone:1.75.1',
              args: ['copyto', `s3:backups/mongo/${archive}`, '/backup/dump.archive.gz'],
              envFrom: [{ secretRef: { name: 'rclone-s3' } }],
              volumeMounts: [{ name: 'backup', mountPath: '/backup' }],
            },
          ],
          containers: [
            {
              name: 'restore',
              image: 'mongo:8.2',
              command: [
                'bash',
                '-c',
                `mongorestore --uri "$BACKUP_URI" --gzip --archive=/backup/dump.archive.gz --nsInclude 'straight_salon.${collection}'`,
              ],
              env: [
                {
                  name: 'BACKUP_URI',
                  valueFrom: { secretKeyRef: { name: 'mongo-auth', key: 'backup-uri' } },
                },
              ],
              volumeMounts: [{ name: 'backup', mountPath: '/backup' }],
            },
          ],
        },
      },
    },
  };
  kubectl(['apply', '-f', '-'], { input: JSON.stringify(job) });
  try {
    kubectl(['-n', NS, 'wait', '--for=condition=Complete', `job/${name}`, '--timeout=300s'], {
      capture: true,
    });
  } finally {
    kubectl(['-n', NS, 'logs', `job/${name}`, '-c', 'restore']);
  }
  // The restore wrote to MongoDB behind the app's back, so the API's Redis cache may still hold
  // the old answer (e.g. an empty category list). Drop the cached entries (not the rate-limit
  // counters, not the job queues); the app refills them from MongoDB on the next request.
  const cached = kubectl(
    ['-n', NS, 'exec', 'redis-0', '--', 'redis-cli', '--scan', '--pattern', 'ss:v1:*'],
    {
      capture: true,
      quiet: true,
    },
  )
    .split('\n')
    .filter((key) => key && !key.startsWith('ss:v1:rl:'));
  if (cached.length) {
    kubectl(['-n', NS, 'exec', 'redis-0', '--', 'redis-cli', 'del', ...cached], { capture: true });
  }
  say(
    `Restored straight_salon.${collection} from ${archive}; cleared ${cached.length} cached API responses`,
  );
}

// ---- main ---------------------------------------------------------------------------------

const command = process.argv[2];
if (command === 'up') up();
else if (command === 'seed') {
  await seed();
  say(`Seeded. Sign in at ${URL} with customer1@straightsalon.local / Password@123`);
} else if (command === 'backup') runCronJob('mongo-backup');
else if (command === 'restore-drill') runCronJob('mongo-restore-drill');
else if (command === 'restore') restore(process.argv[3], process.argv[4]);
else if (command === 'down') {
  requireTools();
  run('kind', ['delete', 'cluster', '--name', CLUSTER]);
} else
  fail(
    'usage: node scripts/k8s.mjs up [--latest] | seed | backup | restore-drill | restore [archive collection] | down',
  );
