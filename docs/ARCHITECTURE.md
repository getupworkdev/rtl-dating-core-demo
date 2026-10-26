# Architecture

A Hebrew-first (RTL) dating app for iOS and Android with a web admin panel. One developer, one backend, no servers to run.

![Screens](design/00-overview.png)

## System overview

```mermaid
flowchart LR
  subgraph Phone["iOS / Android app (React Native + Expo, TypeScript)"]
    UI["Screens (forced RTL)"]
    SDK["supabase-js"]
    RC["RevenueCat SDK"]
    VSDK["Verification vendor SDK<br/>(selfie + ID)"]
  end

  subgraph Supabase
    AUTH["Auth<br/>phone OTP"]
    DB[("Postgres<br/>RLS on every table")]
    RT["Realtime<br/>(chat)"]
    ST["Storage<br/>private photo buckets"]
    EF["Edge Functions"]
  end

  ADMIN["Admin panel (web)<br/>React + supabase-js"]
  VENDOR["Verification vendor"]
  REVCAT["RevenueCat"]
  PUSH["Expo Push → APNs / FCM"]
  SENTRY["Sentry"]

  UI --> SDK
  SDK -- "sign in" --> AUTH
  SDK -- "queries + RPC as the user (JWT)" --> DB
  SDK -- "subscribe to own matches" --> RT
  SDK -- "signed URLs" --> ST
  VSDK -- "capture" --> VENDOR
  VENDOR -- "signed webhook" --> EF
  RC --> REVCAT
  REVCAT -- "webhook" --> EF
  EF -- "service role" --> DB
  DB -- "new match / message" --> EF
  EF --> PUSH
  ADMIN -- "RPC (is_admin checked in DB)" --> DB
  UI -.-> SENTRY
```

**Rules of the design**
- **The client is never trusted.** The app reads and writes only through row-level security and `security definer` functions that check `auth.uid()`. A modified app, or someone calling the API with their own token, gets the same answers as the real app.
- **Third parties talk to Edge Functions, never to the app.** The verification result and purchase state arrive by signed webhook, are checked, and are written with the service role. The app cannot claim it is verified or premium.
- **Nothing private leaves the database by accident.** Column-level grants keep the phone number, birth date and verification reference unreadable to every app user, including on their own row.

## Data model

```mermaid
erDiagram
  profiles ||--o{ swipes : "swiper"
  profiles ||--o{ blocks : "blocker"
  profiles ||--o{ matches : "user_a / user_b"
  matches  ||--o{ messages : ""
  profiles ||--o{ reports : "reporter / reported"
  profiles {
    uuid id PK
    text phone_e164 "private"
    text display_name
    text gender
    text_array seeking
    int age_min
    int age_max
    date birth_date "private, from vendor"
    text status "pending | active | blocked_underage | banned"
  }
  swipes { uuid swiper PK uuid target PK text direction }
  matches { uuid id PK uuid user_a uuid user_b timestamptz ended_at }
  messages { uuid id PK uuid match_id uuid sender text body timestamptz read_at }
  blocks { uuid blocker PK uuid blocked PK }
  reports { uuid id PK text reason text status }
  underage_registry { text kind PK text hash PK }
  audit_log { bigint id PK uuid actor text action jsonb detail }
```

`underage_registry` and `audit_log` have no relation to `profiles` on purpose. The first holds only salted hashes, so it survives account deletion. The second is append-only.

## Key flows

### Mutual like, exactly once

```mermaid
sequenceDiagram
  participant A as Noa's app
  participant B as Yonatan's app
  participant DB as Postgres (swipe function)
  par same second
    A->>DB: swipe(Yonatan, like)
    B->>DB: swipe(Noa, like)
  end
  Note over DB: lock both profile rows in id order<br/>→ the two calls run one after the other
  DB-->>A: null (no reciprocal like yet)
  DB-->>B: match id (Noa's like found)
  Note over DB: unique (user_a, user_b) backs it up
  DB--)A: Realtime + push: "It's mutual!"
```

### Verification and the under-18 block

```mermaid
sequenceDiagram
  participant App
  participant V as Verification vendor
  participant EF as Edge Function
  participant DB as Postgres
  App->>V: selfie + ID (vendor SDK)
  V->>EF: signed webhook (result, birth date, reference)
  EF->>EF: verify signature
  EF->>DB: service_record_verification(user, ref, birth_date)
  alt 18 or older
    DB-->>EF: active
  else under 18
    DB->>DB: store hash(phone) + hash(ref) in registry, clear birth date
    DB-->>EF: blocked_underage
  end
  Note over App,DB: A new install or new account with the same phone or the same ID is refused.
```

Verification runs **right before the first like**, not at sign-up. Unverified users can look around but cannot interact. You pay the vendor per engaged user instead of per download, and onboarding drop-off is lower.

## Security model at a glance

| Asset | Who can read | Who can write | Enforced by |
|---|---|---|---|
| Phone, birth date, verification ref | nobody in the app (backend only) | sign-in / vendor webhook | column grants |
| Profile (name, age, city, bio) | self, the discover deck, matched partner | self via `update_my_profile()` | RLS + functions |
| Likes | self only | `swipe()` | RLS + function |
| Matches | the two people | `swipe()`, `unmatch()`, `block_user()` | RLS + functions |
| Messages | the two people, while the match is active | sender, while active | RLS (also applies to Realtime) |
| Photos | self and matched partner | self | Storage policies + signed URLs |
| Reports | reporter (own reports only), admins | `report_user()` | RLS + functions |
| Audit log | admins | admin functions only, append-only | trigger |

## Environments and delivery

| | Development | Staging | Production |
|---|---|---|---|
| Supabase project | local (`supabase start`) | separate project | separate project |
| App build | Expo dev client | EAS internal / TestFlight | App Store / Google Play |
| Data | `seed.sql` (fictional) | test accounts only | real users |

- **CI:** GitHub Actions runs typecheck and the database test suite on every push. A migration that breaks a rule fails the build.
- **Builds:** EAS Build for both stores and EAS Submit for uploads. EAS Update ships JS-only fixes without a store review, with the runtime version pinned so an update can never reach a binary it wasn't built for.
- **Secrets:** vendor and RevenueCat webhook secrets and the registry salt are kept in Supabase secrets, never in the app bundle.
- **Monitoring:** Sentry for crashes and slow screens, and Supabase logs for function errors.

## Store readiness (dating apps get a closer look)

- **Age rating:** 17+ on iOS and Mature/18+ on Google Play. The 18+ gate is enforced by real verification, not a checkbox.
- **User-generated content (Apple 1.2):** report, block and an in-app path to contact support are on every profile and chat. A moderation queue is reviewed by a person.
- **Account deletion (Apple 5.1.1(v), Google Play):** in-app, and it deletes the data.
- **Privacy:** privacy manifest for every SDK, App Privacy and Data Safety forms filled in from the real data flows above. Location (if used) is coarse, and distance is rounded.
- **Subscriptions:** purchases go through StoreKit and Google Play Billing via RevenueCat. Restore Purchases is visible, and the terms are shown before purchase.
