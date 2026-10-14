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
import {
  ENVIRONMENTS,
  OUR_IMAGES,
  PLATFORM_DIR,
  containers,
  describe,
  find,
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
    .replace(/backend-config-[a-z0-9]{10}\b/g, 'backend-config-<hash>');
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
  'k8s:check: platform and every environment are consistent; staging matches prod\n',
);
