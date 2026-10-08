# 12 — Automation & CI

"Automation" in this project covers four layers: developer workflow automation, code-quality automation, CI pipeline automation, and in-app business automation (scheduled jobs — specified in 09 §7).

## 1. Repository tooling
- **npm workspaces** at root: `"workspaces": ["backend", "frontend"]`. Node **24** pinned in `.nvmrc` and `engines` (`>=24 <25`, npm `>=10`); `.npmrc` sets `engine-strict=true` so installs fail fast on the wrong Node.
- npm 11 blocks dependency install scripts until approved. Approved packages are listed under `allowScripts` in the root `package.json` (`npm install-scripts approve <pkg>`). Approve only well-known packages whose script selects or builds a native binary (currently `esbuild`, `unrs-resolver`), and re-approve when Dependabot bumps them. Denied: `mongodb-memory-server` (see below), `@scarf/scarf` (install telemetry), `msgpackr-extract` (optional native speed-up), `bcrypt` (its script only recompiles from source; the package ships glibc and musl prebuilds), `msw` (its script copies the browser service worker into `public/`; tests use `msw/node` only). `mongodb-memory-server` is explicitly **denied**: its postinstall downloads a ~120 MB `mongod`, which tests fetch lazily instead (10 §3). Docker builds use `npm ci --ignore-scripts`.
- **EditorConfig**, **Prettier** (shared config at root; `docs/` is excluded so hand-formatted spec tables stay readable), **ESLint** per app. Shared strict compiler options in `tsconfig.base.json`.
- **Husky** git hooks:
  - `pre-commit` → `lint-staged` (ESLint --fix + Prettier on staged files, `tsc --noEmit` on affected workspace).
  - `commit-msg` → `commitlint` with Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`). Scopes are the explicit list in `commitlint.config.mjs`: module names (singular `booking`, plus `auth`, `users`, `settings`, `catalog`, `staff`, `holidays`, `availability`, `payments`, `reviews`, `notifications`, `reports`, `audit`, `health`) and repo areas (`shared`, `config`, `jobs`, `workers`, `backend`, `frontend`, `infra`, `docker`, `ci`, `deps`, `docs`, `repo`).
  - `pre-push` → unit tests for workspaces changed since the upstream branch (`scripts/pre-push.mjs`; all workspaces if there is no upstream yet).
- **Changesets** or `semantic-release` (choose semantic-release): version + CHANGELOG generated from commits on `main`. Configured in Phase 11 together with CI, since it only runs there.
  Decision 2026-10-08: `.github/workflows/release.yml` runs it **by hand** (`workflow_dispatch`, main only), pinned through `npx` (`semantic-release@25.0.9`, `.releaserc.json`). Plugins: commit-analyzer, release-notes-generator, github. It creates the `v*` tag and a GitHub Release whose generated notes are the changelog, and it commits nothing back to `main`, so branch protection needs no bypass token. Running it on every push would have tagged v1.0.0 as soon as Phase 11 merged; started by hand, the first run is the v1.0.0 of Phase 12. The `phase-N` tags do not match `v*`, so they are ignored.
- **Renovate/Dependabot** weekly dependency PRs, grouped (dev deps, types, minor/patch).
- PR template (`.github/pull_request_template.md`) with the Definition of Done checklist from AGENTS.md and a "Spec IDs affected" field.
- Issue templates: bug, feature (with acceptance criteria section).
- `CODEOWNERS` (for later team use).

## 2. Root scripts (`package.json`)
| Script | Does |
|---|---|
| `dev` | run backend + worker + frontend in watch mode (concurrently) |
| `build` | build both apps |
| `lint` / `lint:fix` | ESLint all workspaces |
| `format` / `format:check` | Prettier |
| `typecheck` | tsc --noEmit all workspaces |
| `test` | unit + integration all workspaces |
| `test:coverage` | with coverage + thresholds |
| `test:e2e` | Playwright against running stack (`npm run up && npm run seed` first; 10 §4) |
| `env:init` | create `.env` from `.env.example` and generate placeholder secrets (`JWT_ACCESS_SECRET`, `OUTBOX_ENCRYPTION_KEY`); never overwrites real values |
| `openapi:export` | regenerate `backend/openapi.json` |
| `api:client` | regenerate `frontend/src/lib/api/schema.d.ts` from openapi.json (Phase 8; pinned `openapi-typescript` via `npx`, 05 §1), then format it with Prettier, so the output is identical however it is produced. Until Phase 11 the file was in `.prettierignore` but got formatted when committed, so `contract:check` always reported drift |
| `contract:check` | export + client gen; fail if `backend/openapi.json` or `frontend/src/lib/api/schema.d.ts` is untracked or differs from the git index |
| `sonar` | run sonar-scanner via Docker and wait for the quality gate (10 §5.3) |
| `sonar:setup` | one-time setup of the local SonarQube: admin password, project, quality gate, token into `.env` (10 §5.1) |
| `audit` | `npm audit` at high, with reviewed exceptions in `scripts/audit-allowlist.json` (10 §6) |
| `db:seed` / `db:migrate` / `stats:rebuild` | backend data tasks. `db:migrate`/`db:seed` exist from Phase 3 (seed: admin only, grows per phase; `npm run seed` runs it inside the dev container). In the image: `node dist/db/runMigrations.js` (seed refuses `NODE_ENV=production`). `stats:rebuild` (Phase 7) recomputes `daily_stats` for every booking date, or a range with `npm run stats:rebuild -- --from=2026-10-01 --to=2026-10-31`; in the image `node dist/db/runStatsRebuild.js [--from=… --to=…]` |
| `queues:retry-failed` | re-queue DLQ jobs: `npm run queues:retry-failed -- --queue=notifications` (any consumer queue or `scheduled-jobs`); in the image `node dist/workers/runRetryFailed.js --queue=…` |
| `validate` | lint + format:check + typecheck + test:coverage + contract:check (what CI runs; developers run before pushing) |

Scripts whose implementation belonged to a later phase existed from Phase 0 as stubs (`scripts/not-yet.mjs`) that printed which phase delivers them and exited 0: `queues:retry-failed` (6), `stats:rebuild` (7), `api:client` (8), `test:e2e` and `sonar` (11). All are implemented now, and the stub script was removed in Phase 11. `dev` runs backend, worker (`dev:worker`, a skeleton until Phase 6) and frontend. The Docker scripts from 11 §7 (`up`, `down`, `reset`, `logs`, `seed`, `tools`, `sonar:up`) exist from Phase 1; `seed` is a stub until Phase 3.

## 3. CI pipeline (GitHub Actions)

`.github/workflows/ci.yml` — triggers: pull requests and pushes to `main`.

```
jobs:
  setup        : checkout, setup-node (cache npm), npm ci
  lint         : needs setup → lint, format:check, typecheck
  security     : needs setup → npm audit (high), gitleaks
  test-backend : needs setup → services: redis:7 (mongo via mongodb-memory-server)
                 → test:coverage (backend), upload coverage + junit artifacts
  test-frontend: needs setup → test:coverage (frontend), upload artifacts
  contract     : needs setup → contract:check
  sonar        : needs test-backend, test-frontend → download coverage artifacts
                 → SonarQube/SonarCloud scan → wait for quality gate (fail on red)
  docker-build : needs lint → build backend & frontend images (no push in v1),
                 run Trivy image scan (fail on CRITICAL), cache layers with GHA cache
  e2e          : needs docker-build; on main or label "e2e"
                 → docker compose up, seed, Playwright, upload report/videos on failure
```
Implementation notes (Phase 11, decision 2026-10-08):
- `setup` installs once and caches `node_modules` (all workspaces) keyed by `.nvmrc` + lockfile; the other jobs restore it through the composite action `.github/actions/setup-deps` (`npm ci` only on a miss, `HUSKY=0`).
- `security` runs `npm run audit` (high and above, with the reviewed allowlist, 10 §6) and gitleaks `v8.30.1` (Docker image) over the full history, with accepted findings in `.gitleaksignore`.
- `test-backend` caches `~/.cache/mongodb-binaries`; both test jobs upload `lcov.info`, Cobertura and JUnit (`reports/junit.xml`).
- `sonar` scans on **SonarCloud** and is skipped with a notice while the `SONAR_TOKEN` secret is unset (10 §5.3).
- `docker-build` builds the `runtime` targets with Buildx and the GHA layer cache. Trivy `v0.75.0` fails on CRITICAL vulnerabilities **that have a fix** (`ignore-unfixed`): an unfixable base-image CVE would otherwise block every build with nothing to upgrade. When e2e will run, the images are handed to it as an artifact instead of being rebuilt.
- `e2e` loads those images, runs `npm run env:init`, `docker compose -f docker-compose.yml up --no-build --wait` and `npm run db:seed` from the runner (the production image refuses to seed), installs Chromium, runs `npm run test:e2e`, and on failure uploads the Playwright report, traces and the compose logs. PRs are triggered on `labeled` too, so adding the `e2e` label starts it.
- Third-party actions are pinned to commit SHAs (with the version in a comment); GitHub's own `actions/*` to major tags. Dependabot's `github-actions` entry keeps both current. Workflows are checked with actionlint.
- Repository settings that cannot live in the repo (set them once in GitHub): branch protection for `main` as below, with the CI jobs as required checks; the `SONAR_TOKEN` secret and `SONAR_ORGANIZATION` variable; an `e2e` label.

Rules:
- Branch protection on `main`: all jobs green, 1 review (even if self-review while learning), linear history, squash merge.
- Concurrency group per branch with cancel-in-progress.
- Secrets: `SONAR_TOKEN`, `SONAR_HOST_URL` (GitHub Actions secrets). No other secrets needed for CI in v1 (test env uses generated values).
- Status badges in README: CI, coverage, quality gate.

### Reserved for the deployment phase (do not implement in v1)
`cd.yml`: on tag/release → push images to a registry (GHCR) with SHA + semver tags → deploy to staging (Kubernetes via Helm/Kustomize or Argo CD) → smoke tests → manual approval → production. The CI above is structured so that adding CD is just appending jobs after `docker-build`.

## 4. In-app automation summary
Specified in 09 §7: reminders (24 h, 2 h), auto no-show, outbox cleanup (Phase 6), daily stats reconcile (Phase 7). Plus:
- **Migrations** run automatically on backend startup in dev (`MIGRATE_ON_START=true`); in prod they will run as a separate one-off job (later: Kubernetes Job / Helm hook).
- **Seed** runs automatically in the e2e CI job.
