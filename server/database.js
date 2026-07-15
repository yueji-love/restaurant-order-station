import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createPasswordRecord } from './auth.js';
import { demoSeed } from './seed/demo-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SCHEMA_VERSION = 2;

const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
export const databasePath = configuredDatabasePath
  ? resolve(configuredDatabasePath)
  : join(__dirname, 'data', 'restaurant.sqlite');

let defaultDatabasePromise;

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function createPublicToken() {
  const bytes = randomBytes(10);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let token = '';
  for (let index = 0; index < 16; index += 1) {
    token = TOKEN_ALPHABET[Number(value & 31n)] + token;
    value >>= 5n;
  }
  return token;
}

function existingApplicationTables(database) {
  return database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
}

export function createSchema(database) {
  const version = Number(database.prepare('PRAGMA user_version').get().user_version ?? 0);
  const existingTables = existingApplicationTables(database);
  if (version < SCHEMA_VERSION && existingTables.length > 0) {
    const isCurrentSchema = existingTables.includes('bill_items') && existingTables.includes('number_plates');
    if (!isCurrentSchema) {
      throw new Error('当前数据库属于旧测试结构，请先运行 npm run db:reset-demo -- --confirm-reset。');
    }
  }

  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS merchant_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0, 1)),
      payment_qr_blob BLOB,
      payment_qr_mime TEXT,
      payment_qr_updated_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS dishes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, category_id, name)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS add_ons (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS dish_add_ons (
      dish_id TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      add_on_id TEXT NOT NULL REFERENCES add_ons(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dish_id, add_on_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS number_plates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 999),
      public_token TEXT NOT NULL UNIQUE CHECK (length(public_token) = 16),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number_plate_id TEXT REFERENCES number_plates(id) ON DELETE SET NULL,
      number_snapshot INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'settled')),
      total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
      opened_at TEXT NOT NULL,
      settled_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS bill_items (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_dish_id TEXT NOT NULL,
      category_name_snapshot TEXT NOT NULL,
      dish_name_snapshot TEXT NOT NULL,
      dish_note_snapshot TEXT NOT NULL DEFAULT '',
      base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 0),
      add_on_unit_cents INTEGER NOT NULL DEFAULT 0 CHECK (add_on_unit_cents >= 0),
      unit_total_cents INTEGER NOT NULL CHECK (unit_total_cents >= 0),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
      line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
      status TEXT NOT NULL CHECK (status IN ('waiting', 'making', 'completed')),
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS bill_item_add_ons (
      id TEXT PRIMARY KEY,
      bill_item_id TEXT NOT NULL REFERENCES bill_items(id) ON DELETE CASCADE,
      source_add_on_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS one_open_bill_per_plate
      ON bills(user_id, number_plate_id) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS categories_by_user ON categories(user_id, sort_order);
    CREATE INDEX IF NOT EXISTS dishes_by_user ON dishes(user_id, category_id, sort_order);
    CREATE INDEX IF NOT EXISTS add_ons_by_user ON add_ons(user_id, sort_order);
    CREATE INDEX IF NOT EXISTS plates_by_user ON number_plates(user_id, sort_order);
    CREATE INDEX IF NOT EXISTS bills_by_user_status ON bills(user_id, status, settled_at, opened_at);
    CREATE INDEX IF NOT EXISTS bill_items_by_bill ON bill_items(bill_id, created_at);
    CREATE INDEX IF NOT EXISTS kitchen_queue ON bill_items(user_id, status, source_dish_id, created_at);
    CREATE INDEX IF NOT EXISTS item_add_ons_by_item ON bill_item_add_ons(bill_item_id, sort_order);

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

export function withTransaction(database, action) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function nextUniquePublicToken(database) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = createPublicToken();
    if (!database.prepare('SELECT 1 FROM number_plates WHERE public_token = ?').get(token)) return token;
  }
  throw new Error('无法生成唯一号牌令牌。');
}

export function createMerchantDefaults(database, userId, plateNumbers = Array.from({ length: 36 }, (_, index) => index + 1)) {
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO merchant_settings (user_id, sound_enabled) VALUES (?, 1)
  `).run(userId);
  const insertPlate = database.prepare(`
    INSERT INTO number_plates (id, user_id, number, public_token, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  plateNumbers.forEach((number, sortOrder) => {
    insertPlate.run(createId('plate'), userId, number, nextUniquePublicToken(database), sortOrder, timestamp);
  });
}

export async function ensureDemoBootstrap(database) {
  const count = Number(database.prepare('SELECT COUNT(*) AS count FROM users').get().count);
  if (count > 0) return false;

  const { passwordHash, passwordSalt } = await createPasswordRecord('123');
  const userId = createId('user');
  const timestamp = new Date().toISOString();

  withTransaction(database, () => {
    database.prepare(`
      INSERT INTO users (id, username, username_normalized, password_hash, password_salt, created_at, is_demo)
      VALUES (?, 'yue', 'yue', ?, ?, ?, 1)
    `).run(userId, passwordHash, passwordSalt, timestamp);
    createMerchantDefaults(database, userId, demoSeed.plateNumbers);

    const insertCategory = database.prepare(`
      INSERT INTO categories (id, user_id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    demoSeed.categories.forEach((item) => {
      insertCategory.run(item.id, userId, item.name, item.sortOrder, timestamp, timestamp);
    });

    const insertAddOn = database.prepare(`
      INSERT INTO add_ons (id, user_id, name, price_cents, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    demoSeed.addOns.forEach((item) => {
      insertAddOn.run(item.id, userId, item.name, item.priceCents, item.active ? 1 : 0, item.sortOrder, timestamp, timestamp);
    });

    const insertDish = database.prepare(`
      INSERT INTO dishes (id, user_id, category_id, name, note, price_cents, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRelation = database.prepare(`
      INSERT INTO dish_add_ons (dish_id, add_on_id, sort_order) VALUES (?, ?, ?)
    `);
    demoSeed.dishes.forEach((item) => {
      insertDish.run(
        item.id,
        userId,
        item.categoryId,
        item.name,
        item.note,
        item.priceCents,
        item.active ? 1 : 0,
        item.sortOrder,
        timestamp,
        timestamp,
      );
      item.allowedAddOnIds.forEach((addOnId, sortOrder) => insertRelation.run(item.id, addOnId, sortOrder));
    });
  });
  return true;
}

export async function openRestaurantDatabase(path = databasePath, { bootstrap = true } = {}) {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath, { timeout: 5000 });
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  try {
    createSchema(database);
    if (bootstrap) await ensureDemoBootstrap(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function getDatabase() {
  if (!defaultDatabasePromise) defaultDatabasePromise = openRestaurantDatabase(databasePath);
  return defaultDatabasePromise;
}

export async function closeDatabase() {
  if (!defaultDatabasePromise) return;
  const database = await defaultDatabasePromise;
  database.close();
  defaultDatabasePromise = undefined;
}

export function removeDatabaseFiles(path = databasePath) {
  const resolvedPath = resolve(path);
  for (const candidate of [resolvedPath, `${resolvedPath}-shm`, `${resolvedPath}-wal`]) {
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
}
