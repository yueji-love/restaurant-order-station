import express from 'express';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const dataDirectory = join(__dirname, 'data');
const storePath = join(dataDirectory, 'store.json');
const temporaryStorePath = `${storePath}.tmp`;
const port = Number(process.env.PORT || 5175);

const initialState = {
  queue: [
    {
      id: 'seed-12',
      number: 12,
      category: '双拼饭',
      extras: ['加辣'],
      status: 'waiting',
      createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    },
    {
      id: 'seed-7',
      number: 7,
      category: '砂锅米线',
      extras: ['不要蒜'],
      status: 'making',
      createdAt: new Date(Date.now() - 7 * 60_000).toISOString(),
    },
  ],
  settings: {
    sortMode: 'time',
    sound: true,
  },
};

mkdirSync(dataDirectory, { recursive: true });

function readState() {
  if (!existsSync(storePath)) return structuredClone(initialState);
  try {
    const stored = JSON.parse(readFileSync(storePath, 'utf8'));
    return {
      queue: Array.isArray(stored.queue) ? stored.queue : [],
      settings: {
        sortMode: stored.settings?.sortMode === 'category' ? 'category' : 'time',
        sound: stored.settings?.sound !== false,
      },
    };
  } catch (error) {
    console.error('无法读取数据文件，将使用初始状态。', error);
    return structuredClone(initialState);
  }
}

let state = readState();
const clients = new Set();

function persistState() {
  writeFileSync(temporaryStorePath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(temporaryStorePath, storePath);
}

function sendState(response) {
  response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

function broadcastState() {
  persistState();
  clients.forEach(sendState);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/state', (_request, response) => {
  response.json(state);
});

app.get('/api/events', (request, response) => {
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  response.flushHeaders();
  clients.add(response);
  sendState(response);

  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
});

app.post('/api/orders', (request, response) => {
  const { number, category, extras = [] } = request.body ?? {};
  if (!Number.isInteger(number) || number < 1 || number > 999 || typeof category !== 'string' || !category.trim()) {
    return response.status(400).json({ message: '订单号码或品类无效。' });
  }

  const order = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    number,
    category: category.trim().slice(0, 40),
    extras: Array.isArray(extras)
      ? extras.filter((item) => typeof item === 'string').map((item) => item.slice(0, 30)).slice(0, 20)
      : [],
    status: 'waiting',
    createdAt: new Date().toISOString(),
  };

  state.queue.push(order);
  broadcastState();
  return response.status(201).json(order);
});

app.patch('/api/orders/:id', (request, response) => {
  const orderIndex = state.queue.findIndex((item) => item.id === request.params.id);
  if (orderIndex === -1) return response.status(404).json({ message: '订单不存在或已完成。' });

  const action = request.body?.action;
  if (action === 'start') {
    state.queue[orderIndex] = { ...state.queue[orderIndex], status: 'making', startedAt: new Date().toISOString() };
  } else if (action === 'complete') {
    state.queue.splice(orderIndex, 1);
  } else {
    return response.status(400).json({ message: '不支持的出餐操作。' });
  }

  broadcastState();
  return response.json({ ok: true });
});

app.patch('/api/settings', (request, response) => {
  const nextSettings = { ...state.settings };
  if (request.body?.sortMode !== undefined) {
    if (!['time', 'category'].includes(request.body.sortMode)) {
      return response.status(400).json({ message: '排序设置无效。' });
    }
    nextSettings.sortMode = request.body.sortMode;
  }
  if (request.body?.sound !== undefined) nextSettings.sound = Boolean(request.body.sound);

  state.settings = nextSettings;
  broadcastState();
  return response.json(state.settings);
});

const distDirectory = join(projectRoot, 'dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/.*/, (_request, response) => response.sendFile(join(distDirectory, 'index.html')));
}

app.listen(port, '0.0.0.0', () => {
  console.log(`餐厅工作台服务已启动: http://0.0.0.0:${port}`);
});
