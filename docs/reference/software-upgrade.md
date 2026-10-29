# Software upgrades

StratoWeave upgrades the software of each device on its own. You set the
release a device should run, and the device's software manager moves the
device to it. Which devices to upgrade, and when is decided by fleetmgr.

A release is one name per device, for example `17.18.03a`. Platforms that
version parts of their software separately are not supported yet.

## Parts

| Part | Where | Role |
| --- | --- | --- |
| `SoftwareManager` | `src/device.act` | One per device. Runs the upgrade steps in order and publishes their state. |
| `SoftwareAdapter` | `src/device.act` | One per platform. Does the device work for each step. |
| Checks | your application | Decide if an upgrade may start, and if the new release may stay. |

Every `DeviceMgr` owns one `SoftwareManager`. A device type names its adapter
with `software_adapter_type`. A device type without one gets
`NoSoftwareAdapter`, so its upgrades fail with "device type has no software
adapter".

## Configuration

Set under `stratoweave-rfs:device=<name>/software`:

| Leaf | Meaning |
| --- | --- |
| `target-release` | Release the device should run. Setting it starts an upgrade. |
| `image-url` | URL the device downloads the image from. The last part of the path is the file name on the device. |
| `veto[holder]` | While any entry exists, no upgrade starts. An upgrade already running goes on. |
| `upgrade-campaign` | Campaign that owns the device. Stored, not used by the manager. |
| `allow-staging` | Stored, not used by the manager. |

## Upgrade steps

```text
check ──> already on target ──> up-to-date
  │
  └─> prepare ─> pre-checks ─> install ─> post-checks ─> commit ─> succeeded
         │           │            │            │            │
         └───────────┴────────────┴─> failed   └────────────┴─> rollback ─> rolled-back
```

| Step | What happens |
| --- | --- |
| check | Read the running release. If it is the target, stop with `up-to-date`. If the read fails, go on. |
| prepare | Copy the image to the device. No outage. |
| pre-checks | Ask every pre-check. A refusal, or no answer within 60 seconds, ends with `failed`. Nothing is activated. |
| install | Activate the new release. The device reboots. The step ends when the device runs the target. |
| post-checks | Ask every post-check. A refusal, or no answer in time, starts a rollback. |
| commit | Tell the device to keep the new release. Then read the release again and re-read the device config. |
| rollback | Go back to the release the device ran before. |

Rules:

- An error in prepare or install ends with `failed`. A failed install does
  not roll back.
- A failed commit starts a rollback. A failed rollback ends with `failed`.
- If the device does not run the target after the commit, the run ends with
  `failed`. This happens when the device went back on its own before the
  commit arrived.
- Post-checks get 15 minutes. When the platform goes back on its own after a
  set time (IOS XE does), the limit is cut so the commit is sent at least 2
  minutes before that. With less than 2 minutes left, the manager rolls back
  at once.
- A device runs one upgrade at a time.
- Run state lives in memory. A failed run is not remembered: the next config
  change for the device starts a new run if the target still differs. After a
  restart, the stored config can start a new run.

## Checks

Applications add checks by name. Every check must pass.

```acton
def precheck(done: action(bool, str) -> None) -> None:
    if peer_is_up:
        done(True, "peer up")
    else:
        done(False, "redundant peer is down")

swmgr = dev.get_swmgr()
swmgr.add_precheck("my-app", precheck)
swmgr.add_postcheck("my-app", postcheck)
```

A check gets a `done` action and calls it once it has decided, so it can do
other work first. The manager passes it no device data; the check reads the
device itself. A check added during a run counts from the next run.
`remove_precheck` and `remove_postcheck` take a check out, also during a run.
An answer that arrives after its round has ended is ignored.

The BGP device-health check in `fleetmgr/src/flotilla/rfs.act` is a working
example.

## State

Published under `stratoweave-rfs:device=<name>/software/state`:

| Leaf | Value |
| --- | --- |
| `status` | `unknown`, `up-to-date`, `in-progress`, `succeeded`, `failed` or `rolled-back` |
| `running-release` | Last release read from the device, spelled the way the device spells it |
| `stage` | The step the run is in, or the step it ended in |
| `reason` | Why the run failed or rolled back |
| `precheck`, `postcheck` | `verdict` (`not-run`, `pass` or `fail`), `detail`, and `at`, the time of the verdict |

Every change goes into the device's operational data, so reads and oper
subscriptions see it right away. A new run removes `reason` and sets both
verdicts back to `not-run`. State is not saved; after a restart it is
`unknown`. The model also has `upgrade-needed` and a `job` list, which the
manager does not set.

## Adapter API

A platform adapter is a subclass of `SoftwareAdapter` in `src/device.act`.

| Method | Does |
| --- | --- |
| `check(done)` | Read the running release. |
| `matches_release(running, target)` | Whether two names mean the same release. The default compares strings. |
| `prepare(done, release)` | Copy the image to the device. |
| `install(done, release)` | Activate the release. Call `done` only once the device runs it. |
| `commit(done)` | Keep the activated release. |
| `commit_window(done)` | Seconds left before the device goes back on its own, or `None`. |
| `rollback(done, previous)` | Go back to `previous`. Call `done` only once the device runs it. |
| `cleanup(done)` | Remove old images. The manager does not call it. |
| `estimate(staged)` | Seconds an install takes. The manager does not call it. |
| `plan_estimate()` | Seconds a whole upgrade takes, for planners. Static. |
| `supports_mocking()` | Whether the adapter works with the device mock. |

Jobs report through `done`. The error message becomes the run's `reason`, so
it should name the operation and the device's cause, for example
`add failed: install-verify-pkg-fail`.

## IOS XE

`IosXeSoftwareAdapter` in `src/adapters/software_iosxe.act` uses these
NETCONF RPCs:

| Step | RPC |
| --- | --- |
| prepare | `xcopy` from `image-url` to bootflash |
| install | `install` (add only), then `activate` with a 30 minute auto-abort timer |
| commit | `install-commit` |
| rollback | `abort` |

- An `<ok/>` reply only means the device accepted the RPC. The adapter then
  reads `install-oper-data` for the records with its UUID until the
  operation ends.
- `activate` names the image by the version the device gave it during the
  add, for example `17.18.03a.0.5540`.
- The device reboots after `activate` and after `abort`. Read errors during
  the reboot are expected. The adapter reads the running release until it is
  the one it waits for.
- Without `install-commit` within 30 minutes of `activate`, the device goes
  back to the old release on its own. 30 is the lowest value IOS XE accepts.
- The running release comes from the `software-version` banner in
  `Cisco-IOS-XE-device-hardware-oper`. Releases are compared part by part,
  so `17.18.03a` matches `17.18.3a`.
- Operation records are read every 10 seconds for up to 30 minutes. During a
  reboot the release is read every 20 seconds for up to 35 minutes. Nothing
  is retried.
- Old images stay on bootflash. `cleanup` does nothing.

The YANG for these RPCs and oper nodes is a trimmed copy in
`src/adapters/software_iosxe_yang.act`. The bindings generated from it are in
`software_iosxe_rpc.act` and `software_iosxe_oper.act`.

## Testing

| File | Tests |
| --- | --- |
| `src/test_swmgr.act` | The manager, with the in-memory adapter from `src/adapters/software_mock.act` |
| `src/adapters/test_software_iosxe.act` | The IOS XE adapter, against `IosXeSoftwareMock` |

`IosXeSoftwareMock` in `src/adapters/software_iosxe_mock.act` runs behind the
in-process NETCONF mock server. Like a real device, it answers an RPC before
the work is done. It also serves one BGP neighbor for checks to read. A mock
device sets these leaves under `mock/software`:

| Leaf | Meaning |
| --- | --- |
| `upgrade-duration` | Seconds a whole upgrade takes. Absent or 0 ends each step at once. |
| `failure` | One device failure to reproduce, see below. |

`mock/platform/version` is the release before the upgrade. Default `17.18.02`,
which the mock reports as `17.18.2`, as a device does.

The upgrade duration is split in the shares measured on a lab c8000v with a
962 MB image: copy 130 s, add 20 s, activate 240 s and commit 5 s, 395 s in
all. An abort takes 240 s.

| `failure` | What the device does | Run ends |
| --- | --- | --- |
| `download-failed` | The copy fails after `xcopy` was accepted | `failed` |
| `add-failed` | The add fails after `install` was accepted | `failed` |
| `activate-refused` | `activate` is rejected | `failed` |
| `commit-failed` | The commit fails after `install-commit` was accepted | `rolled-back` |
| `reverts` | The timer ran out before the commit | `failed` |
| `bgp-down` | BGP is down from the start, so a BGP pre-check refuses | `failed` |
| `bgp-lost` | BGP is down on the new release, so a BGP post-check refuses | `rolled-back` |

