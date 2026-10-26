# RTL dating app: core backend rules

The rules a Hebrew-first dating app has to get right on the server, written as Supabase Postgres migrations and proven with 68 tests. The app itself (React Native + Expo, forced RTL) talks to this through supabase-js. Nothing here trusts the client.

All people, phone numbers and data in this repo are fictional.

```bash
npm install
npm test          # 68 tests against real Postgres (PGlite, Postgres compiled to WebAssembly)
```

Each test signs in the same way requests arrive on Supabase: Postgres role `authenticated` and a JWT with the user's id and OTP-verified phone. So row-level security, column grants and function permissions are really exercised, not mocked.

## What it guarantees

**Matching** (`0003_swipes_matches.sql`)
- A match exists only when both people liked each other, and **exactly once**, even if both tap like at the same moment. Both profile rows are locked in id order, and `unique (user_a, user_b)` backs it up.
- A double tap is refused (`already swiped`), never double counted.
- Eligibility (verified, active, orientation both ways, age inside **both** people's ranges, no block either way) is checked again inside `swipe()`. A modified app cannot like someone it was never shown.
- Nobody can see who liked them.

**Under-18 block** (`0002_verification.sql`)
- iOS and Android give apps no device id that survives a reinstall, so "blocked on this device" is not a promise an app can keep. The block is tied to what the server can verify: the **OTP-verified phone number** and the **verification vendor's identity reference**.
- Only the backend (the Edge Function receiving the vendor's signed webhook, using the service key) can record a verification. The app cannot verify or activate itself.
- Only salted SHA-256 hashes go into the registry. The block survives account deletion and re-install without keeping a minor's phone number or birth date.
- Turning 18 today counts. One day short does not.

**Privacy** (`0001_profiles.sql`, `0004_discover.sql`)
- Column-level grants: phone, birth date, verification reference and admin flag are unreadable by any app user, even on their own row. Users see their own data through `my_profile()`.
- Other profiles are readable only through `discover()` (public fields: name, age, city, bio) or once matched.
- Members see that a match ended, never whether it was an unmatch or a block.

**Chat** (`0005_messages.sql`)
- RLS: only the two people in an **active** match can read or send. The same policies apply to Supabase Realtime subscriptions.
- No sending as someone else, and no editing or deleting other people's messages. Only the recipient can mark messages read.
- Length limits count characters, not bytes, so Hebrew text gets the full 1,000 characters.

**Safety** (`0006_safety.sql`)
- Block ends the match at once. The chat closes, the history is hidden for both, the profiles disappear from each other, and the pair can never match again.
- Report also blocks. Duplicate open reports are refused, and the reported person never sees the report.

**Account deletion** (`0007_account_deletion.sql`)
- Apple 5.1.1(v) and Google Play require in-app deletion. Deleting removes the profile, swipes, matches and conversations for both sides. Reports are kept for moderation without the user reference.

**Admin** (`0008_admin.sql`)
- The moderation queue puts `underage` reports first.
- Ban ends matches, closes chats, hides the user and resolves their reports. It needs a note, and admins can't ban themselves.
- Every admin action is written to an **append-only** audit log: a trigger refuses update and delete.
- Admin rights can't be self-granted.

## Layout

```
supabase/migrations/0001_profiles.sql          profile, registration from the phone session, column privacy
supabase/migrations/0002_verification.sql      vendor webhook, under-18 registry (hashes only)
supabase/migrations/0003_swipes_matches.sql    eligibility, swipe(), mutual match
supabase/migrations/0004_discover.sql          deck and match list (public fields only)
supabase/migrations/0005_messages.sql          chat RLS, read receipts
supabase/migrations/0006_safety.sql            block, unmatch, report
supabase/migrations/0007_account_deletion.sql  delete my account
supabase/migrations/0008_admin.sql             moderation queue, ban, audit log
supabase/seed.sql                              fictional Hebrew profiles for local dev
supabase/test-shim.sql                         test-only: roles and auth.uid() that Supabase already provides
tests/                                         one suite per area
```

## What this repo does NOT do

- **No app UI.** No swipe deck, screens or RTL layout here. That is the React Native side.
- **No real verification vendor.** `service_record_verification()` is what the vendor webhook handler would call after checking the vendor's signature. The handler itself (an Edge Function) is not included.
- **No photos.** In production they go in private Supabase Storage buckets with policies mirroring `profiles_self_or_match`, served through short-lived signed URLs.
- **No payments.** Subscriptions would come from RevenueCat webhooks writing entitlements server-side.
- **No push notifications, rate limiting on likes, or location / distance filtering.**
- **Concurrency in tests is serialised by PGlite** (a single connection). The tests prove the rules and idempotency. On Supabase, the row locks and unique constraints in `swipe()` are what make simultaneous likes safe.
- The registry salt is a constant in the migration for the demo. In production it lives in Vault or an Edge Function secret.
