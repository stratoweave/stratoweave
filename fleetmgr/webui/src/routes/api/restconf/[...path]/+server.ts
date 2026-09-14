import { proxyRequest } from '$lib/core/restconf/server';

import type { RequestHandler } from './$types';

const handler: RequestHandler = async ({ request, params, url }) => {
  const path = params.path ? `/restconf/${params.path}` : '/restconf';
  return proxyRequest(request, path, url.search);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
