import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createPasswordRecord } from '../server/auth.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startApplication(databasePath) {
  const port = await getFreePort();
  const output = [];
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务启动失败：${output.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`);
      if (response.ok) return { baseUrl, child, output };
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`等待服务启动超时：${output.join('')}`);
}

async function request(baseUrl, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}

async function openEventStream(baseUrl, cookie) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function readEvent() {
    while (!buffer.includes('\n\n')) {
      const { done, value } = await reader.read();
      if (done) return '';
      buffer += decoder.decode(value, { stream: true });
    }
    const boundary = buffer.indexOf('\n\n');
    const event = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    return event;
  }

  return { controller, readEvent };
}

async function register(baseUrl, username) {
  const result = await request(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { username, password: 'password123' },
  });
  assert.equal(result.status, 201);
  assert.ok(result.cookie);
  return result.cookie;
}

async function login(baseUrl, username, password) {
  const result = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(result.status, 200);
  return result.cookie;
}

async function stopApplication(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await once(child, 'exit');
}

test('不同账号的菜单、设置、订单和统计互相隔离', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'restaurant-isolation-'));
  const app = await startApplication(join(directory, 'restaurant.sqlite'));
  try {
    const cookieA = await register(app.baseUrl, 'merchant-a');
    const addOnResult = await request(app.baseUrl, '/api/add-ons', {
      cookie: cookieA,
      method: 'POST',
      body: { name: '账号A小料', priceCents: 200, active: true },
    });
    assert.equal(addOnResult.status, 201);

    const dishResult = await request(app.baseUrl, '/api/dishes', {
      cookie: cookieA,
      method: 'POST',
      body: {
        group: '账号A品类',
        name: '账号A菜品',
        note: '',
        priceCents: 1000,
        active: true,
        allowedAddOnIds: [addOnResult.payload.id],
      },
    });
    assert.equal(dishResult.status, 201);
    assert.equal((await request(app.baseUrl, '/api/settings', {
      cookie: cookieA,
      method: 'PATCH',
      body: { availableNumbers: [7] },
    })).status, 200);

    const orderResult = await request(app.baseUrl, '/api/orders', {
      cookie: cookieA,
      method: 'POST',
      body: { number: 7, dishId: dishResult.payload.id, addOnIds: [addOnResult.payload.id] },
    });
    assert.equal(orderResult.status, 201);
    assert.equal((await request(app.baseUrl, `/api/orders/${orderResult.payload.id}`, {
      cookie: cookieA,
      method: 'PATCH',
      body: { action: 'complete' },
    })).status, 200);

    const cookieB = await register(app.baseUrl, 'merchant-b');
    const stateB = await request(app.baseUrl, '/api/state', { cookie: cookieB });
    assert.deepEqual(stateB.payload.dishes, []);
    assert.deepEqual(stateB.payload.addOns, []);
    assert.deepEqual(stateB.payload.queue, []);
    assert.equal(stateB.payload.settings.availableNumbers.length, 36);

    const eventsA = await openEventStream(app.baseUrl, cookieA);
    const eventsB = await openEventStream(app.baseUrl, cookieB);
    try {
      await eventsA.readEvent();
      const initialEvent = await eventsB.readEvent();
      assert.doesNotMatch(initialEvent, /账号A菜品/);
      const accountAEvent = eventsA.readEvent();
      const nextEvent = eventsB.readEvent().catch(() => '');
      assert.equal((await request(app.baseUrl, '/api/settings', {
        cookie: cookieA,
        method: 'PATCH',
        body: { sound: false },
      })).status, 200);
      const crossAccountEvent = await Promise.race([
        nextEvent,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 200)),
      ]);
      const sameAccountEvent = await Promise.race([
        accountAEvent,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 1_000)),
      ]);
      assert.match(sameAccountEvent, /"sound":false/);
      assert.equal(crossAccountEvent, 'timeout');
    } finally {
      eventsA.controller.abort();
      eventsB.controller.abort();
    }

    const forbiddenEdit = await request(app.baseUrl, `/api/dishes/${dishResult.payload.id}`, {
      cookie: cookieB,
      method: 'PATCH',
      body: { name: '越权修改' },
    });
    assert.equal(forbiddenEdit.status, 404);

    const stateA = await request(app.baseUrl, '/api/state', { cookie: cookieA });
    assert.equal(stateA.payload.dishes.length, 1);
    assert.equal(stateA.payload.addOns.length, 1);
    assert.deepEqual(stateA.payload.settings.availableNumbers, [7]);

    const now = Date.now();
    const analyticsA = await request(
      app.baseUrl,
      `/api/analytics?from=${encodeURIComponent(new Date(now - 60_000).toISOString())}&to=${encodeURIComponent(new Date(now + 60_000).toISOString())}`,
      { cookie: cookieA },
    );
    const analyticsB = await request(
      app.baseUrl,
      `/api/analytics?from=${encodeURIComponent(new Date(now - 60_000).toISOString())}&to=${encodeURIComponent(new Date(now + 60_000).toISOString())}`,
      { cookie: cookieB },
    );
    assert.equal(analyticsA.payload.summary.orderCount, 1);
    assert.equal(analyticsB.payload.summary.orderCount, 0);
  } finally {
    await stopApplication(app.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('旧版全局业务数据只迁移给 yue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'restaurant-migration-'));
  const databasePath = join(directory, 'restaurant.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL) STRICT;
    CREATE TABLE dishes (
      id TEXT PRIMARY KEY, group_name TEXT NOT NULL, name TEXT NOT NULL, note TEXT NOT NULL,
      price_cents INTEGER NOT NULL, active INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, allowed_add_on_ids_json TEXT
    ) STRICT;
    CREATE TABLE add_ons (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL, active INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE orders (id TEXT PRIMARY KEY, data_json TEXT NOT NULL) STRICT;
    CREATE TABLE order_history (id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, data_json TEXT NOT NULL) STRICT;
  `);
  const timestamp = new Date().toISOString();
  const yuePassword = await createPasswordRecord('123');
  const otherPassword = await createPasswordRecord('password123');
  const insertUser = database.prepare(`
    INSERT INTO users (id, username, username_normalized, password_hash, password_salt, created_at, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  insertUser.run('user-yue', 'yue', 'yue', yuePassword.passwordHash, yuePassword.passwordSalt, timestamp);
  insertUser.run('user-other', 'other', 'other', otherPassword.passwordHash, otherPassword.passwordSalt, timestamp);
  database.prepare('INSERT INTO settings (id, data_json) VALUES (1, ?)')
    .run(JSON.stringify({ sound: true, availableNumbers: [9] }));
  database.prepare(`
    INSERT INTO dishes
      (id, group_name, name, note, price_cents, active, sort_order, created_at, updated_at, allowed_add_on_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('legacy-dish', '旧品类', '旧菜品', '', 1200, 1, 0, timestamp, timestamp, '[]');
  database.close();

  const app = await startApplication(databasePath);
  try {
    const yueCookie = await login(app.baseUrl, 'yue', '123');
    const otherCookie = await login(app.baseUrl, 'other', 'password123');
    const yueState = await request(app.baseUrl, '/api/state', { cookie: yueCookie });
    const otherState = await request(app.baseUrl, '/api/state', { cookie: otherCookie });
    assert.equal(yueState.payload.dishes[0].name, '旧菜品');
    assert.deepEqual(yueState.payload.settings.availableNumbers, [9]);
    assert.deepEqual(otherState.payload.dishes, []);
    assert.equal(otherState.payload.settings.availableNumbers.length, 36);
  } finally {
    await stopApplication(app.child);
    rmSync(directory, { recursive: true, force: true });
  }
});
