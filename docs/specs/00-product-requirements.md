# 00 — Product Requirements (PRD)

## 1. Overview
**Straight Salon** is a web application for a single-location hair and beauty salon. It replaces phone/WhatsApp bookings and paper registers with online booking, staff scheduling, walk-in management, automated reminders, and simple business reporting.

## 2. Goals
- G1: Customers can book an appointment in under 60 seconds.
- G2: Zero double-bookings of a stylist.
- G3: Reduce no-shows through automated reminders.
- G4: Give the owner a daily view of appointments, revenue, and staff utilisation.

## 3. Non-goals (v1)
- Online payment collection (payment is recorded manually at the counter).
- Multiple branches (data model leaves room for it via a future `branchId`).
- Inventory / product sales.
- Native mobile apps (the web app must be fully mobile-responsive instead).

## 4. Personas and roles

| Role | Who | Main needs |
|---|---|---|
| `GUEST` | Unauthenticated visitor | Browse services, prices, stylists; sign up |
| `CUSTOMER` | Registered client | Book, reschedule, cancel, view history, leave reviews |
| `STAFF` | Stylist / beautician | See own schedule, mark check-in / complete / no-show, block personal time |
| `RECEPTIONIST` | Front desk | Manage all bookings, create walk-ins, record payments |
| `ADMIN` | Owner / manager | Everything: services, staff, hours, holidays, users, reports, audit logs |

## 5. Functional requirements

### 5.1 Accounts and authentication
- **FR-001** Guests can register with name, email, phone, password. If the phone already belongs to a walk-in record (FR-037), registration is refused with `PHONE_ALREADY_REGISTERED` and the user is asked to contact the front desk. Self-service claiming of walk-in records needs phone verification, which is out of scope for v1.
- **FR-002** Users log in with email + password and receive a session (see 06-auth).
- **FR-003** Users can log out (current device) and log out of all devices.
- **FR-004** Users can request a password reset via an emailed, single-use, time-limited link (30 min).
- **FR-005** Users can view and edit their profile (name, phone, preferences such as preferred stylist).
- **FR-006** Admin can create STAFF / RECEPTIONIST / ADMIN accounts and deactivate any account. Deactivated users cannot log in.

### 5.2 Service catalogue
- **FR-010** Admin manages service categories (e.g. Hair, Skin, Nails, Grooming).
- **FR-011** Admin manages services: name, description, category, duration (minutes, multiple of slot granularity), price, active flag, optional image (uploaded through API-027; see 06 §4 for upload rules).
- **FR-012** Public users can list services filtered by category, and search by name.
- **FR-013** Deactivated services are hidden from the public catalogue but remain on historical bookings.

### 5.3 Staff and schedules
- **FR-020** Admin manages staff profiles: display name, bio, photo, list of services they can perform, active flag.
- **FR-021** Admin defines the salon's weekly business hours and closed days.
- **FR-022** Admin defines holidays (full-day closures) for specific dates.
- **FR-023** Each staff member has a weekly working schedule (per weekday: start, end, optional breaks). Defaults to salon hours.
- **FR-024** Staff (or admin on their behalf) can create time-off blocks (leave, personal time). Time-off cannot be created over existing active bookings (422). An admin may pass `force: true`, which cancels those bookings and notifies the customers (same behaviour as BR-014). Reassigning a booking to another stylist is done separately via reschedule (API-054) before forcing.

### 5.4 Availability and booking
- **FR-030** A customer chooses one or more services, optionally a stylist ("Any available" allowed), and a date; the system returns available start times.
- **FR-031** Available slots respect: salon hours, holidays, staff schedule, staff time-off, existing bookings, buffer time, lead time, and staff skill (can perform all selected services).
- **FR-032** A customer books a slot. Booking total duration = sum of service durations. Total price = sum of service prices at time of booking (price snapshot).
- **FR-033** If "Any available" was chosen, the system assigns the qualified stylist with the fewest bookings that day (tie-break: alphabetical).
- **FR-034** Customer can reschedule a booking up to the cancellation cut-off (see BR-006).
- **FR-035** Customer can cancel a booking up to the cut-off, with an optional reason.
- **FR-036** Customer sees upcoming and past bookings with status.
- **FR-037** Receptionist/Admin can create bookings for any customer, including walk-ins for customers without an account (name + phone only, stored as a lightweight customer record).
- **FR-038** Receptionist/Admin can override the cut-off rules (audited).

### 5.5 Appointment lifecycle (front desk / staff)
- **FR-040** Status flow: `BOOKED -> CHECKED_IN -> IN_SERVICE -> COMPLETED`. Side exits: `BOOKED -> CANCELLED`, `BOOKED -> NO_SHOW`.
- **FR-041** Staff can move their own bookings through the flow; receptionist/admin can move any.
- **FR-042** A booking still `BOOKED` 30 minutes after its start time is automatically marked `NO_SHOW` by a scheduled job.
- **FR-043** On completion, the receptionist records payment: method (`CASH`, `CARD`, `UPI`, `OTHER`), amount paid, optional discount with reason.

### 5.6 Notifications
- **FR-050** Customer receives a confirmation on booking, reschedule, and cancellation.
- **FR-051** Customer receives reminders 24 hours and 2 hours before the appointment.
- **FR-052** Staff receives a notification when a booking is assigned/changed/cancelled for them.
- **FR-053** Channels in v1: email + SMS through provider adapters. In dev/test, a `console`/`mock` provider stores messages in a `notifications` collection instead of sending.
- **FR-054** Customer can opt out of SMS reminders.

### 5.7 Reviews
- **FR-060** After a booking is `COMPLETED`, the customer can leave one review (1–5 stars, optional comment ≤ 500 chars) within 14 days.
- **FR-061** Average rating is shown per stylist and per service.
- **FR-062** Admin can hide abusive reviews (audited).

### 5.8 Admin dashboard and reports
- **FR-070** Today view: all bookings by stylist in a timeline, counts by status.
- **FR-071** Reports for a date range: total revenue, bookings count, cancellations, no-show rate, revenue by service, revenue by stylist, stylist utilisation (booked minutes ÷ available minutes). The range filters on the booking's appointment date (`startAt` in salon timezone), not on the payment date.
- **FR-072** Export report as CSV.
- **FR-073** Admin can view and filter the audit log.

### 5.9 Salon settings
- **FR-080** Admin manages: salon name, address, contact, timezone, currency, slot granularity (default 15 min), buffer between bookings (default 0 min), minimum lead time (default 60 min), max advance booking window (default 30 days), cancellation cut-off (default 2 h), no-show grace period (default 30 min, used by FR-042), review window (default 14 days, used by FR-060). The timezone cannot be changed while any future active bookings exist (422), because staff schedules are stored as local wall-clock times.

## 6. Non-functional requirements
- **NFR-001 Performance:** p95 API latency < 300 ms for read endpoints, < 500 ms for booking creation, under 50 concurrent users.
- **NFR-002 Availability:** Health endpoints for liveness/readiness; API must be stateless so it can be scaled horizontally later.
- **NFR-003 Security:** OWASP Top 10 mitigations (see 06-auth-and-security).
- **NFR-004 Observability:** Structured JSON logs with correlation IDs; every business mutation audited.
- **NFR-005 Quality:** ≥ 80% test coverage; SonarQube quality gate must pass; zero critical/blocker issues.
- **NFR-006 Accessibility:** WCAG 2.1 AA for customer-facing pages.
- **NFR-007 Responsiveness:** All pages usable from 360 px width upwards.
- **NFR-008 Portability:** All configuration via environment variables; app runs identically in Docker locally and in any container platform later.
- **NFR-009 Data protection:** Passwords hashed (bcrypt cost 12); PII (phone/email) never written to logs.
- **NFR-010 Time:** All timestamps stored in UTC; displayed in the salon's configured timezone.

## 7. Key user stories with acceptance criteria

**US-01 Book an appointment (customer)**
- Given I am logged in, when I select "Haircut (45 min)" and "Beard trim (15 min)" with stylist "Any", and a date, then I see start times where a qualified stylist is free for 60 consecutive minutes.
- When I pick 11:00 and confirm, then a booking is created with status `BOOKED`, a stylist is assigned, I see a confirmation screen, and a confirmation notification is queued.
- If another user takes that slot first, I get a clear "slot no longer available" message and refreshed slots (HTTP 409).

**US-02 Cancel (customer)**
- Given my booking starts in more than 2 hours, I can cancel it and its slot becomes available to others immediately.
- Given it starts in under 2 hours, the cancel button is disabled with an explanation to call the salon.

**US-03 Walk-in (receptionist)**
- I can search a customer by phone; if not found, I enter name + phone, pick services and stylist, and create a booking with status `CHECKED_IN` (API-050 with `checkInNow: true`). It starts at the current slot boundary (now rounded down to `slotGranularityMin`) if the stylist is free from there, otherwise at the stylist's next free aligned slot today, so BR-001 still holds.

**US-04 Day view (staff)**
- When I log in as staff, I land on my schedule for today showing each booking's time, customer first name, services, and status, with buttons for the next valid status.

**US-05 Revenue report (admin)**
- I choose a date range and see totals and breakdowns matching the sum of recorded payments for completed bookings whose appointment date falls in that range; I can download the same data as CSV.
