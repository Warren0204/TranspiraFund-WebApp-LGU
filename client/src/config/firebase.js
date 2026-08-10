import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const REQUIRED_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];
const missing = REQUIRED_VARS.filter((v) => !import.meta.env[v]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// App Check — gates callables with `enforceAppCheck: true` (sendOtp, verifyOtp,
// sendPasswordReset, resetPassword). Setup: (1) register a reCAPTCHA Enterprise
// site key at https://console.firebase.google.com/project/_/appcheck for this
// web app, (2) set VITE_APPCHECK_SITE_KEY in client/.env, (3) rebuild. Init is
// guarded so dev environments without the key still boot; enforcement only
// takes effect once the env var is populated AND the site key is registered.
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);

// Persistent IndexedDB cache with multi-tab support so an HCSD user can
// open a second Project Detail tab and share the cache. On a browser
// where IndexedDB is unavailable (some private-browsing modes,
// enterprise-locked environments) initializeFirestore itself does not
// throw; the SDK degrades to memory internally. The try/catch is a
// belt-and-suspenders fallback that reverts to the bare getFirestore
// path (today's behavior) if anything unexpected throws at init.
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (err) {
  console.warn('[firebase] persistent cache init failed, falling back to memory-only Firestore', err);
  dbInstance = getFirestore(app);
}
export const db = dbInstance;

export const storage = getStorage(app);

export default app;