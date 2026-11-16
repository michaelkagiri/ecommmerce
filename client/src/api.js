export const getSession = () => JSON.parse(localStorage.getItem('session') || 'null');
export const setSession = (s) => (s ? localStorage.setItem('session', JSON.stringify(s)) : localStorage.removeItem('session'));

export const fmt = (c) => 'KES ' + (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const toCents = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100) || 0;

// err.network = true when the server could not be reached; err.status = HTTP status otherwise.
export async function api(path, { method = 'GET', body } = {}) {
  const s = getSession();
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('Cannot reach the server');
    e.network = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.issues ? data.issues.join('; ') : data.error || res.statusText);
    e.status = res.status;
    throw e;
  }
  return data;
}
