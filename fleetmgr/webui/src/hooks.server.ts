import type { Handle } from '@sveltejs/kit';

import { proxyRequest } from '$lib/core/restconf/server';

// Server-side proxy for the fleetmgr RESTCONF API. The raw (still
// percent-encoded) pathname is forwarded rather than decoded route params,
// so encoded list-key characters (%2F, %2C, %25, ...) reach the upstream API
// intact. Every method on /api/* is forwarded verbatim.
export const handle: Handle = async ({ event, resolve }) => {
  const { request, url } = event;

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return proxyRequest(request, url.pathname.replace(/^\/api/, ''), url.search);
  }

  return resolve(event);
};
