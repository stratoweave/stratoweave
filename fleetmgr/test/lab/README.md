# fleetmgr lab: real IOS XE devices with BGP sessions

Three c8000v CEs peering eBGP with one FRR PE, plus an image server the
devices pull software from over SCP. The point is real IOS XE devices to
upgrade and downgrade through campaigns, with real BGP sessions so their
routing state can be used in pre/post checks.

StratoWeave pushes no configuration here. Containerlab applies every line of
device config at deploy: `configs/ce*.cfg` at boot on top of the vrnetlab
bootstrap, which already creates the `admin` user and enables NETCONF, and
`configs/pe-01.conf` on the PE once its links are attached.

## Topology

```
ce1 eth1 ──── eth2.100 ┐
ce2 eth1 ──── eth3.100 ├── pe-01 (FRR)     vrf-a: ce1, ce2
ce3 eth1 ──── eth4.100 ┘                    vrf-b: ce3

image-server (scp, http)  ── management network ── all CEs
```

| Device | VRF | WAN | PE side | Loopback | Advertises |
|---|---|---|---|---|---|
| ce1 | vrf-a | 10.0.1.2/30 | 10.0.1.1 | 10.255.1.1 | 3 prefixes |
| ce2 | vrf-a | 10.0.1.6/30 | 10.0.1.5 | 10.255.1.2 | 3 prefixes |
| ce3 | vrf-b | 10.0.2.2/30 | 10.0.2.1 | 10.255.2.1 | 3 prefixes |

Each CE advertises its loopback and two `Null0` discard routes; the PE
originates one prefix into each VRF so every CE receives at least one route.

## Prerequisites

- containerlab, docker, sshpass, jq, just
- pull access to the private packages `just pull` fetches with your
  registry login (`docker login ghcr.io` once): the vrnetlab c8000v image
  `ghcr.io/stratoweave/vr-c8000v:17.18.02`, override with `C8000V_IMAGE`,
  and the software image artifacts `ghcr.io/stratoweave/iosxe-image/c8000v`.
  Or your own c8000v build and `.SPA.bin` files to publish them yourself,
  see below

## Run book

From this directory; `just` alone lists the recipes.

    just pull                                   # c8000v, image server and software images, with your registry login
    just start                                  # deploys; CEs boot in ~6 min
    just wait                                   # poll NETCONF on all CEs
    just bgp                                    # ground truth from the devices
    just pe                                     # the PE's view of the sessions
    just ip ce1                                 # a container's management address, e.g. for ssh

In another terminal, from `../..`:

    just build
    just test/lab/run                           # the top plus ten flotillas, :18200

Then:

    just add-devices                            # onboard ce1-ce3 into flotilla-1

## Upgrading

Create and run a campaign with the URL `just image-url` prints, or headless:

    just upgrade                                # campaign "lab" -> 17.18.03a on all CEs
    just CES=ce3 upgrade                        # one device
    just RELEASE=17.16.01a CES=ce3 upgrade      # a downgrade is the same run with a lower release
    just state                                  # campaign state from the top
    just upgrade-clear                          # delete the campaign

Knobs like `CES`, `RELEASE` and `CAMPAIGN` go before the recipe, as above,
or in the environment; the top of the Justfile lists them all.

Staging takes about two minutes for a ~1 GB image and the reload another
four; a run ends after about eight.

## The image server and the software images

The image server is a small public container, `nginx:alpine` with
`openssh-server` and `openssh-client` and nothing else. Its root password is
the lab's static `admin`, like the CEs' credentials; this never runs in
production.

The software images are separate: one OCI artifact per release under
`ghcr.io/stratoweave/iosxe-image/c8000v`, holding one `.SPA.bin` as a plain
blob, so the blob digest is the file's own sha256. `images.txt` lists the
releases the lab serves, pinned by digest. `just pull` fetches them with
ORAS into `image-server/images/`, verified against those digests. The lab
bind-mounts that directory read-only into the image server, and
`just image-url` and `just upgrade` take the staged file whose name carries
`RELEASE`. Two releases, 17.16.01a and 17.18.03a, so a device on the lab's
17.18.02 base can go either way and an upgraded one can come back down.

ORAS runs from its container, `ghcr.io/oras-project/oras`, with your Docker
config mounted in and your uid, so nothing is installed and the files are
yours. If your Docker config uses a credential helper, install the `oras`
binary and log in with it instead.

To publish a new release, the image server, or a c8000v build:

    just software-push <dir with .SPA.bin files>   # one artifact per file, pins them in images.txt
    just server-build                              # the image server, locally in seconds
    just server-push                               # publish it; it holds nothing private
    just c8000v-push <local vrnetlab image>        # retag a local c8000v build and publish it, private

`just software-push` rewrites the lines of the releases it pushed with
their digests; commit `images.txt` after it. Keep the artifact package
private with the team's access; the image server can be public. `just pull`
runs as you, with your registry login; containerlab runs under `sudo`, and
root has none, so everything has to be present before `just start`.

## The PE

`pe-01` is FRR from the public `quay.io/frrouting/frr` image with its
config, daemons list and device setup script bound in from `configs/`.
Sessions are up about 20 s after the CEs are. `just pe` shows them;
`docker exec <lab>-pe-01 vtysh` gives the CLI.

With `as-override` FRR also sends a site's own prefixes back to it, AS path
rewritten: a CE receives 7 routes in vrf-a and 4 in vrf-b, not just the
other site's and the blackhole. The CE keeps its local routes, so nothing
depends on that number.
