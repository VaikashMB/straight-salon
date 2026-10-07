# 05 — Frontend (Next.js)

## 1. Tech choices `[Next]`
| Concern | Choice |
|---|---|
| Framework | Next.js 16 (latest stable), App Router, TypeScript strict, `output: "standalone"` (for Docker) with `outputFileTracingRoot` = repo root (workspaces hoist dependencies) |
| Styling | Tailwind CSS + shadcn/ui components (Radix primitives) |
| Server state | TanStack Query |
| Forms | React Hook Form + Zod resolvers |
| API client | Typed client generated from `backend/openapi.json` with `openapi-typescript` + `openapi-fetch`. The generator runs pinned through `npx` (`npx -y openapi-typescript@7.13.0`, `npm run api:client`) instead of being a dev dependency: 7.x declares a TypeScript 5 peer and the repo is on TypeScript 6 (03 §1 version note), which npm will not install alongside. Revisit when a release accepts TypeScript 6 |
| Dates | `date-fns` v4 + `@date-fns/tz`; always render in salon timezone from `/settings/public` |
| Charts | Recharts (admin reports) |
| Icons | lucide-react |
| Toasts | sonner |
| Testing | Vitest + React Testing Library + MSW (API mocks); Playwright for e2e |
| Lint/format | ESLint 9 CLI (`eslint-config-next` flat config + typescript-eslint type-checked + jsx-a11y recommended; `next lint` was removed in Next 16), Prettier, Tailwind class sorting plugin |

## 2. Brand and UI direction
- Name: **Straight Salon**. Tone: clean, modern, confident.
- Palette: near-black `#111111` primary, warm off-white `#FAF7F2` background, accent brass `#B08D57`, success/warning/error from Tailwind defaults. Define as CSS variables for light/dark themes.
- Typography: a geometric sans for headings (e.g. "Outfit"), a neutral sans for body (e.g. "Inter"), via `next/font`.
- Mobile-first. Booking flow must be comfortably usable one-handed on a phone.

## 3. Folder structure
```
frontend/src/
├── app/
│   ├── (public)/
│   │   ├── page.tsx                    # Home: hero, featured services, stylists, CTA
│   │   ├── services/page.tsx           # Catalogue with category tabs + search
│   │   ├── services/[slug]/page.tsx
│   │   ├── stylists/page.tsx
│   │   ├── stylists/[id]/page.tsx      # Profile + reviews
│   │   ├── book/page.tsx               # Booking wizard (requires login at confirm step)
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   └── reset-password/page.tsx
│   ├── (customer)/account/
│   │   ├── page.tsx                    # Upcoming bookings
│   │   ├── history/page.tsx
│   │   ├── bookings/[id]/page.tsx      # Detail, reschedule, cancel, review
│   │   └── profile/page.tsx
│   ├── (staff)/staff/
│   │   ├── page.tsx                    # My day
│   │   ├── week/page.tsx
│   │   └── time-off/page.tsx
│   ├── (admin)/admin/
│   │   ├── page.tsx                    # Dashboard (today)
│   │   ├── bookings/page.tsx           # Table + filters; walk-in button
│   │   ├── bookings/[id]/page.tsx
│   │   ├── calendar/page.tsx           # Day timeline by stylist
│   │   ├── services/page.tsx
│   │   ├── categories/page.tsx
│   │   ├── staff/page.tsx
│   │   ├── staff/[id]/page.tsx         # Profile, services, schedule, time-off
│   │   ├── customers/page.tsx
│   │   ├── reviews/page.tsx
│   │   ├── reports/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── audit/page.tsx
│   │   └── settings/page.tsx
│   ├── layout.tsx
│   ├── not-found.tsx
│   └── error.tsx
├── components/ui/                      # shadcn primitives
├── components/layout/                  # headers, sidebars, footers per area
├── features/                           # auth, booking, catalog, staff, admin-*, reports
│   └── booking/{components,hooks,api.ts,schemas.ts}
├── lib/
│   ├── api/client.ts                   # openapi-fetch instance + auth interceptor
│   ├── api/schema.d.ts                 # generated, do not edit
│   ├── auth/                           # AuthProvider, useAuth, token store
│   ├── errors.ts                       # error code -> message map
│   ├── format.ts                       # money, date/time in salon tz
│   └── query-client.ts
├── proxy.ts                            # Next 16 name for middleware.ts: /api/* runtime proxy + coarse route protection (§5)
└── styles/globals.css

frontend/tests/
├── unit/                               # Vitest + RTL (+ MSW) tests, mirroring src/ paths
└── e2e/                                # Playwright
```
Note: `admin` area is shared by ADMIN and RECEPTIONIST; nav items and pages hide what the role can't access (reports, audit, settings, staff management are ADMIN-only).

## 4. Key screens and behaviour

### 4.1 Booking wizard (`/book`) — most important flow
Steps shown as a progress bar; state kept in URL search params so refresh/back works and links are shareable (`/book?services=a,b&staff=any&date=2026-10-12`).
1. **Choose services** — multi-select cards grouped by category, running total of duration & price. Max 5 (BR-008).
2. **Choose stylist** — "Any available" (default) or stylists qualified for *all* chosen services, with photo and rating.
3. **Choose date & time** — calendar of next `maxAdvanceDays` with unavailable days disabled (API-041); time-slot chips grouped Morning/Afternoon/Evening (API-040). Skeleton loaders while fetching.
4. **Review & confirm** — summary, optional notes. If not logged in, inline login/register then return here. Confirm sends API-050 with a generated `Idempotency-Key`.
5. **Success** — booking ref, add-to-calendar (.ics download generated client-side), link to "My bookings".
- On 409 `SLOT_UNAVAILABLE`: toast + automatically refetch slots and return to step 3 keeping other selections.
- URL parameters (decision 2026-10-07): `services`, `staff` (omitted = any), `date`, `start` (the chosen slot, UTC), `step` (`stylist`, `time`, `review`, `done`; omitted = services) and `booking` (the created booking's id on `done`, read back with API-053 so a refresh still shows the confirmation). Invalid values are dropped, and a step whose earlier choices are missing falls back to the first incomplete one. Moving between steps pushes a history entry; changes within a step replace it. Step 3 opens on the first bookable day. Arriving with `staff` (from a stylist's page) lists only that stylist's services. The Idempotency-Key is generated once per distinct request body, so a retried or double-clicked confirm reuses it. Notes are kept in component state, not the URL. Salon accounts that open the wizard are pointed to the admin area (API-050 needs a `customerId` for them).

### 4.2 Customer account
- Upcoming list with status badges; each card shows Cancel/Reschedule buttons driven by `canCancel` / `canReschedule` from the API. Disabled buttons show tooltip explaining the cut-off.
- Reschedule reuses wizard step 3 component.
- Past bookings: "Leave a review" when eligible.
- Cancel/Reschedule are shown only for `BOOKED` bookings. Inside the cut-off they are rendered with `aria-disabled` rather than `disabled`, so they stay focusable and the tooltip (and its screen-reader description) works by keyboard. Reschedule keeps the same stylist for customers; the dialog reuses the wizard's step 3 component. The profile page edits name, phone, preferred stylist and the email/SMS opt-ins (API-010), changes the password (API-008) and signs out of all devices (API-005).

### 4.3 Staff "My day"
- Vertical timeline of today; each booking card shows time, customer first name, services, notes, status, and only the next valid status action button(s). Polls every 60 s (TanStack `refetchInterval`).

### 4.4 Admin
- **Dashboard:** KPI cards (today's bookings, completed, no-shows, revenue so far), per-stylist mini-timeline, upcoming next 2 hours list.
- **Calendar:** columns = stylists, rows = 15-min increments, booking blocks coloured by status; click to open drawer with actions. Time-off and breaks shown hatched.
- **Bookings table:** server-side pagination/filter/sort; "New walk-in" dialog (phone search → create walk-in → pick services/stylist → create with status `CHECKED_IN`); "Record payment" dialog on completed bookings.
- **CRUD pages** (services, categories, staff, holidays) use a consistent pattern: data table + side sheet form + confirm dialog for deactivate.
- **Staff schedule editor:** 7-row weekly grid with start/end and breaks.
- **Reports:** date-range picker, KPI cards, revenue-over-time line chart, revenue by service bar chart, utilisation by stylist bar chart, "Download CSV".
- **Audit log:** filter by entity/actor/action/date; row expands to show JSON diff.
- **Settings:** form for all FR-080 fields; business hours grid.

## 5. Authentication on the frontend
- Access token kept **in memory only** (React context), never in localStorage.
- Refresh token is an httpOnly, `SameSite=Lax`, `Secure` (prod) cookie set by the API. To keep cookies first-party, the browser only talks to the Next.js origin, and `proxy.ts` rewrites `/api/*` to `${API_INTERNAL_URL}/api/*` **at request time**. This is not done with `next.config` `rewrites`, which are fixed at build time in standalone output and would bake the backend URL into the image (11 §5). The backend sets `trust proxy` to one hop so rate limits see the client IP from `X-Forwarded-For`.
- On app load, `AuthProvider` calls `POST /auth/refresh`; success → user is logged in.
- `openapi-fetch` middleware: attach bearer token; on 401 `TOKEN_EXPIRED`, call refresh once (single-flight shared promise so parallel requests don't stampede), retry original request; if refresh fails → clear state, redirect to `/login?next=...`. Implemented as the client's `fetch` wrapper (`lib/api/client.ts`) around a session object outside React (`lib/auth/session.ts`). `?next` is honoured only for same-site paths the role may open, never for auth pages (no open redirect).
- Until their pages arrive (Phases 9 and 10), `/account`, `/staff` and `/admin` show a short welcome page inside the real area layout, and navigation items for later pages are shown as "soon" in the signed-in areas and hidden on the public site (decision 2026-10-07). Phase 9 delivered the public site and `/account`; `/staff` and `/admin` follow in Phase 10.
- STAFF pages need the stylist's own `staffId` (time-off, API-035…037), which neither `/auth/me` nor the `User` DTO carries. `AuthProvider` reads the `staffId` claim from the in-memory access token (06 §1) without verifying it: the API verifies every request and enforces ownership (decision 2026-10-07).
- `proxy.ts` provides coarse protection: routes under `/account`, `/staff`, `/admin` require the presence of the **`ss_session` indicator cookie** (06 §1), else redirect to login. It cannot check the refresh cookie itself, because that cookie is scoped to `Path=/api/v1/auth` and the browser does not send it on page navigations. Fine-grained role checks happen in layouts after `/auth/me` resolves (and the API always enforces authoritatively).
- Role-based landing after login: CUSTOMER → `/account`, STAFF → `/staff`, RECEPTIONIST/ADMIN → `/admin`.

## 6. Data fetching rules
- Public catalogue pages (`/`, `/services`, `/services/[slug]`, `/stylists`, `/stylists/[id]`) are **Server Components** fetching from the API at `API_INTERNAL_URL` with `next: { revalidate: 300 }`, for SEO and speed. They render per request (`await connection()`) with the API responses held in Next's data cache for 5 minutes, rather than being prerendered at build time (decision 2026-10-07): the backend is not reachable during `next build` (Docker builds have no API), so build-time ISR would bake an error page into the image, and `API_INTERNAL_URL` must stay a runtime setting (11 §5). If the API cannot be reached the page shows a "we'll be right back" fallback; a missing service or stylist is a 404. `/services` renders the full active list and filters by category tab and search in the browser.
- Authenticated areas are Client Components using TanStack Query with query keys like `['bookings', 'me', scope]`, invalidated after mutations.
- All API errors flow through `lib/errors.ts`, mapping `code` → friendly message; unknown → "Something went wrong (ref: {requestId})".

## 7. UX and accessibility rules
- Every form: inline Zod validation messages, disabled submit while pending, success toast.
- Every list: loading skeleton, empty state with action, error state with retry.
- Keyboard navigable; visible focus rings; labels on all inputs; colour is never the only status indicator (badges include text).
- Times always shown with salon timezone abbreviation when the browser timezone differs.
- Prices formatted with `Intl.NumberFormat` using settings currency.

## 8. Frontend environment variables
| Variable | Example |
|---|---|
| `NEXT_PUBLIC_APP_NAME` | `Straight Salon` |
| `API_INTERNAL_URL` | `http://backend:4000` (server-side fetches and the `proxy.ts` rewrite; read at runtime, never at build) |
| `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` | `91` (default). Calling code the register form adds to phone numbers typed without one (decision 2026-10-07): spaces, dashes, dots and brackets are removed; a leading `+` or `00` means the number already has one; otherwise one leading `0` is dropped and `+<code>` added. The result must be E.164 (02 §2.1). Baked in at build time: it is salon configuration, not deployment-specific |

`NEXT_PUBLIC_API_BASE_PATH` was retired in Phase 8: the generated client's paths come from `openapi.json` and already include `/api/v1`. In host mode (`npm run dev`) `next.config.ts` reads `NEXT_PUBLIC_*` and `API_INTERNAL_URL`, and nothing else, from the repo-root `.env`; in Docker, Compose passes `API_INTERNAL_URL` at runtime.

## 9. Frontend testing (details in 10-testing)
- Unit/component tests for: booking wizard steps, slot grouping, money/time formatting, auth refresh logic, error mapping, role-based nav.
- Playwright e2e (against docker-compose stack with seed data): register → book → see in account → cancel; staff marks complete; receptionist records payment; admin sees revenue in report.
