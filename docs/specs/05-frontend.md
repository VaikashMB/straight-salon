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
- Charts use one series hue, `--chart-1` (a more saturated brass: `#A06A1C` light, `#B8802A` dark), because the brand brass is too low in chroma to read as a colour against the card surface; both values pass the dataviz palette checks (lightness band, chroma floor, ≥ 3:1 contrast) against `--card` (decision 2026-10-07).
- Typography: an editorial serif ("Fraunces", with italics) for `h1`, `h2` and the wordmark, a geometric sans ("Outfit") for `h3`, figures and small headings, a neutral sans ("Inter") for body, all via `next/font` (serif added in the editorial pass, decision 2026-10-12).
- Visual pass (decision 2026-10-09), all in `styles/globals.css`:
  - **Brass as text** uses `--accent-ink` (`#7D5F2C` light, `#D4B483` dark, ≥ 4.9:1 on every surface). The brand brass `#B08D57` is only 2.9:1 on the background, so it is kept for fills, borders, rings and icons. `--accent-soft` is the brass tint for selected and highlighted surfaces.
  - **Sidebar tokens** (`--sidebar*`) stay dark in both themes for the signed-in areas' sidebar.
  - **Elevation:** warm-tinted shadows `shadow-soft` (cards) and `shadow-lift` (hover, dialogs, auth card).
  - **Decoration:** the `bg-hero` utility (two soft brass radial glows) and `bg-grain` (film grain, decorative layer only); `rule-brass` is the short divider under headings.
  - **Motion:** `animate-fade-up`, `animate-fade-in`, `animate-pop` (success check), `animate-shimmer` (skeletons). Everything is switched off under `prefers-reduced-motion`; no JS-driven animation.
- Editorial pass (decision 2026-10-12, all motion still CSS-only and off under `prefers-reduced-motion`):
  - **Photography:** licensed Unsplash stock with one warm colour grade, in `public/demo/` (seeded as every service's `imageUrl` and stylist's `photoUrl`, 02 §3), `public/salon/` (interiors) and `public/gallery/` (lookbook). Credits in `public/PHOTO-CREDITS.md`. They are illustrative, not the salon's own work; replace them with real photos when available.
  - **Home:** a full-bleed photo hero (slow push-in) with the salon's live figures (average rating and review count from the stylists' aggregates, number of services and stylists, counting up in CSS), then How it works, Signature looks (the carousel next to its intro), Products we trust, Popular services, an editorial "studio" collage, the team as portrait cards, testimonials (the newest four- and five-star reviews with a comment, API-061), a gift-card band (copy only: gift cards are sold at the front desk, not online) and Visit us.
  - **Gallery** (`/gallery`, in the header and footer): a masonry lookbook (`features/gallery/looks.ts`) filtered by `?category=` links (no JavaScript needed), each look opening in a lightbox dialog with previous/next (buttons and arrow keys) and "Book this look". There is no before/after slider: stock photos have no honest before/after pairs.
  - **Stylist profile:** a large portrait, the bio in the serif, "Book with <name>", and Signature looks from the gallery in the categories they work in.
  - **Motion utilities** in `styles/globals.css`: `reveal` (rise and fade in as a section scrolls into view, CSS scroll-driven animation), `parallax`, `header-scroll` (the public header tightens and gains a shadow on scroll), `shine` (light sweep on hover and focus), `count-up` (`CountUp` component; the real number is in screen-reader text), `animate-ken-burns`, `animate-burst` (sparkles around the booking success check). Browsers without scroll-driven animations show everything in place.
  - **Page transitions:** public pages sit in React `<ViewTransition>` (no Next config needed), so routes crossfade, and a service's photo and a stylist's portrait morph from their card to their detail page (names `service-{id}` and `stylist-{id}`; each appears at most once per page).
  - **Brand:** a monogram (serif "S" in a brass ring) before the wordmark and as the favicon (`app/icon.svg`); the salon's own line icons for the categories (`components/brand-icons.tsx`: shears, razor, droplet-leaf, polish, sparkle), usable anywhere a Lucide icon is.
  - **Announcement bar** above the public header (one static line), and a **richer footer**: a "From the studio" strip of six looks, the serif sign-off "See you in the chair.", a "Visit the studio" photo card to `/location`.
  - **Location page:** the map embed is tinted to the palette (`map-tint`, dimmed in dark mode), followed by studio photos.
  - **Loading:** `(public)/loading.tsx` is a skeleton in the shape of a page (title band and image cards).
  - **Admin dashboard:** the title greets whoever is signed in by the salon's time of day ("Good morning, Priya") and the description counts today's bookings.
  - **Theme toggle:** one button in the public header and the area shell cycles system → light → dark (`lib/theme.ts`). A pinned choice is `<html data-theme>` plus `localStorage` (`ss-theme`, a per-browser convenience; access is guarded). "System" removes both and follows `prefers-color-scheme`. An inline script in `<head>` applies a pinned theme before the first paint, and other open tabs follow a change.
- Mobile-first. Booking flow must be comfortably usable one-handed on a phone.

## 3. Folder structure
```
frontend/src/
├── app/
│   ├── (public)/
│   │   ├── page.tsx                    # Home: photo hero, looks, services, studio, team, testimonials
│   │   ├── services/page.tsx           # Catalogue with category tabs + search
│   │   ├── services/[slug]/page.tsx
│   │   ├── stylists/page.tsx
│   │   ├── stylists/[id]/page.tsx      # Profile + reviews
│   │   ├── location/page.tsx           # Address, contact, hours, directions, map (single location)
│   │   ├── gallery/page.tsx            # Lookbook: masonry grid, category filter, lightbox
│   │   ├── loading.tsx                 # Page-shaped skeleton while a public page loads
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
├── features/                           # auth, booking, catalog, gallery, staff, admin-*, reports
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
- Visual pass (decision 2026-10-09):
  - **Stepper:** numbered steps (an ordered list with `aria-current="step"`) with a "Step N of 4" eyebrow over the step title.
  - **Selection:** selected cards and chips are marked by the brass ring, a check and their existing `aria-pressed` / `aria-checked` state, with the styling keyed off those attributes. Time chips are grouped under Morning / Afternoon / Evening; today's calendar day has `aria-current="date"`.
  - **Mobile summary bar:** on phones a bottom bar shows the running total (service count, duration, price) and the step's primary action: Continue on step 1, Confirm on step 4. From `sm` up, Continue is a sticky card and Confirm sits inline in the review form. Each action is rendered once.
  - **Success:** the booking reference is shown as a ticket stub.
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
- Phase 10 decisions (2026-10-07):
  - The "New walk-in" dialog also offers **Book a time** (FR-037): the same customer and service steps, then the wizard's date & time picker; API-050 with `startAt` (source defaults to `PHONE`). Customers are found by phone (API-011 `q`, role `CUSTOMER`); a phone with no match creates a walk-in record (API-013).
  - Holidays (API-019/020) are managed in a section of the Settings page; team accounts (API-012) and role/status changes (API-015) on the Customers page, which ADMIN sees as "Customers & team" and RECEPTIONIST as customers only. A new stylist profile (API-032) links an existing STAFF account without one.
  - ADMIN-only pages opened by RECEPTIONIST show "This page is for admins" with a link back (the API refuses the data anyway).
  - Day views (staff My day/Week, admin calendar) read one page of up to 100 bookings (API-052's maximum `pageSize`), which covers a salon day.
  - Dashboard "Next 2 hours" lists `BOOKED`/`CHECKED_IN` bookings starting from 15 minutes ago (late arrivals) to 2 hours ahead, measured from the time the dashboard was last fetched (it refetches every minute).
  - Staff Week shows the next seven days with the stylist's working hours from API-033.
  - Each report chart has a "Show data" table with the same numbers (05 §7, NFR-006), and the CSV is downloaded through the authenticated client as a blob.

- Public site visual pass (decision 2026-10-09):
  - **Header:** sticky, with a blurred backdrop. The current link gets a brass underline plus `aria-current="page"`, and sub-pages count (`/services/haircut` marks Services).
  - **Mobile menu:** below `md` the nav collapses into a disclosure menu: a 44 px "Menu" / "Close menu" button with `aria-expanded`, holding the links, the session actions and the theme toggle. Focus moves to the first link. It closes on Escape (focus returns to the button), on a link click and on a route change. It is not modal.
  - **Footer:** static, and dark in both themes (sidebar tokens). Since 2026-10-12 it also carries a strip of gallery looks and a "Visit the studio" card.
  - **Signed-in identity and profile menu** (decision 2026-10-09, user feedback): in the header a signed-in visitor sees their initials avatar, and their first name from `lg` up. This is the trigger of a profile menu ("Account menu for <name>", a Radix dropdown) showing their name and email, a link to their area ("My bookings" / "My day" / "Dashboard") and Sign out. In the mobile menu the same appears inline: "Signed in as" with name and role, then the area link and sign out.
  - **Home hero carousel** ("Signature looks", inspired by straight-studio.com): model photos, each tied to a service by slug, showing that service's live price and a "Book this look" link (to the catalogue if the service no longer exists). The photos are royalty-free Unsplash stock bundled in `public/looks/` (credits in `CREDITS.md`); they are illustrative, not the salon's own work. Follows the WAI-ARIA carousel pattern: labelled region, one visible slide (the others inert), previous/next, a dot per slide, swipe on touch, and a pause button (WCAG 2.2.2). It rotates every 5 s, but not while hovered or focused, after pausing, or under `prefers-reduced-motion`.
  - **"Products we trust"** strip: an auto-scrolling marquee of product-brand wordmarks. The brands are fictional and the marks are drawn in code (no third-party logos), so there is nothing to license; replace them with real partners when the salon has any. It is read once by assistive technology (the loop copy is hidden), pauses on hover, and stays still under reduced motion.
  - **Location page** (`/location`, "Location" in the header and footer): the salon's single location (multiple branches remain out of scope, 00 §3). It shows the address, phone, email, opening hours, "Get directions" (Google Maps search, new tab), "Book here" and an embedded Google Maps search iframe (no API key). The home "Visit us" section links to it.
  - **Opening hours** use a 12-hour clock ("9:30 AM – 8:30 PM", `formatClock12` in `features/catalog/hours.ts`). Booking times elsewhere keep the 24-hour format.
  - **Category styling:** icons and tints live in `features/catalog/category-style.ts`, keyed by slug, then name. Categories that admins add get a brass fallback.
  - **Specialities:** a stylist's specialities are the categories of the services they perform.
  - **Detail pages:** service and stylist detail pages also read `/categories` (cached like the other public reads).
  - **Images:** service images and stylist photos show when set (uploaded, or the seeded demo photos), with a tinted category placeholder or initials otherwise.
- Signed-in areas visual pass (decision 2026-10-09):
  - **Layout from `lg` up:** a fixed dark sidebar holding the brand, the icon nav (brass bar plus `aria-current="page"` on the current item) and a profile block (initials, name, role, sign-out, theme toggle).
  - **Layout below `lg`:** a dark top bar with a row of nav pills that scrolls sideways. The same single `nav aria-label="Section"` is restyled with CSS.
  - **Skip link:** a "Skip to content" link jumps to `#main`.
  - **Way back to the public site** (decision 2026-10-09, user feedback): a back arrow ("Back to main site") at the start of the area header, before the brand and area name, on the sidebar and the top bar alike. The brand itself also links to `/` instead of the role's landing page.
  - **Now markers:** today's My day, admin calendar and dashboard mini-timelines show a decorative "now" marker (salon timezone, today only, refreshed every minute).
  - **Calendar blocks:** a status-coloured left edge as well as the status icon and text.
  - **Status badges:** every status badge has an icon next to its text.
  - **Reports KPI cards:** a daily sparkline plus a text trend comparing the second half of the range with the first. A one-day range shows none.
  - **Empty states:** line-art illustrations (inbox, calendar, search).

## 5. Authentication on the frontend
- Access token kept **in memory only** (React context), never in localStorage.
- Refresh token is an httpOnly, `SameSite=Lax`, `Secure` (prod) cookie set by the API. To keep cookies first-party, the browser only talks to the Next.js origin, and `proxy.ts` rewrites `/api/*` to `${API_INTERNAL_URL}/api/*` **at request time**. This is not done with `next.config` `rewrites`, which are fixed at build time in standalone output and would bake the backend URL into the image (11 §5). The backend sets `trust proxy` to one hop so rate limits see the client IP from `X-Forwarded-For`.
- On app load, `AuthProvider` calls `POST /auth/refresh`; success → user is logged in.
- `openapi-fetch` middleware: attach bearer token; on 401 `TOKEN_EXPIRED`, call refresh once (single-flight shared promise so parallel requests don't stampede), retry original request; if refresh fails → clear state, redirect to `/login?next=...`. Implemented as the client's `fetch` wrapper (`lib/api/client.ts`) around a session object outside React (`lib/auth/session.ts`). `?next` is honoured only for same-site paths the role may open, never for auth pages (no open redirect).
- Until their pages arrive (Phases 9 and 10), `/account`, `/staff` and `/admin` show a short welcome page inside the real area layout, and navigation items for later pages are shown as "soon" in the signed-in areas and hidden on the public site (decision 2026-10-07). Phase 9 delivered the public site and `/account`, Phase 10 `/staff` and `/admin`; the welcome pages and the "soon" mechanism were then removed.
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
