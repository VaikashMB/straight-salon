# 16 — Stateful services: data that survives (FDE step 3)

> Third step of the Forward Deployed Engineering track (13-build-plan, "After v1", item 3).
> Same shape as specs 14 and 15: concepts (§2), decisions (§3), exercises (§6), questions (§7).
> Everything stays free and local (on the kind cluster of step 2). Decision 2026-10-13: no
> cloud account; the remaining steps run in the original order.

## 1. Goal in one paragraph

Step 2 ran MongoDB and Redis "in the simplest workable way" and kept uploads on one node's disk.
That's three ways to lose data or availability: one Mongo pod (it goes, the app goes), no
backups (a bad migration or a deleted volume loses every booking), and a node-local uploads
volume (it pins the api to one node). By the end of this step MongoDB is a **three-member
replica set with authentication**, spread over three nodes, that survives losing its primary;
it is **backed up every night** to object storage, and the backup is **restored automatically
in a drill** that proves it works; uploaded images live in **S3-compatible object storage**
(SeaweedFS), so the api runs anywhere. Redis gets the attention it needs (it holds the job
queues). And we compare all of this with handing it to a **managed service**.

## 2. Concepts

### 2.1 Stateless and stateful

The api, worker and frontend are **stateless**: any pod can be killed and replaced, because
nothing they hold matters. Databases are **stateful**: the data *is* the value. Almost every
hard problem in running software in production (and most 3 a.m. incidents) is about state:
where it lives, how many copies exist, what happens when the machine holding it dies, and
whether you can get it back. Kubernetes makes stateless apps easy and stateful ones *possible*;
this step is about the difference.

### 2.2 Managed or self-hosted: the decision you'll make at every client

| | Managed (MongoDB Atlas, AWS ElastiCache, S3) | Self-hosted (in your cluster) |
|---|---|---|
| Who handles failover, patches, backups | The provider | You |
| Cost | Pay per size and usage (free tiers are small) | "Free", paid in your time and risk |
| Control, data location | Provider's regions and rules | Wherever your cluster is |
| Typical client answer | Most teams, most of the time | Air-gapped sites, strict data-residency rules, cost at large scale |

The honest default for a production database is **managed**: replicas, failover, backups and
security patches are a full-time job. FDEs often meet clients who *can't* use managed services
(a bank's on-premise cluster, a government network with no internet), and then you run it
yourself, carefully. We self-host here because it's free and because doing it once teaches what
the managed service is doing for you. §6 includes an optional exercise against **MongoDB Atlas'
free cluster** (no credit card needed) so you can compare.

### 2.3 Replica sets: copies, elections, and the majority

A MongoDB **replica set** keeps the same data on several members. One is the **primary** (takes
all writes); the others are **secondaries** (copy the primary's operations log, the
**oplog**, and can serve reads). If the primary stops answering, the remaining members hold an
**election** and promote a secondary, usually within about ten seconds. Drivers notice and send
writes to the new primary; our app just sees a short blip.

Why **three** members and not two: an election needs a **majority** of members to agree. With
two, losing one leaves one of two (not a majority), so nobody can become primary: the database
stops accepting writes even though a copy survived. With three, losing one leaves two of three.
This "majority" idea (a **quorum**) is how almost every replicated system (etcd inside
Kubernetes too) avoids two primaries during a network split ("split brain").

**Write concern `majority`** means "only report success once most members have the write". Our
connection string sets it, so an acknowledged booking can't be lost when the primary dies a
moment later.

### 2.4 Spreading copies: failure domains, anti-affinity, disruption budgets

Three copies on one node is one copy with extra steps: the node dies, all three go. Kubernetes
spreads pods with **pod anti-affinity** ("never put two mongo pods on the same node"). In a cloud
you'd spread across **availability zones** (separate data centres) the same way. Our kind cluster
gets a **third worker node** for this.

A **PodDisruptionBudget** (PDB) protects against *planned* disruption: when you drain a node for
maintenance, Kubernetes refuses to evict a mongo pod if that would leave fewer than two running.
Unplanned failures (a node crashing) aren't stopped by a PDB; that's what the replicas are for.

### 2.5 Authentication inside the cluster

Step 2's MongoDB accepted anyone who could reach it. "It's inside the cluster" isn't a security
boundary: any compromised pod could read every customer's phone number. Now:

- members prove to each other they belong to the set with a shared **keyFile** (internal auth);
- the app connects as a **least-privilege user** (`ss_app`: read and write on the app database,
  nothing else; created by `infra/docker/mongo-init.js`, which already supports this for
  `docker-compose.auth.yml`);
- an admin user exists for operations (backups, the init Job) and nothing else uses it.

All three secrets are generated by `npm run k8s:up` like step 2's, never committed. (Encrypting
traffic *between* pods, mTLS, is a later topic.)

### 2.6 Backups, and why only a tested restore counts

A replica set is **not a backup**. If a bad migration deletes a collection, the delete is
replicated to every member within milliseconds. Replicas protect against hardware failure;
backups protect against *mistakes*, bugs and attacks.

Two numbers frame every backup design:

- **RPO** (Recovery Point Objective): how much data you can afford to lose. Nightly backups mean
  up to 24 hours of bookings.
- **RTO** (Recovery Time Objective): how long you can afford to be down while restoring.

And one rule: **a backup you have never restored is a hope, not a backup.** Backups fail
silently all the time (wrong credentials, empty archives, a format the restore tool rejects).
So we restore every backup automatically into a scratch database and compare it with the live
one: a **restore drill**. If the drill fails, you hear about it before you need the backup.

Here: a **CronJob** runs `mongodump` nightly (a logical backup: a compressed archive of every
document), uploads it to object storage, and keeps the last seven. A second CronJob restores the
newest one into `straight_salon_restore_check` and checks that every collection's document count
matches. (Managed services do continuous backups with point-in-time restore, RPO in seconds;
§2.2.)

### 2.7 Object storage

Files don't belong on a pod's disk (lost when the pod moves) or a node's disk (pins pods to that
node, what you saw in step 2). **Object storage** is the cloud-standard answer: a service that
stores files ("objects") under keys in **buckets**, over HTTP, with the **S3 API** as the de-facto
standard every provider and tool speaks. Any pod on any node can write; any browser can read a
public object straight from the storage, so the api doesn't even serve the bytes.

The usual self-hosted S3 server, MinIO, stopped publishing its free edition in October 2025 and
was archived in April 2026. We use **SeaweedFS** (Apache 2.0), a common replacement. Two buckets:
`uploads` (public read: service and stylist images) and `backups` (private).

v1 put storage behind an interface for exactly this (01 §6, `ObjectStorage`): an **S3 adapter**
replaces the local-disk one, chosen by configuration (`STORAGE_DRIVER=local|s3`), and no business
module changes. Docker Compose keeps the local adapter.

### 2.8 Redis: cache, but also queues

Redis does two jobs here (08, 09): a **cache** (lose it and reads fall back to Mongo: harmless)
and the **BullMQ job queues** (emails, reminders, stats: lose them and work is lost). The outbox
pattern (09) limits the damage: events are written to Mongo first and only marked sent once
queued, but jobs already queued and not yet processed live only in Redis.

So Redis keeps **append-only persistence** on its volume (it survives restarts), gets a PDB, and
stays at one replica. Redis replication with automatic failover (Sentinel) adds moving parts that
BullMQ handles awkwardly; a managed Redis would give it for free. Recorded as a known limit
(§8), with the reasoning, which is itself the lesson: not every component needs high
availability, but you should know which ones don't and why.

### 2.9 Operators (what you'd use at a client)

We build the replica set by hand (a StatefulSet, an init Job, a keyFile) to see the mechanics.
In practice you'd use an **operator**: a controller that adds a custom resource such as
`kind: MongoDB` with `members: 3` and runs the reconciliation loop (15 §2.1) for a database:
creating members, adding them to the set, rotating credentials, scheduling backups, upgrading
versions one member at a time. MongoDB's own is **MongoDB Controllers for Kubernetes** (it merged
the earlier community and enterprise operators); Percona's is another free option. Operators are
how Kubernetes "learns" to run stateful software. Knowing what they automate is what lets you
debug one when it misbehaves.

### 2.10 What testing found (2026-10-13)

Building this step broke things in instructive ways. Each is now handled, and each is a pattern
you'll meet again:

- **Failover, measured.** Deleting the primary pod (a polite `SIGTERM`, the primary steps down):
  new primary in about 2 s, **0** failed writes out of 373 (drivers retry a write once across
  an election), 0 failed app requests. Killing the primary's whole node without warning: new
  primary after about 7 s (the others first had to notice the silence), 1 failed write out of
  356, the slowest write waited 11.7 s. Plan for the crash, not the polite case.
- **Priority causes failback.** Giving the first member priority 2 (so it's primary while the
  init Job creates users) made it *take the primary back* every time it rejoined: an extra
  election and an extra blip. `mongo-init.js` now sets every priority back to 1 when it's done.
- **One lagging member can stall writes you didn't expect.** After the node kill, the returning
  member couldn't reach the others (below) and fell minutes behind. Index builds on a replica set
  wait for *every* voting member by default (`commitQuorum: votingMembers`), so the restore
  drill hung while rebuilding indexes. Watch replication lag, not just "is it up".
- **The laptop has limits too.** That member's node had lost pod networking: its `kube-proxy`
  failed with "too many open files". kind nodes share the host kernel's inotify limits, and four
  nodes outgrow Linux's defaults. `k8s:up` now checks them and prints the fix.
- **A disruption budget can block maintenance forever.** A budget of "never evict" on the single
  Redis pod would stop every node drain. Removed, with the reason in `redis.yaml`.
- **A drill can lie.** The first version only checked collections that still existed live, so a
  backup taken after someone dropped `users` would have *passed*. The essential collections are
  now always checked; dropping one and backing up makes the drill fail (tested).
- **A restore can leave the app wrong.** Restoring a collection directly in MongoDB bypassed the
  API's Redis cache, which kept serving the old answer (an empty category list).
  `k8s:restore` now clears the cached responses afterwards.
- **A frontend bug hiding behind timing.** New customers sometimes landed on `/login` right
  after registering. Next.js had prefetched the footer's "Your account" link while they were
  signed out, cached the sign-in redirect, and reused it after they signed up. Links to signed-in
  areas are no longer prefetched (05 §5). It looked like a rate limit at first, then like the new
  backend image; only repeating it many times against the *old* image showed it was neither.
- **Every visitor looked like one.** The API's rate limiter keys on the client IP. Behind the
  gateway's `externalTrafficPolicy: Cluster` (15 §2.5), every request arrives from the node's IP,
  so all visitors share one bucket (10 sign-ins per 15 minutes, for everyone). Locally there's
  only one client anyway; on a real cluster this would be an outage (§8).
- **Re-running the setup must be safe.** `k8s:up` failed on a second run: metrics-server's
  argument had been added with `kubectl patch`, which then "owned" that field, and server-side
  apply refused to overwrite it. The argument is now part of the manifest before it's applied.

## 3. Decisions

### 3.1 Cluster

`infra/k8s/kind-config.yaml` gains a **third worker node** (three nodes for three Mongo members;
the control-plane node doesn't take workloads). Re-create the cluster once
(`npm run k8s:down && npm run k8s:up`).

### 3.2 MongoDB

- StatefulSet `mongo`, **3 replicas**, each with its own 2 GiB volume, `--replSet rs0 --keyFile`.
  Required pod anti-affinity on the hostname (one member per node); PDB `minAvailable: 2`.
- `mongo-init` Job *(since step 4, 17 §2.10: connects through the replica set once it exists,
  and builds member names from the namespace)*: initiates the set with all three members
  (`mongo-0/1/2.mongo.straight-salon.svc.cluster.local`), creates the admin and `ss_app` users
  (`MONGO_AUTH=true`) and the backup user `ss_backup` (roles `backup`, `restore`, and `dbOwner`
  on the drill's scratch database). `infra/docker/mongo-init.js` learns a member list (env
  `MONGO_RS_MEMBERS`; the first member gets priority 2 while it sets up, then all are reset to 1,
  §2.10); its single-member default keeps Compose unchanged.
- Only `mongo-0` creates the root user on first start (the image does it from
  `MONGO_INITDB_ROOT_*`); the others must start empty so they can join and copy everything,
  users included. The keyFile comes from the Secret and is copied into place with mode 400 at
  start, because mongod refuses a keyFile anyone else can read.
- `MONGO_URI` (now in the Secret, since it holds the password):
  `mongodb://ss_app:<pw>@mongo-0.mongo…,mongo-1.mongo…,mongo-2.mongo…/straight_salon?replicaSet=rs0&authSource=straight_salon&w=majority`.
- `k8s:seed` keeps working through a port-forward to the current primary (it finds it first),
  logging in as `ss_app`.

### 3.3 Object storage (SeaweedFS)

- StatefulSet `seaweedfs`, 1 replica, `weed server -s3` (master, volume server, filer and S3
  gateway in one process), 5 GiB volume, pinned image version.
- S3 credentials (admin key for the backend and backup jobs) generated into a Secret; anonymous
  **read** on the `uploads` bucket only. Buckets created by a small Job.
- HTTPRoute: `/uploads/*` → SeaweedFS's S3 port with the bucket in the path (`/uploads/<key>`),
  so image URLs keep the same shape (`https://salon.localhost/uploads/...`). The api stops serving
  `/uploads` in the cluster and loses its uploads volume: its pods can spread across nodes again.
- One SeaweedFS pod is a single point of failure for *new uploads and backups*, not for bookings;
  a multi-node SeaweedFS (or managed S3) is the production answer (§8).

### 3.4 Backend S3 adapter (the only application code change)

- `shared/storage/objectStorage.ts`: `createS3Storage({ endpoint, region, bucket, accessKeyId,
  secretAccessKey, publicUrl, forcePathStyle })` implementing `ObjectStorage.put` with
  `@aws-sdk/client-s3` (Apache 2.0). A `createObjectStorage(env)` factory picks the adapter.
- New env (03 §3, validated in `config/env.ts`): `STORAGE_DRIVER` (`local` default | `s3`),
  `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required when
  `s3`), `S3_FORCE_PATH_STYLE` (default true). `UPLOADS_PUBLIC_URL` keeps its meaning (the public
  base URL of stored objects).
- `app.ts` serves `/uploads` only with the local driver.
- Unit tests for the factory and the S3 adapter (a fake client), and an integration test against
  a real SeaweedFS (`test/integration/storage.int.test.ts`; runs when `S3_TEST_ENDPOINT` is set,
  as CI's `test-backend` job does, skipped otherwise); coverage stays ≥ 80 % (10).
- `@aws-sdk/client-s3` pinned to a release at least two weeks old (3.1142.0).

### 3.5 Backups and the restore drill

- CronJob `mongo-backup`, daily 02:00 UTC: `mongodump --archive --gzip` as the backup user (role
  `backup`), upload to `backups/mongo/<UTC timestamp>.archive.gz`, delete all but the newest 7.
  `concurrencyPolicy: Forbid`, keeps the last 3 job runs for inspection.
- CronJob `mongo-restore-drill`, daily 03:00 UTC: download the newest archive, `mongorestore`
  it into `straight_salon_restore_check` (dropped first), then check: no document failed to
  restore; every live collection exists in the copy; the essential collections (`users`,
  `services`, `service_categories`, `staff`, `settings`) aren't empty, *even if they're gone from
  the live database too*. Counts can't be compared one to one: the live data keeps changing after
  the backup. Exits non-zero on any failure, with a table of live and restored counts (step 6
  will turn the failure into an alert). `backoffLimit: 0`: a failed drill is the signal.
- `npm run k8s:backup` and `npm run k8s:restore-drill` run them on demand
  (`kubectl create job --from=cronjob/...`).
- `npm run k8s:restore -- <archive> <collection>` puts one collection back from a named backup
  (a one-off Job; without arguments it lists the backups), then clears the API's cached
  responses in Redis (not the rate-limit counters or job queues), §2.10.

### 3.6 Redis

Unchanged apart from an explicit `--appendfsync everysec` (the default, made visible). **No**
PodDisruptionBudget: for a single pod, a budget that forbids eviction blocks every node drain
forever (§2.10).

### 3.7 The inner loop: running unpublished code

The cluster normally runs only images CI published and signed (step 1). While developing this
step, the cluster had to run code that wasn't published yet. `npm run k8s:up -- --local` builds
both images from the checkout, tags them by **content** (the image ID: a tag based on the commit
wouldn't change with uncommitted edits, and Kubernetes would keep the old image), copies them
into every kind node (`kind load docker-image`, no registry), and deploys them for that run
only; the committed digests don't change. Local images are unsigned: never for anything but
your own cluster.

### 3.8 Pre-flight checks

`k8s:up` warns when the host's inotify limits are below kind's recommendation (512 instances,
524288 watches), with the `sysctl` command to raise them (§2.10).

## 4. What changes in the repo

| File | Change |
|---|---|
| `infra/k8s/kind-config.yaml` | Third worker node |
| `infra/k8s/mongo.yaml` | 3 members, keyFile, anti-affinity, PDB; init Job with auth |
| `infra/k8s/seaweedfs.yaml` | SeaweedFS StatefulSet, Services, bucket Job |
| `infra/k8s/backup.yaml` | Backup and restore-drill CronJobs |
| `infra/k8s/backend.yaml`, `config.yaml`, `gateway.yaml` | S3 driver, no uploads volume, `/uploads` route to SeaweedFS |
| `infra/docker/mongo-init.js` | Member list (default unchanged) |
| `backend/src/shared/storage/objectStorage.ts`, `config/env.ts`, `server.ts`, `worker.ts`, seed, stats rebuild | S3 adapter, factory, env |
| `scripts/k8s.mjs`, `package.json` | Shared secrets, `--local`, inotify check, `k8s:backup`, `k8s:restore-drill`, `k8s:restore` |
| `backend/test/integration/storage.int.test.ts`, `.github/workflows/ci.yml` | S3 integration test; SeaweedFS in CI's `test-backend` |
| `frontend/src/components/layout/site-footer.tsx`, `lib/auth/roles.ts`, `proxy.ts` | No prefetch of signed-in areas (§2.10) |
| `frontend/tests/e2e/global-setup.ts` | `E2E_REDIS_CLI`: reset rate limits in the cluster's Redis |
| `docs/specs/01`, `03`, `11`, `15`, `README.md` | Pointers, env vars, revision log |

## 5. Definition of done

- [ ] `npm run k8s:up` on a fresh cluster: three Mongo members on three nodes, all pods ready.
- [ ] Killing the primary pod: a new primary within ~15 s, bookings keep working (e2e suite passes
      with a primary kill in the middle).
- [ ] Uploading a service image in the admin stores it in SeaweedFS and it displays; api pods run
      on more than one node.
- [ ] `npm run k8s:backup` then `npm run k8s:restore-drill` succeed; deleting a collection on
      purpose makes the drill fail.
- [ ] MongoDB rejects unauthenticated connections.
- [ ] Backend tests pass with coverage ≥ 80 %; lint and typecheck pass; `docker compose up` works
      unchanged.
- [ ] Specs and README updated; conventional commit.

## 6. Try it yourself

1. **Who's primary?** Without a login, MongoDB refuses: try
   `kubectl exec mongo-0 -c mongo -- mongosh --quiet --eval 'rs.status()'`. Then with the root
   password (README, "Run on Kubernetes" has the full command). Note which node each member is on
   (`kubectl get pods -o wide`).
2. **Kill the primary.** Delete the primary's pod while a booking loop runs, and run `rs.status()`
   again a few seconds later. Who won the election? How long did writes fail?
3. **Lose the majority.** Scale the StatefulSet to 1 (`kubectl scale statefulset mongo --replicas=1`).
   Can the app still write? Read the member states: why is the survivor not primary? Scale back
   to 3.
4. **A backup is not a replica.** Take a backup (`npm run k8s:backup`), then drop the
   `service_categories` collection on the primary. Watch it vanish from *every* member, and the
   site's service menu empty. Put it back: `npm run k8s:restore` (lists the backups), then
   `npm run k8s:restore -- <archive> service_categories`.
5. **Make the drill fail.** Drop `service_categories` again, take a backup, run
   `npm run k8s:restore-drill`: it fails, and the table shows `MISSING`. That's the alarm you want
   *before* you need the backup. Restore the collection, back up, and the drill passes.
6. **Drain a node.** `kubectl drain <node of one member> --ignore-daemonsets --delete-emptydir-data`.
   The PDB lets one mongo pod go (`kubectl get pdb mongo`: allowed disruptions drops to 0), and
   draining a second member's node is refused ("would violate the pod's disruption budget"). The
   evicted member stays `Pending`: its volume lives on the drained node. `kubectl uncordon` both
   afterwards and watch it rejoin.
7. **Object storage.** Upload a service image in the admin, then find it:
   `kubectl exec deploy/seaweedfs-… -- weed shell` or list the bucket with the README's
   `aws s3 ls --endpoint-url` command over a port-forward. Open its URL directly.
8. **Optional: managed.** Create a free MongoDB Atlas cluster (no card needed), point a local
   Compose backend at it (`MONGO_URI` in `.env`), seed it, and compare: what did you *not* have to
   set up?

## 7. Check your understanding

1. Why does a replica set need three members rather than two to keep accepting writes when one
   fails?
2. What does `w=majority` protect against, and what does it cost?
3. Our database is replicated three times. Why do we still need backups?
4. What are RPO and RTO for our setup, and what would shrink each?
5. Why is "it's only reachable inside the cluster" not enough reason to skip database auth?
6. Losing Redis would lose some work. Which work, and why did we still not make Redis highly
   available?
7. What does an operator do that our hand-built StatefulSet doesn't?

(Answers are discussed when we review this step.)

## 8. Known limitations (carried forward)

- **SeaweedFS is a single pod**: new uploads and backups stop while it's down (bookings don't).
  Multi-node SeaweedFS or managed S3 in production.
- **Backups live in the same cluster** as the data. A real setup copies them off-site (another
  region or provider: the "3-2-1" rule). Free and local, we can't, and §6 says so.
- **Redis has no failover** (§2.8).
- **No point-in-time restore**: RPO is up to 24 h. Continuous oplog backups (or a managed service)
  shrink it to seconds.
- **No TLS between pods** (later topic, service mesh or MongoDB TLS).
- **Client IPs are lost at the gateway** (§2.10): the rate limiter sees one IP for everyone. A
  real cluster needs `externalTrafficPolicy: Local` (or the PROXY protocol) so Envoy sees the
  visitor, and the backend's `trust proxy` set to the actual number of hops (Envoy and the
  frontend: 2 in the cluster, 1 in Compose), made configurable.
- **Node restarts on kind** can break pod networking when the host's inotify limits are low
  (§2.10, §3.8).
- Carried from step 2: secrets base64 in the cluster (step 7), one worker, frontend build-time
  config (step 10).
