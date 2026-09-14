# fleetmgr web UI

A SvelteKit UI for the fleetmgr contract (see ../README.md): fleet
inventory and software upgrade campaigns over RESTCONF.

The backend serves no CORS headers, so the browser never talks to it
directly: `src/hooks.server.ts` proxies `/api/*` to `STRATOWEAVE_API_ORIGIN`,
forwarding the raw percent-encoded path so encoded list keys reach the
backend intact. Writes send `async: true` so a PATCH returns when the
transaction commits instead of after devices finish applying — a real
install takes minutes.

## Run

    # backend, from ../
    just build
    just demo

    # UI
    npm install
    STRATOWEAVE_API_ORIGIN=http://127.0.0.1:18200 npm run dev
    # -> http://localhost:3000
    # or, from ../: just webui

Production build: `npm run build`, then
`STRATOWEAVE_API_ORIGIN=... node build`. Type check: `npm run check`.

## How it reads and writes

- Creates and updates PATCH `/restconf/data` with module-qualified
  wrappers: `"fleetmgr:fleet"` for inventory (nodes and devices),
  `"software:software"` for campaigns. The backend rejects a PATCH whose
  target does not exist yet, so nothing PATCHes list entries directly.
  RESTCONF PATCH merges: launching a campaign sends only
  `{name, admin-state: run}`.
- Campaign members are a list of `{name}` entries whose names reference
  `/fleetmgr:fleet/device`.
- Progress is config-false `state` under each campaign, merged into GET
  responses; each `device-status` row also carries `running-release`.
- Polling is two-tier: campaigns up to 600 members get a fresh entry GET
  (~120 B per member) every 1.5 s; everything refreshes from the slow
  snapshot (on open, every 12-30 s, and when `failed` moves). Nothing
  ever polls `GET /restconf/data` — it also hauls the full yang-library.
  Paths into a campaign's oper state (`.../state/total`) currently fail
  upstream, which is why fresh counters cost a whole entry.
- Per-device status values: `pending`, `unknown`, `up-to-date`,
  `upgrade-needed`, `in-progress`, `succeeded`, `failed`, `rolled-back`.
  The `succeeded` counter includes `up-to-date`, `failed` includes
  `rolled-back`; `pending`/`unknown` count into nothing, so counters need
  not sum to `total`. Status is not latched — it tracks live device state
  and regresses when a campaign goes back to `plan`.

## Campaigns

Campaigns are the model's own concept and nothing more: created in plan,
launched by merging `{name, admin-state: run}`, and run fires all members
at once. The UI adds no semantics the model does not carry — anything done
here can be done identically over NETCONF or plain RESTCONF. Rate and ETA
are measured since page open (the model has no timestamps), and nothing is
latched: status tracks live device state and regresses when a campaign
goes back to plan. Pacing, canaries and windows are proposed model
additions, not UI features.

Sharding is internal: device creation places entries on the least-loaded
flotilla node silently, and nothing in the UI shows the placement.
