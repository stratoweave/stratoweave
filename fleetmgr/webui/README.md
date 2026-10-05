# fleetmgr web UI

A SvelteKit UI for the fleetmgr contract (see ../README.md): fleet
inventory and software upgrade campaigns over RESTCONF.

It is a static SPA served by the fleetmgr top itself, next to its RESTCONF
API on the same origin, so there is no proxy and no CORS: `just gen-webui`
(from ../) builds it and writes the build into `src/fleetmgr/webui_assets.act`
as embedded assets, which the top serves with an `index.html` fallback for
client-routed pages. That module is committed; the build is byte-deterministic
(see `svelte.config.js`) so it only changes with the UI. Fonts and the logo
are inlined as data URIs because the server sends text bodies only. Writes
send `async: true` so a PATCH returns when the transaction commits instead of
after devices finish applying — a real install takes minutes.

## Run

    # backend, from ../
    just build
    just demo
    # -> http://127.0.0.1:18200/ serves the embedded UI

    # UI development, from ../
    just webui
    # -> http://localhost:3000, /restconf proxied to FLEETMGR_API

Type check: `npm run check`. After UI changes: `just gen-webui`, then
`just build` and commit the regenerated module.

## How it reads and writes

- Creates and updates PATCH `/restconf/data` with module-qualified
  wrappers: `"fleetmgr:fleet"` for inventory (nodes and devices),
  `"software:software"` for campaigns. The backend rejects a PATCH whose
  target does not exist yet, so nothing PATCHes list entries directly.
  RESTCONF PATCH merges: launching a campaign sends only
  `{name, admin-state: run}`.
- Campaign members are a list of `{name}` entries whose names reference
  `/fleetmgr:fleet/device`.
- Pacing is campaign config: `default-schedule` naming a shared
  `maintenance:schedules` entry, `deadline` (seconds since the Unix epoch),
  `target-rate` and `max-rate` (devices per hour, defaults 100 and 500). A
  GET omits leaves left at their default, so the UI fills the defaults in.
  The wizard takes offsets as `30m`, `2h30m` or `1d` and sends seconds.
- Progress is config-false `state` under each campaign, merged into GET
  responses; each `device-status` row also carries `running-release`.
  `state/plan` is the planner's layout: the windows it places devices into
  (`start`/`end` as seconds since the Unix epoch, one `device` entry per
  member with `estimated-start` and `estimated-duration`), plus an `alarm`
  list for what does not fit. Members in no plan window are not actuated;
  the UI lists them as not placed. The plan timeline draws these times on
  the wall clock with a marker for now.
- Polling is two-tier: campaigns up to 600 members get a fresh entry GET
  (~120 B per member) every 1.5 s; everything refreshes from the slow
  snapshot (on open, every 12-30 s, and when `failed` moves). Nothing
  ever polls `GET /restconf/data` — it also hauls the full yang-library.
  Paths into a campaign's oper state (`.../state/total`) currently fail
  upstream, which is why fresh counters cost a whole entry.
- Schedules are the shared `maintenance:schedules` entries: a name, a
  `utc-offset` in minutes and a `window` list keyed by `at`, the local
  time of day a rule opens, with a `duration` and an optional `day`
  leaf-list. Creating one PATCHes the datastore root; saving an existing
  one PUTs the whole entry, because a rule removed in the editor has to
  disappear and a merging PATCH cannot remove a list entry. Removing a
  leaf on its own fails upstream (DELETE on a leaf returns 500), which is
  another reason the editor replaces entries. The schedules page draws a
  week of every schedule's occurrences in the viewer's local clock; the
  occurrences are generated the way the planner generates them, so what
  the calendar shows is the supply of windows a campaign will be placed
  into.
- A device binds to a schedule with the `schedule` leaf on its fleet
  entry. Binding merges, so one PATCH binds any number of devices (1000
  in about a second). Unbinding PUTs each entry back without the leaf,
  one device at a time, since DELETE on a leaf returns 500. Every binding
  write re-plans the campaigns, about half a second with a 1000-member
  campaign, so unbinding many devices takes minutes; leaving the page
  stops it. The leafref is not validated upstream, so the UI offers only
  existing schedules and flags bindings to a missing one.
- Per-device status values: `pending`, `unknown`, `up-to-date`,
  `upgrade-needed`, `in-progress`, `succeeded`, `failed`, `rolled-back`.
  The `succeeded` counter includes `up-to-date`, `failed` includes
  `rolled-back`; `pending`/`unknown` count into nothing, so counters need
  not sum to `total`. Status is not latched — it tracks live device state
  and regresses when a campaign goes back to `plan`.

## Campaigns

Campaigns are the model's own concept and nothing more: created in plan,
launched by merging `{name, admin-state: run}`. The planner fits the members
into the configured windows at the rate the deadline demands, capped at
`max-rate`; the plan is published in plan and in run alike, so the layout
and its alarms are visible before anything is actuated. In run the
controller releases devices a few at a time as their window opens and
completions come in; the estimated starts follow that release schedule, and
the campaign page draws them on a timeline, one cell per device, that takes
the live status as the run passes them. The UI adds no semantics the model
does not carry — anything done here can be done identically over NETCONF or
plain RESTCONF. The one wizard rule beyond the model, a deadline needs a
window, only rejects a campaign the planner would place nothing in. Rate and
ETA are measured since page open, and nothing is latched: status tracks live
device state and regresses when a campaign goes back to plan.

Sharding is internal: device creation places entries on the least-loaded
flotilla node silently, and nothing in the UI shows the placement.
