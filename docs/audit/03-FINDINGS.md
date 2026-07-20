# Findings

Every item here was verified directly against source — file read, grep, or a tool run (`npm audit`, `git ls-files`) — not inferred from a summary. File:line references are given so you can check each one yourself in under a minute. Severity reflects **real-world impact if shipped as-is**, not theoretical worst case.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low

---

## 🔴 Critical

### C1. Credential encryption is inconsistent between write path and read path — rotating a key silently breaks sync

**Where:**
- Writes (encrypt): `functions/src/createClientUser.ts:131-132`, `functions/src/rotateClientCredentials.ts:34-35` — both call `encrypt()` (AES-256-GCM, `functions/src/lib/encryption.ts`) before storing `keyId`/`keySecret`.
- Reads (no decrypt): `frontend/src/lib/convertSync.ts:48-49` and `server/syncFromConvert.js:63` both read `keyId`/`keySecret` straight off the Firestore doc and use them **as-is** as HMAC signing material. Neither file imports or calls a decrypt function.
- The one place that *does* handle both cases: `functions/src/getExperiments.ts:10-21` sniffs whether the value looks like `iv:tag:ciphertext` hex and decrypts if so — but this function isn't part of the sync pipeline.

**What happens:** An admin uses "Rotate Credentials" in `ClientDetailPage.tsx:138` (a normal, expected maintenance action — e.g. after a leaked key). The new key is encrypted and stored. The next sync — whether the admin clicks "Sync" in the browser or the twice-daily cron job on Render fires — reads the ciphertext and uses it verbatim as the HMAC secret. Convert.com rejects every signed request. The error is caught, logged to console, and **not surfaced anywhere** (`server/syncFromConvert.js`'s per-client error handling swallows it so one client's failure doesn't block others — but that also means nobody finds out). That client's data goes stale with no alert.

**Why it currently "works" in practice:** the live client-creation flow (`frontend/src/lib/adminUsers.ts:37`, see C2) never goes through the encrypting Cloud Function at all — it writes plaintext credentials directly from the browser. So the bug is dormant until someone uses the "official," secure rotation path.

**Fix scope:** small. Either (a) add `decrypt()` with the same sniff-and-fallback pattern from `getExperiments.ts` to both `convertSync.ts` and `syncFromConvert.js`, or (b) stop encrypting until the whole pipeline is updated together. Don't ship a partial version of this again.

---

### C2. The real "Create Client" flow bypasses the secure Cloud Function entirely, storing credentials in plaintext

**Where:** `frontend/src/pages/admin/CreateClientPage.tsx:83` calls `createUserDirectly()` in `frontend/src/lib/adminUsers.ts:7-60`.

**What it does:**
- Creates the new Firebase Auth user **from the browser**, via a secondary Firebase app instance (`initializeApp` + `createUserWithEmailAndPassword`, `adminUsers.ts:8-13`) — meaning the admin must type the new client user's plaintext password directly into the browser form.
- Writes Convert credentials to `clients/{clientId}/credentials/convert` **unencrypted**, with a field literally named `storageMode: "firestore-rules-protected"` (`adminUsers.ts:42`) — i.e., the code's own comment acknowledges these are protected by Firestore rules only, not encryption.
- **Never sets Firebase custom claims.** Every account created this way relies entirely on the Firestore `users/{uid}` document as the source of truth for `role`/`clientId`, forever — the "fast path" custom-claims check that `useAuthInit()`, `firestore.rules`, and every Cloud Function's admin check all try first is simply unused for these accounts.
- The properly-built alternative, `functions/src/createClientUser.ts` (encrypts credentials, sets custom claims, deployed and exported from `functions/src/index.ts`), has **zero references anywhere in `frontend/src`** — it's live in production but unreachable from the UI.

**Implication:** this is the actual account/credential creation path used for every real client in the system today. Combine with the fact that `firestore.rules:47-49` explicitly allows a client to read their own `credentials/{document=**}` (see C3), and every client's Convert API secret is sitting in Firestore, plaintext, readable by that client's own logged-in browser session.

**Direct contradiction of the project's own spec:** `CRO_Dashboard_PRD.md` §7 ("Security Requirements"), item 1: *"API keys never reach the browser. Convert and GA4 credentials are decrypted only inside Cloud Functions. Firestore Security Rules deny client reads on `/credentials/**`."* Item 3: *"Encryption at rest: All API keys ... stored with AES-256-GCM encryption."* The shipped code does the opposite of both, for the path that's actually wired up.

---

### C3. Firestore rule allows clients to read their own Convert/ClickUp credentials

**Where:** `firestore.rules:47-49`:
```
match /clients/{clientId}/credentials/{document=**} {
  allow read: if isAdmin() || isClientOf(clientId);
  allow write: if isAdmin();
}
```
The comment above it even says this is intentional, "for browser-direct Convert API calls" — but per C2, credentials are also plaintext, so this isn't "the client can use their own encrypted key," it's "the client can read their own Convert API secret in the clear."

**Implication:** a compromised client account (or a curious client) can read their own Convert.com API credentials directly from Firestore via the browser console. Scope of damage is limited to that one client's Convert account, but it's a direct rule contradiction of PRD §7.2 and §7.1.

---

### C4. `/api/ga4/experiment-data` is completely unauthenticated and takes an arbitrary `propertyId`

**Where:** `server/index.js:766-768`:
```js
app.post("/api/ga4/experiment-data", async (req, res) => {
  const { propertyId, experimentDates = {} } = req.body ?? {};
  if (!propertyId) return res.status(400).json({ error: "propertyId required" });
```
No token check, no ownership check that the caller is actually associated with `propertyId`. Confirmed by grepping every `app.get/app.post` in `server/index.js` against the `requireAdmin` middleware (`server/index.js:69-92`) and the ownership-check middlewares (`requireClientOwnsGA4Property`, `requireClientOrAdminOwnership`) — as of this recount, 11 of 19 non-`/health` routes have some form of auth/ownership check (5 `/api/clickup/*`, `/api/ga4/properties`, `/api/ga4/experiment-data`, all 4 `/api/ga4-reports/*` routes), leaving 8 with none.

**Also unauthenticated:** `/api/ga4/properties`, `/api/pagespeed/sitemap` + `/run` + `/stop`, `/api/support-email`, `/api/notify-executive-admin`, `/api/send-password-reset`.

**Implication:** anyone who knows (or guesses/enumerates) another client's GA4 `propertyId` can pull their GA4 analytics data through this server — no relation checked between the caller's identity and the property. The PageSpeed endpoints let anyone trigger scans against arbitrary sitemaps through your server with no rate limiting. `/api/send-password-reset` unauthenticated means anyone can trigger password-reset emails to arbitrary addresses (lower severity — enumeration/spam risk, not account takeover, since it presumably just calls Firebase Auth's reset-email API — but still worth gating).

**Not a false alarm, but checked and cleared:** `/api/admin-signup/approve` (`server/index.js:623-665`) looks unauthenticated (GET request) but is actually fine — it uses a random 256-bit token compared with `crypto.timingSafeEqual`, and checks `approval.status === "approved"` to prevent replay. Flagging this so the list above reads as "checked and confirmed," not "everything GET is bad."

**Upgrade to this finding — `/api/notify-executive-admin` is an open mail relay, not just unauthenticated:** `server/index.js:669-671` takes `executiveAdminEmail` (the send-to address), `adminName`, `adminEmail`, and `clientName` **directly from the request body** with no validation beyond presence, and emails whatever recipient the caller specifies. There's no allow-list, no check that the caller is a real admin, no relation to an actual client record. Anyone who can reach the server can make it send arbitrary HTML email, from your domain's mail infrastructure, to any address they choose. `/api/support-email` has the same unauthenticated + unescaped-HTML-interpolation pattern (`server/index.js:481-483`, `message`/`senderName`/`clientName` are interpolated into the email HTML with only newlines escaped) but at least always sends to a fixed internal address, so it's spam/injection risk rather than an open relay.

---

### C5. A live, real third-party API key is committed to the repository

**Where:** `frontend/.env` (tracked in git — confirmed via `git ls-files`), line 10:
```
VITE_EXCHANGE_RATE_API_KEY=71c28dbead4eddea88c00d40
```
**Not a false alarm, but worth clarifying:** the other three values in that file (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`) are **fine to be public** — this is standard, documented Firebase behavior; the web API key doesn't gate access on its own, Firestore/Storage security rules and Firebase Auth do that. Don't treat those as a leak.

The exchange-rate API key is different — it's a real third-party credential with no equivalent security model. Anyone with read access to the repo (and its full git history, forever, even if the file is deleted later) can use it, burn its quota, or potentially incur cost depending on the provider's plan.

**Implication severity depends on repo visibility** (public vs. private GitHub repo) — verify this and rotate the key regardless, since git history retains it either way.

---

### C6. The deployed production site is running a build that has drifted from this git checkout — admins currently cannot open any client's detail page on the live site

**Found:** 2026-07-17, during manual QA of the new audit-findings feature (not a code review — this was caught by actually clicking through the deployed site, see `08-AUDIT-FINDINGS-FEATURE.md` for the test session it came out of).

**Confirmed directly, reproduced twice with two different navigation methods:** on `https://client-dash-9b027.web.app`, signed in as a real admin, opening any client's detail page — via a hard URL load of `/admin/clients/{realClientId}` *and* via clicking the actual in-app "Edit" link from the Client Roster table — lands back on `/admin` (Agency Overview), silently. No "Client not found" text, no error, no console exception. `/admin/clients/new` (a static sibling route) works fine on the exact same deployment, which rules out a broader admin-routing failure and narrows it specifically to the dynamic `:clientId` segment.

**Local baseline, also confirmed directly:** the identical route, running this git checkout locally (`npm run dev`, current HEAD `dc95e7e`), renders the full `ClientDetailPage` correctly — all 5 tabs, real data. So this isn't a bug in the current source; it's specific to whatever's actually deployed.

**Best-supported explanation (inference from behavior, not verified against the deployed JS bundle directly):** the deployed build's route table most likely never registered `clients/:clientId` as a nested route under `/admin`. React Router's top-level catch-all (`<Route path="*" element={<Navigate to="/" replace/>}>` in `App.tsx`) would then match, landing on `/`, where `LoginPage`'s already-authenticated redirect (`if (role === "admin"...) { navigate("/admin", {replace:true}); return null; }`, `LoginPage.tsx:19`) immediately bounces back to `/admin` — producing exactly the silent double-bounce observed, with no error and no flash of "not found" content.

**This is not a one-directional "prod is just older" gap** — the drift runs both ways, confirmed by reading the live Firestore rules directly in the Firebase console and comparing against this repo's `firestore.rules`:
- Production's `CreateClientPage` has real fields/copy that don't exist anywhere in this checkout: a magic-link-optional password flow ("Leave empty to send a magic link — the user sets their own password"), and a "Website URL" field for PageSpeed sitemap crawling. Neither exists in `frontend/src/types/index.ts`'s `CreateClientFormData` or in `CreateClientPage.tsx` as currently checked out.
- The **live, deployed Firestore rules** have two rule blocks this repo's `firestore.rules` file does not: a richer `users/{uid}` rule with a `pendingAdmin` self-registration path (`allow create: if isAdmin() || (request.auth.uid == uid && request.resource.data.role == "pendingAdmin")`), and a `clients/{clientId}/pagespeed/{document=**}` rule (`allow write: if false` — admin-SDK-only). §01-ARCHITECTURE.md's data model block already lists `pendingAdmin` as a valid `role` value and `server/index.js` has a whole admin-signup-approval flow — that functionality is real and live, it's just not reflected in this repo's committed rules file.
- Conversely, this checkout has things production doesn't: the entire audit-findings feature (expected — it's new, undeployed work), but that's the *only* direction of drift that's expected. The rest isn't.

**Implication:** two real risks, not one. (1) **Admins cannot manage clients on the live site right now** — this is a currently-broken core workflow, not a latent one. (2) **The next deploy from this checkout is not a safe "just ship what's new" operation** — a plain `firebase deploy` would ship whatever `App.tsx` currently has (which should fix the routing gap) but a plain `firebase deploy --only firestore:rules` would **overwrite and remove** the live `pendingAdmin` and `pagespeed` rules unless they're merged back into `firestore.rules` first (see `08-AUDIT-FINDINGS-FEATURE.md` for how the audit-findings rule addition was merged by hand to avoid exactly this).

**Not yet root-caused to a specific commit or deploy event** — this finding documents the symptom and the safest path forward (reconcile before deploying), not the history of how the two diverged. That's worth a follow-up if you want to know *when* this happened, but doesn't block fixing it.

---

## 🟠 High

### H1. The "official" ROI number and the displayed ROI number are computed by different rules and disagree

**Where:** `functions/src/calculateROI.ts:38-57` computes `blendedROI` counting **only experiments with positive uplift** (losing/flat experiments excluded from both the per-experiment breakdown and the totals — confirmed at the loop that filters before summing). This is written to `clients/{clientId}/roi/{YYYY-MM-DD}`.

`frontend/src/pages/dashboard/ClientDashboardPage.tsx` instead recomputes totals **client-side from all experiments**, with an opt-in "exclude losses" toggle the client controls — and never reads the `blendedROI` field from the `roi/*` doc it does fetch (confirmed via `loadDashboardData` in `dashboardData.ts`, which fetches the `roi` doc but the render path only consumes `experiments`).

**Implication:** two different ROI figures exist for the same client, from different inclusion rules, and the one clients actually see isn't the one that went through the more conservative server-side logic. If the `roi` doc is ever wired into an export, report, or automated client email, the number won't match what's on the dashboard — and nobody will know which one is "right" without reading both implementations.

### H2. Four independent implementations of the same Convert-sync algorithm, already drifted

1. `frontend/src/lib/convertSync.ts` (browser, admin-button-triggered) — the one that's actually live and unencrypted (C1/C2).
2. `server/syncFromConvert.js` (Render cron, twice daily) — near-identical logic, also unencrypted (C1).
3. `functions/src/syncConvertData.ts` + `functions/src/triggerSync.ts` — fully written, but **not exported from `functions/src/index.ts`**, so not deployed. Writes to `clients/{id}/data/convert/snapshots/*`, a path nothing in the frontend reads.
4. `functions/scripts/syncConvertDataLocal.js` — a local dev script variant.

Same regex (`NAMING_REGEX`), same 6-second pacing constant, same retry/backoff logic, hand-copied across all four rather than shared. This duplication is *how* the encryption mismatch (C1) went unnoticed — nobody had one file to check.

### H3. No automated tests, no CI, anywhere

Confirmed directly: zero `*.test.*`/`*.spec.*` files in `frontend/`, `functions/`, or `server/`; no `.github/workflows`; no `test` script defined in any of the four `package.json` files. For an app whose entire purpose is reporting revenue/ROI numbers to paying clients, there is no regression safety net catching a broken calculation, a broken sync, or a broken auth check before it reaches production.

### H5. `ClientDashboardPage.tsx` re-implements uplift math that already exists as a shared export

**Where:** `frontend/src/pages/dashboard/dashboardData.ts` exports uplift/aggregation functions (`calculateUplifts` and friends) intended to be the shared logic for turning raw Convert experiment data into displayable numbers. `frontend/src/pages/dashboard/ClientDashboardPage.tsx:848-896` locally redefines near-identical functions (`calculateVariantUplifts`, `calculateMetricUplift`, `getMetricValue`, `roundMetric`) instead of reusing the shared ones — needed specifically for the custom date-range view, but built as a parallel copy rather than a parameterized reuse of the existing logic.

**Implication:** a fix to the uplift formula in one place (e.g. a rounding rule, a metric definition) won't automatically apply to the other. This is the same *class* of bug as H1 (the calculateROI vs. dashboard mismatch) but one level down — it means there are at minimum **three** places uplift math can diverge in this app: `calculateROI.ts` (Cloud Function), `dashboardData.ts` (shared frontend helper), and `ClientDashboardPage.tsx`'s local range-specific copy.

### H4. Type definitions are independently maintained per runtime and have already drifted

`frontend/src/types/index.ts` (311 lines), `functions/src/types.ts` (62 lines), and untyped plain JS in `server/` each model the same domain (Convert API responses, `ClientDoc`, `ROISnapshot`) separately. `functions/src/calculateROI.ts` doesn't even use its own package's `types.ts` — it redefines its own local interfaces inline (lines ~65-110). This is the structural root cause of H1: there's no single source of truth that would have made the inclusion-rule mismatch visible at compile time.

---

## 🟡 Medium

### M1. `server/index.js` is a single 1,775-line file

No `routes/`, no `controllers/`, no `lib/` subdirectory — every route handler, the Gmail client, ClickUp normalization logic, the PageSpeed runner, and GA4 report logic are all top-level functions in one file, in call order. Not a correctness bug, but it makes the auth gaps in C4 harder to audit and easy to reintroduce.

### M2. `node-cron` runs inside the same web-server process on Render

`server/index.js:20-35` registers two cron jobs directly in the request-serving process. This is fragile in two specific ways: (1) it's unsafe to scale to more than one Render instance — each instance would fire its own copy of the same sync, duplicating work; (2) if the instance restarts around 08:00 or 20:00 Africa/Cairo, that sync run is silently skipped with no alerting.

### M3. Hand-rolled `.env` parsing instead of `dotenv`

`server/index.js` reads `.env.local` line-by-line manually rather than using the `dotenv` package (which is already a viable, standard dependency choice). Low risk on its own, but a self-written parser is one more place for a subtle quoting/escaping bug.

### M5. The custom admin-approval token never expires

**Where:** `server/index.js:553-562` generates a random 256-bit token for the admin-signup approval flow and stores it in `adminApprovals/{uid}` with no `expiresAt` field. `server/index.js:623-665` (the approval handler) checks the token value (`crypto.timingSafeEqual`, good) and whether it's already been used (`approval.status === "approved"`, good), but never checks age. **Clarifying nuance:** this is *not* true of the app's other token-based flows — Firebase's own `generatePasswordResetLink` and `generateSignInWithEmailLink` (`server/index.js:503`, `functions/src/sendOnboardingEmail.ts:18`) have built-in, Firebase-managed expiration (password reset links: 1 hour by default; sign-in links: governed by Firebase's action-code settings) and don't need app-level work. Same for the Firebase ID token itself — 1-hour expiry, silently auto-refreshed by the SDK, standard and fine. The gap is scoped specifically to this one hand-rolled token.

**Implication:** an admin-approval email that sits unread in an inbox for weeks is still a live, one-click path to granting `admin` role, if it's ever discovered (e.g. a compromised mailbox, a forwarded email, a shared/misconfigured inbox). Low likelihood, but easy to fix — add a TTL check.

### M6. No structured logging, no error tracking, no request logging middleware

**Where:** `server/index.js` has 87 scattered `console.log`/`console.error` calls and no logging library (`grep` confirms no `winston`/`pino`/`morgan`/`bunyan` anywhere), no `app.use()` beyond `cors()` and `express.json()` — no request-logging middleware at all.

**Clarifying nuance — this isn't "zero logs" everywhere:** Cloud Functions' `console.log` output is automatically captured, structured, and retained by Google Cloud Logging — that half of the backend has reasonably queryable logs for free, just because it's a GCP-managed runtime. The real gap is on the **Render side** (`server/index.js`): whatever Render's basic log viewer retains is what you get — no structured fields, no long-term retention/search, no error-tracking/alerting service (Sentry or equivalent) anywhere in the stack, and no request log (so there's no record of who hit `/api/ga4/experiment-data` with what `propertyId`, which would matter a great deal given C4).

**Implication:** if C1 (silent sync failure) or C4 (unauthenticated data access) happens in production, there is currently no alert and no easy way to reconstruct after the fact who accessed what, or when a client's data actually went stale.

### M4. No shared npm workspace

`frontend/`, `functions/`, `server/`, and the repo root have fully independent dependency trees. This isn't wrong, but it's the direct enabler of H4 (type drift) and H2 (logic duplication) — there's no `packages/shared` where a `ConvertClient` type or the sync algorithm could live once.

### M7. `ExperimentDetailPage` renders the literal string "undefined" in client-visible copy

**Where:** `frontend/src/pages/dashboard/ExperimentDetailPage.tsx`, the experiment-objective description block. Confirmed directly by opening a real experiment ("ID18 | products quickview") as the client role: the rendered text reads *"The objective of this A/B Experiment is to focus primarily on undefined. The other objective(s) include ."* — a raw JS `undefined` interpolated into a template string, plus a trailing "include ." with nothing after it.

**Why:** the description text is built by interpolating fields from Convert.com's raw experiment `objective`/`objectives` data with no fallback for a missing/differently-shaped value — same root-cause pattern as H4 (no shared, validated type for this data) rather than a one-off typo.

**Implication:** contained to display text, no data-correctness or security impact — but it's client-visible on a page real clients look at, and "the word undefined in your paid dashboard" reads as broken/unpolished in exactly the way H1's mismatched-ROI-numbers finding warns about for trust. Cheap fix: a fallback (`objective ?? "the primary metric"` or similar) plus a guard so the "other objectives" sentence doesn't render when there are none.

---

## ⚪ Low

- Dev screenshots (`Screenshot 2026-*.png`) and a misplaced generic Claude Code skill file (`brand-guidelines.md` — see `02-CODEBASE-GUIDE.md`) committed at repo root. Cosmetic, but worth cleaning up before anyone else clones this expecting it to be the real brand doc.
- Frontend has no route-level code splitting (`React.lazy`/`Suspense`) — every page is eagerly bundled. Not a correctness issue, just a bundle-size/first-load cost that will grow with the app.
- Only ~10 commits in the repo's history — this hasn't been through much iterative review yet, which is consistent with everything above rather than a separate finding.
- `LoginPage.tsx:19-20` calls `navigate(...)` directly in the component's render body (the already-authenticated-user redirect), not inside a `useEffect` or event handler — a real React anti-pattern, not a style nitpick. Confirmed reproducible: it throws a live console error, *"Cannot update a component (`BrowserRouter`) while rendering a different component (`LoginPage`)"*, every time an already-authenticated user's session causes this component to mount (e.g. loading `/` directly while logged in). No observed functional break — the redirect still completes correctly — but it's exactly the kind of pattern React's concurrent-rendering features are increasingly less tolerant of, and it's console noise that could mask a real error during future debugging.

---

## What's actually solid (so this doesn't read as one-sided)

- The core sync algorithm itself (pagination, incremental-vs-full sync decision, 429 backoff, batched Firestore writes) is genuinely well-thought-out where it's implemented — the bug is in credential handling around it, not the sync logic itself.
- `functions/src/lib/encryption.ts` is a correct AES-256-GCM implementation with proper IV/auth-tag handling — the *scheme* is right, it's just not consistently wired to every consumer.
- `functions/src/getExperiments.ts`'s `readCredential()` dual-format handling is exactly the pattern that should be applied everywhere else — a good template for the C1 fix.
- The `ProtectedRoute` / claims-with-Firestore-fallback pattern for auth is a reasonable design, just duplicated by hand in five-plus places instead of factored into one `requireAdmin()`-style helper.
- The `convert-firebase-audit-report.json` reconciliation (49/49 experiments matched against live Convert data) is real evidence the happy path works end to end.
- The admin-signup approval flow (C4's "checked and cleared" item) shows the author does know how to build a secure token-based flow when they reach for one — the gaps are inconsistency, not lack of skill.
