const path = require('path');
const fs = require('fs');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SERVICE_ACCOUNT = path.join(__dirname, '..', 'serviceAccountKey.json');
const CORS_FILE = path.join(__dirname, '..', 'cors.json');
const BUCKET = 'transpirafund-webapp.firebasestorage.app';

(async () => {
  if (!fs.existsSync(SERVICE_ACCOUNT)) {
    console.error(`Missing service account key: ${SERVICE_ACCOUNT}`);
    process.exit(1);
  }
  if (!fs.existsSync(CORS_FILE)) {
    console.error(`Missing cors.json: ${CORS_FILE}`);
    process.exit(1);
  }

  const cors = JSON.parse(fs.readFileSync(CORS_FILE, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
    storageBucket: BUCKET,
  });

  const bucket = admin.storage().bucket();
  console.log(`Setting CORS on gs://${BUCKET} from ${path.relative(process.cwd(), CORS_FILE)} ...`);
  await bucket.setCorsConfiguration(cors);

  const [meta] = await bucket.getMetadata();
  console.log('\nApplied CORS configuration:');
  console.log(JSON.stringify(meta.cors, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  if (err.errors) console.error(err.errors);
  process.exit(1);
});
