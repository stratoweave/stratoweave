# Transforms

The definition of a transform is done in the [system specification](system-spec.md)
through the StratoWeave [`sw:transform`](system-spec.md#defining-transforms)
and [`sw:rfs-transform`](system-spec.md#defining-rfs-transforms) YANG extensions.
Once the system specification includes the necessary transform definitions,
it is up to a service developer to implement the `transform()` method
and/or `Transform` Actor.

## The transform function
Each transform is implemented as a class that inherits from a generated base
class and implements a `transform()` function which is a pure function that
takes input data and returns output data.

* The **input data** is typed according to YANG schema for the node
  (i.e., the list element or container) on which the transform is defined.
* The **output data** should be typed according to the YANG schema for the next
  layer's input.

The `transform()` function cannot have side effects, access other system
information, subscribe to any data or persist state.
If you need to do any of those things, you should implement a `Transform`
Actor instead, which can manage subscriptions and maintain state. See the
[Transform Actor](#the-transform-actor) section for more details on that
pattern.

The transform function should always produce the same output for a given input.
You should not perform any non-deterministic operations such as generating
random numbers or allocating new IDs in the transform function.

Because the `#!acton transform()` function is a **pure function**, the StratoWeave transaction
engine can call it at any time, e.g. when the input data changes or when the system
is restarted and needs to recompute the desired device configuration.

In its simplest form, the `transform()` function can just return an empty output
object:
```acton
class Router(base.Router):
    def transform(self, i):
        o = base.o_root()

        return o
```

!!! tip "No-op transform functions"
    The only way for a StratoWeave system to persist input (e.g. configuration)
    received on its northbound interfaces is to write it to a part of the YANG
    schema that is located inside of a transform. If you want to persist some
    input data but not use it (yet), a no-op transform function that returns an
    empty output root object is a valid way to do that.

### Accessing transform function input
The input data is available as the first argument to the `transform()` method,
usually named `i`. The input is typed according to the YANG schema for the
node on which the transform is defined.

Consider this YANG snippet:

```yang title="spec/yang/cfs/fridge.yang"
list fridge {
  key name;

  sw:transform dummy.foo.Fridge;

  leaf name {
    type string;
  }
  leaf manufacturer {
    type enum {
      enum "Fridgetech";
      enum "FrostCorp";
      enum "ChillMasters";
      enum "IceBox Inc.";
    }
  }
  list shelf {
    key id;
    leaf id {
      type uint32;
    }
    leaf capacity {
      type uint32;
      mandatory true;
    }
  }
```

In the `transform()` function, the input `i` will provide access to the
`name`, `manufacturer`, and `shelf` nodes according to that schema:
```acton title="src/dummy/foo.act"
class Fridge(base.Fridge):
    def transform(self, i):
        o = base.o_root()

        print(i.name.upper())
        manufacturer = i.manufacturer
        if manufacturer is not None:
            print(manufacturer.upper())
        for shelf in i.shelf:
            print("Shelf {shelf.id} has capacity {shelf.capacity}")

        return o
```

!!! info "Accessing optional input"
    In this example, the `manufacturer` leaf is optional, in many cases
    you must perform a ` is not None` check before using it.
    See the [optional types](acton.md#optional-types) section for more details on how
    to work with optional input data.

### Writing transform output
The output data should be typed according to the YANG schema for the next
layer's input. The output is constructed by starting with a call to
`base.o_root()` to get an empty output object and then populating it with data
from the input or derived values.

If the next layer's YANG schema also has a list of fridges and we wanted to
simply copy the input fridge to an output fridge with some minor modifications,
the transform function might look like this:
```acton title="src/dummy/foo.act"
class Fridge(base.Fridge):
    def transform(self, i):
        o = base.o_root()
        fridge = o.fridge.create(
            i.name.upper(),  # use the same name but uppercase it
            manufacturer=i.manufacturer,
        )
        for shelf in i.shelf:
            fridge.shelf.create(
                shelf.id + 500,  # assign new id to shelf
                capacity=shelf.capacity,
            )
        return o
```

### The RFS transform function
The RFS layer in a StratoWeave system has a specific pattern, as outlined in the
[system specification](system-spec.md#defining-rfs-transforms) documentation.

The input data `i` is still typed according to the YANG schema for the node on
which the transform is defined, but the transform can also use the `di` argument
to access information about the device such as its capabilities, modules, and other metadata.
```acton title="src/sorespo/rfs.act"
class IbgpNeighbor(base.IbgpNeighbor):
    def transform_function(self, i, di):
        if "Cisco-IOS-XR-um-hostname-cfg" in di.modules:
            dev = xr25.root()
            bgp_as = dev.um_router_bgp_cfg_router.bgp.as_.create(i.asn)
            nb = bgp_as.neighbors.neighbor.create(i.address, description=i.description)
            nb.use.neighbor_group = "IPV4-IBGP"
            return dev
        elif "http://xml.juniper.net/netconf/junos/1.0" in di.modules or "junos-conf-root" in di.modules:
            dev = crpd24.root()
            bgp = dev.configuration.protocols.bgp
            g = bgp.group.create("IPV4-IBGP")
            g.neighbor.create(i.address, description=i.description)
            return dev

        raise UnsupportedDevice()
```

## The Transform Actor
When your use case requires side effects, subscriptions, or access to other system information,
you can implement a `Transform` Actor in combination with a `transform()` method.

We distinguish between some common "use cases" for Transform Actors:

- **Multi-stage transforms**: not all device operations can be completed in a
single NETCONF configuration transaction. For example, it may be necessary to
first create some basic system information such as a `hostname`, then execute
an RPC to generate a certificate signing request, and then write the resulting
certificate back to the device.
- **Reactive transforms**: some transform logic needs to react to changes in
device information such as operational state or inventory. For example, if a
linecard is inserted into a device, the system may need to automatically create
some operating mode configuration for that linecard.
- **State publishing**: A transform can expose state information, modeled as
config `False` in YANG. The Transform Actor can populate that state information
based on operational data it has received from device state or the state of
other transforms it has subscribed to or any other information it has access to.

These use cases are not mutually exclusive, and a single Transform Actor may
need to do all of these things at once or more.

## Device model translation

An RFS transform can write shared standard bindings alongside the device's native
bindings. Generate the standard bindings separately from the transport schema,
then return an `MNode` using `merge`:

```acton
from stratoweave.device_translation import merge
import myapp.devices.standard as standard
import myapp.devices.vendor as vendor

class BaseConfig(base.BaseConfig):
    def transform(self, i, di):
        intent = standard.root()
        intent.system.hostname = di.name
        native = vendor.root()
        # Set native interfaces, routing configuration and policy attachments.
        return merge([intent, native])
```

`di.translation_modules` lists modules defining the adapter's translation source
data, including augmenting modules. `di.modules` continues to describe the
native capabilities reported by the device. Translation schemas are never added
to transport capability discovery, native schema negotiation, or NETCONF reads.
Registration advertises the source model; an adapter may explicitly reject
features of that model it does not implement.

StratoWeave first merges **all** RFS contributions for a device. It then calls
each registered translator with its complete source roots during the device
configuration transaction's `compute()` step. A policy and a set it references
can therefore come from different transforms. The translator returns a complete
native contribution, which is merged with explicit native intent. Equal values
can overlap; conflicting values abort the transaction with the translation name
and native path. There is no precedence override. Normal YANG merge rules still
apply to user-ordered lists.

Duplicate ownership of a source root, unknown source/native roots, unsupported
source nodes, translator exceptions and untranslated output all fail before
commit and before device writes are queued. The descriptor's schema defines
known source nodes; the mapping must reject known but unimplemented features.

The transaction engine persists the mixed source intent as its input and the
rendered native configuration as its output. Changes and deletions recompute the
complete target, so generated configuration disappears when its source does.
Approvals, drift reconciliation and transport writes operate on native data.
Device-type or capability changes invalidate rendered targets and their pending
approvals before retransformation. `DeviceMgr.configure()` remains a native
transport-facing API; translation is not performed by that method.

Transform contribution identifiers now derive from their paths, so restoring a
store and recomputing does not create a second owner for the same contribution.
Stores written by older versions with object-address contribution identifiers
are not migrated by this change. Export and reapply their top-layer configuration
to a fresh store when upgrading; retain the original store as a backup.

### Adapter registration

Mappings live with the adapter and use generated adata on both sides. Keep the
mapping function independent of StratoWeave:

```acton
import myapp.devices.standard as standard
import myapp.devices.vendor as vendor

mut def translate_system(source: standard.root) -> vendor.root:
    native = vendor.root()
    native.configuration.system.host_name = source.system.hostname
    return native
```

Use `adata_translation` in a separate integration module to register the typed
function. The helper handles gdata conversion at the orchestration boundary:

```acton
from stratoweave.device_translation import adata_translation
from yang.gdata import Id
import myapp.devices.standard as standard
from myapp.adapters.vendor_translation import translate_system

system = adata_translation(
    "ietf-system", standard.SRC_DNODE,
    [Id("urn:ietf:params:xml:ns:yang:ietf-system", "system")],
    standard.root.from_gdata, translate_system)
```

A mapping receives fresh typed source bindings populated with only its owned
roots and returns a native adata root, or a `merge(...)` of native roots.
Use ordinary generated field access, list iteration and keyed lookups in mapping
code. The same function can be called directly with adata outside StratoWeave.
Validation of known but unimplemented features belongs in that function so direct
callers get the same errors. `ModelTranslation` remains the low-level descriptor
for integrations that already operate on gdata.

Mappings must be deterministic and must not mutate their input or retain
configuration state. They receive no device manager, connection, database,
orchestration state, or clock. A mapping may run more
than once while a transaction is prepared and locked; it runs once per descriptor
per complete render, never once per contributing RFS transform.

In the generator, register qualified descriptor references on the device type:

```acton
stratoweave.build.DeviceType.from_dir(
    fc, "Vendor", "yang/vendor",
    model_translations=["myapp.adapters.translations.system"])
```

The generator emits descriptor imports and runtime registrations. For systems
built without generation, pass descriptor objects to
`stratoweave.device.DeviceType(..., model_translations=[system])`.

This API provides forward configuration translation. Reverse translation,
operational-state mapping, and a standalone runner are separate concerns.
