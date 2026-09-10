# Subscriptions

Subscriptions are declared as a `set[yang.gdata.SubscriptionSpec]` and
reconciled by `yang.gdata.SubscriptionManager`.

## Monitoring With Local YANG Files

`ncurl monitor --yang-dir DIR` loads a schema from local `.yang` files
when the server does not serve its schemas, or when you want to supply
them yourself. It scans the directory and its subdirectories, compiles
the schema before connecting, and disables schema downloads. The local
schema is used both to parse updates and to resolve `--filter-subtree`.
It works with periodic monitoring and with `--on-change`.

For example, from the repository root, monitor a minisys server using
its CFS models:

```sh
out/bin/ncurl --port 8830 monitor --yang-dir minisys/gen/yang/cfs
```

All local modules are selected by default. To select particular roots,
use `--module` or the existing named `--module-set` groups. Their
transitive imports and includes are added automatically:

```sh
out/bin/ncurl --host router monitor --yang-dir schemas --module ietf-system
```

Explicit modules and module sets are combined. These monitor options
require `--yang-dir`; they select the schema, while `--filter-subtree`
selects the data to monitor. The bundled `stratoweave`, `ietf-inet-types`,
and `ietf-yang-types` modules supply missing imports only. A module found
on disk takes precedence over its bundled copy.

Repeated identical files are deduplicated. When several revisions are
available, select `--module name@YYYY-MM-DD`, or let an import/include's
`revision-date` select the revision. Ambiguous sources, conflicting
revision requests, missing modules, and unreadable or malformed files
are errors. Loading errors stop the command before it connects. Parsed
YANG sources are cached under `~/.cache/ayang`.

## Declaring Subscriptions

`SubscriptionManager` is the owner-scoped declarative API. It binds:

- one `TreeProvider`
- one stable owner id
- one update callback

The callback receives one merged gdata tree for that owner or, for a
destination rooted at a node, one instance of that node per call.

The public shape is intentionally small:

```acton
import yang.gdata as gdata
import mini.devices.ietf_oper as ietf_oper

subs = gdata.SubscriptionManager(
    dev.tree_provider(),
    "base-config",
    on_state,
)

want = set([
    ietf_oper.subs.system_state.clock.subscribe(depth=1, period=0.05)
])

subs.declare(want)
```

## Generated Subscription Helpers

Generated operational device modules such as `mini.devices.ietf_oper`
also expose a typed path API for building subscription filters. The
generated `_oper` module combines the config-false operational adata
tree with the `SubscriptionNode` helpers used for subscriptions.

Start from the generated root:

```acton
import mini.devices.ietf_oper as ietf_oper

sub = ietf_oper.subs
```

The generated module builds one shared filter path tree as the
`subs` module constant, rather than constructing a fresh helper tree
for each use.

### Subscribe To A Whole Subtree

Call `subscribe(...)` directly on a path to subscribe to everything
below that node:

```acton
# /system-state/clock
spec = sub.system_state.clock.subscribe(period=0.05)
```

### Subscribe To Direct Children Only

Use `depth=1` when you want the direct children of a container or list
entry, rather than the whole subtree:

```acton
# /system-state/clock/current-datetime
# /system-state/clock/boot-datetime
spec = sub.system_state.clock.subscribe(depth=1, period=0.05)
```

`depth` currently only supports `1`.

### Subscribe To One Keyed List Entry

Use `entry(...)` on generated list paths to add key predicates without
writing `FNode` filters manually:

```acton
iface = sub.interfaces.interface.entry("eth0")

# /interfaces/interface[name="eth0"]
spec = iface.subscribe(period=1.0)
```

### Select Specific Children

Use `select=[...]` to keep the list entry or container as the anchor,
but only subscribe to specific descendants below it:

```acton
iface = sub.interfaces.interface.entry("eth0")

spec = iface.subscribe(
    select=[iface.statistics, iface.ipv4],
    period=1.0,
)
```

Every selected path must be below the anchor used for `subscribe(...)`.

### Merge Overlapping Descendants

Selected descendants from the same subtree are merged into one filter:

```acton
iface = sub.interfaces.interface.entry("eth0")

spec = iface.subscribe(
    select=[
        iface.statistics.in_octets,
        iface.statistics.out_octets,
    ],
    period=1.0,
)
```

This produces one `statistics` branch with both leaves below it.

### Inspect The Raw Filter

Use `filt()` when you want the raw `FNode` without immediately wrapping
it in a `SubscriptionSpec`:

```acton
clock_filt = sub.system_state.clock.filt()
spec = gdata.SubscriptionSpec(clock_filt, period=0.05)
```

This is useful in tests and when integrating with older code that still
constructs `SubscriptionSpec` directly.

### Declare Multiple Filters For One Owner

`SubscriptionManager` still works on a set of `SubscriptionSpec`
objects, so you can mix several generated filters in one declaration:

```acton
iface = sub.interfaces.interface.entry("eth0")

want = set([
    sub.system_state.clock.subscribe(depth=1, period=0.05),
    iface.subscribe(select=[iface.statistics, iface.ipv4], period=1.0),
])

subs.declare(want)
```

### Where A Destination Is Rooted

A destination decides where each delivered tree starts. The module-level
`dst` is rooted at the top: the callback receives the whole subscribed
tree, as above. Every generated container and keyed list has a `dst` of
its own, rooted at that node: the callback receives one instance of the
node at a time. Its arguments are the keys of every list on the way
down, as a named tuple with a field per key named after the list and
the key; the instance itself, typed, or `None` when it is gone; and an
error, as on the top-rooted callback. A node with no list above it has
no keys argument. The types come with the `dst`, so the callback needs
no annotations.

```acton
import mini.layers.y_1_oper as y1_oper

def on_device(keys, device, err):
    if err is not None:
        ...
    elif keys is not None:
        if device is None:
            forget(keys.device_name)    # the device is gone
        else:
            record(keys.device_name, device)

def on_synced():
    ...                             # every device held at declaration has been delivered

dev = y1_oper.subs.device
subs.declare({
    dev.dst(on_device).deliver({
        dev.subscribe(period=1.0),
    }),
}, synced=on_synced)
```

Rooted below another list, the keys tuple carries that list's keys too:
a destination at `devices.device.interfaces.interface` hands its
callback `keys.device_name`, `keys.interface_name` and the interface.

The first pass delivers every instance the filter selects, one call each,
and then calls `synced`. After that each read delivers the instances that
changed since the last one, and on-change each change delivers the
instances it touched, whatever the size of the list, so a subscriber to a
hundred thousand devices is called with one device. The filters handed to
a rooted destination must lead to its node, and they are read on one
period or served on-change, not both. A destination rooted at a container
receives that container, or `None` when it is gone.

`synced` belongs to the declaration, not to one destination: it is
called once, when every delivery in that `declare` has had its first
pass, the first read of each spec. A first read that ends in an error
still counts: the error, then `synced`. A declaration that adds nothing
new installs the new callbacks and nothing more: nothing is delivered
again and `synced` fires at once, since there is nothing to wait for. A
rooted destination is served by a TTT layer; a device provider answers it
with an error, and counts its first read as its first pass.

At the gdata level the root is an `FNode` path with one child per level
and no predicates, carried by `Dst(deliver, root=...)`; the destination
stamps it on the specs it delivers, so two destinations with the same
filters but different roots are served apart. A rooted delivery is a
spine: a tree from the top down to the one instance, every list on the
way holding one entry with its keys, with an `Absent` holding its keys
where a list entry is gone and nothing where a container is gone.
`gdata.instances` splits a tree into such spines and `gdata.gone` turns
one into the report of its instance gone. A generated `dst` wraps the
callback in a lambda that converts the spine to the keys and the
instance first; the provider calls it, so the conversion runs in the
provider and no actor stands between provider and consumer. After an owner's first pass the provider
calls `synced` with the owner id, sent after the data so it arrives after
it; the manager counts those for the declaration.

### On-Change Subscriptions

Omitting `period` creates an on-change `SubscriptionSpec`:

```acton
spec = sub.system_state.clock.subscribe(depth=1)
```

On a TTT layer an on-change subscription carries the operational state the
layer's transforms publish with `update_oper`, and nothing else: no config,
except the keys of the list entries the state sits under. What a transform
passes to `update_oper` replaces its whole contribution; `None` removes it.

The delivery contract:

- The first delivery is the complete baseline, and may be `None` when no
  transform under the filter has published yet. A consumer must accept that.
- After the baseline every `update_oper` under the filter is delivered as it
  happens, in the order the layer received them, with the tree rebuilt
  along the changed path and everything else shared by reference. An update
  that leaves a transform's filtered slice unchanged is not delivered.
- On-change and periodic filters of one consumer are delivered as one view.
  Rooted at a node, each change delivers the instances it touched.
- A list entry joins the subscription when its transaction commits, never
  while it is provisional. TTT does not clear a transform's oper when its
  config is removed: the transform actor does, from its `shutdown`, with
  `update_oper(None)`, and the entry leaves the tree.
- Oper is not transactional: a commit that touches several entries can be
  seen entry by entry, and a config change and an oper push can race.
- A filter that the tree cannot route, such as a content predicate on a
  container entry that would span several transforms, is reported once as
  an error and the subscription is dropped.

TTT decides on-change from `period` alone; the `on_change` flag on
`SubscriptionSpec` exists for device subscriptions and is ignored here. The
`NetconfDriver` accepts on-change only against a device that pushes natively.

## `SubscriptionSpec`

`SubscriptionSpec` contains:

- `filt: ?FNode`
- `period: ?u64`

There is no explicit subscription mode. The behavior is inferred from
`period`:

- `period is None`: on-change subscription
- `period is not None`: periodic subscription

Internally, `period` is normalized to nanoseconds and stored as `?u64`. gNMI
uses nanoseconds, so we can express that granularity natively.

## Accepted `period` input

The constructor accepts:

- `float`: interpreted as seconds
- `u64`: interpreted as nanoseconds
- `int`: interpreted as nanoseconds
- `None`

Any other type raises `ValueError`.

Examples:

```acton
# Periodic, 50 ms
yang.gdata.SubscriptionSpec(filt, period=0.05)

# Periodic, 50,000,000 ns
yang.gdata.SubscriptionSpec(filt, period=u64(50000000))
yang.gdata.SubscriptionSpec(filt, period=50000000)

# On-change
yang.gdata.SubscriptionSpec(filt)
```

The recommended style is to use `float` seconds for readability unless
you specifically want to work in raw nanoseconds.

## Declaration Model

`SubscriptionManager` owns one logical subscriber. Each `declare(...)`
call describes the full desired subscription set for that owner.

- unchanged declarations are a no-op
- removed subscriptions are removed automatically
- added subscriptions are created automatically

The update callback receives one merged gdata tree for the owner, not
one callback per subscription.

## Northbound On-Change

The northbound NETCONF server serves on-change YANG-Push from a TTT layer,
for the operational datastore: a `push-update` with the baseline when
sync-on-start is asked for, then one `push-change-update` per change. Its
yang-patch is built from the change itself, with no tree diff: a `replace`
of the changed transform's subtree, so omitted descendants disappear at the
client, or a `remove` of the node that emptied, so a deleted list entry is
one edit. Targets are module-qualified from the served schema. A failure
while serving ends the subscription with `subscription-terminated`. A
non-zero dampening-period and excluded change types are rejected.

## Internal Model

`SubscriptionManager` is the declarative owner-facing API. Below it, a TTT
layer serves each consumer from a `Subscription` actor of the consumer's
own, outside the Layer actor. The consumer's filters fold into one read
per period: the union of the filters declared with that period, read in
one pass. Each read runs on its period, and every delivery is the reads'
latest trees merged into one view, sent straight to the consumer, by
reference when there is one read. The Layer keeps only which actor serves
which consumer.

The consumer's on-change filters fold into one subscription in the tree.
This is telemetry, apart from the link subscriptions that carry config
between transforms: nothing in it is transactional or waits. The actor
walks the layer's tree once to lay it: each node answers with its path,
its oper slice if it is a producer, and the children to continue with. A
container transposes the filter and decides predicates on its own keys;
a list selects entries by exact key or all of them and keeps the
subscription so entries that commit later join it; a transform keeps it
and answers its slice. The answers become the actor's shadow of the
subscribed part of the tree, and the end of the walk is the baseline.
After that every producer under the subscription pushes its slice to the
actor as it changes, when it changed; the actor rebuilds the shadow
along the changed path, shares everything else by reference, and
delivers the view with the reads' latest trees merged in. A consumer
that asks for it, the northbound NETCONF server does, gets each change
alone first: the path of the node that changed with what it held before
and after. TTT does not clear a transform's oper when its config goes:
the transform actor does, from its `shutdown`, with `update_oper(None)`,
and the entry leaves the view. The subscription is laid again only when
its filter changes.

Each `declare(...)` call is the consumer's complete desired state. The
actor drops the reads and the subscription no longer wanted, starts
changed ones over, keeps the rest with their latest trees, and calls
`synced` once every read of the declaration has run and its subscription
has been laid.

A consumer rooted at a node has one read, or one subscription in the
tree, and instead of one view gets, after each read, every instance that
differs from the last read and every instance gone, and after each
change the instances it touched, each as a tree from the top down to
that one instance.
