import { setTimeout as sleep } from 'node:timers/promises';

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
export function siteOrigin(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('--site must be a site origin, e.g. https://game.example.com');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HTTPS is required (except localhost)');
  return url.origin;
}
export function apiClient(site, token) {
  return async (path, { method = 'GET', json, body, headers = {}, retry = false, anonymous = false, timeout = 30000 } = {}) => {
    const attempts = retry ? 3 : 1;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(site + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: {
          Origin: site, 'User-Agent': 'gamehub-cli/0.1.0',
          ...(!anonymous && token ? { Authorization: `Bearer ${token}` } : {}),
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
        }, body: json === undefined ? body : JSON.stringify(json) });
        const data = await res.json().catch(() => { throw new ApiError('Server returned a non-JSON response', res.status); });
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('Invalid JSON response from server', res.status, 'INVALID_RESPONSE');
        if (!res.ok || data.ok === false) throw new ApiError(data.error || `Invalid response (HTTP ${res.status})`, res.status, data.code);
        return data;
      } catch (error) {
        if (i + 1 >= attempts || (error instanceof ApiError && error.status < 500 && error.status !== 429)) throw error;
        await sleep(500 * 2 ** i);
      }
    }
  };
}
