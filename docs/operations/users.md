# Users and logins
The NETCONF and HTTP servers let the users in `/users` log in. A user logs in
with a password, or over NETCONF also with an SSH key. The first user comes
from a [startup configuration file](#the-first-user).

## Users
The users are configuration in the top layer, from the `stratoweave-users`
module that StratoWeave adds to every application. Change them like other
configuration: over NETCONF or RESTCONF, or in a startup configuration file.
A change applies to the next login. Over HTTP every request logs in; a
NETCONF session that is open stays open.

Each entry of `/users/user` has:

| Leaf | Content |
|---|---|
| `name` | The name that the user logs in with: 1 to 64 letters, digits, `_`, `.`, `@` and `-`, not starting with `.`, `@` or `-` |
| `password` | The hash of the password; see [Passwords](#passwords) |
| `authorized-key` | SSH public keys; see [SSH keys](#ssh-keys) |

A startup configuration file that adds a user:

```xml title="users.xml"
<data>
    <users xmlns="http://stratoweave.org/yang/stratoweave-users">
        <user>
            <name>admin</name>
            <password>$y$j9T$...</password>
            <authorized-key>ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... admin@laptop</authorized-key>
        </user>
    </users>
</data>
```

Over RESTCONF, logged in as `admin`, add `alice`:

```sh
curl -u admin:admin -f -X PATCH \
  -H "Content-Type: application/yang-data+json" \
  -d '{"stratoweave-users:users": {"user": [{"name": "alice", "password": "$y$j9T$..."}]}}' \
  "$STRATOWEAVE_API_ORIGIN/restconf/data"
```

## Passwords
`password` holds the hash of the password in the crypt(3) format of
`/etc/shadow`, never the password itself. Two kinds of hash are accepted:

- yescrypt (`$y$`), at any cost
- bcrypt (`$2b$` or `$2y$`), at a cost of 10 to 12

Any other value is refused, a password in clear text too. The error message
repeats the value, and for a startup file `core.log` keeps it, so choose
another password after such a mistake.

Make a hash with one of these commands. Each asks for the password and
prints the hash. `mkpasswd` is on Linux, in the `whois` package; `htpasswd`
is on macOS and Linux.

```console
mkpasswd -m yescrypt
htpasswd -nBC 12 alice | cut -d: -f2
```

A password changes when you write a new hash.

A check takes about 9 ms for a yescrypt hash at the default cost of
`mkpasswd`, 43 ms for bcrypt at cost 10 and 170 ms at cost 12, on an
M-series Mac. A debug build, made with `acton build` without `--release`,
takes about 0.5 s, 0.8 s and 3.3 s.

Each server keeps in memory the last password that matched the hash of each
user. So HTTP Basic, which sends the password with every request, costs one
check for each new password, not for each request.

A password for an unknown name, or for a user without a password, is checked
against the hash of a user that has a password. So the refusal takes as long
as for a user whose hash has the same kind and cost.

## SSH keys
`authorized-key` holds the SSH public keys that log the user in to NETCONF.
Paste one line of a `.pub` file, such as `~/.ssh/id_ed25519.pub`: the key
type, the key and an optional comment. The key types are `ssh-ed25519`,
`ssh-rsa`, `ecdsa-sha2-nistp256`, `ecdsa-sha2-nistp384`,
`ecdsa-sha2-nistp521`, `sk-ssh-ed25519@openssh.com` and
`sk-ecdsa-sha2-nistp256@openssh.com`.

A user without a password logs in only with a key, so only to NETCONF.

## The first user
Give the first user in a startup configuration file, such as `users.xml` in
[Users](#users), on the command line:

```console
out/bin/sorespo users.xml
```

Startup files apply at every start. A user from a startup file therefore gets
the hash of the file back at each start, also after a change over NETCONF or
RESTCONF. To seed the database instead, apply the file once and exit:

```console
out/bin/sorespo --db /var/lib/sorespo --exit-on-done users.xml
```

When no user can log in, restart StratoWeave with a startup file that has a
new hash for a user.

## HTTP
Every HTTP request needs the name and password of a user, sent with HTTP
Basic: RESTCONF, the TMF API, the inspection API, image files and the web UI.
With curl, give them with `-u`:

```sh
curl -u admin:admin "$STRATOWEAVE_API_ORIGIN/device"
```

Without valid credentials the answer is `401`. A browser then shows its own
login dialog, and sends the credentials with every request until it closes.

A browser also sends the credentials with requests that pages of other sites
make. So the server answers `403` to a request other than GET, HEAD and
OPTIONS that comes from a page of another origin, as the `Sec-Fetch-Site`
header or else the `Origin` header shows; clients like curl send neither and
are not affected. The server also tells browsers not to show its pages in a
frame.

A proxy that serves StratoWeave over plain HTTP must pass the `Host` header
through unchanged, or writes from browsers get `403`.

## Logs
Each server logs its logins in its own file, `netconf.log` or `http.log`:

| Message | Level | When |
|---|---|---|
| `Login accepted` | `info` | A password or a key logs in |
| `Login refused` | `warning` | A password is refused |
| `Login refused` | `debug` | A key is refused; clients try their keys before a password |

Each line has the `user` and the `method`, `password` or `publickey`. The
default level is `warning`, so accepted logins are written only when the
level of the server's part is `info` or more detailed; see
[Logging](run.md#logging). At `info`, `http.log` has a `Login accepted` line
for each request that logs in. A request without credentials gets no login
line; its `401`, like a `403`, shows in the `HTTP response` line.
