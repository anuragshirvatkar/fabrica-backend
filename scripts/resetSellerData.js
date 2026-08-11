import 'dotenv/config';
import connectDB from '../src/config/db.js';
import { resetSellerAccountData } from '../src/services/sellerResetService.js';

const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/resetSellerData.js <seller-email>');
  process.exit(1);
}

const run = async () => {
  await connectDB();
  const result = await resetSellerAccountData(email);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
