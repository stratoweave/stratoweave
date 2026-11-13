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
        -> a periodic BGP state subscription while a check runs
        -> the device's software upgrade pre-check and post-check

There is no range expansion. A flotilla assigned 500 devices receives 500
complete `/device` entries, including addresses, credentials, SSH options, policy,
mock and debug settings, feature flags, and software intent.

## Build and regenerate

    just gen
    just build

Set `ACTON=/path/to/acton` when the compiler is not on `PATH`. Regeneration
produces both generated system-spec packages from `spec/`; the build produces
both binaries. `just build` builds them with `--release`, optimized for
execution speed and without debug symbols.

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
has a plan to show. When the demo starts, each of its members reads the
release it runs, and the campaign holds every install until it is set to
`run` and its window opens. `demo-images.xml` fills the image list with test IOS XE
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
starts, and `fleet-upgrade`, a planned campaign over all of them. Every
thirtieth device and the next form a redundancy group, `site-0001` and on,
and `cpe-0003` to `cpe-0005` form `hub`, which packs with a minute between
upgrades and starts with `cpe-0005`. The
positional knobs are the device count, the target and maximum number of
devices upgrading at once, the failing share in percent, the install
duration in seconds or a range, the window length in seconds, and which
schedules open soon rather than at their local midnight. `just demo-big`
is `just demo-fleet 1000 10 20 10 120-150 14400 europe`: a thousand
devices with `demo.xml`'s knobs, 120 to 150 s installs and a tenth failing
one of the seven ways, picked by a fixed shuffle so the grids show no
pattern, in four-hour windows with ten devices at once, where only europe
opens right away and americas and asia wait for their midnight, as a real
fleet's windows would. The files land in `out/`; a thousand devices come up
in about half a minute and take about a gigabyte of memory. `just
demo-reschedule` reopens a running demo's windows shortly; give it the same
window length and schedule list, `just demo-reschedule 14400 europe` for the
big demo.

`just run` starts the same top and flotillas with no config: no devices,
images or campaigns.

For bottom-node development, `just flotilla` still starts one standalone
instance on the first flotilla's ports. Do not run it alongside `just demo`.

Mock devices take three leaves under `mock/software`. `upgrade-duration` is how many
seconds a whole software upgrade takes; the mock spreads it over the
operations as measured on a lab c8000v (the numbers are in
`docs/reference/software-upgrade.md`), and absent or 0 completes each
operation at once. `upgrade-duration-variance` lets each upgrade take up to
that percentage longer or shorter, 20 by default, drawn at random per
upgrade, so devices released together do not all finish together. `failure`
names one IOS XE failure to reproduce: `download-failed`, `add-failed`,
`activate-refused`, `commit-failed` or `reverts`, or one that fails a BGP
check: `bgp-down` keeps the session idle from the start, so the pre-check
refuses, and `bgp-lost` keeps it idle on the new release, so the post-check
fails and the activation is aborted. `mock/platform` takes `version`, the
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

## Campaigns

A campaign acquires its members as soon as it exists, in `plan` and in
`run`. Each member in the fleet gets the campaign's name, the target
release and image URL of its image, and a veto with the holder
`campaign:NAME`, which holds the install. The member reads the release it
runs and answers `up-to-date` or `upgrade-needed`. Nothing is installed. A
member added later, also while the campaign runs, is acquired the same way.
In `run`, the campaign removes the veto of a member when it releases the
member in a window, and puts the veto back when the member is done.

A member's `device-status` shows its status only when the status is for
the campaign's intent: the device reports it for the campaign's name and
the member's target release. Otherwise it shows `pending`, and the counters
do not count it. Its `upgrade-campaign` and `target-release` say which
intent the device's status is for.

The campaign releases a member only once the member has answered its
target: its status is `upgrade-needed`, or a final status. A member that
shows `pending` or `unknown` has not answered. Until it answers, the plan
holds the member in its window, and the plan's alarms name it. A campaign
in `plan` plans again as the answers come in. Its plan is that of a run
that starts now, so it shows what `run` would do. A campaign created
directly in `run` promises its windows in the order its members answer.
Create it in `plan` first to keep the campaign's order.

A device in the fleet is in one campaign at most, also while the campaign
is in `plan` and after it is done. An edit that names a device in a second
campaign fails with "Cannot merge leaves with different values at
/software/upgrade-campaign". To move a device to another campaign, first
remove it from its campaign, or delete the campaign. Then add it to the
other campaign in a later edit. A move in one edit fails too. A campaign
gives a member that is not in the fleet nothing, so two campaigns can name
it. The edit that adds such a device to the fleet then fails with the same
error, until only one campaign names it.

Setting a running campaign back to `plan` pauses it. A member in flight
stops before its install and shows `upgrade-needed`. A member past its
install finishes. Setting the campaign to `run` again releases the paused
members again. A member that still reports `in-progress` for the campaign
then, or after a restart of fleetmgr, counts in flight and keeps the
campaign's veto: it holds a slot and its redundancy groups until it is
done, or until it stops before its install and waits again.

Stopping and running a campaign again does not retry its failed members.
To retry a member, remove it from the campaign, wait until the device's
software state has no `upgrade-campaign`, and add the member again. The
campaign then takes it as a new member: it holds it until it answers, and
releases it in a window.

With `failure-budget`, a campaign stops its releases when too many members
fail. The budget is a percent of the members the campaign has, rounded
down to whole devices: at 0.5, 5 of 1000 members may fail, and at 1, none
of 50. A member has failed while its status for the campaign's intent is
`failed` or `rolled-back`, as the `failed` counter counts it. A pause keeps
the count. A restart of fleetmgr loses it, because the device status is not
saved: a failed member answers again, and the campaign can release it. When
more members have failed than the budget, no member starts or prepares: the
members in flight finish, the others keep their windows, and the plan's
alarm says "N device(s) failed, more than the failure budget of M: no more
devices start". To go on, raise or remove the budget, or remove failed
members from the campaign, which is also how a member is retried. Each
member removed also makes the budget smaller: at 2 percent, 3 failed
members of 100 stop the releases, and 2 of 99 still do.

A member is down while its flotilla is not connected to it, or while the
top is not connected to its flotilla. A member that has not connected
since fleetmgr started is not down: the campaign holds it until it
answers. The campaign holds a member that waits while it is down. It
starts when it is back up, in its window if the window still fits, so a
dead flotilla holds only its own members. When the top connects to a
flotilla again, its members are up at once, with the states they had
before, until the flotilla sends new ones. A member that the campaign
releases then fails if its device is not connected yet. A member that
goes down while it upgrades, as in the reboot of its upgrade, keeps its
slot, and the plan's alarm names it when it is still down after its
expected end. When the window of a held member closes, the member gets
the next window of its schedule, and the plan's alarm names it until it
starts. Each held member's `device-status` says why in `held`, and
`held-by` names the device or the flotilla that holds it. The state's
`held` counts them.

With `notification-period`, in days, a campaign uses only the windows that
open that long or more after its `run-since`, so that the customers of its
members can be told about their window in time. `run-since` is in the
campaign's state: the time it first went to `run`. A pause and a restart of
fleetmgr keep it, and deleting the campaign clears it. Before the first run,
the plan counts from now. A window that opens earlier is left out, also when
it closes later, and a campaign without a schedule opens its window at the
end of the period. The prepares spread over the period, because the first
window that the campaign uses is their deadline. A member added later, and a
member that is up to date, gets no notice of its own: it gets the first
window that the campaign uses. Raising `notification-period` during a run
takes windows away: the members released in them keep them, and the others
get the next window that is left.

With `allow-staging`, a campaign in `run` lets each member that needs the
upgrade, and that the plan gives a window, prepare once before its window:
the device copies its image, with no outage, while the campaign's veto
holds the install. The first member prepares as soon as the campaign runs.
The others follow, as far apart as their deadlines allow. In a campaign
of thousands of members, the members whose turns fall in the same few
seconds, up to 30, start together. A member's deadline is the opening of
the next window of its schedule that the campaign uses, less `close-margin`
percent of its expected prepare time: 195 s at the IOS XE estimate of 130 s
and the default 150. Members whose window opens first go first. No member
prepares while such a window is open. In `plan` nothing is copied: the
plan shows each member's `prepare-start` in a run that starts now, and
`prepare-concurrency`, the most copies at once. There is no cap on that
number. `device-status` shows each member's `prepare`, and `preparing` and
`prepared` count the members that wait for their release. The plan's
alarms name the members that cannot prepare before their window opens and
the members that wait for their window after a failed prepare. A failed
prepare is not tried again. Turning `allow-staging` off, or setting the
campaign to `plan`, stops the prepares; a copy that runs finishes. The
upgrade in the window still copies the image again, so windows are not
shorter yet.

## Web UI

`webui/` is a SvelteKit UI for the same northbound: fleet inventory,
maintenance schedules, software images and upgrade campaigns over RESTCONF.
The images page sorts and filters the image list, uploads dropped image
files and adds their entries, adds entries by hand, and edits and deletes
them. The schedules
page shows a week of every schedule's windows on a calendar and edits the
schedules themselves: the local time zone, and rules of an opening time, a
duration and weekdays, typed or dragged on the calendar. The devices page
binds devices to a schedule, one at a time or a whole filtered selection. A
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

starts the Vite dev server on :3000 and proxies `/restconf` to
`FLEETMGR_API`. See `webui/README.md`.

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
name. A member whose image is not in the list, or has no version, gets
only the campaign's name and veto, with no target release, and the
campaign's plan alarms say so.

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
to the device's `/device/software/state` and `/device/state`, and
publishes the status, the campaign and target release the status is for,
the stage, reason and check verdicts in the entry's own `state`, the
platform as its `state/platform`, and whether the flotilla is connected to
the device as `state/connected`. A change on one device
publishes one entry. Removing the entry closes the subscription and clears
the state. Each campaign transform subscribes to the `state` of every entry,
one subscription, and aggregates its own members, each with the version and
model its platform reports. It also subscribes to the top's `/device`
entries of the flotillas, to learn whether the top is connected to each
flotilla. Each `/fleet/device` actor subscribes to its RFS entry's
platform and publishes it as its own
`state/platform`: OS, version, model and serial number.

`flotilla` supplies one modeled layer, the standard RFS plus the
`flotilla-rfs` augment below. StratoWeave adds the implicit device layer
beneath it.

## Upgrade checks

Every device the top places on a flotilla also gets `/rfs{cpe}/device-health`
there. Its transform registers the software upgrade pre-check and post-check
with the device's software manager and subscribes to the device's BGP state
(`Cisco-IOS-XE-bgp-oper`) only while a check runs, every `poll-period`
seconds, default 2.

A check judges the readings delivered after it started, so a post-check
cannot pass on numbers read before the reload; a periodic subscription
delivers every successful read, so the first one is at most a poll period
away. The pre-check passes once a reading shows an established neighbor, or
no BGP neighbors at all, and records the established-session and
advertised-prefix counts as the baseline. While every neighbor is down it
keeps waiting and refuses after 45 s; the device is then left on the old
release. The post-check passes once the device is back at the baseline and
refuses after 10 minutes, which aborts the activation. A fleet device's
`upgrade-checks/precheck-wait` and `postcheck-wait` change those waits; the
demo's `bgp-lost` devices wait a minute. `upgrade-checks/enabled` false turns
the checks off, for a device whose BGP state no adapter reads. An IOS XE device
without NETCONF, such as 16.8 on a C1111, has its BGP state from the
`iosxe-cli` adapter.

Nothing is read from the device between checks and nothing is published
but the verdicts, under `/device{cpe}/software/state/precheck` and
`postcheck`. The top carries both up to the campaign's `device-status`, next
to the device's status, the step its upgrade is at and why it stopped. The mock IOS XE
device serves one established BGP neighbor, so in the demo both checks pass
with its numbers, except on the `bgp-down` and `bgp-lost` devices.

## Tests

    just test

The focused tests cover device placement by name, the top's flotilla
entries, precise campaign links, campaign aggregation, the stage, reason and
check verdicts reaching the campaign, the platform reaching the top, the parent RFS-to-flotilla render, direct `/device` configuration at
the RFS-only bottom, the mock leaves reaching the flotilla, reading the BGP
neighbors, and a complete mock IOS XE software upgrade gated by the
device-health checks, which the mock's BGP failures refuse or roll back. The
root tests also cover IOS XE adapter behavior and ensure that a software-intent
change preserves the existing NETCONF adapter and session.
