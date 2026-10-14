// Reads the Kubernetes manifests the way the cluster will see them: each environment's overlay
// rendered by Kustomize (`kubectl kustomize`, no cluster needed), parsed into objects
// (17 §3.4). `k8s.mjs` and `k8s-check.mjs` take every environment fact from here (namespace,
// hostname, Mongo member count), so the overlay is the only place that states it.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { parseAllDocuments } from 'yaml';

export const K8S_DIR = 'infra/k8s';
export const PLATFORM_DIR = `${K8S_DIR}/platform`;
// GitOps (18 §3.1): Argo CD's own settings, and the Applications the root app deploys.
export const ARGOCD_DIR = `${K8S_DIR}/argocd`;
export const APPS_DIR = `${K8S_DIR}/gitops/apps`;
export const ROOT_APP = `${K8S_DIR}/gitops/root.yaml`;
// Also the promotion order: a build moves dev → staging → prod, one step at a time.
export const ENVIRONMENTS = ['dev', 'staging', 'prod'];
export const OUR_IMAGES = ['backend', 'frontend'].map(
  (app) => `ghcr.io/vaikashmb/straight-salon-${app}`,
);

export const overlayDir = (env) => `${K8S_DIR}/overlays/${env}`;
export const overlayKustomization = (env) => `${overlayDir(env)}/kustomization.yaml`;

export function overlaysOnDisk() {
  return readdirSync(`${K8S_DIR}/overlays`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// The base reads infra/docker/mongo-init.js, outside its folder; Kustomize allows that only with
// this flag. Argo CD passes the same one (argocd/argocd-cm.yaml), so both render alike.
export function render(dir) {
  return execFileSync('kubectl', ['kustomize', '--load-restrictor', 'LoadRestrictionsNone', dir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

export function parse(text) {
  return parseAllDocuments(text).map((doc) => {
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    return doc.toJS();
  });
}

export const find = (objects, kind, name) =>
  objects.find(
    (o) =>
      o.kind === kind &&
      (name instanceof RegExp ? name.test(o.metadata.name) : o.metadata.name === name),
  );

// Every container (init containers too) of every workload kind we use, the Jobs an
// AnalysisTemplate starts included.
export function containers(objects) {
  return objects.flatMap((o) => {
    const pods =
      o.kind === 'CronJob'
        ? [o.spec.jobTemplate.spec.template.spec]
        : o.kind === 'AnalysisTemplate'
          ? o.spec.metrics.map((m) => m.provider?.job?.spec.template.spec).filter(Boolean)
          : [o.spec?.template?.spec].filter(Boolean);
    return pods.flatMap((pod) =>
      [...(pod.initContainers ?? []), ...(pod.containers ?? [])].map((c) => ({
        owner: `${o.kind}/${o.metadata.name}`,
        ...c,
      })),
    );
  });
}

// What the scripts need to know about one environment, read from its rendered overlay.
export function describe(env) {
  if (!ENVIRONMENTS.includes(env))
    throw new Error(`unknown environment "${env}" (${ENVIRONMENTS.join(', ')})`);
  const text = render(overlayDir(env));
  const objects = parse(text);
  const namespace = objects.find((o) => o.kind === 'Namespace')?.metadata.name;
  const host = find(objects, 'HTTPRoute', 'salon')?.spec.hostnames?.[0];
  if (!namespace || !host) throw new Error(`${overlayDir(env)} has no Namespace or route hostname`);
  return {
    env,
    namespace,
    host,
    url: `https://${host}`,
    mongoMembers: find(objects, 'StatefulSet', 'mongo')?.spec.replicas ?? 0,
    backups: Boolean(find(objects, 'CronJob', 'mongo-backup')),
    objects,
    text,
  };
}
