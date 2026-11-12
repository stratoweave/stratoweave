# fleetmgr web UI

A SvelteKit UI for the fleetmgr contract (see ../README.md): fleet
inventory, software images and software upgrade campaigns over RESTCONF.

It is a static SPA served by the fleetmgr top itself, next to its RESTCONF
API on the same origin, so there is no proxy and no CORS: `just gen-webui`
(from ../) builds it and writes the build into `src/fleetmgr/webui_assets.act`
as embedded assets, which the top serves with an `index.html` fallback for
client-routed pages. That module is committed; the build is byte-deterministic
(see `vite.config.ts`) so it only changes with the UI. Fonts and the logo
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
    # -> http://localhost:3000, /restconf, the image folder routes and /layer proxied to FLEETMGR_API

Type check: `npm run check`. After UI changes: `just gen-webui`, then
`just build` and commit the regenerated module.

## How it reads and writes

- Creates and updates PATCH `/restconf/data` with module-qualified
  wrappers: `"fleetmgr:fleet"` for inventory (devices),
  `"software:software"` for campaigns. The backend rejects a PATCH whose
  target does not exist yet, so nothing PATCHes list entries directly.
  RESTCONF PATCH merges: launching a campaign sends only
  `{name, admin-state: run}`.
- Campaign members are a list of `{name, image}` entries: the name
  references `/fleetmgr:fleet/device`, the image names an entry of the
  image list. A new campaign takes three steps. Devices: the selection
  filters on type, model, version, name, address, description and
  schedule, or starts from pasted names; devices another campaign has are
  left out. Back keeps the filters. Images: one row per
  model in the selection, offering the images that list the model; the
  family default is preselected when exactly one default image lists the
  model. Devices that have not reported a model are left out, and a model
  no image lists blocks the create. Plan: Create sends one PATCH with
  `admin-state: plan` and opens the campaign page, which shows the plan
  and sets schedule and pace.
- The image list's `url-base`, set on the images page, is where devices
  fetch images from: url-base followed by the image name.
- Each fleet device entry carries config-false `state/platform`: `os`,
  `version`, `model` and `serial-number` as the device reports them, absent
  until it has connected. The devices list shows them and filters by model.
- Pacing is campaign config: `default-schedule` naming a shared
  `maintenance:schedules` entry, `deadline` (seconds since the Unix epoch),
  `target-concurrency` and `max-concurrency` (devices upgrading at the same
  time, defaults 10 and 50). A GET omits leaves left at their default, so
  the UI fills the defaults in. The UI paces by a deadline or by a number
  of devices at once, not both: `target-concurrency` is a floor under the
  deadline's pace, so pacing by the deadline sets it to 1, the slowest
  pace, and pacing by concurrency removes the deadline. A campaign that
  has a deadline opens paced by it. The campaign page sets them. A change PATCHes the leaves;
  clearing the default schedule or the deadline PUTs the entry back
  without the leaf and without `state`, since DELETE on a leaf returns
  500. The controller keeps the devices it has already released, so a
  running campaign can be edited too. With a plan, the campaign page also
  shows the devices at once as devices per hour, from the plan's install
  estimates.
- Progress is config-false `state` under each campaign, merged into GET
  responses; each `device-status` row also carries `version`, `model`,
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
- Reads of the fleet and of the campaigns ask with the RFC 8040 `fields`
  parameter for only what the page shows; `src/lib/software/model.ts` has
  one constant per selection. The fleet list (`data/fleetmgr:fleet`
  without credentials, mock settings or any device state but the
  platform, 14 MB at 100k devices) is cached in the browser for 30 s and
  shared by the devices, groups and new-campaign pages and the search. A
  write through the RESTCONF client drops the cache and Refresh bypasses
  it; changes made elsewhere show when it expires.
- The campaigns, schedules, groups and new-campaign pages read the
  campaigns with `content=config` (RFC 8040), which leaves out the
  published state: the device rows and the plan, most of the subtree once
  a campaign has members. The campaigns list adds each campaign's counters
  and alarm lines from one GET of its `state` with `fields`, which costs
  the server the same as a leaf GET at any campaign size.
- Polling. The campaign page ticks every 1.5 s, one tick at a time and
  none while the tab is hidden. A campaign with up to 600 members gets its
  `state` node (plan and per-device rows, ~150 B per member) every tick; a
  larger one its counters (`.../state?fields=total;in-progress;...`) every
  tick, and its `state` every 12 s, or 6 s after the last one when
  `failed` moved. Every 12 s the page reads the campaign's config with
  `content=config`, which is how a change made elsewhere or a deletion
  shows. Until a campaign has published state, when its state paths 404,
  the page reads the whole entry instead, which is small then. Each read
  is numbered when it starts, and an answer older than what is shown,
  than the page's last write, or for another campaign is dropped. The list
  page GETs the counters of up to six running campaigns every 2 s,
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
  which campaign members name, with `file`, the path of the image's file in
  the top's image folder (`--software.image-dir`), such as
  `iosxe/17.18/c8000v-universalk9.17.18.03a.SPA.bin`, the name when absent;
  each has `os`, `version` and a `model` leaf-list. Adding one PATCHes the
  datastore root, which merges into an image of the same name rather than
  fail, so the add reads the image names again first and refuses one that
  exists; saving one PUTs the whole entry, so a model removed in the form
  disappears (DELETE on a leaf returns 500); deleting one, from its row in
  the list or on its page, DELETEs the entry and then its file at
  `/image-file/{file}`, where a 404 counts as removed. The form requires
  `os`, `version` and a model, though the YANG does not. A model is added
  by Enter or by picking a suggestion; other text left in the model field
  blocks the save, so a half-typed model is neither lost nor saved.
- An image also has a `family` and a `default` flag. A family has at most
  one default; the YANG says so, but the server does not check it yet, so
  the UI keeps it. Ticking Default in the form takes the default over
  from the family's current one: an add clears it in the same PATCH, an
  edit PATCHes it clear first and then PUTs the entry.
- Image files dropped on the image pages, or picked with Upload images,
  open a table with one row per file. An IOS XE name
  (`<family>.<version>.SPA.bin`) fills OS, version and family, in the
  table and in the one-image form until they are typed; the operator picks the models
  or copies them from the newest older image of the same family. Upload
  sends the files one at a time, each in one PUT to `/image-file/{name}`,
  which stores it in the top's image folder (`--software.image-dir`), and
  then PATCHes that file's entry. A row can be the default of its family
  (the Default column): ticking it clears the other rows of that family, and its PATCH clears
  the family's current default. A row that is done leaves the table; a
  failed one shows why, and Upload sends it again from the start. Leaving
  the page stops the upload, so while one runs the page asks first. Names
  the folder refuses and empty files are flagged before any upload. Files
  dropped on the one-image form replace it; what was typed there goes to
  the row of the same file name, and with no such row the form asks
  before it is lost.
  Without an image folder `/image-file` answers 404, and the page says so
  and uploads nothing.
- The images page is a file manager over one tree: the folders and files of
  `GET /image-file` (every file and folder, by path) and the images of the
  list, each placed at its `file`, with the folders on those paths. The
  folder shown is in the URL, `/images?folder=iosxe/17.18`; an image's page
  stays at its name, `/images/{name}`. A trail of the folders above it opens
  them. Folders come first, then the images by the column picked; a row
  shows the file name, and the image's name under it when the two differ. A
  list entry whose file is not in the folder says "no file", and a file the
  list lacks shows with "not listed · add", which opens the add form for
  that file (`/images/new?file={path}`). New folder PUTs
  `/image-folder/{path}`; uploads, by drop or Upload images, go into the
  folder shown: each image is named by its file name, with `file` the
  folder and that name. An upload whose name is already an image's, or
  whose path is another image's file, is refused in its row; the names are
  read again before each file is sent and before its entry is added, so one
  added meanwhile stops it too, and a PATCH never merges into another
  image. Rows have a menu, also on a right-click: Edit (or Open, or Add),
  Rename, Move to… with a folder picker, and Delete. Checked rows,
  shift-click for a range, move and delete together, and rows dragged onto
  a folder row or a folder in the trail move there. A move POSTs
  `/image-move` for the file or folder, then one PATCH sets the `file` of
  every image whose file it took along. The images keep their names, so
  campaigns follow: their members get the new URL, and those that answered
  or finished keep their status, since the target release is the same. The
  move and rename dialogs say which campaigns install the images. Without an
  image folder nothing moves, as the files would not follow. Delete takes
  the list entries out, then DELETEs the file or `/image-folder/{path}` with
  everything in it; it warns, and does not refuse, when a campaign uses an
  image. The search field matches folders by name and images as the old
  filter did, in the folder shown and every folder in it, each match with
  the folder it is in.
- Search (Search in the header, or Ctrl/⌘+K) jumps to a page, campaign,
  image, device or schedule by name, matched like the devices page
  filter. It reads the four lists through the 30 s read cache the devices
  page uses, so at 30k devices a first open takes about 0.4 s and a
  reopen none. Each group shows at most 8 matches and then a Show all
  row to its list page; for devices that page opens filtered by the same
  text (`/devices?name=`).
- Per-device status values: `pending`, `unknown`, `up-to-date`,
  `upgrade-needed`, `in-progress`, `succeeded`, `failed`, `rolled-back`.
  The `succeeded` counter includes `up-to-date`, `failed` includes
  `rolled-back`; `pending`/`unknown` count into nothing, so counters need
  not sum to `total`. Status is not latched — it tracks live device state
  and regresses when a campaign goes back to `plan`.
- The Config page shows layer 0, the top's configuration, from
  `GET /layer/0` (next to RESTCONF, not under it): `content=config`,
  `nonconfig` (the state its transforms publish, such as campaign
  progress) or `all`, as JSON, XML or AData. The choice is in the URL, so
  Refresh reads it again.
- The Apply config page PATCHes `/restconf/data` with a JSON or XML body
  as typed, so it merges. An XML body without a `<data>` root gets one:
  the top answers 204 to a bare top-level element and drops it. So the
  page takes what the Config page shows, in JSON or XML.

## Campaigns

Campaigns are the model's own concept and nothing more: created in plan,
launched by merging `{name, admin-state: run}`. The planner fits the members
into the configured windows with as many devices at once as the deadline
demands, at least `target-concurrency` and at most `max-concurrency`; the
plan is published in plan and in run alike, so the layout and its alarms
are visible before anything is actuated. In run the
controller releases devices a few at a time as their window opens and
completions come in; the estimated starts follow that release schedule, and
the campaign page draws them on a timeline, one cell per device, that takes
the live status as the run passes them. Below it, each device's run is a
chain of its steps, prepare, pre-check, install, post-check and commit: the
step running now pulses, a failed step is red with a cross, and a rollback
shows as ↺ after it; the device's `reason` says why the run stopped. Next to
the chain, the message of the device's `prepare` or `install` says what the
device does now, as `add: extract`, with a bar while the prepare transfers
the image, and after the install when the commit window ends. The UI
adds no semantics the model does not carry —
anything done here can be done identically over NETCONF or plain RESTCONF.
Two rules go beyond the model, in the wizard and on the campaign page: a
newly set deadline must lie ahead, and the pace comes from a deadline or a
number of devices at once, not both. Rate and ETA are measured since page
open, and nothing is latched: status tracks live device state and
regresses when a campaign goes back to plan.

Sharding is internal: the top places each device on a flotilla by its
name, and nothing in the UI shows the placement.
