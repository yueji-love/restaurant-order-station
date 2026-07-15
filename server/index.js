import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import {
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  createPasswordRecord,
  createSessionCookie,
  createSessionToken,
  hashToken,
  normalizeUsername,
  readCookie,
  verifyPassword,
} from './auth.js';
import { buildAnalytics } from './analytics.js';
import { createId, getDatabase, withTransaction } from './database.js';
import { buildOrderExport } from './order-export.js';
import { RestaurantStore } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const port = Number(process.env.PORT || 5175);
const database = await getDatabase();
const store = new RestaurantStore(database);
const staffClients = new Map();
const publicClients = new Map();
const publicRateLimits = new Map();
const TOKEN_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/;

function nowIso() {
  return new Date().toISOString();
}

function sendEvent(response, event, payload) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastStaff(userId) {
  const nextState = store.state(userId);
  staffClients.forEach((client, response) => {
    if (client.userId !== userId) return;
    try {
      sendEvent(response, 'state', nextState);
    } catch {
      staffClients.delete(response);
    }
  });
}

function broadcastPlate(numberPlateId) {
  publicClients.forEach((client, response) => {
    if (client.numberPlateId !== numberPlateId) return;
    try {
      sendEvent(response, 'changed', { at: nowIso() });
    } catch {
      publicClients.delete(response);
    }
  });
}

function broadcastUserPlates(userId) {
  database.prepare('SELECT id FROM number_plates WHERE user_id = ?').all(userId)
    .forEach((row) => broadcastPlate(row.id));
}

function currentSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = store.findSession(tokenHash);
  if (!session) return null;
  const user = store.findUserById(session.userId);
  return user ? { session, user, tokenHash } : null;
}

function requireAuth(request, response, next) {
  const auth = currentSession(request);
  if (!auth) return response.status(401).json({ message: '请先登录。' });
  request.authUser = auth.user;
  request.authSession = auth.session;
  return next();
}

function issueSession(request, response, user) {
  const { token, tokenHash } = createSessionToken();
  const createdAt = nowIso();
  store.createSession({
    tokenHash,
    userId: user.id,
    createdAt,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
  });
  response.setHeader('Set-Cookie', createSessionCookie(request, token, Math.floor(SESSION_DURATION_MS / 1000)));
}

function closeSessionClients(tokenHash) {
  staffClients.forEach((client, response) => {
    if (client.tokenHash !== tokenHash) return;
    staffClients.delete(response);
    response.end();
  });
}

function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function parseTimeRange(query) {
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  return Number.isFinite(from) && Number.isFinite(to) && from < to ? { from, to } : null;
}

function normalizedPublicToken(value) {
  const token = typeof value === 'string' ? value.toUpperCase() : '';
  return TOKEN_PATTERN.test(token) ? token : '';
}

function checkPublicRateLimit(request, token) {
  const key = `${request.ip}:${token}`;
  const timestamp = Date.now();
  const current = publicRateLimits.get(key);
  if (!current || timestamp - current.startedAt >= 60_000) {
    publicRateLimits.set(key, { startedAt: timestamp, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 120;
}

function publicHeaders(response) {
  response.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
}

function sqliteConflict(response, error, fallbackMessage) {
  if (String(error?.message).includes('UNIQUE constraint failed')) {
    response.status(409).json({ message: fallbackMessage });
    return true;
  }
  return false;
}

function validateCategoryName(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 30
    ? value.trim()
    : '';
}

function validatePrice(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function resolveCategoryId(userId, body) {
  if (typeof body.categoryId === 'string') {
    return database.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(body.categoryId, userId)?.id ?? '';
  }
  const group = validateCategoryName(body.group);
  return group ? database.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, group)?.id ?? '' : '';
}

function validateAllowedAddOns(userId, ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return null;
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const rows = database.prepare(`
    SELECT id FROM add_ons WHERE user_id = ? AND id IN (${uniqueIds.map(() => '?').join(', ')})
  `).all(userId, ...uniqueIds);
  return rows.length === uniqueIds.length ? uniqueIds : null;
}

function replaceDishAddOns(dishId, addOnIds) {
  database.prepare('DELETE FROM dish_add_ons WHERE dish_id = ?').run(dishId);
  const insert = database.prepare('INSERT INTO dish_add_ons (dish_id, add_on_id, sort_order) VALUES (?, ?, ?)');
  addOnIds.forEach((addOnId, sortOrder) => insert.run(dishId, addOnId, sortOrder));
}

function parseDishBody(userId, body, existing = null) {
  const categoryId = body.categoryId === undefined && body.group === undefined
    ? existing?.category_id
    : resolveCategoryId(userId, body);
  const nameValue = body.name === undefined ? existing?.name : body.name;
  const noteValue = body.note === undefined ? existing?.note : body.note;
  const priceCents = body.priceCents === undefined ? existing?.price_cents : body.priceCents;
  const active = body.active === undefined ? Boolean(existing?.active) : body.active;
  const allowedAddOnIds = body.allowedAddOnIds === undefined
    ? database.prepare('SELECT add_on_id FROM dish_add_ons WHERE dish_id = ? ORDER BY sort_order').all(existing?.id ?? '').map((row) => row.add_on_id)
    : validateAllowedAddOns(userId, body.allowedAddOnIds);
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  const note = typeof noteValue === 'string' ? noteValue.trim() : '';
  if (!categoryId || !name || name.length > 60 || note.length > 100 || !validatePrice(priceCents) || typeof active !== 'boolean' || !allowedAddOnIds) return null;
  return { categoryId, name, note, priceCents, active, allowedAddOnIds };
}

function parseAddOnBody(body, existing = null) {
  const nameValue = body.name === undefined ? existing?.name : body.name;
  const priceCents = body.priceCents === undefined ? existing?.price_cents : body.priceCents;
  const active = body.active === undefined ? Boolean(existing?.active) : body.active;
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  if (!name || name.length > 40 || !validatePrice(priceCents) || typeof active !== 'boolean') return null;
  return { name, priceCents, active };
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.get('/api/auth/me', (request, response) => {
  const auth = currentSession(request);
  response.json({ user: auth ? { id: auth.user.id, username: auth.user.username } : null });
});

app.post('/api/auth/register', asyncHandler(async (request, response) => {
  const username = normalizeUsername(request.body?.username);
  const usernameNormalized = username.toLocaleLowerCase('zh-CN');
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (username.length < 3 || username.length > 32) return response.status(400).json({ message: '用户名需为 3 到 32 个字符。' });
  if (password.length < 8 || password.length > 128) return response.status(400).json({ message: '密码需为 8 到 128 个字符。' });
  if (store.findUserByNormalized(usernameNormalized)) return response.status(409).json({ message: '该用户名已被注册。' });
  const passwordRecord = await createPasswordRecord(password);
  try {
    const user = store.createUser({
      id: createId('user'),
      username,
      usernameNormalized,
      ...passwordRecord,
      createdAt: nowIso(),
    });
    issueSession(request, response, user);
    return response.status(201).json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    if (sqliteConflict(response, error, '该用户名已被注册。')) return undefined;
    throw error;
  }
}));

app.post('/api/auth/login', asyncHandler(async (request, response) => {
  const username = normalizeUsername(request.body?.username).toLocaleLowerCase('zh-CN');
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  const user = store.findUserByNormalized(username);
  if (!user || !(await verifyPassword(password, user))) return response.status(401).json({ message: '用户名或密码不正确。' });
  issueSession(request, response, user);
  return response.json({ user: { id: user.id, username: user.username } });
}));

app.post('/api/auth/logout', (request, response) => {
  const token = readCookie(request, SESSION_COOKIE);
  const tokenHash = token ? hashToken(token) : '';
  if (tokenHash) store.deleteSession(tokenHash);
  response.setHeader('Set-Cookie', createSessionCookie(request, '', 0));
  closeSessionClients(tokenHash);
  response.json({ ok: true });
});

app.get('/api/public/plates/:token/progress', (request, response) => {
  const token = normalizedPublicToken(request.params.token);
  publicHeaders(response);
  if (!token || !checkPublicRateLimit(request, token)) return response.status(token ? 429 : 404).json({ message: token ? '请求过于频繁，请稍后再试。' : '号牌不存在。' });
  const progress = store.publicProgress(token);
  return progress ? response.json(progress) : response.status(404).json({ message: '号牌不存在。' });
});

app.get('/api/public/plates/:token/events', (request, response) => {
  const token = normalizedPublicToken(request.params.token);
  const plate = token ? store.plateByToken(token) : null;
  if (!plate) return response.status(404).end();
  publicHeaders(response);
  response.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  response.flushHeaders();
  publicClients.set(response, { numberPlateId: plate.id });
  sendEvent(response, 'changed', { at: nowIso() });
  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    publicClients.delete(response);
  });
});

app.get('/api/public/plates/:token/payment-qr', (request, response) => {
  const token = normalizedPublicToken(request.params.token);
  publicHeaders(response);
  if (!token) return response.status(404).end();
  const image = store.paymentQrForToken(token);
  if (!image?.data || !image.mime) return response.status(404).end();
  response.type(image.mime);
  return response.send(Buffer.from(image.data));
});

app.use('/api', requireAuth);

app.get('/api/state', (request, response) => response.json(store.state(request.authUser.id)));

app.get('/api/events', (request, response) => {
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  response.flushHeaders();
  staffClients.set(response, { tokenHash: request.authSession.tokenHash, userId: request.authUser.id });
  sendEvent(response, 'state', store.state(request.authUser.id));
  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    staffClients.delete(response);
  });
});

app.post('/api/categories', (request, response) => {
  const name = validateCategoryName(request.body?.name);
  if (!name) return response.status(400).json({ message: '大类名称不能为空且不能超过 30 个字符。' });
  const sortOrder = Number(database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories WHERE user_id = ?').get(request.authUser.id).next);
  const timestamp = nowIso();
  const id = createId('category');
  try {
    database.prepare(`
      INSERT INTO categories (id, user_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, request.authUser.id, name, sortOrder, timestamp, timestamp);
  } catch (error) {
    if (sqliteConflict(response, error, '已存在同名大类。')) return undefined;
    throw error;
  }
  broadcastStaff(request.authUser.id);
  return response.status(201).json(store.categories(request.authUser.id).find((item) => item.id === id));
});

app.patch('/api/categories/:id', (request, response) => {
  const name = validateCategoryName(request.body?.name);
  if (!name) return response.status(400).json({ message: '大类名称不能为空且不能超过 30 个字符。' });
  try {
    const result = database.prepare(`
      UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(name, nowIso(), request.params.id, request.authUser.id);
    if (!result.changes) return response.status(404).json({ message: '菜品大类不存在。' });
  } catch (error) {
    if (sqliteConflict(response, error, '已存在同名大类。')) return undefined;
    throw error;
  }
  broadcastStaff(request.authUser.id);
  return response.json(store.categories(request.authUser.id).find((item) => item.id === request.params.id));
});

app.put('/api/categories/order', (request, response) => {
  const ids = request.body?.ids;
  const current = store.categories(request.authUser.id).map((item) => item.id);
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== current.length || current.some((id) => !ids.includes(id))) {
    return response.status(400).json({ message: '大类顺序无效，请刷新后重试。' });
  }
  withTransaction(database, () => ids.forEach((id, sortOrder) => database.prepare(`
    UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?
  `).run(sortOrder, nowIso(), id, request.authUser.id)));
  broadcastStaff(request.authUser.id);
  return response.json({ ok: true });
});

app.post('/api/dishes', (request, response) => {
  const parsed = parseDishBody(request.authUser.id, request.body ?? {});
  if (!parsed) return response.status(400).json({ message: '请检查菜品大类、名称、价格和可选小料。' });
  const id = createId('dish');
  const timestamp = nowIso();
  const sortOrder = Number(database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM dishes WHERE user_id = ?').get(request.authUser.id).next);
  try {
    withTransaction(database, () => {
      database.prepare(`
        INSERT INTO dishes (id, user_id, category_id, name, note, price_cents, active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, request.authUser.id, parsed.categoryId, parsed.name, parsed.note, parsed.priceCents, parsed.active ? 1 : 0, sortOrder, timestamp, timestamp);
      replaceDishAddOns(id, parsed.allowedAddOnIds);
    });
  } catch (error) {
    if (sqliteConflict(response, error, '同一大类中已存在同名菜品。')) return undefined;
    throw error;
  }
  broadcastStaff(request.authUser.id);
  return response.status(201).json(store.dishes(request.authUser.id).find((item) => item.id === id));
});

app.patch('/api/dishes/:id', (request, response) => {
  const existing = database.prepare('SELECT * FROM dishes WHERE id = ? AND user_id = ?').get(request.params.id, request.authUser.id);
  if (!existing) return response.status(404).json({ message: '菜品不存在。' });
  const parsed = parseDishBody(request.authUser.id, request.body ?? {}, existing);
  if (!parsed) return response.status(400).json({ message: '请检查菜品大类、名称、价格和可选小料。' });
  try {
    withTransaction(database, () => {
      database.prepare(`
        UPDATE dishes SET category_id = ?, name = ?, note = ?, price_cents = ?, active = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(parsed.categoryId, parsed.name, parsed.note, parsed.priceCents, parsed.active ? 1 : 0, nowIso(), request.params.id, request.authUser.id);
      replaceDishAddOns(request.params.id, parsed.allowedAddOnIds);
    });
  } catch (error) {
    if (sqliteConflict(response, error, '同一大类中已存在同名菜品。')) return undefined;
    throw error;
  }
  broadcastStaff(request.authUser.id);
  return response.json(store.dishes(request.authUser.id).find((item) => item.id === request.params.id));
});

app.delete('/api/dishes/:id', (request, response) => {
  const result = database.prepare('DELETE FROM dishes WHERE id = ? AND user_id = ?').run(request.params.id, request.authUser.id);
  if (!result.changes) return response.status(404).json({ message: '菜品不存在。' });
  broadcastStaff(request.authUser.id);
  return response.json({ ok: true });
});

app.put('/api/dishes/order', (request, response) => {
  const ids = request.body?.ids;
  const current = store.dishes(request.authUser.id).map((item) => item.id);
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== current.length || current.some((id) => !ids.includes(id))) {
    return response.status(400).json({ message: '菜品顺序无效，请刷新后重试。' });
  }
  withTransaction(database, () => ids.forEach((id, sortOrder) => database.prepare(`
    UPDATE dishes SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?
  `).run(sortOrder, nowIso(), id, request.authUser.id)));
  broadcastStaff(request.authUser.id);
  return response.json({ ok: true });
});

app.post('/api/add-ons', (request, response) => {
  const parsed = parseAddOnBody(request.body ?? {});
  if (!parsed) return response.status(400).json({ message: '请检查小料名称和价格。' });
  const id = createId('addon');
  const timestamp = nowIso();
  const sortOrder = Number(database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM add_ons WHERE user_id = ?').get(request.authUser.id).next);
  try {
    database.prepare(`
      INSERT INTO add_ons (id, user_id, name, price_cents, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, request.authUser.id, parsed.name, parsed.priceCents, parsed.active ? 1 : 0, sortOrder, timestamp, timestamp);
  } catch (error) {
    if (sqliteConflict(response, error, '已存在同名小料。')) return undefined;
    throw error;
  }
  broadcastStaff(request.authUser.id);
  return response.status(201).json(store.addOns(request.authUser.id).find((item) => item.id === id));
});

app.patch('/api/add-ons/:id', (request, response) => {
  const existing = database.prepare('SELECT * FROM add_ons WHERE id = ? AND user_id = ?').get(request.params.id, request.authUser.id);
  if (!existing) return response.status(404).json({ message: '小料不存在。' });
  const parsed = parseAddOnBody(request.body ?? {}, existing);
  if (!parsed) return response.status(400).json({ message: '请检查小料名称和价格。' });
  try {
    database.prepare(`
      UPDATE add_ons SET name = ?, price_cents = ?, active = ?, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(parsed.name, parsed.priceCents, parsed.active ? 1 : 0, nowIso(), request.params.id, request.authUser.id);
  } catch (error) {
    if (sqliteConflict(response, error, '已存在同名小料。')) return undefined;
    throw error;
  }
  broadcastStaff(request.authUser.id);
  return response.json(store.addOns(request.authUser.id).find((item) => item.id === request.params.id));
});

app.delete('/api/add-ons/:id', (request, response) => {
  const result = database.prepare('DELETE FROM add_ons WHERE id = ? AND user_id = ?').run(request.params.id, request.authUser.id);
  if (!result.changes) return response.status(404).json({ message: '小料不存在。' });
  broadcastStaff(request.authUser.id);
  return response.json({ ok: true });
});

app.put('/api/add-ons/order', (request, response) => {
  const ids = request.body?.ids;
  const current = store.addOns(request.authUser.id).map((item) => item.id);
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== current.length || current.some((id) => !ids.includes(id))) {
    return response.status(400).json({ message: '小料顺序无效，请刷新后重试。' });
  }
  withTransaction(database, () => ids.forEach((id, sortOrder) => database.prepare(`
    UPDATE add_ons SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?
  `).run(sortOrder, nowIso(), id, request.authUser.id)));
  broadcastStaff(request.authUser.id);
  return response.json({ ok: true });
});

app.patch('/api/settings', (request, response) => {
  const userId = request.authUser.id;
  if (request.body?.sound !== undefined) {
    database.prepare('UPDATE merchant_settings SET sound_enabled = ? WHERE user_id = ?').run(request.body.sound ? 1 : 0, userId);
  }
  if (request.body?.availableNumbers !== undefined) {
    const numbers = request.body.availableNumbers;
    if (!Array.isArray(numbers) || !numbers.length || numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 999)) {
      return response.status(400).json({ message: '号牌清单无效，请至少保留一个 1 到 999 之间的号码。' });
    }
    const requested = [...new Set(numbers)].sort((a, b) => a - b);
    const current = store.numberPlates(userId);
    const requestedSet = new Set(requested);
    const blocked = current.find((plate) => !requestedSet.has(plate.number) && plate.activeBillId);
    if (blocked) return response.status(409).json({ message: `${blocked.number} 号牌还有未结算账单，不能移除。` });
    withTransaction(database, () => {
      current.filter((plate) => !requestedSet.has(plate.number)).forEach((plate) => {
        database.prepare('DELETE FROM number_plates WHERE id = ? AND user_id = ?').run(plate.id, userId);
      });
      const existingNumbers = new Set(current.map((plate) => plate.number));
      requested.filter((number) => !existingNumbers.has(number)).forEach((number, index) => store.createPlate(userId, number, current.length + index));
      requested.forEach((number, sortOrder) => database.prepare(`
        UPDATE number_plates SET sort_order = ? WHERE user_id = ? AND number = ?
      `).run(sortOrder, userId, number));
    });
  }
  broadcastStaff(userId);
  return response.json(store.state(userId).settings);
});

app.post('/api/settings/payment-qr', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }), (request, response) => {
  if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ message: '请选择 PNG、JPEG 或 WebP 收款码图片。' });
  const mime = request.get('content-type')?.split(';')[0];
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return response.status(415).json({ message: '收款码仅支持 PNG、JPEG 或 WebP。' });
  database.prepare(`
    UPDATE merchant_settings SET payment_qr_blob = ?, payment_qr_mime = ?, payment_qr_updated_at = ? WHERE user_id = ?
  `).run(request.body, mime, nowIso(), request.authUser.id);
  broadcastStaff(request.authUser.id);
  broadcastUserPlates(request.authUser.id);
  return response.json({ ok: true });
});

app.get('/api/settings/payment-qr', (request, response) => {
  const image = store.paymentQrForUser(request.authUser.id);
  if (!image?.data || !image.mime) return response.status(404).end();
  response.set('Cache-Control', 'private, no-store');
  response.type(image.mime);
  return response.send(Buffer.from(image.data));
});

app.delete('/api/settings/payment-qr', (request, response) => {
  database.prepare(`
    UPDATE merchant_settings SET payment_qr_blob = NULL, payment_qr_mime = NULL, payment_qr_updated_at = NULL WHERE user_id = ?
  `).run(request.authUser.id);
  broadcastStaff(request.authUser.id);
  broadcastUserPlates(request.authUser.id);
  return response.json({ ok: true });
});

app.get('/api/number-plates/:id/qr.svg', asyncHandler(async (request, response) => {
  const plate = database.prepare('SELECT * FROM number_plates WHERE id = ? AND user_id = ?').get(request.params.id, request.authUser.id);
  if (!plate) return response.status(404).json({ message: '号牌不存在。' });
  const configuredBase = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  const fallbackBase = `${request.protocol}://${request.get('host')}`;
  const target = `${configuredBase || fallbackBase}/Q/${plate.public_token}`.toUpperCase();
  const svg = await QRCode.toString(target, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: '#000000', light: '#FFFFFFFF' },
  });
  response.set({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="number-plate-${plate.number}.svg"`,
    'Cache-Control': 'private, no-store',
  });
  return response.send(svg);
}));

app.post('/api/number-plates/:id/items', (request, response) => {
  const { dishId, addOnIds = [], quantity = 1 } = request.body ?? {};
  if (typeof dishId !== 'string' || !Array.isArray(addOnIds) || addOnIds.some((id) => typeof id !== 'string') || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return response.status(400).json({ message: '请检查菜品、小料和份数。' });
  }
  const created = store.createBillItem(request.authUser.id, { numberPlateId: request.params.id, dishId, addOnIds, quantity });
  broadcastStaff(request.authUser.id);
  broadcastPlate(created.numberPlateId);
  return response.status(201).json(store.bill(request.authUser.id, created.billId));
});

app.post('/api/number-plates/:id/items/batch', (request, response) => {
  const items = request.body?.items;
  const valid = Array.isArray(items) && items.length >= 1 && items.length <= 50 && items.every((item) => (
    typeof item?.dishId === 'string'
    && Array.isArray(item.addOnIds)
    && item.addOnIds.every((id) => typeof id === 'string')
    && Number.isInteger(item.quantity)
    && item.quantity >= 1
    && item.quantity <= 99
  ));
  if (!valid) return response.status(400).json({ message: '点菜单无效，请检查菜品、小料和份数。' });
  const created = store.createBillItems(request.authUser.id, { numberPlateId: request.params.id, items });
  broadcastStaff(request.authUser.id);
  broadcastPlate(created.numberPlateId);
  return response.status(201).json(store.bill(request.authUser.id, created.billId));
});

app.post('/api/orders', (request, response) => {
  const { number, dishId, addOnIds = [], quantity = 1 } = request.body ?? {};
  const plate = Number.isInteger(number) ? database.prepare(`
    SELECT id FROM number_plates WHERE user_id = ? AND number = ?
  `).get(request.authUser.id, number) : null;
  if (!plate) return response.status(400).json({ message: '订单号牌或菜品无效。' });
  if (typeof dishId !== 'string' || !Array.isArray(addOnIds) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return response.status(400).json({ message: '请检查菜品、小料和份数。' });
  const created = store.createBillItem(request.authUser.id, { numberPlateId: plate.id, dishId, addOnIds, quantity });
  broadcastStaff(request.authUser.id);
  broadcastPlate(created.numberPlateId);
  return response.status(201).json(store.bill(request.authUser.id, created.billId));
});

function handleTaskAction(request, response) {
  const updated = store.updateTask(request.authUser.id, request.params.id, request.body?.action);
  broadcastStaff(request.authUser.id);
  if (updated.numberPlateId) broadcastPlate(updated.numberPlateId);
  return response.json(updated);
}

function handleBatchAction(request, response) {
  let sourceDishId = request.body?.sourceDishId;
  if (!sourceDishId && typeof request.body?.category === 'string') {
    sourceDishId = database.prepare(`
      SELECT source_dish_id FROM bill_items WHERE user_id = ? AND dish_name_snapshot = ? ORDER BY created_at DESC LIMIT 1
    `).get(request.authUser.id, request.body.category)?.source_dish_id;
  }
  if (typeof sourceDishId !== 'string') return response.status(400).json({ message: '请选择要处理的菜品。' });
  const result = store.batchUpdateTasks(request.authUser.id, sourceDishId, request.body?.action);
  broadcastStaff(request.authUser.id);
  result.numberPlateIds.forEach(broadcastPlate);
  return response.json({ updated: result.updated });
}

app.patch('/api/kitchen/tasks/batch', handleBatchAction);
app.patch('/api/orders/batch', handleBatchAction);
app.patch('/api/kitchen/tasks/:id', handleTaskAction);
app.patch('/api/orders/:id', handleTaskAction);

app.get('/api/bills', (request, response) => {
  const status = request.query.status;
  if (!['open', 'settled'].includes(status)) return response.status(400).json({ message: '账单状态无效。' });
  const limit = status === 'settled' ? Math.min(200, Math.max(1, Number(request.query.limit) || 100)) : undefined;
  return response.json({ bills: store.bills(request.authUser.id, { status, limit }) });
});

app.post('/api/bills/:id/settle', (request, response) => {
  const result = store.settleBill(request.authUser.id, request.params.id);
  broadcastStaff(request.authUser.id);
  if (result.numberPlateId) broadcastPlate(result.numberPlateId);
  return response.json({ ...result, bill: store.bill(request.authUser.id, request.params.id) });
});

app.get('/api/analytics', (request, response) => {
  const range = parseTimeRange(request.query);
  if (!range) return response.status(400).json({ message: '请选择有效的统计时间范围。' });
  const bills = store.bills(request.authUser.id, { status: 'settled', ...range });
  return response.json(buildAnalytics(bills, range.from, range.to));
});

app.get('/api/order-exports', (request, response) => {
  const range = parseTimeRange(request.query);
  const format = request.query.format;
  if (!range) return response.status(400).json({ message: '请选择有效的导出时间范围。' });
  if (!['csv', 'json'].includes(format)) return response.status(400).json({ message: '导出格式仅支持 CSV 或 JSON。' });
  const bills = store.bills(request.authUser.id, { status: 'settled', ...range });
  const exported = buildOrderExport({ bills, ...range, format, user: request.authUser });
  response.set({
    'Content-Type': exported.contentType,
    'Content-Disposition': `attachment; filename="${exported.filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Order-Count': String(exported.orderCount),
  });
  return response.send(exported.body);
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = Number(error?.status) || 500;
  response.status(status).json({ message: status === 500 ? '服务器处理失败，请稍后再试。' : error.message });
});

const distDirectory = join(projectRoot, 'dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/.*/, (_request, response) => response.sendFile(join(distDirectory, 'index.html')));
}

export const server = app.listen(port, '0.0.0.0', () => {
  console.log(`餐厅工作台服务已启动: http://0.0.0.0:${port}`);
});

export { app };
