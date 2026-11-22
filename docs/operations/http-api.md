# HTTP inspection API

StratoWeave orchestrators expose a small HTTP inspection API rooted at `/`.

This API is useful for inspecting devices, layer state, configuration queues,
and rendered southbound configuration.

## Conventions

You can call these endpoints against any StratoWeave orchestrator with a base
URL like this:

```sh
curl "$STRATOWEAVE_API_ORIGIN/device/AMS-CORE-1/running?format=xml"
```

A few conventions matter when you call these endpoints directly:

- Device names in `/device/<name>/...` are case-sensitive.
- The `/device/<name>/*` config endpoints select output format with the
  `format` query parameter.
- The `/layer/<idx>` endpoint does not use `?format=`. It selects output from
  the `Accept` header instead.
- For Acton adata output, both `/device/<name>/*` and `/layer/<idx>` support a
  `loose` query parameter. It defaults to `true`.
- Clients may request compressed responses with the `Accept-Encoding` header
  (gzip, deflate).

## SORESPO quicklab examples

SORESPO quicklab Makefiles use these inspection endpoints today:

- `GET /layer/<idx>`
- `GET /device/<name>/target?format=<fmt>`
- `GET /device/<name>/running?format=<fmt>`
- `GET /device/<name>/diff?format=<fmt>`
- `GET /device/<name>/resync`

Typical Make targets include:

```sh
make get-config0
make get-config-json2
make get-config-adata3
make get-target-ams-core-1
make get-running-ams-core-1
make get-diff-ams-core-1
make resync-ams-core-1
```

## Inspection API

### `GET /device`
Returns the list of managed device names as JSON.

Example response:

```json
{"devices":["AMS-CORE-1","FRA-CORE-1"]}
```

### `GET /device/<name>/info`
Returns device metadata and current orchestration state as JSON.

This includes:

- device name and configured type
- approval mode
- configured addresses
- configured username
- `has_running_config`
- `has_target_config`
- `queue_length`
- `pending_approvals`
- feature flags
- discovered module list

This is the best summary endpoint when you need to understand whether a device
is configured, queued, or missing data.

### `GET /device/<name>/capabilities`
Returns device capabilities as JSON.

Example response shape:

```json
{"capabilities":["urn:ietf:params:netconf:base:1.1"]}
```

### `GET /device/<name>/modules`
Returns the device module set as JSON.

Each module entry contains the module name, namespace, revision, and features.
This is useful when you need to confirm the live schema seen by the device
manager.

### `GET /device/<name>/running?format=<fmt>`
Returns the running configuration of the device. StratoWeave reads it from
the device when it does not have it, see
[Running configuration](devices.md#running-configuration).

Supported formats:

- `json`
- `xml`
- `gdata`
- `adata`

Example:

```sh
curl "$STRATOWEAVE_API_ORIGIN/device/AMS-CORE-1/running?format=xml"
```

If the device cannot be read, the endpoint returns a `200` with the
plain-text message `# No running configuration available: <error>`.

### `GET /device/<name>/target?format=<fmt>`
Returns StratoWeave's target configuration for the device: the config the
orchestrator wants the device to have.

Supported formats:

- `json`
- `xml`
- `gdata`
- `adata`

Example:

```sh
curl "$STRATOWEAVE_API_ORIGIN/device/AMS-CORE-1/target?format=xml"
```

If no target configuration is available, the endpoint returns a `200` with the
plain-text message `# No target configuration available`.

### `GET /device/<name>/diff?format=<fmt>`
Returns the difference between running and target configuration for the device.

Supported formats:

- `json`
- `xml`
- `gdata`
- `adata`

Example:

```sh
curl "$STRATOWEAVE_API_ORIGIN/device/AMS-CORE-1/diff?format=xml"
```

If there is no diff, the endpoint returns `# No differences`. If either side is
missing, it returns `# Configuration not available`.

### `GET /device/<name>/log?format=<fmt>`
Returns the device configuration event log as JSON.

Each log item contains:

- `timestamp`
- `event`
- `conf_diff`

Supported diff renderings inside the JSON payload:

- `json`
- `xml`
- `gdata`

`adata` is not implemented for this endpoint.

### `GET /device/<name>/log-entries`
Returns messages from the device's log file, `devices/<name>.log` in the log
directory, as JSON. The file is read when the request comes, so a log that
nobody reads costs nothing.

Query parameters:

| Parameter | Meaning |
|---|---|
| `level` | The levels to return, comma separated, such as `error,warning`; all levels without it. `error` takes in `emerg`, `alert` and `crit`, `info` takes in `notice` and `debug` takes in `verb` |
| `q` | Only lines that hold this text, in any case |
| `limit` | The most messages to return: 200 without it, at most 1000 |
| `before` | The `start` of an earlier answer: the messages before it |
| `after` | The `end` of an earlier answer: the messages written since |

Without `before` and `after`, the answer has the newest messages. `before`
pages back through the file and then through its rotated files. `after`
follows the file, also when it was rotated in between.

```json
{
  "entries": [
    {"time": "2026-11-19T10:55:02.123456789+01:00", "level": "warn",
     "logger": "cpe-001", "actor": "stratoweave.device.DeviceMgr",
     "actor_id": 42, "msg": "DeviceMgr: platform read failed",
     "data": {"error": "timeout"}}
  ],
  "start": "1234567:20480",
  "end": "1234567:40960",
  "gap": false,
  "level": "warning",
  "counts": {"warning": 1, "info": 12}
}
```

- `entries` are oldest first, each the object that the `json` log format
  writes for the line. A line of the `text` format gives its data values as
  strings, and its message as written, with line breaks escaped.
- `start` asks for older messages, and is `null` when there are none.
- `end` asks for the messages written since.
- `gap` is `true` when messages since `after` are missing: more than `limit`
  matched, or the file rotated more often than `log.rotate.keep` since.
- `level` is the level the device logs at.
- `counts` has the number of lines of each level that the answer read and
  that hold `q`, also of the levels that `level` leaves out. Added up over
  the answers, they count the messages in the time the entries span.

A system that writes no log files, with an empty `log.dir`, answers `404`.

On a Fleet Manager top, a fleet device is managed by a flotilla, and the top
sends the request on to the flotilla's HTTP server.

```sh
curl "$STRATOWEAVE_API_ORIGIN/device/AMS-CORE-1/log-entries?level=error,warning&q=commit"
```

### `GET /device/<name>/q`
Returns the device's configuration queue as JSON.

The response is a map keyed by queue item id. Each value currently includes the
transaction id.

Example response shape:

```json
{
  "7": {"tid": "1234"},
  "8": {"tid": "1235"}
}
```

### `GET /device/<name>/q/<id>?format=<fmt>`
Returns one queue item in JSON, including the diff awaiting approval or
application.

Fields include:

- `tid`
- `config_diff`
- `device_txid`
- `format`

Supported diff formats for this endpoint are narrower than the device config
endpoints:

- `xml` (default)
- `gdata`
- `json` returns `# JSON diff not available`
- `adata` returns `# Adata diff not available`

### `POST /device/<name>/q/<id>/set_approval`
Sets approval for a queued device config item.

Request body:

```json
{"device_txid":"abc123","approved":true}
```

Response:

```json
{"status":"ok","approved":true}
```

This is the approval action behind configuration approval workflows such as the
SORESPO queue UI.

### `GET /config-queue`
Returns all pending approvals across all devices as JSON.

Each device entry contains:

- `device_id`
- `pending_count`
- `items`

Each item contains:

- `queue_id`
- `tid`
- `device_txid`
- `approved`

This is the best endpoint for a global approval queue view.

### `GET /device/<name>/resync`
Triggers a device resynchronization and returns a JSON acknowledgement.

Example:

```sh
curl "$STRATOWEAVE_API_ORIGIN/device/AMS-CORE-1/resync"
```

Response:

```json
{"status":"ok","message":"Resync initiated"}
```

## Layer inspection

### `GET /layer/<idx>`
Returns the stored configuration for one StratoWeave layer.

Unlike the device config endpoints, serialization is selected with the
`Accept` header:

- `application/yang-data+xml`
- `application/yang-data+json`
- `application/yang-data+acton-adata`

The `content` query parameter selects what is returned, as in RESTCONF:

- `config` (default): the configuration
- `nonconfig`: the operational state the layer's transforms publish
- `all`: both, merged into one tree

A layer with no operational state returns an empty document for `nonconfig`.

Examples:

```sh
curl -H "Accept: application/yang-data+xml" \
  "$STRATOWEAVE_API_ORIGIN/layer/0"

curl -H "Accept: application/yang-data+json" \
  "$STRATOWEAVE_API_ORIGIN/layer/2"

curl -H "Accept: application/yang-data+acton-adata" \
  "$STRATOWEAVE_API_ORIGIN/layer/3?loose=true"

curl -H "Accept: application/yang-data+json" \
  "$STRATOWEAVE_API_ORIGIN/layer/0?content=nonconfig"
```

The meaning of each layer index depends on the system specification.

For example, in SORESPO the layer numbers are:

- `0`: CFS
- `1`: Inter
- `2`: RFS
- `3`: Device

If the index is out of range, the endpoint returns `404`.

## Choosing the right endpoint

Use `/layer/<idx>` when you want to inspect StratoWeave's stored state at a
specific transform layer. Use `/device/<name>/target` and
`/device/<name>/running` when you want to compare the orchestrator's intended
southbound device config with the device's current running config. Use
`/device/<name>/diff` and `/config-queue` when you are diagnosing rollout or
approval behavior.

## Embedded static assets (web UI)

Applications can embed a built web UI (or any set of files) into their
binary and have the HTTP server serve it alongside the APIs. Pass a
`static_assets` map (URL path -> file content as bytes) to
`stratoweave.main()`; it is forwarded to `HttpServer` and installed by the
`static_assets` module. Each asset is sent unchanged, with a `Content-Type`
from its file extension.

Behavior:

- Every asset is served on `GET <path>` on the same listener and port as the
  APIs. `GET /` serves `/index.html` when present. Assets are served by a
  catch-all `GET /*path` route that the router ranks below every static or
  parameterized route, so registered API routes always take precedence and can
  never be shadowed by an asset. Installing fails if the application already
  registered its own root-level `GET` wildcard.
- Assets under `/_app/immutable/` (content-hashed filenames) are served with
  `Cache-Control: public, max-age=31536000, immutable`; everything else with
  `no-cache`.
- SPA fallback: a `GET` request that matches no route and carries an `Accept`
  header that explicitly allows `text/html` (a browser navigation) receives
  `/index.html`, so
  client-side routed pages survive a browser refresh. Requests without such an
  `Accept` header — API clients, curl — keep receiving a plain `404`, and
  registered API routes always win over the fallback.
- The flip side of route precedence: an asset whose path an existing GET
  route already matches — including parameterized and wildcard routes such as
  `/device/{name}/info` or `/restconf/data/*` — is unreachable. Keep asset
  paths (`/index.html`, `/_app/...`) out of the API namespace.

Limitations:

- `HEAD` is not supported by the HTTP server; use `curl -sD- -o /dev/null`
  rather than `curl -I` when inspecting response headers.
