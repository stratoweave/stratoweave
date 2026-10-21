# fleetmgr web UI

A SvelteKit UI for the fleetmgr contract (see ../README.md): fleet
inventory, software images and software upgrade campaigns over RESTCONF.

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
  The UI paces by a deadline or by a target rate, not both: `target-rate` is
  a floor under the deadline's pace, so pacing by the deadline sets it to 0
  and pacing by the rate removes the deadline. A campaign that has both
  opens paced by the deadline. The wizard sets them at create time and the
  campaign page changes them later. A change PATCHes the leaves; clearing
  the default schedule or the deadline PUTs the entry back without the leaf
  and without `state`, since DELETE on a leaf returns 500. The controller
  keeps the devices it has already released, so a running campaign can be
  edited too. The controller enforces the rates as devices at once (rate ×
  install time / 3600, rounded up, at least one); with a plan, the campaign
  page shows them that way too, from the plan's install estimates.
- Progress is config-false `state` under each campaign, merged into GET
  responses; each `device-status` row also carries `running-release`,
  `stage`, `reason` and the `precheck` and `postcheck` verdicts.
  `state/plan` is the planner's layout: the windows it places devices into
  (`start`/`end` as seconds since the Unix epoch, one `device` entry per
  member with `estimated-start` and `estimated-duration`), plus an `alarm`
  list for what does not fit, with one entry per device that fits no
  window. A released device stays in the window it was released in, with
  `started`, and `finished` once done, instead of `estimated-start`.
  Members in no plan window are not actuated; the UI shows them as one
  count that expands to the device list. The plan timeline draws these
  times on the wall clock with a marker for now.
- The whole-fleet read (`data/fleetmgr:fleet`, 14 MB at 30k devices) is
  cached in the browser for 30 s and shared by the devices, schedules and
  new-campaign pages. A write through the RESTCONF client drops the cache
  and Refresh bypasses it; changes made elsewhere show when it expires.
- The campaigns, schedules and new-campaign pages read the campaigns
  with `content=config` (RFC 8040), which leaves out the published state:
  the device rows and the plan, most of the subtree once a campaign has
  members. The campaigns list adds each campaign's counters and alarm
  lines from small GETs of its state leaves.
- Polling. The campaign page ticks every 1.5 s, one tick at a time and
  none while the tab is hidden. A campaign with up to 600 members gets its
  `state` node (plan and per-device rows, ~150 B per member) every tick; a
  larger one its four counter leaves (`.../state/total` and friends) every
  tick, and its `state` every 12 s, or 6 s after the last one when
  `failed` moved. Every 12 s the page reads the campaign's config with
  `content=config`, which is how a change made elsewhere or a deletion
  shows. Until a campaign has published state, when its state paths 404,
  the page reads the whole entry instead, which is small then. Each read
  is numbered when it starts, and an answer older than what is shown,
  than the page's last write, or for another campaign is dropped. The list
  page GETs the counter leaves of up to six running campaigns every 2 s,
  busy ones first, and reloads the list every 30 s; a polled counter shows
  only while it is newer than the reload. Nothing ever polls
  `GET /restconf/data` — it also hauls the full yang-library.
- Schedules are the shared `maintenance:schedules` entries: a name, a
  `utc-offset` in minutes and a `window` list keyed by `at`, the local
  time of day a rule opens, with a `duration` and an optional `day`
  leaf-list. New names are limited to letters, digits, dots, dashes and
  underscores since they end up in URLs; an existing entry opens and saves
  whatever its name. Creating one PATCHes the datastore root; saving an
  existing one PUTs the whole entry, because a rule removed in the editor
  has to disappear and a merging PATCH cannot remove a list entry.
  Removing a leaf on its own fails upstream (DELETE on a leaf returns
  500), which is another reason the editor replaces entries. The schedules
  page draws a week of every schedule's occurrences in the viewer's local
  clock; the occurrences are generated the way the planner generates them,
  so what the calendar shows is the supply of windows a campaign will be
  placed into. In the editor the calendar edits the rules: drag a window
  to move it, an edge to resize it, or across an empty stretch of a day to
  add one, in quarter-hour steps. A rule has one opening time, so moving
  one window moves all of its weekdays in time; sideways only the dragged
  weekday moves.
- A device binds to a schedule with the `schedule` leaf on its fleet
  entry. Binding merges, so one PATCH binds any number of devices (1000
  in about a second). Unbinding PUTs each entry back without the leaf,
  one device at a time, since DELETE on a leaf returns 500. Every binding
  write re-plans the campaigns, about half a second with a 1000-member
  campaign, so unbinding many devices takes minutes; leaving the page
  stops it. The leafref is not validated upstream, so the UI offers only
  existing schedules and flags bindings to a missing one.
- Images are `stratoweave-images:images/image` entries keyed by `name`,
  with `os`, `version` and a `model` leaf-list. Adding one PATCHes the
  datastore root, which merges into an image of the same name rather than
  fail, so the add reads the image names again first and refuses one that
  exists; saving one PUTs the whole entry, so a model removed in the form
  disappears (DELETE on a leaf returns 500); deleting one DELETEs the
  entry. The form requires `os`, `version` and a model, though the YANG
  does not. A model is added by Enter or by picking a
  suggestion; other text left in the model field blocks the save, so a
  half-typed model is neither lost nor saved. Image files dropped on the
  image pages, or picked with Upload images, open a table with one row per
  file and are added in one PATCH. An IOS XE name
  (`<family>.<version>.SPA.bin`) fills OS and version, in the table and in
  the one-image form until they are typed; the operator picks the models
  or copies them from the newest older image of the same family. Files
  dropped on the one-image form replace it; what was typed there goes to
  the row of the same file name, and with no such row the form asks
  before it is lost. Only the file names are read; nothing is uploaded
  yet.
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
the live status as the run passes them. Below it, each device's run is a
chain of its steps, prepare, pre-check, install, post-check and commit: the
step running now pulses, a failed step is red with a cross, and a rollback
shows as ↺ after it; the device's `reason` says why the run stopped. The UI
adds no semantics the model does not carry —
anything done here can be done identically over NETCONF or plain RESTCONF.
Two rules go beyond the model, in the wizard and on the campaign page: a
newly set deadline must lie ahead, and the pace comes from a deadline or a
target rate, not both. Rate and ETA are measured since page open, and
nothing is latched: status tracks live device state and regresses when a
campaign goes back to plan.

Sharding is internal: device creation places entries on the least-loaded
flotilla node silently, and nothing in the UI shows the placement.
