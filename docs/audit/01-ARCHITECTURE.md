# Architecture

## What it does

A **CRO (Conversion Rate Optimization) ROI reporting dashboard** for an agency ("Optimizers") and its e-commerce clients. The agency runs A/B tests for clients via **Convert.com**; this app pulls those experiment results, cross-references revenue/transaction data from **Google Analytics 4**, computes revenue uplift and ROI per experiment, and presents it as a branded dashboard.

Two roles:
- **Admin** (agency staff) — manage clients, credentials, trigger syncs, handle support tickets, ClickUp integration, override what clients see.
- **Client** — read-only view of their own experiments, ROI, GA4 data, project timeline.

The full intended spec lives in [`CRO_Dashboard_PRD.md`](../../CRO_Dashboard_PRD.md) — read §5 (Core Features) and §7 (Security Requirements) if you want the "as designed" version before comparing it to "as built" in `03-FINDINGS.md`.

## Tech stack

| Layer | Stack | Where |
|---|---|---|
| Frontend | React 19 + TypeScript, Vite, React Router v6, Zustand, TanStack Query, Tailwind, Recharts, Framer Motion/GSAP | `frontend/` |
| Cloud Functions | Firebase Functions v6 (Node 20, TS), firebase-admin, axios, nodemailer | `functions/` |
| Standalone server | Node.js + Express 4, deployed separately on **Render** | `server/` |
| Database / Auth / Storage | Firestore, Firebase Authentication (custom claims for RBAC), Firebase Storage | Firebase project `client-dash-9b027` |
| Hosting | Firebase Hosting, serves `frontend/dist` as an SPA | `firebase.json` |
| External APIs | Convert.com REST API, GA4 Data API, ClickUp API, Google PageSpeed Insights | — |

Firebase project ID: `client-dash-9b027` (`.firebaserc`). There is **no npm workspace** — `frontend/`, `functions/`, `server/`, and the repo root each have independent `package.json`/lockfiles. Root `package.json` just uses `concurrently` to run `frontend` (Vite dev server) and `server` (Express, `node --watch`) together for local dev.

## How the pieces actually talk to each other

```
┌─────────────────────┐
│   Browser (React)   │
└──────────┬───────────┘
           │
   ┌───────┼──────────────────────────────┐
   │       │                              │
   ▼       ▼                              ▼
Firestore  Firebase Auth          Cloud Functions (onCall)
(direct    (email/password,       createClientUser, calculateROI,
 reads/     custom claims:        rotateClientCredentials,
 writes     role, clientId)       getExperiments, clickup*,
 via SDK)                         sendEmailHttp, ...
   │
   │  (some data also fetched via)
   ▼
Express server on Render (server/index.js)
  - /api/ga4/*           → Google Analytics Data API (properties admin-gated, experiment-data ownership-gated)
  - /api/ga4-reports/*   → GA4 Data API, powers the Analytics Report Builder (metadata/values admin-gated,
                            data/funnel ownership-gated)
  - /api/clickup/*        → ClickUp API (auth-gated)
  - /api/pagespeed/*      → PageSpeed Insights (unauthenticated)
  - /api/support-email    → nodemailer (unauthenticated)
  - /api/send-password-reset → Firebase Auth reset link (unauthenticated)
  - /api/admin-signup/*   → pendingAdmin self-registration + email-token approval (unauthenticated)
  - /api/notify-executive-admin → nodemailer (unauthenticated)
  - /health               → liveness check (unauthenticated by design)
  - node-cron (08:00 & 20:00 Africa/Cairo) → Convert.com sync → Firestore
```

- The **React SPA** talks directly to **Firestore/Auth/Storage** via the Firebase JS SDK for most reads — some as one-shot reads wrapped in React Query, some as live `onSnapshot` listeners (see `02-CODEBASE-GUIDE.md` for which is which).
- Privileged/server-side work goes through **Firebase Cloud Functions** (`functions/src`) — user creation, ROI computation, credential rotation, ClickUp OAuth.
- A **separately-hosted Express server** (`server/`, on Render — not Firebase) handles ClickUp integration, transactional email, GA4/PageSpeed data fetches, and runs the twice-daily Convert.com sync via `node-cron`.
- **Firestore Security Rules** (`firestore.rules`) enforce admin-vs-client access, primarily via Firebase Auth custom claims (`role`, `clientId`) with a Firestore-document fallback for cases where claims haven't propagated yet.

## Data pipeline (the core loop)

1. Admin (or the cron job) triggers a **Convert.com sync**.
2. Convert credentials are read from `clients/{clientId}/credentials/convert`.
3. Convert's REST API is called (experiment list + `aggregated_report` + `daily_report` per experiment), rate-limited to one request per 6 seconds.
4. Results are written to `clients/{clientId}/experiments/{experimentId}` in Firestore, plus a `syncStatus/convert` marker doc.
5. Writing `syncStatus/convert` triggers the `calculateROI` Cloud Function, which recomputes an ROI snapshot into `clients/{clientId}/roi/{YYYY-MM-DD}`.
6. The dashboard reads `experiments/*` (and, separately, `roi/*`) and computes what it displays largely **client-side**, from the raw experiment data — not from the `calculateROI` output. (Why this matters: see `03-FINDINGS.md` §"ROI numbers disagree".)
7. GA4 numbers are fetched live, per page load, via a POST from the browser to the Express server (`/api/ga4/experiment-data`), which calls Google's API server-side using a service account.

## Data model (reconstructed from `firestore.rules` + actual reads/writes)

```
users/{uid}
  { role: "admin" | "executiveAdmin" | "client" | "pendingAdmin", email, name, clientId|null, ... }
  ← "pendingAdmin" is real and server-side (server/index.js's /api/admin-signup/* routes write/read it),
    and per C6 the live production Firestore rules already have the self-registration rule for it — but
    this checkout's frontend has zero references to "pendingAdmin" anywhere, so there's no signup form
    to find in the current UI; the flow exists but isn't reachable from this build.

clients/{clientId}
  { name, contactName, contactEmail, contractStartDate, contractEndDate,
    agencyFee, servicePrice, currency, logoUrl, status: "active"|"inactive", ga4PropertyId }

  credentials/convert       { accountId, projectId, keyId, keySecret, ... }   ← see 03-FINDINGS.md
  credentials/clickup       { ...ClickUp OAuth tokens }

  experiments/{experimentId}   ← authoritative; dashboard reads this directly
    { experiment: {...raw Convert experience}, report, dailyReport, dailyReports, updatedAt }

  auditFindings/{findingId}  ← added post-audit, see 08-AUDIT-FINDINGS-FEATURE.md
    { ...content fields (issue/fix/verify/docs/severity/tool/...) — either bulk-imported
      from a prior audit or authored directly by an admin via a create/edit dialog,
      progressStatus, note, deleted, deletedAt, progressUpdatedAt, progressUpdatedBy }
    one doc per audit finding; admin full read/write, client read-only (frontend hides
    fix/verify/docs/routing/notes fields for the client role — same field-level-hiding-
    not-rule-level pattern already used for experimentOverrides.notes elsewhere)

  ga4Reports/{reportId}      ← custom drag-and-drop GA4 reports built via the Analytics Report Builder
    { id, name, property, dimensions, metrics, chartType, rangeA, rangeB, limit, layout, group,
      createdAt, updatedAt }
    written/read by frontend/src/lib/ga4Reports/storage.ts; admin full read/write, client read-only
    (mirrors the auditFindings admin-vs-client pattern) — the whole feature (not per-report) is gated
    in the client nav by settings/dashboard's ga4ReportsEnabled flag

  roi/{YYYY-MM-DD}           ← written by calculateROI Cloud Function, barely consumed
  syncStatus/convert         ← write here triggers calculateROI

  settings/dashboard         ← admin overrides, live via onSnapshot
  settings/clientPreferences ← client-writable exclusions

  timeline/config
  activityLogs/{logId}       ← append-only, client-create / admin-read
  data/convert/snapshots/*   ← DEAD PATH, only written by undeployed Cloud Functions

supportTickets/{clientId}/messages/{messageId}
auditLog/{autoId}
appConfig/{docId}
clickupOAuthSessions/{sessionId}
adminApprovals/{uid}
exchangeRates/{BASE}_{TARGET}
```

## Design FAQ

### Is it normal for the client to talk directly to Firestore/Auth/Cloud Functions?

Yes — this is the standard "Firebase-native" pattern (Google calls it BaaS: Backend-as-a-Service), not a shortcut this project invented. It's a deliberate alternative to the traditional "client → your API server → database" three-tier model, and it's what Firebase is designed around.

**Trade-off, stated plainly:** in the traditional model, your server is the one choke point where you enforce auth, validate input, and hide your schema — you write that logic once, in one place. In the Firebase-native model, **your security rules file *is* your backend's authorization layer** — there is no server standing between the client and the database catching mistakes. That's a good trade when your rules are airtight (less code, real-time listeners for free, no server to scale) and a bad one the moment a rule is wrong or a privileged operation is allowed to happen as a plain client write instead of going through a Cloud Function.

**This app's actual problem isn't "direct Firestore access is used"** — reads (dashboard data, GA4 metadata, settings) going straight to Firestore is fine and idiomatic. **The problem is that a couple of privileged *writes* leaked into the same direct-access pattern** — client creation and credential storage (`frontend/src/lib/adminUsers.ts`, see `03-FINDINGS.md` C2) should have been Cloud-Function-only and weren't. The fix isn't "stop using Firestore directly," it's "make sure nothing that touches secrets, roles, or account creation is ever a plain client `setDoc`."

### Why is the backend split across Cloud Functions + a standalone Render server + direct client calls?

Partly a real platform constraint, partly what looks like an abandoned migration:

- **Real constraint:** Render blocks outbound SMTP, so email sending was moved to route through a Firebase Function (`sendEmailHttp`) even when the *trigger* is on Render — confirmed by commit history. Cloud Functions also has to host anything that reacts to a Firestore write or runs on a schedule natively (`calculateROI`, the Firestore-triggered email sends) — Render has no equivalent primitive without you building a listener yourself.
- **Likely organic, not fully intended:** `functions/src/syncConvertData.ts` and `triggerSync.ts` are fully-written Cloud Function equivalents of `server/syncFromConvert.js`'s cron sync — same algorithm, not exported/deployed, writing to a Firestore path nothing reads. The most plausible read is that someone started migrating the Convert-sync pipeline from the Render server to Cloud Functions and never finished the cutover, leaving the old path live and the new one dead. (This is inference from the code, not confirmed intent — worth a two-minute Slack message to whoever built this, if reachable.)
- **Yes, there's unnecessary surface area beyond the SMTP-driven split:** `/api/support-email` and `/api/notify-executive-admin` are simple stateless request/response handlers with no need for a persistent process — they could just as easily be `onRequest` Cloud Functions, which would shrink the number of places that need independent auth wiring (see `03-FINDINGS.md` C4 — the fact that 8 of 19 non-health Express routes have no auth check at all is partly a consequence of there being 19+ routes across two auth models instead of one). The genuinely justified reasons to keep a persistent Render process are the `node-cron` job and PageSpeed's run/stop/cancel semantics (Cloud Functions v2 supports long timeouts but not a clean "cancel a running job" model without extra plumbing).

### Where is each kind of credential actually stored?

| Credential | Stored where | Encrypted? | Managed by |
|---|---|---|---|
| User login passwords | Firebase Authentication's own user store | Yes — Google-managed (scrypt), app never touches raw passwords | Firebase, not this app |
| Convert.com `keyId`/`keySecret` per client | Firestore `clients/{id}/credentials/convert` | **Inconsistently** — plaintext via the path that's actually used (`adminUsers.ts`), AES-256-GCM via the path that's built but unused (`createClientUser.ts`/`rotateClientCredentials.ts`) | App-managed, see `03-FINDINGS.md` C1/C2 |
| ClickUp OAuth tokens per client | Firestore `clients/{id}/credentials/clickup` | **Yes, consistently** — `functions/src/clickup.ts` always encrypts on write and decrypts on read, and this flow never touches the frontend directly | App-managed — **this is the correct template**, Convert credentials should be made to look like this |
| GA4 service account | Env var JSON (`GA4_SERVICE_ACCOUNT_JSON`) on Render, local JSON file in dev | N/A — never in the DB | Render env / local file |
| Firebase Admin SDK service account | Env vars on Render (`FIREBASE_SERVICE_ACCOUNT_JSON`); **Google Secret Manager** for Cloud Functions (`FIREBASE_SA_PRIVATE_KEY`/`FIREBASE_SA_CLIENT_EMAIL`, declared via the `secrets: [...]` option in `createClientUser.ts:33`) | N/A | Render env / GCP Secret Manager |
| The AES-256-GCM `ENCRYPTION_KEY` itself | Plain `process.env.ENCRYPTION_KEY` (`functions/src/lib/encryption.ts:8`) — **not** declared in any function's `secrets: [...]` list, so it's not actually in Secret Manager despite the app already knowing how to use Secret Manager for the SA credentials right next to it | No (it's the key, not data-it-protects) | App-managed, inconsistently |

**Does this need a secret manager?** Selectively, yes — and the app already demonstrates the right pattern in two places (ClickUp credentials, and the SA-credential `secrets:` usage) without applying it everywhere:

1. **Per-client third-party credentials (Convert, ClickUp) don't belong in Secret Manager directly** — Secret Manager is priced and designed for a small, relatively static number of app-wide secrets, not one secret per client per integration; that doesn't scale cleanly to hundreds of tenants. The correct pattern for these — envelope encryption, where Firestore holds ciphertext and *only the encryption key* lives in Secret Manager — is already 80% built (`functions/src/lib/encryption.ts` + the ClickUp flow prove it works). It just needs to (a) be the only path (fix C2), (b) be consistently decrypted everywhere it's read (fix C1), and (c) have its key actually pulled from Secret Manager via the `secrets:` option instead of a bare env var.
2. **The handful of static, app-wide secrets** (GA4 SA, Firebase SA, the `ENCRYPTION_KEY`, any Gmail/nodemailer credentials) are a textbook fit for Secret Manager directly — small in number, infrequently rotated, and Cloud Functions v2 already has first-class support for this that the codebase uses in one place and should use everywhere. On the Render side, Render's own encrypted environment variable store is an adequate equivalent for that platform — there's no need to bolt GCP Secret Manager onto a non-GCP host.

## Deployment topology

| Piece | Where | Trigger |
|---|---|---|
| `frontend/dist` | Firebase Hosting | manual/CI `firebase deploy` |
| `functions/` | Firebase Cloud Functions (GCP) | manual/CI `firebase deploy --only functions` |
| `server/` | Render (separate from Firebase) | Render's own git-push deploy |
| Firestore/Auth/Storage | Firebase/GCP, project `client-dash-9b027` | — |

The split between "Firebase Cloud Functions" and "a whole separate Express app on Render" is not incidental — per commit history, email sending was moved to route through a Firebase Function specifically because **Render blocks outbound SMTP**, so the Render server calls a Firebase Function to send email rather than doing it directly. Keep this in mind if you ever consider consolidating the two backends — there's a real platform constraint behind the split, not just historical accident.
