import { refreshAll } from '$app/navigation';

import { dropReadCache } from '#lib/core/restconf/client.ts';

/** Reload every page load from the server, the cached fleet included. */
export function reload(): Promise<void> {
  dropReadCache();
  return refreshAll();
}
