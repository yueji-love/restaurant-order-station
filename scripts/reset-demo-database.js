import { databasePath, openRestaurantDatabase, removeDatabaseFiles } from '../server/database.js';

if (!process.argv.includes('--confirm-reset')) {
  console.error('拒绝清空数据库：请确认服务已停止，并使用 npm run db:reset-demo -- --confirm-reset。');
  process.exit(1);
}

console.log(`正在重建测试数据库：${databasePath}`);
removeDatabaseFiles(databasePath);
const database = await openRestaurantDatabase(databasePath);

const summary = {
  users: database.prepare('SELECT COUNT(*) AS count FROM users').get().count,
  categories: database.prepare('SELECT COUNT(*) AS count FROM categories').get().count,
  dishes: database.prepare('SELECT COUNT(*) AS count FROM dishes').get().count,
  addOns: database.prepare('SELECT COUNT(*) AS count FROM add_ons').get().count,
  numberPlates: database.prepare('SELECT COUNT(*) AS count FROM number_plates').get().count,
  bills: database.prepare('SELECT COUNT(*) AS count FROM bills').get().count,
};

database.close();
console.log('测试数据库已重建。');
console.log(JSON.stringify(summary, null, 2));
