# 15 — Kubernetes basics (FDE step 2)

> Second step of the Forward Deployed Engineering track (13-build-plan, "After v1", item 2).
> Same shape as spec 14: concepts (§2) before decisions (§3), then things to run yourself (§6)
> and questions to check yourself (§7). Builds on 14: we run the images it publishes, by digest.

## 1. Goal in one paragraph

Today the whole stack runs on one machine through Docker Compose. By the end of this step it
runs on a **Kubernetes** cluster: a local, three-node cluster made with **kind** on your laptop,
reached in the browser at `https://salon.localhost`. The api, worker and frontend run the signed
images from GHCR pinned by digest; Kubernetes restarts what crashes, holds back traffic from
what isn't ready, drains pods gently on shutdown, scales the api with load, and runs database
migrations as a one-off Job. MongoDB and Redis run in the cluster in the simplest workable way;
running them properly is step 3.

## 2. Concepts

### 2.1 Why an orchestrator: desired state

Compose starts containers in an order and then mostly watches. Kubernetes works differently: you
**declare the state you want** ("three frontend containers of this image, each with 256 MiB")
and **controllers** run a loop forever: look at what is, compare it with what should be, act on
the difference. A crashed container, a lost node, a too-small replica count: each is just a
difference the loop closes. This **reconciliation loop** is the one idea everything else in
Kubernetes builds on, and it's why you change a cluster by editing declarations (YAML, kept in
git), not by running commands against servers.

### 2.2 The cluster: control plane and nodes

- The **control plane** holds the desired state (in **etcd**, a key-value store), exposes it
  through the **API server** (everything, `kubectl` included, talks to that API), and runs the
  controllers and the **scheduler** (which picks a node for each new pod).
- **Nodes** are the machines that run workloads. On each, the **kubelet** starts the containers
  the control plane assigned to it and reports back.

**kind** ("Kubernetes in Docker") runs each node as a Docker container on your laptop. It is
real, conformant Kubernetes: everything here works the same on EKS, GKE or AKS later; only the
networking at the edge and the storage differ. We use one control-plane node and two worker
nodes, so you can see the scheduler spread pods and see what happens when a node disappears.

### 2.3 Pods, Deployments, ReplicaSets, labels

- A **Pod** is the unit Kubernetes runs: one or more containers sharing a network address and
  volumes. Pods are disposable; you almost never create one directly.
- A **Deployment** says "keep N pods of this template running". It manages a **ReplicaSet** per
  version of the template, and on an image change it does a **rolling update**: start new pods,
  wait until they're ready, stop old ones, so there is no downtime.
- **Labels** (`app.kubernetes.io/name: backend`) are how things find each other: a Deployment
  owns the pods matching its **selector**, a Service sends traffic to pods matching its selector.

Our api and worker are one image with two commands (01 §1): two Deployments, same image,
different `command`, scaled independently. That split, made in v1, pays off here.

### 2.4 Services and DNS

Pod IPs change every time a pod is replaced. A **Service** gives a set of pods one stable name
and virtual IP, and load-balances across the ready ones. Inside the cluster the name resolves
through DNS: from the frontend pod, `http://backend:4000` reaches a ready api pod, exactly as
the Compose service name did. (Full name: `backend.straight-salon.svc.cluster.local`.)

### 2.5 Getting traffic in: Gateway API (and why not Ingress)

Services are internal. Something at the edge has to accept browser traffic and route it in.
For years that was the **Ingress** API, usually implemented by **ingress-nginx**. The Kubernetes
project **retired ingress-nginx in March 2026** (no more fixes, including security fixes) and
recommends the **Gateway API**, the newer, more expressive standard. You will meet Ingress at
clients for years, so it's worth knowing it exists, but new work uses Gateway API.

Gateway API splits the job by role, which matters when a platform team and an app team share a
cluster (a common FDE situation):

| Resource | Who owns it | Says |
|---|---|---|
| `GatewayClass` | the cluster's platform team | "Envoy Gateway implements gateways here" |
| `Gateway` | platform team | "listen on 443 for `salon.localhost`, with this certificate" |
| `HTTPRoute` | the app team | "`/uploads` → backend, everything else → frontend" |

A Gateway API **implementation** does the actual proxying; we use **Envoy Gateway** (the Envoy
proxy, which also powers many service meshes and cloud load balancers).

**`externalTrafficPolicy`, learnt the hard way.** Envoy's Service is a `NodePort` here (kind has
no cloud load balancer), and kind maps the host's ports to the control-plane node. Envoy
Gateway sets `externalTrafficPolicy: Local` by default: a node only answers if an Envoy pod runs
**on that node**. Ours ran on a worker, so every request hung. `Local` keeps the visitor's real
IP and saves a hop, and a cloud load balancer copes by health-checking nodes; `Cluster` lets any
node accept and forward, but the app sees a node's IP instead of the visitor's. We use
`Cluster`. The same choice shows up on every cloud cluster, usually when someone asks why the
logs show the wrong client IPs.

### 2.6 TLS, and why this app needs it even locally

In production mode the backend marks its refresh-token cookie `Secure` (06, `COOKIE_SECURE`
defaults to true when `NODE_ENV=production`), and browsers only send `Secure` cookies over
HTTPS. Over plain http, sign-in would succeed and then forget you. So the cluster serves HTTPS.

**cert-manager** is the standard Kubernetes way to get certificates: you declare a
`Certificate` and it obtains and renews it. In production it talks to Let's Encrypt; locally we
make our own small certificate authority (a self-signed `ClusterIssuer` creates a CA, a CA
`ClusterIssuer` signs `salon.localhost`). Your browser will warn once, because it doesn't trust
our CA; §6 shows how to trust it, and how that's exactly the step a client's corporate CA would
replace.

### 2.7 Configuration: ConfigMaps and Secrets

The environment variables Compose took from `.env` become two objects:

- a **ConfigMap** for plain settings (`NODE_ENV`, `REDIS_URL`, `APP_BASE_URL`, …);
- a **Secret** for credentials (`JWT_ACCESS_SECRET`, `OUTBOX_ENCRYPTION_KEY`, …).

Important: a Secret is only **base64-encoded**, not encrypted. Anyone who can read it in the
API can decode it, and it must never be committed to git. Here the secret values are generated
on your machine when the cluster is created and never written to the repo. Proper secret
management (Vault, External Secrets, encryption at rest) is FDE step 7; knowing that a Secret
isn't secret is the first lesson of it.

### 2.8 Health probes: the endpoints v1 built for this

Kubernetes asks each container three different questions:

| Probe | Question | On failure | Our endpoint |
|---|---|---|---|
| **startup** | "Have you finished starting?" | keep waiting (up to a limit), then restart | `/health/live` |
| **liveness** | "Are you stuck?" | **restart** the container | `/health/live` (process is up, no dependency checks) |
| **readiness** | "Should you get traffic now?" | **remove from the Service** (no restart) | `/health/ready` (Mongo up; 503 otherwise) |

Getting these wrong is one of the most common production incidents: if liveness checked Mongo,
a database blip would make Kubernetes restart **every** api pod at once, turning a short outage
into a long one. That's why v1 made liveness dependency-free, and why Redis being down only
makes readiness "degraded" (still 200: reads fall back to Mongo, 08 §5).

The worker has no HTTP server, so it gets no HTTP probes; Kubernetes still restarts it if the
process exits. (A liveness file the worker touches on each loop would catch a stuck worker;
recorded in §8.)

### 2.9 Graceful shutdown

When a pod is removed (rolling update, scale-down, node drain), Kubernetes sends `SIGTERM`, waits
`terminationGracePeriodSeconds`, then kills it. v1 already handles `SIGTERM`: readiness switches
to `shutting_down` (503), in-flight requests finish, connections close within 10 s (01 §6).

One subtlety: removing a pod from the Service and sending it `SIGTERM` happen **at the same
time**, and the routing layers take a moment to notice. A pod that stops accepting connections
instantly can still receive a few requests and fail them. The usual fix is a short `preStop`
sleep (a few seconds) so routing catches up before the app begins shutting down.

### 2.10 Resources, QoS, autoscaling

Each container declares **requests** (what the scheduler reserves for it on a node) and
**limits** (the ceiling). Over its memory limit, a container is killed (`OOMKilled`); over its
CPU limit, it's slowed down (throttled). Setting requests is how the scheduler packs nodes
sensibly; setting them badly is how a node runs out of memory.

A **HorizontalPodAutoscaler** (HPA) adds or removes api pods to hold average CPU near a target.
It needs **metrics-server** to read pod CPU usage; we install it.

### 2.11 Jobs: one-off work, and "there is no depends_on"

A **Job** runs pods until they complete successfully once. Two here: initialising the MongoDB
replica set (Compose's `mongo-init`), and running **database migrations** before the new api
version serves traffic. In production the api doesn't migrate on startup (`MIGRATE_ON_START`
defaults to false, 03 §3): with several replicas starting at once, each would try to migrate.
One Job, run once per release, does it.

Kubernetes has **no `depends_on`**: everything starts at once, and anything that needs a
dependency must cope with it not being there yet. You'll see exactly that on a fresh cluster:
the api and worker start before MongoDB exists, fail to connect, **exit**, and the kubelet
restarts them with growing delays (`CrashLoopBackOff`) until Mongo answers; then they stay up.
A few restarts at first boot are normal, not a fault. Once running, a lost database doesn't
crash them: readiness turns 503 and the pods only leave the Service (§2.8). An **init
container** (runs to completion before the main container starts) is the tool when a container
truly must wait, and we use one for the migration Job (wait for the replica-set primary).

### 2.12 State: StatefulSets and volumes

Pods are disposable; data must not be. A **PersistentVolumeClaim** (PVC) asks for storage that
outlives pods. A **StatefulSet** is a Deployment for stateful apps: stable pod names
(`mongo-0`), and each pod keeps its own volume across restarts.

We run MongoDB (single-member replica set) and Redis each as a one-replica StatefulSet. That's
fine for learning and wrong for production (one pod, no backups, no failover); step 3 compares
doing it properly in-cluster against managed services (MongoDB Atlas, managed Redis).

Uploaded images (local ObjectStorage adapter, API-027) sit on a PVC too, and that exposes a real
design limit: kind's volumes live on one node and are `ReadWriteOnce` (one **node** may mount
it, not one pod). Every api pod that wants the uploads volume must therefore run on that one
node. It works, but it pins the api to a node, which is exactly why v1 put storage behind an
interface: the real fix is object storage (S3 or MinIO), step 3.

### 2.13 Namespaces and digests

Everything lives in one **namespace**, `straight-salon`: a folder for names, permissions and
quotas, and the unit you delete to start over. Images are referenced **by digest** (14 §2.2):
the manifests name `straight-salon-backend@sha256:…`, the digest `main` pointed at when you
deployed, so every pod in the cluster runs the same bytes, and a moved tag never changes a
running cluster behind your back.

## 3. Decisions

### 3.1 Cluster

- **kind**, pinned version, config in `infra/k8s/kind-config.yaml`: one control-plane and two
  worker nodes, cluster name `straight-salon`. Host ports 80 and 443 on `127.0.0.1` map into the
  cluster's edge (the Gateway's service), so `https://salon.localhost` works without a cloud
  load balancer. (On a cloud cluster the Gateway would get a `LoadBalancer` address instead.)
- Prerequisites, installed once (README): `kind` and `kubectl`, pinned versions. Helm is **not**
  needed in this step: third-party components install from their pinned release manifests.
- Cluster add-ons, pinned: Gateway API CRDs + **Envoy Gateway**, **cert-manager**,
  **metrics-server** (with `--kubelet-insecure-tls`, needed on kind because kubelet certificates
  aren't signed for metrics-server; never on a real cluster).

### 3.2 Workloads (namespace `straight-salon`)

| Name | Kind | Replicas | Image | Notes |
|---|---|---|---|---|
| `mongo` | StatefulSet + headless Service | 1 | `mongo:8.2` | `--replSet rs0`, 2 GiB PVC |
| `mongo-init` | Job | — | `mongo:8.2` | runs `infra/docker/mongo-init.js` (from a ConfigMap), same as Compose |
| `redis` | StatefulSet + Service | 1 | `redis:7.4-alpine` | `--appendonly yes`, 1 GiB PVC |
| `mailpit` | Deployment + Service | 1 | `axllent/mailpit:v1.31` | SMTP for the worker; UI through `kubectl port-forward` |
| `migrate` | Job | — | backend, by digest | `node dist/db/runMigrations.js`; init container waits for the replica set |
| `backend` | Deployment + Service + HPA | 2–4 | backend, by digest | probes §2.8, `preStop` sleep, uploads PVC |
| `worker` | Deployment | 1 | backend, by digest | `node dist/worker.js` (relay runs inside, `RUN_RELAY_IN_WORKER`) |
| `frontend` | Deployment + Service | 2 | frontend, by digest | `API_INTERNAL_URL=http://backend:4000` |

The worker stays at one replica in this step: the outbox relay runs inside it, and running
several relays at once hasn't been designed for (09). For the same reason its rollout strategy
is `Recreate` (stop the old pod, then start the new one) instead of a rolling update, which
would briefly run two. Scaling consumers separately from the relay (`relay.ts` is its own
entrypoint) is a later change.

The backend Deployment has **no `replicas:` field**: the HPA owns the count, and a value in the
manifest would reset the HPA's choice on every apply.

Every container: requests and limits (starting from the Compose limits), runs as the image's
non-root user, `readOnlyRootFilesystem` where the image allows it.

### 3.3 Edge

- `GatewayClass` `envoy`, `Gateway` `salon` listening on 443 (HTTPS, certificate from
  cert-manager) and 80 (redirects to HTTPS).
- `HTTPRoute`: host `salon.localhost`; `/uploads` → `backend:4000`; `/` → `frontend:3000`
  (the frontend already forwards `/api/*` to the backend inside the cluster, 05 §5, so the API is
  same-origin and needs no CORS).
- `APP_BASE_URL=https://salon.localhost`, `UPLOADS_PUBLIC_URL=https://salon.localhost/uploads`.
- Known gap carried from 14 §8: the frontend image has `NEXT_PUBLIC_SITE_URL` baked in
  (`http://localhost:3000`), so share-image URLs point at the wrong host. Pages work; only link
  previews are affected. Fixed by FDE step 10's work on build-time config.

### 3.4 Configuration and secrets

- `ConfigMap` `backend-config`: all non-secret backend variables.
- `Secret` `backend-secrets`: `JWT_ACCESS_SECRET`, `OUTBOX_ENCRYPTION_KEY` (and any other
  secret the env schema requires), generated with random values by the setup script at cluster
  creation, never written to the repo or to disk.
- Mongo without auth inside the cluster in this step (like the Compose default); turning on auth
  is part of step 3.

### 3.5 Manifests and how they're applied

- Plain YAML in `infra/k8s/`, one file per component, applied with
  `kubectl apply --server-side -k infra/k8s`. **Server-side apply**: the API server merges the
  change and records which tool owns which field, so re-applying an unchanged manifest really
  changes nothing (the older client-side apply reported StatefulSets as "configured" every
  time).
  The `kustomization.yaml` only lists the files and sets the two image digests (its `images:`
  field), so pinning a new digest is one edit. Overlays for dev/staging/prod, and the choice
  between Kustomize and Helm, are step 4.
- `npm run k8s:up`: creates the kind cluster (if missing), installs the add-ons and waits for
  them, creates the Secret (once; kept on re-runs), loads `mongo-init.js` into a ConfigMap,
  replaces the previous migration Job (a Job's template is immutable), applies everything,
  waits for the rollout, and prints the URL. It deploys the digests **committed** in
  `kustomization.yaml`. `npm run k8s:up -- --latest` first moves them to what `main` points at
  (signature checked with cosign when installed) and rewrites the file, so the change shows up
  in `git diff`: the deployed version is a decision recorded in git, the core idea of GitOps
  (step 5). `npm run k8s:down` deletes the cluster.
- `npm run k8s:seed`: demo data. The production image refuses to seed (03 §3), so like the CI
  e2e job it runs from your machine: `kubectl port-forward` to `mongo-0` (local port 27018) and
  Redis (6380), then `npm run db:seed` with the cluster's Secret values (the outbox key must be
  the worker's) and `directConnection=true` (the replica set advertises a cluster-internal name
  your machine can't resolve).
- The Playwright e2e suite runs against the cluster:
  `E2E_BASE_URL=https://salon.localhost E2E_IGNORE_HTTPS_ERRORS=true E2E_RESET_RATE_LIMITS=false npm run test:e2e`
  (`E2E_IGNORE_HTTPS_ERRORS` accepts the local CA; the rate-limit reset only knows the Compose
  Redis).

## 4. What changes in the repo

| File | Change |
|---|---|
| `infra/k8s/kind-config.yaml` | Cluster: 1 control plane + 2 workers, ports 80/443 |
| `infra/k8s/*.yaml` | Namespace, data services, jobs, app workloads, config, edge, certificates |
| `infra/k8s/kustomization.yaml` | File list + image digests |
| `scripts/k8s.mjs`, root `package.json` | `k8s:up`, `k8s:down`, `k8s:seed` |
| `frontend/playwright.config.ts`, `tests/e2e/global-setup.ts` | Opt-in `E2E_IGNORE_HTTPS_ERRORS` |
| `docs/specs/11`, `12`, `README.md` | Pointers, prerequisites, "Run on Kubernetes" section, revision log |

The application code does not change.

## 5. Definition of done

- [ ] `npm run k8s:up` on a clean machine (with kind and kubectl) ends with all pods ready and
      prints `https://salon.localhost`.
- [ ] In the browser: home page, sign in as a demo customer (after `k8s:seed`), book, see the
      booking under My bookings, see the confirmation email in Mailpit.
- [ ] Deleting an api pod: the Service keeps answering, the Deployment replaces the pod.
- [ ] A rolling update (new digest) causes no failed requests during a simple load loop.
- [ ] Load raises the backend HPA above 2 replicas, and it scales back down afterwards.
- [ ] `docker compose up` still works (untouched).
- [ ] Specs and README updated; conventional commit.

## 6. Try it yourself

Run these after `npm run k8s:up`. `kubectl` defaults to the cluster kind just made; add
`-n straight-salon` (or run `kubectl config set-context --current --namespace straight-salon`
once).

1. **Look around.** `kubectl get nodes -o wide`, `kubectl get pods -o wide` (which node did each
   pod land on? where are all the backend pods, and why? §2.12), `kubectl get svc,gateway,httproute`.
2. **Self-healing.** In one terminal `kubectl get pods -w`; in another
   `kubectl delete pod <one backend pod> --wait=false`. Watch the Deployment replace it. Keep
   `while true; do curl -sk -o /dev/null -w '%{http_code}\n' https://salon.localhost/api/v1/settings/public; sleep 0.25; done`
   running meanwhile: does it ever fail? (Keep the `sleep`: the API allows 300 requests a
   minute per client, and a tighter loop just measures the rate limiter, 429.)
3. **Readiness vs liveness.** `kubectl scale statefulset mongo --replicas=0`. Watch the backend
   pods go `0/1` (not ready) **without restarting** (`RESTARTS` stays put), and the site return
   errors. Scale Mongo back to 1 and watch them become ready again. Now explain what would have
   happened if liveness checked Mongo.
4. **Rolling update.** `kubectl rollout restart deployment backend`, then
   `kubectl rollout status deployment backend`. Then `kubectl rollout history deployment backend`
   and `kubectl rollout undo deployment backend`.
5. **A Secret isn't secret.**
   `kubectl get secret backend-secrets -o jsonpath='{.data.JWT_ACCESS_SECRET}' | base64 -d`.
6. **Autoscaling.** `kubectl get hpa -w` in one terminal; in another, start load from inside
   the cluster (the health endpoints aren't rate-limited, and each readiness call pings Mongo):
   `kubectl create deployment load --image=busybox:1.37 --replicas=8 -- sh -c 'while true; do wget -qO /dev/null http://backend:4000/health/ready; done'`.
   Watch replicas rise to 4 (and note which node all four land on). Then
   `kubectl delete deployment load` and watch them fall back to 2, slowly on purpose: scale-down
   waits five minutes to avoid flapping.
7. **Lose a node.** `docker stop straight-salon-worker2` (a kind node is a container). Watch pods
   on it go away and get rescheduled (`kubectl get pods -o wide -w`). It takes about a minute
   before Kubernetes gives up on the node: why wait at all? `docker start` it afterwards.
8. **Inside the cluster.** `kubectl exec deploy/frontend -- wget -qO- http://backend:4000/health/live`
   (the Service name works from any pod), and `kubectl logs deploy/worker -f` while you make a
   booking (the outbox relay and consumers at work).

## 7. Check your understanding

1. What is the difference between a liveness and a readiness probe, and why must our liveness
   probe not check MongoDB?
2. The api pods all run on one node. Why, and what change makes that go away?
3. You change the backend image digest in the kustomization and apply. List what Kubernetes does,
   in order, until the rollout finishes.
4. Why does the migration run as a Job instead of when each api pod starts?
5. A colleague says "the JWT secret is safe, it's in a Kubernetes Secret". What do you answer?
6. Why does the cluster need HTTPS even on your laptop?
7. What does the `preStop` sleep protect against?

(Answers are discussed when we review this step.)

## 8. Known limitations (carried forward)

- **Mongo and Redis**: single pod each, no auth, no backups (step 3).
- **Uploads on a node-local volume** pins the api to one node (§2.12; object storage, step 3).
- **Secrets** are base64 in the cluster, generated per machine (step 7).
- **One worker**, relay inside it (§3.2).
- **No worker liveness check** (§2.8).
- **Frontend build-time config** (`NEXT_PUBLIC_SITE_URL`, 14 §8; step 10).
- **Local only**: a cloud cluster adds a real load balancer, DNS and Let's Encrypt (later steps).
