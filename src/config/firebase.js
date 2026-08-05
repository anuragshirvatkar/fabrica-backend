import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadServiceAccount = () => {
  // Render / production: paste the full service-account JSON into this env var.
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON. Paste the full Firebase admin JSON (minified is fine).',
      );
    }
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, 'fabrica-1e64e-firebase-adminsdk-fbsvc-680cfec05b.json');

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      'Firebase credentials missing. On Render, set FIREBASE_SERVICE_ACCOUNT_JSON to the full contents of your Firebase Admin SDK JSON file. Do not use FIREBASE_SERVICE_ACCOUNT_PATH on Render (that file is not in git).',
    );
  }

  return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

export default admin;
