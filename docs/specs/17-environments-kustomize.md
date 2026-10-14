# 17 — Environments: one app, three places to run it (FDE step 4)

> Fourth step of the Forward Deployed Engineering track (13-build-plan, "After v1", item 4:
> "Helm or Kustomize, environment overlays").
> Same shape as specs 14–16: concepts (§2), decisions (§3), exercises (§6), questions (§7).
> Free and local, on the kind cluster of steps 2 and 3. Decision 2026-10-14: this step comes
> before going live, so the live deployment can use the prod overlay.
>
> **Since step 5 (18):** Argo CD applies the overlays from `main`; `k8s:up` no longer applies
> them itself, `--latest` is replaced by CI's `deploy-dev` job, `k8s:promote` also checks Argo CD
> and the Rollouts, `k8s:down -- --env` is refused, and the add-ons are Argo CD applications from
> their Helm charts (§3.6). The rest of this spec describes step 4 as it was built.

## 1. Goal in one paragraph

Until now the cluster ran one copy of the app, from one folder of YAML. Real deployments
always have several: a place where new builds land first (**dev**), a dress rehearsal that
looks exactly like production (**staging**), and **prod**. By the end of this step the same
manifests describe all three: a shared **base** plus a small **overlay** per environment
(Kustomize), each in its own namespace with its own hostname, secrets and data, all three
running side by side on the kind cluster behind one shared Gateway. A build moves
**dev → staging → prod by digest** with one command that edits git (`k8s:promote`); a check
in CI (`k8s:check`) fails the build when an overlay breaks a rule, including "staging must be
prod in every respect but its name". Helm is explained and practised, and we say why our own
app uses Kustomize.

## 2. Concepts

### 2.1 What an environment is, and why there's more than one

An **environment** is one complete, running copy of the system, with its own data, secrets
and address. Teams keep several because each answers a different question:

| | Question it answers | Who uses it | Data |
|---|---|---|---|
| **dev** | "Does the new build start and basically work?" | Developers, all day | Throwaway (seeded) |
| **staging** | "Will this exact build work in production?" | Release checks, client demos, UAT | Realistic, not real |
| **prod** | — | Customers | Real |

Each environment is a safety net for the next one. A bug that dev catches costs nothing; one
staging catches costs an afternoon; one prod "catches" costs customers. That's why the order
matters and why a build never skips a step (§2.5).

At a client, FDEs often add environments that aren't about safety: one per customer
(multi-tenant deployments, step 10), a "sandbox" for the client's own developers, an
air-gapped copy for a regulated site. The mechanics in this step are the same.

### 2.2 Build once, configure per environment

Step 1 (14 §2.3) said: build the image **once** and promote those exact bytes. That only works
if everything that differs between environments lives **outside the image**: in
configuration. The [Twelve-Factor App](https://12factor.net/config) puts it as "store config in
the environment". Ask of every setting: does it differ between dev and prod? If yes, it's
config.

| Differs per environment (config) | Must *not* differ (code, or the shape of prod) |
|---|---|
| Hostname, public URLs | The image (by digest, once promoted) |
| Secrets (every one) | Probes, security context, resource limits |
| Size: replicas, members, autoscaling | The Mongo version, Redis persistence |
| Log level | Which features are on (unless that's the experiment) |
| Which build runs (until promoted) | |

Our backend already reads everything from environment variables (03 §3). The frontend still
bakes `NEXT_PUBLIC_SITE_URL` in at build time (14 §8), so staging's share previews link to the
build's default origin. That's a known limitation (§8), and a good example of why
build-time config breaks "build once".

### 2.3 Isolation: namespace, cluster, or account?

How separate should two environments be? Each level up costs more and contains more:

| Separated by | A mistake in dev can… | Cost | Typical use |
|---|---|---|---|
| Namespace (this step) | Starve prod of CPU, crash a shared node, break a shared add-on | Nothing extra | Local, small teams, dev+staging |
| Cluster | Only affect dev's cluster | A control plane per environment | Prod alone on its own cluster |
| Cloud account / project | Not even reach prod's network or billing | Separate everything | The norm for prod at most clients |

We use namespaces because one free local machine is all we have. A real setup would put prod in
its own cluster (and usually its own cloud account). What a namespace *does* give us, and what
we rely on:

- **Its own secrets.** Every environment gets its own generated passwords, JWT secret and
  outbox key (`k8s:up` generates them per namespace). Nothing in dev can open prod's database.
  Sharing secrets between environments is one of the most common, and most expensive, mistakes.
- **Its own data.** Volumes belong to a namespace. `kubectl delete namespace straight-salon-dev`
  deletes dev's data and nothing else.
- **Names that don't clash.** Every environment has a Service called `mongo`; inside a pod,
  `mongo` means "the one in my namespace" (DNS searches the pod's own namespace first).

### 2.4 Parity: staging must be prod

Staging is only worth having if it's prod's twin. Every difference between them is a place
where a bug can hide: if staging runs one Mongo member and prod three, a bug that only shows
during an election passes staging and fails in prod. This is **environment parity**, and
differences that creep in over time are **drift** (someone patches staging by hand "just for
now").

Dev is the opposite: it's deliberately smaller (one Mongo member, one pod each, no backups) so
it's cheap to keep running. That's fine *because* staging exists.

Parity is easy to promise and hard to keep, so we **test** it: `k8s:check` renders staging and
prod, replaces their namespace, hostname, image digests and the config hash with placeholders,
and fails if anything else differs (§3.5). Drift becomes a red build instead of a surprise.

### 2.5 Promotion: moving a build, not rebuilding it

A **promotion** says "the build that passed in dev is the build staging runs now". In our
setup it's literally copying two digests from `overlays/dev/kustomization.yaml` into
`overlays/staging/kustomization.yaml` and committing that. Three rules:

1. **By digest.** A tag like `main` moves; a digest is the exact bytes that were tested (14 §2.2).
2. **One step at a time.** What reaches prod has run in staging, and before that in dev.
   `k8s:promote -- dev prod` is refused.
3. **Only what's actually running.** `k8s:promote` first checks that the source environment
   runs what its overlay pins. Promoting digests that were never deployed (or a `--local`
   build) would mean promoting something nobody looked at.

And new builds enter **only at dev**: `k8s:up -- --latest` and `--local` are refused for staging
and prod. Each promotion is a commit, so `git log overlays/prod` is a full deployment history:
who moved what into prod, when. That's half of **GitOps** already. Step 5 adds the other half,
a controller (Argo CD) that applies whatever git says, so nobody runs `k8s:up` against prod by
hand.

### 2.6 Kustomize: a base and overlays

Kustomize (built into `kubectl`: `kubectl kustomize`, `kubectl apply -k`) works on **plain
YAML**. There's no template language: the base is valid Kubernetes YAML you could apply as it
is, and an overlay **transforms** it:

- `resources:` what to start from (`../../base`, plus the overlay's own files).
- `namespace:` sets the namespace on every object.
- `images:` swaps image references (our digests).
- `patches:` changes objects. Two kinds:
  - a **strategic merge patch** looks like the object itself with only the fields you change
    (`spec.replicas: 1`). It knows Kubernetes list semantics, e.g. env vars merge by `name`.
    `$patch: delete` removes a whole object (dev drops the backup CronJobs this way).
  - a **JSON patch** (RFC 6902) is a list of operations at exact paths
    (`op: replace, path: /spec/hostnames`). Precise, but tied to the list positions.
- `configMapGenerator:` builds a ConfigMap from literals or files, with
  `behavior: merge` in an overlay to add or override keys.

**Why generated ConfigMaps get a hash in their name.** A generated ConfigMap is named
`backend-config-<hash of its content>`, and Kustomize rewrites every reference to it. Pods read
`envFrom` only when they start, so with a fixed name, changing `LOG_LEVEL` would update the
ConfigMap and leave every running pod on the old value until something restarted them. With a
hashed name, a config change is a *new name* in the Deployment's pod template, which is a
change Kubernetes rolls out like a new image: one pod at a time, with readiness checks, and
`kubectl rollout undo` goes back to the old config too.

Kustomize also has **components** (reusable bundles of patches you mix into several overlays,
e.g. a "small" component for dev and for per-developer environments). With one small overlay,
we don't need them yet.

### 2.7 Helm: charts, values, releases

Helm takes the opposite approach: a **chart** is a folder of **templates** (YAML with Go
template code: `{{ .Values.replicas }}`, `{{- if .Values.backups.enabled }}`) plus a
`values.yaml` of defaults. You install it with your own values, and Helm renders and applies the
result as a named **release**:

```
helm upgrade --install salon ./chart -f values-prod.yaml --namespace straight-salon
helm history salon       # every revision, with its values
helm rollback salon 3    # back to revision 3: manifests and values together
```

What Helm gives you that Kustomize doesn't:

- **Packaging and distribution.** Charts are versioned and published (in Helm repositories,
  or as OCI artifacts in the same registries as images). Almost every piece of third-party
  infrastructure ships one: cert-manager, Envoy Gateway, metrics-server, Prometheus, Argo CD.
- **A real interface.** A chart's `values.yaml` is its API: users set documented values and
  never see the templates.
- **Releases and lifecycle.** Helm knows which objects belong to a release, so an upgrade
  **deletes** what the new version no longer has (compare §2.9), and it runs **hooks** (e.g. a
  migration Job before an upgrade).

What it costs: templates are code that produces YAML, so they're harder to read and review, and
easy to get subtly wrong (indentation inside `{{ }}`, quoting, a value nobody can override
because the template didn't expose it). A chart is also **someone else's code and someone else's
images**: in 2025 Bitnami, whose charts half the industry used, moved most of its free images
behind a subscription, and many teams' installs broke on the next upgrade. Pin chart versions,
read what you install, and know where its images come from (the same supply-chain care as 14).

### 2.8 Kustomize or Helm?

| | Kustomize | Helm |
|---|---|---|
| Input | Plain YAML + patches | Templates + values |
| Readability of the result | What you see is what you apply | Must render to know |
| Install needed | No (`kubectl -k`) | The `helm` binary |
| Distribution to others | Weak (git URLs) | Strong (chart repos, OCI) |
| Deletes removed objects | No (§2.9) | Yes (release tracking) |
| Many near-identical copies (100 tenants) | Many overlays | One chart, 100 values files |
| Best at | Software **you own** and deploy in a few environments | Software **you ship to others**, or **consume from others** |

The common rule of thumb, which we follow: **Kustomize for what you own, Helm for what you
consume.** Our app has one team, three environments and differences that fit in a page of
patches, so Kustomize keeps it plain YAML anyone can read in a review. The cluster add-ons are
other people's software, which is where Helm shines; they're installed from release manifests
today and move to Helm charts managed by Argo CD in step 5 (§3.6). The two also combine: Helm
can pipe its output through Kustomize (a post-renderer), and Kustomize can inflate a Helm chart
(`helmCharts:`). If Straight Salon became a product clients install themselves (step 10's
"second salon"), a Helm chart would be the right package for *them*.

### 2.9 `kubectl apply` never deletes

`kubectl apply` creates and updates what's in the manifests. It never deletes an object just
because the manifests stopped mentioning it. Moving the Gateway from the app's namespace to the
platform's (§3.3) left the old Gateway running and holding the NodePorts, so `k8s:up` removes it
once, by name. The old fixed-name `backend-config` ConfigMap is removed the same way.

Generated ConfigMaps pile up for the same reason: every config change leaves the previous
`backend-config-<hash>` behind. We keep them on purpose: the Deployment's older revisions
reference them, and `kubectl rollout undo` to a revision whose ConfigMap was deleted gives pods
that can't start. Cleaning up correctly ("delete what no revision we might return to still
needs") is what **pruning** in a GitOps tool does. It arrives with Argo CD in step 5.

### 2.10 What testing found (2026-10-14)

Running all three environments on the existing cluster (prod moved over from step 3, with its
data) turned up these. Each is fixed or worked around as noted:

- **`$(VAR)` only sees variables defined earlier.** Kubernetes expands `$(NAMESPACE)` in an env
  value only from variables *above* it in the list. Dev's strategic merge patch on
  `MONGO_RS_MEMBERS` moved that variable to the top, so the member name would have been the
  literal text `$(NAMESPACE)`. The patch now repeats `NAMESPACE` first, and `k8s:check` checks the
  order.
- **A Job's pod template is immutable.** Re-applying a changed Job is an error, which is why
  step 2 deleted `migrate` before each deploy. This step changed `mongo-init` too, so `k8s:up` now
  replaces every Job in the overlay (all are idempotent), and `k8s:diff` leaves Jobs out (the
  server can only answer "invalid" for them).
- **`mongo-init` waited forever after a failover (a step 3 bug).** It connected to `mongo-0` and
  waited for *that member* to be primary. After any election (step 3's own exercise 2), the
  primary is another member. It only showed now because every deploy re-runs the Job. On every
  run after the first, it now connects through the replica set, which finds the primary.
- **Prod was running unsigned local builds.** `k8s:diff -- --env prod` showed step 3's `--local`
  images still in prod, while the digests committed in git were step 2's, older than the S3
  storage driver. Deploying "what git says" would have quietly broken uploads. The fix was the
  process this step adds: dev took `main`'s signed build (`--latest`), and it was promoted to
  staging and then prod. The lesson: what runs and what's recorded can drift apart, and a
  `diff` against the live cluster is how you find out.
- **Downloads from GitHub fail in bursts** (connection resets, TLS timeouts), and
  `kubectl apply -f <url>` doesn't retry. Add-on manifests are now fetched with curl
  (`--retry-all-errors`, up to 2 minutes), with a larger output buffer (the Envoy Gateway
  manifest is over 1 MB, Node's default limit).
- **One false alarm from the restore drill.** Right after prod moved over, its drill failed:
  67 documents "failed to restore" as duplicates in five collections, so the scratch database
  still held them despite the drill's `dropDatabase`. The same archive then restored cleanly,
  and repeated backup-then-drill runs couldn't reproduce it. The cause isn't known. The drill
  now also passes `--drop` to `mongorestore`, which empties each collection right before
  restoring it, so leftovers can't fail it while real restore errors still do.

## 3. Decisions

### 3.1 Layout

```
infra/k8s/
  kind-config.yaml            the cluster (unchanged)
  platform/                   shared by every environment, applied once per cluster
    namespace.yaml            straight-salon-gateway
    gateway.yaml              EnvoyProxy, GatewayClass, Gateway (a listener per environment), HTTP→HTTPS redirect
    certificates.yaml         local CA (unchanged, so browser trust survives) + one site certificate for every hostname
  base/                       the app as every environment runs it: prod-shaped, no namespace, no digests
    kustomization.yaml        file list + backend-config generator
    mongo.yaml redis.yaml seaweedfs.yaml mailpit.yaml backup.yaml migrate.yaml
    backend.yaml worker.yaml frontend.yaml routes.yaml
  overlays/
    dev/                      namespace, hostname, digests, debug logs + single-mongo, one-of-each, no-backups patches
    staging/                  namespace, hostname, digests
    prod/                     namespace, hostname, digests
```

The base is never applied on its own. The old `infra/k8s/kustomization.yaml` is gone, so
`kubectl apply -k infra/k8s` no longer works by accident: you always name an environment.

### 3.2 The environments

| | dev | staging | prod |
|---|---|---|---|
| Namespace | `straight-salon-dev` | `straight-salon-staging` | `straight-salon` (unchanged from step 3, so its volumes, data and secrets carry over) |
| URL | `https://dev.salon.localhost` | `https://staging.salon.localhost` | `https://salon.localhost` |
| MongoDB | 1 member, no PDB | 3 members, PDB | 3 members, PDB |
| api | 1 pod, no HPA | HPA 2–4 | HPA 2–4 |
| frontend | 1 pod | 2 | 2 |
| Backups and drill | none | nightly | nightly |
| `LOG_LEVEL` | debug | info | info |
| Images | `--latest` / `--local` | promoted from dev | promoted from staging |

`*.localhost` names resolve to 127.0.0.1 in browsers and in curl without any `/etc/hosts`
entry. Each hostname gets host-only cookies, so signing in on dev doesn't sign you in on prod.
The three Mongo members of staging and of prod each spread over the three worker nodes (the
anti-affinity rule applies within a namespace), so staging and prod members share nodes.
All three together use about 6 GB of memory, the cluster included; `k8s:down -- --env <name>` removes one
environment.

### 3.3 The platform: one Gateway, a listener per environment

kind maps host ports 80/443 to one pair of NodePorts, and a NodePort belongs to one Service in
the whole cluster, so the environments **share one Gateway**. It moves to its own namespace,
`straight-salon-gateway`, the "platform team" side of the Gateway API's split (15 §2.5).

- One HTTPS listener **per environment hostname**, each with
  `allowedRoutes.namespaces.selector` matching exactly one namespace
  (`kubernetes.io/metadata.name`, a label Kubernetes sets itself). A route in dev that claims
  `salon.localhost` is not accepted (`NoMatchingListenerHostname`): the map from hostname to
  namespace is the platform's decision, not each app's.
- The plain-HTTP listener only admits routes from the platform's own namespace: the one
  redirect to HTTPS, for every hostname.
- One certificate, `salon-tls`, lists every hostname; it's issued by the **same** local CA as
  before (`cert-manager/salon-local-ca`, unchanged), so a browser that trusted it still does.
- Each environment's `HTTPRoute salon` (base `routes.yaml`) attaches with
  `parentRefs: [{ name: salon, namespace: straight-salon-gateway }]`; the overlay sets its
  hostname.
- Adding an environment = a listener + a certificate name here, and an overlay.

### 3.4 Tooling (`scripts/k8s.mjs`, `scripts/k8s-manifests.mjs`)

Every command takes `-- --env dev|staging|prod`, **default dev** (a tool should default to the
least dangerous target). The environment's namespace, URL, Mongo member count and whether it has
backups are read from its **rendered overlay** (`k8s-manifests.mjs`, with the `yaml` package),
never repeated in the script.

| Command | Does |
|---|---|
| `k8s:up` | cluster and add-ons if needed, **platform**, then the environment: namespace, its own secrets, `mongo-init.js`, replace every Job, apply the overlay, wait for every Job and workload in it, **smoke test** (`GET <url>/api/v1/settings/public` through the Gateway must return 200) |
| `k8s:up -- --latest` / `--local` | dev only (§2.5) |
| `k8s:promote -- <from> <to>` | next environment only; refuses unless `<from>` runs what its overlay pins; rewrites `<to>`'s digests and says to commit |
| `k8s:render` | prints the environment's manifests, for reading or `diff` |
| `k8s:diff` | `kubectl diff --server-side` against the live cluster (Jobs aside, §2.10) |
| `k8s:seed`, `k8s:backup`, `k8s:restore-drill`, `k8s:restore` | as in 15/16, for the environment; the backup commands refuse dev |
| `k8s:down` | without `--env`: delete the cluster; with `--env`: delete only that namespace |

Once, when it finds the step-3 Gateway in namespace `straight-salon`, `k8s:up` deletes it with
its EnvoyProxy, redirect route and certificate (§2.9) before applying the platform (both
Gateways would want the same NodePorts). It also deletes a fixed-name `backend-config`
ConfigMap if one is left.

MongoDB names: connections use the short name `mongo-0.mongo` (resolves in the pod's own
namespace). The replica set's **member names** must be full names, stored in its
configuration, so the `mongo-init` Job builds them from `NAMESPACE`, filled in by the
**downward API** (`fieldRef: metadata.namespace`) and expanded by Kubernetes in
`MONGO_RS_MEMBERS`. The base needs no namespace anywhere.

### 3.5 `k8s:check`, in CI

`scripts/k8s-check.mjs` renders the platform and every overlay (no cluster needed) and fails on:

- an object outside its environment's namespace, or a cluster-wide object in an overlay;
- one of our images not pinned by digest, or anyone else's without a version tag (or `latest`);
- a hostname that disagrees anywhere: route, `APP_BASE_URL`, `UPLOADS_PUBLIC_URL`, the Gateway
  listener (which must admit only this namespace), the certificate;
- `MONGO_RS_MEMBERS` not matching the StatefulSet's replica count, or `NAMESPACE` defined after
  it (§2.10);
- a PodDisruptionBudget asking for as many pods as exist (no drain could ever succeed, 16 §2.10);
- a Deployment that sets `replicas` while an HPA owns it (15 §3.2);
- **staging and prod differing in anything but namespace, hostname, digests and config hash**
  (§2.4);
- an overlay folder the scripts don't know about, or two environments sharing a namespace or host.

CI's new `manifests` job runs it with kubectl v1.37.0 (checksum-verified, the version the README
installs: a Kustomize upgrade can change what an overlay renders), and `promote` needs it.

### 3.6 Helm: explained, practised, not used for the app

No chart for Straight Salon (§2.8). The add-ons (Envoy Gateway, cert-manager, metrics-server)
stay on their pinned release manifests. In step 5 they become Argo CD applications, most likely
from their Helm charts. Exercise 7 renders the metrics-server chart with Helm v4.3.0 and
compares it with what `k8s.mjs` does by string replacement today.

### 3.7 Restore drill

`mongorestore --drop` in the drill (§2.10). Nothing else in backups changes.

## 4. What changes in the repo

| File | Change |
|---|---|
| `infra/k8s/platform/*` | Gateway (moved, listener per environment), certificates (moved, every hostname), namespace |
| `infra/k8s/base/*` | The step 2/3 manifests without namespaces or digests; `routes.yaml` (the app's route); `backend-config` as a generator; Mongo names namespace-free; `mongo-init` connects through the set; drill `--drop` |
| `infra/k8s/overlays/{dev,staging,prod}/*` | Namespace, hostname, digests; dev's three patches |
| `infra/k8s/kustomization.yaml`, `config.yaml`, `namespace.yaml` | Removed (moved into base and overlays) |
| `scripts/k8s.mjs` | `--env`; platform install and one-time cleanup; per-environment secrets; `promote`, `render`, `diff`; Jobs replaced; smoke test; download retries |
| `scripts/k8s-manifests.mjs`, `scripts/k8s-check.mjs` | Render and parse overlays; the checks |
| `package.json` | `k8s:promote`, `k8s:render`, `k8s:diff`, `k8s:check`; dev dependency `yaml` |
| `.github/workflows/ci.yml` | `manifests` job; `promote` needs it |
| `frontend/tests/e2e/global-setup.ts` | Comment: the cluster's namespace depends on the environment |
| `docs/specs/01`, `12`, `13`, `15`, `16`, `README.md` | Pointers, layout, revision log |

The application code does not change.

## 5. Definition of done

- [ ] `npm run k8s:check` passes, and fails for each of: staging drifting from prod, a wrong
      hostname, a tag-less image, the `NAMESPACE` order (verified by breaking them on purpose).
- [ ] `npm run k8s:up` (dev), `-- --env staging` and `-- --env prod` all end with a passing smoke
      test, and all three sites answer at the same time.
- [ ] Prod keeps its data through the move (same users and bookings before and after).
- [ ] `k8s:promote` moves a build dev → staging → prod; skipping a step, promoting from an
      environment that doesn't run its pinned build, and `--latest` outside dev are refused.
- [ ] A route in dev claiming `salon.localhost` is not accepted by the Gateway.
- [ ] Backups and the restore drill pass in staging and prod; dev has none.
- [ ] `k8s:diff -- --env prod` shows nothing right after `k8s:up -- --env prod`.
- [ ] Lint, format and typecheck pass; `docker compose up` unchanged; specs and README updated;
      conventional commit.

## 6. Try it yourself

1. **Three environments, one set of files.** `npm run k8s:render -- --env dev | less`. Then
   compare: `diff <(npm run -s k8s:render -- --env dev) <(npm run -s k8s:render -- --env prod)`.
   Every difference should be one you can find in `overlays/dev`. Do the same for staging vs
   prod: only names, the host, the digests and the config hash.
2. **Break parity.** In `overlays/staging/kustomization.yaml`, add a patch that sets the frontend
   to 3 replicas ("staging is busy this week"). Run `npm run k8s:check`. Read what it says, then
   remove the patch. Why is a test better than a rule in a README?
3. **Config rolls pods.** Change dev's `LOG_LEVEL` to `info`. `npm run k8s:diff` shows what
   would change: a new ConfigMap name in three places. Run `npm run k8s:up`, watch
   `kubectl -n straight-salon-dev get pods -w`, then `kubectl -n straight-salon-dev get cm`:
   the old ConfigMap is still there (§2.9). `kubectl -n straight-salon-dev rollout undo
   deployment backend` goes back to `debug`. Why would deleting old ConfigMaps break that?
4. **Promote a build.** After the next merge to `main` publishes new images:
   `npm run k8s:up -- --latest` (dev; signature checked), try it, then
   `npm run k8s:promote -- dev staging`, `git diff`, `npm run k8s:up -- --env staging`, and on to
   prod. Along the way, try `npm run k8s:promote -- dev prod`, and promoting staging → prod
   *before* deploying staging. `git log -p infra/k8s/overlays/prod` is now your deployment log.
5. **Claim someone else's hostname.** Create an HTTPRoute in `straight-salon-dev` with
   `hostnames: [salon.localhost]` and the same parentRef as `base/routes.yaml`.
   `kubectl -n straight-salon-dev get httproute <name> -o yaml`: read `status.parents`. Which
   setting in `platform/gateway.yaml` stopped it? Delete the route.
6. **Apply doesn't delete.** Add a ConfigMap to `overlays/dev` (a new file listed in
   `resources:`), `npm run k8s:up`, then remove it and `npm run k8s:up` again. It's still in the
   cluster. Who should delete it, and how would they know it's safe to?
7. **Helm, hands on.** Install Helm v4.3.0 into a scratch folder:
   ```sh
   mkdir -p /tmp/helm && cd /tmp/helm
   curl -fsSLO --retry 5 --retry-all-errors https://get.helm.sh/helm-v4.3.0-linux-amd64.tar.gz
   echo "86584a54def73570558f66f5111cc53dfed56689637ae32c1201205d494f54fb  helm-v4.3.0-linux-amd64.tar.gz" | sha256sum -c -
   tar xzf helm-v4.3.0-linux-amd64.tar.gz && ./linux-amd64/helm version
   ```
   Render metrics-server from its chart, with the value our script patches in by string replacement:
   `./linux-amd64/helm template metrics-server metrics-server --repo https://kubernetes-sigs.github.io/metrics-server/ --version 3.14.0 --namespace kube-system --set 'args={--kubelet-insecure-tls}'`.
   Find the flag in the output. Then `helm show values` for the same chart: what else could you
   set without touching a template? Which approach would survive the next metrics-server
   release better, the chart or our string replacement?
8. **Sketch the chart we didn't write.** On paper: if Straight Salon were a Helm chart, what
   would `values.yaml` contain to express everything in our three overlays? Which of dev's
   differences need an `{{ if }}` in a template? Compare how much of the app you'd have to read
   to review a change in each approach.

## 7. Check your understanding

1. What's the difference between config and code, and which of our settings would break "build
   once, promote everywhere" if they were code?
2. Why does `k8s:promote` refuse to promote from an environment that isn't running its pinned
   digests?
3. Staging and prod share a cluster here. Name two ways a mistake in staging could still affect
   prod, and what a real setup does about each.
4. Why does a change to a generated ConfigMap restart pods while a change to a fixed-name one
   doesn't?
5. When would you choose Helm over Kustomize for an app you own?
6. Why must each hostname's listener name the one namespace allowed to use it?
7. What did `k8s:diff` reveal about prod in this step, and what would have happened without it?

(Answers are discussed when we review this step.)

## 8. Known limitations (carried forward)

- **One cluster for every environment** (§2.3): a node problem or a broken add-on hits all three.
  Prod belongs on its own cluster (and usually its own cloud account).
- **Promotion is manual** and nothing stops a person running `k8s:up -- --env prod` from a
  modified checkout. Argo CD (step 5) applies only what's committed.
- **No pruning** (§2.9): objects removed from the manifests stay until someone deletes them;
  old generated ConfigMaps accumulate.
- **Frontend build-time config**: `NEXT_PUBLIC_SITE_URL` is baked into the image, so share
  previews link to the build's origin in every environment (14 §8; step 10).
- **The restore drill's one unexplained failure** (§2.10) is worked around, not understood.
- **No ResourceQuota per namespace**: a runaway dev can starve staging and prod on the same nodes.
- Carried from steps 2 and 3: secrets base64 in the cluster (step 7), one worker, SeaweedFS and
  Redis single pods, backups inside the cluster, client IPs lost at the gateway.
