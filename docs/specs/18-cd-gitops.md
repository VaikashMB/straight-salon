# 18 — Continuous delivery: git decides what runs (FDE step 5)

> Fifth step of the Forward Deployed Engineering track (13-build-plan, "After v1", item 5:
> "CD & GitOps: GitHub Actions → Argo CD; rolling, blue-green, canary releases; migrations as
> Jobs"). Same shape as specs 14–17: concepts (§2), decisions (§3), exercises (§6), questions
> (§7). Free and local: Argo CD and Argo Rollouts are open source (Apache 2.0) and run in the kind
> cluster; GitHub Actions is free for public repositories.

## 1. Goal in one paragraph

Until now a person deployed: `npm run k8s:up -- --env prod` from their own checkout, whatever
that checkout said. By the end of this step nobody runs a deploy command. **Argo CD**, running
inside the cluster, watches the repository and keeps every environment (and the cluster's
add-ons, and its own settings) at what `main` says; a hand edit in staging or prod is put back
within seconds. CI closes the loop for dev: every build that passes on `main` is committed into
`overlays/dev` by CI itself and Argo CD deploys it. Staging and prod move by a reviewed commit
(`k8s:promote`, then merge). Releases stop being "replace the pods": the api is released as a
**canary** and the frontend **blue-green** (Argo Rollouts), each checked by an automatic
analysis that aborts a bad release before it gets all the traffic, and migrations run as a
**sync hook** before any new code starts. `k8s:up` shrinks to the bootstrap: the cluster,
Argo CD, the secrets git can't hold yet (step 7), and "follow this repository".

## 2. Concepts

### 2.1 CI, continuous delivery, continuous deployment

- **Continuous integration (CI)**: every change is built and tested, automatically (12, 14).
- **Continuous delivery**: every change that passes *could* be released at any moment, by a
  decision (a person presses a button, merges a promotion).
- **Continuous deployment**: every change that passes *is* released, with no decision.

We now do both, per environment: **dev is continuous deployment** (every green build on `main`
reaches it with no human step), **staging and prod are continuous delivery** (a promotion is a
pull request someone reviews and merges). That split is the norm at clients: the closer to
customers, the more a human decision is worth its delay.

### 2.2 GitOps

GitOps is a way of running continuous delivery where **git is the only way to change what runs**.
The OpenGitOps project states it as four principles:

1. **Declarative**: the desired state is described (manifests), not scripted (commands).
2. **Versioned and immutable**: that description lives in git; every change is a commit.
3. **Pulled automatically**: software agents fetch the description themselves.
4. **Continuously reconciled**: the agents keep comparing reality with the description and
   correct the difference.

What this buys, in practice:

| Question | Before (push by hand) | GitOps |
|---|---|---|
| What runs in prod? | Ask the cluster (and hope it matches git) | `infra/k8s/overlays/prod` on `main` |
| Who deployed it, when, why? | Shell history, if anyone kept it | `git log -p infra/k8s/overlays/prod` |
| How do I roll back? | Remember what ran before, redeploy it | `git revert` the promotion |
| Someone `kubectl edit`ed prod | Nobody knows (17 §2.10 found exactly this) | Shown as drift, and reverted (self-heal) |
| The cluster is gone | Rebuild from memory and scripts | Bootstrap a new one; Argo CD deploys git (§2.9) |
| Who can change prod? | Anyone with cluster credentials | Whoever can merge to `main` (branch rules, reviews) |

### 2.3 Push or pull

The obvious way to automate deploys is **push**: the CI job runs `kubectl apply` at the end. That
needs CI to hold credentials for every cluster, and the network path from GitHub to the cluster.
**Pull** turns it around: an agent *inside* the cluster fetches from git and applies locally.

| | Push (CI runs kubectl) | Pull (Argo CD in the cluster) |
|---|---|---|
| Cluster credentials | In CI, for every cluster | Never leave the cluster |
| Network | CI must reach the API server | The cluster must reach git (outbound only) |
| A cluster on a laptop, behind NAT, in a client's private network | Needs a tunnel or a self-hosted runner | Works as is |
| Drift after the deploy | Unseen until the next deploy | Seen and corrected continuously |
| Feedback in CI ("did it deploy?") | Immediate | Not in CI: in Argo CD |

Our cluster runs on a laptop with no inbound access, which settles it, and it's the usual
deciding factor at clients too: FDEs often deploy into networks nobody outside can reach.

The cost of pull is **latency and visibility**. Argo CD notices a commit when it next polls
(every 60 s here, `timeout.reconciliation`); a **webhook** from GitHub would make that instant but
needs inbound access, which is the thing we don't have. And CI goes green before the deploy has
happened: whether it worked is in Argo CD, not in the pull request.

### 2.4 Argo CD's building blocks

- **Application**: "render this path (or chart) at this revision and keep this namespace equal
  to it". It has two independent statuses:
  - **sync status**: does the cluster match git? `Synced` / `OutOfSync`.
  - **health**: is what's running working? `Healthy` / `Progressing` / `Degraded` / `Suspended`
    (a paused canary) / `Missing`.
  Synced and Degraded happens (git was applied, and it doesn't work); OutOfSync and Healthy
  too (someone changed it by hand, and it works).
- **Sync policy**: manual, or `automated` (sync whenever git changes), plus `prune` (delete
  objects removed from git) and `selfHeal` (sync again when the *cluster* changes, i.e. undo
  hand edits).
- **AppProject**: guard rails. Which repositories an Application may read, which
  namespaces it may deploy to, which cluster-wide kinds it may create. Our environments'
  project can't touch the Gateway or create a CRD, whatever an overlay says.
- **App of apps**: Applications are Kubernetes objects too, so one Application (`root`) can
  deploy a folder of Applications. One object to bootstrap, everything else from git.
- **ApplicationSet** (not used here): generates Applications from a template and a list
  (environments, clusters, tenants, folders in git). Three environments are clearer written out;
  a hundred tenants (step 10) are not.

### 2.5 Release strategies

How the new version replaces the old one. Each workload picks one:

| Strategy | How | Old and new at once? | Rollback | Costs | Ours |
|---|---|---|---|---|---|
| **Recreate** | Stop all old, start all new | No (downtime) | Redeploy | Downtime | worker (never two relays, 15 §3.2) |
| **Rolling** | Replace pods a few at a time | Yes, briefly | Roll again | Nothing extra | Deployments' default (steps 2–4) |
| **Blue-green** | Start a full new set beside the old, check it, switch all traffic at once | Not for users; both run | Switch back (instant while old pods remain) | Twice the pods during a release | frontend |
| **Canary** | Give the new version a small share of traffic, check, increase | Yes, by design | Abort: canary scaled away | Analysis to decide; mixed versions | api |

A rolling update checks only that new pods are *ready*. Blue-green and canary add a **decision
point**: something (a person, or an automatic **analysis**) looks at the new version under
real conditions before everyone gets it. **Argo Rollouts** provides both as a `Rollout`
resource: a Deployment with a `strategy.canary` or `strategy.blueGreen`, plus
**AnalysisTemplates** that run checks (Jobs, web requests, Prometheus queries) and abort the
release when one fails.

**Traffic splitting.** Without a traffic router, a canary's "weight" is a pod ratio: the Service
selects old and new pods alike, so one canary pod next to one stable pod gets about half the
requests. Precise weights (5 %, then 25 %...) need the router to split traffic: Argo Rollouts
can drive the Gateway API (through a plugin) or a service mesh. With two to four api pods, pod
ratio is honest enough, and the plugin is one more moving part we don't need yet (§8).

### 2.6 Sync waves and hooks: order in a world without order

Kubernetes applies everything at once and lets controllers retry until it settles. Some things
need order anyway: the replica set must exist before the users, the users before the migration,
the migration before new code. Argo CD gives two tools:

- **Sync waves**: an annotation (`argocd.argoproj.io/sync-wave: "2"`). Argo CD applies wave by
  wave and waits for each to be **healthy** before the next. Lower first; default 0.
- **Hooks**: an object marked `argocd.argoproj.io/hook: PreSync | Sync | PostSync | SyncFail`
  is not "kept equal to git"; it is **run** during each sync, at that point. A Job hook is a task
  per deploy. `hook-delete-policy: BeforeHookCreation` deletes the previous run first, which is
  also the answer to 17 §2.10's "a Job's pod template is immutable".

Inside an environment (§3.4): data stores (wave 0) → `mongo-init`, `buckets` hooks (wave 1) →
`migrate` hook (wave 2) → api, worker, frontend (wave 3). At the cluster level, the
Applications themselves are in waves: add-ons (-2) → platform and Argo CD settings (-1) →
environments (0).

### 2.7 Migrations during a release: expand, then contract

The migration hook runs **before** the new code, **while the old code is still serving**. And
during a canary, old and new api pods serve side by side for a minute. So a migration must work
for both versions at once. The pattern is **expand / contract**, over several releases:

1. **Expand**: add (a new field, a new collection, an index). Old code ignores it, new code
   uses it. Release.
2. **Migrate data** if needed (backfill), in a hook or a background job.
3. **Contract**: remove what only the old version used, once no old version runs anywhere
   (after prod has the new one, and you no longer intend to roll back past it).

Renaming a field in one release breaks this: the old pods (and a rolled-back version) look for
the old name. A failed migration hook stops the sync before wave 3, so the old code keeps running
against an unchanged schema; that's the safe failure.

### 2.8 Pruning, orphans, and objects nobody owns

Argo CD records which objects it created (an annotation, `argocd.argoproj.io/tracking-id`).
With `prune: true`, an object removed from git is deleted: the missing half of `kubectl apply`
(17 §2.9). Two consequences:

- **Objects Argo CD didn't create are never pruned**, even when they look like ours: step 4's
  Deployments `backend` and `frontend` (replaced by Rollouts) and the fixed-name `mongo-init`
  ConfigMap. `k8s:up` removes those once (§3.9). Argo CD can *show* them: an AppProject's
  `orphanedResources` lists what's in the namespace but not in git, as warnings.
- **Generated ConfigMaps** (`backend-config-<hash>`) would be pruned at the next change, while an
  old ReplicaSet (an aborted canary, a blue-green rollback, 17 §2.9) may still need one to start
  pods. So they're marked `Prune=false` and `IgnoreExtraneous`: kept, and not counted as drift.
  They still pile up; deleting the ones no ReplicaSet refers to is a cleanup job nobody wrote yet
  (§8).

### 2.9 The bootstrap: who deploys the deployer?

Argo CD deploys everything, so what deploys Argo CD? Something outside it, once: here
`k8s:up`, which installs Argo CD from a pinned, checksum-verified manifest, applies its settings
once, and applies the one `root` Application. From then on, Argo CD manages even its own
settings (Application `argocd-config`). The add-ons that `k8s:up` used to install by URL are
Argo CD Applications from their Helm charts, pinned by chart version.

What the bootstrap still does that git can't: **secrets** (generated per environment, never
committed; step 7 moves them out of the bootstrap with External Secrets or Sealed Secrets).

A test of the whole idea: **delete the cluster and rebuild it from git** (exercise 8). Apart
from data (backups, 16) and secrets, nothing should be lost, because nothing was ever only in
the cluster.

### 2.10 What testing found (2026-10-14)

Tested by bootstrapping a second, throwaway kind cluster from nothing, following the feature
branch (`K8S_CLUSTER=gitops-test npm run k8s:up -- --env dev --revision feat/gitops-argocd`). One
node (four would have competed with the running cluster for the same inotify limits), so staging
and prod couldn't place their three Mongo members there; they render from the same base and
`k8s:check` holds them to prod parity. What passed:

- From nothing to dev Synced and Healthy: Argo CD, then the four add-ons from their charts, the
  platform and Argo CD's settings, then dev in its waves (data stores; mongo-init and buckets;
  migrate; the Rollouts), then the smoke test through that cluster's own Gateway.
- A new build pinned in dev on the branch: the api's canary (one pod, analysis on
  `backend-canary` Successful, 30 s pause, Healthy) and the frontend's blue-green (preview,
  pre-promotion analysis Successful, switch). Argo CD showed dev `Suspended` during the pause.
- A release whose analysis fails (dev's Rollout edited by hand to check a 404 URL): aborted after
  13 s ("Metric http-check assessed Failed"), canary pod removed, the stable pod served
  throughout; dev `OutOfSync/Degraded` (no self-heal) until a manual sync put it back.
- Self-heal: the platform's redirect status edited by hand (301 → 302) was back to 301 in 2 s.
- `k8s:promote` refusals (two steps at once; a source environment not Synced and Healthy),
  a successful dev → staging promotion, `k8s:down -- --env`, `--latest` and `k8s:pin` outside
  dev refused.

What it found:

- **Kustomize doesn't rewrite generated names inside a Rollout.** It knows where Deployments
  refer to ConfigMaps, not where a custom resource does, so the Rollouts asked for
  `backend-config` (no hash) and would never have started. `base/rollout-transform.yaml` teaches
  it the Rollout's fields, and `k8s:check` now fails when any workload refers to a ConfigMap
  that isn't rendered (it caught this, re-broken on purpose).
- **The old cleanup assumed the add-ons were installed first.** Step 4's one-time removal of
  the step-3 Gateway asked for a Gateway before Argo CD had installed the Gateway API. On a new
  cluster that kind doesn't exist yet; the cleanup now skips it.
- **The metrics-server chart selects its pods by other labels than its release manifest**, and
  a Deployment's selector can't change. Found by rendering both before switching (cert-manager's
  and Envoy Gateway's charts match their manifests exactly). `k8s:up` deletes that one
  Deployment once.
- **Pods couldn't reach GitHub, though the machine could.** Argo CD failed with "TLS handshake
  timeout" and "connection reset" on every fetch. Pods inherit the host's DNS search domain (here
  an office network's `idc.tarento.com`) with `ndots:5`, so `github.com` is first looked up as
  `github.com.idc.tarento.com`, and that network's DNS answers *every* name under its domain (a
  wildcard) with one server, which resets the TLS connection. The node resolves with `ndots:1`
  and never sees it. `k8s:up` gives Argo CD's repo server `ndots:1`. Any other pod that calls out
  (the worker's SMTP to a real mail provider, when going live) hits the same trap on such a
  network; the cluster-wide fix is a kubelet `resolvConf` without the search domain in
  `kind-config.yaml` (§8).
- **GitHub reset connections for minutes at a time** during testing. The 2-minute retry window
  for downloads (17 §2.10) wasn't enough for Argo CD's 1.9 MB manifest; it's 5 minutes now.
- **Argo CD and Argo Rollouts fought over the Services' selectors.** During a release, Rollouts
  adds `rollouts-pod-template-hash` to the selectors of the Services it switches. A selector is
  replaced as a whole, so Argo CD reported dev OutOfSync after every sync, and where it
  self-heals it would have removed the key (traffic to old and new pods alike) for Rollouts to
  add back, in a loop. The environments' Applications ignore that key
  (`ignoreDifferences` + `RespectIgnoreDifferences`).
- **An empty Application counts as Healthy.** The Application health check from Argo CD's
  documentation reported the new argo-rollouts Application Healthy before its first sync, so
  dev's wave started before the Rollout and AnalysisTemplate kinds existed (one failed attempt,
  then the retry policy recovered). The check in `argocd-cm` now also requires Synced.
- **The first Deployments run on `main` tagged prod but not staging**: both matrix jobs shared one
  concurrency group with cancel-in-progress, so one cancelled the other. The group is per
  environment now.
- **The production cluster wasn't used for testing.** The step 4 cluster holds prod's data, and
  taking it over is the user's call (§3.9 is the one-time migration it runs).

## 3. Decisions

### 3.1 Layout

```
infra/k8s/
  argocd/                     Argo CD's settings (applied once by k8s:up, then managed by Argo CD)
    argocd-cm.yaml            UI URL, 60 s polling, Kustomize load restrictor, Application health
    argocd-cmd-params-cm.yaml plain HTTP behind the Gateway, server-side diff
    repositories.yaml         Envoy Gateway's OCI Helm repository
    projects.yaml             AppProjects `platform` and `straight-salon`
    route.yaml                https://argocd.salon.localhost
  gitops/
    root.yaml                 the root Application (applied by k8s:up; not in apps/)
    apps/                     what root deploys
      addons.yaml             cert-manager, envoy-gateway, metrics-server, argo-rollouts (Helm)
      platform.yaml           platform, argocd-config
      environments.yaml       dev, staging, prod
  base/
    analysis.yaml             AnalysisTemplate http-check
    rollout-transform.yaml    Kustomize: name references inside Rollouts
    backend.yaml frontend.yaml  Rollouts (canary, blue-green) + canary/preview Services
    mongo.yaml seaweedfs.yaml migrate.yaml  Jobs as sync hooks, in waves
  platform/                   + listener and certificate name for argocd.salon.localhost
  overlays/                   unchanged in shape; dev's patches target Rollouts
```

### 3.2 Argo CD

- **v3.5.5**, non-HA install manifest, verified against its SHA-256 in `scripts/k8s.mjs` before
  it's applied. The 3.5 line has been out since July; 3.5.5 is its newest patch, released the
  same day as patches for 3.3 and 3.4 (a security fix is the usual reason). Upgrading is a new
  version and checksum there, then `npm run k8s:up`.
- **UI** at https://argocd.salon.localhost, through the shared Gateway (a listener that admits
  only the `argocd` namespace, and the name on the certificate). User `admin`, password in the
  Secret `argocd-initial-admin-secret` (`k8s:up` prints the command). No SSO: step 7.
- **Settings in git** (`argocd/`), managed by Application `argocd-config`, never pruned.
- **Kustomize flag**: `--load-restrictor LoadRestrictionsNone`, so the base can generate the
  `mongo-init` ConfigMap from `infra/docker/mongo-init.js` (shared with Compose) instead of
  `k8s:up` making it. `scripts/k8s-manifests.mjs` renders with the same flag.
- **Server-side apply and server-side diff** everywhere: some CRDs are too big for client-side
  apply's annotation, and the API server knows which fields other controllers own (Argo Rollouts
  edits the Services' selectors) so they don't show up as drift.

### 3.3 Applications and sync policies

| Application | Source | Project | automated | prune | selfHeal | Wave |
|---|---|---|---|---|---|---|
| root | `gitops/apps` | platform | yes | yes | yes | — |
| cert-manager | chart v1.21.2 | platform | yes | yes | yes | -2 |
| envoy-gateway | OCI chart v1.9.2 | platform | yes | yes | yes | -2 |
| metrics-server | chart 3.14.0 | platform | yes | yes | yes | -2 |
| argo-rollouts | chart 2.43.7 (v1.10.1) | platform | yes | yes | yes | -2 |
| platform | `platform/` | platform | yes | yes | yes | -1 |
| argocd-config | `argocd/` | platform | yes | **no** | yes | -1 |
| dev | `overlays/dev` | straight-salon | yes | yes | **no** | 0 |
| staging | `overlays/staging` | straight-salon | yes | yes | yes | 0 |
| prod | `overlays/prod` | straight-salon | yes | yes | yes | 0 |

- **Dev doesn't self-heal**, so a developer can run a local build there by hand (`--local`);
  Argo CD shows dev OutOfSync and leaves it until the next commit on `main`.
- **Prod syncs automatically**: the decision to release is the merged promotion; pressing Sync
  afterwards would be a second approval of the same thing. (Removing `automated` from prod is
  the one-line change for a team that wants that button.) `k8s:check` requires staging and prod
  to have the same policy: staging rehearses the delivery too, not only the manifests.
- **The environments ignore one field**: `rollouts-pod-template-hash` in Services' selectors,
  which Argo Rollouts owns during a release (§2.10).
- **No finalizers**: deleting an Application leaves what it deployed running. Deleting the
  cert-manager Application must not delete every certificate; deleting prod's must not delete
  the database.

### 3.4 Order

Cluster level: Applications in waves (§3.3), with Argo CD's documented health check for
Applications (off by default since v1.8) in `argocd-cm`, so a wave waits for the previous
Applications to be healthy, not just created.

Environment level:

| Wave | Objects | Kind |
|---|---|---|
| 0 | Namespace, ConfigMaps, Services, StatefulSets (mongo, redis, seaweedfs), mailpit, PDB, CronJobs, route, AnalysisTemplate | kept in sync |
| 1 | `mongo-init`, `buckets` | Sync hooks |
| 2 | `migrate` | Sync hook |
| 3 | Rollouts `backend`, `frontend`; Deployment `worker`; HPA | kept in sync |

Every Job is a hook with `BeforeHookCreation` (`k8s:check` enforces it). Every sync runs all
three again; each is idempotent, which 15 and 16 already required.

### 3.5 Releases

**api (`backend`): canary.** `canaryService: backend-canary`, `maxSurge: 1`,
`maxUnavailable: 0`, steps: `setWeight: 50` (one canary pod) → analysis `http-check` on
`backend-canary` (`/health/ready` and `/api/v1/settings/public`) → `pause: 30s` → full rollout.
The HPA now targets the Rollout (Rollouts have the scale subresource).

**frontend: blue-green.** `activeService: frontend` (what the route uses),
`previewService: frontend-preview`, `prePromotionAnalysis: http-check` on the preview,
`autoPromotionEnabled: true`, `scaleDownDelaySeconds: 60`.

**worker: Recreate** (unchanged Deployment).

**`http-check`** is a Job (curl, six rounds five seconds apart, every URL must answer 2xx each
time). It's a smoke test, not a comparison: without metrics (step 6) it can't see "slower" or
"1 % errors". Step 6 adds a Prometheus metric to the same template.

Dev keeps both strategies at one pod each: the canary is one pod next to one, the blue-green one
pod beside one.

### 3.6 Tooling (`scripts/k8s.mjs`)

| Command | Now |
|---|---|
| `k8s:up` | cluster if missing → Argo CD (checksum) → its settings, once → one-time cleanup (§3.9) → each environment's namespace and secrets → root Application → wait for the add-ons, platform and environments to be Synced and Healthy (printing each change: waves, hooks, canary steps) → remove replaced Deployments → smoke test each site. `--env <name>` waits for and tests only that one. |
| `k8s:up -- --revision <branch>` | Root (and every Application reading our repo) follows `<branch>`: try a change to the GitOps setup before merging it. Without it, back to `main`. |
| `k8s:up -- --local` | Also build this checkout's images and run them in dev by hand (Jobs in hook order, then the Rollouts' releases). |
| `k8s:up -- --latest` | Removed: CI pins every green build into dev (§3.7). |
| `k8s:pin -- --env dev <image@digest>...` | Writes digests into `overlays/dev` (what CI runs). Dev only. |
| `k8s:promote -- <from> <to>` | Refuses unless Argo CD reports `<from>` Synced and Healthy, its Rollouts run the pinned digests, and no release is in progress; edits `<to>`; you commit and merge. |
| `k8s:down -- --env <name>` | Refused: Argo CD would recreate it. Removing an environment is removing its Application from git. `k8s:down` (whole cluster) as before. |
| `K8S_CLUSTER=<name>` | Any command on a second, throwaway cluster (no host ports; smoke tests through a port-forward). |
| `k8s:render`, `k8s:diff`, `k8s:seed`, backups, restore | Unchanged. `k8s:diff` compares this checkout with the cluster; Argo CD's UI compares `main` with it. |

`k8s:up` warns when this working copy's `infra/k8s` differs from what Argo CD follows: those
changes don't deploy until they're pushed.

### 3.7 The delivery pipeline

```
push to main ─► CI: lint, tests, scans, e2e, build once, sign ─► promote: tag `main`
                                                              └► deploy-dev: k8s:pin + k8s:check,
                                                                 commit "deploy sha-… to dev" to main,
                                                                 tag the digests `dev`
Argo CD polls main (60 s) ─► dev: sync waves, hooks, canary + blue-green with analysis
npm run k8s:promote -- dev staging ─► pull request (overlay only) ─► Deployments workflow: k8s:check
  merge ─► Deployments workflow: tag `staging` ─► Argo CD deploys staging
same for staging → prod
```

- **CI skips overlay-only commits** (`paths-ignore: infra/k8s/overlays/**`). A promotion builds
  nothing: building would produce a new digest for unchanged code, CI would put it in dev, and
  dev would never again run what staging runs.
- **The deploy commit is pushed with `GITHUB_TOKEN`**, which starts no workflow (14 §2.8): no
  loop. It needs `main` to accept pushes from Actions (true today: no branch protection). With
  branch protection, allow the github-actions app to bypass it, or have the job open a pull
  request instead and merge dev promotions automatically.
- **deploy-dev skips a build that's no longer the newest** on `main` (the newer build's own run
  deploys), runs one at a time, and rebases and retries if `main` moved while it pushed.
- **Environment tags** `dev`, `staging`, `prod` in GHCR move onto what each environment pins,
  through the same signature-checked `promote-image` action. Readable ("what's in prod?") and
  protective: the weekly cleanup (14 §3.6) deletes images whose only tags are `sha-*`, which would
  leave an environment pinned to a digest that no longer exists.
- **The Release workflow** releases the images of the newest commit that changed anything but
  the overlays, since deploy commits have no images of their own.

### 3.8 `k8s:check` additions

- Every ConfigMap a workload refers to is rendered (§2.10).
- Every Job is a hook with `BeforeHookCreation`.
- Every Rollout's Services and AnalysisTemplates exist.
- Every Application: its project exists and allows its repository and destination; ours follow
  `main` and carry the label `k8s:up --revision` patches by; others pin an exact chart version; no
  finalizers.
- One Application per environment at its overlay and namespace; staging and prod sync alike;
  prod prunes and self-heals.
- Every HTTPS listener's hostname is on the certificate; `argocd-cm` renders with the same
  Kustomize flag as the scripts.

### 3.9 Moving the step 4 cluster over (one time, done by `k8s:up`)

Argo CD adopts the running objects in place: same names, same namespaces, and the add-on charts
render what their manifests did. Prod's volumes, data and secrets are untouched (StatefulSets'
pod templates don't change, so their pods don't restart). The exceptions, handled by `k8s:up`:

1. metrics-server's Deployment is deleted before Argo CD installs the chart's (immutable
   selector, §2.10). About a minute without CPU metrics; the HPAs keep their current size.
2. The fixed-name `mongo-init` ConfigMap and the Jobs `k8s:up` created are deleted; the hooks
   replace them.
3. The Rollouts start their pods next to the old Deployments' pods (both serve during the
   switch), and once Argo CD reports the environment healthy, the old Deployments are deleted.

Run `npm run k8s:up` once after merging; afterwards, `main` is what runs.

## 4. What changes in the repo

| File | Change |
|---|---|
| `infra/k8s/argocd/*`, `infra/k8s/gitops/*` | New: Argo CD settings, projects, root and child Applications |
| `infra/k8s/base/*` | Rollouts (canary, blue-green) with their Services, AnalysisTemplate, Rollout name references, Jobs as hooks, sync waves, `mongo-init` generated from git, generated ConfigMaps kept |
| `infra/k8s/overlays/dev/one-of-each.yaml` | Targets the Rollouts |
| `infra/k8s/platform/*` | Listener and certificate name for argocd.salon.localhost |
| `scripts/k8s.mjs` | Bootstrap instead of apply; `pin`; promote checks Argo CD and Rollouts; `--revision`, `--local` under GitOps; `K8S_CLUSTER`; `--latest` and `down --env` removed |
| `scripts/k8s-manifests.mjs`, `scripts/k8s-check.mjs` | Load restrictor, GitOps folders; the checks of §3.8 |
| `.github/workflows/ci.yml` | Ignore overlay-only commits; `deploy-dev` job |
| `.github/workflows/deployments.yml` | New: check overlay changes; environment tags |
| `.github/workflows/release.yml`, `ghcr-cleanup.yml` | Build commit lookup; environment tags noted |
| `package.json` | `k8s:pin` |
| `docs/specs/01`, `12`, `13`, `14`, `15`, `17`, `README.md` | Pointers, layout, revision log |

The application code does not change.

## 5. Definition of done

- [ ] `npm run k8s:check` passes, and fails for: a Rollout ConfigMap reference not rewritten, a
      Job that isn't a hook, a chart version range (verified by breaking them on purpose).
- [ ] A cluster bootstrapped from nothing (`K8S_CLUSTER=…`) ends with Argo CD reporting the
      add-ons, platform and dev Synced and Healthy, and dev's smoke test passing.
- [ ] A new build pinned in dev is released as a canary (api) and blue-green (frontend), each with
      a passing analysis; a release whose analysis fails is aborted and the stable version keeps
      serving.
- [ ] A hand edit in a self-healing Application is reverted.
- [ ] CI's `deploy-dev` job and the Deployments workflow pass on `main` after the merge.
- [ ] Lint, format and typecheck pass; `docker compose up` unchanged; specs and README updated;
      conventional commit.
- [ ] (After merging, by the user) `npm run k8s:up` moves the step 4 cluster over (§3.9), and all
      three sites answer.

## 6. Try it yourself

1. **Look around Argo CD.** Open https://argocd.salon.localhost (`admin`, password from the
   command `k8s:up` prints). Open `prod`: the tree of objects, each with sync and health. Find a
   hook (`migrate`) and the sync wave of each object. Then `kubectl -n argocd get applications`:
   the same, as objects.
2. **Self-heal.** `kubectl -n straight-salon-staging scale rollout frontend --replicas 3`. Watch
   `kubectl -n straight-salon-staging get rollout frontend -w`. What happens, and how long does
   it take? Do the same in dev. Why do the two differ, and why is that what we want?
3. **Follow a build to prod.** Merge any change to `main`. Watch CI's `deploy-dev` job commit to
   `main`, then `kubectl -n straight-salon-dev get rollout -w` (or the UI) as Argo CD picks it up:
   the canary pod, the analysis, the pause; the frontend's preview, its analysis, the switch.
   Then `npm run k8s:promote -- dev staging`, open a pull request with only that change, see which
   workflows run on it, merge, and watch staging. Finish with prod.
   `docker buildx imagetools inspect ghcr.io/vaikashmb/straight-salon-backend:prod` shows what
   prod runs.
4. **A canary that fails.** In a branch, change the http-check URL for the api to a path that
   returns 404 (`/api/v1/nope`), and run `npm run k8s:up -- --env dev --revision <branch>`
   together with a new build in dev (or `--local`). Watch the analysis fail and the Rollout
   abort: `kubectl -n straight-salon-dev get analysisrun`, `get rollout backend -o wide`. Which
   pods served traffic the whole time? Go back with `npm run k8s:up` (main).
5. **Roll back with git.** After a promotion to staging, `git revert` it, push and merge. What
   does Argo CD do, and what release strategy does the "rollback" go through? Why is that
   better or worse than `kubectl argo rollouts undo`?
6. **Orphans.** `kubectl -n straight-salon-dev create configmap by-hand --from-literal=a=b`. Find
   it in the UI (the app's orphaned resources warning). Why does Argo CD warn rather than delete
   it? Delete it.
7. **Migrations in waves.** In the UI, open the last sync of `dev` ("Sync status" → last
   operation): find the order mongo-init/buckets → migrate → Rollouts. What would happen to the
   running site if `migrate` failed? (Try it: make the migrate command `false` in a branch and
   deploy that branch with `--revision`.)
8. **Rebuild from git.** With enough memory, bootstrap a second cluster from nothing:
   `K8S_CLUSTER=rebuild npm run k8s:up -- --env dev`. Everything comes from GitHub; what had to
   be generated rather than fetched? Delete it with `K8S_CLUSTER=rebuild npm run k8s:down`. (Each
   kind node needs inotify instances: see 15 §6 if pods fail with "too many open files".)

## 7. Check your understanding

1. What's the difference between continuous delivery and continuous deployment, and which do our
   environments use?
2. Why does a pull-based tool suit a cluster on a laptop (or in a client's private network)
   better than CI running `kubectl apply`?
3. An Application is `Synced` and `Degraded`. What does that tell you, and where do you look?
4. Why do promotions not trigger CI's build, and what would go wrong if they did?
5. Why must a migration that runs before a canary work with the *old* version of the code?
6. Why does dev not self-heal while staging and prod do?
7. What does the bootstrap still do by hand, and what would it take to remove that too?
8. Why are generated ConfigMaps excluded from pruning, and what does that cost?

(Answers are discussed when we review this step.)

## 8. Known limitations (carried forward)

- **Canary weights are pod ratios** (§2.5): no traffic router, so "50 %" is one pod of two. The
  Gateway API plugin for Argo Rollouts would give exact weights through Envoy.
- **The analysis is a smoke test** (§3.5) until step 6 adds Prometheus metrics.
- **No notifications**: a failed sync or aborted release is visible in Argo CD only. Argo CD
  Notifications (Slack, email) comes with alerting in step 6.
- **Secrets still come from the bootstrap** (step 7), and Argo CD's `admin` is the only user
  (no SSO, no read-only roles).
- **Polling, no webhook** (§2.3): up to a minute between a merge and the deploy starting.
- **Generated ConfigMaps accumulate** (§2.8).
- **Rollback window**: a digest an environment no longer pins loses its environment tag, and the
  weekly cleanup deletes it after 30 days; a `git revert` further back than that pins an image
  that's gone (release tags are kept forever).
- **CI pushes to `main`**: needs no branch protection, or a bypass for github-actions (§3.7).
- **DNS search domains leak into pods** (§2.10): only Argo CD's repo server is fixed. On an
  office or VPN network with wildcard DNS, other pods that call out need the same, or the cluster
  needs a kubelet `resolvConf` without the search domain (a kind-config change, so a new cluster).
- **Argo CD is a single point of control**: if it's down, nothing deploys (what runs keeps
  running). Non-HA install, one cluster.
- Carried from earlier steps: one cluster for every environment (17 §8), no ResourceQuota, one
  worker, SeaweedFS and Redis single pods, backups inside the cluster, frontend build-time
  `NEXT_PUBLIC_SITE_URL`.
