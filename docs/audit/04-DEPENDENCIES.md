# Dependency Audit

Ran `npm audit --json` in all four workspaces (`.`, `frontend/`, `functions/`, `server/`) against the committed lockfiles. Results below are the real output, interpreted — not just pasted.

## Important distinction up front

`npm audit` reports **known CVEs** in the npm advisory database (denial-of-service, ReDoS, crash-on-malformed-input, etc.) — it is not a supply-chain-compromise scanner. I checked the actual advisory titles for every High/Critical hit below and **none of them are "this package was hijacked and now contains malware"** style advisories (the kind behind incidents like the 2025 npm worm campaigns) — they're all legitimate CVEs in otherwise-legitimate packages, all with known fixes. If you saw "compromised" language somewhere else (a different scanner, a specific advisory, a security team note), tell me the package name and I'll check that specific claim — I can't verify a supply-chain compromise claim I haven't seen.

## Summary by workspace

| Workspace | Critical | High | Moderate | Low | Total | Prod deps |
|---|---|---|---|---|---|---|
| `.` (root) | **2** | 0 | 0 | 0 | 2 | 1 |
| `frontend/` | 0 | 4 | 12 | 1 | 17 | 145 |
| `server/` | 0 | 5 | 11 | 1 | 17 | 152 |
| `functions/` | 0 | 6 | 11 | 1 | 18 | 185 |

## Root — 2 Critical

```
concurrently@9.2.1 (direct devDependency)
  └── shell-quote (transitive)
      CRITICAL: shell-quote quote() does not escape newlines in object .op values
      https://github.com/advisories/GHSA-w7jw-789q-3m8p
      fix available: yes (npm audit fix)
```

**Real-world exploitability here: low.** `concurrently` is a devDependency used exclusively by the root `npm run dev` script (`package.json:5-7`) to run the Vite dev server and the Express dev server side-by-side on a developer's own machine. It is never installed or invoked in any deployed environment — Vite's production build doesn't touch it, Render runs `node index.js` directly (not through `concurrently`), and Cloud Functions deploy only `functions/`. This is worth fixing (it's one command) but it is not an exposed attack surface in production. Don't let the word "critical" here imply the live app is at risk from this specific one — it isn't.

**Fix:** `npm audit fix` in the repo root, or bump `concurrently` to latest.

## Frontend — 4 High

| Package | Severity | Issue | Fix |
|---|---|---|---|
| `@grpc/grpc-js` (transitive, ≤1.9.15) | High | malformed request can crash server/client | `npm audit fix` |
| `protobufjs` (transitive, ≤7.6.2) | High | DoS via recursive JSON descriptor expansion; schema-derived name shadowing | `npm audit fix` |
| `undici` (transitive, ≤6.26.0, via `firebase`) | High | insufficiently random values; unbounded decompression → resource exhaustion | requires `firebase@12.16.0` (semver-major bump) |
| `vite` (direct, 8.0.0–8.0.15) | High | `launch-editor` NTLMv2 hash disclosure on Windows via UNC paths; `server.fs.deny` bypass on Windows | `npm audit fix` |

Note the `vite` and `launch-editor` issues are dev-server-only (Windows-specific local dev exposure), not shipped-bundle risk.

## Server — 5 High

| Package | Severity | Issue | Fix |
|---|---|---|---|
| `@grpc/grpc-js` (transitive, 1.14.0–1.14.3) | High | same crash CVEs as above | `npm audit fix` |
| `fast-xml-builder` (transitive, ≤1.1.6) | High | attribute-value quote bypass; comment-regex bypass | `npm audit fix` |
| `form-data` (transitive, <2.5.6) | High | CRLF injection via unescaped multipart field names/filenames | `npm audit fix` |
| `nodemailer` (direct, ≤9.0.0) | High | email-to-unintended-domain via interpretation conflict; ReDoS in address parser | bump to `nodemailer@9.0.3` |
| `protobufjs` (transitive, ≤7.6.2) | High | same as above | `npm audit fix` |

`nodemailer` is worth prioritizing over the rest here — it's a **direct** dependency actively used to send real emails (support tickets, password resets, admin approvals per `server/index.js`), and the "email sent to unintended domain" CVE is the kind of thing that could actually misdeliver a password-reset link. The others are transitive and mostly DoS-class.

## Functions — 6 High

| Package | Severity | Issue | Fix |
|---|---|---|---|
| `@grpc/grpc-js` (transitive, 1.14.0–1.14.3) | High | same as above | `npm audit fix` |
| `axios` (direct, 1.0.0–1.15.2) | High | ReDoS via cookie-name injection; unbounded resource allocation | `npm audit fix` |
| `fast-xml-builder` (transitive, ≤1.1.6) | High | same as above | `npm audit fix` |
| `form-data` (transitive) | High | same CRLF injection | `npm audit fix` |
| `nodemailer` (direct, ≤9.0.0) | High | same as server | bump to `9.0.3` |
| `protobufjs` (transitive, ≤7.6.2) | High | same as above | `npm audit fix` |

`axios` here is worth noting specifically: it's used directly to call the Convert.com API and ClickUp API from Cloud Functions — a ReDoS in cookie handling is low-severity for an outbound-only API client (you control what you send it), but still cheap to fix.

## Recommended action

1. Run `npm audit fix` in all four workspaces first — the table above shows most items resolve automatically without a major-version bump.
2. Manually bump `nodemailer` to `9.0.3`+ in both `functions/` and `server/` (direct dependency, semver-minor-ish, low risk).
3. Re-run `npm audit` after, and only then evaluate whether the remaining `firebase`/`undici` major-version bump is worth doing (it's a bigger change — test the auth/Firestore/Storage paths after).
4. None of this blocks a go/no-go decision on its own — it's routine maintenance, not a fire. The findings in `03-FINDINGS.md` (credential handling, unauthenticated endpoints, committed API key) are the ones that actually matter for "should we use this."
