
# Running StratoWeave
A StratoWeave-based Orchestrator is a single binary that can be deployed on any
Linux-based system.

## Deployment
The simplest way to deploy a StratoWeave orchestrator is wrap up the binary
into a container image and deploy it to a container orchestration platform such as
Kubernetes. The following example shows a simple Dockerfile that wraps the
SORESPO binary into a container image.

```dockerfile title="Dockerfile for a StratoWeave orchestrator"
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y libssh-4
COPY out/bin/sorespo /usr/local/bin/sorespo
ENTRYPOINT ["/usr/local/bin/sorespo"]
```

!!! tip
    You could use a more minimal base image such as `alpine` or `debian:slim`,
    and in the future we intend to enable you to use a `FROM scratch` base
    image.

## Logging
StratoWeave writes one log file for each part of the system, in the directory
`logs` below the working directory:

| File | Content |
|---|---|
| `core.log` | Startup and exit, TTT layers and transforms |
| `netconf.log` | Northbound NETCONF server: logins, sessions, subscriptions |
| `http.log` | HTTP server: RESTCONF, TMF API and web UI, one line per request at `info` |
| `devices/<name>.log` | One file per device: connection, configuration, software upgrades |

The default level is `warning`, so a healthy system writes little. Startup
messages are always written, at `info`, to `core.log` and to `stdout`: the
log directory, the NETCONF listener and the startup configuration. So is the
exit code when StratoWeave ends by itself, for example after `--exit-on-done`
or a startup error. `stdout` also shows every message at the console level,
which is `log.level` unless set.

```aon title="system.aon"
log:
    dir = "/var/log/sorespo"
    level = "warning"
    netconf:
        level = "info"
    device:
        level = "info"
```

| Setting | Default | Meaning |
|---|---|---|
| `log.dir` | `logs` | Directory for log files; empty to write no files |
| `log.level` | `warning` | Level of every part without its own level |
| `log.core.level`, `log.netconf.level`, `log.http.level`, `log.device.level` | `log.level` | Level of one part |
| `log.console.level` | `log.level` | Level of `stdout` |
| `log.format` | `text` | `text` or `json` |
| `log.rotate.size` | `10485760` | Rotate a file when it reaches this many bytes; `0` to never rotate |
| `log.rotate.keep` | `5` | Rotated files to keep for each log file |

The levels are `off`, `error`, `warning`, `info`, `debug` and `trace`. The
same settings are command-line options such as `--log.level debug`, and
environment variables such as `STRATOWEAVE_LOG__LEVEL`.

### Line format
The `text` format writes one line for each message: the time with the UTC
offset, the level, the part, the class and id of the actor that logged, the
message, and its data as `key=value` pairs. Line breaks and other control
characters are escaped, so a message is always one line.

```text
2026-09-22T14:03:07.123456789+02:00 ERROR  rtr1: stratoweave.adapters.netconf.NetconfDriver[-439]: Device._on_connect: error connecting to device error="Connection refused"
```

The `json` format writes one JSON object for each line, with the keys `time`,
`level`, `logger`, `actor`, `actor_id`, `msg` and, when the message has data,
`data`. Use it when a log shipper sends the files to a search system.

Device configuration in debug messages leaves out the credentials.

### Rotation
When a file reaches `log.rotate.size`, it is renamed to `<name>.log.1`, the
previous `<name>.log.1` to `<name>.log.2` and so on, and at most
`log.rotate.keep` rotated files are kept.

To rotate with `logrotate` instead, set `log.rotate.size` to `0`. StratoWeave
opens the file for each write, so a file that `logrotate` moved away is
created again on the next write. No signal and no `copytruncate` are
necessary.

### Containers
In a container, mount a volume on the log directory, or set `log.dir` to an
empty string to write no files. `stdout` then shows every message at
`log.level`, and the container runtime captures it for `docker logs` or
`kubectl logs`:

```console
out/bin/sorespo --log.dir= --log.level info
```

## Run-time configuration
Running `--help` is the fastest way to confirm the exact interface exposed by
the StratoWeave orchestrator binary you are using. The following example shows
the output of `--help` for SORESPO, the reference implementation of a
StratoWeave orchestrator.

```console title="Inspect runtime options for a StratoWeave orchestrator"
out/bin/sorespo --help
Usage: sorespo [OPTIONS] [--] [FILE ...]

Arguments:
  FILE ...
      Startup configuration files, applied in order
      env: STRATOWEAVE_STARTUP_CONFIG_FILES; default: []

Options:
  --db TEXT
      TTT database: an LMDB path or a database URL
      env: STRATOWEAVE_DB; optional
  --exit-on-done / --no-exit-on-done
      Exit after startup config has been applied
      env: STRATOWEAVE_EXIT_ON_DONE; default: False
  --http.port INT
      HTTP listen port
      env: STRATOWEAVE_HTTP__PORT; default: 80
  --netconf.port INT
      NETCONF SSH listen port
      env: STRATOWEAVE_NETCONF__PORT; default: 830
  --netconf.user TEXT
      NETCONF SSH username (v1 static credential)
      env: STRATOWEAVE_NETCONF__USER; default: admin
  ...
```

Every setting has the same three spellings: a key in an AON settings file, an
environment variable, and a command-line option. They resolve in that order,
so the command line wins. Settings that belong to one subsystem share a path,
which is a nesting in the settings file and a `__` separator in the
environment.

```aon title="system.aon"
db = "/var/lib/sorespo"
http:
    port = 8080
netconf:
    port = 1830
    user = "netops"
```

The `FILE` arguments are startup configuration documents, applied in the order
given. Operators often keep a base system configuration in one file and add
environment-specific overlays as later arguments.

The most important settings are:

- `--db` enables persistence, taking either an LMDB directory or a database
  URL. Without it the orchestrator runs stateless and all configuration is
  lost on shutdown.
- `--http.port` changes the HTTP listener, which defaults to `80`.
- `--netconf.port` changes the NETCONF over SSH listener, which defaults to
  `830`.
- `--netconf.ssh.host-key` points to a persistent SSH host key. If you omit
  it, an ephemeral in-memory key is generated at startup.
- `--netconf.user` and `--netconf.password` configure the built-in static
  NETCONF credentials. They default to `admin` / `admin` and should be
  overridden outside local testing.
- `--exit-on-done` applies the supplied startup configuration and then exits
  instead of continuing to serve traffic. This is useful for CI validation or
  one-shot initialization jobs.

### NETCONF server SSH transport

The SSH transport the northbound NETCONF server offers is configured under
`netconf.ssh`. Leave it alone and the SSH library's defaults apply.

```aon title="system.aon"
netconf:
    ssh:
        cipher = ["aes256-gcm@openssh.com", "aes256-ctr"]
        host_key_algorithm = ["ssh-ed25519"]
        rekey_after_seconds = 3600
```

The same settings are `--netconf.ssh.cipher` on the command line, repeated once
per value, and `STRATOWEAVE_NETCONF__SSH__CIPHER` in the environment.

The algorithm lists (`cipher`, `mac`, `key_exchange`, `host_key_algorithm`,
`public_key_algorithm`, `compression_algorithm`) are ordered preference lists,
most preferred first, and an empty one means the library default. The rest are
`compression_level` (1-9, default 7), `rekey_after_bytes`,
`rekey_after_seconds` and `minimum_rsa_bits`. Both rekey limits are optional:
unset means no byte limit beyond the negotiated cipher's own, and no
time-based rekeying.

An algorithm name the SSH library does not support fails at startup rather
than on the first connection. The equivalent settings for connections *to*
devices live in the device's `ssh` container, described in
[Device management](devices.md).

### Acton Runtime System
As for any Acton application, you can also configure the [Acton Runtime System](https://acton.guide/rts.html).

!!! note
    There is generally no need to change these settings, the defaults are
    suitable for most deployments.