# Device platform

StratoWeave reads what each device is: its operating system family, its
release, its chassis model and its serial number. A platform probe does the
read. StratoWeave comes with probes, and an app can add its own or replace
them.

## Parts

| Part | Where | Role |
| --- | --- | --- |
| `PlatformProbe` | `src/device.act` | Reads the platform of a device. |
| `GetPlatformProbe` | `src/device.act` | A probe that needs one get. Most probes are one. |
| `platform_probes.PROBES` | `src/platform_probes.act` | The probes that come with StratoWeave. |
| `platform_probes.MODELS` | `src/platform_probes.act` | The YANG those probes read, for a device type that does not know the OS. |
| The probes | `src/adapters/platform_<os>.act` | One module per OS, with its pruned YANG in `platform_<os>_yang.act`. |
| `ncurl platform` | `src/ncurl.act` | Reads one device with `PROBES` and prints its platform. |
| `SysSpec.platform_probes` | `src/app.act` | The app's list of probes. `PROBES` unless the app gives its own. |
| `DeviceType.platform_probes` | `src/device.act` | Probes for devices of one type. They run before the app's list. |
| `DeviceMgr` | `src/device.act` | Picks the probe, runs it and publishes the answer. |

## State

Published under `stratoweave-rfs:device=<name>/state/platform`. Not
persisted: after a restart it is empty until the device connects.

| Leaf | Meaning |
| --- | --- |
| `os` | Operating system family: `ios-xe`, `ios-xr`, `junos`, `srlinux`, `sros` or `arcos`. The probe sets it; it is not read from the device. |
| `version` | Release as the device reports it, for example `17.18.2`. |
| `model` | Chassis model, for example `C8000V`. |
| `serial-number` | Chassis serial number. |
| `probe` | Name of the probe that read the values. |

The version is the release as the device spells it, without what the device
puts around it: the IOS XE banner, the `v` and the build of SR Linux, the
image type of SR OS. Compare it with a release name through the platform's
`SoftwareAdapter.matches_release`, not with `==`: IOS XE reports `17.18.3a`
for an image called `17.18.03a`.

## When the platform is read

- On every connect.
- After a software install, because the release can change without a
  reconnect.

Nothing polls. A box that is replaced comes with a new connection.

## Which probe runs

`DeviceMgr` walks this list and runs the first probe that applies:

```text
device type's probes  +  app's probes (SysSpec.platform_probes)
```

A probe's `applies` looks only at the device's module set. So the same
modules always pick the same probe, and no read is needed to pick it. There
are no scores: when two probes apply, the one earlier in the list runs.

A device that lists its modules in its NETCONF hello, without yang-library
or netconf-monitoring, also gets its other hello capabilities in its module
set, named by their URI, but not the NETCONF protocol ones. A device from
before YANG lists no modules, so these are what a probe can apply to.

| The probe | `DeviceMgr` |
| --- | --- |
| does not apply | tries the next probe in the list |
| answers | publishes the answer |
| gives `PlatformMismatch` | tries the next probe that applies |
| fails, or gives no values | keeps the values if this probe read them, else removes them, and runs the probe again after 5 seconds |
| gives `NotConnectedError` | stops; the next connect reads again |

- A probe that fails again waits twice as long each time, up to 300 seconds.
- A failed read does not go on to the next probe. Two probes can spell the
  same model differently, so a value read by one probe would change each
  time the other one failed.
- When no probe applies, the values are removed.
- When the module set is empty, nothing is read and the values stay.
- A reply or a retry from an earlier connection, or from the adapter the
  device had before a type change, is dropped.

`PlatformMismatch` is for a probe that applies by its modules but finds in
the data that the device is not its case. An app's probe for one odd model
can read, see a normal box and leave it to the default probe.

## Choosing the probes for an app

An app sets its list in `<app>/device_types.act`, next to its device types.
The generated `sysspec.act` passes the list to `SysSpec`. The sysspec
generator writes the file with this list when the file is missing:

```acton
import stratoweave.device as swdev
import stratoweave.platform_probes as swplat


device_types: dict[str, swdev.DeviceType] = {}

platform_probes: list[swdev.PlatformProbe] = swplat.PROBES
```

An app whose `device_types.act` was written before the list existed must add
the import and the list itself. The generator does not change the file once
it exists.

| To | Write |
| --- | --- |
| Use the defaults | `swplat.PROBES` |
| Add a probe | `[my_probe] + swplat.PROBES` |
| Replace a default probe for some devices | Put your probe first. Its `applies` picks the devices. |
| Read no platform | `[]` |

A device type can bring its own probes:
`DeviceType(..., platform_probes=[my_probe])`. They run before the app's list,
so an adapter package can ship the probe for its own devices, as a CLI
adapter would: it knows which commands name the model. An app cannot put a
probe before a device type's probes; to change them, give the device type
other probes.

## Writing a probe

### One get: `GetPlatformProbe`

A subclass sets `name` and `filt`, and implements `applies` and `parse`.
This is the IOS XE probe:

```acton
class IosXeProbe(swdev.GetPlatformProbe):
    def __init__(self):
        self.name = OS
        self.filt = platform_filter()

    def applies(self, modset: dict[str, ModCap]) -> bool:
        return MODULE in modset

    def parse(self, root: ?ygdata.Node) -> ?swdev.Platform:
        return platform(root)
```

| Member | Meaning |
| --- | --- |
| `filt` | Filter of the get. Select only what `parse` needs. |
| `applies(modset)` | Whether the probe can read a device with these modules. No I/O. |
| `parse(root)` | The `Platform` in the reply, `None` when the reply has no values, or raises `PlatformMismatch`. |

Set the fields the probe knows on `swdev.Platform(os, version, model,
serial_number)`; leave the others `None`.

### The device type's schema

A probe reads through the device's schema: the one fetched from the device
when runtime schema fetch is on, else the one the device type bundles. A
bundled schema must have the nodes that the probe reads. A probe ships its
pruned YANG next to its code, and the device type for that OS adds it, as
`fleetmgr/spec/src/gen.act` does for IOS XE:

```acton
iosxe = swbuild.DeviceType.from_dir(fc, "iosxe", "yang/dev-iosxe")
iosxe.models.extend(swxe_yang.models)
```

When the schema lacks a node that the filter names, the get fails with
`Filter node <path> not found in device schema`. The probe then runs again
later, as after any failure.

### More than one read: `PlatformProbe`

For a probe that needs an RPC or more than one read, subclass
`PlatformProbe` and implement `applies` and `read(dev, done)`. `read` calls
`done` once:

| Call | Meaning |
| --- | --- |
| `done(platform, None)` | The answer. |
| `done(None, PlatformMismatch())` | The device is not the probe's case. |
| `done(None, error)` | The read failed. |

`read` runs in the `DeviceMgr`, so it must not wait for the result of a call
to `dev`: that call would wait for `read` to end. A reply from `dev` must go
to an action, and a nested function in a class method is not one. So `read`
starts an actor that sends the requests and receives the replies, one step
after the other. The IOS XR probe's `_IosXrRead` and the SR Linux probe's
`_SrLinuxRead` send two gets, the Junos probe's `_JunosRead` two RPCs.

Give each get one subtree. Some devices take only one subtree in a filter,
so a probe that reads two subtrees sends two gets.

## The probes

| Probe | Applies when the device lists | Reads | Model | Serial number |
| --- | --- | --- | --- | --- |
| `ios-xe` | `Cisco-IOS-XE-device-hardware-oper` | one get: inventory and version banner | chassis part number | chassis entry |
| `ios-xr` | `Cisco-IOS-XR-install-oper` | two gets: `install/version`, the rack inventory | `chassis-pid`, else the rack's model | the rack with the lowest name |
| `junos` | `junos-rpc-version`, or the capability `http://xml.juniper.net/netconf/junos/1.0` | RPCs `get-software-information`, `get-system-information` | `product-model` | `serial-number` of system information |
| `srlinux` | `srl_nokia-system-info` and `srl_nokia-platform-chassis` | two gets: `system/information`, `platform/chassis` | chassis `type` | chassis |
| `sros` | `nokia-state` | one get: `/state/system` and `/state/chassis` | `system/platform` | router chassis with the lowest number |
| `arcos` | `arcos-openconfig-system-augments` | one get: `system/version/state` | `platform` | `serial-number` |

Each probe but Junos reads through YANG that its module ships pruned in
`platform_<os>_yang.act` (`software_iosxe_yang.act` for IOS XE), with the
namespaces and node names of the real modules. A device type for that OS
adds those models, unless its schema has the real modules. The probes apply
to different modules, so a device's modules pick one of them.

### IOS XE

- Takes the model and serial number from the chassis entry with the lowest
  `hw-dev-index`, so a stack gives the same answer whatever order the
  entries come in.
- Takes the version out of the banner, as the software adapter does: the
  text after the first `Version ` up to the comma. A c8000v 17.18.2 reports
  `Cisco IOS Software [IOSXE], Virtual XE Software (...), Version 17.18.2,
  RELEASE SOFTWARE (fc3)` and three more lines.

`Cisco-IOS-XE-platform-oper` names the chassis too, but a lab c8000v
returned invalid UTF-8 in that tree.

`IosXeSoftwareMock` serves a chassis entry: part-number `C8000V`, or the
`model` it is given, and serial number `SERIAL`.

### IOS XR

`install/version` holds what `show version` prints: the release `label` and,
on some devices, the `chassis-pid`. The rack inventory in
`Cisco-IOS-XR-invmgr-oper` holds what `show inventory` prints for `Rack 0`:
its model and serial number.

- An XRd has a `chassis-pid`, `XRd-CP-C-01`, and no inventory: the inventory
  get answers no data, so it has no serial number.
- An XRv 9000 has no `chassis-pid`. Its model, `R-IOSXRV9000-CC`, and its
  serial number come from the inventory.
- The inventory get is optional: when it fails, the probe still answers from
  `install/version`.

### Junos

Junos serves no state in YANG for what it is, so the probe calls the RPCs
that `show version` and `show system information` call. Junos does not put
an RPC's reply in the namespace of its YANG module, and runtime schema fetch
skips the `junos-rpc-*` modules. So the probe sends the RPCs with `rpc_xml`
and reads the replies by element name, and needs no YANG in the device
type's schema. That also lets it read a Junos from before YANG, which lists
no modules but has the Junos capability in its hello.

- The model and the release come from `get-software-information`; a device
  with two routing engines answers for each, and the probe takes the first.
- The serial number comes from `get-system-information`. When that RPC
  fails, the probe still answers, without a serial number. A cRPD has no
  serial number and leaves `os-version` empty.

### SR Linux

The version is `v25.3.2-312-ga0c5002f15`: the probe drops the `v` and the
build, which gives `25.3.2`.

### SR OS

The probe applies to a model-driven or mixed mode SR OS, which serves
`nokia-state`. The version number starts with the image type: `B-25.10.R7`
on an SR-SIM gives `25.10.R7`, `C-23.10.R1` on a 7950 XRS vSIM `23.10.R1`. A system of two chassis, like a 7950 XRS-40, lists both;
the serial number comes from the router chassis with the lowest number.

### ArcOS

`system/version/state` holds what `show version` prints. On a container the
platform is `Virtual` and there is no serial number. The OpenConfig chassis
component has neither part nor serial number there.

## Testing

| Test | Covers |
| --- | --- |
| `src/test_platform.act` | Which probe runs and what `DeviceMgr` publishes, with fake probes: order, device type first, mismatch, failure, removal, every connect. |
| `src/adapters/test_platform_lab.act` | What virtual devices of each platform answered, recorded in `test_platform_lab_data.act`: which probe each device's module list picks, what each probe makes of the device's replies, and what `DeviceMgr` publishes when a mock NETCONF server serves them. |
| `src/adapters/test_platform_<os>.act` | Each probe's parse of replies not recorded there, like hardware with serial numbers and Junos with two routing engines, and `applies`. |
| `src/adapters/test_platform_iosxe.act` | Also the IOS XE filter and the error for a device type without the hardware module. |

To add a platform, record a device's module list and its replies in
`test_platform_lab_data.act`, and add it to `test_platform_lab.act`. The selection test then checks that no other
probe applies to its modules, and that the new probe applies to no other
device's.

## Limits

- Retries have no jitter: devices that connected together retry together.
- A probe that applies but cannot read retries every 300 seconds while the
  device stays connected: when the device never serves the data, or when the
  device type's schema lacks the module. Mocked devices without
  `IosXeSoftwareMock` never serve it.
- An IOS XE reply with a version but no chassis entry is an answer, so it
  removes the model and serial number.
- The mock NETCONF server's subtree filter returns no data at all when a node
  the filter selects is absent, where a device returns the other nodes. A
  mocked device must serve every node that the probe selects.
- With runtime schema fetch on, ArcOS 8.2.1A gets no schema, so no probe
  reads it: an ArcOS module imports `tailf-rollback`, which ArcOS does not
  list.
