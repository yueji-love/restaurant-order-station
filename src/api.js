const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || `请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function getCurrentUser() {
  return request('/api/auth/me');
}

export function registerUser(credentials) {
  return request('/api/auth/register', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(credentials),
  });
}

export function loginUser(credentials) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(credentials),
  });
}

export function logoutUser() {
  return request('/api/auth/logout', { method: 'POST' });
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

export function updateOrdersBatch(category, action) {
  return request('/api/orders/batch', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ category, action }),
  });
}

export function saveSettings(settings) {
  return request('/api/settings', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
}

export function createDish(dish) {
  return request('/api/dishes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(dish),
  });
}

export function updateDish(id, patch) {
  return request(`/api/dishes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function deleteDish(id) {
  return request(`/api/dishes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function createAddOn(addOn) {
  return request('/api/add-ons', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(addOn),
  });
}

export function updateAddOn(id, patch) {
  return request(`/api/add-ons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function deleteAddOn(id) {
  return request(`/api/add-ons/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function subscribeToState({ onState, onOpen, onError }) {
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => onState(JSON.parse(event.data)));
  events.addEventListener('open', onOpen);
  events.addEventListener('error', onError);
  return () => events.close();
}
