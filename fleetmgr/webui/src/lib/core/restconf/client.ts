import type { RestconfRequestOptions } from '$lib/core/restconf/types';

// Same origin: the fleetmgr top serves the UI next to its RESTCONF API, and
// `vite dev` proxies this prefix to a running top.
const RESTCONF_BASE = '/restconf';
// Async writes return when the transaction commits. A synchronous write waits
// for southbound application, which during a real install takes minutes.
const ASYNC_WRITE_HEADERS = { async: 'true' } as const;

type Fetch = typeof fetch;

export class RestconfError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(`RESTCONF ${status}: ${message}`);
    this.status = status;
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function encodeListKey(value: string): string {
  // List keys take exactly the single percent-encoding RFC 8040 prescribes.
  return encodeURIComponent(value.trim());
}

async function readResponse<T>(response: Response, readBody = true): Promise<T> {
  if (!response.ok) {
    throw new RestconfError(response.status, (await response.text()) || response.statusText);
  }

  if (!readBody) {
    return null as T;
  }

  const text = await response.text();
  if (!text) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

async function restconfRequest<T>(
  path: string,
  init: RequestInit & RestconfRequestOptions = {},
  fetchFn: Fetch = fetch
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.accept) {
    headers.set('accept', init.accept);
  } else if (!headers.has('accept')) {
    headers.set('accept', 'application/yang-data+json');
  }

  if (init.contentType) {
    headers.set('content-type', init.contentType);
  }

  const normalized = normalizePath(path);
  const url = normalized.length > 0
    ? `${RESTCONF_BASE}/${normalized}`
    : RESTCONF_BASE;
  const response = await fetchFn(url, {
    ...init,
    headers
  });

  return readResponse<T>(response, init.readBody ?? true);
}

export function restconfGetJson<T>(path: string, fetchFn: Fetch = fetch): Promise<T> {
  return restconfRequest<T>(path, {
    method: 'GET',
    accept: 'application/yang-data+json'
  }, fetchFn);
}

/** A GET whose 404 means "nothing configured yet": null instead of an error. */
export async function restconfGetOrNull<T>(path: string, fetchFn: Fetch = fetch): Promise<T | null> {
  try {
    return await restconfGetJson<T>(path, fetchFn);
  } catch (error) {
    if (error instanceof RestconfError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function restconfPutJson<T>(path: string, body: unknown): Promise<T> {
  return restconfRequest<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: ASYNC_WRITE_HEADERS,
    accept: 'application/yang-data+json',
    contentType: 'application/yang-data+json',
    readBody: false
  });
}

export function restconfPatchJson<T>(path: string, body: unknown): Promise<T> {
  return restconfRequest<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: ASYNC_WRITE_HEADERS,
    accept: 'application/yang-data+json',
    contentType: 'application/yang-data+json',
    readBody: false
  });
}

export function restconfDelete(path: string): Promise<unknown> {
  return restconfRequest(path, {
    method: 'DELETE',
    accept: 'application/yang-data+json',
    readBody: false
  });
}

export function getListEntryPath(root: string, key: string): string {
  return `${normalizePath(root)}=${encodeListKey(key)}`;
}

function getListWrapperKey(restconfRoot: string): string {
  const segments = normalizePath(restconfRoot).replace(/^data\//, '').split('/');
  const last = segments[segments.length - 1];

  if (last.includes(':')) {
    return last;
  }

  for (let i = segments.length - 2; i >= 0; i--) {
    const colon = segments[i].indexOf(':');
    if (colon >= 0) {
      return `${segments[i].substring(0, colon)}:${last}`;
    }
  }

  return last;
}

export function wrapListEntryBody(restconfRoot: string, entry: unknown): Record<string, unknown[]> {
  return { [getListWrapperKey(restconfRoot)]: [entry] };
}

/** Read a list entry, change it and PUT it back whole. This is how a leaf
 * is removed: DELETE on a leaf returns 500 upstream and a PATCH only
 * merges. `edit` gets the entry as read and returns null to leave it be. */
export async function rewriteListEntry(
  root: string,
  key: string,
  edit: (entry: Record<string, unknown>) => Record<string, unknown> | null
): Promise<void> {
  const path = getListEntryPath(root, key);
  const got = await restconfGetJson<Record<string, Record<string, unknown>[]>>(path);
  const entry = got?.[getListWrapperKey(root)]?.[0];
  if (!entry) throw new Error(`${key} no longer exists.`);
  const next = edit(entry);
  if (next !== null) await restconfPutJson(path, wrapListEntryBody(root, next));
}
