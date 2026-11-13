# Changelog

## Unreleased

### Core
- Transform actors can write their output to the layer below at any time
  with `write_output`, each write in its own transaction. Enable it with
  `sw:direct-output` under `sw:transform`. The transform function then gets
  the output written last, `prev_output`, and should return what the actor
  would write for its input, so a recompute keeps the actor's output. A
  write is replayed after a conflicting commit.
  `fleetmgr.cfs.UpgradeCampaignTransform` is an example. [#698] [#731]
  [#783]
- A transform's output replaces the configuration it wrote before, instead of
  being applied as a diff. Fixed source deletion, concurrent edits, restored
  list membership and subscriptions on newly committed list elements. [#680]
- A full configuration replacement, like a transform's output, skips list
  elements and container children that are the same node as in the last
  replacement committed from that source. They get no transaction, lock or
  commit, and their transforms don't run. An equal value in a newly built
  node is not skipped. [#731]
- A session commit reports `done` and `complete` only after every transform
  below it has committed. Before, a link subscriber could commit without its
  linked input. [#685]
- Fixed a deadlock in `update_dynstate` when the root transform was blocked
  on a `get_data` call to the same transaction. [#675]
- Optional parameters declare explicit defaults, which newer Acton versions
  require. The transform generator emits them too.
- Child processes, environment variables and stdin go through the `Env`
  services `env.process`, `env.vars` and `env.stdio`. [#704]
- Fixed the etcd store leaving a request without a result when etcd answers
  with an HTTP error whose body is not UTF-8. [#724]
- Fixed subscription data running in the actor of the device adapter or TTT
  layer that delivered it, when the consumer passed its own actor method.
  `declare_subscriptions()` of `DeviceMgr`, `ttt.Layer` and
  `adapters.adapter.DeviceAdapter` takes the data callback, and the layer's
  `delta`, as an action instead of a proc. [#763]
- A software adapter has a static `prepare_estimate()`: the seconds the copy
  of the image takes, for planners. The IOS XE adapter gives 130. The unused
  `estimate(staged)` is removed. [#784]

### Northbound APIs
- Fixed NETCONF `<get-config>` returning the operational state published by
  transforms. [#683]
- RESTCONF supports the `content` query parameter on GET. [#686]
- RESTCONF supports the `fields` query parameter on GET, which narrows the
  reply to the selected nodes, like
  `GET /restconf/data/demo-fleet:device=cpe-16?fields=software(target;state)`.
  The reply for a list entry keeps its keys. `/restconf-state/capabilities`
  lists the `fields` capability. An invalid `fields` value, `fields` on any
  method other than GET, and a query parameter given twice get 400 Bad
  Request. [#805]
- Fixed RESTCONF GET, NETCONF `<get>` and yang-push filters that could not
  reach an operational subtree under a config node, like
  `/software:software/upgrade-campaign=foo/state` in fleetmgr. [#677] [#681]
- Fixed `/restconf-state/capabilities` listing YANG modules next to the
  RESTCONF protocol capabilities. [#676]
- RESTCONF replies use compact JSON and XML. `ncurl` output and the
  `/device/<name>/target`, `/running` and `/diff` inspection endpoints are
  still indented. [#684]
- The `/layer/<idx>` inspection endpoint takes the same `content` query
  parameter, so it can return a layer's operational state too. [#736]
- The NETCONF server serves the YANG library at `/yang-library` and
  `/modules-state`. Besides the modules of the CFS schema, it lists
  ietf-subscribed-notifications and ietf-yang-push as implemented, with the
  features `subtree`, `xpath` and `on-change`. The `<hello>` has one
  `yang-library:1.1` capability instead of a capability per module.
  RESTCONF serves `/modules-state` too. [#716]
- The NETCONF server serves RFC 5277 `create-subscription` and advertises the
  `:notification` and `:interleave` capabilities. Application code sends a
  notification to the subscribed sessions with `publish()` on
  `NetconfServer.event_hub()`. There is no replay yet, and a session with an
  RFC 5277 subscription cannot also hold RFC 8639 subscriptions. [#752]
- The `/device/<name>/modules` and `/device/<name>/info` inspection endpoints
  give the adapter of each module. [#756]
- A NETCONF `<edit-config>` transaction is complete once it is committed to
  TTT and persisted. Device interaction is left outside the transaction, so
  the edit no longer waits for the devices to apply their configuration.
  Before, a device that never connected kept the transaction from ever
  completing, and since a Fleet Manager top sends one edit at a time to each
  flotilla, a single such device blocked all further configuration to its
  flotilla. [#792]

### Devices & Adapters
- SNMP device adapters are generated from MIBs. The system generator
  translates the MIBs to YANG and generates Acton types and subscription
  paths from them. Transforms choose the polling period, and the SNMPv2c
  adapter uses `credentials/password` as the community. Mini has an example
  `ietf_snmp` device type with SNMPv2-MIB and IF-MIB. See the SNMP devices
  reference. [#701]
- Device and software adapters get the `Env` instead of a `TCPConnectCap`, so
  they can use other transports, like UDP for SNMP, or start subprocesses.
  [#702]
- Each device publishes its operating system family, release, chassis model
  and serial number under `state/platform`. A platform probe reads them on
  every connect and after a software install. There are probes for IOS XE,
  IOS XR, Junos, SR Linux, SR OS and ArcOS, and an app sets its probes with
  `platform_probes` in its `device_types.act`. See the device platform
  reference. [#712] [#717]
- Transforms can subscribe to a device's YANG event notifications with
  `declare_notif_subscriptions()` on the `DeviceMgr`, naming them in
  `NotifSpec`s. Each `NotifEvent` carries the event time, the payload decoded
  against the device schema and the raw XML. The NETCONF adapter uses RFC 8639
  `establish-subscription` on the main session where the device supports it,
  and otherwise an RFC 5277 subscription on a session of its own. Delivery is
  at most once, with no replay. Pass a `synced` action to learn when the
  subscriptions are in place, before sending an RPC whose result arrives as
  an event. See the event notifications reference. [#752]
- `ncurl notifications` prints the event notifications a device sends, all of
  them or those named with `--notification module:name`, and how the adapter
  subscribed to them. [#752]
- When a device advertises `ietf-netconf-notifications` (RFC 6470), the
  `DeviceMgr` subscribes to `netconf-config-change` and resyncs the device's
  running configuration when one arrives. A change made outside StratoWeave
  is found without waiting for a reconnect. StratoWeave's own commits cause
  a resync too, because the `DeviceMgr` does not check `changed-by`. [#753]
- `adapters.iosxe_cli.IosXeCliAdapter` runs IOS XE commands over SSH, for
  what NETCONF lacks on a device, or on older releases where NETCONF does
  not start at all. It returns what it reads in the `stratoweave-iosxe-cli`
  YANG module: the files on a file system from `dir`, the release, model,
  serial number and boot image from `show version`, and the output of
  `show install summary` and `show bootvar`. A device type that uses it adds
  `adapters.iosxe_cli_yang.models` to its schema. [#755] [#777]
- A device can run extra adapters beside the adapter of its device type, for
  what that adapter does not have, like a CLI adapter for an RPC that the
  device lacks over NETCONF. An extra adapter is a device type too, listed in
  the device's `extra-adapter` list with an optional `address`, `port` and
  `credentials`. Without a `port` it uses its own default port, not the port
  of the address. A module goes to the first connected adapter that has it,
  the adapter of the device type first, and moves when an adapter connects
  or loses its connection. Gets, subscriptions, RPCs and event
  notification subscriptions go to the adapters of the modules that their
  top-level nodes name, and configuration goes only to the adapter of the
  device type. `state/adapter` shows whether each adapter is connected. An
  adapter runs as an extra adapter when it passes its device type to the
  `DeviceMgr`'s `on_connect()` and `on_disconnect()`, as the NETCONF, SNMP
  and IOS XE CLI adapters do. See the device management reference. [#756]
  [#765] [#799]
- `DeviceMgr.get_connected_modules()` gives the modules of a device's
  connected adapters, and `get_unconnected_durations()` how long each adapter
  that is not connected has been without a connection. [#799]
- Fixed devices without yang-library or netconf-monitoring, like Junos 10.4,
  getting an empty module set, so transforms computed nothing for them.
  Their module set has the other capabilities of their `<hello>`, named by
  URI, except the NETCONF protocol ones. The Junos platform probe applies on
  the `http://xml.juniper.net/netconf/junos/1.0` capability. [#721]
- The NETCONF adapter fails a get whose filter names a node that the device
  schema lacks, with `Filter node <path> not found in device schema`. Before,
  those nodes were dropped from the reply without an error. [#712]
- `ncurl` takes the repeatable `--ssh-key-exchange`,
  `--ssh-host-key-algorithm`, `--ssh-cipher` and `--ssh-mac` options for
  devices that only offer old SSH algorithms, like Junos 10.4. Its new
  `platform` command prints the platform the probes read. The default port
  is 830 instead of 42830, and without `--password` it prompts for the
  password instead of using `admin`. [#717] [#720]
- After refused credentials, an untrusted host key or no common SSH
  algorithm, the NETCONF adapter tries to connect again once a minute
  instead of every second. Repeated failed logins can lock the account on
  some devices. A change to the device's settings connects at once. [#720]
- Fixed NETCONF RPCs to Junos 10.4 waiting until their timeout. Its replies
  carry `xmlns` twice, which is not valid XML. The NETCONF client drops the
  repeated attribute with the new `duplicate-attributes` fixup. [#719]
- Fixed "Invalid NETCONF chunk framing" errors around NETCONF session
  restarts, seen with large mock fleets. After such an error the device
  adapter restarts the session once, not once for every write. [#691] [#693]
- Fixed the mock NETCONF server keeping a session's yang-push subscriptions
  after the session ended. Every client restart added another set of
  updates. [#692]
- Fixed a transform's subscriptions to a device being lost when they were
  declared before the `DeviceMgr` had its adapter, for example when the
  device and the transform's input are written in one transaction. The
  `DeviceMgr` passes them on to the adapter it gets later. In Fleet Manager,
  a campaign could keep upgraded devices pending because the top never
  subscribed to their flotilla. [#747]
- The NETCONF adapter logs in with the first private key in the device's
  `credentials/key`, with or without a password, on the main session and on
  the RFC 5277 notification sessions. Before, it connected only with a
  password. `ncurl` takes a private key file with `--key`. [#776]
- An extra adapter can have SSH settings of its own in `extra-adapter/ssh`,
  which replace the device's `ssh` for that adapter, as `credentials` does.
  The IOS SSH server of a C1111 sends no server-sig-algs, so an RSA key needs
  `public-key-algorithm` `ssh-rsa` on its CLI port, while its NETCONF port
  takes the RSA SHA-2 signatures. [#776]
- The `verify` RPC of the IOS XE CLI adapter runs the IOS XE `verify`
  command in its forms. Without an algorithm, the device checks the hashes
  and the signature that an image holds. With `md5` or `sha512`, it
  computes the digest, and with a `hash` too, it compares them and
  `verified` says whether they match. [#755] [#777]
- The IOS XE CLI adapter runs install commands with its `install` RPC: add,
  activate with an abort timer, commit, abort, remove and rollback. It says
  whether the device reloads. A device in bundle mode refuses `install add`
  alone, and `install add file F activate commit` converts it to install
  mode. [#777]
- The `configure` RPC of the IOS XE CLI adapter types configuration lines in
  `configure terminal` over an SSH shell, one at a time, and stops at the
  first line that the device rejects. `write-memory` saves the
  configuration. Install mode boots `bootflash:packages.conf`, which the
  boot statement has to name, and a conversion sets it this way. [#777]
- In mock mode, the IOS XE CLI adapter answers from a `CliMock`, which a test
  gets with `get_mock()` and gives the replies of the device. [#777]
- The IOS XE CLI adapter logs in once per device and keeps an SSH shell
  open, in which it types one command at a time. IOS XE closes the
  connection when an exec channel ends. The device is connected while the
  shell is ready. When a login fails, the connection closes, or a command
  gets no prompt within its time, the adapter reports the device as
  disconnected and logs in again. After a minute without a command, it
  types an empty line, so a dead connection shows. [#765] [#780]
- The `install` RPC of the IOS XE CLI adapter answers the question that
  `install remove` asks before it deletes files, which has no
  `prompt-level none` on IOS XE 17.15 and comes twice on 16.8, and the
  question of `install abort`. At debug level the adapter logs each command
  that it types and each question that it answers. [#780] [#799]
- The `ios-xe-cli` platform probe reads `show version` through the IOS XE CLI
  adapter, after the NETCONF probe, so an IOS XE device without NETCONF, like
  16.8 on a C1111, has a platform. Probes run over the modules of the
  connected adapters, so a device whose NETCONF went down reads its platform
  over the CLI. [#799]
- The IOS XE CLI adapter has a `copy` RPC, which fetches a file onto the
  device and tells how far it is from the `!` marks of the copy, and a
  `delete` RPC. It reads when the running and the startup configuration last
  changed, and the index of each file in `dir`. [#799]
- The IOS XE CLI adapter reads the BGP neighbors into `Cisco-IOS-XE-bgp-oper`
  from `show bgp ... neighbors`, in the shape that NETCONF gives them, and
  realizes subscriptions by polling, as the SNMP adapter does. The fleetmgr
  BGP upgrade checks then work on a device without NETCONF. The polling
  moved out of the SNMP adapter into the `adapters.polling.Poller` actor,
  which both adapters use. [#799]
- Fixed event notifications of the IOS XE `-events-oper` modules, like
  `interface-admin-state-change` in `Cisco-IOS-XE-ios-events-oper`, never
  arriving. The NETCONF adapter subscribed to them on the RFC 5277 `NETCONF`
  stream, which the device accepts but sends nothing on. It now subscribes to
  them on `yang-notif-native`, as it does for the `-events` modules. [#782]

### Software Images & Upgrades
- Software images can be uploaded over HTTP into an image folder, set with
  `--software.image-dir`. Upload with `PUT /image-file/<name>`, list with
  `GET /image-file` and remove with `DELETE /image-file/<name>`. The new
  `stratoweave-images` module adds an image list, `/images/image`. Add
  `swyang.images` to the top layer to use it. The list and the folder are not
  kept in sync yet. [#703]
- An image in `/images/image` has a `family`, like `c8000v-universalk9`, and
  a `default` flag. A family has at most one default image.
  `/images/url-base` says where devices fetch the images from: an image's URL
  is `url-base` followed by the image name. [#742] [#743]
- The device software state has two new leaves: `stage`, the step the
  run is in or ended in, and `reason`, set when a run fails or rolls back.
  The IOS XE adapter takes `reason` from the `txn-sub-state` of the failed
  install. [#669] [#678]
- The IOS XE mock can serve a BGP neighbor for the upgrade checks. Two new
  mock failures use it: with `bgp-down` the pre-check refuses the install, and
  with `bgp-lost` the post-check fails and the device rolls back. [#667]
  [#678]
- Removed `running-release` from the device software state. The release a
  device runs is in `state/platform/version`, which is read again when a
  software install ends, also after a rollback. [#718]
- Mock devices set the platform that the IOS XE mock reports under
  `mock/platform`: `version`, the release before an upgrade, `model` and
  `serial-number`. Without them a mock runs 17.18.02 on a C8000V.
  `mock/platform/version` replaces `mock/software/running-release`. The mock
  reports a release the way a device does, 17.18.02 as 17.18.2. [#718]
- Mock upgrades vary in length. Each takes a time within
  `mock/software/upgrade-duration-variance` percent of `upgrade-duration`,
  either way, 20 by default, so devices released together no longer all
  finish together. 0 keeps every upgrade at exactly `upgrade-duration`.
  [#770]
- A software veto holds only the install. The software manager still reads
  the release the device runs and reports `up-to-date`, or the new
  `upgrade-needed` when it differs. The vetoes are read again right before
  the install, so a veto added during the pre-checks holds it too. Before, a
  veto stopped even the read. [#775]
- The software state says which campaign and target release its status
  answers, in `state/upgrade-campaign` and `state/target-release`. A final
  status stands, so a reconnect or an unrelated config change no longer
  runs a failed upgrade again. The install installs the release the run
  read the device for, and a target changed during the pre-checks is read
  again before anything is installed. [#775]
- Under a veto, a read of the release that fails gives `unknown` with the
  error, and is read again when the device connects, or after a while.
  With `runtime-schema-fetch`, a NETCONF get or RPC on a device that has not
  connected yet fails as not connected, instead of with a missing schema. [#775]
- With `allow-staging`, the software manager prepares the target while a
  veto holds the install: it copies the image to the device ahead of the
  window, once per intent. The result is in `state/job[prepare]`, which also
  says which `release` it is for. A failed prepare leaves the status
  `upgrade-needed`. The prepare of a run reports in the same entry. Before,
  `allow-staging` was stored and not used. [#775]
- An image in `/images/image` can have the `md5`, `sha256` and `sha512`
  digests that its vendor publishes in its `checksum` list, and its `size`
  in bytes. A campaign copies them with the image URL into the software
  intent of each device, as `software/image-checksum` and
  `software/image-size`, for the device's adapter to check the staged image
  against. [#778]
- The IOS XE software adapter picks how each step of an upgrade runs from the
  modules of the device's connected adapters: over NETCONF where the device
  has the module for the step, else over the IOS XE CLI adapter. That covers
  reading the release and the versions, the transfer, the check, add,
  activate, commit and abort. It lists `bootflash:` over NETCONF
  (`Cisco-IOS-XE-platform-software-oper`) or the CLI, and checks a staged
  image with the CLI adapter's `verify`: against the image checksum of the
  intent, sha512 before md5, or else against the signature that the image
  holds. A device that can compute no checksum compares the size of the
  staged file with `software/image-size`. [#781] [#799]
- IOS XE prepare and install can run again at any time and do only what is
  left. A release that the device has added needs no image file, and a
  staged file that passes its check stays. A missing or failing file is
  transferred and checked again. Install activates a release that the
  device has added, and a release that the device runs activated and not
  committed is committed instead of reported up to date. When install add
  refuses an image as bad, the adapter deletes the file over NETCONF, so the
  next run transfers it again. [#781]
- Before it stages an image, the IOS XE adapter waits until each adapter of
  the device that is not connected, such as a CLI adapter that connects
  after NETCONF, has been without a connection for 2 minutes. The wait
  counts from when the adapter lost its connection or was set up, so the
  later stages of an upgrade do not wait again. [#781] [#799]
- The IOS XE software adapter converts a device in bundle mode, which it
  also detects over NETCONF, to install mode, and on IOS XE 16 it installs
  with one command, `install add file ... activate commit`. A C1111 went
  from 16.8.1 in bundle mode to 17.15.06 over the CLI alone. [#799]
- Before a transfer the IOS XE adapter looks for room for 2.2 times the
  image size, and before an add for 1.2 times. When short, it removes the
  software that the device does not run, once. The manager calls `cleanup`
  after the commit. A transfer that failed for lack of room says so. [#799]
- The IOS XE adapter removes another added release before it stages the
  target, and aborts another release pending commit before an install. It
  refuses to install while a change that someone made to the running
  configuration is not saved, and saves a change that the device made
  itself as it booted. [#799]
- The IOS XE commit window comes from the device's abort timer. [#799]
- A staged IOS XE image that passed a check is not checked again while its
  index, size and modification time in `dir` stay the same. [#799]
- The prepare job tells how far a transfer is, in `progress` and in its
  message: over NETCONF from the size of the file on bootflash, over the
  CLI from the output of the copy. A software adapter reports it with the
  new `SoftwareManager.report_transfer`. An xcopy also ends when the file
  has the image size, as IOS XE 17.9.5a records no xcopy. [#799]
- No upgrade runs while the device is not connected: the software manager
  waits as under a veto and reads the release again when an adapter
  connects. [#799]
- The install is a job in the device software state, `job[install]`. While
  the prepare or the install runs, the message of its job says what the
  device does, as the adapter reports it with the new
  `SoftwareManager.report_step`. After the install, the install job says
  when the commit window ends, until the run commits or rolls back. The
  IOS XE adapter reports the transaction that the device runs, like
  `add: extract` or `activate: reload`, the step lines of an install command
  over the CLI, the check and the transfer of the image, and `waiting for
  the device to boot`. The IOS XE CLI adapter has `install-progress`, the
  last step line of the install command that runs. The IOS XE mock lists a
  running operation in `Cisco-IOS-XE-install-oper` and takes it through its
  stages. [#803]
- The software intent has an `attempt`, 0 by default. The state has an
  entry for each attempt at the target in the campaign,
  `state/attempt[number]`, with its status, stage, reason, checks and
  jobs; the entries of earlier attempts stay. A final status stands for its
  attempt: a reconnect, a new device type, or the target removed and set
  again runs nothing. A new attempt reads the device again, and runs a
  failed upgrade again when no veto holds the install. A run of another
  attempt that is under way finishes first. When that run fails its
  rollback, the device may run the release it installed, uncommitted, so
  the new attempt does not start: it answers the new status `not-started`,
  with the failed attempt in its `reason`. A run that a new target or
  campaign, or a removed target, stops before its install ends at
  `upgrade-needed`. [#804]
- Images can be kept in folders inside the image folder. An image in
  `/images/image` has a new `file` leaf, the path of its file there, such as
  `iosxe/17.18/c8000v-universalk9.17.18.03a.SPA.bin`; without it the file is
  the image's name, as before. A device's URL is `url-base` followed by the
  file. Campaigns keep naming the image, so moving its file changes only the
  `file` leaf, and the campaigns give their members the new URL. Members
  that answered or finished keep their status, since the target release
  stays the same. `GET /image-file` lists the files in every folder, by
  path, and the folders under `folders`; `PUT /image-file/<path>` makes the
  folders on the way. `PUT` and `DELETE /image-folder/<path>` make a folder
  and remove one with everything in it, and `POST /image-move` with
  `{"from": ..., "to": ...}` moves or renames a file or folder without
  replacing anything.
- The software state shows the vetoes of the configuration under
  `state/veto`, with their reasons. [#811]

### Fleet Manager
- Campaigns show each device's pre-check and post-check verdicts, upgrade
  stage and failure reason, and the web UI draws each run as a chain of
  steps. How long the checks wait is set per device under `upgrade-checks`.
  [#667] [#669] [#678] [#700]
- Fixed replanning a campaign moving done and in-flight devices to the time
  of the replan. Released devices keep their real times, and only the
  waiting ones are placed again. A window that is already open is planned
  with the time it has left, instead of counting the devices that don't fit
  as late. [#672]
- Campaigns are paced by how many devices upgrade at the same time, with
  `target-concurrency` and `max-concurrency`, instead of `target-rate` and
  `max-rate` in devices per hour. With rates, slower upgrades put more
  devices in flight, which overloaded the system further. [#723]
- Fixed campaigns that never ended after a window of a schedule opened again
  while its earlier window still held released devices. The waiting devices
  were placed in both windows and counted twice. [#722]
- The release decisions of a campaign moved from the campaign actor into the
  `stratoweave.fleet_ctl.Controller` class. The controller has no clock and
  no I/O, so `test_fleet_ctl` runs it without an actor. [#725]
- Removed the `stratoweave.fleet_sched` module. Its helpers moved into
  `stratoweave.fleet_ctl`, and the campaign simulator
  `stratoweave.fleet_sched_sim` is now `stratoweave.fleet_ctl_sim`. [#740]
- A campaign's plan comes from the controller that releases the devices, run
  ahead at the expected upgrade durations. Before, a campaign could plan
  without alarms and raise alarms as soon as it ran, especially in fleets
  that mix fast and slow devices. Each device keeps the window its plan
  gives it, and a device that misses its window moves to the next window of
  its schedule. The controller goes above `target-concurrency`, up to
  `max-concurrency`, only when the windows or the deadline need it.
  `max-concurrency` counts the devices of the whole campaign. Plan alarms
  name the affected devices. A window that opened on an earlier day and is
  still open is used too. [#730]
- Devices can be members of redundancy groups, set under
  `/fleet/device/redundancy-group` with a `redundancy-priority`. A
  campaign upgrades the members of a group one at a time, lower priority
  first and equal priorities by name. `/redundancy-groups` sets how far
  apart they go: `spread`, the default, moves later members to later
  windows of the campaign where a device of the same estimate in no group
  can trade windows with them, and `pack` starts each member as soon as
  the one before it is done; both keep an optional `min-separation`. When
  the upgrade of a member fails or rolls back, the other members keep their
  windows and wait as the group's `failure-policy` says. The plan's alarms
  name the devices that wait. [#740]
- Fixed upgrade duration estimates being reduced by devices that already
  run the target release. These devices could cause the campaign to
  underestimate upgrade times and schedule too many devices in the first
  windows. [#740]
- A campaign no longer raises its concurrency for good when a device
  reports a few seconds late or upgrade times scatter around the estimate.
  The expected pace is the mean of the last upgrades, a round and a
  quarter at `target-concurrency`, and a device is late only a fifth of
  its upgrade after it was expected to end. Before, one late device could
  raise the concurrency for the rest of the campaign and give alarms.
  [#746]
- A window starts a device only while its close margin is left before the
  window closes, by default one and a half times the device's slow time.
  The slow time is the 98th percentile of the last upgrade times, two
  rounds at `max-concurrency` and at least 50, so the margin grows when
  slow upgrades show, and one slow upgrade alone moves it only through the
  mean of the last upgrades. Set the margin with `close-margin` on the
  campaign. Before, a fifth of the expected duration was the only margin,
  and upgrades in a heavy tail ran past the close. A device whose margin
  is longer than the time left in every window of its schedule does not
  start, and the plan says so. [#746]
- The ramp lets three more devices start for each device that is done
  without a failure, up to the concurrency, instead of doubling once a
  whole round has finished. A round now takes four times as many devices,
  the starts spread out as devices finish, and when the plan raises the
  concurrency, the extra devices start as devices finish instead of all
  at once. Failed upgrades no longer grow the ramp. [#746]
- A campaign spreads its starts over the `stagger`, in percent of the
  expected upgrade time: 25 by default. A device that starts holds the
  next start back by that part of its upgrade time, divided by the
  concurrency, so a larger campaign starts faster. Before, a window that
  opened with room for many devices started them all in the same second.
  [#748]
- Campaign plans are computed faster. The first plan for 100,000 devices
  takes seconds instead of minutes, and a decision that only starts devices
  reuses the last plan while no report came in, no device is due and no
  window opens or closes. [#748]
- Campaign decisions are about 6 times faster at 100,000 devices: a plan
  after a report takes 85 ms instead of 521 ms in a release build. Most of
  the gain is in the run ahead that computes a plan. The controller numbers
  the devices and keeps their state in lists by number, so a run ahead
  copies and indexes lists instead of hashing device names in tables of
  100,000 entries. Each step of the controller takes the reports that it
  has not counted yet from a heap ordered by time, instead of going through
  all of them. The windows of a schedule share one count of their waiting
  devices and one sort of the devices by estimate, instead of one per
  window. The campaign reads its members' schedules, estimates and
  redundancy groups from the inventory when the campaign or the inventory
  changes, instead of at every decision. [#787]
- Fixed a member whose final report came before its release, but in the
  same second, counting as an upgrade of one second. It happened to members
  that were already up to date when the campaign started, and dragged the
  campaign's pace down. [#766]
- Maintenance windows that are open at the same time share a campaign's
  free slots. Before, the window that opened first took every slot it
  could use, and a window that opened later waited until the first had
  nothing left to start. Each schedule with an open window now gets slots
  by the upgrade time it must start before the first of their last
  starts, counting the time it has after the others close. So a schedule
  with time of its own at the end leaves the slots to one that closes
  first, and a deadline needs about the concurrency it needed before.
  Windows that close together share in proportion to the upgrade time
  waiting in them. [#770]
- Fixed an edit of a campaign, or of its schedules, images, redundancy
  groups or member devices, removing the software intent of the devices
  that the campaign had released, until the campaign wrote it again a
  moment later. An upgrade that had not reached its install could fail.
  [#783]
- Campaigns acquire their members in `plan` and in `run`. Each member in
  the fleet gets the campaign's name, its target release and image URL, and
  a veto with the holder `campaign:NAME`, which holds the install. So each
  member reads the release it runs and answers `up-to-date` or
  `upgrade-needed`, and nothing is installed. A member added to a running
  campaign is acquired the same way. In `run`, the campaign removes a
  member's veto when it releases the member, and puts it back when the
  member is done. Before, a campaign wrote nothing until it released a
  member in a window. [#783]
- A device in the fleet is in one campaign at most, also while the
  campaign is in `plan` and after it is done. An edit that names a device
  in a second campaign fails with "Cannot merge leaves with different
  values at /software/upgrade-campaign". To move a device, remove it from
  its campaign, or delete the campaign, in an earlier edit. A device that
  is not in the fleet gets nothing from a campaign, so two campaigns can
  name it. The edit that adds it to the fleet then fails with the same
  error until only one campaign names it. [#783]
- A campaign's `device-status` shows a member's status only when the status
  is for the campaign's intent, its name and the member's target release,
  and `pending` otherwise. The counters count only those statuses. Before, a `succeeded` left from an earlier campaign made
  a member done at its release, with no upgrade. [#783]
- Setting a running campaign back to `plan` pauses it: members in flight
  stop before their install, and are released again when the campaign runs
  again. A member that still reports `in-progress` for the campaign when it
  runs again, or after a restart of fleetmgr, counts in flight and keeps
  the campaign's veto until it is done, or until it stops before its
  install. Stopping a campaign and running it again no longer retries its
  failed members. [#783]
- With `allow-staging`, a campaign in `run` lets each member that needs the
  upgrade, and that the plan gives a window, prepare its image once before
  its window, under the campaign's veto. The first member prepares at once.
  The others follow as far apart as their deadlines allow: the opening of
  the next window of the member's schedule, less `close-margin` percent of
  its expected prepare time. No member prepares while a window of its
  schedule is open, and a failed prepare is not tried again. In `plan`
  nothing is copied. The plan's new `prepare-start` says when each member
  prepares, and `prepare-concurrency` how many copies run at most at once;
  there is no cap. `device-status` shows each member's `prepare`, and the
  new counters `preparing` and `prepared` count the members that wait for
  their release. New plan alarms: "N device(s) cannot prepare before their
  window opens" and "N device(s) failed to prepare and copy the image in
  their window". The upgrade in the window still copies the image again.
  Before, `allow-staging` on a campaign had no effect. [#784]
- A campaign releases a member only once the member's status answers the
  campaign's target: `upgrade-needed`, or a final status. Until then the
  plan holds the member in its window, with the alarm "N device(s) have not
  answered the campaign's target", and the members after it in its
  redundancy groups with "N device(s) wait behind a redundancy group member
  that has not answered". `unknown` and `pending` are no answer. A campaign
  in `plan` plans again as its members answer, and plans a run that starts
  now, so its plan shows what `run` would do. So a member added to a
  running campaign waits until it has read the release it runs, and is then
  planned and released. A campaign created directly in `run` promises its
  windows in the order its members answer. Create it in `plan` first to
  keep the campaign's order. A decision that only starts devices still
  takes the last plan again when the plan's only alarms are for held
  devices. [#783]
- A campaign's new `failure-budget`, in percent of its members, stops its
  releases when more members have failed than the budget. The members in
  flight finish, and the plan's alarm says "N device(s) failed, more than
  the failure budget of M: no more devices start". To go on, raise or
  remove the budget, or remove failed members. Without a budget, a
  campaign releases as before. [#791]
- A campaign holds a waiting member while the member is down: its flotilla
  is not connected to it, or the top is not connected to its flotilla. The
  member starts when it is back up, so a dead flotilla holds only its own
  members. Before, a member that was down was released and failed. Each
  held member's `device-status` gives the reason in `held` and the device
  or flotilla that holds it in `held-by`, and `state/held` counts them. New
  plan alarms name the members that are down, the members in flight that
  are still down after their expected end, and the held members that lost
  the window promised to them. [#794]
- A campaign's new `notification-period`, in days, gives the customers of
  its members time to be told about their window: the campaign uses only
  the windows that open that long or more after it first went to `run`.
  That time is the campaign's `state/run-since`, and a pause and a restart
  of fleetmgr keep it. For a campaign from an earlier version, `run-since`
  is the time Fleet Manager first starts on this version, or, for a
  campaign in `plan`, the time it next goes to `run`. 0, the default, gives
  no notice. [#795]
- A campaign member has an `attempt`. Changing it tries the member again:
  the campaign takes it as a new member, its device reads its release
  again, and a member that failed is released again in a window. A member
  in flight gets the campaign's veto back; a run past its install finishes
  and holds its slot until it ends. Removing a member and adding it again
  no longer tries it again: its device keeps the final status of its
  attempt. `device-status` shows the attempt that counts, the one in
  progress or else the member's attempt, in its new `attempt`, and no
  longer the `upgrade-campaign` and `target-release` of the device. A
  member with a new attempt no longer counts against the failure budget.
  A new attempt set while a run fails its rollback does not start: the
  member shows `not-started`, counts as failed, and holds its redundancy
  groups as a failed rollback does, until it has another attempt. [#804]
- A redundancy group's new `failure-policy` says what a failed member does
  to the other members. With `continue`, the default, a member that failed
  or rolled back holds them only until it is done and up again, and the
  next member starts after the group's `min-separation`. A member whose
  rollback failed is in an unknown state, and holds them until an operator
  acts. With `hold`, the other members wait for an operator after any
  failure, as before. [#811]
- A campaign holds a member whose device has a veto of another holder,
  such as a service health check, until the veto goes. `device-status`
  shows the device's vetoes, and the held reason `vetoed` with the veto's
  holder in `held-by`; the members after it in its redundancy groups are
  held as `group-vetoed`. The plan's alarm says "N device(s) are held by a
  veto of another holder". A released member that gets such a veto before its
  run starts, or that the veto stops before its install, waits again and
  frees its slot. Before, the campaign released it, and it held a slot
  while its device did not install. [#811]
- Each `/fleet/device` has the platform that its flotilla reads from the
  device under `state/platform`, absent until the device has connected. A
  campaign's `device-status` has each member's `version` and `model` instead
  of `running-release`. The web UI shows the platform on the devices, device
  and campaign pages, and the devices page filters by model. [#718]
- The top always starts ten flotillas and places each device on `flotilla-N`
  by a hash of its name. Removed `/fleet/node` and `/fleet/device/shard`.
  Devices without a shard, which the top managed itself, are no longer
  supported. [#713]
- Campaigns select an `image` for each device instead of setting one
  `target-release` and `image-url` for the whole campaign. Images must be
  listed under `/images/image` with a `version`. The campaign does not
  configure an upgrade for a device if its image is missing from the list
  or has no version. An alarm identifies the image and how many devices
  are affected. The campaigns page no longer has a Release column. [#743]
  [#759]
- The new campaign page has three steps: pick devices by filtering or from
  pasted names, pick an image for each model in the selection, and create
  the campaign, which opens its page to set the schedule and pace. A
  family's default image is preselected when exactly one default image lists
  the model. Devices that haven't reported a model are left out, and a model
  that no image lists prevents campaign creation. [#743]
- The web UI has image pages. Image files dropped on them are uploaded, with
  OS, version and family filled in from IOS XE file names. An image can be
  made the default of its family, and the images page sets the image list's
  `url-base`. Deleting an image also deletes its file. [#709] [#742] [#743]
- The web UI's images page browses the image folder like a file manager:
  open folders, make them, upload into the one shown, and rename, move and
  delete files and folders, from a row's menu, by dragging rows onto a
  folder, or on several selected rows at once. A move changes the `file` of
  the images it takes along and keeps their names, also for images that
  campaigns install. An upload whose file name is already an image's name
  fails before the file is sent. Search covers the folder shown and the
  folders in it, and files that the image list lacks show, ready to add.
- The web UI has a Config page that shows the top's configuration, the state
  its transforms publish, or both, as XML, JSON or AData. The Apply config
  page merges JSON or XML configuration into the running system with a
  RESTCONF PATCH, after a confirmation. [#736]
- The web UI has a search, in the header or with Ctrl/⌘+K, that jumps to a
  page, campaign, image, device or schedule by name. [#737]
- The web UI has redundancy group pages: a list, one page per group with its
  members in upgrade order and its separation, and a page to create a group.
  A member's priority can be typed there, or the member dragged to another
  place, which sets the priorities that give that order. A change that
  reorders another group of the device asks first. The device page sets a
  device's groups and priority, and the devices page shows and filters by
  group. The demo fleet pairs devices in groups. A campaign's page shows the
  groups of its members, each member in upgrade order with its status and
  time. Groups held behind a failed member come first, with a button that
  takes that member out of the group. [#789]
- The campaign page has Schedule and pace under the plan, folded each time
  the page opens. The failed devices, the redundancy groups and the devices
  fold too, and only the failed devices start open. Folded, the redundancy
  groups say how many of them are held. [#789]
- The device page is redesigned around the device's upgrade run. [#674]
- The web UI's add and import device forms take a username and password,
  instead of writing admin/admin for every device. Import uses one pair for
  all its devices. [#726]
- The web UI works on narrow screens and has better contrast and
  accessibility. The campaign page leads with live progress and failures.
  [#679]
- The web UI no longer redraws the timeline every second and reads less from
  the server. Each page reads only the fields that it shows, with the
  RESTCONF `fields` query parameter. The devices and new-campaign pages and
  the search share one fleet read for 30 s, and the Refresh button reloads
  it. [#671] [#687] [#689] [#805]
- Web UI pages show at once and fill in as their reads arrive, and the
  sidebar marks the page that is loading. On large fleets the pages read
  less: the device page reads only the device's own `device-status` entry,
  a large campaign's page reads its state less often the longer the read
  takes, and adding, importing, removing or scheduling devices updates the
  devices list without reading the whole fleet again. Newly added devices
  show no model or version until the page is loaded again. [#754]
- The redundancy group pages, the campaigns list and the device page read
  only what they show, with the RESTCONF `fields` query parameter. At 20k
  devices the group pages read 2.8 MB of the fleet instead of 6.6 MB and
  the campaigns list 0.4 MB of the campaigns instead of 1.4 MB. The device
  page no longer reads the device's credentials. A campaign's counters are
  one read instead of four, and on the campaigns list the plan alarms come
  with them.
- Fixed the campaign plan timeline drawing a crowded window past its end.
  Its columns grow taller instead. [#761]
- fleetmgr and flotilla run Acton's generational garbage collector. Start
  them with `ACTON_GC_MODE=ordinary` for the ordinary collector. [#764]
- Removed the unused `cpe-device` model. The IOS XE device type directory is
  now `dev-iosxe`. [#694]
- `just demo-all` deploys the CEs, starts the top and loads both campaigns.
  [#690]
- `just run` starts the top and its ten flotillas with no devices, images or
  campaigns. [#736]
- `just build` builds fleetmgr and flotilla with `--release`, optimized for
  speed and without debug symbols. [#805]
- The web UI is built with SvelteKit 3, and `just gen-webui` needs Node 22.17
  or newer. [#739] [#745]
- A fleet device can have extra adapters, as a StratoWeave device can: the
  `extra-adapter` list with the type, address, port, credentials and SSH
  settings of each, which the transforms pass to the device on its
  flotilla. The flotillas register the device type `iosxe-cli`, the IOS XE
  CLI adapter, so an IOS XE device can have the CLI beside NETCONF. [#779]
- A fleet device has `upgrade-checks/enabled`, true by default. With false,
  its upgrades go without the BGP pre- and post-checks. [#799]
- The prepare in the upgrade status of a fleet device, and in the
  `device-status` of a campaign, has `progress`: how far the device's
  transfer is. [#799]
- The upgrade status of a fleet device, and the `device-status` of a
  campaign, have `install`: the device's install job, whose message says
  what the device does. The web UI shows it for each device of a campaign
  and on the device page, with a bar for the transfer of the prepare.
  [#803]

### Dependencies

#### Acton
- Requires Acton newer than 0.31.0, for explicit parameter defaults
  [acton#3211], the `Env` services [acton#2768] and the write barriers of
  the generational garbage collector [acton#3390].

#### acton-yang
- gdata is encoded as compact XML and JSON by default, as in the Acton
  stdlib. Pretty output was only meant for developers. [acton-yang#541]
  [#684]
- Removed the YANG parser statement cache and the `yang.compile_with_cache()`
  function. With the recent improvements to Acton RTS and GC that part of the
  pipeline is no longer significant. `~/.cache/ayang` is not used any more.
  [acton-yang#544] [#707]
- `DRoot.module_metadata` entries are `yang.schema.ModuleMetadata` tuples,
  with the module in `name` instead of `module`. The new `submodules` and
  `implemented` fields are for schema discovery APIs. [acton-yang#545] [#714]
- Optional APIs and generated constructors declare explicit defaults.
- Fixed YANG patterns with a `.` or `$` in a character class. The nokia-conf
  module of SR OS 25.10 failed to compile with "Invalid range bound", and
  `[.]` and `[$]` matched any character and the end of the string instead of
  a literal dot and dollar sign. [acton-yang#546] [acton-yang#547] [#729]
- YANG sources are parsed concurrently, which makes compiling large module
  sets faster. Removed `yang.parse_modules()` and `yang.compile_from_stmt()`,
  which were only needed for the statement cache. [acton-yang#550] [#734]
- `yang.schema.DRoot.merge()` merges compiled schema roots into one, like the
  CFS schema and ietf-yang-library that a northbound server serves together.
  It raises `ValueError` when two roots hold the same top-level node or
  different revisions of a module. [acton-yang#548] [#716]
- `take_leaf()` and `take_leaflist()` of the `yang.data.YangData` protocol
  return no `t` type field. gdata keeps a union's value as its Acton type,
  so the field is no longer needed. [acton-yang#553] [#741]
- The `take_container()`, `take_list()`, `take_leaf()` and `take_leaflist()`
  methods of `yang.data.YangData` no longer take the node's adata attribute
  name. The adata generator stores that name in the schema as the new
  `adata_name` of each node, and `yang.data.from_data()` reads it from there
  instead of computing it on every call. [acton-yang#552] [#762]
- `yang.schema.DNode.gname` is the node's `gdata.Id` instead of the name of
  its gdata class, like `Container`, and a `DList` has the `gdata.Id` of each
  key in `key_gnames`. `yang.data.from_data()` uses them instead of creating
  a `gdata.Id` for every node it reads, and the generated adata
  `from_gdata()` methods use `gdata.Id` constants of their module. Fleet
  Manager with 50,000 devices has all of them connected in 22 s instead of
  33 s. [acton-yang#557] [acton-yang#558] [#762] [#790]
- Fixed subscription data callbacks running in the provider's actor.
  `yang.gdata.Dst` and the data callback of `TreeProvider.declare_subscriptions`
  take an action again instead of a proc, so a consumer that passes its actor
  method gets the data in its own actor. A generated `dst()` converts each
  tree in an actor of its own instead of in the provider. [acton-yang#556]
  [#758]
- Fixed XML parser skipping a leaf with an empty tag, like `<k1/>` or
  `<k1></k1>`. Its normalized value is an empty string. This makes it
  possible to use the empty string as a key value too. [acton-yang#554]
  [#744]
- A `root_path` passed to `yang.data.from_data()` can lead to a notification,
  top-level or nested in a container, so a notification payload decodes like
  RPC output. [acton-yang#555] [#751]
- Fixed XML decoding keeping only the first of a container element that
  occurs more than once in the same parent. IOS XE 17.15 periodic yang-push
  updates repeat `<neighbors>` for each BGP neighbor, so a NETCONF
  subscription got only the first neighbor and the fleetmgr BGP post-check
  failed. The occurrences are now read as one container. [acton-yang#560]
  [#802]
- `yang.restconf.resolve_fields()` parses a RESTCONF `fields` value against
  the schema below the target resource, and `select_fields()` narrows data
  to the result. [acton-yang#561] [#805]

#### acton-ssh
- Fixed SSH events being delivered out of the order libssh raises them.
  Under load, pipe streams were reordered and broke NETCONF chunk framing.
  [acton-ssh#15] [#670]
- Fixed a `Client` hanging forever when its `on_hostkey` handler never
  responds. `connect_timeout` also covers the `on_hostkey` decision.
  [acton-ssh#6] [#707]
- `SshPipe` takes `connect_timeout` and `auth_timeout`. Before, it always
  used the `Client` defaults of 10 seconds. [acton-ssh#18] [#707]
- `SshPipe` can request an interactive shell with `shell=True`, instead of a
  subsystem or a command. [acton-ssh#20] [#714]
- Builds with Zig 0.17. [acton-ssh#17] [#670]
- Connect failures are reported as `ssh.SshError`, or its subclasses
  `KeyExchangeError`, `HostKeyError` and `AuthenticationError`, instead of
  an `OSError` for everything. An `OSError` is left for failures before the
  server's SSH banner, like a refused TCP connect. `Client.on_connect` gets
  an exception instead of a string. [acton-ssh#21] [#720]
- Stores GC pointers with write barriers, so programs that link it can run
  in Acton's generational GC mode. [acton-ssh#23] [#764]
- `ssh.Server` serves interactive shells when it gets an `on_shell` action,
  which receives the client's terminal as a `PtyRequest`, or `None` when the
  client asked for none. Without `on_shell` the server refuses shells, as
  before. `Channel.change_pty_size()` sends a terminal size change, which a
  `ServerChannel` receives with `on_window_change`. [acton-ssh#24] [#780]
- Fixed writes that queue more than 8 MiB failing their channel, which kept
  a NETCONF message over 8 MiB from going out over an `SshPipe`.
  `max_write_buffer` of `Client` and `Server` defaults to 0, no limit.
  Writes go to libssh in pieces of at most 256 KiB, which also bounds
  libssh's send buffer per connection. [acton-ssh#25] [#788]

#### acton-lmdb
- Builds with Zig 0.17. [acton-lmdb#6] [#670]

#### actmf
- Updated for explicit defaults.

#### actsnmp
- New dependency: an SNMP implementation in Acton, with SNMPv1, v2c and v3
  and a MIB compiler that emits YANG (RFC 6643). The SNMP device adapters use
  it. [#701]

#### http-router
- Query parameter names and values are percent-decoded.
  `Context.query()` gives every value of each name as a list, in request
  order, instead of one value, and `query_param()` gives the first. [#805]

### Documentation
- The software upgrade reference is rewritten to match the code, and is part
  of the guide. [#697] [#699]
- The guide has a Releases page, which includes this changelog, and a
  Roadmap page. [#800]

### Testing & CI
- Downstream upgrade PRs run `make gen`, so changes to generated code don't
  break the downstream's checks. [#706]
- Removed the actor pipe restart stress test, which was too slow for CI.
  [#696]
- Fixed the build of the multi-arch `ghcr.io/stratoweave/ncurl:latest` image
  on runners with Docker Engine 29. [#735]
- The notconf tests connect to 127.0.0.1 instead of `localhost`, which macOS
  resolves to IPv6 first, where Docker's published port does not answer.
  [#751]
- Fixed `just system-test` in fleetmgr timing out. It runs each system test
  once. [#747]
- The `gc-check` CI job runs the fleetmgr tests with `acton test --gc-check`
  and the fleetmgr demo for a minute under the GC write-barrier checker.
  [#764]

### Compatibility Notes
- Requires Acton newer than 0.31.0. Regenerate generated code with `make gen`
  after upgrading. [#704] [#714] [#764]
- `adapter_type` and `software_adapter_type` in a `DeviceType` take `?Env`
  instead of `?net.TCPConnectCap`. Adapters in other repositories, like
  sw-adapter-cisco-ios-cli, need the same change. [#702]
- gdata `to_xmlstr()` and `to_yang_jsonstr()` return compact output by
  default. Pass `pretty=True` for indented output. [acton-yang#541] [#684]
- `/restconf-state/capabilities` no longer lists YANG modules. Read them from
  `/ietf-yang-library:modules-state` or `/ietf-yang-library:yang-library`
  instead. [#676] [#716]
- The NETCONF server's `<hello>` lists no module capabilities, only
  `yang-library:1.1`. Clients that take the server's modules from the
  `<hello>` must read them from `/yang-library` or `/modules-state`. [#716]
- The device software state has no `running-release`. Read the release a
  device runs from `state/platform/version`, and in Fleet Manager from the
  `version` of a campaign's `device-status`. Mock devices take the release
  they start on as `mock/platform/version` instead of
  `mock/software/running-release`. [#718]
- An app with its own `device_types.act` must add
  `import stratoweave.platform_probes as swplat` and
  `platform_probes: list[swdev.PlatformProbe] = swplat.PROBES` to it. The
  generated `sysspec.act` reads `platform_probes` from it, and the generator
  does not change an existing `device_types.act`. [#712]
- Fleet Manager has no `/fleet/node` and `/fleet/device/shard`. Remove them
  from its configuration. [#713]
- Fleet Manager campaigns take `target-concurrency` and `max-concurrency`
  instead of `target-rate` and `max-rate`. Move configuration that sets the
  old leaves. A campaign that sets neither upgrades 10 devices at once and
  goes up to 50 when its windows or deadline need it. There is no unlimited
  value. [#723] [#730]
- Fleet Manager campaigns take an `image` in each `device` entry instead of
  `target-release` and `image-url`. Add the images to `/images/image`, with
  their `version`, set `/images/url-base`, and name an image for each member.
  [#743]
- A device can be in one Fleet Manager campaign only. Before you upgrade,
  remove each device that two campaigns name from one of them. Otherwise
  Fleet Manager cannot load its configuration and does not start. [#783]
- Since a NETCONF `<edit-config>` transaction completes before the devices
  have applied their configuration, a device rejecting its configuration is
  no longer reported as an `rpc-error`. The device side is visible per
  device instead: `state/adapter` shows whether it is connected, and the
  inspection API's `/device/<name>/info` and `/device/<name>/log` show its
  queue and what was sent to it. [#792]

## [26.10] - 2026-10-23

Hello, world! This is the first formal release of StratoWeave, woven from
first principles.

There’s still work ahead before it’s ready for production, but it’s coming
together quickly, and we think it’s ready for people to pick up and try. This
release is an invitation to explore, experiment, and help shape what comes
next. Give it a spin. We’d love to hear what you think.

[26.10]: https://github.com/stratoweave/stratoweave/releases/tag/v26.10
[#667]: https://github.com/stratoweave/stratoweave/pull/667
[#669]: https://github.com/stratoweave/stratoweave/pull/669
[#670]: https://github.com/stratoweave/stratoweave/pull/670
[#671]: https://github.com/stratoweave/stratoweave/pull/671
[#672]: https://github.com/stratoweave/stratoweave/pull/672
[#674]: https://github.com/stratoweave/stratoweave/pull/674
[#675]: https://github.com/stratoweave/stratoweave/pull/675
[#676]: https://github.com/stratoweave/stratoweave/pull/676
[#677]: https://github.com/stratoweave/stratoweave/pull/677
[#678]: https://github.com/stratoweave/stratoweave/pull/678
[#679]: https://github.com/stratoweave/stratoweave/pull/679
[#680]: https://github.com/stratoweave/stratoweave/pull/680
[#681]: https://github.com/stratoweave/stratoweave/pull/681
[#683]: https://github.com/stratoweave/stratoweave/pull/683
[#684]: https://github.com/stratoweave/stratoweave/pull/684
[#685]: https://github.com/stratoweave/stratoweave/pull/685
[#686]: https://github.com/stratoweave/stratoweave/pull/686
[#687]: https://github.com/stratoweave/stratoweave/pull/687
[#689]: https://github.com/stratoweave/stratoweave/pull/689
[#690]: https://github.com/stratoweave/stratoweave/pull/690
[#691]: https://github.com/stratoweave/stratoweave/pull/691
[#692]: https://github.com/stratoweave/stratoweave/pull/692
[#693]: https://github.com/stratoweave/stratoweave/pull/693
[#694]: https://github.com/stratoweave/stratoweave/pull/694
[#696]: https://github.com/stratoweave/stratoweave/pull/696
[#697]: https://github.com/stratoweave/stratoweave/pull/697
[#698]: https://github.com/stratoweave/stratoweave/pull/698
[#699]: https://github.com/stratoweave/stratoweave/pull/699
[#700]: https://github.com/stratoweave/stratoweave/pull/700
[#701]: https://github.com/stratoweave/stratoweave/pull/701
[#702]: https://github.com/stratoweave/stratoweave/pull/702
[#703]: https://github.com/stratoweave/stratoweave/pull/703
[#704]: https://github.com/stratoweave/stratoweave/pull/704
[#706]: https://github.com/stratoweave/stratoweave/pull/706
[#707]: https://github.com/stratoweave/stratoweave/pull/707
[#709]: https://github.com/stratoweave/stratoweave/pull/709
[#712]: https://github.com/stratoweave/stratoweave/pull/712
[#713]: https://github.com/stratoweave/stratoweave/pull/713
[#714]: https://github.com/stratoweave/stratoweave/pull/714
[#716]: https://github.com/stratoweave/stratoweave/pull/716
[#717]: https://github.com/stratoweave/stratoweave/pull/717
[#718]: https://github.com/stratoweave/stratoweave/pull/718
[#719]: https://github.com/stratoweave/stratoweave/pull/719
[#720]: https://github.com/stratoweave/stratoweave/pull/720
[#721]: https://github.com/stratoweave/stratoweave/pull/721
[#722]: https://github.com/stratoweave/stratoweave/pull/722
[#723]: https://github.com/stratoweave/stratoweave/pull/723
[#724]: https://github.com/stratoweave/stratoweave/pull/724
[#725]: https://github.com/stratoweave/stratoweave/pull/725
[#726]: https://github.com/stratoweave/stratoweave/pull/726
[#729]: https://github.com/stratoweave/stratoweave/pull/729
[#730]: https://github.com/stratoweave/stratoweave/pull/730
[#731]: https://github.com/stratoweave/stratoweave/pull/731
[#734]: https://github.com/stratoweave/stratoweave/pull/734
[#735]: https://github.com/stratoweave/stratoweave/pull/735
[#736]: https://github.com/stratoweave/stratoweave/pull/736
[#737]: https://github.com/stratoweave/stratoweave/pull/737
[#739]: https://github.com/stratoweave/stratoweave/pull/739
[#740]: https://github.com/stratoweave/stratoweave/pull/740
[#741]: https://github.com/stratoweave/stratoweave/pull/741
[#742]: https://github.com/stratoweave/stratoweave/pull/742
[#743]: https://github.com/stratoweave/stratoweave/pull/743
[#744]: https://github.com/stratoweave/stratoweave/pull/744
[#745]: https://github.com/stratoweave/stratoweave/pull/745
[#746]: https://github.com/stratoweave/stratoweave/pull/746
[#747]: https://github.com/stratoweave/stratoweave/pull/747
[#748]: https://github.com/stratoweave/stratoweave/pull/748
[#751]: https://github.com/stratoweave/stratoweave/pull/751
[#752]: https://github.com/stratoweave/stratoweave/pull/752
[#753]: https://github.com/stratoweave/stratoweave/pull/753
[#754]: https://github.com/stratoweave/stratoweave/pull/754
[#755]: https://github.com/stratoweave/stratoweave/pull/755
[#756]: https://github.com/stratoweave/stratoweave/pull/756
[#758]: https://github.com/stratoweave/stratoweave/pull/758
[#759]: https://github.com/stratoweave/stratoweave/pull/759
[#761]: https://github.com/stratoweave/stratoweave/pull/761
[#762]: https://github.com/stratoweave/stratoweave/pull/762
[#763]: https://github.com/stratoweave/stratoweave/pull/763
[#764]: https://github.com/stratoweave/stratoweave/pull/764
[#765]: https://github.com/stratoweave/stratoweave/pull/765
[#766]: https://github.com/stratoweave/stratoweave/pull/766
[#770]: https://github.com/stratoweave/stratoweave/pull/770
[#775]: https://github.com/stratoweave/stratoweave/pull/775
[#776]: https://github.com/stratoweave/stratoweave/pull/776
[#777]: https://github.com/stratoweave/stratoweave/pull/777
[#778]: https://github.com/stratoweave/stratoweave/pull/778
[#779]: https://github.com/stratoweave/stratoweave/pull/779
[#780]: https://github.com/stratoweave/stratoweave/pull/780
[#781]: https://github.com/stratoweave/stratoweave/pull/781
[#782]: https://github.com/stratoweave/stratoweave/pull/782
[#783]: https://github.com/stratoweave/stratoweave/pull/783
[#784]: https://github.com/stratoweave/stratoweave/pull/784
[#787]: https://github.com/stratoweave/stratoweave/pull/787
[#788]: https://github.com/stratoweave/stratoweave/pull/788
[#789]: https://github.com/stratoweave/stratoweave/pull/789
[#790]: https://github.com/stratoweave/stratoweave/pull/790
[#791]: https://github.com/stratoweave/stratoweave/pull/791
[#792]: https://github.com/stratoweave/stratoweave/pull/792
[#794]: https://github.com/stratoweave/stratoweave/pull/794
[#795]: https://github.com/stratoweave/stratoweave/pull/795
[#799]: https://github.com/stratoweave/stratoweave/pull/799
[#800]: https://github.com/stratoweave/stratoweave/pull/800
[#802]: https://github.com/stratoweave/stratoweave/pull/802
[#803]: https://github.com/stratoweave/stratoweave/pull/803
[#804]: https://github.com/stratoweave/stratoweave/pull/804
[#805]: https://github.com/stratoweave/stratoweave/pull/805
[#811]: https://github.com/stratoweave/stratoweave/pull/811
[acton#2768]: https://github.com/actonlang/acton/pull/2768
[acton#3211]: https://github.com/actonlang/acton/pull/3211
[acton#3390]: https://github.com/actonlang/acton/pull/3390
[acton-lmdb#6]: https://github.com/stratoweave/acton-lmdb/pull/6
[acton-ssh#6]: https://github.com/actonlang/acton-ssh/pull/6
[acton-ssh#15]: https://github.com/actonlang/acton-ssh/pull/15
[acton-ssh#17]: https://github.com/actonlang/acton-ssh/pull/17
[acton-ssh#18]: https://github.com/actonlang/acton-ssh/pull/18
[acton-ssh#20]: https://github.com/actonlang/acton-ssh/pull/20
[acton-ssh#21]: https://github.com/actonlang/acton-ssh/pull/21
[acton-ssh#23]: https://github.com/actonlang/acton-ssh/pull/23
[acton-ssh#24]: https://github.com/actonlang/acton-ssh/pull/24
[acton-ssh#25]: https://github.com/actonlang/acton-ssh/pull/25
[acton-yang#541]: https://github.com/stratoweave/acton-yang/pull/541
[acton-yang#544]: https://github.com/stratoweave/acton-yang/pull/544
[acton-yang#545]: https://github.com/stratoweave/acton-yang/pull/545
[acton-yang#546]: https://github.com/stratoweave/acton-yang/pull/546
[acton-yang#547]: https://github.com/stratoweave/acton-yang/pull/547
[acton-yang#548]: https://github.com/stratoweave/acton-yang/pull/548
[acton-yang#550]: https://github.com/stratoweave/acton-yang/pull/550
[acton-yang#552]: https://github.com/stratoweave/acton-yang/pull/552
[acton-yang#553]: https://github.com/stratoweave/acton-yang/pull/553
[acton-yang#554]: https://github.com/stratoweave/acton-yang/pull/554
[acton-yang#555]: https://github.com/stratoweave/acton-yang/pull/555
[acton-yang#556]: https://github.com/stratoweave/acton-yang/pull/556
[acton-yang#557]: https://github.com/stratoweave/acton-yang/pull/557
[acton-yang#558]: https://github.com/stratoweave/acton-yang/pull/558
[acton-yang#560]: https://github.com/stratoweave/acton-yang/pull/560
[acton-yang#561]: https://github.com/stratoweave/acton-yang/pull/561
