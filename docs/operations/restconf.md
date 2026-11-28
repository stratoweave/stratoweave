# RESTCONF

StratoWeave orchestrators expose a standard RESTCONF interface rooted at
`/restconf` for retrieving and modifying northbound service intent.
Every request needs the name and password of a user. The examples log in
as `admin` with the password `admin`; see [Users and logins](users.md).

## Entry points

### `GET /.well-known/host-meta`
Returns host metadata that points clients at the RESTCONF root.

### `GET /restconf/yang-library-version`
Returns the advertised RESTCONF YANG library version.

### `GET /restconf/data`
Returns the top-level northbound data tree.

XML example:

```sh
curl -u admin:admin -H "Accept: application/yang-data+xml" \
  "$STRATOWEAVE_API_ORIGIN/restconf/data"
```

JSON example:

```sh
curl -u admin:admin -H "Accept: application/yang-data+json" \
  "$STRATOWEAVE_API_ORIGIN/restconf/data"
```

### Compression

Compression of responses larger than 1KiB is enabled in the server. Clients may
request their preferred compression algorithm via the `Accept-Encoding` header.

## Editing northbound intent

The RESTCONF root is also used for configuration operations such as `PATCH` and
`DELETE`.

For example, a StratoWeave orchestrator can accept northbound intent updates
like this:

```sh
curl -u admin:admin -f -X PATCH \
  -H "Content-Type: application/yang-data+xml" \
  -d @netinfra.xml \
  "$STRATOWEAVE_API_ORIGIN/restconf/data"
```

JSON payloads can also be used:

```sh
curl -u admin:admin -f -X PATCH \
  -H "Content-Type: application/yang-data+json" \
  -d @netinfra.json \
  "$STRATOWEAVE_API_ORIGIN/restconf/data"
```

To remove a node, send `DELETE` to the resource path below `/restconf/data`:

```sh
curl -u admin:admin -f -X DELETE \
  "$STRATOWEAVE_API_ORIGIN/restconf/data/netinfra:netinfra/router=STO-CORE-1"
```

## SORESPO quicklab examples

SORESPO quicklab Makefiles use RESTCONF directly for both reads and writes.
Typical targets include:

```sh
make get-config-restconf
make get-config-restconf-json
make send-config-wait FILE="netinfra.xml"
make send-config-json-wait FILE="netinfra.json"
make send-config-async FILE="netinfra.xml"
```

SORESPO quicklab also uses RESTCONF resource paths for simple validation, for
example:

```sh
curl -u admin:admin -sS -f -H "Accept: application/yang-data+json" \
  "$STRATOWEAVE_API_ORIGIN/restconf/data/netinfra:netinfra/router=AMS-CORE-1"
```

## When to use RESTCONF vs the inspection API

Use RESTCONF when you want the northbound service model exactly as exposed by
your orchestrator, or when you want to submit service intent. Use the
[StratoWeave inspection API](http-api.md) for internal state such as layer
snapshots, rendered per-device configuration, device module inventory, and
approval queues.
