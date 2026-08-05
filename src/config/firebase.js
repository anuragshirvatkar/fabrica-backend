import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadServiceAccount = () => {
  // Preferred on Render / cloud: paste the full JSON as one env var.
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson?.trim()) {
    return JSON.parse(rawJson);
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(__dirname, 'fabrica-1e64e-firebase-adminsdk-fbsvc-680cfec05b.json');

  return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

export default admin;
