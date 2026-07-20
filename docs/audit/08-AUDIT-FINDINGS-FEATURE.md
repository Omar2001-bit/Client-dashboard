# Audit Findings Feature

Added after the initial audit (`00-INDEX.md` through `07-DEV-GUIDE.md`), so it isn't covered there. This doc is standalone: what the feature is, its data model, where the code lives, how access control works, what's been verified end-to-end vs. what's still pending, and one significant thing found while testing it that has nothing to do with the feature itself.

## What it is and why

A per-client tracker for findings from a tracking/analytics audit (GA4, GTM, Google Search Console, Shopify, Microsoft Clarity setup issues) — search/filter a list of findings, see severity and fix-progress, and (for admins) mark things fixed, leave notes, and delete/restore. It's a port of a separate, standalone single-file HTML dashboard (a different repo, referred to below as "the old dashboard") into this app's real multi-tenant model, replacing that dashboard's client-side-cookie "expert mode" gate with this app's actual admin/client Firebase Auth roles.

Findings can enter the system two ways: bulk-imported from a prior audit (see "Migration scripts" below), or **authored directly from the dashboard** — an admin can create a new finding or edit an existing one's full content (issue/detail/fix/verify/docs/routing, technical + plain-English pairs) via a form in the Audit Findings tab, without needing either script or a service-account key. See "Create/edit UI" below.

The port was deliberate about **not** carrying over two things from the old dashboard: its cosmetic-only access control (a cookie value compared client-side, with the full unrestricted data downloaded to every visitor regardless), and a row-visibility bug where findings classified as "Correct" or "Checklist" were hidden from *every* viewer, including the equivalent of an admin — despite several of the old dashboard's own commit messages implying that was supposed to become an expert-only view rather than a blanket exclusion. See "Access control" below for how this app's version handles both differently.

## Data model

One collection, one document per finding — deliberately not split into a separate "static data" collection and a "progress" collection. Reasoning: only the admin role ever writes progress (the client role is read-only), and progress is dense (nearly every finding gets a status eventually), so there's no sparse-overlay or competing-writer reason to split it the way `experiments` and `settings/clientPreferences` are split elsewhere in this app (see `01-ARCHITECTURE.md`). Every write — from the migration scripts or from the UI — is a `merge: true` write of only the fields being changed, which is what makes both migration scripts (below) safely re-runnable in either order.

```
clients/{clientId}/auditFindings/{findingId}
  # Identity — immutable after import/creation; findingId is a deterministic slug from the old
  # dashboard (sheet + tool + row + issue-id) for imported rows, reused as-is so re-importing the
  # same source data stays keyed correctly — or `manual-{timestamp}-{random}` for admin-authored
  # findings (see "Create/edit UI" below)
  id, row, sourceRow, sourceTab
  tool: "GA4" | "GTM" | "Google Search Console" | "Shopify" | "Behavioral Tool"   # "Behavioral Tool" = Clarity, verbatim source value
  issueId

  # Audit classification — imported once
  auditStatus: "Correct" | "Unable to Verify" | "Critical" | "High" | "Action Needed"
  manualReview: boolean
  isCorrectRow, isChecklistRow: boolean   # precomputed at import time, not per-render — see "Access control"

  # Content — fields marked ADMIN-ONLY below are never rendered for the client role
  issue, businessIssue, summary, detail, businessDetail, technicalExplanation
  fix, businessFix, verify, businessVerify, docs                              # ADMIN-ONLY
  owner, qaOutcome, reviewStatus, routingNote, evidenceLink                    # ADMIN-ONLY (routing)

  # Fix-progress — mutable, admin-write-only, client read-only
  progressStatus: "unreviewed" | "fixed" | "notfixed"
  note, deleted, deletedAt, progressUpdatedAt, progressUpdatedBy

  # Import bookkeeping
  importedAt, importBatchId, legacyProgressMigrated, legacyUpdatedAtIso
```

One settings flag, on the **existing** `clients/{clientId}/settings/dashboard` doc rather than a new doc (same namespace `ADMIN_DASHBOARD_OVERRIDES.md` already uses for per-client dashboard-wide flags): `auditTrackingEnabled?: boolean` — gates whether the client's nav shows an "Audit Findings" item at all. See "Access control" for why this is a nav-visibility convenience, not a security boundary.

Types: `AuditFindingDoc`, `AuditSeverity`, `FixProgressStatus`, `AuditFindingTool` in `frontend/src/types/index.ts`.

## Code map

Full file listing is in `02-CODEBASE-GUIDE.md` (frontend section + `scripts/` section). The shape, briefly:

- `frontend/src/lib/auditFindings.ts` — all Firestore access and mutation logic (`loadAuditFindings`, `markFindingProgress`, `setFindingNote`, `deleteFinding`, `restoreFinding`, plus `createFinding`/`updateFindingContent` — see "Create/edit UI" below), plus the filter/scoping pure functions (`isVisibleToClient`, `requiresManualReview`, `filterFindings`, `sortFindings`). Centralized here rather than inline in page components, same pattern as `dashboardData.ts`/`convertSync.ts`.
- `frontend/src/hooks/useAuditFindings.ts` — one `useQuery` wrapping `loadAuditFindings`, same shape as `useDashboardData.ts`. One bulk read per client, cached by TanStack Query — not a realtime `onSnapshot` listener, consistent with how `experiments` is read elsewhere in this app.
- `frontend/src/components/auditFindings/` — `AuditFindingFilters`, `AuditFindingList`, `AuditFindingDetail`, shared between both surfaces via a `mode: "admin" | "client"` prop that gates which fields/actions render; `AuditFindingFormDialog` (admin-only) is the create/edit form, opened from a "+ New finding" button and from an "Edit" button on `AuditFindingDetail`.
- `frontend/src/pages/admin/AdminAuditFindingsPage.tsx` — rendered as a **tab inside `ClientDetailPage.tsx`**, not a standalone route, matching how `ClientDashboardSettingsPage` and `ClientTimelineEditorPage` already work there.
- `frontend/src/pages/dashboard/AuditFindingsPage.tsx` — a real route (`/dashboard/audit-findings`), nav-gated but not route-gated (see "Access control").
- `scripts/importAuditFindings.js` / `scripts/migrateAuditProgress.js` — see "Migration scripts" below.

## Access control

Firestore rule (added to `firestore.rules`, same shape as the existing `experiments` rule):
```
match /clients/{clientId}/auditFindings/{findingId} {
  allow read: if isAdmin() || isClientOf(clientId);
  allow write: if isAdmin();
}
```

**Admin = full "expert" access**: sees every field (fix/verify/docs/routing/notes), can create new findings and edit existing ones' content, mark fixed/not-fixed/reset, add notes, delete/restore, and toggle a filter to reveal "Correct"/"Checklist" rows (default hidden, but — unlike the old dashboard — genuinely *available* to this role, not hidden from everyone). **Client = read-only, restricted**: `AuditFindingDetail` in `mode="client"` never renders the admin-only fields or any action button — this is a component-level omission, not a fetched-then-hidden trick. Firestore rules are document-granular, not field-granular, so the client role technically still has raw read access to the full document (same accepted pattern as `experimentOverrides.notes` elsewhere in this app) — what's real here, unlike the old dashboard, is that the *write* boundary (mark fixed, notes, delete) is a server-enforced Firestore rule, not a client-side cookie value nobody validates server-side.

Client-side row scoping (`isVisibleToClient`): findings marked `isCorrectRow` or `isChecklistRow` are unconditionally excluded from the client's list — deliberately, as a "this is noise for a progress tracker" product decision, not inherited baggage from the old dashboard's bug. Admin has a filter toggle to include them (default off), since seeing the full audited set — including what was already fine — is a real admin use case the old dashboard couldn't support for anyone.

The `auditTrackingEnabled` flag only controls whether the client's nav shows the link — the route itself has no additional guard, so a client visiting `/dashboard/audit-findings` directly with the flag off just sees the same "no findings" empty state a client with the flag on and zero findings would see. Not a security gap (Firestore rules already scope reads to that client's own findings regardless of the flag) — it's UX-convenience gating only, matching how `ga4PropertyId` already gates the GA4 nav item.

## Create/edit UI

Added after the initial version of this feature (which was read/progress-only from the UI — content came exclusively from `importAuditFindings.js`). `AuditFindingFormDialog.tsx` is a single component used for both create and edit (`finding: AuditFindingDoc | null` — `null` means create), opened via a "+ New finding" button (in the toolbar, and in the empty state so a client with zero findings isn't dead-ended into needing the import script) and via an "Edit" button on `AuditFindingDetail`'s admin action row.

**What the form covers**: tool, severity, source tab, issue/detail/fix/verify (each with an optional plain-English pair that falls back to the technical text when left blank, same `pick()` behavior the detail view already used), docs, and a collapsible "Advanced" section for the routing fields (owner/QA outcome/review status/routing note/evidence link) — auto-expanded when editing a finding that already has any of them set.

**What it does *not* let you touch**: progress fields (`progressStatus`/`note`/`deleted`/etc.) stay owned by the existing mark-fixed/notes/delete-restore actions. `updateFindingContent()` is a pure content merge-write that never writes `progressUpdatedAt`/`progressUpdatedBy` — verified directly (mark a finding fixed, edit its content, confirm the fixed status and completion % are untouched) so a content edit can't be mistaken for a progress change in the audit trail.

**Fields not exposed in the form, and their defaults for a manually-created finding** (`createFinding()` in `lib/auditFindings.ts`):
- `row`/`sourceRow` → `""` (spreadsheet-coordinate fields, meaningless for a hand-authored finding; an empty `row` is an honest "this wasn't imported" signal in the Routing details panel)
- `sourceTab` → admin-settable text input, defaults to `"Manual"` if left blank (it's a live filter dimension and shows in the detail header, so worth letting the admin group manual entries under a name of their choosing)
- `issueId` → set to the generated finding id (used as a list-title fallback, must never be empty)
- `manualReview`/`isCorrectRow`/`isChecklistRow` → `false` (these are import-only spreadsheet heuristics; a hand-authored finding is by construction an actionable issue)
- `id` → client-generated, `manual-{timestamp36}-{random5}` (mirrors `ga4Reports/storage.ts`'s `newGa4ReportId()` pattern), used as both the Firestore doc id and the doc's own `id` field — the `manual-` prefix makes these greppable/distinguishable from imported rows (which use the source spreadsheet's own row id) in the Firestore console
- `importedAt`/`importBatchId` → `serverTimestamp()` / `"manual-{uid}"` (reuses the existing fields rather than adding a parallel `createdAt`)

**`createFinding()` also stamps `auditTrackingEnabled: true`** on `clients/{clientId}/settings/dashboard` (idempotent merge-write) — the same flag the import script's last step sets. Without this, a client who'd never had an import run would never see the "Audit Findings" nav item even after an admin created findings for them purely through this UI. This was identified and fixed as part of building the feature, not left as a gap.

**A bug found and fixed during initial end-to-end testing**: the first version of `AuditFindingFormDialog` seeded its form state via a `useState(() => finding ? fromFinding(finding) : blankInput())` lazy initializer, expecting fresh data on every open. But the parent page always rendered `<AuditFindingFormDialog>` and only toggled its `open` prop — so the dialog component itself never unmounted, and that initializer only ever ran once, on the very first render (when there was no finding selected yet). Every subsequent "Edit" click reopened the same stale, blank state instead of the selected finding's real content. Fixed by having the parent conditionally *render* the dialog (`formOpen !== null && <AuditFindingFormDialog .../>`) instead of always rendering it with a toggled `open` prop, so it truly remounts — and its state initializer re-runs — every time it opens. Worth remembering as a general gotcha for any future dialog/form component seeded from a prop via a `useState` initializer: toggling `open` alone is not enough if the component itself stays mounted.

## Migration scripts

Both are one-off, CLI-flag/env-var-driven (no hardcoded client ID or paths — the old dashboard's own hardcoded-workbook-path mistake was the explicit cautionary example not to repeat), and idempotent via merge-writes keyed by the finding's deterministic `id`.

- **`scripts/importAuditFindings.js`** — extracts the embedded JSON dataset directly from the old dashboard's live `index.html` (`<script type="application/json" id="audit-data">`), maps it into `AuditFindingDoc` shape, and writes it. Reads existing docs first so progress fields are only initialized for genuinely new findings — re-running this after real progress has been tracked will refresh content without resetting anyone's fix-progress. Also flips `auditTrackingEnabled: true` on the target client's settings doc as its last step.
- **`scripts/migrateAuditProgress.js`** — pulls fix-progress (status/notes/deleted) from the old dashboard's **separate Firebase project** and merges it into the docs the script above wrote. Requires a service-account key for that old project specifically — genuinely new, this repo has never held it, and it can't be produced from inside this repo. Orphaned progress (an old `pointId` with no matching new doc) is logged and skipped, not fabricated into a new finding.

**Current status: neither has been run against real data.** No service-account key exists locally for either the current project or (especially) the old one — see `07-DEV-GUIDE.md` §6. The full read/write cycle (filters, mark fixed, notes, delete/restore, client-restricted view) **has** been verified end-to-end, but with synthetic test documents written directly via an authenticated admin browser session (not through these scripts), then fully deleted afterward. Running the real bulk import is still a manual step for whoever has the source `index.html` and both service-account keys — but it's no longer the only way a client ends up with findings: the Create/edit UI above needs neither script nor a service-account key, so a client can have real, admin-authored findings today without the bulk import ever having run for them.

## What's been verified vs. what hasn't

Verified directly, via manual testing against the real `client-dash-9b027` project (a real client, real admin/client logins — not a code read):
- Empty-state rendering on both admin and client sides, before any data exists.
- Nav gating (item absent when `auditTrackingEnabled` is unset/false; present and correct when true).
- The `?tab=audit` and `?findingId=` deep-link query params.
- Full admin CRUD cycle: filters (tool/severity/progress/manual-review/show-correct-checklist/deleted-view), sort, KPI counts, mark fixed/not fixed/reset (persists through reload), debounced notes (persists through reload), delete → restore (preserves fix status, correctly excluded/included per the Active/Deleted/All filter).
- Client-restricted view: correct 3-card KPI strip (no "Not fixed"), correct row exclusion (Correct/Checklist rows invisible), business-language title shown by default, detail pane showing only "Why it matters" with zero admin-only fields or actions present in the rendered output.
- Cleanup: all synthetic data removed and the settings flag reverted, with a verification re-check that the empty state actually returned (not just assumed).

**Create/edit UI, verified separately** (against a real client account, one real finding created/edited/deleted, then soft-deleted as cleanup — not left in the "Active" view):
- Validation: submitting with no `issue` text is blocked with an inline "Required" error, no write attempted.
- Create: full field set including the Advanced/routing section saved correctly; KPIs updated live; the new finding auto-selected via `?findingId=`.
- Plain-English fallback: fields left blank on create correctly fell back to the technical text when toggling business mode; fields that were filled correctly overrode it.
- Edit: initially broken (see the dialog-remount bug described under "Create/edit UI" above), confirmed fixed — reopening Edit now correctly pre-fills every field including auto-expanding Advanced when routing data exists.
- Content edits don't disturb progress: marked a finding fixed, edited its content, confirmed the fixed status and completion % were unaffected.
- `auditTrackingEnabled` auto-enable: confirmed the client's "Audit Findings" nav item appeared automatically after a finding was created for them via the UI, with no import script ever run for that client.
- Client view of an admin-authored finding: identical rendering to an imported finding — only "Why it matters" visible, no admin-only fields or actions.

Not yet exercised: the two migration scripts against real data (blocked on service-account keys, see above), and anything at scale — all testing above used 2-3 synthetic findings, not a realistic ~1,800-row dataset. The existing app's own pattern (bulk read + in-memory filter, no server-side pagination — see "Code map") is expected to hold at that scale based on the numbers involved, but hasn't been load-tested.

## One more thing, found while testing this — not related to the feature itself

Manually testing this feature meant actually clicking through both the local dev build and the deployed production site as a comparison baseline — which surfaced a real, previously-unknown finding that has nothing to do with audit findings: **the deployed production site has drifted from this git checkout, and admins currently cannot open a client's detail page on the live site at all.** Full writeup: `03-FINDINGS.md` C6. It's called out here too because it directly affects deploying this feature — the live Firestore rules already have content (`pendingAdmin`, `pagespeed`) this repo's `firestore.rules` doesn't, so publishing this feature's new rule required hand-merging against what's actually live rather than just deploying the local file (see `07-DEV-GUIDE.md` §5's Firestore-rules row for the mechanics of why that distinction matters). Reconcile C6 before deploying this feature, not after.
