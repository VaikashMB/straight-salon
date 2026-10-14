# 14 — Container registry and image hygiene (FDE step 1)

> First step of the Forward Deployed Engineering track (13-build-plan, "After v1", item 1).
> Each FDE spec has two jobs: say **what** we build (the decisions, §3) and teach **why** (the
> concepts, §2). Read §2 before §3. §6 has things to run yourself, §7 questions to check
> yourself.

## 1. Goal in one paragraph

Today CI builds the backend and frontend images, scans them, and throws them away
(`push: false`). Nothing outside a laptop can run Straight Salon. By the end of this step every
merge to `main` publishes both images to the **GitHub Container Registry (GHCR)**, each with an
exact name, a list of what's inside (**SBOM**), a record of how it was built (**provenance**) and
a **signature** anyone can verify, and every release is a set of new tags on those same images,
never a rebuild. Every later step (Kubernetes, Helm,
Argo CD) starts by pulling these images, so this step is the foundation.

## 2. Concepts

### 2.1 What a registry is

An image is a stack of read-only file layers plus a small JSON **config** (entrypoint, env,
user). A **registry** is a server that stores those layers and hands them out over HTTPS: you
`push` to it and every server you deploy to `pull`s from it. Docker Hub, GHCR, AWS ECR, Google
Artifact Registry and Azure ACR all speak the same open protocol (the OCI Distribution spec),
so the tools are the same everywhere; only login differs.

Why it matters for an FDE: at a client you rarely choose the registry. The client already has
ECR or ACR, often a private one that can't reach the internet. Knowing the protocol, rather
than one vendor's console, is what lets you move between them.

We use **GHCR** because the code is already on GitHub: Actions can push with its built-in
`GITHUB_TOKEN` (no password to store), and public packages are free.

### 2.2 Tags, digests, and why "latest" is dangerous

An image has two kinds of names:

| Name | Example | Can it change? |
|---|---|---|
| **Tag** | `ghcr.io/vaikashmb/straight-salon-backend:1.2.0` | Yes. A tag is a movable pointer, like a git branch. |
| **Digest** | `…-backend@sha256:4f1c…` | Never. It is the hash of the image's manifest, like a git commit SHA. |

If you deploy `:latest` and someone pushes a new `latest`, the next server that restarts runs
different code from the others, and nobody changed the deployment. That is how "it worked
yesterday" incidents happen. Rule: **humans read tags, machines deploy digests.** Later steps
(Helm values, Argo CD) will pin digests.

### 2.3 Build once, promote everywhere

The image that passed the tests must be the exact image that runs in staging and production.
You never rebuild for production: a rebuild can pull a newer base image or dependency and give
you something nobody tested. Different environments get different **configuration** (env
vars, secrets) on top of the **same image**. This is the 12-factor "config in the environment"
rule, applied to deployment.

In a pipeline this becomes **promotion**: an image is built once and given an immutable name
(`sha-<commit>`); each gate it passes (scan, tests, e2e, a release decision) adds a tag to the
**same digest** (`main`, then `1.2.3`). Moving a tag by digest is instant and copies nothing,
and the SBOM, provenance and signature stay valid because they belong to the digest, not to a
tag.

A consequence: the version an image "is" becomes a deployment fact. The image only knows its
commit (`0.0.0+sha.<commit>` in `APP_VERSION`, plus the `revision` label); a release is a tag
added later, and a deployment that wants logs to say `1.2.3` sets `APP_VERSION=1.2.3` in the
environment (the backend reads it at runtime, 03 §3).

Straight Salon breaks this rule in one place, on purpose for now: the frontend bakes
`NEXT_PUBLIC_*` values (app name, site URL, country code) into the JavaScript at build time
(05 §8). One frontend image therefore serves one site address. That is fine for one salon, but
it is exactly the problem FDE step 10 (a second salon as a client) has to solve. It's recorded
in §8 as a known limitation, not fixed here.

### 2.4 Tagging strategy

Every published image gets several tags that point at the same digest:

| Tag | Pushed when | What it is for |
|---|---|---|
| `sha-<7 chars>` | when the image is built on `main` (before the tests finish) | The build itself, a **candidate**. Traceability from a running container straight to the commit. Never moves. Pruned after 30 days. |
| `main` | promoted once every CI check on that commit has passed | "Newest code that passed CI." Staging can follow it. Moves on every green merge. |
| `1.2.3` | promoted from the released commit's image | The exact release. Never moves (semver tags are never re-pushed). Kept forever. |
| `1.2`, `1` | same | "Latest patch of 1.2", "latest 1.x". Move on each release in that line. |
| `latest` | same | Only for people trying the app by hand. **Never used by our deployments.** |
| `dev`, `staging`, `prod` | when that environment's overlay pins the digest on `main` (18 §3.7) | "What this environment runs." Readable by people; deployments still pin the digest. Keeps the image from the 30-day cleanup while it's deployed. Moves on every deploy. |

Pull requests build and scan images but do not push: code from a PR has not been reviewed, and
a PR from a fork must never get write access to the registry.

### 2.5 SBOM: the ingredients list

A **Software Bill of Materials** lists every package inside the image (Alpine packages, every
npm package with its version and licence). When a new vulnerability is announced ("everything
with library X below 2.4 is affected"), you query the SBOMs of what is running instead of
guessing. Clients in regulated sectors (banks, health, government) increasingly require one
for anything you deploy.

Docker Buildx can generate it during the build and attach it to the image in the registry as an
**attestation** (in SPDX format). Nothing extra to store or keep in sync.

### 2.6 Provenance: how was this built?

**Provenance** answers "which repository, which commit, which workflow, which build steps
produced this exact digest?". It's a signed statement attached to the image, following the
**SLSA** framework (Supply-chain Levels for Software Artifacts). It protects against an image
that was built on someone's laptop, from changed code, and pushed under a real-looking tag.
Buildx attaches it too (`provenance: mode=max`).

### 2.7 Signing, and why "keyless"

A signature proves the image came from us and was not swapped in the registry. Classic signing
means owning a private key: storing it, rotating it, and losing sleep about it leaking.

**Keyless signing** with **cosign** (part of the **Sigstore** project) removes the key:

1. The GitHub Actions job asks GitHub for an **OIDC token**: a short-lived, signed statement
   saying "I am the workflow `ci.yml` of repo `VaikashMB/straight-salon`, running on `main`".
2. Sigstore's certificate authority (**Fulcio**) checks that token and issues a certificate
   valid for 10 minutes, bound to that identity.
3. cosign signs the image digest with a throwaway key and records the signature in a public,
   append-only log (**Rekor**), so nobody can quietly back-date or delete it.

To verify, you don't ask "is this signed with our key?" but "was this signed by **this
workflow** in **this repo**?":

```sh
cosign verify ghcr.io/vaikashmb/straight-salon-backend:main \
  --certificate-identity-regexp '^https://github.com/VaikashMB/straight-salon/\.github/workflows/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Later, a Kubernetes admission policy (FDE step 9) runs that same check and refuses to start any
unsigned image.

### 2.8 A GitHub Actions trap: tokens that don't trigger workflows

Our Release workflow creates the `v*` tag with the built-in `GITHUB_TOKEN`. GitHub
**deliberately does not start other workflows** for events made with that token, to prevent
endless loops. So an "on: push tags v*" publish workflow would never run. The fix used here:
publish inside the Release workflow itself, as a job that runs after semantic-release and reads
the version it produced. Knowing why a pipeline silently didn't run is a large part of
day-to-day FDE work.

### 2.9 Where the gate is

"Scan before you push" sounds right, but it would mean building twice (once to scan locally,
once to push with attestations) and hoping both builds match. We push the one build first, as a
candidate nobody deploys, and put the gates after it, on the exact pushed bytes:

```
build once ──► push sha-abc1234 ──► pull by digest ──► Trivy ──► sign ──► (tests, e2e) ──► tag main
                 candidate                              scan     "we vouch"                promoted
```

A candidate that fails its scan stays an unsigned `sha-` image and is never promoted; the
cleanup removes it. Deployments only ever follow promoted tags (or digests copied from them),
and promotion refuses an unsigned image. Being in the registry is not the gate; being signed
and promoted is.

## 3. Decisions

### 3.1 Images and names

| Image | Built from | Used by |
|---|---|---|
| `ghcr.io/vaikashmb/straight-salon-backend` | `backend/Dockerfile`, target `runtime` | api, worker (same image, different command) |
| `ghcr.io/vaikashmb/straight-salon-frontend` | `frontend/Dockerfile`, target `runtime` | frontend |

Registry paths must be lowercase, hence `vaikashmb`. Packages are **public**, the same as the
repository, so pulling needs no login. Each image carries the standard OCI labels it already
sets (`title`, `source`, `version`, `revision`); `source` links the package to the repo on
GitHub.

Platform: `linux/amd64` only. (Adding `linux/arm64` roughly doubles build time through
emulation; revisit if a target cluster runs ARM nodes.)

### 3.2 Where publishing happens

- **`ci.yml` → `docker-build`**, with `.github/actions/build-scan-image` once per image:
  - *Pull requests:* build into the local engine and scan with Trivy. Nothing is pushed: PR code
    is unreviewed, and a PR from a fork must never get registry access.
  - *Push to `main`:* the single build is pushed as `sha-<commit>` with SBOM and provenance,
    pulled back **by digest** into the local engine, and scanned. Once **both** images pass,
    both digests are signed with cosign (keyless). The pulled images are what the e2e job
    tests, so e2e runs the published bytes.
- **`ci.yml` → `promote`** (main only), after `docker-build`, `lint`, `security`, both test
  jobs, `contract`, `sonar` and `e2e` all pass: `.github/actions/promote-image` moves `main`
  to the two digests.
- **`release.yml` → `publish`**, after semantic-release, only if it created a new version
  (§2.8): it looks up the released commit's `sha-<commit>` images, requires that `main` points
  at them (proof the commit passed CI; if CI is still running it stops and says so), and
  promotes them to `X.Y.Z`, `X.Y`, `X` and `latest`. Nothing is rebuilt.
- **`promote-image`** first verifies the source digest's signature (made by `ci.yml` on
  `main`), retags with `docker buildx imagetools create`, then checks every new tag resolves to
  the source digest and fails otherwise.

### 3.3 Permissions (least privilege)

Workflow-level permissions stay `contents: read`. Only the jobs that publish get:

```yaml
permissions:
  contents: read
  packages: write   # push to GHCR with GITHUB_TOKEN
  id-token: write   # OIDC token for keyless signing (2.7)
```

No personal access token, no stored registry password, no signing key.

### 3.4 Tools and pinning

Following 12 §3, third-party actions are pinned to a commit SHA with the version in a comment:
`docker/login-action` v4.6.0, `docker/build-push-action` v7.4.0 and `docker/setup-buildx-action`
v4.4.1 (already used), `sigstore/cosign-installer` v4.1.2, `dataaxiom/ghcr-cleanup-action`
v1.2.2. cosign is pinned to v3.0.6, the release that version of the installer verifies against
a checksum stored in the action itself. Tag lists are computed in shell, so
`docker/metadata-action` isn't needed.

### 3.5 Verifying

`npm run images:verify -- <tag>` (a small script in `scripts/`) runs `cosign verify` for both
images with the identity of §2.7 and prints each image's digest and SBOM package count, so
checking a published image is one command. It needs cosign installed locally (README).

### 3.6 Retention

GHCR keeps everything unless told otherwise, and every commit on `main` leaves a `sha-` image.
`.github/workflows/ghcr-cleanup.yml` runs weekly and deletes `sha-*` tags and untagged versions
older than 30 days. An image that also has `main` or a release tag keeps those tags and stays;
release tags are never deleted. So any commit of the last 30 days can be redeployed by its `sha-`
tag, and anything older only if it was released.

Trap avoided: the obvious `actions/delete-package-versions` with "delete untagged" would break
our images. Each image is an index whose SBOM, provenance and platform manifests are
**untagged children** of the tagged index; deleting untagged versions deletes them.
`ghcr-cleanup-action` follows those links (and cosign signatures) and validates the remaining
images afterwards. A manual run is a dry run unless you untick it, so you can see what a run
would delete first.

## 4. What changes in the repo

| File | Change |
|---|---|
| `.github/actions/build-scan-image/action.yml` | New: build once (push `sha-` on main, or load locally), pull by digest, Trivy |
| `.github/actions/promote-image/action.yml` | New: verify signature, retag by digest, check the digest didn't change |
| `.github/workflows/ci.yml` | `docker-build` uses the action and signs on `main`; new `promote` job |
| `.github/workflows/release.yml` | New `publish` job: promote the released commit's images |
| `.github/workflows/ghcr-cleanup.yml` | Weekly cleanup of untagged versions (§3.6) |
| `scripts/verify-images.mjs`, root `package.json` | `images:verify` |
| `docs/specs/12-automation-and-ci.md` | §3 "no push in v1" replaced by a pointer here |
| `README.md` | "Published images" section: names, tags, how to pull and verify; revision log |

The application code does not change.

## 5. Definition of done

- [ ] A merge to `main` pushes both images as `sha-<short>`, signs them, and after all checks
      pass moves `main` to the same digests.
- [ ] A release adds `X.Y.Z`, `X.Y`, `X` and `latest` to the released commit's digests.
- [ ] `docker buildx imagetools inspect <image>:main` shows an SBOM and provenance attestation.
- [ ] `npm run images:verify -- main` passes; verifying with a wrong identity fails.
- [ ] Pull requests still build and scan without pushing.
- [ ] `docker compose up` still works (it builds locally and is unaffected).
- [ ] 12, README and this spec updated; conventional commit (`ci` / `build` scope).

## 6. Try it yourself

These work on your laptop before and after the CI changes.

1. **A registry of your own.** Run one, push to it, pull from it:
   ```sh
   docker run -d --rm -p 5000:5000 --name reg registry:2
   docker tag straight-salon/backend:local localhost:5000/salon-backend:try
   docker push localhost:5000/salon-backend:try
   curl -s localhost:5000/v2/_catalog          # the registry's own API: lists repositories
   curl -s localhost:5000/v2/salon-backend/tags/list
   ```
   Note the `digest: sha256:…` line `docker push` printed.
2. **Tags move, digests don't.** Rebuild with any small change, push again as `:try`, and list
   the tags: same tag, new digest. Then pull the old one by digest
   (`docker pull localhost:5000/salon-backend@sha256:<old>`); it still works.
3. **Look inside the manifest.** `docker buildx imagetools inspect localhost:5000/salon-backend:try --raw | jq`
   shows the layer list the registry stores: just hashes and sizes.
4. **After the first CI publish:** run `npm run images:verify -- main`, then run the cosign
   command of §2.7 with `straight-salon-WRONG` in the identity and watch it fail. That failure
   is the protection.
5. **Promote by hand** (local registry from 1): push an image with attestations as
   `:sha-test`, then `docker buildx imagetools create --tag localhost:5000/salon-backend:main localhost:5000/salon-backend@<digest>`
   and inspect both tags: same digest, and `--format '{{ json .SBOM }}'` still works on `:main`.
   (Pushing attestations to a local registry needs a `docker-container` builder:
   `docker buildx create --name lab --driver docker-container --driver-opt network=host`.)
6. **Read an SBOM:**
   `docker buildx imagetools inspect ghcr.io/vaikashmb/straight-salon-backend:main --format '{{ json .SBOM }}' | jq '.SPDX.packages | length'`,
   then search it for a package you know, such as `mongoose`.

Clean up with `docker stop reg`.

## 7. Check your understanding

1. Staging runs `backend:main` and production runs `backend:main`. What can go wrong, and what
   should production reference instead?
2. CI pushes `sha-abc1234` *before* scanning it. Why is that safe here, and what would make it
   unsafe?
3. A client asks you to prove that the image running in their cluster was built from commit
   `abc1234` of your repo. Which two artefacts from this step answer that?
4. Keyless signing has no private key. What stops an attacker from signing a malicious image
   as us?
5. Why would a tag-triggered publish workflow never run after our Release workflow?
6. What would you have to change to run the same frontend image for two salons with different
   domains?

(Answers are discussed when we review this step.)

## 8. Known limitations (carried forward)

- **Frontend build-time config** (§2.3): one frontend image per public address. FDE step 10.
- **One registry.** A client that requires its own registry (ECR, ACR, air-gapped) would mean
  copying images across with their signatures (`cosign copy`). Covered when we do client
  deployment.
- **amd64 only** (§3.1).
- **Base images are tags, not digests.** Both Dockerfiles start from `node:24-alpine`, and
  Dependabot only watches npm and GitHub Actions. A base image pinned by digest, with Dependabot
  (or Renovate) proposing updates, would make builds reproducible. Next image-hygiene item.
