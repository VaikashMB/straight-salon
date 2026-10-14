// `npm run k8s:*` (15-kubernetes-basics §3.5, 17 §3.4, 18 §3.6): the local Kubernetes cluster
// and its environments. Needs Docker, kind and kubectl (README, "Run on Kubernetes").
//
// Since step 5, Argo CD deploys everything from git (18): this script only does what can't come
// from git. It creates the cluster, installs Argo CD (the bootstrap), generates each
// environment's secrets, points Argo CD at the repository and waits for what it deploys.
// Changing what runs is a commit, not a command.
//
// Environment facts (namespace, hostname, Mongo member count) come from the overlays
// (infra/k8s/overlays/<env>), never from this file. Commands that act on one environment take
// `-- --env dev|staging|prod` (default dev, the least dangerous one).
//
//   k8s:up             create the kind cluster if missing, install Argo CD, generate every
//                      environment's secrets, apply the root Application (gitops/root.yaml),
//                      then wait until Argo CD has deployed everything and smoke-test each site
//                      (with --env: wait for and test that environment only)
//   k8s:up -- --revision <branch>  the same, with Argo CD following <branch> instead of main:
//                      to try a change to the GitOps setup itself before merging it
//   k8s:up -- --local  (dev only) also build the images from this checkout and run them in dev,
//                      by hand, for code that isn't published yet. Dev doesn't self-heal, so it
//                      stays until the next commit on main
//   k8s:pin -- <image@digest>...  (dev only) write digests into overlays/dev; CI runs it for every
//                      build on main (18 §3.7)
//   k8s:promote -- <from> <to>  copy the digests one environment runs to the next one
//                      (dev → staging → prod), after checking <from> really runs them; you commit it
//   k8s:render         print the environment's manifests, as Argo CD renders them
//   k8s:diff           what applying this checkout's overlay would change in the running cluster
//   k8s:seed           demo data, from this machine through port-forwards (the production
//                      image refuses to seed)
//   k8s:backup         run the nightly MongoDB backup now (16 §3.5; staging and prod)
//   k8s:restore-drill  restore the newest backup into a scratch database and check it
//   k8s:restore -- <archive> <collection>  put one collection back from a backup (no args: list)
//   k8s:down           delete the cluster (removing one environment is a git change, 18 §3.6)
//
// Every step prints the kubectl command it runs, so the script doubles as a walkthrough.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ARGOCD_DIR,
  ENVIRONMENTS,
  OUR_IMAGES as IMAGES,
  ROOT_APP,
  describe,
  overlayDir,
  overlayKustomization,
  parse,
  render,
} from './k8s-manifests.mjs';

// K8S_CLUSTER=<name> works on a second, throwaway cluster instead (18 §6, exercise 8: rebuild
// everything from git). It gets no host ports (only one cluster can own 80/443), so the smoke
// tests reach its Gateway through a port-forward.
const MAIN_CLUSTER = 'straight-salon';
const CLUSTER = process.env.K8S_CLUSTER || MAIN_CLUSTER;
const CONTEXT = `kind-${CLUSTER}`;

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

// Argo CD, pinned by version and by the checksum of its install manifest (18 §3.2). Everything
// else in the cluster, the add-ons included, Argo CD installs from git (gitops/apps).
const ARGOCD = {
  version: 'v3.5.5',
  manifest: 'https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.5/manifests/install.yaml',
  sha256: '90dc9094bf4c5964afd9c0e35d735e1c2fcbbda4f8e36799c092d9864ed65f50',
};
const ARGOCD_NS = 'argocd';

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

// `k8s:pin -- --env dev <image@digest>...` (18 §3.7): CI calls this for every build that passed on
// main, then commits the change, and Argo CD deploys it to dev. Only dev: new builds enter there
// and reach staging and prod by promotion (17 §2.5). CI has already checked the signatures
// before moving `main` (14 §3.2).
function pin(env, refs) {
  if (env !== 'dev') fail('new builds enter at dev only; staging and prod get them by promotion');
  const digests = {};
  for (const ref of refs) {
    const [image, digest] = ref.split('@');
    if (!IMAGES.includes(image) || !/^sha256:[0-9a-f]{64}$/.test(digest ?? ''))
      fail(`not one of our images by digest: ${ref}`);
    digests[image] = digest;
  }
  if (Object.keys(digests).length === 0) fail('usage: npm run k8s:pin -- <image@digest>...');
  const before = pinnedDigests(env);
  writeDigests(env, digests);
  for (const [image, digest] of Object.entries(digests))
    process.stdout.write(
      `  ${image}\n    ${before[image]}\n  ${before[image] === digest ? '= (unchanged)' : `→ ${digest}`}\n`,
    );
}

// ---- promote ------------------------------------------------------------------------------

// What an environment's Rollouts run right now, and whether each release has finished:
// `Healthy` means no canary or blue-green release in progress (or aborted).
function liveRollouts(namespace) {
  const json = kubectl(['-n', namespace, 'get', 'rollout', 'backend', 'frontend', '-o', 'json'], {
    capture: true,
    quiet: true,
  });
  return Object.fromEntries(
    JSON.parse(json).items.map((r) => {
      const [image, digest] = r.spec.template.spec.containers[0].image.split('@');
      return [image, { digest, phase: r.status?.phase ?? 'Unknown' }];
    }),
  );
}

// Argo CD's view of an environment: its Application's sync and health status.
function appStatus(name) {
  const json = kubectl(
    ['-n', ARGOCD_NS, 'get', 'application', name, '--ignore-not-found', '-o', 'json'],
    { capture: true, quiet: true },
  );
  if (!json.trim()) return null;
  const app = JSON.parse(json);
  return {
    sync: app.status?.sync?.status ?? 'Unknown',
    health: app.status?.health?.status ?? 'Unknown',
    revision: app.status?.sync?.revision ?? '',
    targetRevision: app.spec.source?.targetRevision,
    message: app.status?.operationState?.message ?? '',
    phase: app.status?.operationState?.phase ?? '',
  };
}

// Copies the digests <from> runs to <to> (17 §2.5). Promotion moves exactly the bytes that were
// tested, and only one step at a time: what reaches prod has run in staging, and before that in
// dev. It refuses unless <from> runs what its overlay pins, with every release finished
// (a paused or aborted canary isn't "tested"), and Argo CD reports it Synced and Healthy.
// It edits git; Argo CD deploys <to> once the change is merged to main (18 §2.2).
function promote(from, to) {
  if (!ENVIRONMENTS.includes(from) || !ENVIRONMENTS.includes(to))
    fail(`usage: npm run k8s:promote -- <from> <to>, environments ${ENVIRONMENTS.join(' → ')}`);
  if (ENVIRONMENTS.indexOf(to) !== ENVIRONMENTS.indexOf(from) + 1)
    fail(`promote one step at a time: ${ENVIRONMENTS.join(' → ')}`);
  requireTools();
  const pinned = pinnedDigests(from);
  const { namespace } = describe(from);
  say(`Checking that ${from} (${namespace}) runs what its overlay pins`);
  const app = appStatus(from);
  if (!app) fail(`Argo CD has no Application ${from}. Run npm run k8s:up first.`);
  if (app.sync !== 'Synced' || app.health !== 'Healthy')
    fail(
      `Argo CD reports ${from} ${app.sync} and ${app.health}${app.message ? ` (${app.message})` : ''}. Promote once it's Synced and Healthy.`,
    );
  let live;
  try {
    live = liveRollouts(namespace);
  } catch {
    fail(`${from} isn't running (npm run k8s:up); nothing to promote`);
  }
  for (const image of IMAGES) {
    const running = live[image];
    if (running?.digest !== pinned[image])
      fail(
        `${from} runs ${image}${running?.digest ? `@${running.digest}` : ' from a local build'}, its overlay pins ${pinned[image]}. Is the overlay pushed to main, and has Argo CD deployed it?`,
      );
    if (running.phase !== 'Healthy')
      fail(`${from}'s release of ${image} is ${running.phase}, not finished. Wait, or look at it:
  kubectl -n ${namespace} get rollout -o wide`);
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
  git diff ${overlayKustomization(to)}        # review
  git commit, push (or open a pull request) and merge to main
  Argo CD deploys it to ${to} within a minute or two:
  kubectl -n ${ARGOCD_NS} get application ${to} -w`);
}

// ---- up -----------------------------------------------------------------------------------

function clusterExists() {
  return run('kind', ['get', 'clusters'], { capture: true, quiet: true })
    .split('\n')
    .includes(CLUSTER);
}

// Release manifests come from GitHub, which sometimes resets connections or times out TLS
// handshakes, now and then for minutes (18 §2.10). `kubectl apply -f <url>` doesn't retry; curl
// does, on any error, for up to 5 minutes.
const download = (url) =>
  run('curl', ['-fsSL', '--retry', '12', '--retry-max-time', '300', '--retry-all-errors', url], {
    capture: true,
  });

// Installs Argo CD from its pinned release manifest, checksum verified: the one piece of the
// cluster that can't come from Argo CD (18 §2.9). Re-running it is how Argo CD is upgraded (a
// new version and checksum above). Server-side, because its CRDs are too big for client-side
// apply.
function installArgoCD() {
  say(`Installing Argo CD ${ARGOCD.version} (the bootstrap: everything else comes from git)`);
  const manifest = download(ARGOCD.manifest);
  const sum = createHash('sha256').update(manifest).digest('hex');
  if (sum !== ARGOCD.sha256)
    fail(
      `Argo CD's install manifest has checksum ${sum}, expected ${ARGOCD.sha256}. Not applying it.`,
    );
  process.stdout.write(`  checksum ok: ${sum}\n`);
  kubectl(['apply', '--server-side', '--field-manager=k8s-up', '-f', '-'], {
    input: JSON.stringify({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ARGOCD_NS } }),
    capture: true,
  });
  kubectl(
    [
      '-n',
      ARGOCD_NS,
      'apply',
      '--server-side',
      '--force-conflicts',
      '--field-manager=k8s-up',
      '-f',
      '-',
    ],
    { input: manifest, capture: true },
  );
  // The repo server fetches from GitHub and the chart repositories. Pods inherit the host's DNS
  // search domains with ndots:5, so `github.com` is first tried as `github.com.<search domain>`;
  // a network whose DNS answers every name under its domain (a wildcard, common on office and
  // VPN networks) then sends the request to the wrong server (18 §2.10). With ndots:1 a name
  // with a dot is looked up as written first. Its own field manager: applying this as `k8s-up`
  // would drop every other field `k8s-up` set from the manifest above.
  kubectl(['apply', '--server-side', '--field-manager=k8s-up-dns', '-f', '-'], {
    input: JSON.stringify({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'argocd-repo-server', namespace: ARGOCD_NS },
      spec: { template: { spec: { dnsConfig: { options: [{ name: 'ndots', value: '1' }] } } } },
    }),
    capture: true,
  });

  // Argo CD's settings (argocd/) are in git and Argo CD manages them (Application
  // argocd-config), but the first sync needs some of them already: the projects, the OCI
  // repository, the Kustomize flag. So they're applied here once, before that Application
  // exists. The UI's route waits for Argo CD: the Gateway API's kinds don't exist yet on a new
  // cluster.
  if (!appStatus('argocd-config')) {
    say('First install: applying Argo CD settings from infra/k8s/argocd once');
    const before = kubectl(
      ['-n', ARGOCD_NS, 'get', 'configmap', 'argocd-cmd-params-cm', '-o', 'json'],
      { capture: true, quiet: true },
    );
    const settings = parse(render(ARGOCD_DIR)).filter((o) => o.kind !== 'HTTPRoute');
    kubectl(['apply', '--server-side', '--force-conflicts', '--field-manager=k8s-up', '-f', '-'], {
      input: settings.map((o) => JSON.stringify(o)).join('\n'),
    });
    // Command-line settings are read at start: restart what they changed.
    if (
      JSON.stringify(JSON.parse(before).data ?? {}) !==
      JSON.stringify(settings.find((o) => o.metadata.name === 'argocd-cmd-params-cm').data)
    )
      for (const component of [
        'deployment/argocd-server',
        'statefulset/argocd-application-controller',
      ])
        kubectl(['-n', ARGOCD_NS, 'rollout', 'restart', component]);
  }
  for (const component of [
    'deployment/argocd-server',
    'deployment/argocd-repo-server',
    'statefulset/argocd-application-controller',
  ])
    kubectl(['-n', ARGOCD_NS, 'rollout', 'status', component, '--timeout=300s']);
}

// Until step 5, k8s:up applied the add-ons from release manifests and the environments with
// kubectl. Argo CD takes those objects over in place (same names, 18 §2.10), except where a field
// can't change: metrics-server's chart selects its pods by other labels than its manifest did,
// and a Deployment's selector is immutable. That Deployment is removed once here so Argo CD can
// create the chart's (a minute without CPU metrics). Also the fixed-name mongo-init ConfigMap
// k8s:up used to make (now generated from git) and the Jobs it made, which Argo CD's hooks
// replace.
function removeKubectlLeftovers(namespaces) {
  const selector = kubectl(
    [
      '-n',
      'kube-system',
      'get',
      'deployment',
      'metrics-server',
      '--ignore-not-found',
      '-o',
      'jsonpath={.spec.selector.matchLabels.k8s-app}',
    ],
    { capture: true, quiet: true },
  );
  if (selector.trim()) {
    say('Removing the manifest-installed metrics-server (its chart selects pods differently)');
    kubectl(['-n', 'kube-system', 'delete', 'deployment', 'metrics-server']);
    kubectl(['delete', 'clusterrole', 'system:aggregated-metrics-reader', '--ignore-not-found']);
  }
  for (const ns of namespaces) {
    kubectl(['-n', ns, 'delete', 'configmap', 'mongo-init', '--ignore-not-found'], { quiet: true });
    const jobs = kubectl(['-n', ns, 'get', 'job', '-o', 'json'], { capture: true, quiet: true });
    const unhooked = JSON.parse(jobs)
      .items.filter(
        (j) =>
          ['migrate', 'mongo-init', 'buckets'].includes(j.metadata.name) &&
          !j.metadata.annotations?.['argocd.argoproj.io/hook'],
      )
      .map((j) => `job/${j.metadata.name}`);
    if (unhooked.length) kubectl(['-n', ns, 'delete', ...unhooked]);
  }
}

// After Argo CD has started an environment's Rollouts, the Deployments they replace (applied by
// k8s:up before step 5) are still running: Argo CD never created them, so it doesn't prune them
// (18 §2.8). Removed once the Rollouts are healthy, so the site never has zero pods.
function removeReplacedDeployments(e) {
  const old = kubectl(
    [
      '-n',
      e.namespace,
      'get',
      'deployment',
      'backend',
      'frontend',
      '--ignore-not-found',
      '-o',
      'name',
    ],
    { capture: true, quiet: true },
  )
    .split('\n')
    .filter(Boolean);
  if (old.length === 0) return;
  say(`${e.env}: the Rollouts are healthy; removing the Deployments they replace`);
  kubectl(['-n', e.namespace, 'delete', ...old]);
}

// Before environments existed (steps 2 and 3), the Gateway, its EnvoyProxy, the redirect route
// and the site certificate lived in the app's namespace, `straight-salon`. They move to the
// platform's namespace (17 §3.3), and `kubectl apply` never deletes what a manifest no longer
// mentions (17 §2.7), so they're removed here, once. They must go before the new Gateway
// starts: both would want the same NodePorts. On a new cluster the Gateway kind doesn't exist
// yet (Argo CD installs it later), so there's nothing to remove.
function removePreEnvironmentEdge() {
  let old = '';
  try {
    old = kubectl(
      ['-n', 'straight-salon', 'get', 'gateway', 'salon', '--ignore-not-found', '-o', 'name'],
      { capture: true, quiet: true },
    );
  } catch {
    return; // no Gateway API yet
  }
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
  // A second cluster has no host ports: forward a local port to its Envoy Service, and send the
  // request there under the environment's hostname (curl --connect-to).
  let forward = null;
  const via = [];
  if (CLUSTER !== MAIN_CLUSTER) {
    const svc = kubectl(
      [
        '-n',
        'envoy-gateway-system',
        'get',
        'service',
        '-l',
        'gateway.envoyproxy.io/owning-gateway-name=salon',
        '-o',
        'name',
      ],
      { capture: true, quiet: true },
    ).trim();
    forward = spawn(
      'kubectl',
      ['--context', CONTEXT, '-n', 'envoy-gateway-system', 'port-forward', svc, '18443:443'],
      {
        stdio: 'ignore',
      },
    );
    via.push('--connect-to', `${e.host}:443:127.0.0.1:18443`);
    await sleep(2000);
  }
  try {
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        const code = run(
          'curl',
          [
            '-sk',
            ...via,
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
  } finally {
    forward?.kill();
  }
}

// Applies the root Application (gitops/root.yaml), following `revision`. For a branch, every
// Application that reads our repository follows it too (a Kustomize patch the root app applies
// to them), so the whole setup can be tried before it reaches main (18 §3.6).
function applyRoot(revision) {
  const [root] = parse(readFileSync(ROOT_APP, 'utf8'));
  if (revision !== 'main') {
    say(
      `Argo CD will follow branch ${revision}, not main. Run k8s:up again without --revision to go back.`,
    );
    root.spec.source.targetRevision = revision;
    root.spec.source.kustomize = {
      patches: [
        {
          target: { kind: 'Application', labelSelector: 'straight-salon/source=git' },
          patch: JSON.stringify([
            { op: 'replace', path: '/spec/source/targetRevision', value: revision },
          ]),
        },
      ],
    };
  }
  say(`Pointing Argo CD at the repository (${ROOT_APP}, ${revision})`);
  kubectl(['apply', '--server-side', '--force-conflicts', '--field-manager=k8s-up', '-f', '-'], {
    input: JSON.stringify(root),
  });
}

// Argo CD deploys what's on GitHub, not this working copy (18 §2.2). Say so when they differ.
function warnIfNotPushed(revision) {
  try {
    const changed = run(
      'git',
      [
        'diff',
        '--name-only',
        `origin/${revision}`,
        '--',
        'infra/k8s',
        'infra/docker/mongo-init.js',
      ],
      { capture: true, quiet: true },
    ).trim();
    if (changed)
      say(`NOTE: Argo CD deploys origin/${revision}, and these files differ in this working copy
(not committed, or not pushed, or not fetched yet). They won't be deployed until they're on ${revision}:
${changed
  .split('\n')
  .map((f) => `  ${f}`)
  .join('\n')}`);
  } catch {
    // no such remote branch locally: nothing to compare with
  }
}

// Waits until Argo CD reports each Application Synced and Healthy, printing every change of
// state on the way: the sync waves, the hooks, a canary's analysis and pause.
async function waitForApps(names, { timeoutMinutes = 20 } = {}) {
  say(
    `Waiting for Argo CD: ${names.join(', ')} (Synced and Healthy). Watch it too: https://argocd.salon.localhost`,
  );
  const last = {};
  const deadline = Date.now() + timeoutMinutes * 60_000;
  while (Date.now() < deadline) {
    const pending = names.filter((name) => {
      const app = appStatus(name);
      const line = app
        ? `${app.sync} / ${app.health}${app.phase ? ` (sync ${app.phase}${app.phase !== 'Succeeded' && app.message ? `: ${app.message.slice(0, 160)}` : ''})` : ''}`
        : 'not created yet';
      if (last[name] !== line) process.stdout.write(`  ${name.padEnd(15)} ${line}\n`);
      last[name] = line;
      return !(app?.sync === 'Synced' && app?.health === 'Healthy');
    });
    if (pending.length === 0) return;
    await sleep(5000);
  }
  fail(`Argo CD hasn't finished after ${timeoutMinutes} minutes. Look at https://argocd.salon.localhost or:
  kubectl -n ${ARGOCD_NS} get applications`);
}

// The inner loop under GitOps (18 §3.6): run code that CI hasn't published in dev, by hand.
// Dev's Application doesn't self-heal, so Argo CD shows dev OutOfSync and leaves it; the next
// commit on main brings dev back to what git says. The Jobs (Argo CD hooks) run here too, so a
// new migration runs before the new code, as it would in a real sync.
async function deployLocal(e) {
  const tags = buildLocalImages();
  const objects = parse(renderWithLocalImages(e, tags));
  say('Applying dev with the local images (by hand: Argo CD will show dev OutOfSync)');
  kubectl(
    ['apply', '--server-side', '--force-conflicts', '--field-manager=k8s-up-local', '-f', '-'],
    {
      input: objects
        .filter((o) => o.kind !== 'Job')
        .map((o) => JSON.stringify(o))
        .join('\n'),
    },
  );
  // The Jobs, in hook order (mongo-init and buckets, then migrate), without Argo CD's hook
  // annotations: these runs are ours, not a sync's.
  const jobs = objects
    .filter((o) => o.kind === 'Job')
    .sort(
      (x, y) =>
        Number(x.metadata.annotations?.['argocd.argoproj.io/sync-wave'] ?? 0) -
        Number(y.metadata.annotations?.['argocd.argoproj.io/sync-wave'] ?? 0),
    );
  for (const job of jobs) {
    delete job.metadata.annotations;
    kubectl(['-n', e.namespace, 'delete', 'job', job.metadata.name, '--ignore-not-found']);
    kubectl(['create', '-f', '-'], { input: JSON.stringify(job) });
    kubectl([
      '-n',
      e.namespace,
      'wait',
      '--for=condition=Complete',
      `job/${job.metadata.name}`,
      '--timeout=600s',
    ]);
  }
  await waitForRollouts(e);
  kubectl(['-n', e.namespace, 'rollout', 'status', 'deployment/worker', '--timeout=300s']);
}

// Until each Rollout's release has finished (status.phase Healthy), printing its progress.
async function waitForRollouts(e) {
  const last = {};
  for (let i = 0; i < 180; i++) {
    const live = liveRollouts(e.namespace);
    const pending = Object.entries(live).filter(([image, r]) => {
      const line = `${image.split('/').pop()}: ${r.phase}`;
      if (last[image] !== line) process.stdout.write(`  ${line}\n`);
      last[image] = line;
      return r.phase !== 'Healthy';
    });
    if (pending.length === 0) return;
    await sleep(5000);
  }
  fail(
    `releases in ${e.namespace} haven't finished: kubectl -n ${e.namespace} get rollout -o wide`,
  );
}

function revisionArg() {
  const args = process.argv.slice(3);
  const i = args.findIndex((a) => a === '--revision' || a.startsWith('--revision='));
  if (i < 0) return 'main';
  const value = args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  if (!value || !/^[\w./-]+$/.test(value)) fail('--revision needs a branch name');
  return value;
}

async function up() {
  requireTools();
  checkInotifyLimits();
  const local = process.argv.includes('--local');
  const revision = revisionArg();
  // Without --env: every environment (k8s:up only deploys what git says, so there's no
  // dangerous default to avoid any more).
  const only = process.argv.some((a) => a.startsWith('--env')) ? envArg() : null;
  if (process.argv.includes('--latest'))
    fail('--latest is gone: CI pins every build on main into overlays/dev itself (18 §3.7)');
  if (local && only && only !== 'dev')
    fail(`--local is for dev only. ${only} gets builds by promotion (npm run k8s:promote).`);
  const environments = ENVIRONMENTS.map(describe);

  if (clusterExists()) {
    say(`Cluster ${CLUSTER} exists`);
  } else {
    say(`Creating kind cluster ${CLUSTER} (1 control plane + 3 workers)`);
    if (CLUSTER === MAIN_CLUSTER)
      run('kind', ['create', 'cluster', '--config', 'infra/k8s/kind-config.yaml']);
    else {
      // The same nodes without the host ports, which belong to the main cluster.
      const [config] = parse(readFileSync('infra/k8s/kind-config.yaml', 'utf8'));
      for (const node of config.nodes) delete node.extraPortMappings;
      run('kind', ['create', 'cluster', '--name', CLUSTER, '--config', '-'], {
        input: JSON.stringify({ ...config, name: CLUSTER }),
      });
    }
  }
  installArgoCD();
  removePreEnvironmentEdge();
  removeKubectlLeftovers(environments.map((e) => e.namespace));

  // What git can't hold (until step 7): each environment's secrets. Made for all three before
  // Argo CD starts, since it deploys all three.
  for (const e of environments) {
    say(`${e.env}: namespace ${e.namespace} and its secrets`);
    kubectl(['apply', '--server-side', '--field-manager=k8s-up', '-f', '-'], {
      input: JSON.stringify(e.objects.find((o) => o.kind === 'Namespace')),
      capture: true,
    });
    ensureSecrets(e);
  }

  applyRoot(revision);
  warnIfNotPushed(revision);
  const targets = only ? environments.filter((e) => e.env === only) : environments;
  await waitForApps([
    'cert-manager',
    'envoy-gateway',
    'metrics-server',
    'argo-rollouts',
    'platform',
    'argocd-config',
    ...targets.map((e) => e.env),
  ]);
  for (const e of targets) {
    removeReplacedDeployments(e);
    await smokeTest(e);
  }
  if (local) {
    const dev = environments.find((e) => e.env === 'dev');
    await deployLocal(dev);
    await smokeTest(dev);
  }

  say(`Ready. Argo CD keeps the cluster at what ${revision} says.
${targets.map((e) => `  ${e.env.padEnd(8)} ${e.url}`).join('\n')}
  Argo CD   https://argocd.salon.localhost  (user admin; password:
            kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d)
  Demo data:     npm run k8s:seed -- --env <name>
  Releases:      kubectl -n straight-salon-dev get rollout -o wide
  Promote:       npm run k8s:promote -- dev staging, then commit and push
  Exercises:     docs/specs/15 §6, 16 §6, 17 §6, 18 §6`);
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

// Deletes the whole cluster. One environment can't be removed with a command any more: Argo CD
// would put it back (staging and prod self-heal, and the root app recreates the Application).
// Removing an environment is a git change (18 §3.6).
function down() {
  requireTools();
  if (process.argv.some((a) => a.startsWith('--env'))) {
    const e = describe(envArg());
    fail(`Argo CD deploys ${e.env} from git, so it would recreate anything deleted here. To remove it:
  delete its Application from infra/k8s/gitops/apps/environments.yaml, push and merge, then
  kubectl delete namespace ${e.namespace}
(Or delete the whole cluster: npm run k8s:down)`);
  }
  run('kind', ['delete', 'cluster', '--name', CLUSTER]);
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
else if (command === 'pin') pin(envArg(), positional());
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
    'usage: node scripts/k8s.mjs up [--local] [--revision <branch>] | pin <image@digest>... | promote <from> <to> | render | diff | seed | backup | restore-drill | restore [archive collection] | down, each with [--env dev|staging|prod]',
  );
