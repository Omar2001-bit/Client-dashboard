# User Guide

Everything you need to get oriented: what this product is, how to run it, and what every screen does — for both roles.

**How to use this doc:** read top to bottom for a full orientation, or jump straight to what you need:
- Just want to run it locally? → [§5 Local development setup](#5-local-development-setup)
- Want to know what a specific admin screen does? → [§8 Admin feature walkthrough](#8-admin-feature-walkthrough)
- Want to know what a client sees? → [§9 Client feature walkthrough](#9-client-feature-walkthrough)
- Deploying something? → [§6 Build & deploy](#6-build--deploy)

This guide links out to `docs/audit/` for deeper architecture and security detail rather than duplicating it — that folder is a thorough, source-verified internal audit and is worth reading in full once you're oriented.

---

## 1. What this is

**Client Dashboard** is a multi-tenant CRO (Conversion Rate Optimization) ROI reporting app built for an agency called **Optimizers**. The agency runs A/B tests for its e-commerce clients via **Convert.com**; this app pulls those experiment results, cross-references revenue/transaction data from **Google Analytics 4**, computes revenue uplift and ROI, and presents it as a branded dashboard — one side for agency admins to manage everything, one side for clients to see their own results.

This guide covers both angles at once: how to actually run and ship the code, and what the product does screen by screen — because whether you're picking this project back up as its developer or just trying to understand what it does for the business, you need both.

## 2. Product overview

Two roles:
- **Admin** (agency staff) — manages every client account, triggers data syncs, customizes what each client sees, builds custom analytics reports, tracks a client's onboarding project timeline, and runs support.
- **Client** — a read-only consumer of their own experiment results, ROI, GA4 data, project timeline, and support chat. Everything a client sees is scoped to their own account only.

The core loop, in one sentence: **admin syncs A/B test results from Convert.com → the app enriches them with revenue data from GA4 → the client sees uplift and ROI on their dashboard.**

Two documents worth knowing about, so you don't duplicate work already done elsewhere in the repo:
- [`CRO_Dashboard_PRD.md`](../CRO_Dashboard_PRD.md) (repo root) is the original **"as-designed"** product spec — read its §5 (Core Features) and §7 (Security Requirements) for the intended behavior.
- [`docs/audit/`](audit/00-INDEX.md) is a thorough, source-verified **"as-built"** audit — what's actually shipped, including where it diverges from the PRD (notably around credential security — see `03-FINDINGS.md` C1–C3).

## 3. Tech stack at a glance

| Layer | Stack |
|---|---|
| Frontend | React 19 + TypeScript, Vite, React Router v6, Zustand, TanStack Query, Tailwind CSS, Recharts, dnd-kit |
| Cloud Functions | Firebase Functions v6 (Node 20, TypeScript), firebase-admin, nodemailer |
| Standalone backend | Node.js + Express 4, deployed separately on **Render** |
| Database / Auth / Storage | Firestore, Firebase Authentication (custom claims for role-based access), Firebase Storage |
| Hosting | Firebase Hosting, serves the built frontend as an SPA |
| External APIs | Convert.com REST API, Google Analytics 4 Data API, ClickUp API, Google PageSpeed Insights |

Firebase project: `client-dash-9b027`. Full depth (data flow diagram, Firestore data model, deployment topology, credential-storage table) → [`docs/audit/01-ARCHITECTURE.md`](audit/01-ARCHITECTURE.md).

## 4. Repo layout

- **`frontend/`** — the React SPA. Everything a user (admin or client) actually sees.
- **`functions/`** — Firebase Cloud Functions (TypeScript). Privileged server-side operations: user creation, ROI calculation, credential rotation, ClickUp OAuth.
- **`server/`** — a standalone Express app deployed separately on Render. Handles ClickUp integration, transactional email, GA4/PageSpeed data fetches, the custom Analytics Report Builder's data API, and runs the twice-daily Convert.com sync.
- **`scripts/`** — one-off/maintenance scripts run manually (reconciliation, data migrations).
- **`docs/`** — you are here. See [§13](#13-doc-map) for the full map.

Full folder-by-folder breakdown, including a "where to look for X" quick-reference → [`docs/audit/02-CODEBASE-GUIDE.md`](audit/02-CODEBASE-GUIDE.md).

## 5. Local development setup

### Prerequisites
Node.js (functions targets Node 20), npm. The Firebase CLI is only needed if you're deploying, not for local dev.

### Install
There is **no npm workspace** — `frontend/`, `functions/`, `server/`, and the repo root each have their own independent `package.json` and lockfile. Install each one separately (`npm install` in each directory) before running anything.

### Environment variables

There's no `.env.example` anywhere in the repo, so here's every variable actually referenced in source today:

**Frontend** (`frontend/.env`, must be prefixed `VITE_` to reach the browser bundle):

| Variable | What it's for |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase web SDK config — fine to be public, Firestore/Auth rules are the real gate |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase web SDK config |
| `VITE_FIREBASE_APP_ID` | Firebase web SDK config |
| `VITE_API_URL` | Base URL of the Express server (points at the Render deployment) |
| `VITE_EXCHANGE_RATE_API_KEY` | Currency-conversion fallback — a real third-party key; **note it's currently committed to git, see `docs/audit/03-FINDINGS.md` C5** |

**`server/`** (Express on Render, plain `process.env`):

| Variable | What it's for |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin SDK credentials (falls back to a local `functions/serviceAccountKey.json` file if unset) |
| `GA4_SERVICE_ACCOUNT_JSON` | GA4 Data API credentials (falls back to a local `server/ga4ServiceAccount.json` file if unset) |
| `NODE_ENV` | Also gates the CORS allowlist — see the local-dev gotcha below |
| `PORT` | Server port |
| `GMAIL_USER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Gmail send via OAuth2 |
| `CLICKUP_PERSONAL_TOKEN` / `CLICKUP_API_TOKEN` | Fallback ClickUp token |
| `PUBLIC_SERVER_URL` | Used to build links in admin-approval emails |
| `PAGESPEED_API_KEYS` / `PSI_API_KEYS` / `PSI_API_KEY` | PageSpeed Insights API key(s) |
| `PAGESPEED_CONCURRENCY`, `PAGESPEED_TIMEOUT_MS`, `PAGESPEED_MAX_ATTEMPTS` | PageSpeed runner tuning |

**`functions/`** (Cloud Functions, `process.env` or GCP Secret Manager via the `secrets:` option):

| Variable | What it's for |
|---|---|
| `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`, `CLICKUP_REDIRECT_URI` | ClickUp OAuth app |
| `EXCHANGE_RATE_API_KEY` | Server-side currency conversion (`convertServicePrice` function) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `INTERNAL_EMAIL_SECRET` | `sendEmailHttp` function |
| `SENDGRID_API_KEY` | `sendOnboardingEmail` function |
| `ENCRYPTION_KEY` | AES-256-GCM key for per-client credential encryption — currently a plain env var, **not** in Secret Manager (see `docs/audit/01-ARCHITECTURE.md`'s credential table) |
| `FIREBASE_SA_PRIVATE_KEY`, `FIREBASE_SA_CLIENT_EMAIL`, `FIREBASE_PROJECT_ID` | Firebase Admin SDK credentials, pulled from Secret Manager |

*Recommendation: adding real (placeholder-value) `.env.example` files to `frontend/`, `functions/`, and `server/` using the tables above would make onboarding smoother — worth doing as a follow-up, it's a config change rather than documentation.*

### Running it

From the repo root:
```
npm run dev
```
This runs `concurrently` to start the Vite dev server (frontend) and the Express server (`node --watch server/index.js`) together.

> **There is no local Firebase emulator in this repo.** Local frontend dev talks to **real production Firestore, Auth, and Storage** — any write you make while developing locally is a real write to production data. There's also no local backend sandbox for `server/`: the CORS config there only allowlists production origins in `NODE_ENV=production`, so browser requests from `localhost` to GA4/PageSpeed endpoints will look like CORS failures even though the server is healthy. Full detail on this and other local-dev gotchas → [`docs/audit/07-DEV-GUIDE.md`](audit/07-DEV-GUIDE.md) §6.

### Getting a first local admin login

Account creation isn't self-serve in this app (see [§7](#7-auth--onboarding-model)). `functions/scripts/seedAdmin.js <email> <password> [name]` creates or promotes a Firebase Auth user to admin — but it requires `functions/serviceAccountKey.json`, which isn't in the repo (it's git-ignored). You'll need that key from whoever manages the Firebase project, or use an existing admin's real production credentials to log in locally.

## 6. Build & deploy

| Workspace | How it ships | Watch out for |
|---|---|---|
| `frontend/` | `cd frontend && npm run build`, then `firebase deploy --only hosting` from repo root | No CI runs the build before it's live |
| `functions/` | `firebase deploy --only functions` from `functions/` | A function must be exported from `functions/src/index.ts` or the deploy silently ships nothing for it |
| `server/` | Render's own git-push auto-deploy — not part of the Firebase CLI at all | Pushing to the deployed branch ships immediately, no staging gate |
| `firestore.rules` | `firebase deploy --only firestore:rules` — a **separate** command | Editing the file locally has zero live effect until this runs; per a known production/git drift issue, pull the live rules from the Firebase console and merge by hand before overwriting — see `docs/audit/03-FINDINGS.md` C6 |

There's no CI and no automated test suite anywhere in this repo — a broken change reaches production the moment it's deployed/pushed. Full deploy guidance and gotchas → [`docs/audit/07-DEV-GUIDE.md`](audit/07-DEV-GUIDE.md) §5.

## 7. Auth & onboarding model

**Client accounts** are created by an admin, not self-serve. From `CreateClientPage`, an admin types the new client's email and password directly into a form; the account is created client-side (via a secondary, throwaway Firebase app instance) along with the client's Firestore records. *Why this matters:* the properly-built, credential-encrypting Cloud Function path (`createClientUser`) exists in the codebase but isn't actually wired up to this UI — see `docs/audit/03-FINDINGS.md` C1/C2 for the security implications if you're touching this flow.

**Admin accounts** have no self-signup UI in this checkout — the practical path is `functions/scripts/seedAdmin.js` (see [§5](#5-local-development-setup)). A server-side admin-approval-by-email flow (`pendingAdmin` role, `/api/admin-signup/*` routes) exists and is apparently live in production, but isn't reachable from this frontend build — see `docs/audit/01-ARCHITECTURE.md`'s data-model section for the detail.

**Other auth pages:** `/forgot-password` triggers a self-service password-reset email; `/set-password` handles a Firebase magic-link sign-in flow (used if the onboarding-email path is ever re-enabled). An admin can also reset or directly set a client's password from `ClientDetailPage`.

**Roles:** `client`, `admin`, `executiveAdmin` (a singleton — controls visibility of pricing/service-fee fields). Role and client-scoping are resolved from Firebase Auth **custom claims** first, falling back to a Firestore `users/{uid}` document read if claims haven't propagated yet.

## 8. Admin feature walkthrough

All admin routes live under `/admin`.

| Route | Page | What it does |
|---|---|---|
| `/admin` | Overview | Agency-wide KPIs (active/total/inactive clients) and the client roster table |
| `/admin/clients` | Client List | Full searchable client directory; **Preview** (see the dashboard as the client would) and **Edit** per row |
| `/admin/clients/new` | Create Client | Onboard a new client (or admin) account — see [§7](#7-auth--onboarding-model) |
| `/admin/clients/:clientId` | Client Detail | The main per-client hub, in 5 tabs: **Overview** (account/engagement/pricing/GA4 property, password management), **Convert Data Pulls** (incremental or full resync from Convert.com, live progress), **Dashboard Settings** (per-experiment overrides, manual experiments — see below), **Timeline Builder** (project roadmap, ClickUp task sync), **Audit Findings** (tracking/analytics audit issue tracker for this client — admins can bulk-import from a prior audit or create/edit findings directly with a form) |
| `/admin/clients/:clientId/preview` | Preview as Client | The client dashboard rendered exactly as that client sees it |
| `/admin/clients/:clientId/analytics-reports` | Analytics Reports list | All custom GA4 reports built for this client, with a toggle to show/hide the whole feature in their sidebar |
| `/admin/clients/:clientId/analytics-reports/:reportId` | Analytics Report Builder | A full drag-and-drop GA4 report builder — arbitrary metric/dimension breakdowns, comparisons, funnels, charts, and auto-generated narrative insights, independent of the Convert.com experiment dashboard |
| `/admin/logs` | Client Logs | Real-time, session-grouped feed of everything a client does on their dashboard, with CSV/PDF export |
| `/admin/support` | Support | Unified inbox of all client support tickets with real-time chat |
| `/admin/settings` | Settings | One-time org-wide ClickUp OAuth app configuration |
| `/admin/docs` | Docs | In-app help for admins, plus a button to relaunch the guided product tour |

**Dashboard Settings** (inside Client Detail) is worth calling out specifically: it's how an admin controls exactly what a client sees — renaming an experiment for the client, overriding which variant counts as "original," overriding uplift numbers per metric, leaving client-visible notes, excluding an experiment from KPIs, and adding fully manual (non-Convert) experiments.

## 9. Client feature walkthrough

All client routes live under `/dashboard`.

| Route | Page | What it does |
|---|---|---|
| `/dashboard` | Dashboard | The main landing page: date-range filter, headline KPIs (Revenue/Purchases/Products Uplift), an ROI panel (progress toward breakeven and beyond), a daily revenue-uplift chart, win/loss rate, and recent experiments |
| `/dashboard/ab-testing` | A/B Testing hub | Chooser page linking to the Dashboard and the full Experiments list |
| `/dashboard/experiments` | Experiments list | Every experiment, searchable/sortable, with per-experiment metrics and a personal hide/show toggle |
| `/dashboard/experiments/:id` | Experiment Detail | Full metric breakdown for one experiment: original vs. best variation, per-variation raw numbers, goals, live preview links |
| `/dashboard/ga4` | GA4 Data View hub | Chooser page for the GA4-based data view — a **separate, parallel data source** from the Convert.com-based pages above, correlated only by experiment naming convention |
| `/dashboard/ga4/dashboard` | GA4 Dashboard | Aggregated GA4-sourced KPIs across experiments |
| `/dashboard/ga4/experiments` | GA4 Experiments | Per-experiment GA4 audience data (original vs. variation) |
| `/dashboard/timeline` | Timeline | Read-only project roadmap built by the admin — phases with dates, descriptions, deliverables, linked ClickUp task status |
| `/dashboard/book-meeting` | Book a Meeting | One-click Calendly links for a business or a technical meeting |
| `/dashboard/audit-findings` | Audit Findings *(optional)* | View tracking/analytics audit findings and their fix status. Only appears in the nav if the admin has enabled it for this client |
| `/dashboard/analytics-reports` (+ `/:reportId`) | Analytics Reports *(optional)* | Read-only gallery and viewer for the custom GA4 reports the admin built. Only appears if enabled for this client |
| `/dashboard/profile` | Profile | Change your own account password |
| `/dashboard/support` | Support | Dedicated support chat thread with the agency |
| `/dashboard/docs` | Docs | In-app help for clients, plus a button to relaunch the guided product tour |

A persistent floating chat bubble (same underlying support-ticket data as the Support page) is available from every screen for both roles.

## 10. External integrations at a glance

| Integration | Used for |
|---|---|
| Convert.com | Source of A/B test experiment results — synced into Firestore by an admin action or a twice-daily scheduled job |
| Google Analytics 4 | Revenue/transaction enrichment; also powers the standalone Analytics Report Builder |
| ClickUp | Optional per-client task sync into the project Timeline |
| Google PageSpeed Insights | Site performance scans (admin-triggered) |
| Exchange rate API | Currency conversion for reporting in a client's preferred currency |
| Gmail / SendGrid | Transactional email (password resets, support notifications, admin approvals) |

Where each credential is actually stored and how (and where that's inconsistent) → [`docs/audit/01-ARCHITECTURE.md`](audit/01-ARCHITECTURE.md)'s credential-storage table.

## 11. Brand & UI system

The app's visual language — colors, typography, logo usage, and the shared component library — is documented separately in [`docs/brand/`](brand/README.md), extracted from the agency's brand guidelines PDF. Start with `docs/brand/README.md`.

## 12. Current state, honestly

This app has open Critical and High-severity findings — credential-handling inconsistencies, an unauthenticated endpoint, a committed API key, and no automated tests, among others. Before treating anything above as production-hardened:
- Read [`docs/audit/03-FINDINGS.md`](audit/03-FINDINGS.md) for the full severity-ranked list with file:line citations.
- Read [`docs/audit/06-RELEASE-BLOCKERS.md`](audit/06-RELEASE-BLOCKERS.md) for the short, literal pre-release checklist.
- If you're building new features on top of this as-is, read [`docs/audit/07-DEV-GUIDE.md`](audit/07-DEV-GUIDE.md) first — it's written specifically to stop you from repeating an existing mistake (a fifth Convert-sync implementation, a new unauthenticated route, a rules deploy that overwrites live config) while you keep shipping.

## 13. Doc map

| File | What it's for |
|---|---|
| `docs/USER_GUIDE.md` | This file — start here |
| `docs/audit/00-INDEX.md` | Table of contents / reading order for the audit docs below |
| `docs/audit/01-ARCHITECTURE.md` | Tech stack, data flow, Firestore data model, deployment topology, credential-storage table |
| `docs/audit/02-CODEBASE-GUIDE.md` | Folder-by-folder map of the whole repo, "where to look for X" |
| `docs/audit/03-FINDINGS.md` | Every concrete problem found, severity-ranked, with file:line references |
| `docs/audit/04-DEPENDENCIES.md` | `npm audit` results across all workspaces |
| `docs/audit/05-RECOMMENDATIONS.md` | Prioritized fix order and a go/no-go call |
| `docs/audit/06-RELEASE-BLOCKERS.md` | Short pre-release checklist — only client-harming bugs |
| `docs/audit/07-DEV-GUIDE.md` | Practical guide for building new features on this codebase without making it worse |
| `docs/audit/08-AUDIT-FINDINGS-FEATURE.md` | Writeup of the Audit Findings tracker feature — data model, access control, migration status |
| `docs/brand/README.md` | Brand folder overview, source PDF reference, quick-reference color table |
| `docs/brand/01-logo.md` | Logo rationale, color variants, do/don't rules, placeholder status |
| `docs/brand/02-typography.md` | Type system (Sora / KO Sans), hierarchy table |
| `docs/brand/03-colors.md` | Brand palette in full, app token mapping |
| `docs/brand/04-elements.md` | Iconography, photography, pattern, and button rules |
| `docs/brand/design-system.md` | Shared component library reference — tokens, rules, component table |

Also worth knowing about, outside `docs/`: [`CRO_Dashboard_PRD.md`](../CRO_Dashboard_PRD.md) (repo root — the original spec) and [`ADMIN_DASHBOARD_OVERRIDES.md`](../ADMIN_DASHBOARD_OVERRIDES.md) (repo root — inventory of admin-override capabilities, implemented vs. planned).
