import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { loadStateFromDatabase, saveStateToDatabase } from './database.js';
import { buildOrderExport } from './order-export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const port = Number(process.env.PORT || 5175);
const defaultAvailableNumbers = Array.from({ length: 36 }, (_, index) => index + 1);

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAvailableNumbers(value) {
  if (!Array.isArray(value)) return [...defaultAvailableNumbers];
  const numbers = [...new Set(value.filter((item) => Number.isInteger(item) && item >= 1 && item <= 999))]
    .sort((a, b) => a - b);
  return numbers.length ? numbers : [...defaultAvailableNumbers];
}

function normalizeDishes(value, defaultAddOnIds = []) {
  const source = Array.isArray(value) ? value : [];
  return source
    .filter((item) => item && typeof item.name === 'string' && item.name.trim())
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `dish-imported-${index + 1}`,
      group: typeof item.group === 'string' && item.group.trim() ? item.group.trim().slice(0, 30) : '未分类',
      name: item.name.trim().slice(0, 60),
      note: typeof item.note === 'string' ? item.note.trim().slice(0, 100) : '',
      priceCents: Number.isInteger(item.priceCents) && item.priceCents >= 0 ? item.priceCents : 0,
      active: item.active !== false,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso(),
      allowedAddOnIds: Array.isArray(item.allowedAddOnIds)
        ? [...new Set(item.allowedAddOnIds.filter((id) => typeof id === 'string'))]
        : [...defaultAddOnIds],
    }));
}

function normalizeAddOns(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .filter((item) => item && typeof item.name === 'string' && item.name.trim())
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `addon-imported-${index + 1}`,
      name: item.name.trim().slice(0, 40),
      priceCents: Number.isInteger(item.priceCents) && item.priceCents >= 0 ? item.priceCents : 0,
      active: item.active !== false,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso(),
    }));
}

function createWorkspace(source = {}) {
  const addOns = normalizeAddOns(source.addOns);
  return {
    queue: Array.isArray(source.queue) ? source.queue : [],
    dishes: normalizeDishes(source.dishes, addOns.map((item) => item.id)),
    addOns,
    settings: {
      sortMode: source.settings?.sortMode === 'category' ? 'category' : 'time',
      sound: source.settings?.sound !== false,
      availableNumbers: normalizeAvailableNumbers(source.settings?.availableNumbers),
    },
    history: Array.isArray(source.history) ? source.history : [],
  };
}

const initialState = {
  users: [],
  sessions: [],
  workspaces: {},
};

function readState() {
  const stored = loadStateFromDatabase();
  if (!stored) return structuredClone(initialState);
  try {
    const users = Array.isArray(stored.users) ? stored.users : [];
    return {
      users,
      sessions: Array.isArray(stored.sessions)
        ? stored.sessions.filter((item) => Date.parse(item.expiresAt) > Date.now())
        : [],
      workspaces: Object.fromEntries(users.map((user) => [
        user.id,
        createWorkspace(stored.workspaces?.[user.id]),
      ])),
    };
  } catch (error) {
    console.error('无法读取数据库，将使用初始状态。', error);
    return structuredClone(initialState);
  }
}

let state = readState();
const clients = new Map();

function workspaceForUser(userId) {
  if (!state.workspaces[userId]) state.workspaces[userId] = createWorkspace();
  return state.workspaces[userId];
}

function publicState(workspace) {
  return {
    queue: workspace.queue,
    dishes: workspace.dishes,
    addOns: workspace.addOns,
    settings: workspace.settings,
  };
}

function persistState() {
  saveStateToDatabase(state);
}

function sendState(response, userId) {
  response.write(`event: state\ndata: ${JSON.stringify(publicState(workspaceForUser(userId)))}\n\n`);
}

function broadcastState(userId) {
  persistState();
  clients.forEach((client, response) => {
    const sessionIsValid = state.sessions.some((session) => (
      session.tokenHash === client.tokenHash && Date.parse(session.expiresAt) > Date.now()
    ));
    if (!sessionIsValid) {
      clients.delete(response);
      response.end();
      return;
    }
    if (client.userId === userId) sendState(response, userId);
  });
}

function sanitizeUser(user) {
  return user ? { id: user.id, username: user.username, createdAt: user.createdAt } : null;
}

function currentSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = state.sessions.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) > Date.now());
  if (!session) return null;
  const user = state.users.find((item) => item.id === session.userId);
  return user ? { session, user, tokenHash } : null;
}

function requireAuth(request, response, next) {
  const auth = currentSession(request);
  if (!auth) return response.status(401).json({ message: '请先登录。' });
  request.authUser = auth.user;
  request.authSession = auth.session;
  request.workspace = workspaceForUser(auth.user.id);
  return next();
}

function issueSession(request, response, user) {
  const { token, tokenHash } = createSessionToken();
  const createdAt = nowIso();
  state.sessions.push({
    id: createId('session'),
    userId: user.id,
    tokenHash,
    createdAt,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
  });
  response.setHeader('Set-Cookie', createSessionCookie(request, token, Math.floor(SESSION_DURATION_MS / 1000)));
}

function closeSessionClients(tokenHashToClose) {
  clients.forEach((client, response) => {
    if (client.tokenHash !== tokenHashToClose) return;
    clients.delete(response);
    response.end();
  });
}

function archiveOrder(workspace, order) {
  const completedOrder = { ...order, status: 'completed', completedAt: nowIso() };
  workspace.history.unshift(completedOrder);
  return completedOrder;
}

function parseDish(workspace, body, existing = {}) {
  const group = body.group === undefined ? existing.group : body.group;
  const name = body.name === undefined ? existing.name : body.name;
  const note = body.note === undefined ? existing.note : body.note;
  const priceCents = body.priceCents === undefined ? existing.priceCents : body.priceCents;
  const active = body.active === undefined ? existing.active : body.active;
  const allowedAddOnIds = body.allowedAddOnIds === undefined ? existing.allowedAddOnIds ?? [] : body.allowedAddOnIds;
  if (typeof group !== 'string' || !group.trim() || group.trim().length > 30) return null;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return null;
  if (typeof note !== 'string' || note.trim().length > 100) return null;
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 1_000_000) return null;
  if (typeof active !== 'boolean') return null;
  if (!Array.isArray(allowedAddOnIds) || allowedAddOnIds.some((id) => typeof id !== 'string')) return null;
  const uniqueAddOnIds = [...new Set(allowedAddOnIds)];
  if (uniqueAddOnIds.some((id) => !workspace.addOns.some((item) => item.id === id))) return null;
  return {
    ...existing,
    group: group.trim(),
    name: name.trim(),
    note: note.trim(),
    priceCents,
    active,
    allowedAddOnIds: uniqueAddOnIds,
    updatedAt: nowIso(),
  };
}

function parseAddOn(body, existing = {}) {
  const name = body.name === undefined ? existing.name : body.name;
  const priceCents = body.priceCents === undefined ? existing.priceCents : body.priceCents;
  const active = body.active === undefined ? existing.active : body.active;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) return null;
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 1_000_000) return null;
  if (typeof active !== 'boolean') return null;
  return { ...existing, name: name.trim(), priceCents, active, updatedAt: nowIso() };
}

function reorderItems(items, ids) {
  if (!Array.isArray(ids) || ids.length !== items.length || ids.some((id) => typeof id !== 'string')) return null;
  const requestedIds = new Set(ids);
  if (requestedIds.size !== items.length || items.some((item) => !requestedIds.has(item.id))) return null;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => itemsById.get(id));
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/api/auth/me', (request, response) => {
  const auth = currentSession(request);
  return response.json({ user: auth ? sanitizeUser(auth.user) : null });
});

app.post('/api/auth/register', async (request, response) => {
  const username = normalizeUsername(request.body?.username);
  const password = request.body?.password;
  if (username.length < 3 || username.length > 32) {
    return response.status(400).json({ message: '用户名需为 3 到 32 个字符。' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return response.status(400).json({ message: '密码需为 8 到 128 个字符。' });
  }
  const usernameNormalized = username.toLocaleLowerCase('zh-CN');
  if (state.users.some((item) => item.usernameNormalized === usernameNormalized)) {
    return response.status(409).json({ message: '该用户名已注册。' });
  }
  const passwordRecord = await createPasswordRecord(password);
  const user = {
    id: createId('user'),
    username,
    usernameNormalized,
    ...passwordRecord,
    createdAt: nowIso(),
  };
  state.users.push(user);
  state.workspaces[user.id] = createWorkspace();
  issueSession(request, response, user);
  persistState();
  return response.status(201).json({ user: sanitizeUser(user) });
});

app.post('/api/auth/login', async (request, response) => {
  const username = normalizeUsername(request.body?.username);
  const password = request.body?.password;
  const usernameNormalized = username.toLocaleLowerCase('zh-CN');
  const user = state.users.find((item) => item.usernameNormalized === usernameNormalized);
  if (!user || typeof password !== 'string' || !(await verifyPassword(password, user))) {
    return response.status(401).json({ message: '用户名或密码不正确。' });
  }
  workspaceForUser(user.id);
  issueSession(request, response, user);
  persistState();
  return response.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/logout', (request, response) => {
  const token = readCookie(request, SESSION_COOKIE);
  const tokenHashToClose = token ? hashToken(token) : '';
  if (tokenHashToClose) state.sessions = state.sessions.filter((item) => item.tokenHash !== tokenHashToClose);
  response.setHeader('Set-Cookie', createSessionCookie(request, '', 0));
  persistState();
  closeSessionClients(tokenHashToClose);
  return response.json({ ok: true });
});

app.use('/api', requireAuth);

app.get('/api/state', (request, response) => {
  response.json(publicState(request.workspace));
});

app.get('/api/events', (request, response) => {
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  response.flushHeaders();
  clients.set(response, {
    tokenHash: request.authSession.tokenHash,
    userId: request.authUser.id,
  });
  sendState(response, request.authUser.id);

  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
});

app.get('/api/analytics', (request, response) => {
  const from = Date.parse(request.query.from);
  const to = Date.parse(request.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return response.status(400).json({ message: '请选择有效的统计时间范围。' });
  }
  return response.json(buildAnalytics(request.workspace.history, from, to));
});

app.get('/api/order-exports', (request, response) => {
  const from = Date.parse(request.query.from);
  const to = Date.parse(request.query.to);
  const format = request.query.format;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return response.status(400).json({ message: '请选择有效的导出时间范围。' });
  }
  if (!['csv', 'json'].includes(format)) {
    return response.status(400).json({ message: '导出格式仅支持 CSV 或 JSON。' });
  }
  const exported = buildOrderExport({
    history: request.workspace.history,
    from,
    to,
    format,
    user: request.authUser,
  });
  response.set({
    'Content-Type': exported.contentType,
    'Content-Disposition': `attachment; filename="${exported.filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Order-Count': String(exported.orderCount),
  });
  return response.send(exported.body);
});

app.post('/api/orders', (request, response) => {
  const workspace = request.workspace;
  const { number, dishId, addOnIds = [], quantity = 1 } = request.body ?? {};
  if (!Number.isInteger(number) || number < 1 || number > 999 || typeof dishId !== 'string') {
    return response.status(400).json({ message: '订单号码或菜品无效。' });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return response.status(400).json({ message: '菜品份数需为 1 到 99 之间的整数。' });
  }
  if (!workspace.settings.availableNumbers.includes(number)) {
    return response.status(409).json({ message: `${number}号牌未启用，请在设置中添加后再下单。` });
  }
  if (workspace.queue.some((item) => item.number === number)) {
    return response.status(409).json({ message: `${number}号正在使用中，请选择其他号码。` });
  }
  const dish = workspace.dishes.find((item) => item.id === dishId && item.active);
  if (!dish) return response.status(409).json({ message: '该菜品已停用或删除，请重新选择。' });
  if (!Array.isArray(addOnIds) || addOnIds.some((item) => typeof item !== 'string')) {
    return response.status(400).json({ message: '加料数据无效。' });
  }
  const uniqueAddOnIds = [...new Set(addOnIds)];
  const selectedAddOns = uniqueAddOnIds.map((id) => workspace.addOns.find((item) => item.id === id && item.active));
  if (selectedAddOns.some((item) => !item)) {
    return response.status(409).json({ message: '部分加料已停用或删除，请重新选择。' });
  }
  if (uniqueAddOnIds.some((id) => !dish.allowedAddOnIds.includes(id))) {
    return response.status(409).json({ message: '所选小料不适用于该菜品，请重新选择。' });
  }

  const unitTotalCents = dish.priceCents
    + selectedAddOns.reduce((sum, item) => sum + item.priceCents, 0);

  const order = {
    id: createId('order'),
    number,
    dishId: dish.id,
    category: dish.name,
    dishGroup: dish.group,
    priceCents: dish.priceCents,
    quantity,
    addOns: selectedAddOns.map((item) => ({ id: item.id, name: item.name, priceCents: item.priceCents })),
    extras: selectedAddOns.map((item) => item.name),
    totalCents: unitTotalCents * quantity,
    status: 'waiting',
    createdAt: nowIso(),
  };

  workspace.queue.push(order);
  broadcastState(request.authUser.id);
  return response.status(201).json(order);
});

app.patch('/api/orders/batch', (request, response) => {
  const workspace = request.workspace;
  const { category, action } = request.body ?? {};
  if (typeof category !== 'string' || !category.trim()) {
    return response.status(400).json({ message: '请选择要批量处理的品类。' });
  }

  let updated = 0;
  if (action === 'start') {
    workspace.queue = workspace.queue.map((item) => {
      if (item.category !== category || item.status !== 'waiting') return item;
      updated += 1;
      return { ...item, status: 'making', startedAt: nowIso() };
    });
  } else if (action === 'complete') {
    workspace.queue = workspace.queue.filter((item) => {
      const shouldComplete = item.category === category && item.status === 'making';
      if (shouldComplete) {
        updated += 1;
        archiveOrder(workspace, item);
      }
      return !shouldComplete;
    });
  } else {
    return response.status(400).json({ message: '不支持的批量出餐操作。' });
  }

  if (updated > 0) broadcastState(request.authUser.id);
  return response.json({ updated });
});

app.patch('/api/orders/:id', (request, response) => {
  const workspace = request.workspace;
  const orderIndex = workspace.queue.findIndex((item) => item.id === request.params.id);
  if (orderIndex === -1) return response.status(404).json({ message: '订单不存在或已完成。' });

  const action = request.body?.action;
  if (action === 'start') {
    workspace.queue[orderIndex] = { ...workspace.queue[orderIndex], status: 'making', startedAt: nowIso() };
  } else if (action === 'complete') {
    const [completedOrder] = workspace.queue.splice(orderIndex, 1);
    archiveOrder(workspace, completedOrder);
  } else {
    return response.status(400).json({ message: '不支持的出餐操作。' });
  }

  broadcastState(request.authUser.id);
  return response.json({ ok: true });
});

app.post('/api/dishes', (request, response) => {
  const workspace = request.workspace;
  const dish = parseDish(workspace, request.body, { active: true });
  if (!dish) return response.status(400).json({ message: '请检查菜品名称、分组和价格。' });
  const duplicate = workspace.dishes.some((item) => item.group === dish.group && item.name === dish.name);
  if (duplicate) return response.status(409).json({ message: '同一分组中已存在同名菜品。' });
  const created = { ...dish, id: createId('dish'), createdAt: nowIso() };
  workspace.dishes.push(created);
  broadcastState(request.authUser.id);
  return response.status(201).json(created);
});

app.put('/api/dishes/order', (request, response) => {
  const workspace = request.workspace;
  const reordered = reorderItems(workspace.dishes, request.body?.ids);
  if (!reordered) return response.status(400).json({ message: '菜品顺序无效，请刷新后重试。' });
  workspace.dishes = reordered;
  broadcastState(request.authUser.id);
  return response.json({ ok: true });
});

app.patch('/api/dishes/:id', (request, response) => {
  const workspace = request.workspace;
  const index = workspace.dishes.findIndex((item) => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ message: '菜品不存在。' });
  const dish = parseDish(workspace, request.body, workspace.dishes[index]);
  if (!dish) return response.status(400).json({ message: '请检查菜品名称、分组和价格。' });
  const duplicate = workspace.dishes.some((item, itemIndex) => itemIndex !== index && item.group === dish.group && item.name === dish.name);
  if (duplicate) return response.status(409).json({ message: '同一分组中已存在同名菜品。' });
  workspace.dishes[index] = dish;
  broadcastState(request.authUser.id);
  return response.json(dish);
});

app.delete('/api/dishes/:id', (request, response) => {
  const workspace = request.workspace;
  const index = workspace.dishes.findIndex((item) => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ message: '菜品不存在。' });
  workspace.dishes.splice(index, 1);
  broadcastState(request.authUser.id);
  return response.json({ ok: true });
});

app.post('/api/add-ons', (request, response) => {
  const workspace = request.workspace;
  const addOn = parseAddOn(request.body, { active: true });
  if (!addOn) return response.status(400).json({ message: '请检查加料名称和价格。' });
  if (workspace.addOns.some((item) => item.name === addOn.name)) {
    return response.status(409).json({ message: '已存在同名加料。' });
  }
  const created = { ...addOn, id: createId('addon'), createdAt: nowIso() };
  workspace.addOns.push(created);
  broadcastState(request.authUser.id);
  return response.status(201).json(created);
});

app.put('/api/add-ons/order', (request, response) => {
  const workspace = request.workspace;
  const reordered = reorderItems(workspace.addOns, request.body?.ids);
  if (!reordered) return response.status(400).json({ message: '小料顺序无效，请刷新后重试。' });
  workspace.addOns = reordered;
  broadcastState(request.authUser.id);
  return response.json({ ok: true });
});

app.patch('/api/add-ons/:id', (request, response) => {
  const workspace = request.workspace;
  const index = workspace.addOns.findIndex((item) => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ message: '加料不存在。' });
  const addOn = parseAddOn(request.body, workspace.addOns[index]);
  if (!addOn) return response.status(400).json({ message: '请检查加料名称和价格。' });
  const duplicate = workspace.addOns.some((item, itemIndex) => itemIndex !== index && item.name === addOn.name);
  if (duplicate) return response.status(409).json({ message: '已存在同名加料。' });
  workspace.addOns[index] = addOn;
  broadcastState(request.authUser.id);
  return response.json(addOn);
});

app.delete('/api/add-ons/:id', (request, response) => {
  const workspace = request.workspace;
  const index = workspace.addOns.findIndex((item) => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ message: '加料不存在。' });
  const [removed] = workspace.addOns.splice(index, 1);
  workspace.dishes = workspace.dishes.map((dish) => ({
    ...dish,
    allowedAddOnIds: dish.allowedAddOnIds.filter((id) => id !== removed.id),
    updatedAt: nowIso(),
  }));
  broadcastState(request.authUser.id);
  return response.json({ ok: true });
});

app.patch('/api/settings', (request, response) => {
  const workspace = request.workspace;
  const nextSettings = { ...workspace.settings };
  if (request.body?.sortMode !== undefined) {
    if (!['time', 'category'].includes(request.body.sortMode)) {
      return response.status(400).json({ message: '排序设置无效。' });
    }
    nextSettings.sortMode = request.body.sortMode;
  }
  if (request.body?.sound !== undefined) nextSettings.sound = Boolean(request.body.sound);
  if (request.body?.availableNumbers !== undefined) {
    const availableNumbers = request.body.availableNumbers;
    const hasInvalidNumber = !Array.isArray(availableNumbers)
      || availableNumbers.some((item) => !Number.isInteger(item) || item < 1 || item > 999);
    if (hasInvalidNumber || availableNumbers.length === 0) {
      return response.status(400).json({ message: '号牌清单无效，请至少保留一个 1 到 999 之间的号码。' });
    }
    nextSettings.availableNumbers = [...new Set(availableNumbers)].sort((a, b) => a - b);
  }

  workspace.settings = nextSettings;
  broadcastState(request.authUser.id);
  return response.json(workspace.settings);
});

const distDirectory = join(projectRoot, 'dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/.*/, (_request, response) => response.sendFile(join(distDirectory, 'index.html')));
}

app.listen(port, '0.0.0.0', () => {
  console.log(`餐厅工作台服务已启动: http://0.0.0.0:${port}`);
});
