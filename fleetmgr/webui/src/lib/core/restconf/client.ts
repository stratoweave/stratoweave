import type { RestconfRequestOptions } from '$lib/core/restconf/proxy-types';

const RESTCONF_BASE = '/api/restconf';
// Async writes return when the transaction commits. A synchronous write waits
// for southbound application, which during a real install takes minutes.
const ASYNC_WRITE_HEADERS = { async: 'true' } as const;

type Fetch = typeof fetch;

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function encodeListKeyPart(value: string): string {
  // Double-encode forward slashes so the SvelteKit catch-all proxy route
  // does not decode them into path separators before forwarding upstream.
  return encodeURIComponent(value.trim()).replace(/%2F/gi, '%252F');
}

async function readResponse<T>(response: Response, readBody = true): Promise<T> {
  if (!response.ok) {
    const message = (await response.text()) || response.statusText;
    throw new Error(`RESTCONF ${response.status}: ${message}`);
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

export async function restconfRequest<T>(
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

/**
 * Send a raw string body with a caller-chosen method + Content-Type.
 * Use this when the body is already serialized (e.g. an XML payload, or
 * a JSON string the caller produced manually) and the JSON helpers
 * would double-encode by `JSON.stringify`'ing it.
 */
export function restconfRaw<T = string>(
  method: 'PUT' | 'PATCH' | 'POST',
  path: string,
  body: string,
  contentType: string,
  readBody = false,
  headers?: HeadersInit,
  signal?: AbortSignal
): Promise<T> {
  return restconfRequest<T>(path, {
    method,
    body,
    headers,
    signal,
    accept: contentType,
    contentType,
    readBody
  });
}

export function restconfDelete(path: string): Promise<unknown> {
  return restconfRequest(path, {
    method: 'DELETE',
    accept: 'application/yang-data+json',
    readBody: false
  });
}

export function encodeListKey(key: string | string[]): string {
  if (Array.isArray(key)) {
    return key.map((part) => encodeListKeyPart(String(part))).join(',');
  }

  return encodeListKeyPart(String(key));
}

export function getListEntryPath(root: string, key: string | string[]): string {
  return `${normalizePath(root)}=${encodeListKey(key)}`;
}

export function getListWrapperKey(restconfRoot: string): string {
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
