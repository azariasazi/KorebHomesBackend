# Koreb Homes — API Reference (for Frontend Developers)

This document describes the **Koreb Homes backend API** so the web (Next.js) and
mobile (React Native) frontends can be built against it. It reflects the actual
NestJS controllers in the `koreb-backend` codebase.

> **This is the contract the frontend consumes.** The frontend does not need the
> backend's internal implementation — it needs the endpoints, what they expect,
> and what they return. That's what's below.

---

## Conventions

- **Base URL:** `http://localhost:3000` in development. All routes are prefixed
  with **`/api/v1`**. So the full path to, e.g., search is
  `http://localhost:3000/api/v1/listings`.
- **Format:** JSON request and response bodies (except photo upload, which is
  `multipart/form-data`).
- **Auth:** Protected routes require an **access token** in the header:
  `Authorization: Bearer <accessToken>`.
- **Errors:** Every error comes back in a consistent shape:
  ```json
  {
    "statusCode": 400,
    "message": "Human-readable message (or array of messages for validation)",
    "error": "Bad Request",
    "path": "/api/v1/...",
    "timestamp": "2026-07-21T09:00:00.000Z"
  }
  ```
- **Roles:** `BUYER_RENTER`, `OWNER`, `AGENT`, `ADMIN`.
- **Money:** all amounts are in **ETB** (Ethiopian Birr).

---

## Authentication flow (how login actually works)

Koreb uses **phone number + SMS OTP** — there are no passwords.

1. User enters their phone number → frontend calls `POST /auth/otp/request`.
2. User receives an SMS code → frontend calls `POST /auth/otp/verify` with the
   code. On the **first** verify for a new phone, this also creates the account
   (pass `role` and optionally `name`). On subsequent verifies it just logs in.
3. The verify response returns `accessToken`, `refreshToken`, and `user`.
   - Store both tokens securely (e.g. secure storage on mobile, httpOnly cookie
     or secure storage on web).
   - Send `accessToken` as a Bearer token on every protected request.
4. When the access token expires (~15 min), call `POST /auth/refresh` with the
   `refreshToken` to get a fresh pair. **Refresh tokens rotate** — each refresh
   returns a new refresh token and invalidates the old one, so always replace
   the stored one.

> **In development**, there is no real SMS provider wired up yet — the OTP code
> is printed to the backend server console. Watch the terminal running the API
> to get the code while testing.

---

## Auth endpoints

### `POST /auth/otp/request`
Request an SMS verification code. *(Rate-limited: ~3/min.)*

**Body**
```json
{ "phone": "+251912345678" }
```
**Response `201`**
```json
{ "message": "Verification code sent.", "expiresInSeconds": 300 }
```

---

### `POST /auth/otp/verify`
Verify the code. Creates the account on first use, logs in thereafter.

**Body**
```json
{
  "phone": "+251912345678",
  "code": "123456",
  "role": "OWNER",   // optional; only used on first-time signup. Omit for login.
  "name": "Dawit Alemu"  // optional
}
```
**Response `201`**
```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "user": { "id": "uuid", "phone": "+251912345678", "role": "OWNER" }
}
```

---

### `POST /auth/refresh`
Exchange a valid refresh token for a new token pair.

**Body**
```json
{ "refreshToken": "eyJhbGci..." }
```
**Response `201`** — same shape as verify (new `accessToken` + `refreshToken`).

---

### `POST /auth/logout` 🔒
Revokes the refresh token. Requires `Authorization: Bearer <accessToken>`.

**Body**
```json
{ "refreshToken": "eyJhbGci..." }
```
**Response `201`**
```json
{ "message": "Logged out." }
```

---

## Users endpoints

### `GET /users/me` 🔒
Returns the current user's profile.
```json
{
  "id": "uuid",
  "phone": "+251912345678",
  "name": "Dawit Alemu",
  "profilePhotoUrl": null,
  "city": "Addis Ababa",
  "role": "OWNER",
  "verificationStatus": "NOT_SUBMITTED",
  "agencyName": null,
  "createdAt": "2026-07-21T09:00:00.000Z"
}
```

### `PATCH /users/me` 🔒
Update profile. **Body** (all optional): `name`, `city`, `profilePhotoUrl`.

### `POST /users/me/verification` 🔒
Agent submits a verification document (moves them to `PENDING`). **AGENT role only.**
**Body**
```json
{ "documentUrl": "https://.../doc.jpg", "agencyName": "Habesha Realty", "note": "optional" }
```

### `GET /users/:id/public`
Public agent/owner card shown on a listing. No auth required.
```json
{
  "id": "uuid",
  "name": "Selam Tesfaye",
  "profilePhotoUrl": null,
  "role": "AGENT",
  "agencyName": "Habesha Realty",
  "isVerifiedAgent": true
}
```

> **`verificationStatus`** values: `NOT_SUBMITTED`, `PENDING`, `APPROVED`, `REJECTED`.

---

## Listings endpoints

### `GET /listings`
Public search / browse. Only `LIVE` listings are returned. All params optional,
passed as query string (e.g. `/listings?city=Addis Ababa&listingType=RENT&page=1`).

| Param | Type | Notes |
|---|---|---|
| `city` | string | |
| `subCity` | string | |
| `propertyType` | enum | `HOUSE`, `APARTMENT`, `LAND`, `COMMERCIAL` |
| `listingType` | enum | `SALE`, `RENT` |
| `minPrice` / `maxPrice` | number | ETB |
| `minBedrooms` | int | |
| `swLat`,`swLng`,`neLat`,`neLng` | number | map bounding-box search (all four together) |
| `keyword` | string | matches description / area / city |
| `sort` | enum | `newest` (default), `price_asc`, `price_desc` |
| `page` | int | default 1 |
| `pageSize` | int | default 20, max 50 |

**Response `200`**
```json
{
  "items": [ /* array of listing objects, see shape below */ ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

### `GET /listings/:id`
Public listing detail. Only returns `LIVE` listings. Increments view count.
Returns a **listing object** (see shape below) including `photos[]` and `owner`.

### `POST /listings` 🔒
Create a listing. **OWNER or AGENT only.** Starts in `DRAFT` status.
**Body**
```json
{
  "propertyType": "APARTMENT",
  "listingType": "RENT",
  "priceEtb": 28000,
  "region": "Addis Ababa",
  "city": "Addis Ababa",
  "subCity": "Bole",
  "areaName": "Near Edna Mall",
  "latitude": 8.9954,
  "longitude": 38.7894,
  "bedrooms": 3,
  "bathrooms": 2,
  "sizeSqm": 180,
  "floor": "2nd",
  "furnished": true,
  "amenities": ["parking", "water_tank", "generator", "security"],
  "descriptionEn": "Bright apartment near Edna Mall.",
  "descriptionAm": "..."
}
```
Only `propertyType`, `listingType`, `priceEtb`, `region`, `city` are required.

### `GET /listings/mine/dashboard` 🔒
The current owner/agent's own listings (any status), newest first. Powers the
Owner/Agent Dashboard screen. **OWNER or AGENT only.**

### `GET /listings/mine/:id` 🔒
One of the current user's own listings, including photos. **OWNER or AGENT only.**

### `PATCH /listings/:id` 🔒
Update own listing. Same body fields as create (all optional). **Note:** editing a
listing that is currently `LIVE` sends it **back to `AWAITING_REVIEW`**.

### `DELETE /listings/:id` 🔒
Remove own listing. Returns `{ "message": "Listing removed." }`.

### `POST /listings/:id/submit-for-payment` 🔒
Moves a `DRAFT` (or `REJECTED`) listing to `AWAITING_PAYMENT` — the step before
initiating the listing-fee payment.

### `POST /listings/:id/renew` 🔒
Resets the inactivity clock on a live/unpublished listing (back to `LIVE`).

---

### Listing object shape
```json
{
  "id": "uuid",
  "ownerId": "uuid",
  "propertyType": "APARTMENT",
  "listingType": "RENT",
  "priceEtb": "28000",
  "region": "Addis Ababa",
  "city": "Addis Ababa",
  "subCity": "Bole",
  "areaName": "Near Edna Mall",
  "latitude": 8.9954,
  "longitude": 38.7894,
  "bedrooms": 3,
  "bathrooms": 2,
  "sizeSqm": 180,
  "floor": "2nd",
  "furnished": true,
  "amenities": ["parking", "water_tank"],
  "descriptionEn": "...",
  "descriptionAm": null,
  "status": "LIVE",
  "viewCount": 12,
  "isFeatured": false,
  "publishedAt": "2026-07-21T09:00:00.000Z",
  "createdAt": "...",
  "updatedAt": "...",
  "photos": [
    { "id": "uuid", "url": "/uploads/listings/x.jpg", "thumbUrl": "/uploads/listings/x_thumb.jpg", "sortOrder": 0 }
  ],
  "owner": {
    "id": "uuid", "name": "Selam Tesfaye", "profilePhotoUrl": null,
    "role": "AGENT", "agencyName": "Habesha Realty", "verificationStatus": "APPROVED"
  }
}
```

> **Listing status lifecycle:**
> `DRAFT → AWAITING_PAYMENT → AWAITING_REVIEW → LIVE`
> plus `REJECTED`, `UNPUBLISHED` (inactivity), `ARCHIVED`.
> `priceEtb` comes back as a **string** (it's a decimal) — parse it on the frontend.

---

## Photos endpoints

### `POST /listings/:listingId/photos` 🔒
Upload one photo. **OWNER or AGENT only.** `multipart/form-data` with a single
field named **`file`** (an image). Backend compresses it and makes a thumbnail.
Max 10 photos per listing; max ~8 MB per file; images only.
**Response `201`** — the created photo object (`id`, `url`, `thumbUrl`, `sortOrder`).

### `POST /listings/:listingId/photos/reorder` 🔒
**Body**
```json
{ "orderedPhotoIds": ["photoId1", "photoId2", "photoId3"] }
```

### `DELETE /listings/:listingId/photos/:photoId` 🔒
Remove a photo.

> **Dev note:** uploaded photos are served from `/uploads/...` on the API host in
> development. In production these move to object storage — the `url`/`thumbUrl`
> fields are what you render regardless, so no frontend change needed.

---

## Favorites endpoints (all 🔒)

### `GET /favorites`
The current user's favorited **LIVE** listings, each including the listing and
its first photo. Powers the Favorites screen.

### `POST /favorites/:listingId`
Add to favorites. Idempotent (safe to call if already favorited).

### `DELETE /favorites/:listingId`
Remove from favorites. Idempotent.

---

## Payments endpoints

Listing fees are paid via **Chapa** (which covers Telebirr, CBE Birr, HelloCash,
and card). The flow:

1. Listing is in `AWAITING_PAYMENT` (after `submit-for-payment`).
2. Frontend calls `POST /payments/listing/initiate` → gets a `checkoutUrl`.
3. Frontend **redirects the user to `checkoutUrl`** (Chapa-hosted checkout).
4. After payment, Chapa notifies the backend (webhook) which verifies it
   server-side and moves the listing to `AWAITING_REVIEW`.
5. As a fallback, when the user returns, frontend can call `POST /payments/verify`
   with the `txRef` to confirm status.

### `POST /payments/listing/initiate` 🔒
**Body**
```json
{ "listingId": "uuid" }
```
**Response `201`**
```json
{ "paymentId": "uuid", "checkoutUrl": "https://checkout.chapa.co/...", "amountEtb": 250 }
```

### `POST /payments/verify` 🔒
**Body**
```json
{ "txRef": "koreb-xxxx-yyyy" }
```
**Response** `{ "status": "SUCCESS" | "PENDING" | "FAILED" }`

### `GET /payments/mine` 🔒
The current user's payment history (receipts).

### `POST /payments/webhook`
**Server-to-server only — the frontend never calls this.** Chapa calls it.

---

## Reports endpoint

### `POST /listings/:listingId/report` 🔒
"Report this listing." **Body**
```json
{ "reason": "Fake listing", "details": "optional extra context" }
```

---

## Admin endpoints (all 🔒 + **ADMIN role only**)

These power the web-based Admin Panel. A non-admin token gets `403`.

| Method & path | Purpose |
|---|---|
| `GET /admin/dashboard` | Stats: totalListings, totalUsers, awaitingReview, revenueCollectedEtb, openReports |
| `GET /admin/listings/review-queue` | Listings awaiting review (paginated: `?page=&pageSize=`) |
| `POST /admin/listings/:id/approve` | Approve → sets listing `LIVE` |
| `POST /admin/listings/:id/reject` | Reject. Body: `{ "reason": "..." }` |
| `GET /admin/users` | All users (optional `?role=AGENT`) |
| `POST /admin/users/:id/suspend` | Body: `{ "reason": "..." }` |
| `POST /admin/users/:id/unsuspend` | |
| `GET /admin/verification/queue` | Agents pending verification |
| `POST /admin/verification/:userId/approve` | Grant Verified Agent badge |
| `POST /admin/verification/:userId/reject` | Body: `{ "reason": "..." }` |
| `GET /admin/reports` | Reports (optional `?status=OPEN`) |
| `POST /admin/reports/:id/resolve` | Body: `{ "status": "REVIEWED"|"DISMISSED", "note": "..." }` |
| `GET /admin/settings` | Platform settings (listing fees, penalty multiplier) |
| `PATCH /admin/settings/:key` | Change a setting. Body: `{ "value": "300" }` |

---

## Quick reference: which screens use which endpoints

| Mockup screen | Primary endpoints |
|---|---|
| **Sign Up** | `POST /auth/otp/request`, `POST /auth/otp/verify` |
| **Home Feed** | `GET /listings` (+ query params for filters/sort/map) |
| **Listing Detail** | `GET /listings/:id`, `POST /favorites/:id`, `POST /listings/:id/report` |
| **Post a Listing** | `POST /listings`, `POST /listings/:id/photos`, `POST /listings/:id/submit-for-payment`, `POST /payments/listing/initiate` |
| **Owner/Agent Dashboard** | `GET /listings/mine/dashboard`, `PATCH`/`DELETE /listings/:id`, `POST /listings/:id/renew` |
| **Search Filters** | `GET /listings` with filter params |
| **Favorites** | `GET /favorites`, `DELETE /favorites/:id` |
| **Admin Panel** | the `/admin/*` endpoints above |

🔒 = requires `Authorization: Bearer <accessToken>`

---

## Not built yet (so the frontend can plan around it)

- **Fayda (national ID) verification** — will be required before a user can post
  their first listing. Endpoint shape TBD once onboarding credentials are in hand.
- **In-app messaging** (Phase 2) — for now, contact is Call / WhatsApp / Telegram
  links built on the frontend from the owner's phone number.
