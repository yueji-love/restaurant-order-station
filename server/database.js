import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
export const databasePath = configuredDatabasePath
  ? resolve(configuredDatabasePath)
  : join(__dirname, 'data', 'restaurant.sqlite');
const dataDirectory = dirname(databasePath);
const legacyStorePath = join(dataDirectory, 'store.json');

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

  CREATE TABLE IF NOT EXISTS workspaces (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

function loadUsers() {
  return database.prepare('SELECT * FROM users ORDER BY created_at, rowid').all().map((row) => ({
    id: row.id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    createdAt: row.created_at,
    demo: Boolean(row.is_demo),
  }));
}

function loadSessions() {
  return database.prepare('SELECT * FROM sessions ORDER BY created_at, rowid').all().map((row) => ({
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

function loadLegacyWorkspace() {
  const settingsRow = database.prepare('SELECT data_json FROM settings WHERE id = 1').get();
  const dishes = database.prepare('SELECT * FROM dishes ORDER BY sort_order, created_at, rowid').all().map((row) => ({
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
  }));
  const addOns = database.prepare('SELECT * FROM add_ons ORDER BY sort_order, created_at, rowid').all().map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const queue = database.prepare('SELECT data_json FROM orders ORDER BY rowid').all()
    .map((row) => parseJson(row.data_json, null)).filter(Boolean);
  const history = database.prepare('SELECT data_json FROM order_history ORDER BY completed_at DESC, rowid DESC').all()
    .map((row) => parseJson(row.data_json, null)).filter(Boolean);

  return {
    hasData: Boolean(settingsRow || dishes.length || addOns.length || queue.length || history.length),
    workspace: {
      queue,
      dishes,
      addOns,
      settings: settingsRow ? parseJson(settingsRow.data_json, {}) : {},
      history,
    },
  };
}

function selectLegacyOwner(users) {
  return users.find((user) => user.usernameNormalized === 'yue') ?? users[0] ?? null;
}

function loadWorkspaces(users) {
  const rows = database.prepare('SELECT user_id, data_json FROM workspaces ORDER BY created_at, rowid').all();
  if (rows.length) {
    return Object.fromEntries(rows.map((row) => [row.user_id, parseJson(row.data_json, {})]));
  }

  const legacy = loadLegacyWorkspace();
  const owner = selectLegacyOwner(users);
  if (!legacy.hasData || !owner) return {};

  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO workspaces (user_id, data_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(owner.id, JSON.stringify(legacy.workspace), timestamp, timestamp);
  return { [owner.id]: legacy.workspace };
}

export function loadStateFromDatabase() {
  const users = loadUsers();
  const sessions = loadSessions();
  const workspaces = loadWorkspaces(users);
  if (!users.length && !Object.keys(workspaces).length) return null;
  return { users, sessions, workspaces };
}

export function saveStateToDatabase(state) {
  const insertUser = database.prepare(`
    INSERT INTO users (id, username, username_normalized, password_hash, password_salt, created_at, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSession = database.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
  `);
  const insertWorkspace = database.prepare(`
    INSERT INTO workspaces (user_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?)
  `);
  const existingCreatedAt = new Map(
    database.prepare('SELECT user_id, created_at FROM workspaces').all()
      .map((row) => [row.user_id, row.created_at]),
  );
  const timestamp = new Date().toISOString();

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM sessions; DELETE FROM workspaces; DELETE FROM users;');
    for (const user of state.users ?? []) {
      insertUser.run(
        user.id,
        user.username,
        user.usernameNormalized,
        user.passwordHash,
        user.passwordSalt,
        user.createdAt,
        user.demo ? 1 : 0,
      );
    }
    for (const session of state.sessions ?? []) {
      insertSession.run(session.tokenHash, session.userId, session.createdAt, session.expiresAt);
    }
    for (const user of state.users ?? []) {
      const workspace = state.workspaces?.[user.id];
      if (!workspace) continue;
      insertWorkspace.run(
        user.id,
        JSON.stringify(workspace),
        existingCreatedAt.get(user.id) ?? timestamp,
        timestamp,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

if (!loadStateFromDatabase() && existsSync(legacyStorePath)) {
  const legacyState = parseJson(readFileSync(legacyStorePath, 'utf8'), null);
  const users = Array.isArray(legacyState?.users) ? legacyState.users : [];
  const owner = selectLegacyOwner(users);
  if (legacyState && owner) {
    saveStateToDatabase({
      users,
      sessions: Array.isArray(legacyState.sessions) ? legacyState.sessions : [],
      workspaces: {
        [owner.id]: {
          queue: Array.isArray(legacyState.queue) ? legacyState.queue : [],
          dishes: Array.isArray(legacyState.dishes) ? legacyState.dishes : [],
          addOns: Array.isArray(legacyState.addOns) ? legacyState.addOns : [],
          settings: legacyState.settings ?? {},
          history: Array.isArray(legacyState.history) ? legacyState.history : [],
        },
      },
    });
  }
}
