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

Koreb uses **phone number + SMS OTP** as its primary login — there are no
passwords. **"Continue with Google"** is an optional fast path (see
`POST /auth/google`): it signs a user in, but because listings expose a contact
phone and Fayda ID verification is phone-anchored, a phone is still required
before a user can post. A Google-first user is signed in immediately with
`needsPhone: true`, then attaches a phone via the same OTP flow below.

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
Verify the code. Behaviour depends on whether the request carries an access token:
- **No token (normal signup/login):** creates the account on first use, logs in thereafter.
- **With a valid `Authorization: Bearer` token (attach phone):** attaches the
  verified phone to the *currently authenticated* account. This is how a
  Google-first user (who has no phone yet) ends up with ONE account holding both
  their Google identity and their phone — not a second account.

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
Attaching a phone already linked to a different account returns `400`.

---

### `POST /auth/google`
"Continue with Google." The frontend runs the Google SDK, obtains a Google **ID
token**, and posts it here. The backend verifies it server-side, then finds,
creates, or links the Koreb account and returns **our own** session tokens (same
shape as OTP verify) plus a `needsPhone` flag.

**Body**
```json
{ "idToken": "<google-id-token-from-frontend-sdk>" }
```
**Response `201`**
```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "needsPhone": true,
  "user": { "id": "uuid", "phone": null, "role": "BUYER_RENTER" }
}
```

**How the account is resolved:**
1. Known `googleId` → sign in.
2. Else a **verified** Google email matching an existing account → link Google to
   it and sign in. (Unverified emails never link — prevents account hijacking.)
3. Else create a new account with `phone: null`, `role: BUYER_RENTER`.

**`needsPhone`** is `true` whenever the account has no phone. When true, the
frontend must run the phone+OTP attach step (call `POST /auth/otp/verify` **with
the access token** from this response) before the user can post a listing.
Browsing and favoriting work without a phone; **posting requires one.**

> Phone + OTP remains the primary identity. Google is a convenience layer — it
> gets a user in, but a phone still completes the account.

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
  "email": null,
  "name": "Dawit Alemu",
  "profilePhotoUrl": null,
  "city": "Addis Ababa",
  "role": "OWNER",
  "verificationStatus": "NOT_SUBMITTED",
  "agencyName": null,
  "publicContactPhone": null,
  "effectiveContactPhone": "+251912345678",
  "hasGoogleLinked": false,
  "needsPhone": false,
  "createdAt": "2026-07-21T09:00:00.000Z"
}
```
- `phone` — the login number (private, only ever returned to the user themselves here). `null` for a Google-first user who hasn't attached one yet.
- `email` — from Google sign-in, if any.
- `hasGoogleLinked` — whether a Google account is linked.
- `needsPhone` — `true` when `phone` is null; the user must attach a phone (via OTP) before posting a listing.
- `publicContactPhone` — the number the user chose to show publicly, or `null` if unset.
- `effectiveContactPhone` — what actually appears on their listings right now:
  their public number if set, otherwise their account phone. Useful for showing
  the user "this is the number buyers currently see."

### `PATCH /users/me` 🔒
Update profile. **Body** (all optional): `name`, `city`, `profilePhotoUrl`,
`publicContactPhone`.
- `publicContactPhone` must be a valid phone number (e.g. `+251912345678`).
- Send `publicContactPhone: ""` (empty string) to **clear** it and fall back to
  the account phone.

> **Frontend — the informed default.** New users have no `publicContactPhone`,
> so their **account phone shows on their listings by default.** The profile
> screen should make this visible — show the `effectiveContactPhone` with a note
> like "This number is shown on your listings" and let them change it. That way
> the default is informed, not a surprise. Agents typically set a business line
> here; private owners can keep or change theirs.

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
  "isVerifiedAgent": true,
  "contactPhone": "+251911777888"
}
```
`contactPhone` is the number to build Call / WhatsApp links from — the user's
public contact number if they set one, otherwise their account phone. May be
`null` only if a user somehow has neither. **The login phone is never exposed as
its own field.**

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
  "buildingName": "Zefmesh Grand",
  "unitNumber": "4B",
  "floorNumber": 4,
  "furnished": true,
  "amenities": ["parking", "water_tank", "generator", "security"],
  "descriptionEn": "Bright apartment near Edna Mall.",
  "descriptionAm": "..."
}
```
Only `propertyType`, `listingType`, `priceEtb`, `region`, `city` are required —
**plus `unitNumber`, which is required when `propertyType` is `APARTMENT`.**

**Building / unit fields:**

| Field | Type | Visibility | Notes |
|---|---|---|---|
| `buildingName` | string | **Public** | Optional for all types. Strongly encourage it in the UI for apartments — most named developments have one and it's useful for search. Max 120 chars. |
| `unitNumber` | string | **Private** | **Required for `APARTMENT`**, optional otherwise. Max 20 chars, trimmed. Never appears in any public response — see the privacy note below. |
| `floorNumber` | int | **Public** | `-1` = basement, `0` = ground, `1`+ = upper floors. Accepts **-5 to 200**. Replaces the old free-text `floor`. |

> ### ⚠️ Privacy: `unitNumber` is captured but never published
> An exact unit number is a precise home address. For a rental someone usually
> still lives there; for a vacant unit for sale, publishing it announces that a
> specific empty apartment sits behind a specific door.
>
> **Frontend requirement:** when you ask for the unit number in the Post a
> Listing form, show a clear note beside the field saying it is **not shown
> publicly** — otherwise owners are reasonably alarmed at being asked for it.
> It's visible only to the owner who posted it and to Admin.

> **Note on `floor`:** the old free-text `floor` field still exists during the
> transition and is still returned, but it's deprecated. Build against
> `floorNumber` — `floor` is dropped in a follow-up migration.

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

### `POST /listings/:id/submit` 🔒
Submits a `DRAFT` (or `REJECTED`) listing for publication.

**Where it goes next depends on whether listing fees are switched on:**

```json
// Response when fees are OFF (current free launch period)
{ "...listing fields": "...", "status": "AWAITING_REVIEW", "requiresPayment": false }

// Response when fees are ON
{ "...listing fields": "...", "status": "AWAITING_PAYMENT", "requiresPayment": true }
```

**Frontend: branch on `requiresPayment`.**
- `false` → go straight to a "Submitted — pending review" confirmation screen.
- `true` → call `POST /payments/listing/initiate` and send the user to checkout.

Build both paths now even though fees are currently off, so nothing needs
rewriting when the toggle flips.

> ### Listing fees are currently DISABLED
> Koreb is free for its first 6–12 months. The `LISTING_FEE_ENABLED` platform
> setting is `false`, so listings skip payment entirely. Calling
> `POST /payments/listing/initiate` while fees are off returns a `400`.
>
> **Admin review is mandatory regardless** — every listing is reviewed by an
> admin before going live, in both the free and paid periods. The toggle only
> controls whether money changes hands.
>
> An admin flips it via `PATCH /admin/settings/LISTING_FEE_ENABLED` with
> `{ "value": "true" }`. No code change or redeploy needed.

### `POST /listings/:id/renew` 🔒
Resets the inactivity clock on a live/unpublished listing (back to `LIVE`).

### `POST /listings/:id/mark-sold-rented` 🔒
Marks a **LIVE** listing as sold or rented. No body — the resulting status is
derived from the listing's own `listingType` (a `SALE` becomes `SOLD`, a `RENT`
becomes `RENTED`), so the frontend can't send a mismatched status. Sets
`soldRentedAt` to now. **OWNER or AGENT only.** Fails if the listing isn't LIVE.

The listing **stays visible in search and detail** with its `SOLD`/`RENTED`
status and `soldRentedAt` timestamp — render a badge and grey it out. Sold/rented
listings are automatically sorted **below** available ones in search results.

### `POST /listings/:id/mark-available` 🔒
Reverses the above — returns a `SOLD`/`RENTED` listing to `LIVE` and clears
`soldRentedAt` (e.g. a deal fell through, or it was tapped by mistake). Also
resets the inactivity clock. Fails if the listing isn't currently sold/rented.

### `PATCH /listings/:id` on a REJECTED listing — edit = resubmit 🔒
Editing a `REJECTED` listing via `PATCH` **automatically re-queues it** to
`AWAITING_REVIEW` and clears `rejectionCode` / `rejectionReason` / `rejectedAt`.
The edit *is* the resubmission — no separate `submit` call is required (though
calling `submit` afterwards is harmless). Same as editing a `LIVE` listing,
which also returns to review to prevent bait-and-switch.

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
  "buildingName": "Zefmesh Grand",
  "floorNumber": 4,
  "floor": "2nd",
  "furnished": true,
  "amenities": ["parking", "water_tank"],
  "descriptionEn": "...",
  "descriptionAm": null,
  "status": "LIVE",
  "viewCount": 12,
  "isFeatured": false,
  "publishedAt": "2026-07-21T09:00:00.000Z",
  "soldRentedAt": null,
  "createdAt": "...",
  "updatedAt": "...",
  "photos": [
    { "id": "uuid", "url": "/uploads/listings/x.jpg", "thumbUrl": "/uploads/listings/x_thumb.jpg", "sortOrder": 0 }
  ],
  "owner": {
    "id": "uuid", "name": "Selam Tesfaye", "profilePhotoUrl": null,
    "role": "AGENT", "agencyName": "Habesha Realty", "verificationStatus": "APPROVED",
    "contactPhone": "+251911777888"
  }
}
```

> **Listing status lifecycle:**
> `DRAFT → AWAITING_PAYMENT → AWAITING_REVIEW → LIVE`
> plus `REJECTED`, `UNPUBLISHED` (inactivity), `SOLD`, `RENTED`, `ARCHIVED`.
> `SOLD`/`RENTED` are owner-set and remain publicly visible with a badge.
> `priceEtb` comes back as a **string** (it's a decimal) — parse it on the frontend.

### Private fields — which endpoints return them

`unitNumber`, `rejectionCode`, `rejectionReason` and `rejectedAt` are returned
**only** on the owner's own listings and to Admin. The public endpoints omit
them entirely (they aren't `null` — the keys are simply absent).

| Endpoint | Private fields included? |
|---|---|
| `GET /listings` (public search) | ❌ No |
| `GET /listings/:id` (public detail) | ❌ No |
| `GET /listings/mine/dashboard` | ✅ Yes — it's the owner's own listing |
| `GET /listings/mine/:id` | ✅ Yes |
| `GET /admin/listings/review-queue` | ✅ Yes |
| any `/admin/*` listing response | ✅ Yes |

**When a listing is rejected**, the owner's dashboard response includes:
```json
{
  "status": "REJECTED",
  "rejectionCode": "DUPLICATE",
  "rejectionReason": "Same unit as listing #1183, posted 3 days ago.",
  "rejectedAt": "2026-07-22T14:05:00.000Z"
}
```
`rejectionReason` is optional and may be `null` — always render the human-readable
label for `rejectionCode` as the primary message, with the note as extra context.
These three fields are cleared when the listing is resubmitted or approved.

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

> **Dev note:** uploaded photos are served as static files at `/uploads/...` on
> the API host — **outside** the `/api/v1` prefix. So a `thumbUrl` of
> `/uploads/listings/x_thumb.jpg` is fetched at `http://<host>/uploads/listings/x_thumb.jpg`
> (note: no `/api/v1`). The `url`/`thumbUrl` fields already carry the right path —
> resolve them against the server origin, not the API base. In production these
> move to object storage and become absolute `https://...` URLs; render them
> as-is with no change.

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

1. Listing is in `AWAITING_PAYMENT` (after `submit`, when fees are enabled).
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
| `POST /admin/listings/:id/reject` | Reject. Body: `{ "code": "DUPLICATE", "note": "optional context" }` — see rejection codes below |
| `GET /admin/users` | All users (optional `?role=AGENT`). Each user includes `isSuspended`, `suspendedReason`, `suspendedAt` for the Suspended badge |
| `POST /admin/users/:id/suspend` | Body: `{ "reason": "..." }` |
| `POST /admin/users/:id/unsuspend` | |
| `GET /admin/verification/queue` | Agents pending verification |
| `POST /admin/verification/:userId/approve` | Grant Verified Agent badge |
| `POST /admin/verification/:userId/reject` | Body: `{ "reason": "..." }` |
| `GET /admin/reports` | Reports (optional `?status=OPEN`) |
| `POST /admin/reports/:id/resolve` | Body: `{ "status": "REVIEWED"|"DISMISSED", "note": "..." }` |
| `GET /admin/settings` | Platform settings (listing fees, penalty multiplier) |
| `PATCH /admin/settings/:key` | Change a setting. Body: `{ "value": "300" }` |

### Rejection codes

`POST /admin/listings/:id/reject` takes a required `code` plus an optional
free-text `note`. Render `code` as a **dropdown** in the Admin review queue:

| Code | Suggested label |
|---|---|
| `DUPLICATE` | Duplicate listing |
| `SUSPECTED_FRAUD` | Suspected fraud |
| `POOR_PHOTOS` | Photos unclear or unusable |
| `INCOMPLETE_DETAILS` | Incomplete details |
| `PRICE_IMPLAUSIBLE` | Price looks implausible |
| `PROHIBITED_CONTENT` | Prohibited content |
| `WRONG_CATEGORY` | Wrong category |
| `OTHER` | Other (please add a note) |

Sending `{ "reason": "..." }` — the old shape — is no longer accepted and
returns a `400`.

---

## Quick reference: which screens use which endpoints

| Mockup screen | Primary endpoints |
|---|---|
| **Sign Up** | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/google` (Continue with Google → may return `needsPhone: true`, then OTP-attach) |
| **Home Feed** | `GET /listings` (+ query params for filters/sort/map) |
| **Listing Detail** | `GET /listings/:id` (owner object carries `contactPhone` for Call/WhatsApp), `POST /favorites/:id`, `POST /listings/:id/report` |
| **Post a Listing** | `POST /listings`, `POST /listings/:id/photos`, `POST /listings/:id/submit`, `POST /payments/listing/initiate` — now includes building name / unit number / floor number fields |
| **Owner/Agent Dashboard** | `GET /listings/mine/dashboard`, `PATCH`/`DELETE /listings/:id`, `POST /listings/:id/renew`, `POST /listings/:id/mark-sold-rented`, `POST /listings/:id/mark-available` — rejected listings show `rejectionCode` + `rejectionReason`; editing a rejected listing re-queues it automatically |
| **Search Filters** | `GET /listings` with filter params |
| **Favorites** | `GET /favorites`, `DELETE /favorites/:id` |
| **Admin Panel** | the `/admin/*` endpoints above |

🔒 = requires `Authorization: Bearer <accessToken>`

---

## Not built yet (so the frontend can plan around it)

- **Fayda (national ID) verification** — will be required before a user can post
  their first listing. Endpoint shape TBD once onboarding credentials are in hand.
- **In-app messaging** (Phase 2) — for now, contact is Call / WhatsApp / Telegram
  links built on the frontend from the owner's **`contactPhone`** (on the listing's
  `owner` object, and on `GET /users/:id/public`). See Change Request 02.
