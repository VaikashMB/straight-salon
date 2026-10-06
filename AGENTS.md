# Instructions for AI Coding Agents

You are building **Straight Salon** from the specifications in `docs/specs/`. Follow these rules strictly.

## Before writing code

1. Read every file in `docs/specs/` before starting any phase.
2. Work on **one phase at a time** from `13-build-plan.md`. Do not start the next phase unless asked.
3. If a spec is ambiguous or contradictory, stop and ask. Do not invent behaviour silently.
4. If you must deviate from a spec (e.g. a library is deprecated), explain why and update the relevant spec file in the same change.

## Code rules

- TypeScript everywhere, `strict: true`. No `any` unless justified with a comment.
- Follow the folder structure in `01-architecture.md` exactly.
- Backend layering: `route -> controller -> service -> repository -> model`. Controllers never touch Mongoose directly. Services never touch `req`/`res`.
- All request input is validated with Zod schemas. The same schemas generate the OpenAPI docs. Never hand-write OpenAPI JSON.
- All config comes from environment variables validated at startup (`src/config/env.ts`). No hard-coded secrets, URLs, or ports. `env.ts` and the logger exist from Phase 0 in minimal form; later phases extend them rather than bypassing them.
- Use the shared logger (`src/shared/logger`). Never use `console.log`.
- Any create/update/delete of a business entity must write an audit entry (see `07-logging-and-auditing.md`).
- Any state change listed in `09-events-and-messaging.md` must emit its domain event through the outbox.
- Money is stored as integers in the smallest currency unit (e.g. paise/cents). Times are stored in UTC; displayed in the salon timezone.
- Errors use the shared `AppError` classes and RFC 7807 problem responses.

## Testing rules

- Write tests in the same change as the code. A phase is not done until its tests pass.
- Coverage must stay at or above 80% lines, branches, functions, statements (see `10-testing-and-quality.md`).
- Name tests with spec IDs where applicable: `BR-004 ...`, `API-021 ...`.

## Definition of done for each phase

- [ ] Code follows the specs and folder structure
- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] `npm test` passes with coverage >= 80%
- [ ] New endpoints appear correctly in Swagger UI
- [ ] `docker compose up` still starts the whole stack
- [ ] README / specs updated if anything changed
- [ ] Conventional commit message, e.g. `feat(booking): add reschedule endpoint (API-054)`. Types and scopes are the lists in `commitlint.config.mjs` (12-automation §1).

A DoD item that depends on something not built yet is reported as **N/A** for that phase, never silently skipped: Swagger UI exists from Phase 2, `docker compose` from Phase 1.
