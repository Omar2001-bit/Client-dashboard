# Client-Dashboard — Onboarding & Audit Docs

**New to this project? Start with [`../USER_GUIDE.md`](../USER_GUIDE.md)** — it covers what the app does, how to run it locally, and a full feature walkthrough for both roles. Come back here for the deeper architecture/security audit trail.

Read these in order. Each is standalone — skip ahead if you already know a section.

| # | Doc | What it's for |
|---|---|---|
| 1 | [01-ARCHITECTURE.md](01-ARCHITECTURE.md) | What the app does, tech stack, how the pieces talk to each other |
| 2 | [02-CODEBASE-GUIDE.md](02-CODEBASE-GUIDE.md) | Where things live, folder-by-folder, so you can navigate without grepping blind |
| 3 | [03-FINDINGS.md](03-FINDINGS.md) | Every concrete problem found, severity-ranked, with file:line references |
| 4 | [04-DEPENDENCIES.md](04-DEPENDENCIES.md) | `npm audit` results across all four workspaces, interpreted honestly |
| 5 | [05-RECOMMENDATIONS.md](05-RECOMMENDATIONS.md) | Opinion, prioritized fix order, and the go/no-go call |
| 6 | [06-RELEASE-BLOCKERS.md](06-RELEASE-BLOCKERS.md) | The short list: only bugs that can concretely hurt a client. Use as a literal pre-release checklist. |
| 7 | [07-DEV-GUIDE.md](07-DEV-GUIDE.md) | Not an audit doc — a practical guide for building new features on top of the codebase *as it is today*, without adding a fifth Convert-sync copy or a new unauthenticated route. Read this one before writing code; read 1-6 for the "what's wrong and why" behind it. |
| 8 | [08-AUDIT-FINDINGS-FEATURE.md](08-AUDIT-FINDINGS-FEATURE.md) | Documents the Audit Findings tracker feature added after the initial audit — data model, code map, access control, migration scripts, and what was actually verified end-to-end vs. what's still pending. Read this if you're touching that feature, or if you're about to deploy and want to know about the production/git drift finding first. |

## Update — 2026-07-17: Audit Findings feature added, and a live production bug found

Since the initial audit below, an **Audit Findings** tracker was built and integrated (`clients/{clientId}/auditFindings`, new admin tab, new client page) — see `08-AUDIT-FINDINGS-FEATURE.md` for the full writeup. Manually testing it end-to-end (admin CRUD cycle, client-restricted view, cleanup) surfaced a new **Critical** finding unrelated to the feature itself: **the deployed production site (`client-dash-9b027.web.app`) is running a build that has drifted from this git checkout in both directions** — most urgently, admins currently cannot open any client's detail page on the live site at all (confirmed reproducible; see `03-FINDINGS.md` C6). This needs attention before the Audit Findings feature — or anything else — gets deployed on top of it. Two smaller, unrelated bugs were also found during the same testing pass (`03-FINDINGS.md` M7 and the new Low item).

**Confirmed still true as of 2026-07-19:** the structural drift this section describes hasn't changed — `CreateClientPage.tsx` still lacks the magic-link/website-URL fields the live site has, and this repo's `firestore.rules` still lacks the `pendingAdmin`/`pagespeed` blocks the live rules have. The live-site symptom itself (the broken client-detail page) was not re-tested this pass — verify directly against `client-dash-9b027.web.app` before assuming it's still broken or already fixed.

## The one-paragraph version

This is a **multi-tenant CRO ROI dashboard** (React + Firebase + a standalone Express server on Render) that pulls A/B-test data from Convert.com, enriches it with GA4 revenue data, and shows agency admins and their clients the ROI. The feature set is real and mostly works — a reconciliation audit already in the repo shows 49/49 experiments matching live Convert data. But it was built solo, fast, with no tests and no CI, and it has **one credential-handling bug that breaks a normal admin action** (rotating an API key), **an unauthenticated backend endpoint that leaks GA4 data across clients**, **a committed third-party API key**, and **a written security spec (`CRO_Dashboard_PRD.md` §7) that the shipped code directly contradicts**. None of this is exotic or hard to fix — most of it is a few hours of focused work each — but as-is, it should not go live for real client money/data without the Critical and High items in `03-FINDINGS.md` addressed first. Full reasoning and severity breakdown in that doc; final recommendation in `05-RECOMMENDATIONS.md`.

## How this was produced

Every claim in `03-FINDINGS.md` was checked against the actual source (file read, grep, or `npm audit`), not inferred from summaries — file:line references are included so you can verify each one yourself in under a minute. Where something looked concerning but turned out fine on inspection (e.g. the Firebase web API key being public, or the admin-approval email link), that's noted explicitly so this doesn't read as reflexive alarmism.
