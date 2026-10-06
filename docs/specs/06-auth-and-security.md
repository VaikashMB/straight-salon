# 06 — Authentication, Authorization & Security

## 1. Token model
| Token | Format | Lifetime | Storage (client) | Storage (server) |
|---|---|---|---|---|
| Access token | JWT (HS256 in v1; RS256 planned so other services can verify with a public key) | 15 min | Memory only | Not stored (stateless) |
| Refresh token | Opaque random 256-bit string (base64url) | 7 days, sliding via rotation | httpOnly cookie `ss_rt`, `Path=/api/v1/auth`, `SameSite=Lax`, `Secure` in prod | SHA-256 hash in `refresh_tokens` |
| Session indicator | Literal `1` (no secret, grants nothing) | Same as the refresh token | Cookie `ss_session`, `Path=/`, `SameSite=Lax`, `Secure` in prod. Set and cleared alongside `ss_rt`. Only used by the frontend `proxy.ts` to decide whether to redirect to login (05 §5) | — |

JWTs are signed and verified with `jose`.

### Access token claims
```json
{
  "sub": "<userId>",
  "role": "CUSTOMER",
  "staffId": "<staffId or omitted>",
  "iat": 1760000000, "exp": 1760000900,
  "iss": "straight-salon-api", "aud": "straight-salon-web",
  "jti": "<uuid>"
}
```
No PII (no email/phone/name) in the token.

## 2. Flows
**Login (API-002)**
1. Find active user by email (include `passwordHash`). Run `bcrypt.compare` even if user not found (against a dummy hash) to keep timing constant.
2. On failure: increment `ss:v1:login_fail:{sha256(lowercased email)}` in Redis (15 min window; hashed so no PII sits in Redis, 08 §5). After 5 failures → 429 for 15 min. Audit `auth.login_failed` (without password).
3. On success: issue access token; create refresh token with new `family` UUID; set cookie; update `lastLoginAt`; audit `auth.login`.

**Refresh with rotation & reuse detection (API-003)**
1. Hash cookie value, look up record.
2. Not found / expired → 401.
3. Found but `revokedAt` set → **reuse detected**: revoke the whole `family`, audit `auth.refresh_reuse_detected` (warn log), return 401. (Stolen token mitigation.)
4. Valid → revoke it (`replacedByHash`), issue new refresh token in same family + new access token.
5. Also reject if user inactive or `passwordChangedAt > token.createdAt`.

**Logout / logout-all / password reset/change** revoke tokens as described in API-004..008. Password change/reset sets `passwordChangedAt` and revokes all families.

## 3. Authorization (RBAC + ownership)
- `authenticate` middleware: verifies JWT (signature, `exp`, `iss`, `aud`), puts `req.auth = { userId, role, staffId }`. Expired → 401 `TOKEN_EXPIRED`; anything else invalid → 401 `UNAUTHENTICATED`.
- `authorize(...permissions)` middleware checks role → permission map in `shared/auth/permissions.ts`:

| Permission | CUSTOMER | STAFF | RECEPTIONIST | ADMIN |
|---|:-:|:-:|:-:|:-:|
| `booking:create:self` | ✓ | | | |
| `booking:create:any` | | | ✓ | ✓ |
| `booking:read:own` | ✓ | ✓ (assigned) | | |
| `booking:read:any` | | | ✓ | ✓ |
| `booking:status:own` | | ✓ | | |
| `booking:status:any` | | | ✓ | ✓ |
| `booking:override_rules` | | | ✓ | ✓ |
| `payment:record` | | | ✓ | ✓ |
| `catalog:manage` | | | | ✓ |
| `staff:manage` | | | | ✓ |
| `schedule:read:own` | | ✓ | | |
| `schedule:read:any` | | | ✓ | ✓ |
| `timeoff:manage:own` | | ✓ | | |
| `timeoff:manage:any` | | | | ✓ |
| `holidays:manage` | | | | ✓ |
| `uploads:create` | | | | ✓ |
| `users:read` | | | ✓ (customers) | ✓ |
| `users:manage` | | | | ✓ |
| `settings:manage` | | | | ✓ |
| `reports:dashboard` | | | ✓ | ✓ |
| `reports:read` | | | | ✓ |
| `notifications:read:any` | | | | ✓ |
| `audit:read` | | | | ✓ |
| `review:moderate` | | | | ✓ |

`schedule:read:*` covers API-033 and API-035. `reports:dashboard` covers API-070; `reports:read` covers API-071/072. Every authenticated user may read their own notifications (API-065), so that endpoint needs no permission.

- **Ownership checks** (e.g. "own booking", "assigned stylist") are done in the **service layer**, not only in middleware. They return 404 (not 403) when a customer requests another customer's resource, or a stylist requests a booking not assigned to them, to avoid leaking existence.

## 4. Security controls checklist (OWASP-aligned)
- **Passwords:** min 8 chars, at least one letter and one number; bcrypt cost 12; checked against a small common-password list.
- **Input validation:** Zod on every input with `.strict()` (reject unknown fields); string length caps; ObjectId format validation.
- **NoSQL injection:** Zod rejects objects where strings are expected; additionally enable Mongoose `sanitizeFilter: true` and strip keys beginning with `$` or containing `.` from user input.
- **Rate limiting** (Redis-backed so it works across instances): global 300 req/min/IP; `/auth/login`, `/auth/register`, `/auth/forgot-password` 10 req/15 min/IP; `POST /bookings` 20 req/hour/user.
- **Headers:** `helmet` defaults; CSP configured on the Next.js side; `X-Powered-By` disabled.
- **CORS:** allow-list from `CORS_ORIGINS`, `credentials: true`.
- **CSRF:** refresh cookie is `SameSite=Lax` and scoped to `/api/v1/auth`; state-changing auth endpoints additionally require header `X-Requested-With: straight-salon-web`. All other endpoints use bearer tokens (not cookies), so they are not CSRF-exposed.
- **Mass assignment:** services map only whitelisted fields from DTOs; `role`, `isActive` can only be changed via admin endpoints.
- **Secrets:** only via env; `.env` git-ignored; `.env.example` contains placeholders. CI runs a secret scan (gitleaks).
- **Dependencies:** `npm audit --audit-level=high` in CI; Dependabot/Renovate enabled.
- **Logging hygiene:** pino redaction of `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.passwordHash`, `*.token`, `*.email`, `*.phone` (see 07).
- **Error hygiene:** no stack traces or Mongo messages to clients.
- **Swagger UI** disabled in production unless behind admin auth (`SWAGGER_ENABLED`).
- **Uploads (staff photos/service images, API-027):** images only (png/jpeg/webp), max 2 MB, content-type sniffed, re-encoded/stripped of metadata, random file names.

## 5. Tests required (security)
- Login timing path executes compare for unknown users.
- Brute-force lockout after 5 failures.
- Refresh rotation issues new cookie; reusing an old refresh token revokes the family.
- Each permission row above has at least one allow and one deny integration test.
- Customer requesting another customer's booking gets 404; stylist requesting an unassigned booking gets 404.
- Login, refresh and logout set/clear `ss_session` together with `ss_rt`.
- Unknown body fields are rejected (400).
- `$gt` injection attempt on login is rejected (400).
