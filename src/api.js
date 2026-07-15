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

function jsonRequest(path, method, body) {
  return request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export const getCurrentUser = () => request('/api/auth/me');
export const registerUser = (body) => jsonRequest('/api/auth/register', 'POST', body);
export const loginUser = (body) => jsonRequest('/api/auth/login', 'POST', body);
export const logoutUser = () => request('/api/auth/logout', { method: 'POST' });
export const getState = () => request('/api/state');

export function subscribeToState({ onState, onOpen, onError }) {
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => onState(JSON.parse(event.data)));
  events.addEventListener('open', onOpen);
  events.addEventListener('error', onError);
  return () => events.close();
}

export const addBillItem = (numberPlateId, body) => jsonRequest(`/api/number-plates/${encodeURIComponent(numberPlateId)}/items`, 'POST', body);
export const addBillItems = (numberPlateId, items) => jsonRequest(`/api/number-plates/${encodeURIComponent(numberPlateId)}/items/batch`, 'POST', { items });
export const updateKitchenTask = (id, action) => jsonRequest(`/api/kitchen/tasks/${encodeURIComponent(id)}`, 'PATCH', { action });
export const updateKitchenBatch = (sourceDishId, action) => jsonRequest('/api/kitchen/tasks/batch', 'PATCH', { sourceDishId, action });
export const settleBill = (id) => jsonRequest(`/api/bills/${encodeURIComponent(id)}/settle`, 'POST', {});
export const getBills = (status, limit = 100) => request(`/api/bills?status=${encodeURIComponent(status)}&limit=${limit}`);

export const createCategory = (body) => jsonRequest('/api/categories', 'POST', body);
export const updateCategory = (id, body) => jsonRequest(`/api/categories/${encodeURIComponent(id)}`, 'PATCH', body);
export const reorderCategories = (ids) => jsonRequest('/api/categories/order', 'PUT', { ids });

export const createDish = (body) => jsonRequest('/api/dishes', 'POST', body);
export const updateDish = (id, body) => jsonRequest(`/api/dishes/${encodeURIComponent(id)}`, 'PATCH', body);
export const deleteDish = (id) => request(`/api/dishes/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const reorderDishes = (ids) => jsonRequest('/api/dishes/order', 'PUT', { ids });

export const createAddOn = (body) => jsonRequest('/api/add-ons', 'POST', body);
export const updateAddOn = (id, body) => jsonRequest(`/api/add-ons/${encodeURIComponent(id)}`, 'PATCH', body);
export const deleteAddOn = (id) => request(`/api/add-ons/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const reorderAddOns = (ids) => jsonRequest('/api/add-ons/order', 'PUT', { ids });

export const saveSettings = (body) => jsonRequest('/api/settings', 'PATCH', body);

export async function uploadPaymentQr(file) {
  return request('/api/settings/payment-qr', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
}

export const deletePaymentQr = () => request('/api/settings/payment-qr', { method: 'DELETE' });

export function getAnalytics({ from, to }) {
  const query = new URLSearchParams({ from, to });
  return request(`/api/analytics?${query.toString()}`);
}

export async function downloadOrderExport({ from, to, format }) {
  const query = new URLSearchParams({ from, to, format });
  const response = await fetch(`/api/order-exports?${query.toString()}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(payload?.message || `导出失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `orders.${format}`;
  return { filename, blob: await response.blob() };
}

export const getPublicProgress = (token) => request(`/api/public/plates/${encodeURIComponent(token)}/progress`);

export function subscribeToPublicProgress(token, { onChange, onError }) {
  const events = new EventSource(`/api/public/plates/${encodeURIComponent(token)}/events`);
  events.addEventListener('changed', onChange);
  events.addEventListener('error', onError);
  return () => events.close();
}
