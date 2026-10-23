# SNMP devices

An SNMP device type starts with its MIB modules. The system generator uses
[actsnmp](https://github.com/stratoweave/actsnmp) to resolve the MIBs and translate
them to YANG using [RFC 6643](https://www.rfc-editor.org/rfc/rfc6643.html). ActYang
then generates the same operational data classes and subscription paths used
for other device types.

## Build a device type

Use `DeviceType.from_mibs` in the system specification. This example runs from
`minisys/gen`:

```acton
import stratoweave.build as swbuild

snmp_device = swbuild.DeviceType.from_mibs(
    fc,
    "ietf_snmp",
    ["mibs/ietf-snmp"],
    ["SNMPv2-MIB", "IF-MIB"],
)
spec = swbuild.SysSpec("mini", [cfs_layer, rfs_layer], [snmp_device])
spec.compile().gen_app(fc, "../src/")
```

The directory list is the MIB import search path. Imported MIBs are resolved
automatically; the base SMI modules and textual conventions are bundled with
actsnmp. Missing modules, MIB errors, and failed translations stop generation.
The generator translates the MIBs to YANG in memory and generates Acton code
directly from that translation, so only the source MIBs are committed. To
inspect the translated YANG, set `yang_dir="out/snmp-yang"`.

Alongside `ietf_snmp.act`, `ietf_snmp_schema.act`, and `ietf_snmp_oper.act`,
generation writes `ietf_snmp_mib.act`. It holds the MIB metadata that the
adapter reads by: object OIDs, table index encodings, textual conventions, and
value conversions. It also defines the `adapter` function that the generated
device registry uses for the device type. YANG and metadata come from one
translation, so their paths agree. Generated application packages import
actsnmp through this module and need the dependency:

```acton
"snmp": (
    follows="stratoweave.snmp"
),
```

The RFC mapping produces operational (`config false`) nodes. The adapter reads
over SNMPv2c; configuration writes, notifications, on-change subscriptions, and
SNMPv3 credentials are not exposed.

## Subscribe from a transform

Use the generated operational module's paths and a polling period in seconds:

```acton
import mini.devices.ietf_snmp_oper as snmp_oper
import yang.gdata as gdata

iface = snmp_oper.subs.IF_MIB.ifTable.ifEntry.entry(7)
want = {iface.subscribe(
    select=[iface.ifDescr, iface.ifOperStatus, iface.ifHCInOctets, iface.ifHCOutOctets],
    period=1.0,
)}
subs = gdata.SubscriptionManager(dev.tree_provider(), "interface-monitor")
subs.declare({snmp_oper.dst(on_state).deliver(want)})
```

The callback receives the typed tree rooted at the device data root. See
[Subscriptions](subscriptions.md) for destination signatures and subscription
lifetime.

## Reads

A row with a value for every INDEX key is read with GET, so the example above
reads four OIDs. Leading key values narrow the walk of their table, and other
tables are walked column by column in one pass. Scalars use the `.0` OID
suffix. Table indexes are decoded from each instance OID into YANG list keys,
including keys that the agent marks `not-accessible`.

Each poll replaces the previous snapshot, so removed rows disappear. A failed
poll reports an error and keeps the last successful tree. SNMP reads can span
several requests and do not give an atomic snapshot of the device. Equal
subscription declarations share a read, and reads never overlap within one
stream. The adapter waits the requested period after each read completes.
Each request waits 1 second and is retried twice. A table walk stops at
100,000 values and reports an error.

Configure an address, an optional port (default 161), and the SNMPv2c
community in `credentials/password`. The adapter ignores the username; use an
empty string because the shared schema requires it:

```json
{
  "name": "router1",
  "type": "ietf_snmp",
  "address": [{"name": "management", "address": "192.0.2.1"}],
  "credentials": {"username": "", "password": "your-community"}
}
```

Changing the password reconnects the client with the new community.

## Mini example

The mini system's `ietf_snmp` device type uses `SNMPv2-MIB` and `IF-MIB`, vendored
with the imported `IANAifType-MIB` in `minisys/gen/mibs/ietf-snmp`. The translated
model preserves the MIB structure and names: interface rows are at
`IF-MIB/ifTable/ifEntry`, and the `ifXEntry` augmentation adds the 64-bit
counters to those rows. This is a different schema from the `ietf-interfaces`
model of the mini `ietf` device type.

The RFS `snmp-interface` transform subscribes to the interface selected by
`if-index` and publishes `state/descr`, `state/oper-status`, `state/in-octets`
and `state/out-octets`. `period-ms` sets the polling period, and polling
failures set `state/error`.

With `mock/enabled`, the adapter serves the device from an in-process SNMP
agent that starts empty. Tests and scenarios seed it and change it between
polls:

```acton
import snmp.oid as oid
import snmp.values as values

mock = adapter.get_mock_server()!
await async mock.set_bindings([
    values.VarBind(oid.Oid.parse("1.3.6.1.2.1.2.2.1.2.7"), values.OctetString(b"Ethernet7")),
    values.VarBind(oid.Oid.parse("1.3.6.1.2.1.2.2.1.8.7"), values.Integer(1)),
])
await async mock.set_value(oid.Oid.parse("1.3.6.1.2.1.2.2.1.8.7"), values.Integer(2))
```

The suffix `7` becomes the `ifIndex` key, and the numeric status becomes the
YANG enumeration (`1` is `up`). Run the example from the repository root:

```sh
(cd minisys && acton test --module test_mini_snmp)
```
