# Tourx Firestore Security Specification

## 1. Data Invariants

1. **Identity Integrity**: Users can only create and update their own profile (`/users/{uid}`) and private PII document (`/users/{uid}/private/info`). No user can read another user's private PII (`email`, `phone`, `payoutUpiId`, `payeeName`).
2. **Host Ownership Enforcement**: Only verified users with `accountType == 'host'` in `/users/{uid}` can create listings in `/listings/{listingId}` and payment destinations in `/listing_payment_destinations/{listingId}`, and only the exact owner (`hostId == request.auth.uid`) can update, pause, block calendar dates on, or delete their listings.
3. **Payment Destination Privacy**: `/listing_payment_destinations/{listingId}` disables `list` queries (`allow list: if false`) so unauthenticated visitors or scrapers cannot enumerate host payment numbers. Only signed-in users (`isSignedIn()`) can `get` a single listing's payment destination during checkout.
4. **Booking Privacy & Atomic Availability**: Booking records (`/bookings/{bookingId}`) contain guest names, UPI handles, host payout details, and transaction references, so reads (`get` and `list`) are strictly scoped to `travellerId == request.auth.uid` or `hostId == request.auth.uid`. Every booking creation and cancellation must atomically synchronize `/listing_availability/{bookingId}` (`existsAfter`).
5. **Immutable Financial Fields & Terminal States**: Once a booking is created with `paymentStatus == 'paid'` and `bookingStatus == 'confirmed'`, amounts, host payment destination fields, payment methods, transaction references, and owner IDs cannot be mutated. Bookings in terminal states (`completed`, `cancelled`) cannot be modified.
6. **Temporal Integrity & Bounded Payloads**: Every `create` checks `createdAt == request.time && updatedAt == request.time`; every `update` checks `createdAt` immutability and `updatedAt == request.time`. All strings and arrays have strict upper size bounds.

## 2. Dirty Dozen Adversarial Payloads

1. **Shadow Field Injection on Listing**: Creating a listing with an unallowed key `isVerifiedFeatured: true` -> Rejected by `keys().hasOnly(...)`.
2. **Identity Spoofing on Listing**: User A creating a listing with `hostId: "userB"` -> Rejected by `incoming().hostId == request.auth.uid`.
3. **Traveller Privilege Bypass on Listing**: A user with `accountType: 'traveller'` attempting to create a listing -> Rejected by `isHostAccount()`.
4. **Cross-Host Payment Destination Hijack**: Host B overwriting `/listing_payment_destinations/hostA_listing` with Host B's UPI ID -> Rejected by parent listing `hostId == request.auth.uid`.
5. **Payment Destination Scraping Attack**: User attempting `list` on `/listing_payment_destinations` -> Rejected by `allow list: if false`.
6. **PII Blanket Read Attack**: Authenticated User B attempting `get` or `list` on `/users/userA/private/info` -> Rejected by `isOwner(userId)`.
7. **Booking Scraping Attack**: Authenticated User C executing a `list` query on `/bookings` without filtering to `travellerId == uid` or `hostId == uid` -> Rejected by `allow list` resource evaluation.
8. **Shadow Payment Amount Mutation**: Traveller updating `totalAmountInr` or `hostUpiId` on an existing booking -> Rejected by `affectedKeys().hasOnly(['bookingStatus', 'updatedAt'])`.
9. **Terminal State Reopening**: Host or Traveller attempting to revert a `cancelled` or `completed` booking back to `confirmed` -> Rejected by terminal state lock.
10. **Orphaned Availability Desync**: Creating `/bookings/{id}` without atomically creating `/listing_availability/{id}` in the same batch -> Rejected by `existsAfter(...)`.
11. **ID Poisoning**: Creating `/listings/<2000-char-id>` -> Rejected by `isValidId(listingId)`.
12. **Client Timestamp Backdating**: Creating a booking or payment destination with `createdAt: Timestamp(2020-01-01)` -> Rejected by `incoming().createdAt == request.time`.
