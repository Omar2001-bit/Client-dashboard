# Product Requirements Document
## CRO ROI Dashboard — Powered by Convert.com + GA4 + Firebase
**Version:** 1.0  
**Date:** April 28, 2026  
**Owner:** CRO Agency (Admin)  
**Status:** Draft — Ready for Development

---

## 1. Executive Summary

The **CRO ROI Dashboard** is a multi-tenant, role-based web application that gives CRO agency teams and their clients a single source of truth for experiment performance and business impact. It pulls live experiment data from Convert.com via its REST API, enriches it with revenue and transaction data from Google Analytics 4, and presents the combined results as a clean, branded dashboard.

The agency operates as **Admin**, managing client workspaces, credentials, and user access. Each client logs in to a read-only, curated view of their own experiments and ROI metrics. All identity, authentication, and credential storage is handled by **Firebase** (Firestore + Firebase Auth + Firebase Cloud Functions for email triggers).

---

## 2. Problem Statement

CRO agencies run A/B tests for multiple clients simultaneously. Today, proving ROI means manually exporting data from Convert.com and GA4, calculating revenue deltas in spreadsheets, and formatting reports per client — a slow, error-prone, and non-scalable process. Clients also lack transparent, real-time visibility into the value being generated.

This tool eliminates that friction by automating the data pipeline and delivering a live, always-accurate ROI view to both agency and client.

---

## 3. Goals & Success Criteria

| Goal | Success Metric |
|---|---|
| Automate experiment data retrieval | Zero manual exports; data refreshes every 30 min |
| Show clear ROI per engagement | Client can see revenue uplift with one login |
| Multi-client management | Admin can onboard a new client in < 5 minutes |
| Secure credential handling | Convert API keys never exposed to client role |
| Self-serve auth flows | Users reset passwords without admin involvement |

---

## 4. User Roles

### 4.1 Admin (Agency)
- Full access to all client workspaces
- Creates and manages client user accounts
- Adds and rotates Convert.com API keys per client
- Connects GA4 property IDs per client
- Views all experiments across all clients
- Configures the engagement date range (contract start → present)
- Can impersonate/preview a client's dashboard view

### 4.2 Client
- Single-workspace view (their data only)
- Read-only access to their ROI summary, experiment list, and charts
- Cannot see other clients or API credentials
- Can update their own password via authenticated profile page
- Receives onboarding email with magic-link first login

---

## 5. Core Features

### 5.1 Authentication & Authorization

#### 5.1.1 Firebase Auth Flows

| Flow | Trigger | Method |
|---|---|---|
| Admin initial setup | Manual Firebase console seed or CLI script | Email/password |
| Client first login | Admin creates client → system sends email | Magic link (email link sign-in) |
| Client password set | Client clicks magic link → sets own password | Firebase `signInWithEmailLink` |
| Forgot password | User clicks "Forgot password" on login screen | Firebase `sendPasswordResetEmail` |
| Session management | All roles | Firebase ID tokens (JWT), refresh every 1 hour |
| Logout | User-initiated | `auth.signOut()`, clear local state |

#### 5.1.2 Role Storage
- Roles (`admin` / `client`) stored in Firestore under `/users/{uid}/role`
- Firebase Security Rules enforce role-based read/write access at the database level
- Cloud Functions validate role on any sensitive write operation (e.g., creating a user, storing an API key)

#### 5.1.3 Email Templates (Firebase + SendGrid or Firebase Extensions)
- **Onboarding (Client):** Subject: "Welcome to your CRO Dashboard — Set Up Your Account" — includes magic link, expires 24 hours
- **Password Reset:** Subject: "Reset your CRO Dashboard password" — standard reset link, expires 1 hour
- **API Key Rotation Alert (Admin):** Internal notification when a Convert key is updated

---

### 5.2 Admin Panel

#### 5.2.1 Client Management
- **Client List View:** Table of all clients with name, status (active/inactive), contract start date, last data sync timestamp
- **Create Client Form:**
  - Client company name
  - Primary contact name + email
  - Contract start date (defines the ROI calculation period)
  - Convert.com API Key (Project-level or Account-level)
  - Convert.com Account ID + Project ID
  - GA4 Property ID
  - GA4 Service Account JSON (uploaded, stored encrypted in Firestore)
  - Branding: optional client logo upload (Firebase Storage)
- **Edit/Deactivate Client:** Modify any field; deactivating suspends the client login but preserves data
- **Impersonate View:** "Preview as Client" toggle shows exactly what the client sees

#### 5.2.2 Credential Vault
- Convert API keys stored in Firestore under `/clients/{clientId}/credentials/convert` with Firestore Security Rules denying client-role reads
- GA4 service account JSON stored encrypted (AES-256) in Firestore or Firebase Storage with a server-side decryption step via Cloud Function — never sent to the browser
- Admin-only Firestore rules on `/clients/{clientId}/credentials/**`

#### 5.2.3 Global Overview (Admin Home)
- Summary cards across all clients:
  - Total revenue uplift (aggregate)
  - Total active experiments
  - Total completed experiments
  - Clients with experiments running today
- Filterable client roster table with quick links

---

### 5.3 Client Dashboard

#### 5.3.1 ROI Summary Bar (Hero Section)
Four primary KPI cards showing performance **since contract start date**:

| Card | Metric | Calculation Source |
|---|---|---|
| **Total Revenue Gained** | Sum of incremental revenue from winning experiments | GA4 `purchase` event, weighted by experiment uplift % |
| **Total Purchases Gained** | Incremental transactions from winning experiments | GA4 `purchase` count delta × traffic split |
| **Products Gained / Lost** | Net units sold delta attributable to experiments | GA4 `items` array aggregation |
| **Blended ROI** | (Revenue Gained − Agency Fee) / Agency Fee × 100 | Configurable agency fee field in Admin |

Each card shows: current value, trend arrow vs. previous period, and a sparkline.

#### 5.3.2 Experiment List
- Pulled live from Convert.com API (`GET /v2/projects/{projectId}/experiments`)
- Displayed as a sortable table/card list with:
  - Experiment name (from Convert)
  - Status: `Running` / `Completed` / `Paused` / `Draft`
  - Start date → End date
  - Winning variant (if decided)
  - Primary metric (e.g., Revenue per Visitor, Conversion Rate)
  - Confidence level (%)
  - Estimated revenue impact

- Clicking an experiment opens the **Experiment Detail Panel** (see 5.3.4)

#### 5.3.3 Charts & Visualizations

| Chart | Type | Data Source | Description |
|---|---|---|---|
| Revenue Uplift Over Time | Area chart | GA4 + Convert | Cumulative revenue gained since contract start, broken by experiment |
| Experiment Win Rate | Donut chart | Convert API | % of experiments: Won / Lost / Inconclusive / Running |
| Purchases Per Month | Bar chart | GA4 | Monthly purchase count delta attributed to CRO work |
| Top Performing Experiments | Horizontal bar | GA4 + Convert | Top 5 experiments ranked by revenue uplift |
| Conversion Rate Trend | Line chart | GA4 | Overall site CVR over the engagement period |
| Products Gained/Lost | Grouped bar | GA4 items | Monthly units gained vs. lost per experiment period |

All charts use a consistent color system. Charts are interactive (hover tooltips, zoom, export as PNG).

#### 5.3.4 Experiment Detail Panel (Drawer/Modal)
When a client clicks an experiment:
- Full experiment name + ID
- Hypothesis (if stored in Convert custom fields / notes)
- Variants list with traffic split %
- Per-variant metrics: Sessions, Transactions, Revenue, CVR, RPV
- Statistical significance chart (confidence over time)
- GA4 segment link (deep link to GA4 for the experiment segment)
- Status badge + winner declaration

---

### 5.4 Data Pipeline

#### 5.4.1 Convert.com API Integration
- **Auth:** Bearer token (Project API Key stored in Firestore credential vault)
- **Endpoints used:**
  - `GET /v2/accounts/{accountId}/projects` — list projects
  - `GET /v2/projects/{projectId}/experiments` — fetch all experiments with names, status, dates
  - `GET /v2/projects/{projectId}/experiments/{experimentId}/reports` — per-experiment variant metrics
- **Refresh cadence:** Every 30 minutes via Firebase Cloud Function (scheduled via Cloud Scheduler)
- **Cached results** stored in Firestore under `/clients/{clientId}/data/convert/` to avoid rate limits and support offline dashboard loads

#### 5.4.2 GA4 Integration
- **Auth:** Service Account JSON (uploaded by admin, stored encrypted)
- **API:** Google Analytics Data API v1 (`runReport`, `runRealtimeReport`)
- **Key reports pulled:**
  - Revenue and transaction counts filtered by experiment audience (using GA4 custom dimensions mapped to Convert experiment IDs)
  - Product-level item data from `items` array
  - Date-ranged from contract start → today
- **Data join logic:** Match Convert experiment IDs → GA4 custom dimension `convert_experiment_id` (requires client GA4 → Convert integration to be set up — documented in onboarding guide)
- **Refresh cadence:** Every 30 minutes, same Cloud Function as Convert sync
- **Cached results** stored under `/clients/{clientId}/data/ga4/`

#### 5.4.3 ROI Calculation Engine (Cloud Function)
A dedicated `calculateROI` Cloud Function runs after each sync:
1. For each completed/running experiment with a declared winner:
   - Pull variant conversion rate and baseline conversion rate from Convert report
   - Calculate uplift % = `(variant CVR − control CVR) / control CVR`
   - Apply uplift to GA4 total revenue for the experiment period × traffic split %
   - Sum across all winning experiments → **Total Revenue Gained**
2. Store results in `/clients/{clientId}/roi/{date}` for historical trending
3. Expose results via a Firestore real-time listener on the dashboard frontend

---

### 5.5 Firestore Data Model

```
/users/{uid}
  role: "admin" | "client"
  email: string
  name: string
  clientId: string | null   // null for admin
  createdAt: timestamp
  lastLogin: timestamp

/clients/{clientId}
  name: string
  contactName: string
  contactEmail: string
  contractStartDate: timestamp
  agencyFee: number          // monthly fee in local currency
  logoUrl: string            // Firebase Storage URL
  status: "active" | "inactive"
  createdAt: timestamp
  updatedAt: timestamp

/clients/{clientId}/credentials/convert
  accountId: string
  projectId: string
  apiKey: string             // encrypted at rest, server-side decryption only

/clients/{clientId}/credentials/ga4
  propertyId: string
  serviceAccountJson: string // AES-256 encrypted blob

/clients/{clientId}/data/convert/{syncTimestamp}
  experiments: array         // raw Convert API response, cached

/clients/{clientId}/data/ga4/{syncTimestamp}
  reports: object            // raw GA4 report responses, cached

/clients/{clientId}/roi/{dateKey}
  totalRevenueGained: number
  totalPurchasesGained: number
  productsGained: number
  productsLost: number
  blendedROI: number
  calculatedAt: timestamp
  breakdown: array           // per-experiment contribution
```

---

## 6. Technical Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Admin Panel │  │Client Dashboard│ │ Auth Pages │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│         └────────────────┼────────────────┘          │
│                  Firebase SDK (Auth + Firestore)      │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│              Firebase Backend                        │
│  ┌────────────────┐   ┌──────────────────────────┐  │
│  │ Firebase Auth  │   │   Firestore Database     │  │
│  │ (JWT, email    │   │   (users, clients,       │  │
│  │  magic links,  │   │    credentials, ROI,     │  │
│  │  password reset│   │    cached sync data)     │  │
│  └────────────────┘   └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │          Cloud Functions                     │   │
│  │  - syncConvertData (scheduled, 30min)        │   │
│  │  - syncGA4Data (scheduled, 30min)            │   │
│  │  - calculateROI (triggered after sync)       │   │
│  │  - createClientUser (HTTPS callable)         │   │
│  │  - sendOnboardingEmail (Firestore trigger)   │   │
│  │  - decryptCredentials (internal, no HTTP)    │   │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────┐                               │
│  │ Firebase Storage │  (client logos, exports)      │
│  └──────────────────┘                               │
└──────────────────────────┬──────────────────────────┘
                           │
          ┌────────────────┴──────────────────┐
          │                                   │
┌─────────▼──────────┐            ┌───────────▼──────────┐
│  Convert.com API   │            │   Google Analytics   │
│  /v2/experiments   │            │   Data API v1        │
│  /v2/reports       │            │   GA4 Properties     │
└────────────────────┘            └──────────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React + TypeScript | Type safety, component reuse |
| Routing | React Router v6 | SPA with role-based route guards |
| State | Zustand + React Query | Lightweight global state + cache |
| Charts | Recharts | React-native, customizable |
| Styling | Tailwind CSS | Rapid, consistent design tokens |
| Auth | Firebase Authentication | Email link, password reset, JWT |
| Database | Firestore (Firebase) | Real-time listeners, offline support |
| File Storage | Firebase Storage | Logo uploads, exports |
| Backend Logic | Firebase Cloud Functions (Node.js) | Scheduled syncs, secure credential handling |
| Email | Firebase Auth Emails + SendGrid (via Extension) | Transactional email delivery |
| Hosting | Firebase Hosting | Co-located with backend, CDN |
| Encryption | Node.js `crypto` (AES-256-GCM) | API key encryption in Cloud Functions |

---

## 7. Security Requirements

1. **API keys never reach the browser.** Convert and GA4 credentials are decrypted only inside Cloud Functions. Firestore Security Rules deny client reads on `/credentials/**`.
2. **Firebase Security Rules** enforce that:
   - `client` role can only read documents where `clientId === auth.uid`'s linked client
   - Only `admin` role can write to `/clients/**`
   - No role can read another user's document
3. **Encryption at rest:** All API keys and service account JSONs stored with AES-256-GCM encryption. Encryption key stored in Firebase Environment Config / Secret Manager.
4. **Email link expiry:** Onboarding magic links expire in 24 hours. Password reset links expire in 1 hour.
5. **Rate limiting:** Cloud Functions enforce per-client sync rate limits to avoid Convert API abuse.
6. **Input sanitization:** All admin form inputs sanitized before Firestore writes.
7. **HTTPS only:** Firebase Hosting enforces HTTPS. All API calls use TLS 1.2+.

---

## 8. Email Flow Specifications

### 8.1 Client Onboarding Email
**Trigger:** Admin creates a new client user via Admin Panel  
**Cloud Function:** `createClientUser` → creates Firebase Auth user → writes to Firestore → triggers `sendOnboardingEmail`

```
Subject: You're invited to your CRO Results Dashboard

Hi [Client Name],

[Agency Name] has set up your personal CRO Results Dashboard — 
your live view of every experiment we're running and the revenue impact 
we're generating for [Company Name].

Click below to set your password and access your dashboard:

[ Set Up My Account → ]   ← magic link, expires 24 hours

If you have any questions, reply to this email or contact your 
account manager directly.

— The [Agency Name] Team
```

### 8.2 Password Reset Email
**Trigger:** User clicks "Forgot password" on login screen  
**Handled by:** Firebase Auth `sendPasswordResetEmail` with custom action URL

```
Subject: Reset your CRO Dashboard password

Hi [Name],

We received a request to reset your password for the CRO Dashboard.

[ Reset My Password → ]   ← expires 1 hour

If you didn't request this, you can safely ignore this email.

— The [Agency Name] Team
```

### 8.3 API Key Rotation Notification (Admin)
**Trigger:** Admin updates a Convert API key  
**Sent to:** All admin users

```
Subject: [Action] Convert API key updated for [Client Name]

The Convert.com API key for [Client Name] was updated on [Date] at [Time].

If this wasn't you, review access to the Admin Panel immediately.
```

---

## 9. Page & Route Map

```
/ ──────────────────────────────── Login Page (both roles)
/forgot-password ────────────────── Forgot Password
/set-password ───────────────────── First-time password set (magic link landing)

/admin ──────────────────────────── Admin Home (aggregate overview)
/admin/clients ──────────────────── Client List
/admin/clients/new ──────────────── Create Client Form
/admin/clients/:clientId ────────── Client Detail + Edit
/admin/clients/:clientId/preview ── Preview as Client
/admin/settings ─────────────────── Agency settings (fee, branding, email config)

/dashboard ──────────────────────── Client Home (ROI Summary + Charts)
/dashboard/experiments ──────────── Experiment List
/dashboard/experiments/:id ──────── Experiment Detail
/dashboard/profile ──────────────── Client Profile (change password)
```

---

## 10. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Dashboard load time | < 2 seconds (cached Firestore data) |
| Data freshness | ≤ 30 minutes behind real-time |
| Uptime | 99.9% (Firebase SLA) |
| Mobile responsiveness | Fully responsive down to 375px |
| Accessibility | WCAG 2.1 AA minimum |
| Concurrent clients | 50+ client workspaces without performance degradation |
| Audit log | All admin credential changes logged to Firestore `/auditLog/` |

---

## 11. GA4 ↔ Convert Integration Setup (Client Prerequisite)

For revenue attribution to work, clients must have the following configured before onboarding:

1. **Convert.com GA4 integration enabled** in their Convert project settings (sends experiment ID + variant ID as GA4 custom dimensions)
2. **Custom dimensions in GA4:**
   - `convert_experiment_id` (experiment-scoped)
   - `convert_variant_id` (experiment-scoped)
3. **`purchase` event** firing correctly with `value`, `transaction_id`, and `items` array
4. Agency provides an **onboarding checklist PDF** (generated from the dashboard) with these prerequisites

The Admin Panel should flag clients whose GA4 data shows no `convert_experiment_id` dimension — surfaced as a "⚠ Integration health" warning on the client card.

---

## 12. Out of Scope (v1)

- Multi-language / i18n support
- Native mobile apps (iOS/Android)
- Direct Shopify/WooCommerce integrations (use GA4 ecommerce as the data layer)
- White-labeling per client (single agency brand only in v1)
- Self-serve client signup (admin-only client creation)
- Billing / invoice generation
- Custom metric builder (use Convert's built-in metrics in v1)

---

## 13. Future Roadmap (v2+)

- **White-label mode:** Custom domain + logo per client workspace
- **PDF/Slide report export:** One-click "Export ROI Report" → branded PDF
- **Slack/Email digests:** Weekly automated experiment summary to clients
- **Multi-project support:** Clients with multiple Convert projects
- **Custom goal mapping:** Map Convert goals to specific GA4 events beyond `purchase`
- **Benchmarking:** Anonymous peer benchmarks across agency client portfolio
- **A/B test idea backlog:** Kanban board for experiment pipeline management

---

## 14. Development Phases

### Phase 1 — Foundation (Weeks 1–2)
- Firebase project setup (Auth, Firestore, Storage, Functions, Hosting)
- Security Rules skeleton
- Login / magic-link / password reset auth flows
- Role-based routing (React Router + auth guards)
- Admin: create client form + Firestore write

### Phase 2 — Data Pipeline (Weeks 3–4)
- Cloud Function: Convert.com API sync (scheduled)
- Cloud Function: GA4 Data API sync (scheduled)
- Cloud Function: ROI calculation engine
- Credential encryption/decryption layer
- Firestore data model fully implemented

### Phase 3 — Dashboard UI (Weeks 5–6)
- Client dashboard: KPI cards, ROI summary
- Experiment list (live from Firestore cache)
- Experiment detail drawer
- All 6 chart components (Recharts)
- Admin overview page

### Phase 4 — Polish & Security Audit (Week 7)
- Firestore Security Rules hardening + audit
- Email template finalization
- Mobile responsiveness pass
- Integration health warnings
- Admin impersonation / preview mode
- QA across all auth flows

### Phase 5 — Launch (Week 8)
- Firebase Hosting deploy
- First client onboarding
- Monitoring setup (Firebase Crashlytics + Performance)

---

## 15. Open Questions for Stakeholder Review

1. **Agency fee structure:** Is the fee a fixed monthly retainer, % of revenue, or both? This affects the ROI card formula.
2. **Convert plan tier:** Does the Convert account have API access at the project level or account level? (Determines which endpoint and key scope to use.)
3. **GA4 ecommerce:** Are all client GA4 properties using GA4 Enhanced Ecommerce with a `purchase` event and `items` array? Or do some use custom events?
4. **Currency:** Single currency per client (stored in Admin), or mixed?
5. **Onboarding email sender domain:** Will you use a custom domain (e.g., `noreply@youragency.com`) via SendGrid, or Firebase's default sender?
6. **Client branding:** Should the dashboard show your agency logo, the client's logo, or both?
7. **Data retention:** How long should cached Convert + GA4 sync snapshots be kept in Firestore before deletion?

---

---

## 16. Firebase Admin SDK Integration

### 16.1 Project Identity

| Field | Value |
|---|---|
| **Firebase Project ID** | `client-dash-9b027` |
| **Service Account Email** | `firebase-adminsdk-fbsvc@client-dash-9b027.iam.gserviceaccount.com` |
| **Auth Domain** | `client-dash-9b027.firebaseapp.com` |
| **Storage Bucket** | `client-dash-9b027.appspot.com` |
| **Firestore Database** | `(default)` in the project |

> **Security note:** The service account private key must be rotated before development begins (see key management below). The values above are non-sensitive identifiers safe to reference in code and config.

---

### 16.2 Secret Management — Private Key

The service account private key (`private_key` field from the JSON) is **never hardcoded, never committed to git, and never sent to the browser.** It is injected exclusively as a runtime secret into Cloud Functions using one of these two methods:

#### Option A — Firebase Secret Manager (recommended for production)
```bash
# Run once from your local machine after rotating the key
firebase functions:secrets:set FIREBASE_SA_PRIVATE_KEY
# Paste the private key value when prompted (the -----BEGIN PRIVATE KEY----- block)

firebase functions:secrets:set FIREBASE_SA_CLIENT_EMAIL
# Value: firebase-adminsdk-fbsvc@client-dash-9b027.iam.gserviceaccount.com
```

Reference in `functions/index.ts`:
```typescript
import { defineSecret } from "firebase-functions/params";

const SA_PRIVATE_KEY = defineSecret("FIREBASE_SA_PRIVATE_KEY");
const SA_CLIENT_EMAIL = defineSecret("FIREBASE_SA_CLIENT_EMAIL");

export const myFunction = onCall(
  { secrets: [SA_PRIVATE_KEY, SA_CLIENT_EMAIL] },
  async (request) => {
    const app = initializeApp({
      credential: cert({
        projectId: "client-dash-9b027",
        privateKey: SA_PRIVATE_KEY.value().replace(/\\n/g, "\n"),
        clientEmail: SA_CLIENT_EMAIL.value(),
      }),
    });
    // ...
  }
);
```

#### Option B — `.env` file for local emulator development only
Create `functions/.env.local` (add to `.gitignore` immediately):
```
FIREBASE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_SA_CLIENT_EMAIL="firebase-adminsdk-fbsvc@client-dash-9b027.iam.gserviceaccount.com"
FIREBASE_PROJECT_ID="client-dash-9b027"
```

**`.gitignore` must include:**
```
functions/.env.local
functions/serviceAccountKey.json
*.json.key
```

---

### 16.3 Admin SDK Initialization Pattern

All Cloud Functions that need elevated access (bypassing Security Rules, creating Auth users, writing to any Firestore path) use a shared Admin SDK initializer:

```typescript
// functions/src/lib/firebaseAdmin.ts
import * as admin from "firebase-admin";

let adminApp: admin.app.App | null = null;

export function getAdminApp(privateKey: string, clientEmail: string): admin.app.App {
  if (adminApp) return adminApp;

  adminApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: "client-dash-9b027",
      privateKey: privateKey.replace(/\\n/g, "\n"),
      clientEmail: clientEmail,
    }),
    storageBucket: "client-dash-9b027.appspot.com",
  });

  return adminApp;
}

export const getAdminAuth = (app: admin.app.App) => admin.auth(app);
export const getAdminFirestore = (app: admin.app.App) => admin.firestore(app);
export const getAdminStorage = (app: admin.app.App) => admin.storage(app);
```

---

### 16.4 Frontend SDK Configuration

The frontend React app uses the **public** Firebase web config (safe to commit):

```typescript
// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,      // from .env (public, not secret)
  authDomain: "client-dash-9b027.firebaseapp.com",
  projectId: "client-dash-9b027",
  storageBucket: "client-dash-9b027.appspot.com",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
```

> The `apiKey`, `messagingSenderId`, and `appId` values come from Firebase Console → Project Settings → Your Apps → Web app → SDK Config. Store them in `frontend/.env` (committed) or `frontend/.env.local` (local override). These are **not** secrets — they are public identifiers.

---

### 16.5 Cloud Functions That Use Admin SDK

| Function | Admin SDK Usage | Trigger |
|---|---|---|
| `createClientUser` | `admin.auth().createUser()` → creates Firebase Auth user for new client | HTTPS Callable (admin role only) |
| `sendOnboardingEmail` | `admin.auth().generateSignInWithEmailLink()` → generates magic link | Firestore onCreate trigger on `/clients/{id}` |
| `syncConvertData` | `admin.firestore().collection(...).set()` → writes cached API data | Cloud Scheduler (every 30 min) |
| `syncGA4Data` | `admin.firestore().collection(...).set()` → writes cached report data | Cloud Scheduler (every 30 min) |
| `calculateROI` | `admin.firestore()` read + write across `/clients/{id}/roi/` | Firestore onWrite trigger after sync |
| `rotateClientCredentials` | `admin.firestore().collection(...).update()` → updates encrypted key | HTTPS Callable (admin role only) |
| `deleteClientUser` | `admin.auth().deleteUser()` + Firestore cleanup | HTTPS Callable (admin role only) |
| `setUserRole` | `admin.auth().setCustomUserClaims(uid, { role })` → stamps JWT claim | Called inside `createClientUser` |

---

### 16.6 Role Enforcement via Custom Claims

Roles are stamped directly onto Firebase Auth JWTs as custom claims, so the frontend and Security Rules can both read them without a Firestore lookup:

```typescript
// Inside createClientUser Cloud Function
await admin.auth(adminApp).setCustomUserClaims(newUser.uid, {
  role: "client",
  clientId: clientDocId,
});
```

Frontend reads the claim after token refresh:
```typescript
const idTokenResult = await auth.currentUser?.getIdTokenResult(true);
const role = idTokenResult?.claims?.role; // "admin" | "client"
const clientId = idTokenResult?.claims?.clientId;
```

Firestore Security Rules use the claim directly:
```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth.token.role == "admin";
    }

    function isClientOf(clientId) {
      return request.auth.token.role == "client"
          && request.auth.token.clientId == clientId;
    }

    // Admin reads/writes everything
    match /clients/{clientId} {
      allow read, write: if isAdmin();
    }

    // Clients read only their own workspace data
    match /clients/{clientId}/data/{document=**} {
      allow read: if isAdmin() || isClientOf(clientId);
      allow write: if isAdmin();
    }

    // Credentials: admin only, never client
    match /clients/{clientId}/credentials/{document=**} {
      allow read, write: if isAdmin();
    }

    // ROI data: client can read their own
    match /clients/{clientId}/roi/{document=**} {
      allow read: if isAdmin() || isClientOf(clientId);
      allow write: if isAdmin();
    }

    // Users can read their own profile
    match /users/{uid} {
      allow read: if request.auth.uid == uid || isAdmin();
      allow write: if isAdmin();
    }
  }
}
```

---

### 16.7 Key Rotation Procedure

When a service account key needs to be rotated (e.g., after accidental exposure):

1. Go to [Google Cloud Console → IAM → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) for project `client-dash-9b027`
2. Find `firebase-adminsdk-fbsvc@client-dash-9b027.iam.gserviceaccount.com`
3. Click **Manage keys** → delete the compromised key ID
4. Click **Add key → Create new key → JSON** → download new JSON
5. Extract `private_key` and `client_email` from the new JSON
6. Update the secret: `firebase functions:secrets:set FIREBASE_SA_PRIVATE_KEY`
7. Redeploy functions: `firebase deploy --only functions`
8. Delete the downloaded JSON file from your machine
9. Log the rotation in `/auditLog/keyRotations` in Firestore

---

### 16.8 Local Development Setup Checklist

```bash
# 1. Install Firebase CLI
npm install -g firebase-tools

# 2. Login and select project
firebase login
firebase use client-dash-9b027

# 3. Install function dependencies
cd functions && npm install

# 4. Create local secrets file (NEVER commit this)
echo "FIREBASE_SA_PRIVATE_KEY=..." > functions/.env.local
echo "FIREBASE_SA_CLIENT_EMAIL=firebase-adminsdk-fbsvc@client-dash-9b027.iam.gserviceaccount.com" >> functions/.env.local

# 5. Start emulators
firebase emulators:start --import=./emulator-data

# 6. Seed admin user (run once)
npx ts-node scripts/seedAdmin.ts
```

`scripts/seedAdmin.ts` creates the first admin user in Auth and writes their `/users/{uid}` document with `role: "admin"` — the only time an admin account is created outside the app.

---

*End of Document — CRO ROI Dashboard PRD v1.0*
