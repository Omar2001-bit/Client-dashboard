# Release Blockers

Scope of this document: **only** issues from `03-FINDINGS.md` that can concretely go wrong *for a client* — wrong numbers they see, their data leaking to someone else, their integration silently breaking, their inbox/domain being abused. Code-quality and process gaps (no tests, no CI, monolith file, type drift) are real and covered in `03-FINDINGS.md`, but they don't directly hurt a client on their own, so they're not gates here — treat them as the reason the items below happened and will happen again.

Use this as a literal checklist before this app carries another real client's data or credentials.

---

## 🛑 Do not release until fixed

### 0. The live production site is already broken for a core admin workflow, right now
**What the client experiences:** nothing directly — this affects your own team, not a client. But it means your agency currently cannot open any client's detail page (edit contact info, rotate credentials, adjust dashboard settings, pull Convert data, build a timeline) on the deployed site.
**Why:** production has drifted from this git checkout in both directions — the deployed build appears to be missing the `clients/:clientId` route, and the live Firestore rules have things (`pendingAdmin` self-signup, a `pagespeed` rule) that this repo's `firestore.rules` file doesn't. Full detail: `03-FINDINGS.md` C6.
**Trigger condition:** none needed — reproducibly broken right now, confirmed by direct testing on the live site.
**Why this is listed first:** every other item below assumes you can safely deploy a fix from this checkout. Given the confirmed drift, a naive "just deploy what's in git" for either the frontend or `firestore.rules` risks fixing this while breaking something else that's live but uncommitted. Reconcile before you deploy anything, including fixes for the items below.

### 1. Rotating a client's Convert API key silently breaks their data sync
**What the client experiences:** their dashboard quietly stops updating. No error, no notification — the sync just fails in the background forever, until someone happens to notice the numbers look stale.
**Why:** encrypted-on-write, read-as-plaintext mismatch. Full detail: `03-FINDINGS.md` C1.
**Trigger condition:** any admin using the "Rotate Credentials" button — a normal, expected action, not an edge case.

### 2. New clients' Convert API credentials are stored in plaintext, readable by that client's own browser session
**What the client experiences:** nothing visibly wrong — but their own Convert.com account secret is sitting in Firestore in the clear, and their own logged-in session (or anyone who compromises it) can read it via the browser console.
**Why:** the live "Create Client" flow bypasses the encrypting Cloud Function entirely. Full detail: `03-FINDINGS.md` C2, C3.
**Trigger condition:** every single client created through the current admin UI. Not a rare path — it's the only path.

### 3. Any client's GA4 analytics data can be pulled by anyone who can reach the server
**What the client experiences:** their GA4 experiment data (conversion rates, revenue, audience data) is retrievable by a third party who isn't their agency and isn't them, with zero authentication.
**Why:** `/api/ga4/experiment-data` takes an arbitrary `propertyId` with no auth, no ownership check. Full detail: `03-FINDINGS.md` C4.
**Trigger condition:** the endpoint is live the moment the Render server is deployed — no special action needed to trigger it, just reachability.

### 4. The server can be made to send arbitrary email, to any address, appearing to come from your infrastructure
**What the client experiences:** could range from "unrelated spam sent through your domain" to "a client receives a convincing phishing-style email that looks like it came from your app," damaging trust in every legitimate email you send them afterward (and risking your sending domain's reputation, which affects delivery of real password resets and onboarding emails to every client).
**Why:** `/api/notify-executive-admin` accepts the recipient address from the request body with no auth or validation. Full detail: `03-FINDINGS.md` C4 (updated).
**Trigger condition:** no special action needed — reachable the moment the server is deployed.

### 5. The ROI number a client sees may not match the number your team's records show
**What the client experiences:** if the `calculateROI` output (which excludes losing experiments from the total) is ever surfaced anywhere — a report, an export, an email, a sales conversation — it won't match what's on their live dashboard (which includes losses by default, with an opt-out toggle). A client comparing two numbers you gave them, that disagree, on a metric tied to what they're paying you, is a trust problem, not just a code problem.
**Why:** two independent, disagreeing ROI calculations. Full detail: `03-FINDINGS.md` H1.
**Trigger condition:** currently latent — the mismatch only becomes client-visible the first time anyone uses the `roi/*` Firestore doc for anything client-facing. Fix before that happens, not after.

---

## ⚠️ Fix soon, but not an immediate gate

These can hurt a client but need a less likely trigger condition, or the damage is contained/recoverable:

### 6. Twice-daily sync can silently skip or double-fire
**What the client experiences:** a missed sync window (stale data for up to ~12-24 extra hours) with no alert, or — if the server is ever scaled to more than one instance — duplicate sync runs.
**Why:** `node-cron` inside the same process as the web server, no idempotency guard, no monitoring. Full detail: `03-FINDINGS.md` M2.
**Why it's not a hard gate today:** only manifests on restart-timing bad luck or a scaling change that isn't currently planned. Worth fixing before you scale Render to multiple instances, specifically.

### 7. A committed third-party API key
**What the client experiences:** no direct client impact (it's an internal exchange-rate API key, not client data), but it's a live credential sitting in git history.
**Why:** `frontend/.env` tracked in git. Full detail: `03-FINDINGS.md` C5.
**Why it's not a hard gate today:** contained to one non-client-data integration. Rotate it this week regardless — it's a 10-minute fix with no reason to delay.

### 8. No way to know when any of the above has already happened
**What the client experiences:** if issues 1-5 above have already occurred with an existing client, there's currently no log, alert, or audit trail that would tell you.
**Why:** no structured logging, no error tracking, no request logs on the Render server. Full detail: `03-FINDINGS.md` M6.
**Why it's not its own gate:** it doesn't cause client harm by itself — but fix it *before* or *alongside* items 1-5, not after, or you'll have no way to confirm the fixes actually worked in production.

---

## Suggested gate

Reconcile item 0 first — it's not a "before the next feature ships" gate, it's already live. Then ship a "we've stopped the bleeding" fix pass covering items 1-5 (all are small, scoped changes — see `05-RECOMMENDATIONS.md` steps 1-4 for the concrete fix for each) before onboarding another client or letting the current deployment keep handling real client credentials. Items 6-8 should follow immediately after, not be deferred indefinitely.
