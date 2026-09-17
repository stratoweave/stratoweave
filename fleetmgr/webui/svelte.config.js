import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Deterministic, content-derived app version: identical sources produce an
// identical build (the embedded-assets module is committed and must not
// change without a UI change), while any UI change produces a new one, so
// SvelteKit's version.json polling makes stale open tabs reload after an
// upgrade instead of failing on hashed chunks the new binary no longer
// serves.
const VERSION_INPUTS = ['src', 'static', 'package.json', 'package-lock.json', 'svelte.config.js', 'vite.config.ts', 'tsconfig.json'];

function contentVersion() {
  const hash = createHash('sha256');
  const walk = (rel) => {
    const abs = fileURLToPath(new URL('./' + rel, import.meta.url));
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(rel + '/' + name);
      return;
    }
    hash.update(rel + '\0');
    hash.update(readFileSync(abs));
    hash.update('\0');
  };
  for (const input of VERSION_INPUTS) walk(input);
  return hash.digest('hex').slice(0, 12);
}

// A static SPA: `just gen-webui` embeds the build into the fleetmgr binary,
// whose HTTP server serves it next to RESTCONF with an index.html fallback
// for client-routed pages.
/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapterStatic({ fallback: 'index.html' }),
    // The default version name is Date.now(), which lands in
    // _app/version.json and in a content-hashed chunk, renaming every hashed
    // file on each rebuild.
    version: { name: contentVersion() }
  }
};

export default config;
