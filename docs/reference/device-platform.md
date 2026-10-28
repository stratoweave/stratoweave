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
| `SysSpec.platform_probes` | `src/app.act` | The app's list of probes. `PROBES` unless the app gives its own. |
| `DeviceType.platform_probes` | `src/device.act` | Probes for devices of one type. They run before the app's list. |
| `DeviceMgr` | `src/device.act` | Picks the probe, runs it and publishes the answer. |

## State

Published under `stratoweave-rfs:device=<name>/state/platform`. Not
persisted: after a restart it is empty until the device connects.

| Leaf | Meaning |
| --- | --- |
| `os` | Operating system family, for example `ios-xe`. The probe sets it; it is not read from the device. |
| `version` | Release as the device reports it, for example `17.18.02`. |
| `model` | Chassis product id, for example `C8000V`. |
| `serial-number` | Chassis serial number. |
| `probe` | Name of the probe that read the values. |

The version is spelled the way the device spells it. Compare it with a
release name through the platform's `SoftwareAdapter.matches_release`, not
with `==`: IOS XE reports `17.18.3a` for an image called `17.18.03a`.

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

### Anything else: `PlatformProbe`

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
to an action, and a nested function in a class method is not one. So start
an actor that sends the requests and receives the replies, as
`_GetPlatformRead` in `src/device.act` does.

## IOS XE

The `ios-xe` probe in `src/adapters/platform_iosxe.act`:

- Applies when the device lists `Cisco-IOS-XE-device-hardware-oper`.
- Reads, in one get, the type, index, part-number and serial number of every
  `device-inventory` entry, and `device-system-data/software-version`.
- Takes the model and serial number from the chassis entry with the lowest
  `hw-dev-index`, so a stack gives the same answer whatever order the
  entries come in.
- Takes the version out of the banner, as the software adapter does:
  `Cisco IOS XE Software, Version 17.18.02` gives `17.18.02`.
- Needs the pruned IOS XE YANG in `src/adapters/software_iosxe_yang.act` in
  the device type's schema, as the software adapter does.

`Cisco-IOS-XE-platform-oper` names the chassis too, but a lab c8000v
returned invalid UTF-8 in that tree.

`IosXeSoftwareMock` serves a chassis entry: part-number `C8000V`, or the
`model` it is given, and serial number `SERIAL`. The mock's subtree filter
returns no data when a list the filter selects is absent, so without the
entry the read would get nothing, not even the version.

## Testing

| Test | Covers |
| --- | --- |
| `src/test_platform.act` | Which probe runs and what `DeviceMgr` publishes, with fake probes: order, device type first, mismatch, failure, removal, every connect. |
| `src/adapters/test_platform_iosxe.act` | The IOS XE filter and parse, the error for a device type without the hardware module, and the platform a mocked IOS XE device publishes. |

## Limits

- A Junos probe would call `get-system-information`, an RPC in a
  `junos-rpc-*` module. Runtime schema fetch skips those modules, so with it
  on, such a probe has to use `rpc_xml` and parse the XML itself.
- Retries have no jitter: devices that connected together retry together.
- A probe that applies but cannot read retries every 300 seconds while the
  device stays connected: when the device never serves the data, or when the
  device type's schema lacks the module. Mocked devices without
  `IosXeSoftwareMock` never serve it.
- An IOS XE reply with a version but no chassis entry is an answer, so it
  removes the model and serial number.
