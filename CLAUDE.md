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
| `auditTrails/mobile/entries/{logId}` | Mobile activity log | PROJ_ENG creates; MIS/HCSD read |
| `notifications/{notifId}` | App notifications | Recipient-only read/update (isRead + dismissedAt). Writes via Cloud Functions |
| `stats/public` | Aggregated public counters (`totalProjects`, `totalBudget`, `totalEngineers`, `done`, `delayed`, `progress`) | Public read; trigger-maintained |
| `otpCodes/{uid}` | OTP storage | Cloud Functions only |
| `passwordResets/{emailHash}` | Password reset rate-limiting (legacy) | Cloud Functions only |
| `passwordResetOtps/{docId}` | Password reset OTP storage | Cloud Functions only; client-blocked in rules |
| `passwordResetCooldowns/{docId}` | Password reset rate-limiting | Cloud Functions only; client-blocked in rules |
| `ntpRateLimits/{uid}` | Per-user rolling-hour counter for `attachNtp` calls (max 20/hr) | Cloud Functions only; client-blocked in rules |

## Project Schema (Firestore `projects` document)
All fields stored on the project document:
- **Project Details**: `projectName`, `sitioStreet`, `barangay`
- **Classification**: `projectType` (enum — see `client/src/config/projectTypes.js`; mirrored in `functions/src/index.js`)
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
| Action | Trigger | Subject |
|---|---|---|
| `USER_LOGIN` | OTP verification success | Actor name |
| `PROJECT_CREATED` | `createProject` Cloud Function | Project name |
| `NTP_ATTACHED` | `attachNtp` Cloud Function | Project name |
| `NTP_REJECTED` | `attachNtp` Cloud Function (filename violation or magic-byte mismatch) | Project name |
| `ACCOUNT_CREATED` | `createOfficialAccount` Cloud Function | New user email |
| `ACCOUNT_DELETED` | `deleteOfficialAccount` Cloud Function | Deleted user email |
| `PHOTO_UPDATED` | `updateProfilePhoto` Cloud Function (HCSD only) | Actor name |
| `PHOTO_UPLOADED` | Mobile PROJ_ENG upload | Project name |
| `PROJECT_UPDATE` | Mobile PROJ_ENG update | Project name |

## Data Migration (One-Time)
Before deploying to production, run `scripts/migrate-depw-to-hcsd.js` to update existing Firestore user documents from `role: 'DEPW'` to `role: 'HCSD'` and refresh Auth custom claims. See script for full instructions.
