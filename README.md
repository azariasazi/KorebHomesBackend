# Koreb Homes — Backend API

Backend for **Koreb Homes**, a premium real estate listing platform for Ethiopia
(web + Android + iOS, all sharing this one API).

Built with **NestJS + TypeScript**, **PostgreSQL + Prisma** (with room to add PostGIS for
map/location search), payments via **Chapa** behind a swappable provider
interface, and phone + SMS OTP authentication with JWT access/refresh tokens.

---

## What's in this scaffold

| Area | Status |
|---|---|
| Auth — phone + SMS OTP, JWT access/refresh with rotation | ✅ |
| Users — profile CRUD, agent verification submission | ✅ |
| Listings — create, search/filter/sort/paginate, detail, dashboard, status lifecycle | ✅ |
| Photos — upload with compression + thumbnails, reorder, delete | ✅ |
| Favorites — idempotent add/remove/list | ✅ |
| Payments — Chapa integration + server-side-verified webhook | ✅ |
| Reports — "report this listing" | ✅ |
| Admin — review queue, user management, agent verification, dashboard stats, pricing controls (RBAC-locked to ADMIN) | ✅ |
| Jobs — listing inactivity nudge + auto-unpublish | ✅ |
| Fayda (eSignet) national-ID verification | ⏳ Placeholders reserved in `.env.example`; module not yet built |

---

## Prerequisites

- **Node.js** 20+ and npm
- **PostgreSQL** 14+ (PostGIS is not required yet — see the note in `prisma/schema.prisma`)
- A **Chapa** account (test keys are fine for development)

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and fill in values
cp .env.example .env
#    -> set DATABASE_URL, JWT secrets, Chapa keys, etc.

# 3. Generate the Prisma client + run the first migration
npm run prisma:generate
npm run prisma:migrate      # creates tables from prisma/schema.prisma

# 4. (Optional) seed demo data — admin/agent/owner/buyer + sample listings
npm run prisma:seed

# 5. Start the API in watch mode
npm run start:dev
```

The API listens on `http://localhost:3000` by default, under the prefix
`/api/v1` (both configurable in `.env`).

---

## Listing fees: currently OFF

Koreb launches free for its first 6–12 months. This is controlled by the
`LISTING_FEE_ENABLED` platform setting, which defaults to `false`.

- **Fee OFF** — `POST /listings/:id/submit` sends the listing straight to
  `AWAITING_REVIEW`. The payment step is skipped and `/payments/listing/initiate`
  returns a `400`.
- **Fee ON** — the same call routes to `AWAITING_PAYMENT` and the Chapa flow
  runs as normal.

**Admin review is mandatory in both cases.** The toggle decides whether money
changes hands, never whether a human checks the listing.

To switch fees on when the free period ends — no code change, no redeploy:

```
PATCH /api/v1/admin/settings/LISTING_FEE_ENABLED
{ "value": "true" }
```

The setting reads as *disabled* unless the value is exactly `true`, so a missing
row or a typo fails safe (free) rather than accidentally charging people.

> **Upgrading an existing database:** the toggle lives in the `PlatformSetting`
> table, so re-run `npm run prisma:seed` once to create the row. The seed uses
> upsert and won't disturb your existing data.

---

## Applying Change Request 05 (Continue with Google)

Adds Google sign-in alongside phone+OTP, makes `phone` nullable, and adds
`googleId` / `email` to users.

```bash
npx prisma migrate dev --name cr05_google_signin
npm test              # 37 tests — includes Google mapping + phone-attach guards
```

**Google Cloud setup (Azarias):** create an OAuth 2.0 Client ID in the Google
Cloud Console, then put it in `.env`:

```
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
```

The frontend runs the Google SDK and posts the resulting ID token to
`POST /auth/google`; the backend verifies it against this `GOOGLE_CLIENT_ID`.
Until it's set, `POST /auth/google` returns a clear "not configured" error and
the rest of auth is unaffected — so you can ship the migration before the Google
project is ready.

**Note on the migration:** `phone` becomes `String?` but stays `@unique`.
Postgres treats multiple NULLs as distinct, so many phone-less Google users
coexist fine under the unique index. Existing phone users are unaffected.

---

## Applying Change Request 04 (serve /uploads static files)

**No migration.** This change makes the app serve uploaded photos over HTTP, so
listing images actually display. Just rebuild/restart:

```bash
npm run start:dev
```

On startup you'll see a log line like
`Serving uploads from /…/koreb-backend/uploads at /uploads/`. Confirm it works by
opening any image URL directly, e.g.
`http://localhost:3000/uploads/listings/<id>_thumb.jpg` — it should return the
image, not "Cannot GET /uploads/…".

The served folder is resolved by the **same helper** the upload code writes with
(`src/common/uploads.path.ts`), so the save path and the served path can't drift
apart — the usual reason this fix appears done but still 404s. If you set a
custom `STORAGE_LOCAL_PATH` in `.env`, both sides follow it automatically.

---

## Applying Change Request 03 (sold/rented, suspension detail, floor range)

```bash
npx prisma migrate dev --name cr03_sold_rented_and_suspension
npm run prisma:seed   # optional
npm test              # 26 tests
```

Adds `SOLD`/`RENTED` to the listing status enum plus a `soldRentedAt` timestamp,
and a `suspendedAt` timestamp on users. Owners get `POST /listings/:id/mark-sold-rented`
and `.../mark-available`; sold/rented listings stay in search (badged, sorted last).
`GET /admin/users` now returns suspension detail. Editing a rejected listing
re-queues it for review automatically.

---

## Applying Change Request 02 (public contact number)

Adds a `publicContactPhone` column so Call / WhatsApp on Listing Detail work.

```bash
npx prisma migrate dev --name add_public_contact_phone
npm run prisma:seed   # optional: refreshes demo data
npm test              # 18 tests — includes the login-phone-privacy guard
```

The listing's `owner` object and `GET /users/:id/public` now return a single
`contactPhone` (public number if set, else the account phone). The raw login
`phone` is never exposed publicly — a test enforces this.

---

## Applying Change Request 01 (unit fields + structured rejections)

If you already have a database from before this change, run these in order:

```bash
# 1. Create and apply the migration for the new columns
npx prisma migrate dev --name add_unit_fields_and_rejection_detail

# 2. Backfill the old free-text `floor` into the new structured `floorNumber`
npx ts-node prisma/backfill-floor-number.ts
#    -> anything it can't parse is listed at the end for manual review

# 3. Verify the privacy guarantee still holds
npm test
```

The legacy `floor` column is intentionally **kept** for now so no data is lost.
Once the backfill output is clean and you've spot-checked a few listings, the
`floor` column can be dropped in a follow-up migration.

> **Do not skip step 3.** The test suite asserts that `unitNumber` never appears
> in a public API response. That's the single most damaging regression possible
> in this change set — a unit number is a precise home address.

---

## Testing

```bash
npm test          # run once
npm run test:watch
```

Current coverage is focused on the privacy guarantee around private listing
fields (`src/listings/listings.service.spec.ts`). Broader coverage is a
follow-on task.

> **Note on Prisma + offline environments:** `prisma generate` downloads a
> small engine binary the first time. If you're behind a restrictive network,
> ensure `binaries.prisma.sh` is reachable, or consult the Prisma docs on
> offline installs.

---

## Project structure

```
koreb-backend/
├─ prisma/
│  ├─ schema.prisma        # all tables + enums (source of truth for the DB)
│  └─ seed.ts              # demo data + default platform settings
├─ src/
│  ├─ main.ts              # bootstrap (CORS, helmet, validation, raw body for webhooks)
│  ├─ app.module.ts        # wires in every feature module (incl. AdminModule)
│  ├─ common/              # shared decorators, guards, filters, provider interfaces
│  │  ├─ decorators/       # @Roles, @CurrentUser
│  │  ├─ guards/           # JwtAuthGuard, JwtRefreshGuard, RolesGuard
│  │  ├─ filters/          # global HTTP exception filter
│  │  └─ interfaces/       # SmsProvider + PaymentProvider (swappable contracts)
│  ├─ prisma/              # PrismaModule + PrismaService
│  ├─ auth/                # OTP + JWT; console SMS provider stub
│  ├─ users/               # profile + agent verification submission
│  ├─ listings/            # core listings: create/search/detail/dashboard
│  ├─ photos/              # upload + sharp compression
│  ├─ favorites/
│  ├─ payments/            # Chapa provider + webhook
│  ├─ reports/
│  ├─ admin/               # admin panel backend (ADMIN-only)
│  └─ jobs/                # scheduled inactivity/auto-unpublish job
├─ .env.example
├─ package.json
└─ tsconfig.json
```

---

## Key design decisions

- **Swappable providers.** SMS delivery and payments both sit behind interfaces
  (`SmsProvider`, `PaymentProvider`). Today they're `ConsoleSmsProvider` (logs
  codes for local dev) and `ChapaProvider`. Swapping either for a different
  vendor is a one-line change in the relevant module — no other code changes.

- **Payments are verified server-side.** The Chapa webhook is never trusted on
  its own: the signature is checked *and* the transaction is independently
  re-verified with Chapa before any listing is marked paid. Settling is
  idempotent, so duplicate webhooks are safe.

- **Listing status lifecycle:**
  `DRAFT → AWAITING_PAYMENT → AWAITING_REVIEW → LIVE`, with `REJECTED`,
  `UNPUBLISHED` (inactivity), and `ARCHIVED` as side states. Editing a *live*
  listing sends it back through review to prevent bait-and-switch.

- **Admin-editable pricing.** Listing fees and the penalty multiplier live in
  the `PlatformSetting` table and are editable from the Admin Panel — no code
  deploy needed to change pricing.

- **Inactivity handling.** Stale live listings are *unpublished, never deleted*,
  after a nudge + grace period, so owners can renew them back to live. Admin can
  override at any stage.

---

## API surface (high level)

All routes are under `/api/v1`.

**Auth** — `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`
**Users** — `GET/PATCH /users/me`, `POST /users/me/verification`, `GET /users/:id/public`
**Listings** — `GET /listings` (search), `GET /listings/:id`, `POST /listings`, `GET /listings/mine/dashboard`, `PATCH/DELETE /listings/:id`, `POST /listings/:id/submit`, `POST /listings/:id/renew`
**Photos** — `POST/DELETE /listings/:listingId/photos`, `POST /listings/:listingId/photos/reorder`
**Favorites** — `GET /favorites`, `POST/DELETE /favorites/:listingId`
**Payments** — `POST /payments/listing/initiate`, `POST /payments/webhook`, `POST /payments/verify`, `GET /payments/mine`
**Reports** — `POST /listings/:listingId/report`
**Admin** (ADMIN role only) — `GET /admin/dashboard`, `GET /admin/listings/review-queue`, `POST /admin/listings/:id/approve|reject`, `GET /admin/users`, `POST /admin/users/:id/suspend|unsuspend`, `GET /admin/verification/queue`, `POST /admin/verification/:userId/approve|reject`, `GET /admin/reports`, `GET/PATCH /admin/settings`

---

## Next steps (backend)

- Build the **Fayda (eSignet / OpenID Connect)** module for national-ID
  verification (env placeholders already reserved).
- Add an **S3-compatible storage driver** for photos before production
  (currently `local` disk for dev).
- Wire the inactivity job's nudge hook to a real **SMS/push notification**
  channel.
- Add automated tests.
