import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';
import { recoverPendingAutoDeliveries } from './services/orderService.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  try {
    await recoverPendingAutoDeliveries();
  } catch (error) {
    console.error('[order] failed to recover auto-deliveries', error.message);
  }
};

startServer();
