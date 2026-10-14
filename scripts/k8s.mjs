// `npm run k8s:*` (15-kubernetes-basics §3.5, 17 §3.4): the local Kubernetes cluster and its
// environments. Needs Docker, kind and kubectl (README, "Run on Kubernetes").
//
// Every command takes `-- --env dev|staging|prod` (default dev, the least dangerous one). The
// environment's namespace, hostname and Mongo member count come from its overlay
// (infra/k8s/overlays/<env>), never from this file.
//
//   k8s:up             create the kind cluster if missing, install the add-ons and the shared
//                      platform (Gateway, certificates), then apply the environment's overlay
//                      with the image digests pinned in it
//   k8s:up -- --latest (dev only) first move dev's digests to what `main` points at in GHCR
//                      (signature checked with cosign when it's installed), then deploy
//   k8s:up -- --local  (dev only) build the images from this checkout and load them into the
//                      kind nodes (no registry), for code that isn't published yet; the
//                      committed digests stay as they are
//   k8s:promote -- <from> <to>  copy the digests one environment runs to the next one
//                      (dev → staging → prod), after checking <from> really runs them
//   k8s:render         print the environment's manifests, as they would be applied
//   k8s:diff           what applying the environment would change in the running cluster
//   k8s:seed           demo data, from this machine through port-forwards (the production
//                      image refuses to seed)
//   k8s:backup         run the nightly MongoDB backup now (16 §3.5; staging and prod)
//   k8s:restore-drill  restore the newest backup into a scratch database and check it
//   k8s:restore -- <archive> <collection>  put one collection back from a backup (no args: list)
//   k8s:down           delete the cluster; with --env, only that environment's namespace
//
// Every step prints the kubectl command it runs, so the script doubles as a walkthrough.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ENVIRONMENTS,
  OUR_IMAGES as IMAGES,
  PLATFORM_DIR,
  describe,
  overlayDir,
  overlayKustomization,
  render,
} from './k8s-manifests.mjs';

const CLUSTER = 'straight-salon';
const CONTEXT = `kind-${CLUSTER}`;
const GATEWAY_NS = 'straight-salon-gateway';

// `--env <name>` (or `--env=<name>`); dev unless stated.
function envArg() {
  const args = process.argv.slice(3);
  const i = args.findIndex((a) => a === '--env' || a.startsWith('--env='));
  if (i < 0) return 'dev';
  const value = args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  if (!ENVIRONMENTS.includes(value)) fail(`--env must be one of ${ENVIRONMENTS.join(', ')}`);
  return value;
}
// Positional arguments after the command, without the flags.
function positional() {
  const args = process.argv.slice(3);
  return args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--env');
}

// Cluster add-ons, pinned (15 §3.1). Installed from their release manifests (no Helm needed).
const ADDONS = {
  envoyGateway: 'https://github.com/envoyproxy/gateway/releases/download/v1.9.2/install.yaml',
  certManager:
    'https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml',
  metricsServer:
    'https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.0/components.yaml',
};

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
    maxBuffer: 64 * 1024 * 1024, // add-on manifests are several MB (Node's default: 1 MB)
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

// The digests an overlay pins, by image.
function pinnedDigests(env) {
  const text = readFileSync(overlayKustomization(env), 'utf8');
  return Object.fromEntries(
    IMAGES.map((image) => {
      const match = text.match(digestPattern(image));
      if (!match) fail(`${overlayKustomization(env)} has no digest entry for ${image}`);
      return [image, match[2]];
    }),
  );
}
const digestPattern = (image) =>
  new RegExp(`(- name: ${image.replaceAll('.', '\\.')}\\n\\s+digest: )(sha256:[0-9a-f]{64})`);

function writeDigests(env, digests) {
  let text = readFileSync(overlayKustomization(env), 'utf8');
  for (const [image, digest] of Object.entries(digests)) {
    text = text.replace(digestPattern(image), `$1${digest}`);
  }
  writeFileSync(overlayKustomization(env), text);
}

// Moves dev's pinned digests to what `main` points at, after checking each signature (14 §2.7).
// Only dev: a new build enters there, and reaches staging and prod only by promotion.
function pinLatest(env) {
  say('Resolving the digests `main` points at in GHCR');
  const cosign = has('cosign');
  if (!cosign)
    say('cosign not installed: pinning WITHOUT verifying signatures (README, "Published images")');
  const digests = {};
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
    digests[image] = digest;
  }
  pinnedDigests(env); // fails early if the overlay lost an entry
  writeDigests(env, digests);
  say(
    `Pinned in ${overlayKustomization(env)}. Commit it: the deployed version is a decision recorded in git.`,
  );
}

// ---- promote ------------------------------------------------------------------------------

// The images an environment's Deployments run right now, by image name.
function liveDigests(namespace) {
  const out = kubectl(
    [
      '-n',
      namespace,
      'get',
      'deployment',
      'backend',
      'frontend',
      '-o',
      'jsonpath={range .items[*]}{.spec.template.spec.containers[0].image}{"\\n"}{end}',
    ],
    { capture: true, quiet: true },
  );
  return Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((ref) => ref.split('@')),
  );
}

// Copies the digests <from> runs to <to> (17 §2.5). Promotion moves exactly the bytes that were
// tested, and only one step at a time: what reaches prod has run in staging, and before that in
// dev. It refuses when <from> isn't running what its overlay pins (not deployed yet, or a
// --local build): you'd be promoting something nobody has looked at.
function promote(from, to) {
  if (!ENVIRONMENTS.includes(from) || !ENVIRONMENTS.includes(to))
    fail(`usage: npm run k8s:promote -- <from> <to>, environments ${ENVIRONMENTS.join(' → ')}`);
  if (ENVIRONMENTS.indexOf(to) !== ENVIRONMENTS.indexOf(from) + 1)
    fail(`promote one step at a time: ${ENVIRONMENTS.join(' → ')}`);
  requireTools();
  const pinned = pinnedDigests(from);
  const { namespace } = describe(from);
  say(`Checking that ${from} (${namespace}) runs what its overlay pins`);
  let live;
  try {
    live = liveDigests(namespace);
  } catch {
    fail(`${from} isn't running (npm run k8s:up -- --env ${from}); nothing to promote`);
  }
  for (const image of IMAGES) {
    if (live[image] !== pinned[image])
      fail(
        `${from} runs ${image}${live[image] ? `@${live[image]}` : ' from a local build'}, its overlay pins ${pinned[image]}. Deploy ${from} first: npm run k8s:up -- --env ${from}`,
      );
  }
  const current = pinnedDigests(to);
  const changes = IMAGES.filter((image) => current[image] !== pinned[image]);
  if (changes.length === 0) {
    say(`${to} already pins what ${from} runs. Nothing to promote.`);
    return;
  }
  writeDigests(to, pinned);
  for (const image of changes)
    process.stdout.write(`  ${image}\n    ${current[image]}\n  → ${pinned[image]}\n`);
  say(`Promoted ${from} → ${to} in ${overlayKustomization(to)}. Next:
  git diff ${overlayKustomization(to)}        # review, then commit it
  npm run k8s:up -- --env ${to}`);
}

// ---- up -----------------------------------------------------------------------------------

function clusterExists() {
  return run('kind', ['get', 'clusters'], { capture: true, quiet: true })
    .split('\n')
    .includes(CLUSTER);
}

// Release manifests come from GitHub, which sometimes resets a connection or times out a TLS
// handshake. `kubectl apply -f <url>` doesn't retry; curl does, on any error.
const download = (url) =>
  run('curl', ['-fsSL', '--retry', '8', '--retry-max-time', '120', '--retry-all-errors', url], {
    capture: true,
  });

function installAddons() {
  say('Installing cluster add-ons: Envoy Gateway (Gateway API), cert-manager, metrics-server');
  for (const url of [ADDONS.envoyGateway, ADDONS.certManager]) {
    kubectl(['apply', '--server-side', '-f', '-'], { input: download(url), capture: true });
  }
  // kind's kubelet certificates aren't signed for metrics-server, so it needs
  // --kubelet-insecure-tls (never on a real cluster). Added to the manifest before applying,
  // not patched afterwards: a later `kubectl patch` would own that field, and the next
  // server-side apply would refuse to touch it (a field-manager conflict, 15 §3.5).
  const metricsServer = download(ADDONS.metricsServer).replace(
    '- --secure-port=10250',
    '- --secure-port=10250\n        - --kubelet-insecure-tls',
  );
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

// Before environments existed (steps 2 and 3), the Gateway, its EnvoyProxy, the redirect route
// and the site certificate lived in the app's namespace, `straight-salon`. They move to the
// platform's namespace (17 §3.3), and `kubectl apply` never deletes what a manifest no longer
// mentions (17 §2.7), so they're removed here, once. They must go before the new Gateway
// starts: both would want the same NodePorts.
function removePreEnvironmentEdge() {
  const old = kubectl(
    ['-n', 'straight-salon', 'get', 'gateway', 'salon', '--ignore-not-found', '-o', 'name'],
    { capture: true, quiet: true },
  );
  if (!old.trim()) return;
  say('Removing the pre-environment Gateway from namespace straight-salon (moves to the platform)');
  for (const [kind, name] of [
    ['gateway', 'salon'],
    ['envoyproxy', 'salon-proxy'],
    ['httproute', 'salon-redirect'],
    ['certificate', 'salon-tls'],
    ['secret', 'salon-tls'],
  ]) {
    kubectl(['-n', 'straight-salon', 'delete', kind, name, '--ignore-not-found']);
  }
}

// What every environment shares (17 §3.3): one Gateway with a listener per environment, and
// the certificates. Applied on every `k8s:up`, whichever environment it's for.
function installPlatform() {
  removePreEnvironmentEdge();
  say('Applying the platform: shared Gateway and certificates');
  kubectl([
    'apply',
    '--server-side',
    '--force-conflicts',
    '--field-manager=k8s-up',
    '-k',
    PLATFORM_DIR,
  ]);
  kubectl([
    '-n',
    GATEWAY_NS,
    'wait',
    '--for=condition=Programmed',
    'gateway/salon',
    '--timeout=180s',
  ]);
}

// Secrets (15 §3.4, 16 §2.5). Generated here, never written to disk or git, and REUSED on every
// re-run: a changed password would lock the app out of its own database, a changed outbox key
// would make queued payloads unreadable. Several secrets share values (the app's Mongo password
// is in mongo-auth and inside backend-secrets' MONGO_URI; the S3 keys are in three places), so
// they're all built from one set of values. Each environment has its own (17 §2.3): nothing
// in dev can open prod's database.
function mongoHosts(e) {
  return Array.from(
    { length: e.mongoMembers },
    (_, i) => `mongo-${i}.mongo.${e.namespace}.svc.cluster.local:27017`,
  ).join(',');
}

function readSecret(NS, name) {
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

function applySecret(NS, name, values) {
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

function ensureSecrets(e) {
  const NS = e.namespace;
  const MONGO_HOSTS = mongoHosts(e);
  const mongo = readSecret(NS, 'mongo-auth');
  const backend = readSecret(NS, 'backend-secrets');
  const rclone = readSecret(NS, 'rclone-s3');
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

  applySecret(NS, 'mongo-auth', {
    'root-password': v.rootPassword,
    'app-password': v.appPassword,
    'backup-password': v.backupPassword,
    keyfile: v.keyfile,
    // Backups and the drill log in as ss_backup (admin database).
    'backup-uri': `mongodb://ss_backup:${v.backupPassword}@${MONGO_HOSTS}/?replicaSet=rs0&authSource=admin`,
  });
  applySecret(NS, 'backend-secrets', {
    JWT_ACCESS_SECRET: v.jwt,
    OUTBOX_ENCRYPTION_KEY: v.outbox,
    // w=majority: an acknowledged write is on two of three members (16 §2.3).
    MONGO_URI: `mongodb://ss_app:${v.appPassword}@${MONGO_HOSTS}/straight_salon?replicaSet=rs0&authSource=straight_salon&w=majority`,
    S3_ACCESS_KEY_ID: v.s3Key,
    S3_SECRET_ACCESS_KEY: v.s3Secret,
  });
  // SeaweedFS's access rules: one key with full rights, anonymous read on `uploads` only.
  applySecret(NS, 'seaweedfs-s3', {
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
  applySecret(NS, 'rclone-s3', {
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
function renderWithLocalImages(e, tags) {
  let yaml = e.text;
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

// After a rollout: does the site answer through the Gateway? `kubectl rollout status` only
// knows the pods are ready; this follows the browser's path (Gateway, route, certificate,
// frontend, backend). -k: the local CA isn't in curl's trust store. curl resolves *.localhost
// to 127.0.0.1 by itself.
async function smokeTest(e) {
  say(`Smoke test: ${e.url}/api/v1/settings/public through the Gateway`);
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const code = run(
        'curl',
        [
          '-sk',
          '-o',
          '/dev/null',
          '-w',
          '%{http_code}',
          '--max-time',
          '10',
          `${e.url}/api/v1/settings/public`,
        ],
        { capture: true, quiet: attempt > 1 },
      );
      if (code === '200') return;
    } catch {
      // not answering yet
    }
    await sleep(2000);
  }
  fail(`${e.url} doesn't answer. Look at: kubectl -n ${e.namespace} describe httproute salon`);
}

async function up() {
  requireTools();
  checkInotifyLimits();
  const env = envArg();
  const local = process.argv.includes('--local');
  const latest = process.argv.includes('--latest');
  if (local && latest) fail('use --latest or --local, not both');
  // New builds enter at dev; staging and prod only get what was promoted to them (17 §2.5).
  if ((local || latest) && env !== 'dev')
    fail(
      `--${local ? 'local' : 'latest'} is for dev only. ${env} gets builds by promotion: npm run k8s:promote -- ${ENVIRONMENTS[ENVIRONMENTS.indexOf(env) - 1]} ${env}`,
    );
  if (latest) pinLatest(env);
  const e = describe(env);
  const NS = e.namespace;

  if (clusterExists()) {
    say(`Cluster ${CLUSTER} exists`);
  } else {
    say(`Creating kind cluster ${CLUSTER} (1 control plane + 3 workers)`);
    run('kind', ['create', 'cluster', '--config', 'infra/k8s/kind-config.yaml']);
  }
  installAddons();
  installPlatform();
  const localTags = local ? buildLocalImages() : null;

  say(`${env}: namespace ${NS}, secrets and the mongo-init script`);
  kubectl(['apply', '--server-side', '--field-manager=k8s-up', '-f', '-'], {
    input: JSON.stringify(e.objects.find((o) => o.kind === 'Namespace')),
  });
  ensureSecrets(e);
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

  // A Job's pod template can't change after creation, so every Job is replaced on each deploy:
  // the migration runs once per deploy, and mongo-init and buckets are idempotent.
  const jobs = e.objects.filter((o) => o.kind === 'Job').map((o) => `job/${o.metadata.name}`);
  kubectl(['-n', NS, 'delete', ...jobs, '--ignore-not-found']);
  // Before step 4 the backend config had a fixed name; now it's generated with a hash (17 §2.6).
  // Apply doesn't delete the old one (17 §2.7), so it's removed here.
  kubectl(['-n', NS, 'delete', 'configmap', 'backend-config', '--ignore-not-found']);

  say(`Applying ${overlayDir(env)} (server-side apply${local ? ', local images' : ''})`);
  const applyArgs = ['apply', '--server-side', '--force-conflicts', '--field-manager=k8s-up'];
  if (localTags) kubectl([...applyArgs, '-f', '-'], { input: renderWithLocalImages(e, localTags) });
  else kubectl([...applyArgs, '-k', overlayDir(env)]);

  say('Waiting for the rollout');
  const named = (kind) => e.objects.filter((o) => o.kind === kind).map((o) => o.metadata.name);
  for (const job of named('Job')) {
    kubectl(['-n', NS, 'wait', '--for=condition=Complete', `job/${job}`, '--timeout=600s']);
  }
  for (const workload of [
    ...named('StatefulSet').map((n) => `statefulset/${n}`),
    ...named('Deployment').map((n) => `deployment/${n}`),
  ]) {
    kubectl(['-n', NS, 'rollout', 'status', workload, '--timeout=300s']);
  }
  kubectl(['-n', NS, 'get', 'pods', '-o', 'wide']);
  await smokeTest(e);

  const flag = env === 'dev' ? '' : ` -- --env ${env}`;
  say(`Ready: ${e.url}  (${env}, namespace ${NS})
  Demo data:     npm run k8s:seed${flag}
  Emails:        kubectl -n ${NS} port-forward svc/mailpit 8025   → http://localhost:8025
  Look around:   kubectl -n ${NS} get pods,svc,httproute
${e.backups ? `  Backups:       npm run k8s:backup${flag} && npm run k8s:restore-drill${flag}\n` : ''}\
  Next step:     ${env === 'prod' ? 'nothing to promote to: prod is the end of the line' : `npm run k8s:promote -- ${env} ${ENVIRONMENTS[ENVIRONMENTS.indexOf(env) + 1]}`}
  Exercises:     docs/specs/15 §6, 16 §6, 17 §6`);
}

// ---- seed, backups, restore -----------------------------------------------------------------

// The environment the command acts on (--env), set by main below.
let NS;
let URL;

function secretValue(name, key) {
  const value = readSecret(NS, name)[key];
  if (!value) fail(`secret ${name} has no ${key} in ${NS}. Run npm run k8s:up first.`);
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

// ---- render, diff, down ------------------------------------------------------------------

// What Kubernetes would be asked to apply, exactly (17 §3.4). Pipe it, diff two environments:
//   diff <(npm run -s k8s:render -- --env staging) <(npm run -s k8s:render -- --env prod)
function renderCommand() {
  process.stdout.write(render(overlayDir(envArg())));
}

// What applying the environment would change in the running cluster, as a diff, without
// changing anything (the API server computes the result, 17 §3.4). Secrets made by k8s:up aren't
// in the overlay, so they never show. Jobs are left out: their pod template is immutable, so
// the server can only answer "invalid", and k8s:up replaces them on every deploy anyway.
function diffCommand() {
  requireTools();
  const e = describe(envArg());
  say(`Changes applying ${overlayDir(e.env)} would make, Jobs aside (no output: no changes)`);
  const manifests = e.objects
    .filter((o) => o.kind !== 'Job')
    .map((o) => JSON.stringify(o))
    .join('\n');
  try {
    kubectl(['diff', '--server-side', '--force-conflicts', '--field-manager=k8s-up', '-f', '-'], {
      input: manifests,
    });
  } catch (error) {
    if (error.status !== 1) throw error; // 1 means "there are differences"
  }
}

function down() {
  requireTools();
  if (!process.argv.some((a) => a.startsWith('--env'))) {
    run('kind', ['delete', 'cluster', '--name', CLUSTER]);
    return;
  }
  const e = describe(envArg());
  say(`Deleting ${e.env} (namespace ${e.namespace}): its pods, volumes, data and secrets`);
  kubectl(['delete', 'namespace', e.namespace, '--ignore-not-found']);
}

// ---- main ---------------------------------------------------------------------------------

function target({ needsBackups = false } = {}) {
  const e = describe(envArg());
  NS = e.namespace;
  URL = e.url;
  if (needsBackups && !e.backups)
    fail(`${e.env} has no backups (17 §3.2). Use --env staging or --env prod.`);
  return e;
}

const command = process.argv[2];
const [first, second] = positional();
if (command === 'up') await up();
else if (command === 'promote') promote(first, second);
else if (command === 'render') renderCommand();
else if (command === 'diff') diffCommand();
else if (command === 'seed') {
  target();
  await seed();
  say(`Seeded. Sign in at ${URL} with customer1@straightsalon.local / Password@123`);
} else if (command === 'backup') {
  target({ needsBackups: true });
  runCronJob('mongo-backup');
} else if (command === 'restore-drill') {
  target({ needsBackups: true });
  runCronJob('mongo-restore-drill');
} else if (command === 'restore') {
  target({ needsBackups: true });
  restore(first, second);
} else if (command === 'down') down();
else
  fail(
    'usage: node scripts/k8s.mjs up [--latest|--local] | promote <from> <to> | render | diff | seed | backup | restore-drill | restore [archive collection] | down, each with [--env dev|staging|prod]',
  );
