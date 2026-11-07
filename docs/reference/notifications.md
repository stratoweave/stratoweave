# Event Notifications

Devices emit discrete events — an upgrade finished, a config changed out of
band, a linecard appeared — modeled in YANG as `notification` statements.
StratoWeave delivers them to subscribers as typed events, and can emit its own
on the northbound NETCONF interface.

Event notifications are a separate lane from
[streaming telemetry](subscriptions.md): telemetry delivers a converging
operational data tree, events are discrete and ordered. The two share wire
machinery but have different APIs on purpose.

## Subscribing to device events

Declare a set of `NotifSpec` on a `DeviceMgr` (an RFS Transform Actor holds one
as `params.dev`):

```acton
import adapters.adapter as swadapt
import yang.gdata as gdata

VERIFY_EVENT = gdata.Id("http://cisco.com/ns/yang/Cisco-IOS-XE-verify-events",
                        "verify-event")

def on_event(ev: ?swadapt.NotifEvent, err: ?Exception) -> None:
    if ev is not None:
        ...  # ev.payload is the event decoded against the device schema

dev.declare_notif_subscriptions("my-owner", on_event,
                                {swadapt.NotifSpec(VERIFY_EVENT)})
```

A `NotifSpec` is a qualified notification name, optionally pinned to a device
stream:

```acton
NotifSpec(VERIFY_EVENT)                     # one notification, routed by policy
NotifSpec(VERIFY_EVENT, stream="NETCONF")   # one notification, routing pinned
NotifSpec(stream="snmpevents")              # everything on one stream (a tap)
NotifSpec()                                 # everything on the default channels
```

Like telemetry subscriptions, the declaration is the owner's full desired
state: each `declare_notif_subscriptions` call replaces the previous set, and
`remove_notif_subscriptions(owner_id)` drops it. Two owners declaring the same
spec share the underlying device subscription.

## Waiting for the subscription

An RPC can report its result as an event: IOS XE's `verify` returns a UUID,
and the checksum arrives later in a `verify-event` with that UUID. Send such
an RPC only once the subscription is in place, or the event can come before
the device subscription exists and is lost. Pass `synced` to be told:

```acton
def on_synced(owner_id: str) -> None:
    ...  # the subscription is in place: send the verify RPC now

dev.declare_notif_subscriptions("my-owner", on_event,
                                {swadapt.NotifSpec(VERIFY_EVENT)}, on_synced)
```

`synced` is called once per declaration, when the device subscriptions for
every spec are in place. If a subscription fails, the owner gets
`cb(None, err)` instead.

## What arrives

Matching events arrive as `cb(event, None)` where a `NotifEvent` carries:

- `name: gdata.Id` — the qualified notification name
- `event_time: str` — the envelope's eventTime, verbatim RFC 3339 text
- `payload: ?gdata.Node` — the event decoded against the device schema, or
  `None` when it is not in the schema or failed to decode
- `raw: xml.Node` — the payload element as received, always present, with any
  namespace prefixes the device declared on the envelope

`cb(None, err)` signals channel trouble: the notification session dropped or a
device rejected a subscription. It means *you may be missing events until this
recovers*; recovery is automatic and silent.

Subscription machinery notifications — RFC 8639 subscription-state changes,
RFC 5277's `replayComplete`/`notificationComplete` — belong to the adapter and
are never delivered as events.

## Delivery semantics

Delivery is **at-most-once with no replay**. Events fired while a notification
session is down are gone — unlike telemetry, events do not converge. Treat
notifications as hints that accelerate your logic, not as a reliable stream:
confirm outcomes through operational state where it matters, and use the error
callback as the cue to fall back to polling.

Ordering is preserved per underlying channel; nothing is guaranteed across
channels. An event matching several of one owner's specs is delivered once.

## How it reaches the device

Transforms never deal with mechanisms — that is adapter policy, inspectable
via `dev.notif_status()`. For NETCONF devices the driver reconciles specs into
channels:

- Devices with RFC 8639 subscribed-notifications get establish-subscription on
  the **main session** (per-name stream-subtree-filter on the NETCONF stream).
- IOS XE's draft dialect gets per-name establishes on the `yang-notif-native`
  stream for Cisco's native event modules, `Cisco-IOS-XE-*-events` and
  `Cisco-IOS-XE-*-events-oper`; IOS XE sends these only there. Other names
  fall back to RFC 5277.
- Everything else uses classic RFC 5277 `create-subscription` on a **dedicated
  session per stream** — forced by 5277 itself: one anonymous subscription per
  session, no modify or cancel, and no other RPCs without `:interleave`.

Demux is always by notification name on our side; device-side filters are only
bandwidth optimizations. That also means routing mistakes fail soft — but a
name routed to a stream the device never emits it on is **silent
non-delivery**. The stream pin on `NotifSpec` is the override for such cases,
and an unfiltered tap is the discovery tool.

Mock devices support the same API: `MockAdapter.inject_notif(name, payload,
stream)` delivers synthetic events with the same matching rules the real
driver uses, and the NETCONF mock server's `emit_event(...)` exercises the
full wire path.

## Watching notifications with ncurl

`ncurl notifications` subscribes through a `DeviceMgr` the way a transform
does, and prints each notification as it arrives. Without
`--notification` it prints all of them, which shows what a device sends and
on which channel:

```sh
out/bin/ncurl --host router notifications
out/bin/ncurl --host router notifications --notification ietf-netconf-notifications:netconf-config-change
out/bin/ncurl --host router notifications --stream snmpevents --format raw
```

A notification is named `module:name`. The line on stderr says how the
adapter subscribed, for example
`create-subscription stream=NETCONF (dedicated session, active)`.
`--count` stops after that many notifications, and `--yang-dir` decodes them
with local YANG files instead of downloaded schemas, as for `ncurl monitor`.

## Automatic drift detection

When a device advertises `ietf-netconf-notifications` (RFC 6470), the
`DeviceMgr` subscribes itself to `netconf-config-change` and triggers a resync
on it — out-of-band configuration drift is detected the moment the device
reports it, rather than on the next reconnect. IOS XE reports changes made
from the CLI as well as over NETCONF.

## Emitting notifications northbound

StratoWeave's own NETCONF server serves RFC 5277 `create-subscription` and
advertises the `:notification` and `:interleave` capabilities. Emitting is one
call on the server's hub:

```acton
hub = netconf_server.event_hub()
hub.publish(payload)                      # NETCONF stream, timestamped now
hub.publish(payload, stream="my-stream")  # a stream declared with define_stream
```

`payload` is the notification's XML element (for gdata content,
`node.to_xml()`). Every subscribed session whose stream and name filter match
receives it; with no subscribers the event simply evaporates.

## Current limitations

- No replay: RFC 5277 `startTime` / RFC 8639 `replay-start-time` are not used
  yet.
- Nested (YANG 1.1) notifications are identified by their top-level payload
  element, so they only reach unfiltered taps.
- The northbound server does not serve RFC 8639 event-stream
  establish-subscription yet; the classic RPC covers the event side. It also
  does not serve the RFC 5277 `/netconf/streams` discovery container.
- The automatic config-change resync does not yet discriminate `changed-by`,
  so StratoWeave's own commits trigger a redundant (harmless) resync on
  devices that emit RFC 6470 notifications.
- IOS XE matches a `yang-notif-native` filter against the module's own prefix,
  which the adapter takes from the device schema. A notification whose module
  is not in the schema is rejected (`error-no-such-option`) and retried.
