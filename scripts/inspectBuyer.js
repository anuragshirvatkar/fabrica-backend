import 'dotenv/config';
import connectDB from '../src/config/db.js';
import User from '../src/models/User.js';
import Buyer from '../src/models/Buyer.js';
import Order from '../src/models/Order.js';
import Payment from '../src/models/Payment.js';
import Address from '../src/models/Address.js';
import Cart from '../src/models/Cart.js';
import Favorite from '../src/models/Favorite.js';

const email = (process.argv[2] || 'anuragshirvatkar@gmail.com').toLowerCase();

await connectDB();
const user = await User.findOne({ email }).lean();
console.log('target user', user);

const groups = await Order.aggregate([{ $group: { _id: '$buyerId', n: { $sum: 1 } } }]);
for (const g of groups) {
  const u = await User.findById(g._id).select('email role').lean();
  console.log('orders by', String(g._id), g.n, u?.email, u?.role);
}

if (user) {
  console.log('buyer docs', await Buyer.find({ userId: user._id }).lean());
  console.log('addresses', await Address.countDocuments({ buyerId: user._id }));
  console.log('carts', await Cart.find({ buyerId: user._id }).lean());
  console.log('favorites', await Favorite.find({ buyerId: user._id }).lean());
  console.log('payments', await Payment.countDocuments({ buyerId: user._id }));
}

process.exit(0);
