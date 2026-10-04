/**
 * Optional user-supplied keys. They live in this browser's localStorage and are
 * sent as headers on /api calls so the server uses them instead of its own.
 * The server does not store them.
 */
const KEY = "seg.keys.v1";
export interface Keys { openai?: string; typesafe?: string }

export function getKeys(): Keys {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Keys; } catch { return {}; }
}
export function setKeys(k: Keys) {
  try { localStorage.setItem(KEY, JSON.stringify(k)); } catch { /* private mode */ }
  window.dispatchEvent(new Event("seg-keys"));
}

export function keyHeaders(): Record<string, string> {
  const k = getKeys();
  return { ...(k.openai ? { "x-openai-key": k.openai } : {}), ...(k.typesafe ? { "x-typesafe-key": k.typesafe } : {}) };
}

/** fetch() that adds the user's keys. Use it for every /api call. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(keyHeaders())) headers.set(k, v);
  return fetch(input, { ...init, headers });
}
