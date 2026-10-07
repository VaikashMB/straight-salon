# 04 — API Contract & OpenAPI

## 1. Conventions
- Base path: `/api/v1`. Breaking changes require `/api/v2`.
- JSON only, `camelCase` fields, ISO-8601 UTC timestamps (`2026-10-12T05:30:00.000Z`), dates as `YYYY-MM-DD` in salon timezone.
- Money: `{ "amountMinor": 50000, "currency": "INR" }` in responses; inputs use `priceMinor` integers.
- Auth header: `Authorization: Bearer <accessToken>`. Refresh token travels only in the `ss_rt` httpOnly cookie.
- Every response includes `X-Request-Id`.
- Errors: RFC 7807 (see 03-backend §4).
- Auth column legend: `Public`, `Auth` (any logged-in user), or role list. Some public reads also accept an optional bearer token that unlocks an ADMIN view (`includeInactive=true`, inactive entries, admin fields); a token that is sent must be valid (401 otherwise), and `includeInactive=true` without ADMIN is 401/403. These admin views are never cached.
- Unpaginated lists (categories, holidays, staff, time-off) return a bare JSON array; paginated lists use the envelope in 03 §8.

## 2. OpenAPI generation rules
- OpenAPI **3.1** document generated at runtime from Zod schemas using `zod-to-openapi`. Each module registers its paths in `*.routes.ts` via the shared `registry`.
- Every endpoint must declare: `summary`, `tags` (module name), `security` (or `[]` for public), request schemas (params, query, body), **all** response codes it can return with schemas, and at least one `example`.
- Reusable components: `Problem`, `PaginationMeta`, `Money`, `BookingStatus`, `Role`, plus each DTO.
- Security scheme: `bearerAuth` (HTTP bearer, JWT) and `refreshCookie` (apiKey in cookie `ss_rt`).
- `npm run openapi:export` writes `backend/openapi.json`; CI fails if the committed file is out of date (contract drift check). The frontend generates its typed client from this file (see 05-frontend).

## 3. Endpoints

### Auth (`tags: Auth`)
Every `POST /auth/*` requires the header `X-Requested-With: straight-salon-web` (403 otherwise, 06 §4). Login, register and forgot-password are limited to 10 requests / 15 min / IP.

| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-001 | `POST /auth/register` | Public | Body `{name,email,phone,password}` → 201 `{user, accessToken}` + sets refresh cookie (and the `ss_session` indicator cookie, 06 §1). 409 `DUPLICATE` if email/phone exists on a registered account; 409 `PHONE_ALREADY_REGISTERED` if the phone belongs to a walk-in record (FR-001). |
| API-002 | `POST /auth/login` | Public | `{email,password}` → 200 `{user, accessToken}` + cookie. 401 generic "invalid credentials". |
| API-003 | `POST /auth/refresh` | Cookie | Rotates refresh token → 200 `{accessToken}` + new cookie. 401 on invalid/reused (and both cookies are cleared). |
| API-004 | `POST /auth/logout` | Cookie | Revokes current refresh token, clears cookie → 204. |
| API-005 | `POST /auth/logout-all` | Auth | Revokes all user's refresh tokens → 204. |
| API-006 | `POST /auth/forgot-password` | Public | `{email}` → always 202 (no user enumeration). |
| API-007 | `POST /auth/reset-password` | Public | `{token,newPassword}` → 204; revokes all sessions. 400 `INVALID_RESET_TOKEN` if the token is unknown, used or expired. |
| API-008 | `POST /auth/change-password` | Auth | `{currentPassword,newPassword}` → 204. Ends every other session; this device gets a fresh refresh cookie. Wrong current password → 400 `VALIDATION_FAILED` on `currentPassword` (not 401, which would log the user out client-side). New must differ from current. |
| API-009 | `GET /auth/me` | Auth | Current user profile. |

### Users (`tags: Users`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-010 | `PATCH /users/me` | Auth | Update name, phone, preferences. |
| API-011 | `GET /users` | ADMIN, RECEPTIONIST | List/search users (`q`, `role`, `isActive`), paginated. Receptionist sees customers only. |
| API-012 | `POST /users` | ADMIN | `{name,email,phone,role: STAFF\|RECEPTIONIST\|ADMIN,password}` → 201. The admin sets a **temporary password** (same policy as registration) that the person changes via API-008. |
| API-013 | `POST /users/walk-in` | ADMIN, RECEPTIONIST (`walkin:create`) | `{name, phone}` → 201 new walk-in customer (no email/password), or 200 with the existing customer (walk-in or registered) holding that phone. 409 if the phone belongs to a staff account. |
| API-014 | `GET /users/{id}` | ADMIN, RECEPTIONIST | |
| API-015 | `PATCH /users/{id}` | ADMIN | `{role?, isActive?}`. 403 on your own account. A deactivated user cannot log in; their sessions end at the next refresh (≤ access-token TTL). Role changes reach the token at the next refresh. |

### Settings & holidays (`tags: Settings`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-016 | `GET /settings/public` | Public | Name, address, contact, hours, timezone, currency, plus the public booking policy the wizard needs: `slotGranularityMin`, `minLeadTimeMin`, `maxAdvanceDays`, `cancellationCutoffMin` (decision 2026-10-06). |
| API-017 | `GET /settings` | ADMIN | Full settings. |
| API-018 | `PUT /settings` | ADMIN | Update settings (validates BR-013 against existing services). 422 if `timezone` changes while future active bookings exist (FR-080). |
| API-019 | `GET /holidays?from&to` | Public | |
| API-020 | `POST /holidays` / `DELETE /holidays/{id}` | ADMIN | POST: 422 `ACTIVE_BOOKINGS_EXIST` if active bookings exist on that date, unless `force: true`, which cancels them and notifies customers (as BR-014). DELETE has no booking check. |

### Catalog (`tags: Catalog`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-021 | `GET /categories` | Public | Active categories, sorted by `sortOrder`, then name (ADMIN can pass `includeInactive=true`). |
| API-022 | `POST/PATCH/DELETE /categories[/{id}]` | ADMIN | Delete = deactivate. |
| API-023 | `GET /services?categoryId&q&page` | Public | Active services (admins can pass `includeInactive=true`). |
| API-024 | `GET /services/{idOrSlug}` | Public | Includes stylists who perform it and rating. |
| API-025 | `POST /services` / `PATCH /services/{id}` | ADMIN | |
| API-026 | `DELETE /services/{id}` | ADMIN | Deactivate. |
| API-027 | `POST /uploads/images` | ADMIN | `multipart/form-data` with one `file` (png/jpeg/webp, ≤ 2 MB; rules in 06 §4). Stored through the `ObjectStorage` interface → 201 `{url}`. The URL is then set as `services.imageUrl` / `staff.photoUrl` via API-025/032. |

### Staff (`tags: Staff`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-030 | `GET /staff?serviceId` | Public | Active stylists (public fields only). ADMIN can pass `includeInactive=true` for everyone, with `userId` and `isActive`. |
| API-031 | `GET /staff/{id}` | Public | Profile + services + rating. Deactivated stylists are 404, except for ADMIN (admin fields included). |
| API-032 | `POST /staff` / `PATCH /staff/{id}` | ADMIN | Create staff profile (linked to STAFF user), update, deactivate (BR-014). |
| API-033 | `GET /staff/{id}/schedule` | ADMIN, RECEPTIONIST, own STAFF | Weekly schedule. |
| API-034 | `PUT /staff/{id}/schedule` | ADMIN | Replace weekly schedule. |
| API-035 | `GET /staff/{id}/time-off?from&to` | ADMIN, RECEPTIONIST, own STAFF | |
| API-036 | `POST /staff/{id}/time-off` | ADMIN, own STAFF | 422 `ACTIVE_BOOKINGS_EXIST` if it overlaps active bookings. ADMIN can pass `force: true`, which cancels them and notifies customers (FR-024). |
| API-037 | `DELETE /staff/{id}/time-off/{timeOffId}` | ADMIN, own STAFF | |

### Availability (`tags: Availability`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-040 | `GET /availability?serviceIds=a,b&staffId=any|{id}&date=YYYY-MM-DD` | Public | Returns `{date, timezone, slots:[{startAt, staffIds}]}`. Cached (see 08). |
| API-041 | `GET /availability/days?serviceIds&staffId&from&to` | Public | Which dates have at least one slot (for calendar greying-out). Max 31 days. Returns `{from, to, timezone, availableDates: [...]}`. Like API-040, starts within the lead time count only for staff roles. |

### Bookings (`tags: Bookings`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-050 | `POST /bookings` | CUSTOMER, RECEPTIONIST, ADMIN | Body `{serviceIds, staffId|"any", startAt?, notes?, customerId? (staff only), source? (staff only), checkInNow? (staff only)}`. `startAt` is required unless `checkInNow: true`. A walk-in starts at the current slot boundary or the next free aligned slot today, is created with status `CHECKED_IN` and `source: WALK_IN` by default (00 US-03). 201 booking. 409 `SLOT_UNAVAILABLE`, 422 rule violations, 503 `TEMPORARILY_UNAVAILABLE` if the lock store is down. Supports `Idempotency-Key`. "Staff only" here means RECEPTIONIST/ADMIN, who must pass `customerId` (an active customer); their `source` defaults to `PHONE`, or `WALK_IN` with `checkInNow` (decision 2026-10-07); customers always get `ONLINE`. A start off the slot grid (BR-001) is 422 `VALIDATION_FAILED` on `startAt`. 20 requests/hour/user (06 §4). |
| API-051 | `GET /bookings/me?scope=upcoming|past` | CUSTOMER | Own bookings, paginated. `upcoming` (default): active (`BOOKED`/`CHECKED_IN`/`IN_SERVICE`) and not yet ended, soonest first; `past`: everything else (including cancelled), latest first. |
| API-052 | `GET /bookings` | ADMIN, RECEPTIONIST, STAFF | Filters: `date`, `from`, `to`, `staffId`, `status`, `customerId`, `q` (bookingRef/phone). STAFF forced to own `staffId`. `date`/`from`/`to` are salon-local dates (inclusive); `q` starting with `SS-` matches a booking-reference prefix, otherwise a customer phone prefix. In every booking DTO a STAFF viewer gets the customer's first name and a masked phone only (00 US-04, decision 2026-10-07). |
| API-053 | `GET /bookings/{id}` | Owner customer, assigned STAFF, RECEPTIONIST, ADMIN | 404 (not 403) for a customer's other bookings and a stylist's unassigned bookings (06 §3). |
| API-054 | `POST /bookings/{id}/reschedule` | Owner customer, RECEPTIONIST, ADMIN | `{startAt, staffId?, override?, reason?}`. BR-006/BR-015. |
| API-055 | `POST /bookings/{id}/cancel` | Owner customer, RECEPTIONIST, ADMIN | `{reason?, override?}`. |
| API-056 | `POST /bookings/{id}/status` | Assigned STAFF, RECEPTIONIST, ADMIN | `{status: CHECKED_IN|IN_SERVICE|COMPLETED|NO_SHOW, note?}`. BR-010. `NO_SHOW` only once `startAt` has passed (decision 2026-10-07; before that, cancel). |
| API-057 | `POST /bookings/{id}/payment` | RECEPTIONIST, ADMIN | `{method, amountPaidMinor, discountMinor?, discountReason?}`. BR-011. Idempotent. 200 with the booking. One payment per booking: a second is 409 `PAYMENT_ALREADY_RECORDED` (decision 2026-10-07); not `COMPLETED` is 422 `PAYMENT_NOT_ALLOWED`. |
| API-058 | `GET /bookings/{id}/history` | RECEPTIONIST, ADMIN | Status history + audit entries for this booking. |

**Booking DTO example**
```json
{
  "id": "6712c0f9a1b2c3d4e5f60789",
  "bookingRef": "SS-261012-7KQ2",
  "status": "BOOKED",
  "startAt": "2026-10-12T05:30:00.000Z",
  "endAt": "2026-10-12T06:30:00.000Z",
  "customer": { "id": "...", "name": "Ananya R", "phone": "+9198xxxxxx12" },
  "staff": { "id": "...", "displayName": "Ravi" },
  "services": [
    { "serviceId": "...", "name": "Haircut", "durationMin": 45, "price": { "amountMinor": 40000, "currency": "INR" } },
    { "serviceId": "...", "name": "Beard Trim", "durationMin": 15, "price": { "amountMinor": 15000, "currency": "INR" } }
  ],
  "total": { "amountMinor": 55000, "currency": "INR" },
  "source": "ONLINE",
  "payment": { "status": "UNPAID" },
  "canCancel": true,
  "canReschedule": true,
  "createdAt": "2026-10-06T09:12:44.000Z"
}
```
`canCancel` / `canReschedule` are computed server-side for the current user so the UI never duplicates BR-006 logic.

### Reviews (`tags: Reviews`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-060 | `POST /bookings/{id}/review` | Owner CUSTOMER | `{rating, comment?}`. BR-012. |
| API-061 | `GET /reviews?staffId|serviceId&page` | Public | Visible reviews only. |
| API-062 | `PATCH /reviews/{id}` | ADMIN | `{isHidden, hiddenReason}`. |

### Notifications (`tags: Notifications`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-065 | `GET /notifications/me` | Auth | Own notification history. |
| API-066 | `GET /notifications` | ADMIN | All, filterable; used to inspect mock-sent messages in dev. |

### Reports & audit (`tags: Reports, Audit`)
| ID | Method & path | Auth | Description |
|---|---|---|---|
| API-070 | `GET /reports/dashboard?date` | ADMIN, RECEPTIONIST | Today counts by status, per-stylist timeline summary. |
| API-071 | `GET /reports/summary?from&to` | ADMIN | Totals + breakdowns (FR-071). Max range 366 days. |
| API-072 | `GET /reports/summary.csv?from&to` | ADMIN | `text/csv` download. |
| API-073 | `GET /audit-logs?entityType&entityId&actorId&action&from&to&page` | ADMIN | Paginated. |

### Ops (`tags: Ops`, outside `/api/v1`)
`GET /health/live`, `GET /health/ready`, `GET /metrics`, `GET /api/docs`, `GET /api/docs/openapi.json`.
`GET /uploads/{key}` serves images stored by the local ObjectStorage adapter (API-027): read-only, `Cross-Origin-Resource-Policy: cross-origin` so the frontend origin can embed them, long-cached (random names never change). Misses are 404 problems. Not in OpenAPI (static files); an S3 adapter replaces it with bucket/CDN URLs.

## 4. Standard error codes
`VALIDATION_FAILED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `DUPLICATE`, `STALE_VERSION`, `SLOT_UNAVAILABLE`, `OUTSIDE_BUSINESS_HOURS`, `LEAD_TIME_VIOLATION`, `ADVANCE_WINDOW_VIOLATION`, `CUTOFF_PASSED`, `STAFF_CANNOT_PERFORM_SERVICE`, `BOOKING_LIMIT_REACHED`, `INVALID_STATUS_TRANSITION`, `PAYMENT_MISMATCH`, `REVIEW_NOT_ALLOWED`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_REUSED` (422 different body; 409 while the first request is still running), `PAYMENT_ALREADY_RECORDED` (409, API-057), `PAYMENT_NOT_ALLOWED` (422, API-057 on a booking that is not `COMPLETED`), `INVALID_RESET_TOKEN` (400, API-007), `PHONE_ALREADY_REGISTERED` (409, FR-001), `ACTIVE_BOOKINGS_EXIST` (422; holiday, time-off, stylist deactivation (BR-014) and timezone change without `force`), `INVALID_FILE` (400/413, API-027), `INVALID_DURATION` (422; service duration not a multiple of `slotGranularityMin`, BR-013, on API-025 and on API-018 granularity changes), `PAYLOAD_TOO_LARGE` (413, JSON body over 100 kb), `TEMPORARILY_UNAVAILABLE` (503), `INTERNAL_ERROR`.
The frontend maps codes (not messages) to user-facing text.
