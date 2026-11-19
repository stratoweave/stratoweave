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
           and /fleet/device{cpe}/state/platform and state/connected

    flotilla RFS /rfs{cpe}/device-health
        -> periodic BGP, interface and OSPF subscriptions while a check runs
        -> the device's software upgrade pre-checks and post-checks

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
before starting its own runtime. `just demo` generates a hundred mock IOS XE
devices, `cpe-0001` to `cpe-0100`, five router models in four families, and
`fleet-upgrade`, a planned campaign over 80 of them to 17.18.03a. The other
20 are in no campaign, to pick for a new one in the web UI. Most devices run
17.15.04, the release before the target, 15 run an older 17.12.03 and 5
already run 17.18.03a. Every device takes 120 to 150 s to upgrade, and ten of
them, picked by a fixed shuffle so the grids show no pattern, fail in one of
the mock's nine ways. The campaign's regional windows open within three
minutes of the start, so it is ready to run: each member reads the release
it runs, and the campaign holds every install until it is set to `run` and
its window opens.
`demo-images.xml` fills the image list with test IOS XE images, the four
families in three releases, each family in its own folder, `c1100`,
`isr4300`, `c8000be` and `c8000v`, with 17.18.03a the default. The demo
makes an empty file for each in `out/images`, sparse so it takes no disk,
and keeps image files uploaded in the web UI there too. The processes use
these ports:

    process          HTTP          NETCONF
    fleetmgr         18200         12900
    flotilla-1..10   18201..18210  12901..12910

`just demo` is `just demo-fleet 100 8 16 10 120-150 3600 all`, and `just
demo-fleet 100 8 16 10` the same with eight-second installs, for a quick
run. `just demo-fleet` takes the knobs, a hundred devices by default or
`just demo-fleet 1000` for more: `cpe-0001`
onwards, spread over the flotillas by name hash, with quick eight-second
installs, three regional schedules, europe, americas and asia, whose
one-hour windows open half a minute, a minute and a half and two and a half
minutes after the top starts, and `fleet-upgrade`, a planned campaign over
four fifths of them. Every
thirtieth device and the next form a redundancy group, `site-0001` and on,
and `cpe-0003` to `cpe-0005` form `hub`, which packs with a minute between
upgrades and starts with `cpe-0005`. The
positional knobs are the device count, the target and maximum number of
devices upgrading at once, the failing share in percent, the install
duration in seconds or a range, the window length in seconds, and which
schedules open soon rather than at their local midnight. `just demo-big`
is `just demo-fleet 1000 10 20 10 120-150 14400 europe`: a thousand
devices with `just demo`'s knobs, 120 to 150 s installs and a tenth failing
one of the mock's nine ways, picked by a fixed shuffle so the grids show no
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
`activate-refused`, `commit-failed` or `reverts`, or one that fails an
upgrade check: `bgp-down` keeps the BGP session idle from the start, so the
pre-check refuses, while `bgp-lost` keeps it idle on the new release,
`interface-lost` takes the line protocol of GigabitEthernet0/0/1 and
Virtual-Access2 down on the new release, and `ospf-lost` keeps the OSPF
neighbor 10.255.0.3 in init on the new release, so the post-check fails and
the activation is aborted. The mock serves seven interfaces,
GigabitEthernet0/0/0 to 0/0/2 (0/0/2 shut), Loopback0, NVI0,
Virtual-Access1 and Virtual-Access2, and two full OSPF neighbors on
GigabitEthernet0/0/0, 10.255.0.2 and 10.255.0.3. `mock/platform` takes
`version`, the release the device runs before any upgrade, 17.18.02 when
absent, and `model` and `serial-number`, the chassis the device reports,
C8000V and 9ABCDEFGHIJ when absent; the demo devices report five IOS XE
models in a rough field mix, each with its own serial number. In `just
demo` ten devices each reproduce one of the nine failures, named in their
description: `cpe-0036` fails its commit, so the campaign aborts it and it
ends `rolled-back`, while `cpe-0035` fails its download and ends `failed`.
`cpe-0010` refuses on its pre-check, and `cpe-0099`, `cpe-0009` and
`cpe-0032` roll back on their post-checks, which miss a BGP session, an
interface and an OSPF neighbor. `cpe-0017` and `cpe-0031` already run the
target and end `up-to-date`.
The leaves are read when the device is created; change them by deleting and
re-creating the device.

Inspect the top CFS and the bottom RFS independently:

    curl -H "Accept: application/yang-data+json" \
      http://127.0.0.1:18200/restconf/data

    curl -H "Accept: application/yang-data+json" \
      http://127.0.0.1:18201/restconf/data

The second response should contain the `stratoweave-rfs:device` entries the
top placed on `flotilla-1` and rendered there, twelve in the demo.

Follow a campaign's state from the top, `fleet-upgrade` unless named:

    just watch-campaign       # print each change until every device settled
    just campaign-status      # print one current snapshot

Set `FLEETMGR_API` to point these targets at a top node on another address.

## Campaigns

A campaign acquires its members as soon as it exists, in `plan` and in
`run`. Each member in the fleet gets the campaign's name, its `attempt`, the
target release and image URL of its image, and a veto with the holder
`campaign:NAME`, which holds the install. The member reads the release it
runs and answers `up-to-date` or `upgrade-needed`. Nothing is installed. A
member added later, also while the campaign runs, is acquired the same way.
In `run`, the campaign removes the veto of a member when it releases the
member in a window, and puts the veto back when the member is done.

A member's `device-status` shows the attempt that counts for the member.
Of the attempts that its device reports for the campaign's name and the
member's target release, that is the one `in-progress`, because a run of
an earlier attempt is still under way, and else the member's `attempt`.
Its `attempt` says which one. A member whose device has not answered that
attempt shows `pending`, and the counters do not count it. A member that
runs its target release already answers `up-to-date`: `succeeded` counts
it, and `up-to-date` counts it again.

A member answers the campaign's target with `upgrade-needed` or a final
status, and the campaign releases a member only once it answers
`upgrade-needed`. A member whose status is final while it waits, such as
one that is up to date, or one that succeeded or failed before it left the
campaign and joined it again with the same attempt, is done at once: it
takes no window. The next member of its redundancy groups waits the
group's `min-separation` from the answer of a member that is up to date,
or, when that member upgraded in the run before a new target release, a
new attempt or before it joined again, from the end of that upgrade. After
one that succeeded or failed before, it waits the `min-separation` from
that member's report. When the member's device tells when it last booted,
its `last-boot` in `state/platform`, a later boot moves the end of that
upgrade. For any other member the boot takes the place of its answer or
report, for example after a restart of fleetmgr, when the campaign did
not see its upgrade end: the next member need not wait for a device that
has run the target for months. But the next member never waits less than
the `min-separation` from the end of an upgrade that the member ran in the
run. A failed one still counts as failed: it counts against
`failure-budget` and holds its redundancy groups as their `failure-policy`
says. A member that needs the upgrade also waits the `min-separation` from
when each other member of its redundancy groups was done after an upgrade
in the run, or with a final status other than `up-to-date`, also a member
after it in the group. A member that shows `pending` or `unknown` has not
answered. Until it answers, the plan holds the member in its window, and
the plan's alarms name it. A campaign in `plan` plans again as the answers
come in. Before the first run, its plan is that of a run that starts now,
so it shows what `run` would do. A campaign created directly in `run`
promises its windows in the order its members answer. Create it in `plan`
first to keep the campaign's order.

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
install finishes. The pause keeps the run: in `plan`, the plan shows what
the run does when it goes on, and setting the campaign to `run` again
carries the run on from there. The members that are done keep their start
and finish, and the next members of their redundancy groups wait the
`min-separation` from when they were done. The windows promised to the
waiting members and the order of the promises stay, and so do the
concurrency, the ramp and the expected pace. A member released before the
pause that stopped before its install waits again in the window it was
released in, before the members promised that window after it. A member
that still reports `in-progress` for the campaign when it runs again, or
after a restart of fleetmgr, counts in flight and keeps the campaign's
veto: it holds a slot and its redundancy groups until it is done, or until
it stops before its install and waits again. After a long pause, the
members whose window closed meanwhile get the next window of their
schedule, in their place in the order of the promises: before the members
promised that window after them. The campaign may raise its concurrency, up
to `max-concurrency`, to keep the windows it promised. To start a campaign
over, delete it and create it again.

A new version of a member's image, or another image with another version,
gives the member a new target release. A waiting member keeps its window.
A member that is done, also one that failed, waits again until it answers
the new target, and upgrades in a window of its schedule, after the
members promised a window before. The next member of its redundancy groups
waits for it again, and a failure no longer holds them. A member whose
device runs the new target already is done again once it answers
`up-to-date`, as when a version changes and changes back. When it upgraded
in the run, the next member of its redundancy groups still waits the
`min-separation` from the end of that upgrade, or from a later boot. When
the device answered `upgrade-needed` in between, the next member waits
from the `up-to-date` answer instead, or from the device's boot when it
tells, but not from before the end of that upgrade. When an image is
removed and added back, the device keeps the final status of its attempt,
and the member is done again with it when the device answers. After a
success, or a failure in a group whose `failure-policy` is `continue`, the
next member of its redundancy groups waits the `min-separation` from that
answer, or from the device's boot when it tells, but not from before the
end of an upgrade that the member ran in the run. A member whose upgrade
to the old target ended while the campaign was paused is done for that
target, and upgrades to the new one in a window. A member whose rollback
failed stays done and failed, holds its redundancy groups and counts
against `failure-budget` until its device reports another final status, it
gets a new attempt, or it leaves the campaign, also when its status is
lost.

Stopping and running a campaign again does not try its failed members
again, and neither does removing a member and adding it again: its device
keeps the final status of its attempt. A member removed while in flight
stops before its install and answers `upgrade-needed`, so added again it
waits for a window. To try a member again, change its `attempt`, for
example from 0 to 1. The campaign then takes it as a new member: the
device reads its release again, and the campaign holds the member until
it answers the new attempt, and releases it in a window. A member that
succeeded reads again and answers `up-to-date`; when it upgraded in the
run, the next member of its redundancy groups waits the `min-separation`
from the end of that upgrade, or from a later boot of its device, not from
the answer. A member in flight gets
the campaign's veto back: its run stops before the install, or, past the
install, finishes and holds its slot until it ends.

With `failure-budget`, a campaign stops its releases when too many members
fail. The budget is a percent of the members the campaign has, rounded
down to whole devices: at 0.5, 5 of 1000 members may fail, and at 1, none
of 50. A member has failed while its status for the campaign's intent is
`failed`, `rolled-back` or `not-started`, as the `failed` counter counts
it, and while its rollback failed, also when its status is lost, until its
device reports another final status, it gets a new attempt, or it leaves
the campaign. A pause keeps the count. A restart of fleetmgr loses it,
because the device status is not saved: a failed member answers again, and
the campaign can release it. When more members have failed than the
budget, no member starts or prepares: the members in flight finish, the
others keep their windows, and the plan's alarm says "N device(s) failed,
more than the failure budget of M: no more devices start". To go on, raise
or remove the budget, or give failed members a new attempt or remove them.
A member with a new attempt no longer counts as failed. Each member
removed also makes the budget smaller: at 2 percent, 3 failed members of
100 stop the releases, and 2 of 99 still do.

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

The campaign also holds a member whose device has a veto of another
holder than the campaign, for example a service health check that holds
the device while its redundant peer has not converged. `device-status`
shows the device's vetoes, and the member is held as `vetoed`, with the
veto's holder in `held-by`. The members after it in its redundancy groups
are held behind it as `group-vetoed`, and the plan's alarms name both. It
starts when the veto goes. A member that
gets such a veto after its release waits again, unless its run is past
its install: a veto never stops an install. A member that a veto stops
before its install waits again too.

A redundancy group's `failure-policy` says what a failed member does to
the other members. With `continue`, the default, a member that failed or
rolled back holds them only until it is done and up again; the next
member starts after the group's `min-separation`. A member whose rollback
failed holds them until an operator acts, as all failures do with
`hold`. So does a member with a new attempt that was set while a run of
an earlier one failed its rollback: the device may run the release that
run installed, uncommitted, so the new attempt does not start. The member
shows `not-started`, with the failed attempt in its `reason`, and counts
as failed until it has another attempt.

With `notification-period`, in days, a campaign uses only the windows that
open that long or more after its `run-since`, so that the customers of its
members can be told about their window in time. `run-since` is in the
campaign's state: the time it first went to `run`. A pause and a restart of
fleetmgr keep it, and deleting the campaign clears it. Before the first run,
the plan counts from now. A window that opens earlier is left out, also when
it closes later, and a campaign without a schedule opens its window at the
end of the period. The prepares spread over the period, because the first
window that the campaign uses is their deadline. A member added later gets
no notice of its own: it gets the first window that the campaign uses.
Raising `notification-period` during a run takes windows away: the members
released in them keep them, and the others get the next window that is
left.

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
plan shows each member's `prepare-start` in the run as it would go on
now, or before the first run in a run that starts now, and
`prepare-concurrency`, the most copies at once. There is no cap on that
number. `device-status` shows each member's `prepare`, and `preparing` and
`prepared` count the members that wait for their release. The plan's
alarms name the members that cannot prepare before their window opens and
the members that wait for their window after a failed prepare. A failed
prepare is not tried again. Turning `allow-staging` off, or setting the
campaign to `plan`, stops the prepares; a copy that runs finishes. A pause
keeps each member's `prepare-start`: a member that prepared is not let
prepare again, and one that was let and has not prepared is let again when
the campaign runs again. A new target release lets a member prepare again
once it answers the new target. The upgrade in the window still copies the
image again, so windows are not shorter yet.

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
status, grey for a member held because it is down and amber for one held
for another reason. Members that already run their target take no cell.
The progress bar splits the members into upgraded, already up to date,
in progress, failed, held, not answered and waiting, and names what holds
the held ones. The same page changes the campaign's default schedule and
its pace, set by a deadline or by how many devices upgrade at once, plus
the most at once, its notification period and its failure budget. The new
campaign page counts, for each model, the devices that already run the
picked image or a newer release, and leaves out the ones that run it. The
devices pages show whether each device can be reached. The top serves the
UI itself: the static build is embedded
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
name. A member whose image is not in the list, or has no version, gets only
the campaign's name, its attempt and the veto, with no target release, and the
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
to the device's `/device/software/state` and `/device/state`, and publishes
the campaign and target release of the device's attempts, each attempt with
its status, stage, reason, prepare, install and check verdicts, and the
vetoes in the entry's own `state`, the platform as
its `state/platform`, and whether the flotilla is connected to the device as
`state/connected`. A change on one device publishes one entry. Removing the
entry closes the subscription and clears the state. Each campaign transform
subscribes to the `state` of every entry, one subscription, and aggregates
its own members, each with the version and model its platform reports. It
also subscribes to the top's `/device` entries of the flotillas, to learn
whether the top is connected to each flotilla. Each `/fleet/device` actor
subscribes to its RFS entry's platform and publishes it as its own
`state/platform`: OS, version, model, serial number and last boot. It also
subscribes to the entry's `state/connected` and to the top's `/device` entry
of its flotilla, and publishes whether the device can be reached as
`state/connected`: `connected`, `device-down`, or `flotilla-down` while the
top is not connected to the flotilla and the device was not down before.
The connection is absent until the device first connects.

`flotilla` supplies one modeled layer, the standard RFS plus the
`flotilla-rfs` augment below. StratoWeave adds the implicit device layer
beneath it.

## Upgrade checks

Every device the top places on a flotilla also gets `/rfs{cpe}/device-health`
there. Its transform registers three checks with the device's software
manager, each as a pre-check and a post-check under its name, and reads the
device for a check only while it runs, every `poll-period` seconds, default
2. A pre-check records a baseline, and its post-check compares against it.

- `bgp` reads the BGP neighbors (`Cisco-IOS-XE-bgp-oper`). The pre-check
  passes once a read shows an established neighbor, or no BGP neighbors at
  all, and records the established-session and advertised-prefix counts.
  The post-check wants as many established sessions and advertised prefixes
  again.
- `interfaces` reads which interfaces are up with their line protocol up
  (`Cisco-IOS-XE-interfaces-oper`: admin-status `if-state-up` and
  oper-status `if-oper-state-ready`), what `show interfaces | inc up, line
  protocol is up` lists. The pre-check passes on the first read and records
  them. The post-check fails while an interface that was up is not, NVI and
  Virtual-Access interfaces aside, or while fewer Virtual-Access interfaces
  are up.
- `ospf` reads the OSPF neighbors on each interface and their adjacency
  state (`Cisco-IOS-XE-ospf-oper`, `ospf-state`), what `show ip ospf
  neighbor detail` lists. The pre-check passes on the first read and
  records them. The post-check wants the same neighbors, each in the same
  state: none missing, none new.

A check judges the reads delivered after it started, so a post-check cannot
pass on numbers read before the reload; a periodic subscription delivers
every successful read, so the first one is at most a poll period away. While
every BGP neighbor is down the `bgp` pre-check keeps waiting and refuses
after 45 s; the device is then left on the old release. A post-check passes
once the device is back at its baseline and refuses after 10 minutes, which
aborts the activation. A fleet device's `upgrade-checks/precheck-wait` and
`postcheck-wait` change those waits; the demo's `bgp-lost`, `interface-lost`
and `ospf-lost` devices wait a minute. `upgrade-checks/enabled` false turns
the checks off, for a device whose BGP state, interfaces or OSPF neighbors
no adapter reads. An IOS XE device without NETCONF, such as 16.8 on a
C1111, has its BGP state from the `iosxe-cli` adapter, but no adapter reads
its interfaces or OSPF neighbors yet, so its pre-checks refuse unless the
checks are off.

Nothing is read from the device between checks and nothing is published
but the verdicts, under `/device{cpe}/software/state/attempt/precheck` and
`postcheck`, one part per check: `bgp: ...; interfaces: ...; ospf: ...`.
The top carries both up to the campaign's `device-status`, next to the
device's status, the step its upgrade is at and why it stopped. The mock IOS
XE device serves one established BGP neighbor, its interfaces up and two
full OSPF neighbors, so in the demo every check passes with its numbers,
except on the `bgp-down`, `bgp-lost`, `interface-lost` and `ospf-lost`
devices.

## Tests

    just test

The focused tests cover device placement by name, the top's flotilla
entries, precise campaign links, campaign aggregation, the stage, reason and
check verdicts reaching the campaign, the platform reaching the top, the parent RFS-to-flotilla render, direct `/device` configuration at
the RFS-only bottom, the mock leaves reaching the flotilla, reading the BGP
neighbors, the interfaces and the OSPF neighbors, the pre-check and
post-check rules of the three checks, and a complete mock IOS XE software
upgrade gated by them, which the mock's BGP, interface and OSPF failures
refuse or roll back. The
root tests also cover IOS XE adapter behavior and ensure that a software-intent
change preserves the existing NETCONF adapter and session.
