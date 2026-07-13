import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDirectory = join(__dirname, 'data');
const legacyStorePath = join(dataDirectory, 'store.json');
export const databasePath = join(dataDirectory, 'restaurant.sqlite');

mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(databasePath, { timeout: 5000 });
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS dishes (
    id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS add_ons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS order_history (
    id TEXT PRIMARY KEY,
    completed_at TEXT NOT NULL,
    data_json TEXT NOT NULL
  ) STRICT;
`);

const dishColumns = database.prepare('PRAGMA table_info(dishes)').all();
if (!dishColumns.some((column) => column.name === 'allowed_add_on_ids_json')) {
  database.exec('ALTER TABLE dishes ADD COLUMN allowed_add_on_ids_json TEXT');
}
if (!dishColumns.some((column) => column.name === 'sort_order')) {
  database.exec('ALTER TABLE dishes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}

const addOnColumns = database.prepare('PRAGMA table_info(add_ons)').all();
if (!addOnColumns.some((column) => column.name === 'sort_order')) {
  database.exec('ALTER TABLE add_ons ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function loadStateFromDatabase() {
  const settingsRow = database.prepare('SELECT data_json FROM settings WHERE id = 1').get();
  const hasData = settingsRow || database.prepare('SELECT 1 AS found FROM users LIMIT 1').get()
    || database.prepare('SELECT 1 AS found FROM dishes LIMIT 1').get();
  if (!hasData) return null;

  return {
    queue: database.prepare('SELECT data_json FROM orders ORDER BY rowid').all()
      .map((row) => parseJson(row.data_json, null)).filter(Boolean),
    dishes: database.prepare('SELECT * FROM dishes ORDER BY sort_order, created_at, rowid').all().map((row) => ({
      id: row.id,
      group: row.group_name,
      name: row.name,
      note: row.note,
      priceCents: row.price_cents,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      allowedAddOnIds: row.allowed_add_on_ids_json === null
        ? undefined
        : parseJson(row.allowed_add_on_ids_json, []),
    })),
    addOns: database.prepare('SELECT * FROM add_ons ORDER BY sort_order, created_at, rowid').all().map((row) => ({
      id: row.id,
      name: row.name,
      priceCents: row.price_cents,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    settings: settingsRow ? parseJson(settingsRow.data_json, {}) : {},
    users: database.prepare('SELECT * FROM users ORDER BY created_at, rowid').all().map((row) => ({
      id: row.id,
      username: row.username,
      usernameNormalized: row.username_normalized,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      createdAt: row.created_at,
      demo: Boolean(row.is_demo),
    })),
    sessions: database.prepare('SELECT * FROM sessions ORDER BY created_at, rowid').all().map((row) => ({
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
    history: database.prepare('SELECT data_json FROM order_history ORDER BY completed_at DESC, rowid DESC').all()
      .map((row) => parseJson(row.data_json, null)).filter(Boolean),
  };
}

export function saveStateToDatabase(state) {
  const insertSettings = database.prepare('INSERT INTO settings (id, data_json) VALUES (1, ?)');
  const insertUser = database.prepare(`
    INSERT INTO users (id, username, username_normalized, password_hash, password_salt, created_at, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSession = database.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
  `);
  const insertDish = database.prepare(`
    INSERT INTO dishes (id, group_name, name, note, price_cents, active, sort_order, created_at, updated_at, allowed_add_on_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAddOn = database.prepare(`
    INSERT INTO add_ons (id, name, price_cents, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrder = database.prepare('INSERT INTO orders (id, data_json) VALUES (?, ?)');
  const insertHistory = database.prepare('INSERT INTO order_history (id, completed_at, data_json) VALUES (?, ?, ?)');

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM sessions; DELETE FROM users; DELETE FROM dishes; DELETE FROM add_ons; DELETE FROM orders; DELETE FROM order_history; DELETE FROM settings;');
    insertSettings.run(JSON.stringify(state.settings ?? {}));
    for (const user of state.users ?? []) {
      insertUser.run(user.id, user.username, user.usernameNormalized, user.passwordHash, user.passwordSalt, user.createdAt, user.demo ? 1 : 0);
    }
    for (const session of state.sessions ?? []) {
      insertSession.run(session.tokenHash, session.userId, session.createdAt, session.expiresAt);
    }
    for (const [index, dish] of (state.dishes ?? []).entries()) {
      insertDish.run(dish.id, dish.group, dish.name, dish.note ?? '', dish.priceCents, dish.active ? 1 : 0, index, dish.createdAt, dish.updatedAt, JSON.stringify(dish.allowedAddOnIds ?? []));
    }
    for (const [index, addOn] of (state.addOns ?? []).entries()) {
      insertAddOn.run(addOn.id, addOn.name, addOn.priceCents, addOn.active ? 1 : 0, index, addOn.createdAt, addOn.updatedAt);
    }
    for (const order of state.queue ?? []) {
      insertOrder.run(order.id, JSON.stringify(order));
    }
    for (const order of state.history ?? []) {
      insertHistory.run(order.id, order.completedAt, JSON.stringify(order));
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

if (!loadStateFromDatabase() && existsSync(legacyStorePath)) {
  const legacyState = parseJson(readFileSync(legacyStorePath, 'utf8'), null);
  if (legacyState) saveStateToDatabase(legacyState);
}
