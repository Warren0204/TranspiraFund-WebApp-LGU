# TranspiraFund LGU Web Application

A multi-tenant, role-based web application for Local Government Units (LGUs) in the Philippines to manage public works projects and deliver fund transparency to citizens.

Each LGU is one tenant. Tenant isolation is enforced at three layers — custom claims on every Auth token, a `tenantId` field stamped on every Firestore document, and Firestore + Storage rules that verify both must match.

## Roles

| Role | Department | Surface |
|---|---|---|
| **MIS** | Management Information Systems | LGU tenant administrator (web) |
| **HCSD** | Construction Services Division, DEPW | Operations dashboard (web) |
| **PROJECT_ENGINEER** | Construction Services Division, DEPW | Field engineer (mobile) |

## Tech Stack

- **Frontend:** React 18, Vite, React Router v6, Tailwind, Zod
- **Backend:** Firebase Cloud Functions v2 (Node.js 22), Firebase Admin SDK, Zod, Nodemailer
- **Database:** Cloud Firestore
- **Storage:** Firebase Storage (NTP documents, geotagged proof-of-work photos)
- **Auth:** Firebase Auth + custom claims (role, tenantId, OTP verification)
- **Hosting:** Firebase Hosting (`client/dist`)
- **Region:** `asia-southeast1`

## Repository Layout

```
/
├── client/         # React + Vite frontend
├── functions/      # Firebase Cloud Functions (v2 API)
├── scripts/        # Admin / one-time maintenance scripts
├── firebase.json   # Hosting + rules + functions config
├── firestore.rules
└── storage.rules
```

## Getting Started

### Frontend (`client/`)

Create `client/.env`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Then:

```bash
cd client
npm install
npm run dev       # local dev server
npm run build     # production build → dist/
```

### Cloud Functions (`functions/`)

Secrets are managed via Firebase Secret Manager (not env vars):

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

```bash
cd functions
npm install
npm run serve     # emulator
npm run deploy    # deploy functions only
npm run logs
```

### Firebase deploys (from repo root)

```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only storage
firebase deploy --only functions
```

## Security Model

- All Firestore writes go through Cloud Functions using the Admin SDK — direct client writes are blocked at the rules layer.
- Role-based access enforced in both Firestore rules and the frontend `RequireAuth` guard.
- Zod validation on both client and server.
- Cryptographically secure password generation (`crypto.randomInt`) for provisioned accounts.
- Mandatory OTP verification on every sign-in.
- Per-user rolling-hour rate limits on sensitive callables (NTP uploads, project creation).
- Security headers configured in `firebase.json`: CSP, HSTS, X-Frame-Options.

## Multi-Tenancy

New tenants are provisioned via the `provisionTenant` Cloud Function, gated by a `platformAdmin` custom claim. Bootstrap a platform admin with:

```bash
node scripts/grant-platform-admin.js <uid>
```

Tenant ID format: `{lgu-slug}-{psgc-10-digit}` (e.g. `cebu-city-0730600000`), where the 10-digit PSGC code follows PSA Board Resolution No. 07 Series of 2021.

## License

Proprietary. All rights reserved.
