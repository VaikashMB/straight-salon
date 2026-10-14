// `npm run k8s:check` (17 §3.5): renders the platform and every environment's overlay and checks
// the rules that keep them honest. No cluster needed; CI runs it on every push. Manifests are
// code, and a typo in an overlay should fail a build, not a deploy.
//
//   - every overlay renders, and every object lands in the environment's own namespace
//   - our images are pinned by digest, everyone else's by an explicit tag (never `latest`)
//   - the hostname agrees everywhere: route, backend config, Gateway listener (admitting only
//     this namespace) and certificate
//   - the Mongo replica set's member list matches the StatefulSet, and a disruption budget
//     never asks for more pods than exist
//   - an autoscaled Deployment doesn't also set `replicas`
//   - staging and prod are identical apart from namespace, hostname and image digests
//     (environment parity, 17 §2.4)
//   - every ConfigMap a workload refers to exists (a generated name not rewritten in a Rollout,
//     18 §2.10), every Job is an Argo CD hook, every Rollout's Services and analysis exist
//   - GitOps (18 §3.8): every Application is allowed by its project, follows main (or pins a
//     chart version), has no finalizer; one per environment at its overlay; staging and prod
//     sync alike; every HTTPS hostname is on the certificate
import { existsSync, readFileSync } from 'node:fs';
import {
  APPS_DIR,
  ARGOCD_DIR,
  ENVIRONMENTS,
  OUR_IMAGES,
  PLATFORM_DIR,
  ROOT_APP,
  containers,
  describe,
  find,
  overlayDir,
  overlaysOnDisk,
  parse,
  render,
} from './k8s-manifests.mjs';

const CLUSTER_SCOPED = new Set(['Namespace', 'GatewayClass', 'ClusterIssuer']);
const DIGEST = /^[^@]+@sha256:[0-9a-f]{64}$/;
const problems = [];
const problem = (where, message) => problems.push(`${where}: ${message}`);

function checkEnvironment(e, platform) {
  const where = e.env;
  const { objects, namespace, host } = e;

  // Namespaces
  const namespaces = objects.filter((o) => o.kind === 'Namespace');
  if (namespaces.length !== 1) problem(where, `expected one Namespace, found ${namespaces.length}`);
  for (const o of objects) {
    if (CLUSTER_SCOPED.has(o.kind)) {
      if (o.kind !== 'Namespace')
        problem(where, `cluster-wide ${o.kind}/${o.metadata.name} belongs in the platform`);
    } else if (o.metadata.namespace !== namespace) {
      problem(where, `${o.kind}/${o.metadata.name} is in namespace "${o.metadata.namespace}"`);
    }
  }

  // Images
  for (const c of containers(objects)) {
    const ours = OUR_IMAGES.some((image) => c.image.startsWith(`${image}@`) || c.image === image);
    if (ours && !DIGEST.test(c.image))
      problem(where, `${c.owner} runs ${c.image}: our images must be pinned by digest`);
    const tag = c.image.split('@')[0].split('/').pop().split(':')[1];
    if (!ours && (!tag || tag === 'latest'))
      problem(where, `${c.owner} runs ${c.image}: pin a version tag`);
  }

  // Hostname, everywhere it appears
  const route = find(objects, 'HTTPRoute', 'salon');
  if (route.spec.hostnames.length !== 1) problem(where, 'the route must have exactly one hostname');
  const config = find(objects, 'ConfigMap', /^backend-config-/);
  if (!config) problem(where, 'no generated backend-config ConfigMap');
  else {
    if (config.data.APP_BASE_URL !== `https://${host}`)
      problem(where, `APP_BASE_URL is ${config.data.APP_BASE_URL}, the route says ${host}`);
    if (config.data.UPLOADS_PUBLIC_URL !== `https://${host}/uploads`)
      problem(where, `UPLOADS_PUBLIC_URL is ${config.data.UPLOADS_PUBLIC_URL}`);
  }
  const gateway = find(platform, 'Gateway', 'salon');
  const listener = gateway.spec.listeners.find((l) => l.hostname === host);
  if (!listener) problem(where, `the platform Gateway has no listener for ${host}`);
  else {
    const allowed =
      listener.allowedRoutes?.namespaces?.selector?.matchLabels?.['kubernetes.io/metadata.name'];
    if (listener.protocol !== 'HTTPS') problem(where, `listener ${listener.name} isn't HTTPS`);
    if (allowed !== namespace)
      problem(
        where,
        `listener ${listener.name} admits routes from "${allowed}", not "${namespace}"`,
      );
  }
  const certificate = find(platform, 'Certificate', 'salon-tls');
  if (!certificate.spec.dnsNames.includes(host))
    problem(where, `the certificate salon-tls doesn't cover ${host}`);
  const parent = route.spec.parentRefs[0];
  if (parent.name !== gateway.metadata.name || parent.namespace !== gateway.metadata.namespace)
    problem(where, 'the route must attach to the platform Gateway');

  // MongoDB
  const mongo = find(objects, 'StatefulSet', 'mongo');
  const init = find(objects, 'Job', 'mongo-init').spec.template.spec.containers[0];
  const envNames = init.env.map((v) => v.name);
  const members = init.env.find((v) => v.name === 'MONGO_RS_MEMBERS').value.split(',');
  const expected = Array.from(
    { length: mongo.spec.replicas },
    (_, i) => `mongo-${i}.mongo.$(NAMESPACE).svc.cluster.local:27017`,
  );
  if (members.join() !== expected.join())
    problem(
      where,
      `MONGO_RS_MEMBERS lists ${members.length} member(s), the StatefulSet has ${mongo.spec.replicas}`,
    );
  // Kubernetes expands $(NAMESPACE) only from a variable defined earlier in the list.
  if (
    envNames.indexOf('NAMESPACE') < 0 ||
    envNames.indexOf('NAMESPACE') > envNames.indexOf('MONGO_RS_MEMBERS')
  )
    problem(where, 'mongo-init must define NAMESPACE before MONGO_RS_MEMBERS');
  for (const pdb of objects.filter((o) => o.kind === 'PodDisruptionBudget')) {
    const target = objects.find(
      (o) =>
        ['StatefulSet', 'Deployment'].includes(o.kind) &&
        o.metadata.name === pdb.spec.selector.matchLabels['app.kubernetes.io/name'],
    );
    const replicas = target?.spec.replicas ?? 1;
    if (pdb.spec.minAvailable >= replicas)
      problem(
        where,
        `PodDisruptionBudget/${pdb.metadata.name} wants ${pdb.spec.minAvailable} of ${replicas} pods: no node could ever be drained`,
      );
  }

  // References: a generated ConfigMap's name has a hash, and Kustomize rewrites references to
  // it only where it knows to look (18 §2.10). A reference it missed names nothing.
  const configMaps = new Set(
    objects.filter((o) => o.kind === 'ConfigMap').map((o) => o.metadata.name),
  );
  for (const o of objects) {
    const pod =
      o.kind === 'CronJob' ? o.spec.jobTemplate.spec.template.spec : o.spec?.template?.spec;
    if (!pod) continue;
    const refs = [
      ...(pod.volumes ?? []).map((v) => v.configMap?.name),
      ...[...(pod.initContainers ?? []), ...(pod.containers ?? [])].flatMap((c) => [
        ...(c.envFrom ?? []).map((f) => f.configMapRef?.name),
        ...(c.env ?? []).map((v) => v.valueFrom?.configMapKeyRef?.name),
      ]),
    ].filter(Boolean);
    for (const ref of refs)
      if (!configMaps.has(ref))
        problem(
          where,
          `${o.kind}/${o.metadata.name} refers to ConfigMap ${ref}, which isn't rendered`,
        );
  }

  // Jobs: a Job's pod template can't change, so Argo CD must replace each one (a hook with
  // BeforeHookCreation), never update it in place (18 §2.6).
  for (const job of objects.filter((o) => o.kind === 'Job')) {
    const a = job.metadata.annotations ?? {};
    if (
      !a['argocd.argoproj.io/hook'] ||
      a['argocd.argoproj.io/hook-delete-policy'] !== 'BeforeHookCreation'
    )
      problem(
        where,
        `Job/${job.metadata.name} must be an Argo CD hook with hook-delete-policy BeforeHookCreation`,
      );
  }

  // Rollouts: the Services they switch and the analyses they run must exist.
  const services = new Set(objects.filter((o) => o.kind === 'Service').map((o) => o.metadata.name));
  const templates = new Set(
    objects.filter((o) => o.kind === 'AnalysisTemplate').map((o) => o.metadata.name),
  );
  for (const rollout of objects.filter((o) => o.kind === 'Rollout')) {
    const { canary, blueGreen } = rollout.spec.strategy;
    const strategy = canary ?? blueGreen;
    const named = [
      canary?.canaryService,
      canary?.stableService,
      blueGreen?.activeService,
      blueGreen?.previewService,
    ].filter(Boolean);
    for (const service of named)
      if (!services.has(service))
        problem(
          where,
          `Rollout/${rollout.metadata.name} uses Service ${service}, which doesn't exist`,
        );
    const analyses = [
      ...(canary?.steps ?? []).flatMap((step) => step.analysis?.templates ?? []),
      ...(blueGreen?.prePromotionAnalysis?.templates ?? []),
      ...(blueGreen?.postPromotionAnalysis?.templates ?? []),
    ];
    for (const t of analyses)
      if (!templates.has(t.templateName))
        problem(
          where,
          `Rollout/${rollout.metadata.name} runs analysis ${t.templateName}, which doesn't exist`,
        );
    if (!strategy)
      problem(where, `Rollout/${rollout.metadata.name} has no canary or blueGreen strategy`);
  }

  // Autoscaling
  for (const hpa of objects.filter((o) => o.kind === 'HorizontalPodAutoscaler')) {
    const target = find(objects, hpa.spec.scaleTargetRef.kind, hpa.spec.scaleTargetRef.name);
    if (!target)
      problem(where, `HPA ${hpa.metadata.name} targets a missing ${hpa.spec.scaleTargetRef.name}`);
    else if (target.spec.replicas !== undefined)
      problem(
        where,
        `${target.kind}/${target.metadata.name} sets replicas but the HPA owns that number`,
      );
  }
}

// Staging exists to catch what would break prod, so it must *be* prod in every respect but
// these. Anything else that differs is reported line by line.
function normalise(e) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return e.text
    .replace(new RegExp(`\\b${escape(e.host)}\\b`, 'g'), '<host>')
    .replace(new RegExp(`(namespace|name): ${escape(e.namespace)}$`, 'gm'), '$1: <namespace>')
    .replace(/@sha256:[0-9a-f]{64}/g, '@<digest>')
    .replace(/(backend-config|mongo-init)-[a-z0-9]{10}\b/g, '$1-<hash>');
}

function checkParity(staging, prod) {
  const a = normalise(staging).split('\n');
  const b = normalise(prod).split('\n');
  const differences = [];
  for (let i = 0; i < Math.max(a.length, b.length) && differences.length < 10; i++) {
    if (a[i] !== b[i])
      differences.push(`line ${i + 1}: staging "${a[i] ?? ''}" / prod "${b[i] ?? ''}"`);
  }
  for (const d of differences) problem('staging vs prod', d);
}

// GitOps (18 §3.8): what Argo CD is told to deploy, checked like the manifests themselves.
function checkGitOps(environments, platform) {
  const where = 'gitops';
  const settings = parse(render(ARGOCD_DIR));
  const [root] = parse(readFileSync(ROOT_APP, 'utf8'));
  const apps = [root, ...parse(render(APPS_DIR))];
  const projects = Object.fromEntries(
    settings.filter((o) => o.kind === 'AppProject').map((p) => [p.metadata.name, p.spec]),
  );
  const ourRepo = root.spec.source.repoURL;

  for (const app of apps) {
    const name = `Application/${app.metadata.name}`;
    const { source, destination, project } = app.spec;
    const allowed = projects[project];
    if (!allowed) problem(where, `${name} uses project ${project}, which argocd/ doesn't define`);
    else {
      if (!allowed.sourceRepos.includes(source.repoURL))
        problem(where, `${name} reads ${source.repoURL}, which project ${project} doesn't allow`);
      if (!allowed.destinations.some((d) => d.namespace === destination.namespace))
        problem(
          where,
          `${name} deploys to ${destination.namespace}, which project ${project} doesn't allow`,
        );
    }
    if (app.metadata.finalizers?.length)
      problem(where, `${name} has finalizers: deleting it would delete what it deployed`);
    if (source.repoURL === ourRepo) {
      if (source.targetRevision !== 'main')
        problem(where, `${name} follows ${source.targetRevision}; everything follows main`);
      if (!existsSync(source.path))
        problem(where, `${name} deploys ${source.path}, which doesn't exist`);
      if (app !== root && app.metadata.labels?.['straight-salon/source'] !== 'git')
        problem(
          where,
          `${name} needs the label straight-salon/source: git (k8s:up --revision patches by it)`,
        );
    } else if (!source.chart || !/^v?\d+\.\d+\.\d+$/.test(source.targetRevision ?? ''))
      problem(where, `${name}: a chart from another repository must pin an exact version`);
  }

  // One Application per environment, at its overlay, in its namespace.
  for (const e of environments) {
    const app = apps.find((a) => a.metadata.name === e.env);
    if (!app) {
      problem(where, `no Application for ${e.env}`);
      continue;
    }
    if (app.spec.source.path !== overlayDir(e.env))
      problem(
        where,
        `Application/${e.env} deploys ${app.spec.source.path}, not ${overlayDir(e.env)}`,
      );
    if (app.spec.destination.namespace !== e.namespace)
      problem(
        where,
        `Application/${e.env} deploys to ${app.spec.destination.namespace}, its overlay to ${e.namespace}`,
      );
  }
  // Delivery parity: staging is released the way prod is (17 §2.4), and both self-heal.
  const policy = (env) =>
    JSON.stringify(apps.find((a) => a.metadata.name === env)?.spec.syncPolicy);
  if (policy('staging') !== policy('prod'))
    problem(where, 'staging and prod must have the same syncPolicy');
  const prod = apps.find((a) => a.metadata.name === 'prod');
  if (!prod?.spec.syncPolicy?.automated?.selfHeal || !prod.spec.syncPolicy.automated.prune)
    problem(where, 'prod must self-heal and prune: git is the truth there');

  // Every HTTPS listener's hostname is on the certificate; Kustomize renders as Argo CD does.
  const certificate = find(platform, 'Certificate', 'salon-tls');
  for (const l of find(platform, 'Gateway', 'salon').spec.listeners)
    if (l.protocol === 'HTTPS' && !certificate.spec.dnsNames.includes(l.hostname))
      problem(where, `listener ${l.name}: the certificate doesn't cover ${l.hostname}`);
  const cm = find(settings, 'ConfigMap', 'argocd-cm');
  if (!cm?.data?.['kustomize.buildOptions']?.includes('LoadRestrictionsNone'))
    problem(
      where,
      'argocd-cm must render with --load-restrictor LoadRestrictionsNone, like k8s-manifests.mjs',
    );
  return apps.length;
}

const onDisk = overlaysOnDisk().sort();
if (onDisk.join() !== [...ENVIRONMENTS].sort().join())
  problem(
    'overlays',
    `found ${onDisk.join(', ')}; scripts/k8s-manifests.mjs knows ${ENVIRONMENTS.join(', ')}`,
  );

const platform = parse(render(PLATFORM_DIR));
const environments = ENVIRONMENTS.map(describe);
for (const e of environments) checkEnvironment(e, platform);
for (const key of ['namespace', 'host']) {
  const values = environments.map((e) => e[key]);
  if (new Set(values).size !== values.length) problem('environments', `two share a ${key}`);
}
checkParity(
  environments.find((e) => e.env === 'staging'),
  environments.find((e) => e.env === 'prod'),
);
const applications = checkGitOps(environments, platform);

for (const e of environments)
  process.stdout.write(
    `${e.env.padEnd(8)} ${e.namespace.padEnd(24)} ${e.url.padEnd(32)} mongo ×${e.mongoMembers}  backups ${e.backups ? 'yes' : 'no'}  ${e.objects.length} objects\n`,
  );
if (problems.length) {
  process.stderr.write(
    `\nk8s:check found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `k8s:check: platform, ${applications} Argo CD Applications and every environment are consistent; staging matches prod\n`,
);
