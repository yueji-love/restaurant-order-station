import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      PUBLIC_BASE_URL: 'https://t.example',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
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

async function request(baseUrl, path, { cookie, method = 'GET', body, rawBody, contentType } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    response,
  };
}

async function login(baseUrl, username, password) {
  const result = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(result.status, 200);
  assert.ok(result.cookie);
  return result.cookie;
}

async function stopApplication(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await once(child, 'exit');
}

test('空库自动创建 yue 测试账号和指定菜单且重启不覆盖数据', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'restaurant-bootstrap-'));
  const databasePath = join(directory, 'restaurant.sqlite');
  let app = await startApplication(databasePath);
  try {
    const cookie = await login(app.baseUrl, 'yue', '123');
    const state = await request(app.baseUrl, '/api/state', { cookie });
    assert.equal(state.status, 200);
    assert.equal(state.payload.categories.length, 4);
    assert.equal(state.payload.dishes.length, 35);
    assert.equal(state.payload.addOns.length, 24);
    assert.equal(state.payload.numberPlates.length, 40);
    assert.equal(state.payload.openBills.length, 0);
    assert.equal(new Set(state.payload.numberPlates.map((plate) => plate.publicToken)).size, 40);
    assert.ok(state.payload.numberPlates.every((plate) => /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(plate.publicToken)));
    assert.equal((await request(app.baseUrl, '/api/settings', {
      cookie,
      method: 'PATCH',
      body: { sound: false },
    })).status, 200);
  } finally {
    await stopApplication(app.child);
  }

  app = await startApplication(databasePath);
  try {
    const cookie = await login(app.baseUrl, 'yue', '123');
    const state = await request(app.baseUrl, '/api/state', { cookie });
    assert.equal(state.payload.settings.sound, false);
    assert.equal(state.payload.dishes.length, 35);
  } finally {
    await stopApplication(app.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('同一号牌持续加菜、后厨两步制作、顾客进度和结算导出形成完整闭环', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'restaurant-flow-'));
  const app = await startApplication(join(directory, 'restaurant.sqlite'));
  try {
    const cookie = await login(app.baseUrl, 'yue', '123');
    const initial = (await request(app.baseUrl, '/api/state', { cookie })).payload;
    const plate = initial.numberPlates[0];
    const dish = initial.dishes.find((item) => item.allowedAddOnIds.length > 0);
    const otherDish = initial.dishes.find((item) => item.id !== dish.id && item.active);
    const addOnId = dish.allowedAddOnIds[0];
    const addOn = initial.addOns.find((item) => item.id === addOnId);

    const rejectedBatch = await request(app.baseUrl, `/api/number-plates/${initial.numberPlates[1].id}/items/batch`, {
      cookie,
      method: 'POST',
      body: { items: [
        { dishId: dish.id, addOnIds: [], quantity: 1 },
        { dishId: 'dish-not-found', addOnIds: [], quantity: 1 },
      ] },
    });
    assert.equal(rejectedBatch.status, 409);
    const afterRejectedBatch = (await request(app.baseUrl, '/api/state', { cookie })).payload;
    assert.equal(afterRejectedBatch.openBills.length, 0);
    assert.equal(afterRejectedBatch.queue.length, 0);

    const second = await request(app.baseUrl, `/api/number-plates/${plate.id}/items/batch`, {
      cookie,
      method: 'POST',
      body: { items: [
        { dishId: dish.id, addOnIds: [addOn.id], quantity: 2 },
        { dishId: otherDish.id, addOnIds: [], quantity: 1 },
      ] },
    });
    assert.equal(second.status, 201);
    assert.equal(second.payload.items.length, 2);
    assert.equal(second.payload.items[0].status, 'waiting');
    assert.equal(second.payload.totalCents, (dish.priceCents + addOn.priceCents) * 2 + otherDish.priceCents);
    const first = second;

    const activeState = (await request(app.baseUrl, '/api/state', { cookie })).payload;
    const activePlate = activeState.numberPlates.find((item) => item.id === plate.id);
    assert.equal(activePlate.status, 'active');
    assert.equal(activePlate.itemCount, 2);
    assert.equal(activeState.openBills.length, 1);
    assert.equal(activeState.queue.length, 2);

    const publicProgress = await request(app.baseUrl, `/api/public/plates/${plate.publicToken}/progress`);
    assert.equal(publicProgress.status, 200);
    assert.equal(publicProgress.payload.number, plate.number);
    assert.equal(publicProgress.payload.bill.items.length, 2);
    assert.deepEqual(publicProgress.payload.bill.items.map((item) => item.queuePosition), [1, 2]);
    assert.ok(publicProgress.payload.bill.items.every((item) => item.createdAt && !item.startedAt && !item.completedAt));

    const qrResponse = await fetch(`${app.baseUrl}/api/number-plates/${plate.id}/qr.svg`, { headers: { Cookie: cookie } });
    assert.equal(qrResponse.status, 200);
    const qrSvg = await qrResponse.text();
    assert.match(qrSvg, /<svg/);
    assert.match(qrSvg, /#000000/);
    assert.match(qrSvg, />01<\/text>/);
    assert.match(qrSvg, /font-weight="800"/);
    assert.match(qrResponse.headers.get('content-disposition'), /^inline;/);

    const earlySettlement = await request(app.baseUrl, `/api/bills/${first.payload.id}/settle`, { cookie, method: 'POST' });
    assert.equal(earlySettlement.status, 409);

    for (const item of second.payload.items) {
      const started = await request(app.baseUrl, `/api/kitchen/tasks/${item.id}`, {
        cookie,
        method: 'PATCH',
        body: { action: 'start' },
      });
      assert.equal(started.status, 200);
      const completed = await request(app.baseUrl, `/api/kitchen/tasks/${item.id}`, {
        cookie,
        method: 'PATCH',
        body: { action: 'complete' },
      });
      assert.equal(completed.status, 200);
      const thirdClick = await request(app.baseUrl, `/api/kitchen/tasks/${item.id}`, {
        cookie,
        method: 'PATCH',
        body: { action: 'complete' },
      });
      assert.equal(thirdClick.status, 409);
    }
    const completedProgress = await request(app.baseUrl, `/api/public/plates/${plate.publicToken}/progress`);
    assert.ok(completedProgress.payload.bill.items.every((item) => item.startedAt && item.completedAt));

    const category = initial.categories.find((item) => item.id === dish.categoryId);
    assert.equal((await request(app.baseUrl, `/api/categories/${category.id}`, {
      cookie,
      method: 'PATCH',
      body: { name: `${category.name}新` },
    })).status, 200);
    const beforeSettlement = (await request(app.baseUrl, '/api/state', { cookie })).payload.openBills[0];
    assert.equal(beforeSettlement.items[0].dishGroup, category.name);

    const settled = await request(app.baseUrl, `/api/bills/${first.payload.id}/settle`, { cookie, method: 'POST' });
    assert.equal(settled.status, 200);
    assert.equal(settled.payload.bill.status, 'settled');
    const repeated = await request(app.baseUrl, `/api/bills/${first.payload.id}/settle`, { cookie, method: 'POST' });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.payload.alreadySettled, true);

    const emptyProgress = await request(app.baseUrl, `/api/public/plates/${plate.publicToken}/progress`);
    assert.equal(emptyProgress.payload.bill, null);
    const released = (await request(app.baseUrl, '/api/state', { cookie })).payload.numberPlates.find((item) => item.id === plate.id);
    assert.equal(released.status, 'idle');

    const now = Date.now();
    const query = `from=${encodeURIComponent(new Date(now - 60_000).toISOString())}&to=${encodeURIComponent(new Date(now + 60_000).toISOString())}`;
    const analytics = await request(app.baseUrl, `/api/analytics?${query}`, { cookie });
    assert.equal(analytics.payload.summary.orderCount, 1);
    assert.equal(analytics.payload.dishes.reduce((sum, item) => sum + item.count, 0), 3);

    const jsonResponse = await fetch(`${app.baseUrl}/api/order-exports?${query}&format=json`, { headers: { Cookie: cookie } });
    const jsonExport = await jsonResponse.json();
    assert.equal(jsonExport.schemaVersion, 2);
    assert.equal(jsonExport.billCount, 1);
    assert.equal(jsonExport.bills[0].items.length, 2);
    assert.match(jsonExport.bills[0].totalYuan, /^\d+\.\d{2}$/);
    assert.equal(JSON.stringify(jsonExport).includes('CNY'), false);
    assert.equal(JSON.stringify(jsonExport).includes('totalCents'), false);

    const csvResponse = await fetch(`${app.baseUrl}/api/order-exports?${query}&format=csv`, { headers: { Cookie: cookie } });
    const csvBytes = new Uint8Array(await csvResponse.arrayBuffer());
    assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(csvBytes);
    assert.match(csv, /账单总额（元）/);
    assert.doesNotMatch(csv, /CNY|人民币|（分）/);

    const nextBill = await request(app.baseUrl, `/api/number-plates/${plate.id}/items`, {
      cookie,
      method: 'POST',
      body: { dishId: dish.id, addOnIds: [], quantity: 1 },
    });
    assert.equal(nextBill.status, 201);
    assert.notEqual(nextBill.payload.id, first.payload.id);
  } finally {
    await stopApplication(app.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('新注册账号与 yue 的菜单、账单和管理接口严格隔离', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'restaurant-isolation-'));
  const app = await startApplication(join(directory, 'restaurant.sqlite'));
  try {
    const yueCookie = await login(app.baseUrl, 'yue', '123');
    const yueState = (await request(app.baseUrl, '/api/state', { cookie: yueCookie })).payload;
    const registration = await request(app.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { username: 'merchant-b', password: 'password123' },
    });
    assert.equal(registration.status, 201);
    const stateB = (await request(app.baseUrl, '/api/state', { cookie: registration.cookie })).payload;
    assert.deepEqual(stateB.categories, []);
    assert.deepEqual(stateB.dishes, []);
    assert.deepEqual(stateB.addOns, []);
    assert.equal(stateB.numberPlates.length, 36);
    assert.deepEqual(stateB.openBills, []);

    const forbidden = await request(app.baseUrl, `/api/dishes/${yueState.dishes[0].id}`, {
      cookie: registration.cookie,
      method: 'PATCH',
      body: { name: '越权修改' },
    });
    assert.equal(forbidden.status, 404);

    const unauthenticatedState = await request(app.baseUrl, '/api/state');
    assert.equal(unauthenticatedState.status, 401);
    const invalidPublicToken = await request(app.baseUrl, '/api/public/plates/0000000000000000/progress');
    assert.equal(invalidPublicToken.status, 404);
  } finally {
    await stopApplication(app.child);
    rmSync(directory, { recursive: true, force: true });
  }
});
