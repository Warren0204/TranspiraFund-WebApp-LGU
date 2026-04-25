# TranspiraFund LGU Web Application

## Project Overview
TranspiraFund is a role-based web application for a Local Government Unit (LGU) that manages public works projects and fund transparency. It enforces strict role separation across government departments.

## Architecture

### Monorepo Structure
```
/
├── client/          # React + Vite frontend
│   └── src/
│       ├── pages/   # Role-scoped page directories: admin/, hcsd/, mayor/, cpdo/, public/
│       ├── components/  # auth/, layout/, shared/
│       ├── context/     # AuthContext.jsx, ThemeContext.jsx
│       ├── config/      # firebase.js, roles.js, validationSchemas.js
│       ├── hooks/       # useDebounce.js
│       └── services/    # AuthService.js, AccountProvisioningService.js
├── functions/       # Firebase Cloud Functions (Node.js 22, v2 API)
│   └── src/index.js
├── scripts/         # One-time admin scripts
│   └── migrate-depw-to-hcsd.js
├── firebase.json    # Hosting, Firestore, Storage, Functions config
├── firestore.rules  # Security rules
└── storage.rules
```

### Roles
| Role | Constant | Department | Notes |
|------|----------|------------|-------|
| MIS | `ROLES.MIS` | Management Information Systems | Admin/IT |
| HCSD | `ROLES.HCSD` | Construction Services Division, DEPW | Sub-org of DEPW |
| MAYOR | `ROLES.MAYOR` | Office of the Mayor | |
| CPDO | `ROLES.CPDO` | City Planning and Development Office | |
| PROJECT_ENGINEER | `ROLES.PROJECT_ENGINEER` (`PROJ_ENG`) | Construction Services Division, DEPW | Mobile app user |

> **Note:** The HCSD role was formerly named `DEPW`. All files, directories, and routes now use `hcsd/`. The string "DEPW" still appears in display labels (e.g., "Construction Services Division, DEPW") because DEPW is the parent department — that usage is intentional.

### Authentication Flow
- Firebase Auth + Firestore user document for role/metadata
- **OTP verification** via custom claims (`otpVerified`, `otpVerifiedAtAuthTime`)
- `mustChangePassword` flag for provisioned accounts
- `RequireAuth` component checks both auth state and `allowedRoles`

## Tech Stack
- **Frontend**: React 18, Vite, React Router v6, Zod (client-side validation)
- **Backend**: Firebase Functions v2 (Node 22), Firebase Admin SDK, Zod (server-side validation), nodemailer (Gmail SMTP)
- **Database**: Cloud Firestore
- **Hosting**: Firebase Hosting (`client/dist`)
- **Region**: `asia-southeast1`

## Development Commands

### Frontend (from `client/`)
```bash
npm run dev       # Start Vite dev server
npm run build     # Production build → dist/
npm run preview   # Preview production build
```

### Functions (from `functions/`)
```bash
npm run serve     # Start functions emulator
npm run deploy    # Deploy functions only
npm run logs      # Stream function logs
```

### Firebase (from root)
```bash
firebase deploy                         # Deploy everything
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only functions
```

## Environment Variables
Frontend requires a `.env` file in `client/` with:
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID  # optional
```

Functions use Firebase Secrets (not env vars):
- `GMAIL_USER` — Gmail account for sending emails
- `GMAIL_APP_PASSWORD` — Gmail App Password

## Security Principles
- All Firestore writes go through **Cloud Functions (Admin SDK)** — client-side writes are blocked in rules
- Role-based access enforced in both Firestore rules and frontend `RequireAuth`
- Zod validation on both client and server (Cloud Functions)
- Security headers set in `firebase.json`: CSP, HSTS, X-Frame-Options, etc.
- Cryptographically secure password generation (`crypto.randomInt`)

## Firestore Collections
| Collection | Purpose | Notes |
|---|---|---|
| `users/{uid}` | User profile + role | Write-blocked to clients |
| `projects/{projectId}` | Public works projects | Write via Cloud Functions only |
| `projects/{projectId}/milestones/{milestoneId}` | Project milestones (subcollection) | PROJ_ENG can update (mobile proof) |
| `auditTrails/mis/entries/{logId}` | MIS-scope audit trail | MIS read-only; Cloud Functions write |
| `auditTrails/hcsd/entries/{logId}` | HCSD-scope audit trail | HCSD read-only; Cloud Functions write |
| `auditTrails/mobile/entries/{logId}` | Mobile PROJ_ENG self-audit log | PROJ_ENG-only read + create. Web side never reads this; mobile activity surfaces to HCSD exclusively via notifications (see `onMobileAuditCreated` trigger) |
| `notifications/{notifId}` | App notifications (two lanes via `category`: `"system"` for admin events, `"field"` for mobile PROJ_ENG activity) | Recipient-only read/update (isRead + dismissedAt). Writes via Cloud Functions |
| `stats/public` | Aggregated public counters (`totalProjects`, `totalBudget`, `totalEngineers`, `done`, `delayed`, `progress`) | Public read; trigger-maintained |
| `otpCodes/{uid}` | OTP storage | Cloud Functions only |
| `passwordResets/{emailHash}` | Password reset rate-limiting (legacy) | Cloud Functions only |
| `passwordResetOtps/{docId}` | Password reset OTP storage | Cloud Functions only; client-blocked in rules |
| `passwordResetCooldowns/{docId}` | Password reset rate-limiting | Cloud Functions only; client-blocked in rules |
| `ntpRateLimits/{uid}` | Per-user rolling-hour counter for `attachNtp` calls (max 20/hr) | Cloud Functions only; client-blocked in rules |

## Project Schema (Firestore `projects` document)
All fields stored on the project document:
- **Project Details**: `projectName`, `sitioStreet`, `barangay`
- **NTP Document**: `ntpFileUrl`, `ntpFileName`, `ntpUploadedAt`, `ntpUploadedBy` (populated by the `attachNtp` Cloud Function after the HCSD client uploads to Storage at `projects/{projectId}/ntp/{fileName}`)
- **Account/Funding**: `accountCode`, `fundingSource`
- **Contract**: `contractAmount`, `contractor`
- **Personnel**: `projectEngineer`, `projectInspector`, `materialInspector`, `electricalInspector`
- **Timeliness**: `ntpReceivedDate`, `officialDateStarted`, `originalDateCompletion`, `revisedDate1`, `revisedDate2`, `actualDateCompleted`
- **Accomplishment**: `actualPercent` (Time Elapsed %, Slippage %, Days Delay are computed at render)
- **Project Orders**: `resumeOrderNumber`, `resumeOrderDate`, `timeExtensionOnOrder`, `validationOrderNumber`, `validationOrderDate`, `suspensionOrderNumber`, `suspensionOrderDate`
- **Fund Utilization**: `incurredAmount`
- **Notes**: `remarks`, `actionTaken`
- **System**: `status` ("Delayed" if no engineer assigned, "Ongoing" if engineer assigned), `progress` (0), `createdBy`, `createdAt`

### Proof-of-Work Photos
Mobile engineers upload geotagged phase photos to Storage at `projects/{projectId}/milestones/{milestoneId}/proofs/{capturedAt}.jpg` (filename pattern enforced by `storage.rules`) and append a metadata entry to the parent milestone's `proofs[]` array in Firestore.

**Canonical `proofs[]` entry shape** (mobile `uploadProofPhoto` writes this):
```
{ id, fileName, url, storagePath, uploadedBy, uploadedAt: Timestamp,
  gps: { lat: number, lng: number }, accuracy: number,
  location: string,              // reverse-geocoded server-side by mobile
  capturedAt: Timestamp }
```

**Legacy tolerance.** Older docs may still carry the pre-convergence shape (`name`, flat `latitude` / `longitude`, ms-epoch `timestamp`). Readers must accept both during the mobile migration window — see `normalizeProof` in [client/src/pages/hcsd/ProjectDetail.jsx](client/src/pages/hcsd/ProjectDetail.jsx).

**Tamper-evident banner.** Every new JPEG carries a 5-line evidence stamp burnt into pixel data at the bottom by mobile's `uploadProofPhoto` before upload: place name, coords + accuracy, capture time, engineer name, role. The file itself is the audit record — re-downloads preserve the stamp.

**Web read path.** HCSD Project Detail's `loadProofs` reads Firestore `milestone.proofs[]` as the primary source, then runs a Storage `listAll()` + client-side EXIF fallback only for files without a matching Firestore entry (pre-contract proofs). The lightbox deliberately shows only the stamped JPEG + a single tappable "📍 {location} ↗" Maps deep-link chip — capture time / coords / accuracy are intentionally not rendered as structured chips because they'd duplicate the burnt-in banner. The thumbnail pin-badge tooltip surfaces `location` on hover.

## Project Status Workflow
Valid project statuses: `Delayed` → `Ongoing` → `Completed`. `Returned` is used when a project is sent back for revision. `Delayed` means created but no engineer assigned yet; `Ongoing` means an engineer is assigned and work is active. The former `"Draft"` and `"For Mayor"` statuses are retired — both normalize to `Ongoing` for display. New projects auto-set to `"Delayed"` (no engineer) or `"Ongoing"` (engineer assigned) on creation.

## Key Conventions
- Cloud Functions use **v2 API** (`firebase-functions/v2`)
- Lazy-loaded routes via `React.lazy` + `Suspense` in `App.jsx`
- Validation schemas shared pattern: Zod on both client (`config/validationSchemas.js`) and server (`functions/src/index.js`)
- HCSD pages are under `client/src/pages/hcsd/`, sidebar at `components/layout/HcsdSidebar.jsx`
- HCSD routes are `/hcsd/*`
- Theme preference stored in `localStorage` key `hcsd-theme` (legacy key `depw-theme` read on first load for migration)
- CSS background class is `.hcsd-bg` (defined in `client/src/index.css`)
- Git user: Warren Gallardo

## Audit Trail Events (HCSD scope — `auditTrails/hcsd/entries`)
The HCSD audit trail is the tamper-proof record of **administrative actions done by an HCSD user inside the web app**. Mobile/PROJ_ENG activity is explicitly excluded — it surfaces to HCSD only via the Notifications "Field Activity" tab.

| Action | Trigger | Subject | Filter group |
|---|---|---|---|
| `USER_LOGIN` | OTP verification success (HCSD actor) | Actor name | Auth |
| `USER_LOGOUT` | `logUserLogout` Cloud Function — fired from sidebar sign-out button (HCSD actor) | Actor name | Auth |
| `PASSWORD_CHANGED` | `changePassword` Cloud Function (HCSD actor) | Actor name | Auth |
| `SESSIONS_REVOKED` | `revokeOtherSessions` Cloud Function (HCSD actor) | Actor name | Auth |
| `PHOTO_UPDATED` | `updateProfilePhoto` Cloud Function (HCSD actor) | Actor name | Profile |
| `PROJECT_CREATED` | `createProject` Cloud Function | Project name | Project |
| `NTP_REJECTED` | `attachNtp` Cloud Function (filename violation or magic-byte mismatch) | Project name | Project |
| `ACCOUNT_CREATED` | `createOfficialAccount` Cloud Function | New user email | Staff |
| `ACCOUNT_DELETED` | `deleteOfficialAccount` Cloud Function | Deleted user email | Staff |

**Dual-write pattern.** Three actions (`USER_LOGOUT`, `PASSWORD_CHANGED`, `SESSIONS_REVOKED`) also write a row to `auditTrails/mis/entries` so the MIS system-observability scope retains full visibility. The HCSD row is only written when the actor's `users/{uid}.role === "HCSD"` — MAYOR/CPDO/MIS users' analogous actions land in MIS-only and do not pollute the HCSD trail.

**Deliberately not logged here:**
- `NTP_ATTACHED` — bundled into the `PROJECT_CREATED` entry; NTP upload is part of project creation, not a standalone admin action.
- `PROFILE_UPDATED` (display name) — only MIS can change department-head names; the MIS scope alone covers it.
- Maintenance operations (`backfillProjectEngineerUids`, `purgeMobileOriginHcsdAudit`) — system housekeeping, not administrative work; Cloud Functions logs retain the forensic record.

**Excluded from this trail.** Mobile-origin actions (`Proof Uploaded`, `Milestone Completed`, `Milestones Drafted`, `Milestones Confirmed`, `Project Completed`) never belong here — they route to Notifications. Enforced by three layers: (1) `firestore.rules` denies all client writes to `auditTrails/hcsd/entries`, (2) `AuditTrails.jsx` client-side filter `MOBILE_ORIGIN_ACTIONS` strips any bleed-through, (3) the `purgeMobileOriginHcsdAudit` callable batch-deletes legacy stray rows (no audit entry on its own run).

## Notification Categories
Notifications have a `category` field with two lanes, rendered as tabs on the Notifications page:

| `category` | Direction | Examples |
|---|---|---|
| `"system"` (default) | HCSD → PROJ_ENG | `PROJECT_ASSIGNED` |
| `"field"` | PROJ_ENG → HCSD | `Proof Uploaded`, `Milestones Drafted`, `Milestones Confirmed`, `Milestone Completed`, `Project Completed` (server-synthesized) |

NTP attachments deliberately do **not** fan out a notification to the engineer — the NTP upload is a mandatory part of project creation on the web side, not a standalone event worth alerting on.

## Mobile → Web Notification Fan-Out (`onMobileAuditCreated` trigger)
Mobile PROJ_ENG writes its own self-audit to `auditTrails/mobile/entries` (PROJ_ENG-only read per rules). A Firestore `onCreate` trigger watches that collection and, for the four whitelisted actions below, creates a `category: "field"` notification for the project's `createdBy` HCSD user. Everything else the mobile writes (login, generic updates, draft removals) is ignored.

| Action (exact string) | Mobile trigger | Notification severity |
|---|---|---|
| `Proof Uploaded` | Geotagged proof-of-work photo upload (mobile `uploadProofPhoto` callable writes the mobile audit doc) | info |
| `Milestones Drafted` | AI milestone draft generated | info |
| `Milestones Confirmed` | Engineer finalizes milestones | success |
| `Milestone Completed` | Engineer marks a single phase complete on mobile | success |
| `Project Completed` | Synthesized server-side when `Milestone Completed` brings the done-count to total (no mobile event required) | success |

Action strings are case-sensitive — mobile must emit them exactly as written. Mobile must also include either `targetId: projectId` or `details.projectId` on the audit entry so the trigger can resolve the project's `createdBy`, AND `details.milestoneId: "<firestore-doc-id>"` on all four actions so the trigger can FK-resolve the milestone's canonical `title` + `sequence` and render them into the notification body (e.g. `Construction of Drainage Canal: Phase 2 — "Site Preparation" marked complete`). The resolved milestone is also persisted on the notification as `metadata.milestoneId` / `metadata.milestoneTitle` / `metadata.milestoneSequence` for deep-linking.

**Canonical mobile audit entry shape:** `{ action, actorUid, createdAt: serverTimestamp(), details: { message, projectId?, milestoneId? }, targetId?, email }`. Dropped from new writes: `uid`, `timestamp`, `platform`, string-form `details`. The trigger only reads `action`, `details`, and `targetId`, and its `typeof rawDetails === "object"` guard tolerates the legacy string form during migration.

## Data Migration (One-Time)
Before deploying to production, run `scripts/migrate-depw-to-hcsd.js` to update existing Firestore user documents from `role: 'DEPW'` to `role: 'HCSD'` and refresh Auth custom claims. See script for full instructions.
