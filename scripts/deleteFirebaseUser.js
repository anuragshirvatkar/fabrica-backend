import 'dotenv/config';
import admin from '../src/config/firebase.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/deleteFirebaseUser.js <email>');
  process.exit(1);
}

try {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().deleteUser(user.uid);
  console.log(JSON.stringify({ deleted: true, email, uid: user.uid }, null, 2));
} catch (error) {
  if (error?.code === 'auth/user-not-found') {
    console.log(JSON.stringify({ deleted: false, email, note: 'already missing' }, null, 2));
    process.exit(0);
  }
  console.error(error.message || error);
  process.exit(1);
}
