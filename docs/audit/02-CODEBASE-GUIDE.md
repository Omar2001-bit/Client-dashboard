# Codebase Guide

A map for navigating without grepping blind. Organized by workspace.

## `frontend/src/`

Type-based at the top level, feature-based inside `pages/`.

```
frontend/src/
  App.tsx              — the entire route table (flat, eagerly imported, no lazy loading)
  store/authStore.ts    — Zustand store: { user, role, clientId, loading }
  hooks/
    useAuth.ts           — useAuthInit() subscribes to onAuthStateChanged, resolves role/clientId
    useDashboardData.ts  — React Query wrapper around one-shot Firestore reads
    useGA4Data.ts        — Firestore (metadata) + POST to Express server (live GA4 numbers)
    useDashboardSettings.ts, useClientTimeline.ts — onSnapshot live listeners
    useActivityTracker.ts, useScrollDepth.ts       — engagement analytics → activityLogs
    useGa4Reports.ts, useGa4ReportsMetadata.ts, useGa4ReportData.ts, useGa4FunnelData.ts
                          — Analytics Report Builder data layer, wrap lib/ga4Reports/api.ts's
                            calls to the server's /api/ga4-reports/* routes
  lib/
    firebase.ts          — Firebase SDK init (auth, db, storage, functions singletons)
    convertSync.ts        — 441 lines; browser-driven Convert.com sync engine ("Sync" button)
    adminUsers.ts          — createUserDirectly(): the ACTUAL client-creation path (see 03-FINDINGS.md)
    namingConvention.ts    — NAMING_REGEX = /^id\s*\d+\s*[|[(]/i, filters which Convert experiments count
    servicePriceConversion.ts, activityTracker.ts, supportChat.ts, tutorial step defs
  components/
    ui/                   — Button, Card/CardHeader/CardBody, Input, KPICard, Logo, StatusBadge, Spinner,
                             AuditSeverityBadge, FixProgressBadge (latter two added with the audit-findings feature)
    Layout/                — AdminLayout, ClientLayout (sidebar shells with <Outlet/>)
    auth/ProtectedRoute.tsx — the single route guard, role-check logic lives here
    timeline/               — timeline viewer
    auditFindings/           — AuditFindingFilters, AuditFindingList, AuditFindingDetail (shared between
                                the admin tab and the client page, mode="admin"|"client" prop gates content),
                                AuditFindingFormDialog (admin-only create/edit form, see 08-AUDIT-FINDINGS-FEATURE.md)
    ga4Reports/               — the Analytics Report Builder UI, ~15 files: ReportCanvas/ReportEditor
                                (the drag-and-drop builder itself), SortableSection/SortableMetricCard
                                (dnd-kit reordering), ChartView/FunnelView/NumbersView/AnalyticsView
                                (render modes), DateControls/DatePicker, MetaPicker/MetricJumpMenu,
                                EntryCard/MetricCarousel/ReportPreviewCard. Shared between the admin
                                builder page and the client's read-only report viewer.
  pages/
    admin/    — one file per admin route: AdminHomePage, ClientListPage, CreateClientPage,
                ClientDetailPage, ClientLogsPage, AdminSupportPage, AdminSettingsPage, AdminDocsPage,
                AdminAnalyticsReportsPage, AdminAnalyticsReportBuilderPage (the Analytics Report Builder,
                see components/ga4Reports/ above), plus three pages rendered as tabs *inside*
                ClientDetailPage rather than their own routes: ClientDashboardSettingsPage,
                ClientTimelineEditorPage, AdminAuditFindingsPage.
    dashboard/ — one file per client route: ClientDashboardPage (the big one, ~1080 lines),
                 dashboardData.ts (shared uplift/aggregation logic — but not fully reused, see findings),
                 ABTestingResultsPage, ExperimentListPage, ExperimentDetailPage, TimelinePage,
                 BookMeetingPage, ProfilePage, SupportPage, DocsPage, GA4DataViewPage, GA4DashboardPage,
                 GA4ExperimentsPage, AuditFindingsPage (client-restricted, route gated by a
                 nav-visibility flag, not by Firestore rules), AnalyticsReportsPage +
                 AnalyticsReportViewPage (client-facing gallery/viewer for admin-built GA4 reports,
                 same nav-visibility-flag gating as AuditFindingsPage).
  lib/auditFindings.ts    — loadAuditFindings(), filter/sort/scoping helpers (isVisibleToClient,
                             requiresManualReview), the admin mutation helpers (markFindingProgress,
                             setFindingNote, deleteFinding, restoreFinding) — all merge-writes — and
                             createFinding()/updateFindingContent() for the admin-authored create/edit UI
                             (see 08-AUDIT-FINDINGS-FEATURE.md)
  lib/ga4Reports/           — Analytics Report Builder data/logic, ~9 files: api.ts (calls
                              /api/ga4-reports/* on the Express server), storage.ts (Firestore CRUD
                              for clients/{id}/ga4Reports, mirrors auditFindings.ts's pattern),
                              insightEngine.ts (725 lines — auto-generated narrative insights) +
                              buildInsights.ts, types.ts, dates.ts, format.ts, theme.ts (feeds the
                              Recharts palette from theme tokens), metricLabels.ts
  hooks/useAuditFindings.ts — TanStack Query wrapper around loadAuditFindings(), same shape as useDashboardData.ts
  types/index.ts         — 311 lines, the richest type definitions (not shared with functions/ or server/) —
                            includes AuditFindingDoc/AuditSeverity/FixProgressStatus/AuditFindingTool
```

**Where to look for X:**
- Auth/session logic → `hooks/useAuth.ts` + `store/authStore.ts` + `components/auth/ProtectedRoute.tsx`
- ROI/uplift math as displayed to clients → `pages/dashboard/dashboardData.ts` and (duplicated) `pages/dashboard/ClientDashboardPage.tsx` lines ~848-896
- Convert.com sync (admin-triggered) → `lib/convertSync.ts`
- Client creation → `lib/adminUsers.ts` (`createUserDirectly`), invoked from `pages/admin/CreateClientPage.tsx`
- Credential rotation → `pages/admin/ClientDetailPage.tsx` (calls the `rotateClientCredentials` Cloud Function)
- Admin overrides of what a client sees → `pages/admin/ClientDashboardSettingsPage.tsx` + `settings/dashboard` doc
- Analytics Report Builder (drag-and-drop GA4 reports) → `components/ga4Reports/`, `lib/ga4Reports/`, `server/index.js`'s `/api/ga4-reports/*` routes, Firestore `clients/{id}/ga4Reports`
- ClickUp OAuth app config (admin, org-wide) → `pages/admin/AdminSettingsPage.tsx`, `appConfig/clickup` Firestore doc

## `functions/src/` (Firebase Cloud Functions)

```
functions/src/
  index.ts                — DEPLOY MANIFEST. Only what's exported here actually ships.
  createClientUser.ts      — onCall. Encrypts credentials, sets custom claims. NEVER CALLED by frontend.
  resetClientPassword.ts   — onCall
  rotateClientCredentials.ts — onCall. Encrypts new keys. Wired to ClientDetailPage UI.
  calculateROI.ts           — Firestore trigger on syncStatus/{syncType} write. See 03-FINDINGS.md.
  getExperiments.ts          — onCall. Reads Convert credentials, handles BOTH encrypted and
                                plaintext formats (readCredential() sniffs the format) — the only
                                place in the codebase that does this correctly.
  convertServicePrice.ts     — onCall, currency conversion w/ cached exchange rate doc
  sendEmailHttp.ts            — onRequest
  sendOnboardingEmail.ts       — Firestore trigger (onDocumentCreated)
  clickup.ts                    — 5x onCall + 1x onRequest (OAuth callback)
  syncConvertData.ts (NOT EXPORTED — dead code, scheduled sync, writes to a path nothing reads)
  triggerSync.ts       (NOT EXPORTED — dead code, manual-trigger twin of the above)
  lib/
    encryption.ts    — AES-256-GCM, key from ENCRYPTION_KEY env var, format "iv:authTag:ciphertext"
    firebaseAdmin.ts, cors.ts
  scripts/
    seedAdmin.js, deleteOrphanAuthUser.js, syncConvertDataLocal.js  — local/dev tooling, not deployed
```

**Rule of thumb:** if you're trying to understand "what actually runs in production," check `index.ts`'s export list first — several fully-written files in this directory are not exported and therefore not deployed.

## `server/` (Express, deployed on Render — separate from Firebase)

```
server/
  index.js            — 1,775 lines, everything in one file: routes, middleware, helper functions,
                          Gmail client, ClickUp fetch/normalize logic, PageSpeed runner, GA4 report logic,
                          all defined inline in call order. No routes/ or lib/ subdirectory.
  syncFromConvert.js    — cron-driven Convert sync (incrementalSyncAllClients, syncClientIncremental),
                            near-duplicate of frontend/src/lib/convertSync.ts's logic
  ga4-verify.js, ga4-verify-dates.js — standalone verification scripts, not part of the running server
```

**Auth pattern**: `requireAdmin` middleware (real Firebase ID-token verification, `index.js:69-92`) or a per-resource ownership check (`requireClientOwnsGA4Property`, `requireClientOrAdminOwnership`) together cover 11 of 19 non-`/health` routes today — the 5 `/api/clickup/*` routes, `/api/ga4/*` (both routes), and 4 of the `/api/ga4-reports/*` routes. The remaining 8 — `/api/support-email`, `/api/send-password-reset`, `/api/admin-signup/*` (2 routes), `/api/notify-executive-admin`, `/api/pagespeed/*` (3 routes) — have no auth check at all. See `03-FINDINGS.md` C4 for the concrete list and implications.

**Cron**: two `node-cron` jobs registered directly in `index.js` (`0 8 * * *` and `0 20 * * *`, `Africa/Cairo`), both calling `incrementalSyncAllClients()` from `syncFromConvert.js`.

## `scripts/` (repo root)

- `auditConvertVsFirestore.js` — standalone reconciliation script; compares Firestore-cached experiment data against live Convert.com API data and the app's computed series. Its most recent output is committed at `convert-firebase-audit-report.json` (dated 2026-04-30, 49/49 experiments matched).
- `importAuditFindings.js` — one-off migration: extracts the embedded JSON dataset from a separate project's ("tracking-dashboard") `index.html` and imports it into `clients/{clientId}/auditFindings`. CLI-flag/env-var driven (`--client-id`, `--html-path`, `--service-account`), no hardcoded defaults. Merge-writes only, safely re-runnable — see `08-AUDIT-FINDINGS-FEATURE.md`.
- `migrateAuditProgress.js` — one-off migration: pulls fix-progress (status/notes/deleted) from the *old* standalone dashboard's separate Firebase project and merges it into the docs the script above wrote, keyed by the same deterministic id. Needs a service-account key for that old project — not something this repo has; see `08-AUDIT-FINDINGS-FEATURE.md` for the exact prerequisite.

## Root-level docs worth reading directly

| File | What it actually is |
|---|---|
| `docs/USER_GUIDE.md` | Start here if you're new — what the app does, how to run it locally, and a full feature walkthrough for both roles. |
| `CRO_Dashboard_PRD.md` | The real spec — 14 sections, data model, security requirements, email flows, dev phases. Read §5 and §7 before touching auth, credentials, or the ROI engine. |
| `ADMIN_DASHBOARD_OVERRIDES.md` | Working inventory of admin-override capabilities (what's implemented vs. planned) for the `settings/dashboard` override system. |
| `convert-firebase-audit-report.json` | A generated report, not config — output of `scripts/auditConvertVsFirestore.js`. |
| `brand-guidelines.md` | **Not** this project's brand doc — it's a generic Claude Code skill definition that appears to have been copied into the repo root by mistake. Safe to ignore or delete. |
| `.agents/`, `.claude/` | Reusable Claude Code skill packs (frontend/design skills), not project-specific. No `CLAUDE.md` exists in this repo. |

## Naming/structure conventions actually in use

- Pages map 1:1 to routes; there's no shared "feature module" pattern — business logic that should be shared (uplift math, Convert response normalization) tends to live inside a page's file or a page-adjacent file (`dashboardData.ts`) rather than in `lib/`.
- `lib/` in the frontend is a flat junk-drawer (Firebase init, sync engine, currency conversion, tutorial content, activity tracking all as sibling files) — there's no further subdivision like `lib/convert/` or `lib/tutorial/`.
- Types are **not shared** across `frontend/`, `functions/`, and `server/` — each defines its own version of the same shapes (`ClientDoc`, `ExperimentROIEntry`, etc.), and they've already drifted. See `03-FINDINGS.md`.
