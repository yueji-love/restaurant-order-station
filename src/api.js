const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || `请求失败 (${response.status})`);
  }
  return response.json();
}

export function getState() {
  return request('/api/state');
}

export function createOrder(order) {
  return request('/api/orders', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(order),
  });
}

export function updateOrder(id, action) {
  return request(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action }),
  });
}

export function saveSettings(settings) {
  return request('/api/settings', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
}

export function subscribeToState({ onState, onOpen, onError }) {
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => onState(JSON.parse(event.data)));
  events.addEventListener('open', onOpen);
  events.addEventListener('error', onError);
  return () => events.close();
}
