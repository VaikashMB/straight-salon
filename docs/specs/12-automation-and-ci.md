# 12 — Automation & CI

"Automation" in this project covers four layers: developer workflow automation, code-quality automation, CI pipeline automation, and in-app business automation (scheduled jobs — specified in 09 §7).

## 1. Repository tooling
- **npm workspaces** at root: `"workspaces": ["backend", "frontend"]`. Node **24** pinned in `.nvmrc` and `engines` (`>=24 <25`, npm `>=10`); `.npmrc` sets `engine-strict=true` so installs fail fast on the wrong Node.
- npm 11 blocks dependency install scripts until approved. Approved packages are listed under `allowScripts` in the root `package.json` (`npm install-scripts approve <pkg>`). Approve only well-known packages whose script selects or builds a native binary (currently `esbuild`, `unrs-resolver`), and re-approve when Dependabot bumps them.
- **EditorConfig**, **Prettier** (shared config at root; `docs/` is excluded so hand-formatted spec tables stay readable), **ESLint** per app. Shared strict compiler options in `tsconfig.base.json`.
- **Husky** git hooks:
  - `pre-commit` → `lint-staged` (ESLint --fix + Prettier on staged files, `tsc --noEmit` on affected workspace).
  - `commit-msg` → `commitlint` with Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`). Scopes are the explicit list in `commitlint.config.mjs`: module names (singular `booking`, plus `auth`, `users`, `settings`, `catalog`, `staff`, `holidays`, `availability`, `payments`, `reviews`, `notifications`, `reports`, `audit`, `health`) and repo areas (`shared`, `config`, `jobs`, `workers`, `backend`, `frontend`, `infra`, `docker`, `ci`, `deps`, `docs`, `repo`).
  - `pre-push` → unit tests for workspaces changed since the upstream branch (`scripts/pre-push.mjs`; all workspaces if there is no upstream yet).
- **Changesets** or `semantic-release` (choose semantic-release): version + CHANGELOG generated from commits on `main`. Configured in Phase 11 together with CI, since it only runs there.
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
| `test:e2e` | Playwright against running stack |
| `openapi:export` | regenerate `backend/openapi.json` |
| `api:client` | regenerate `frontend/src/lib/api/schema.d.ts` from openapi.json |
| `contract:check` | export + client gen + fail if git diff non-empty |
| `sonar` | run sonar-scanner via Docker |
| `db:seed` / `db:migrate` / `stats:rebuild` | backend data tasks |
| `queues:retry-failed` | re-queue DLQ jobs |
| `validate` | lint + format:check + typecheck + test:coverage + contract:check (what CI runs; developers run before pushing) |

Scripts whose implementation belongs to a later phase exist from Phase 0 as stubs (`scripts/not-yet.mjs`) that print which phase delivers them and exit 0: `openapi:export`, `contract:check`, `db:migrate` (Phase 2), `db:seed` (3), `queues:retry-failed` (6), `stats:rebuild` (7), `api:client` (8), `test:e2e`, `sonar` (11). `dev` runs backend + frontend until the worker exists (Phase 6). The Docker scripts from 11 §7 are added in Phase 1.

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
Rules:
- Branch protection on `main`: all jobs green, 1 review (even if self-review while learning), linear history, squash merge.
- Concurrency group per branch with cancel-in-progress.
- Secrets: `SONAR_TOKEN`, `SONAR_HOST_URL` (GitHub Actions secrets). No other secrets needed for CI in v1 (test env uses generated values).
- Status badges in README: CI, coverage, quality gate.

### Reserved for the deployment phase (do not implement in v1)
`cd.yml`: on tag/release → push images to a registry (GHCR) with SHA + semver tags → deploy to staging (Kubernetes via Helm/Kustomize or Argo CD) → smoke tests → manual approval → production. The CI above is structured so that adding CD is just appending jobs after `docker-build`.

## 4. In-app automation summary
Specified in 09 §7: reminders (24 h, 2 h), auto no-show, daily stats reconcile, outbox cleanup. Plus:
- **Migrations** run automatically on backend startup in dev (`MIGRATE_ON_START=true`); in prod they will run as a separate one-off job (later: Kubernetes Job / Helm hook).
- **Seed** runs automatically in the e2e CI job.
