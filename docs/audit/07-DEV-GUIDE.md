# Dev Guide — Building On Top Of This Without Making It Worse

This is not another audit doc. `03-FINDINGS.md`, `05-RECOMMENDATIONS.md`, and `06-RELEASE-BLOCKERS.md` tell you what's wrong and what to fix before this carries real client data unattended. This doc assumes you're **not** stopping to fix all of that first — you're shipping new features on top of the codebase as it exists today, with C1-C6 and H1-H2 still open (C6 is the newest and most urgent for anyone about to deploy — see §1's last row). Its only job is to stop you from adding a fifth Convert-sync implementation, a third copy of the uplift math, a new unauthenticated route, or a deploy that overwrites live config you didn't know existed, while you're heads-down on a feature.

Two minutes reading the relevant finding before you touch a dangerous area is cheaper than rebuilding the feature after it turns out you copied a known-broken pattern.

---

## 1. Before you touch X, read Y

| If your task touches... | Read first | Because |
|---|---|---|
| Client creation, credential storage, or "Rotate Credentials" | `03-FINDINGS.md` C1, C2, C3 | The live path (`adminUsers.ts`) writes plaintext; the secure path (`createClientUser.ts`) is unused. Don't add a **third** place that reads/writes Convert credentials — see §4 below for the actual rule. |
| Any new Express route in `server/` | `03-FINDINGS.md` C4 | 8 of 19 non-`/health` routes have no auth check. Adding another unauthenticated route "temporarily" is exactly how the existing gap happened. |
| ROI or uplift numbers shown to a client | `03-FINDINGS.md` H1, H5 | There are already 2-3 disagreeing implementations (`calculateROI.ts`, `dashboardData.ts`, `ClientDashboardPage.tsx`'s inline copy). Extend the shared one; don't add a fourth. |
| Convert.com sync logic | `03-FINDINGS.md` H2 | Four implementations already exist and have drifted. If a feature needs sync data, call an existing path — don't write a new one. |
| A new third-party API key or secret | `01-ARCHITECTURE.md` "Where is each kind of credential actually stored?" | ClickUp's flow (`functions/src/clickup.ts` + `lib/encryption.ts`) is the correct template. Convert's plaintext path is the anti-pattern — don't copy it. |
| A shared data shape (`ClientDoc`, `ExperimentROIEntry`, etc.) | `03-FINDINGS.md` H4 | Types are hand-duplicated across `frontend/`, `functions/`, and `server/` with no compiler check between them. |
| The audit findings tracker (`clients/{clientId}/auditFindings`, `AdminAuditFindingsPage`, `AuditFindingsPage`) | `08-AUDIT-FINDINGS-FEATURE.md` | Data model, admin-vs-client field visibility, and the still-pending migration-script prerequisites are all documented there — don't re-derive the access-control split from scratch. |
| **Any deploy at all** — frontend, functions, or `firestore.rules` | `03-FINDINGS.md` C6 | Production has already drifted from this checkout in both directions (missing routes on one side, extra Firestore rules on the other). Confirm what's actually live before you overwrite it, especially for rules — see §5 below. |

---

## 2. Where new code goes

Follow the existing map in `02-CODEBASE-GUIDE.md`. A few "add here, not there" notes specific to extending the app safely:

- **New admin page** → `frontend/src/pages/admin/`, register the route in `App.tsx`, wrap it in `ProtectedRoute`.
- **New client page** → `frontend/src/pages/dashboard/`, same routing/guard pattern.
- **New shared calculation logic** (uplift, ROI, currency, anything a client's numbers depend on) → add to `frontend/src/pages/dashboard/dashboardData.ts` (or a clearly-named sibling file if it's genuinely a different concern). **Never write it inline in a page component** — that's precisely the mistake in H5, and every inline copy is one more place a rounding fix or metric-definition change won't propagate to.
- **New Cloud Function** → add the file under `functions/src/`, but it does not exist in production until you add it to `functions/src/index.ts`'s export list. This has already silently swallowed two fully-written files (`syncConvertData.ts`, `triggerSync.ts`) — always check `index.ts` when you're unsure whether something deployed is actually live.
- **Any new privileged/server-side operation** — anything that touches secrets, roles, custom claims, or account creation — **must** be a Cloud Function called via `httpsCallable`, never a direct client-side `setDoc`/`updateDoc`. This is the single hard rule that falls out of C2: the moment a privileged write happens straight from the browser, Firestore rules become the only thing standing between a client and someone else's data.
- **New server route** → goes in `server/index.js` (yes, it's a 1,775-line monolith — that's a known wart, M1, not something to restructure mid-feature). Regardless of the file's organization, every new route must include an auth check (reuse the `requireAdmin` middleware pattern at `server/index.js:69-92`, or a lighter per-resource ownership check) before it touches any client-specific data. Don't ship a route without one "to test it first" — that's how 8 of the current 19 ended up open.

---

## 3. Credential/secret handling rule of thumb

If a new feature needs a new third-party API key or per-client secret:

- **Per-client secrets** (like Convert, ClickUp) → envelope encryption: ciphertext in Firestore, key in Secret Manager. Copy the pattern in `functions/src/clickup.ts` + `functions/src/lib/encryption.ts`. Do **not** copy `frontend/src/lib/adminUsers.ts`'s pattern — it's the one place this is done wrong, not a template.
- **App-wide secrets** (a new shared API key, a service account, anything not per-client) → Secret Manager directly on the Functions side (see `createClientUser.ts`'s `secrets: [...]` usage), or Render's encrypted env vars on the server side. Never a plain `.env` value that gets committed.
- **Frontend `VITE_*` env vars** → only ever put a value here if it's meant to be public. The Firebase web API key is the one legitimate example (Firestore/Storage rules and Auth are the actual gate, not secrecy of that key) — that's the exception, not the pattern to follow. A real secret (an API key with its own quota/billing, an OAuth client secret, anything from a third-party vendor) must never be `VITE_`-prefixed, because that ships it straight into the browser bundle. `C5` is exactly this mistake with the exchange-rate API key.

---

## 4. Types will drift silently — plan for it

`frontend/src/types/index.ts`, `functions/src/types.ts`, and the untyped shapes assumed in `server/index.js` each model the same domain independently (H4). If you add or change a field on something like `ClientDoc` or an experiment/ROI shape, you need to update it by hand in up to three places — nothing will fail to compile if you miss one, it'll just silently read `undefined` somewhere at runtime. When touching a shared shape, grep for its name across all three workspaces before assuming your one edit is complete.

---

## 5. Shipping your change (per workspace, no CI gate exists)

| Workspace | How it ships | Watch out for |
|---|---|---|
| `frontend/` | `firebase deploy` (Hosting), serves `frontend/dist` | Nothing catches a broken build before it's live — no CI runs the build for you first. |
| `functions/` | `firebase deploy --only functions` | Your new function must be exported from `functions/src/index.ts` (§2) or this deploy silently does nothing for it. |
| `server/` | Render's git-push auto-deploy | Pushing to the deployed branch ships immediately — there's no staging gate or test run in between. |
| `firestore.rules` | `firebase deploy --only firestore:rules` — **a separate command**, not bundled into the frontend/functions deploys above | Editing the file locally does **nothing** to the live database until this runs — confirmed the hard way while building the audit-findings feature: a fully correct new rule sat in git, unenforced, for the whole build-and-test cycle, until this was run explicitly. Also: per C6, the live rules already have content this repo's file doesn't (`pendingAdmin`, `pagespeed`) — pull the current live rules from the Firebase console and merge by hand before publishing, don't just push this file over what's there. |

There is no automated test suite and no CI anywhere in this repo (H3) — a broken change reaches production the moment you deploy/push it. That's not something this doc is asking you to fix; just don't assume a red flag would stop you before it ships, because nothing currently will.

---

## 6. Local dev gotchas worth knowing before you assume something's broken

- **Testing anything that hits `server/` (GA4 views, PageSpeed) via local dev will fail with CORS/503-looking errors even though the server is healthy.** `server/index.js`'s CORS config only allowlists the production Firebase Hosting origins when `NODE_ENV === "production"` — which the deployed Render instance is — so a browser request from `http://localhost:5173` gets silently blocked client-side (the server actually returns 200 with real data; confirmed via `curl` with a `localhost` Origin header bypassing the browser's CORS enforcement entirely). This isn't a bug to fix, it's a real constraint of the setup: **local frontend dev always talks to the real production Render server** (no local/emulator backend exists), so anything routed through `server/`'s REST API needs to be verified against the deployed prod URL, not local dev, if you need to confirm it actually works end to end.
- **No Firebase emulator or local backend exists in practice** — `functions/serviceAccountKey.json`, `server/ga4ServiceAccount.json`, and every `server/.env*` are all absent from a fresh checkout. Local frontend dev is real, but it's real *against production Firestore/Auth/Render*, not a sandbox. Treat any write you make while developing locally as a real write to production data.

---

## 7. Quick-scan don't list

- Don't add a new direct-client Firestore write for anything privileged — roles, credentials, account creation. Cloud Function only.
- Don't ship a new Express route without an auth/ownership check, even "temporarily."
- Don't copy uplift/ROI math inline into a new page component — extend `dashboardData.ts`'s shared functions instead.
- Don't write a fifth Convert-sync implementation — call one of the four that already exist.
- Don't introduce a new plaintext secret field, frontend or backend.
- Don't assume a file under `functions/src/` is live in production — check `index.ts`'s export list first.
- Don't assume editing `firestore.rules` locally has any live effect — it needs its own explicit `firebase deploy --only firestore:rules`, and per C6 you should diff against what's actually live first.

---

## 8. Closing note

This doc tells you how to avoid making the existing mess worse while you keep shipping. It doesn't replace the fix list — when there's room to actually close out C1-C5 and H1-H2, `05-RECOMMENDATIONS.md` has the prioritized order to do it in. And per C6: check what's actually deployed before you assume this checkout is the full picture.
