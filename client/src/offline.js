import { createStore, get, set, del, entries } from 'idb-keyval';
import { api } from './api.js';

const store = createStore('pos', 'kv');

export const loadCatalog = () => get('catalog', store);

export async function refreshCatalog() {
  const data = await api('/products');
  await set('catalog', data, store);
  return data;
}

// Each unsent sale is its own record (q:<time>:<uuid>) so writes are atomic and order is kept.
export const enqueueSale = (sale) => set(`q:${sale.soldAt}:${sale.clientId}`, sale, store);

async function list(prefix) {
  return (await entries(store)).filter(([k]) => String(k).startsWith(prefix)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
export const pendingCount = async () => (await list('q:')).length;
export const failedSales = () => list('f:');
export const dismissFailed = (key) => del(key, store);

// Receipt numbers are per till (T1-00042) because there is no central counter while offline.
export async function nextReceiptNo(till) {
  const key = `seq:${till}`;
  const n = ((await get(key, store)) || 0) + 1;
  await set(key, n, store);
  return `${till}-${String(n).padStart(5, '0')}`;
}

let running = false;
// Sends queued sales oldest-first. Safe to call repeatedly: the server dedupes on clientId.
// Returns 'ok' | 'offline' | 'auth' | 'busy'.
export async function syncQueue() {
  if (running) return 'busy';
  running = true;
  try {
    for (const [key, sale] of await list('q:')) {
      try {
        await api('/sales', { method: 'POST', body: sale });
        await del(key, store);
      } catch (e) {
        if (e.network || e.status >= 500) return 'offline';
        if (e.status === 401) return 'auth';
        // Permanent rejection (e.g. unknown barcode): park it for a manager instead of blocking the queue.
        await del(key, store);
        await set('f:' + key.slice(2), { sale, error: e.message }, store);
      }
    }
    return 'ok';
  } finally {
    running = false;
  }
}
