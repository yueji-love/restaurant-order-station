import { createPasswordRecord, normalizeUsername } from '../server/auth.js';
import { loadStateFromDatabase, saveStateToDatabase } from '../server/database.js';
import { DEFAULT_ADD_ONS, DEFAULT_DISHES } from '../server/menu-data.js';

const username = normalizeUsername(process.argv[2] ?? 'yue');
const password = process.argv[3] ?? '123';
const resetUsers = process.argv.includes('--reset-users');
const stored = loadStateFromDatabase() ?? {};
const createdAt = new Date().toISOString();
const usernameNormalized = username.toLocaleLowerCase('zh-CN');
const existingUser = Array.isArray(stored.users)
  ? stored.users.find((item) => item.usernameNormalized === usernameNormalized)
  : null;
const passwordRecord = await createPasswordRecord(password);
const user = {
  id: existingUser?.id ?? `user-demo-${usernameNormalized}`,
  username,
  usernameNormalized,
  ...passwordRecord,
  createdAt: existingUser?.createdAt ?? createdAt,
  demo: true,
};
const users = (resetUsers ? [] : Array.isArray(stored.users) ? stored.users : []).filter((item) => item.id !== user.id);
users.push(user);

const withTimestamps = (item) => ({ ...item, createdAt, updatedAt: createdAt });
const nextState = {
  queue: Array.isArray(stored.queue) ? stored.queue : [],
  dishes: DEFAULT_DISHES.map(withTimestamps),
  addOns: DEFAULT_ADD_ONS.map(withTimestamps),
  settings: stored.settings ?? {
    sortMode: 'time',
    sound: true,
    availableNumbers: Array.from({ length: 36 }, (_, index) => index + 1),
  },
  users,
  sessions: (Array.isArray(stored.sessions) ? stored.sessions : []).filter((item) => item.userId !== user.id),
};

saveStateToDatabase(nextState);
console.log(JSON.stringify({ username, dishes: nextState.dishes.length, addOns: nextState.addOns.length }));
