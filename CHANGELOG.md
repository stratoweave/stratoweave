# Changelog

## Unreleased

### Core
- Transform actors can write to the layer below at any time, each write in
  its own transaction. Enable it with `sw:direct-output` under
  `sw:transform`, and keep the transform function mute, or the output is
  repeated. `fleetmgr.cfs.UpgradeCampaignTransform` is an example. [#698]
- A transform's output replaces the configuration it wrote before, instead of
  being applied as a diff. This fixes source deletion, concurrent edits,
  restored list membership and subscriptions on newly committed list
  elements. [#680]
- A session commit reports `done` and `complete` only after every transform
  below it has committed. Before, a link subscriber could commit without its
  linked input. [#685]
- Fixed a deadlock in `update_dynstate` when the root transform was blocked
  on a `get_data` call to the same transaction. [#675]
- Optional parameters declare explicit defaults, which newer Acton versions
  require. The transform generator emits them too.
- Child processes, environment variables and stdin go through the `Env`
  services: `env.process`, `env.vars` and `env.stdio`. [#704]
- Fixed the etcd store leaving a request without a result when etcd answers
  with an HTTP error whose body is not UTF-8. [#724]

### Northbound APIs
- NETCONF `<get-config>` returns only configuration, without the operational
  state published by transforms. [#683]
- RESTCONF supports the `content` query parameter (`config`, `nonconfig`,
  `all`) on GET. [#686]
- RESTCONF GET, NETCONF `<get>` and yang-push filters can reach an
  operational subtree under a config node, like
  `/software:software/upgrade-campaign=foo/state` in fleetmgr. [#677] [#681]
- `/restconf-state/capabilities` lists only RESTCONF protocol capabilities,
  not YANG modules. [#676]
- RESTCONF replies use compact JSON and XML. `ncurl` output and the
  `/device/<name>/target`, `/running` and `/diff` inspection endpoints are
  still indented. [#684]

### Devices & Adapters
- New SNMP device adapters, built from MIBs. The system generator translates
  the MIBs to YANG and generates Acton types and subscription paths from
  them. Transforms choose the polling period, and the SNMPv2c adapter uses
  `credentials/password` as the community. Mini has an example `ietf_snmp`
  device type with SNMPv2-MIB and IF-MIB. See the SNMP devices reference.
  [#701]
- Device and software adapters get the `Env` instead of a `TCPConnectCap`, so
  they can use other transports, like UDP for SNMP, or start subprocesses.
  [#702]
- Each device publishes its operating system family, release, chassis model
  and serial number under `state/platform`. A platform probe reads them on
  every connect and after a software install. StratoWeave comes with probes
  for IOS XE, IOS XR, Junos, SR Linux, SR OS and ArcOS, and an app sets its
  probes with `platform_probes` in its `device_types.act`. See the device
  platform reference. [#712] [#717]
- A device without yang-library or netconf-monitoring also gets its other
  hello capabilities in its module set, named by their URI, but not the
  NETCONF protocol ones. Before, a Junos from before YANG, like 10.4, had an
  empty module set, so no platform probe applied and transforms computed
  nothing for it. The Junos probe applies on its
  `http://xml.juniper.net/netconf/junos/1.0` capability. [#721]
- The NETCONF adapter fails a get whose filter names a node that the device
  schema lacks, with `Filter node <path> not found in device schema`. Before,
  those nodes were dropped from the reply without an error. [#712]
- `ncurl` takes `--ssh-key-exchange`, `--ssh-host-key-algorithm`,
  `--ssh-cipher` and `--ssh-mac`, each repeatable, for devices that only
  offer old SSH algorithms, like Junos 10.4. Its new `platform` command
  prints the platform the probes read. The default port is 830 instead of
  42830, and without `--password` it asks for the password instead of using
  `admin`. [#717] [#720]
- The NETCONF adapter connects again after refused credentials, an untrusted
  host key or no SSH algorithm in common once a minute instead of every
  second. Retrying sooner piles up failed logins, which some devices count
  towards locking the account. A change of the device's settings connects
  at once. [#720]
- Fixed NETCONF RPCs to Junos 10.4 waiting until their timeout. Its replies
  carry `xmlns` twice, which is not valid XML. The NETCONF client drops the
  repeated attribute with the new `duplicate-attributes` fixup. [#719]
- Fixed "Invalid NETCONF chunk framing" errors around NETCONF session
  restarts, seen with large mock fleets. After such an error the device
  adapter restarts the session once, not once for every write. [#691] [#693]
- The mock NETCONF server ends a session's yang-push subscriptions when the
  session ends. Before, every client restart added another set of updates.
  [#692]

### Software Images & Upgrades
- Software images can be uploaded over HTTP into an image folder, set with
  `--software.image-dir`. Upload with `PUT /image-file/<name>`, list with
  `GET /image-file` and remove with `DELETE /image-file/<name>`. The new
  `stratoweave-images` module adds an image list, `/images/image`. Add
  `swyang.images` to the top layer to use it. The list and the folder are not
  kept in sync yet. [#703]
- The device software state has two new leaves: `stage`, the step the
  run is in or ended in, and `reason`, set when a run fails or rolls back.
  The IOS XE adapter takes `reason` from the `txn-sub-state` of the failed
  install. [#669] [#678]
- The IOS XE mock can serve a BGP neighbor for the upgrade checks. Two new
  mock failures use it: with `bgp-down` the pre-check refuses the install, and
  with `bgp-lost` the post-check fails and the device rolls back. [#667]
  [#678]

### Fleet Manager
- Campaigns show each device's pre-check and post-check verdicts, upgrade
  stage and failure reason, and the web UI draws each run as a chain of
  steps. How long the checks wait is set per device under `upgrade-checks`.
  [#667] [#669] [#678] [#700]
- Replanning a campaign keeps released devices at their real times and places
  only the waiting ones again. Before, done and in-flight devices moved to
  the time of the replan. A window that is already open is planned with the
  time it has left, instead of counting the devices that don't fit as late.
  [#672]
- A campaign is paced by how many devices upgrade at the same time,
  `target-concurrency` and `max-concurrency`, instead of `target-rate` and
  `max-rate` in devices per hour. With rates, slower upgrades put more
  devices in flight, which overloaded the system further. The web UI edits
  them as "At once" and "Max at once". [#723]
- Fixed campaigns that never ended after a window of a schedule opened again
  while its earlier window still held released devices. The waiting devices
  were placed in both windows and counted twice. [#722]
- A campaign's plan is what its run does: the controller that releases the
  devices makes the plan by running ahead at the expected upgrade durations.
  Before, a campaign could plan without alarms and alarm as soon as it ran,
  most of all in fleets that mix fast and slow devices. A window takes the
  devices that the ramp starts before it closes, each device keeps the
  window its plan gives it, and a device that misses its window moves to the
  next one of its schedule. The controller goes above `target-concurrency`
  only as far as those windows or the deadline need, up to
  `max-concurrency`, which now counts the devices of the whole campaign. The
  alarms name the devices. A window that opened on an earlier day and is
  still open now counts. [#730]
- The top always starts ten flotillas and places each device on `flotilla-N`
  by a hash of its name. Removed `/fleet/node` and `/fleet/device/shard`.
  Devices without a shard, which the top managed itself, are no longer
  supported. [#713]
- The web UI has image pages. Drop image files on them to upload them. OS and
  version are filled in from IOS XE file names. Deleting an image also
  deletes its file. [#709]
- The device page is redesigned around the device's upgrade run. [#674]
- The web UI's add and import device forms take a username and password,
  instead of writing admin/admin for every device. Import uses one pair for
  all its devices. [#726]
- The web UI is clearer, works on narrow screens and has better contrast and
  accessibility. [#679]
- The web UI reads less from the server and no longer redraws the timeline
  every second, which helps with large campaigns. The devices, schedules and
  new-campaign pages share one fleet read for 30 s, and the Refresh button
  reloads it. A few UI bugs are fixed. [#671] [#687] [#689]
- Removed the unused `cpe-device` model. The IOS XE device type directory is
  now `dev-iosxe`. [#694]
- `just demo-all` deploys the CEs, starts the top and loads both campaigns.
  [#690]

### Dependencies

#### Acton
- Requires Acton newer than 0.31.0, for explicit parameter defaults
  [acton#3211] and the `Env` services [acton#2768].

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

#### acton-ssh
- SSH events are delivered in the order libssh raises them. Under load, pipe
  streams were reordered and broke NETCONF chunk framing. [acton-ssh#15]
  [#670]
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

#### acton-lmdb
- Builds with Zig 0.17. [acton-lmdb#6] [#670]

#### actmf
- Updated for explicit defaults.

#### actsnmp
- New dependency: an SNMP implementation in Acton, with SNMPv1, v2c and v3
  and a MIB compiler that emits YANG (RFC 6643). The SNMP device adapters use
  it. [#701]

### Documentation
- The software upgrade reference is rewritten to match the code, and is part
  of the guide. [#697] [#699]

### Testing & CI
- Downstream upgrade PRs run `make gen`, so changes to generated code don't
  break the downstream's checks. [#706]
- Removed the actor pipe restart stress test, which was too slow for CI.
  [#696]

### Compatibility Notes
- Requires Acton newer than 0.31.0. Regenerate generated code with `make gen`
  after upgrading. [#704] [#714]
- `adapter_type` and `software_adapter_type` in a `DeviceType` take `?Env`
  instead of `?net.TCPConnectCap`. Adapters in other repositories, like
  sw-adapter-cisco-ios-cli, need the same change. [#702]
- gdata `to_xmlstr()` and `to_yang_jsonstr()` return compact output by
  default. Pass `pretty=True` for indented output. [acton-yang#541] [#684]
- `/restconf-state/capabilities` no longer lists YANG modules. The RESTCONF
  server doesn't serve ietf-yang-library yet, so there is no replacement.
  [#676]
- An app with its own `device_types.act` must add
  `import stratoweave.platform_probes as swplat` and
  `platform_probes: list[swdev.PlatformProbe] = swplat.PROBES` to it. The
  generated `sysspec.act` reads `platform_probes` from it, and the generator
  does not change an existing `device_types.act`. [#712]
- Fleet Manager has no `/fleet/node` and `/fleet/device/shard`. Remove them
  from its configuration. [#713]
- Fleet Manager campaigns take `target-concurrency` and `max-concurrency`
  instead of `target-rate` and `max-rate`. Move configuration that sets the
  old leaves. A campaign that sets neither now upgrades up to 10 devices at
  once, and there is no unlimited value. [#723]

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
[#717]: https://github.com/stratoweave/stratoweave/pull/717
[#719]: https://github.com/stratoweave/stratoweave/pull/719
[#720]: https://github.com/stratoweave/stratoweave/pull/720
[#721]: https://github.com/stratoweave/stratoweave/pull/721
[#722]: https://github.com/stratoweave/stratoweave/pull/722
[#723]: https://github.com/stratoweave/stratoweave/pull/723
[#724]: https://github.com/stratoweave/stratoweave/pull/724
[#726]: https://github.com/stratoweave/stratoweave/pull/726
[acton#2768]: https://github.com/actonlang/acton/pull/2768
[acton#3211]: https://github.com/actonlang/acton/pull/3211
[acton-lmdb#6]: https://github.com/stratoweave/acton-lmdb/pull/6
[acton-ssh#6]: https://github.com/actonlang/acton-ssh/pull/6
[acton-ssh#15]: https://github.com/actonlang/acton-ssh/pull/15
[acton-ssh#17]: https://github.com/actonlang/acton-ssh/pull/17
[acton-ssh#18]: https://github.com/actonlang/acton-ssh/pull/18
[acton-ssh#20]: https://github.com/actonlang/acton-ssh/pull/20
[acton-ssh#21]: https://github.com/actonlang/acton-ssh/pull/21
[acton-yang#541]: https://github.com/stratoweave/acton-yang/pull/541
[acton-yang#544]: https://github.com/stratoweave/acton-yang/pull/544
[acton-yang#545]: https://github.com/stratoweave/acton-yang/pull/545
