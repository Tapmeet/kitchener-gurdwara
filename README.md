# Kitchener Gurdwara – Project Overview

_Generated: 2025-10-17T21:01:28_

## Tech Stack

- **Next.js 15** (App Router, Server/Client Components)
- **TypeScript**
- **Prisma 6** with **PostgreSQL**
- **NextAuth** (Google, Apple, Credentials) + Prisma adapter
- **Tailwind CSS 4**
- **Resend** (email), **Twilio** (SMS)
- **date-fns** & **date-fns-tz**
- **Google Places** for address autocomplete

## High-Level Domain Model

- **User** – id:String, email:String, name:String?, image:String?, emailVerified:DateTime?, phone:String?, passwordHash:String?, role:UserRole, createdAt:DateTime, updatedAt:DateTime, accounts:Account[], sessions:Session[]...
- **Hall** – id:String, name:String, capacity:Int?, isActive:Boolean, createdAt:DateTime, updatedAt:DateTime, bookings:Booking[]...
- **ProgramType** – id:String, name:String, category:ProgramCategory, requiresHall:Boolean, canBeOutsideGurdwara:Boolean, isActive:Boolean, durationMinutes:Int, minPathers:Int, minKirtanis:Int, peopleRequired:Int, compWeight:Int, trailingKirtanMinutes:Int...
- **Booking** – id:String, title:String, start:DateTime, end:DateTime, locationType:LocationType, hallId:String?, hall:Hall?, attendees:Int, address:String?, contactName:String, contactPhone:String, contactEmail:String?...
- **BookingItem** – id:String, bookingId:String, booking:Booking, programTypeId:String, programType:ProgramType, notes:String?, assignments:BookingAssignment[]...
- **Staff** – id:String, name:String, skills:StaffSkill[], isActive:Boolean, createdAt:DateTime, updatedAt:DateTime, jatha:Jatha?, email:String?, phone:String?, assignments:BookingAssignment[]...
- **BookingAssignment** – id:String, bookingId:String, bookingItemId:String, staffId:String, start:DateTime?, end:DateTime?, state:AssignmentState, booking:Booking, bookingItem:BookingItem, staff:Staff, createdAt:DateTime...
- **Account** – id:String, userId:String, type:String, provider:String, providerAccountId:String, refresh_token:String?, access_token:String?, expires_at:Int?, token_type:String?, scope:String?, id_token:String?, session_state:String?...
- **Session** – id:String, sessionToken:String, userId:String, expires:DateTime, user:User...
- **VerificationToken** – identifier:String, token:String, expires:DateTime...

### Enums

- **UserRole**: ADMIN, STAFF, LANGRI, VIEWER
- **LocationType**: GURDWARA, OUTSIDE_GURDWARA
- **ProgramCategory**: KIRTAN, PATH, OTHER
- **StaffSkill**: PATH, KIRTAN
- **Jatha**: A, B
- **BookingStatus**: PENDING, CONFIRMED, CANCELLED, EXPIRED
- **AssignmentState**: PROPOSED, CONFIRMED

## Core Features & Flow

1. **Public booking**: `/book` renders a `BookingForm` with validation (Zod) and Google Places.
2. **Create booking API**: `POST /api/bookings` validates input, clamps to business hours, selects a hall when needed, and stores contact info.
3. **Availability checks**: `/api/availability` estimates staffing and hall availability (buffers for outside events).
4. **Admin views**:
   - `/admin/schedule` – week/month schedule, filters by date.
   - `/admin/bookings` – list & manage bookings.
   - `/admin/staff` – manage staff; exposes personal ICS feeds.
   - `/admin/assignments/swap` – swap/adjust assignments.
5. **Auto-assign**: `POST /api/bookings/:id/auto-assign` uses fairness-weighted pools, jathas, and program rules to propose assignments; writes `BookingAssignment` rows (state = `PROPOSED` → `CONFIRMED`).
6. **Trailing Kirtan**: Some programs (e.g., **Sukhmani Sahib Path + Kirtan**) set `trailingKirtanMinutes > 0` so last N minutes require a full jatha while earlier minutes may only require Path.
7. **Path rotations / closing doubles**: `pathRotationMinutes` slices PATH work into shifts; `pathClosingDoubleMinutes` doubles PATH coverage in the closing window.
8. **ICS**: `/api/staff/:id/assignments.ics` and `/api/me/assignments.ics` export calendar feeds.
9. **Status lifecycle**: `PENDING → CONFIRMED → CANCELLED/EXPIRED`. Housekeeping endpoint expires stale PENDING bookings (older than 24h) behind a transaction-scoped advisory lock.
10. **Auth & roles**: `ADMIN`, `STAFF`, `LANGRI`, `VIEWER`. Admin-only pages gated via middleware and session role.

## Program Types (seeded)

| Program                               | Category | Duration |   P |   K | TrailingKirtan | PathRotation | PathClosingDouble |
| ------------------------------------- | -------- | -------: | --: | --: | -------------: | -----------: | ----------------: |
| Sukhmani Sahib Path + Kirtan          | PATH     |      120 |   1 |   0 |             60 |            0 |                 0 |
| Sukhmani Sahib Path                   | PATH     |       90 |   1 |   0 |              0 |            0 |                 0 |
| Anand Karaj                           | OTHER    |      180 |   1 |   3 |              0 |            0 |                 0 |
| Antim Ardas (Alania Da Path) + Kirtan | PATH     |      120 |   1 |   0 |             60 |            0 |                 0 |
| Assa Di War                           | KIRTAN   |      180 |   0 |   3 |              0 |            0 |                 0 |
| Kirtan                                | KIRTAN   |       60 |   0 |   3 |              0 |            0 |                 0 |
| Akhand Path + Kirtan                  | PATH     |       49 |   1 |   0 |             60 |          120 |                60 |
| Akhand Path                           | PATH     |       48 |   1 |   0 |              0 |          120 |                60 |

## Notable Constants

- `export const VENUE_TZ = 'America/Toronto'` (src/lib/businessHours.ts)
- `SMALL_HALL_CAP = 125` (src/lib/scheduling.ts)
- `MAIN_HALL_CAP = 325` (src/lib/scheduling.ts)
- `UPPER_HALL_CAP = 100` (src/lib/scheduling.ts)
- `OUTSIDE_BUFFER_MINUTES = 15` (src/lib/scheduling.ts)

## Important Library Modules

- `src/lib/assignment-notify-staff.ts`
- `src/lib/auth.ts`
- `src/lib/auto-assign.ts`
- `src/lib/bot-verify.ts`
- `src/lib/businessHours.ts`
- `src/lib/conflicts.ts`
- `src/lib/db.ts`
- `src/lib/fairness.ts`
- `src/lib/halls.ts`
- `src/lib/headcount.ts`
- `src/lib/jatha.ts`
- `src/lib/notify.ts`
- `src/lib/phone.ts`
- `src/lib/pools.ts`
- `src/lib/rate-limit.ts`
- `src/lib/report-fairness.ts`
- `src/lib/roles.ts`
- `src/lib/scheduling.ts`
- `src/lib/staff-capacity.ts`
- `src/lib/validation.ts`

## Next.js Routes

### Pages

- `src/app/admin/assignments/swap/page.tsx`
- `src/app/admin/bookings/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/reports/fairness/page.tsx`
- `src/app/admin/schedule/page.tsx`
- `src/app/admin/staff/page.tsx`
- `src/app/assignments/[bookingId]/page.tsx`
- `src/app/book/page.tsx`
- `src/app/bookings/[id]/assignments/page.tsx`
- `src/app/bookings/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/login/page.tsx`
- `src/app/my-assignments/page.tsx`
- `src/app/my-bookings/page.tsx`
- `src/app/page.tsx`
- `src/app/program-types/page.tsx`

### API Endpoints

- `src/app/api/admin/reports/fairness/route.ts`
- `src/app/api/assignments/[id]/route.ts`
- `src/app/api/assignments/route.ts`
- `src/app/api/assignments/swap/route.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/api/availability/route.ts`
- `src/app/api/bookings/[id]/approve/route.ts`
- `src/app/api/bookings/[id]/assignments/route.ts`
- `src/app/api/bookings/[id]/assignments/swap/route.ts`
- `src/app/api/bookings/[id]/auto-assign/route.ts`
- `src/app/api/bookings/[id]/cancel/route.ts`
- `src/app/api/bookings/[id]/confirm/route.ts`
- `src/app/api/bookings/[id]/proposed-assignments/route.ts`
- `src/app/api/bookings/[id]/route.ts`
- `src/app/api/bookings/route.ts`
- `src/app/api/events/route.ts`
- `src/app/api/halls/route.ts`
- `src/app/api/housekeeping/expire-pending/route.ts`
- `src/app/api/me/assignments.ics/route.ts`
- `src/app/api/program-types/route.ts`
- `src/app/api/staff/[id]/assignments.ics/route.ts`

## Environment Variables Referenced

- **ADMIN_EMAILS** – src/auth.ts, src/lib/notify.ts
- **ASSIGN_NOTIFICATIONS** – src/app/api/bookings/[id]/auto-assign/route.ts, src/app/api/bookings/route.ts, src/lib/assignment-notify-staff.ts
- **ASSIGN_NOTIFY_CHANNELS** – src/lib/assignment-notify-staff.ts
- **ASSIGN_NOTIFY_IN_DEV** – src/lib/assignment-notify-staff.ts
- **AUTH_APPLE_ID** – src/auth.ts
- **AUTH_APPLE_KEY_ID** – src/auth.ts
- **AUTH_APPLE_SECRET** – src/auth.ts
- **AUTH_APPLE_TEAM_ID** – src/auth.ts
- **AUTH_GOOGLE_ID** – src/auth.ts
- **AUTH_GOOGLE_SECRET** – src/auth.ts
- **AUTO_ASSIGN_ENABLED** – src/app/api/bookings/route.ts
- **BOOKINGS_FROM_EMAIL** – src/lib/assignment-notify-staff.ts, src/lib/notify.ts
- **BOOKINGS_INBOX_EMAIL** – src/lib/notify.ts
- **MAX_ATTENDEES** – src/lib/validation.ts
- **NEXTAUTH_URL** – src/app/api/bookings/route.ts
- **NEXT_PUBLIC_ENABLE_APPLE** – src/app/login/page.tsx
- **NEXT_PUBLIC_GOOGLE_MAPS_API_KEY** – src/components/AddressAutocomplete.tsx
- **NEXT_PUBLIC_MAX_ATTENDEES** – src/components/BookingForm.tsx
- **NEXT_PUBLIC_TIMEZONE** – src/app/admin/schedule/page.tsx, src/app/my-assignments/page.tsx
- **NEXT_PUBLIC_TURNSTILE_SITE_KEY** – src/components/BookingForm.tsx
- **NODE_ENV** – src/app/api/bookings/route.ts, src/lib/assignment-notify-staff.ts, src/lib/db.ts
- **RESEND_API_KEY** – src/lib/assignment-notify-staff.ts, src/lib/notify.ts
- **TURNSTILE_SECRET_KEY** – src/app/api/bookings/route.ts, src/lib/bot-verify.ts
- **TWILIO_ACCOUNT_SID** – src/lib/assignment-notify-staff.ts, src/lib/notify.ts
- **TWILIO_AUTH_TOKEN** – src/lib/assignment-notify-staff.ts, src/lib/notify.ts
- **TWILIO_SMS_FROM** – src/lib/assignment-notify-staff.ts, src/lib/notify.ts

## Files of Interest

- `src/lib/auto-assign.ts` – core algorithm for PATH/KIRTAN selection, fairness weighting, and jatha donor logic
- `src/lib/fairness.ts` – workload accounting over rolling weekly window, busy-staff detection
- `src/lib/scheduling.ts` – hall capacity thresholds and outside buffer rules
- `src/app/api/housekeeping/expire-pending/route.ts` – advisory lock + expiry of stale pending bookings
- `src/components/BookingForm.tsx` – client form w/ dynamic validation & field-level messaging
- `prisma/seed.ts` – initial halls, staff, program types
- `prisma/migrations/**` – DB evolution (assignments, windows, states)
