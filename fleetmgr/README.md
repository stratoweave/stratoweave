# fleetmgr — layered fleet management

`fleetmgr` is the top of the layered deployment. It owns the complete
per-device inventory and generic software upgrade campaigns. It assigns each
device to a manually named shard, or manages a device without a shard itself.

`flotilla` is the bottom. It has no application CFS layer: its northbound is
the standard StratoWeave RFS, and every `/device` entry is managed directly as
an IOS XE device.

    fleetmgr CFS /fleet/device{cpe, shard=flotilla-1, type=iosxe}
        -> fleetmgr RFS /rfs{flotilla-1}/device{cpe}
        -> NETCONF -> flotilla RFS /device{cpe}
        -> IOS XE adapter -> physical or mock IOS XE device

    fleetmgr CFS /fleet/device{cpe, type=iosxe}, no shard
        -> fleetmgr RFS /device{cpe}
        -> IOS XE adapter -> physical or mock IOS XE device

    flotilla operational datastore /device{cpe}/software/state
        -> one on-change subscription per device
        -> fleetmgr RFS /rfs{flotilla-1}/device{cpe}/software/state
        -> fleetmgr CFS /software/upgrade-campaign/state

    fleetmgr RFS /device{cpe}/software/state, no shard
        -> fleetmgr CFS /software/upgrade-campaign/state

There is no range expansion. A flotilla assigned 500 devices receives 500
complete `/device` entries, including addresses, credentials, SSH options, policy,
mock and debug settings, feature flags, and software intent.

## Build and regenerate

    just gen
    just build

Set `ACTON=/path/to/acton` when the compiler is not on `PATH`. Regeneration
produces both generated system-spec packages from `spec/`; the build produces
both binaries.

## Ten-flotilla subprocess demo

Start the top:

    just demo

The top starts ten `flotilla` subprocesses and waits for every NETCONF listener
before starting its own runtime. The demo declares `flotilla-1` through
`flotilla-10` and assigns ten complete mock IOS XE entries to each, `cpe-001`
to `cpe-100`. `cpe-101` and `cpe-102` have no shard, so the top manages them
itself. Every device takes 120 to 150 s to upgrade, ten of them,
picked at random when the file was generated so the grids show no pattern,
fail in one of the mock's five ways, two per kind, and `cpe-003` already
runs the target. `demo-campaign.xml` adds `xe-upgrade-fleet`, a planned
campaign over the 99 devices `upgrade.xml` does not use, bound to a
`nightly` schedule with a one-hour window at midnight UTC, so the web UI
has a plan to show; it does nothing until set to `run`, and then waits
for the window. The processes use these ports:

    process          HTTP          NETCONF
    fleetmgr         18200         12900
    flotilla-1..10   18201..18210  12901..12910

`just demo-fleet` is the same demo with a generated fleet, a hundred devices
by default or `just demo-fleet 1000` for more: `cpe-0001` onwards, spread
round-robin over the flotillas with quick eight-second installs, three
regional schedules, europe, americas and asia, whose one-hour windows open
half a minute, a minute and a half and two and a half minutes after the top
starts, and `fleet-upgrade`, a planned campaign over all of them. The
positional knobs are the device count, the target and maximum rate in
devices per hour, the failing share in percent, the install duration in
seconds or a range, the window length in seconds, and which schedules open
soon rather than at their local midnight. `just demo-big` is `just
demo-fleet 1000 250 500 10 120-150 14400 europe`: a thousand devices with
`demo.xml`'s knobs, 120 to 150 s installs and a tenth failing one of the
five ways, picked by a fixed shuffle so the grids show no pattern, in
four-hour windows at a quarter of the fleet per hour, where only europe
opens right away and americas and asia wait for their midnight, as a real
fleet's windows would. The files land in `out/`; a thousand devices come up
in about half a minute and take about a gigabyte of memory. `just
demo-reschedule` reopens a running demo's windows shortly; give it the same
window length and schedule list, `just demo-reschedule 14400 europe` for the
big demo.

For bottom-node development, `just flotilla` still starts one standalone
instance on the first flotilla's ports. Do not run it alongside `just demo`.

Mock devices take three leaves under `mock/software`. `upgrade-duration` is how many
seconds a whole software upgrade takes; the mock spreads it over the
operations as measured on a lab c8000v (the numbers are in
`docs/reference/software-upgrade.md`), and absent or 0 completes each
operation at once. `failure`
names one IOS XE failure to reproduce: `download-failed`, `add-failed`,
`activate-refused`, `commit-failed` or `reverts`. `running-release` is the
release the device runs before any upgrade. In the demo ten devices each
reproduce one of the five failures: `cpe-034` fails its commit, so the
campaign aborts it and it ends `rolled-back`, while `cpe-007` fails its
download and ends `failed`. `cpe-003` already runs the target and ends
`up-to-date`. The leaves are read when the device is
created; change them by deleting and re-creating the device.

Inspect the top CFS and the bottom RFS independently:

    curl -H "Accept: application/yang-data+json" \
      http://127.0.0.1:18200/restconf/data

    curl -H "Accept: application/yang-data+json" \
      http://127.0.0.1:18201/restconf/data

The second response should contain the two `stratoweave-rfs:device` entries
assigned to `flotilla-1` and rendered by the top.

Run the three-device IOS XE campaign over `cpe-001`, `cpe-003` and `cpe-007`
and follow its state from the top:

    just upgrade-and-watch

The watcher starts before the intent is submitted and stops when every device
has settled, after about three minutes: the controller releases the two
devices that need work one after the other, so `cpe-001` ends `succeeded`
with `running_release` `17.18.3a` first, `cpe-003` is `up-to-date` at once,
and `cpe-007` ends `failed` last.

The submission and observation steps are also available separately:

    just watch-campaign       # run first in one terminal
    just upgrade              # submit upgrade.xml from another terminal
    just campaign-status      # print one current snapshot

Set `FLEETMGR_API` to point these targets at a top node on another address.

## Web UI

`webui/` is a SvelteKit UI for the same northbound: fleet inventory and
upgrade campaigns over RESTCONF. A campaign page draws the plan as a
timeline: each window is a band as wide as its duration, with one cell per
device at its estimated start on the wall clock; a marker shows now, and
once the campaign runs the cells take the devices' live status. The top
serves the UI itself: the static build is embedded in the `fleetmgr` binary
as `src/fleetmgr/webui_assets.act`, so with `just demo` running the UI is at
http://127.0.0.1:18200/. After a UI change, `just gen-webui` rebuilds the UI
and regenerates that module (needs Node), then `just build` picks it up. For
UI work,

    just webui

starts the Vite dev server on :3000 and proxies `/restconf` to
`FLEETMGR_API`. See `webui/README.md`.

## Lab with real devices

`test/lab` is a containerlab lab: three c8000v CEs peering eBGP with an FRR
PE, plus an image server the devices pull software from over SCP. It runs
real upgrades and downgrades through campaigns against real IOS XE, and the
BGP sessions give the devices real routing state. See `test/lab/README.md`.

## Models and transforms

The `fleetmgr` CFS has two inventory lists:

- `/fleet/node`: connection configuration for a flotilla. Its transform creates
  the top's managed `/device` entry with device type `flotilla`.
- `/fleet/device`: complete device configuration plus an optional string
  `shard` and an explicit device `type`. Its transform writes the entry under
  `/rfs{shard}/device`. Without a shard it writes the top's own `/device`
  entry, and the top manages the device with the device types a flotilla uses.

Both lists expose an `ssh` container using the shared
`stratoweave-ssh:ssh-client-config` grouping. Set SSH client options under
`/fleet/device/ssh` to pass them through to the device's owning flotilla, or
under `/fleet/node/ssh` to configure the top's connection to that flotilla.
Algorithm preference order is preserved through both transforms.

The generic `software` model remains separate from inventory. Each campaign
device list entry links its name to the referenced `/fleet/device` entry,
resolving each member's shard before merging all software intent into the same
device entry that the inventory transform writes.

The RFS transform renders that entry directly into the flotilla's standard
`/device` schema. Its actor keeps one on-change subscription to the device's
`/device/software/state` on the flotilla, and publishes the status and running
release as the entry's own `software/state`. A change on one device publishes
one entry. Removing the entry closes the subscription and clears the state.
For a device without a shard, the top's own device manager publishes
`/device/software/state`. Campaign transforms subscribe to both and aggregate
their own members.

`flotilla` supplies only one modeled layer, the standard RFS. StratoWeave adds
the implicit device layer beneath it.

## Tests

    just test

The focused tests cover node creation, per-device sharding, precise campaign
links, campaign aggregation, the parent RFS-to-flotilla render, direct
`/device` configuration at the RFS-only bottom, the mock leaves reaching the
flotilla, and a complete mock IOS XE software upgrade. The root tests also cover IOS XE adapter behavior and ensure
that a software-intent change preserves the existing NETCONF adapter and
session.
