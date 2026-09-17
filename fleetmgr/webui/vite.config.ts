import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Dev-mode API proxy: `vite dev` forwards /restconf to a running top
// (`just webui` sets STRATOWEAVE_API_ORIGIN from FLEETMGR_API). The raw,
// still percent-encoded path is forwarded as-is, which RESTCONF list keys
// depend on. The embedded build needs no proxy: the top serves both.
const API_PROXY_TARGET = process.env.STRATOWEAVE_API_ORIGIN ?? 'http://127.0.0.1:18200';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Inline imported assets (the logo SVG, the latin woff2 font subsets of
    // roughly 24 KB each) as data URIs: the embedded asset pipeline can only
    // serve text files.
    assetsInlineLimit: 32768
  },
  server: {
    proxy: { '^/restconf(/|$)': { target: API_PROXY_TARGET } }
  }
});
