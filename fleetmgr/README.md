# fleetmgr — layered fleet management

`fleetmgr` is the top of the layered deployment. It owns the complete
per-device inventory and generic software upgrade campaigns. It places each
device on one of its ten flotillas, `flotilla-1` to `flotilla-10`, by a hash
of the device name, so a device always lands on the same flotilla.

`flotilla` is the bottom. It has no application CFS layer: its northbound is
the standard StratoWeave RFS, and every `/device` entry is managed directly as
an IOS XE device.

    fleetmgr CFS /fleet/device{cpe, type=iosxe}
        -> fleetmgr RFS /rfs{flotilla-1}/device{cpe}, flotilla-1 from hash(cpe)
        -> NETCONF -> flotilla RFS /device{cpe}
        -> IOS XE adapter -> physical or mock IOS XE device

    flotilla operational datastore /device{cpe}/software/state
    and /device{cpe}/state/platform
        -> one on-change subscription per device
        -> fleetmgr RFS /rfs{flotilla-1}/device{cpe}/state
        -> fleetmgr CFS /software/upgrade-campaign/state
           and /fleet/device{cpe}/state/platform

    flotilla RFS /rfs{cpe}/device-health
        -> a periodic BGP state subscription, all the time
        -> /rfs{cpe}/device-health/state: health and the details
        -> the device's software upgrade pre-check and post-check

    flotilla /rfs{cpe}/device-health/state/health
        -> a second on-change subscription per device
        -> fleetmgr RFS /rfs{flotilla-1}/device{cpe}/state/health
        -> fleetmgr CFS /fleet/device{cpe}/state/health

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
before starting its own runtime. The demo has 102 complete mock IOS XE
entries, `cpe-001` to `cpe-102`, six to fourteen on each flotilla. Every
device takes 120 to 150 s to upgrade, fourteen of them, picked at random
when the file was generated so the grids show no pattern, fail in one of
the mock's seven ways, two per kind, and `cpe-003` already runs the target. `demo-campaign.xml` adds `xe-upgrade-fleet`, a planned
campaign over the 99 devices `upgrade.xml` does not use, bound to a
`nightly` schedule with a one-hour window at midnight UTC, so the web UI
has a plan to show; it does nothing until set to `run`, and then waits
for the window. `demo-images.xml` fills the image list with test IOS XE
images; `just demo-fleet` loads it too. Both demos keep image files
uploaded in the web UI in `out/images`. The processes use these ports:

    process          HTTP          NETCONF
    fleetmgr         18200         12900
    flotilla-1..10   18201..18210  12901..12910

`just demo-fleet` is the same demo with a generated fleet, a hundred devices
by default or `just demo-fleet 1000` for more: `cpe-0001` onwards, spread
over the flotillas by name hash, with quick eight-second installs, three
regional schedules, europe, americas and asia, whose one-hour windows open
half a minute, a minute and a half and two and a half minutes after the top
starts, and `fleet-upgrade`, a planned campaign over all of them. The
positional knobs are the device count, the target and maximum number of
devices upgrading at once, the failing share in percent, the install
duration in seconds or a range, the window length in seconds, and which
schedules open soon rather than at their local midnight. `just demo-big`
is `just demo-fleet 1000 10 20 10 120-150 14400 europe`: a thousand
devices with `demo.xml`'s knobs, 120 to 150 s installs and a tenth failing
one of the mock's nine ways, picked by a fixed shuffle so the grids show no
pattern, in four-hour windows with ten devices at once, where only europe
opens right away and americas and asia wait for their midnight, as a real
fleet's windows would. The files land in `out/`; a thousand devices come up
in about half a minute and take about a gigabyte of memory. `just
demo-reschedule` reopens a running demo's windows shortly; give it the same
window length and schedule list, `just demo-reschedule 14400 europe` for the
big demo.

`just demo-import` shows the devices page's CSV import on a busy fleet:
it is `just demo-big 5000` with the campaign started (the last argument
of `demo-fleet` and `gen-demo-fleet` is the campaign's admin-state, plan
or run) and slower, 20 devices at once, so europe's 3000 take two of its
windows, about 2000 in today's and the rest in the next day's. It also
writes `out/demo-import.csv` with 500 more mock devices,
`branch-0001` to `branch-0500`, in the same mix of models and regions,
each bound to its region's schedule, europe included, and a tenth of them
failing. Paste the file into Devices > Import CSV while the campaign runs;
the 500 join the fleet, not the campaign, and show their health within
half a minute; the name filter `branch-*` finds them. `just demo-import N
ADD` changes the two counts, and `just gen-demo-import ADD` writes only
the file.

`just run` starts the same top and flotillas with no config: no devices,
images or campaigns.

For bottom-node development, `just flotilla` still starts one standalone
instance on the first flotilla's ports. Do not run it alongside `just demo`.

Mock devices take two leaves under `mock/software`. `upgrade-duration` is how many
seconds a whole software upgrade takes; the mock spreads it over the
operations as measured on a lab c8000v (the numbers are in
`docs/reference/software-upgrade.md`), and absent or 0 completes each
operation at once. `failure`
names one IOS XE failure to reproduce: `download-failed`, `add-failed`,
`activate-refused`, `commit-failed` or `reverts`, or one that fails a health
check: `bgp-down` keeps the BGP session idle from the start, so the pre-check
refuses, `bgp-lost` keeps it idle on the new release, `interface-lost`
takes the line protocol of GigabitEthernet0/0/1 and Virtual-Access2 down on
the new release, and `ospf-lost` keeps the OSPF neighbor 10.255.0.3 in init
on the new release, so the post-check fails and the activation is aborted.
The mock serves seven interfaces: GigabitEthernet0/0/0 to 0/0/2 (0/0/2
shut), Loopback0, NVI0, Virtual-Access1 and Virtual-Access2, and two full
OSPF neighbors on GigabitEthernet0/0/0, 10.255.0.2 and 10.255.0.3. `mock/platform` takes `version`, the
release the device runs before any upgrade, 17.18.02 when absent, and `model`
and `serial-number`, the chassis the device reports, C8000V and 9ABCDEFGHIJ
when absent; the demo devices report ten IOS XE models in a rough field mix,
each with its own serial number. In the demo fourteen devices each reproduce
one of the seven failures: `cpe-034` fails its commit, so the campaign
aborts it and it ends `rolled-back`, while `cpe-007` fails its download and
ends `failed`. `cpe-039` refuses on its pre-check and `cpe-016` rolls back
on its post-check. `cpe-003` already runs the target and ends `up-to-date`.
The leaves are read when the device is created; change them by deleting and
re-creating the device.

Inspect the top CFS and the bottom RFS independently:

    curl -H "Accept: application/yang-data+json" \
      http://127.0.0.1:18200/restconf/data

    curl -H "Accept: application/yang-data+json" \
      http://127.0.0.1:18201/restconf/data

The second response should contain the `stratoweave-rfs:device` entries the
top placed on `flotilla-1` and rendered there, nine in the demo.

Run the three-device IOS XE campaign over `cpe-001`, `cpe-003` and `cpe-007`
and follow its state from the top:

    just upgrade-and-watch

The watcher starts before the intent is submitted and stops when every device
has settled, after about three minutes: the controller releases the two
devices that need work one after the other, so `cpe-001` ends `succeeded`
with `version` `17.18.3a` first, `cpe-003` is `up-to-date` at once,
and `cpe-007` ends `failed` last.

The submission and observation steps are also available separately:

    just watch-campaign       # run first in one terminal
    just upgrade              # submit upgrade.xml from another terminal
    just campaign-status      # print one current snapshot

Set `FLEETMGR_API` to point these targets at a top node on another address.

## Web UI

`webui/` is a SvelteKit UI for the same northbound: fleet inventory,
maintenance schedules, software images and upgrade campaigns over RESTCONF.
The images page sorts and filters the image list, uploads dropped image
files and adds their entries, adds entries by hand, and edits and deletes
them. The schedules
page shows a week of every schedule's windows on a calendar and edits the
schedules themselves: the local time zone, and rules of an opening time, a
duration and weekdays, typed or dragged on the calendar. The devices page
shows each device's health and filters on it, and binds devices to a
schedule, one at a time or a whole filtered selection. Export CSV
downloads the devices' config as `devices.csv` and Import CSV takes one
back, pasted, dropped or chosen as a file: one row per device and one
column per leaf, named by its path in the device entry
(`credentials/username`); repeated elements take an index
(`redundancy-group[2]`, `address[2]/name`). Existing devices are updated,
and an empty cell leaves the leaf as it is. A device's page
shows the details of its health check, which the top reads from the
device's flotilla when the page opens (`GET /device-health/<name>`): one
row per check (BGP, interfaces, OSPF) with the BGP neighbors, the
interfaces and the OSPF neighbors; once a campaign's upgrade of the device
reaches the pre-check, each check's pre-check apart, and from the
post-check on its post-check too. A
campaign page draws the plan as a timeline: each window is a band as wide
as its duration, with one cell per device at its start on the wall
clock, the real one once the controller has released the device; a marker
shows now, and once the campaign runs the cells take the devices' live
status; the same page changes the campaign's default schedule and its
pace, set by a deadline or by how many devices upgrade at once, plus the
most at once. The top serves the UI itself: the static build is embedded
in the `fleetmgr` binary as `src/fleetmgr/webui_assets.act`, so with
`just demo` running the UI is at http://127.0.0.1:18200/. After a UI change,
`just gen-webui` rebuilds the UI and regenerates that module (needs Node),
then `just build` picks it up. For UI work,

    just webui

starts the Vite dev server on :3000 and proxies `/restconf` and the other
API paths to `FLEETMGR_API`. See `webui/README.md`.

## Lab with real devices

`test/lab` is a containerlab lab: three c8000v CEs peering eBGP with an FRR
PE, plus an image server the devices pull software from over SCP. It runs
real upgrades and downgrades through campaigns against real IOS XE, and the
BGP sessions give the devices real routing state. See `test/lab/README.md`.

## Models and transforms

The `fleetmgr` CFS inventory is `/fleet/device`: complete device
configuration plus an explicit device `type`. The top starts ten flotillas,
`flotilla-1` to `flotilla-10`, and a device goes to `flotilla-N`, where N is
the device name's hash modulo ten, plus one. Acton hashes a string the same
way on every run, so the placement survives restarts. The device's transform
writes its entry under `/rfs{flotilla-N}/device`, and the top's own
`/device{flotilla-N}` entry with device type `flotilla`, the flotilla's local
NETCONF port and the flotillas' default `admin`/`admin` NETCONF login.
Every device on a flotilla writes the same entry, so the top connects to a
flotilla once it has a device.

The device list exposes an `ssh` container using the shared
`stratoweave-ssh:ssh-client-config` grouping. Set SSH client options under
`/fleet/device/ssh` to pass them through to the device's owning flotilla.
Algorithm preference order is preserved through both transforms.

The generic `software` model remains separate from inventory. Each campaign
device list entry links its name to the referenced `/fleet/device` entry,
routing each member to its flotilla before merging all software intent into the
same device entry that the inventory transform writes. Each member names its
`image` from `/images`: the device's target release is the image's
`version`, and its image URL is the list's `url-base` followed by the image
name. A member whose image is not in the list, or has no version, gets no
software intent, and the campaign's plan alarms say so.

`/images` is the StratoWeave image list (`swyang.images`): software images
by file name, each with its `os`, `version`, `family` and the hardware
`model`s it is for. One image of a family can be its `default`; the YANG
`must` statements that say so are not checked yet, and the web UI keeps to
the rule. `url-base` says where devices fetch the images from. The web UI
uploads the image files into the top's image folder,
`--software.image-dir`, and adds their entries. Like `/schedules`, the
container is a transform that produces no configuration, so campaigns link
the whole list.

The RFS transform renders that entry directly into the flotilla's standard
`/device` schema. Its actor keeps one on-change subscription on the flotilla
to the device's `/device/software/state` and `/device/state/platform`, and
publishes the status, stage, reason and check verdicts in the entry's own
`state` and the platform as its `state/platform`. A change on one device
publishes one entry. Removing the entry closes the subscription and clears
the state. Each campaign transform subscribes to the `state` of every entry,
one subscription, and aggregates its own members, each with the version and
model its platform reports. Each `/fleet/device` actor subscribes to its RFS entry's
platform and publishes it as its own
`state/platform`: OS, version, model and serial number.

`flotilla` supplies one modeled layer, the standard RFS plus the
`flotilla-rfs` augment below. StratoWeave adds the implicit device layer
beneath it.

## Upgrade checks

Every device the top places on a flotilla also gets `/rfs{cpe}/device-health`
there. Its transform runs three checks, each reading the device all the time,
every `health-period` seconds (default 30), and every `poll-period` seconds
(default 2) while that check's upgrade check runs. Each check is also one
of the device's software upgrade pre-checks and post-checks, registered
with its software manager under its name.

Each check has two rules that judge every read. The post-check rule
compares against a baseline: an upgrade's pre-check takes it, and until
one does, the first read the pre-check rule passes takes it.

- `bgp` reads the BGP neighbors (`Cisco-IOS-XE-bgp-oper`). The pre-check
  rule passes when a neighbor is established, or when there are no BGP
  neighbors at all. The post-check rule wants as many established sessions
  and advertised prefixes as at the baseline.
- `interfaces` reads which interfaces are up with their line protocol up
  (`Cisco-IOS-XE-interfaces-oper`: admin-status `if-state-up` and
  oper-status `if-oper-state-ready`), what `show interfaces | inc up, line
  protocol is up` lists. The pre-check rule passes on every read. The
  post-check rule fails when an interface that was up at the baseline is not
  any more, NVI and Virtual-Access interfaces aside, or when fewer
  Virtual-Access interfaces are up than at the baseline.
- `ospf` reads the OSPF neighbors on each interface and their adjacency
  state (`Cisco-IOS-XE-ospf-oper`, `ospf-state`), what `show ip ospf
  neighbor detail` lists. The pre-check rule passes on every read. The
  post-check rule fails unless the neighbors are the baseline's, each in the
  same state: none missing, none new.

Between upgrades, the verdicts are published under
`/rfs{cpe}/device-health/state`: `health` (healthy when every check passes),
when it last changed, each check's rule verdicts and baseline time, the BGP
neighbors, the interfaces and the OSPF neighbors. The top subscribes only to `health` and
relays it to `/fleet/device{cpe}/state/health`. The details stay on the
flotilla: `GET /device-health/<name>` on the top reads them from the
device's flotilla when asked, and the web UI's device page does that when it
opens.

During an upgrade the checks are consulted as before. A check judges the
reads delivered after it started, so a post-check cannot pass on numbers
read before the reload. A pre-check passes on the first read its rule
passes and takes the baseline. While every BGP neighbor is down the bgp
pre-check keeps waiting and refuses after 45 s; the device is then left on
the old release. A post-check passes once its rule passes and refuses after
10 minutes, which aborts the activation. A fleet device's
`upgrade-checks/precheck-wait` and `postcheck-wait` change those waits; the
demo's `bgp-lost`, `interface-lost` and `ospf-lost` devices wait a minute. The verdicts
are published under `/device{cpe}/software/state/precheck` and `postcheck`,
one part per check (`bgp: ...; interfaces: ...; ospf: ...`), and the top carries both
up to the campaign's `device-status`, next to the device's status, the step
its upgrade is at and why it stopped.

The mock IOS XE device serves one established BGP neighbor, its interfaces
up and two full OSPF neighbors, so in the demo every device is healthy and
all checks pass, except on the `bgp-down` devices, which are unhealthy all
the time, and the `bgp-lost`, `interface-lost` and `ospf-lost` devices,
which are unhealthy while the new release runs. At 10,000 mock devices the reads every 30 s cost each
flotilla about 5% of a core.

## Tests

    just test

The focused tests cover device placement by name, the top's flotilla
entries, precise campaign links, campaign aggregation, the stage, reason and
check verdicts reaching the campaign, the platform reaching the top, the parent RFS-to-flotilla render, direct `/device` configuration at
the RFS-only bottom, the mock leaves reaching the flotilla, reading the BGP
neighbors, the pre-check and post-check rules of the three checks, health shown with no upgrade,
the top's health subscription, and a complete mock IOS XE software upgrade gated by the
device-health checks, which the mock's BGP, interface and OSPF failures refuse or roll back. The
root tests also cover IOS XE adapter behavior and ensure that a software-intent
change preserves the existing NETCONF adapter and session.
