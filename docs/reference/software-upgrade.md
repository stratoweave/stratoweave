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
| `target-release` | Release the device should run. Setting it makes the manager read the device, and upgrade it if no veto holds the install. |
| `image-url` | URL the device downloads the image from. The last part of the path is the file name on the device. |
| `veto[holder]` | While any entry exists, no install starts. The manager still reads the device. An install already running goes on. |
| `upgrade-campaign` | Campaign whose intent this is. The manager answers each attempt at `target-release` in this campaign as an entry of `state/attempt`. |
| `attempt` | A number, 0 by default. A new value is a new attempt: the manager reads the device again, and runs a failed upgrade again. A run of another attempt that is under way finishes first. |
| `allow-staging` | While a veto holds the install, prepare the target once per attempt: copy its image to the device ahead of the window. |

The manager acts when `target-release`, `upgrade-campaign`, `attempt`,
`allow-staging` or a veto changes, when the device type changes, and when
the device connects. A new `image-url` alone does not make it act. A status
that ends a read or a run (`up-to-date`, `succeeded`, `failed` or
`rolled-back`) stands for its attempt. A reconnect, another config change,
a new device type, or `target-release` removed and set again does not run
the attempt again. To run a failed upgrade again, change `attempt`.

## Upgrade steps

```text
check ──> already on target ──> up-to-date
  │
  ├─> a veto holds the install ──> upgrade-needed ──> with allow-staging: prepare once
  │
  └─> prepare ─> pre-checks ─> install ─> post-checks ─> commit ─> cleanup ─> succeeded
         │           │            │            │            │
         └───────────┴────────────┴─> failed   └────────────┴─> rollback ─> rolled-back
```

| Step | What happens |
| --- | --- |
| check | Read the running release. If it is the target, stop with `up-to-date`. If a veto holds the install, stop with `upgrade-needed`, and with `allow-staging` prepare the target once. If the read fails, go on, but see the rules. |
| prepare | Copy the image to the device. No outage. |
| pre-checks | Ask every pre-check. A refusal, or no answer within 60 seconds, ends with `failed`. Nothing is activated. |
| install | Activate the new release. The device reboots. The step ends when the device runs the target. |
| post-checks | Ask every post-check. A refusal, or no answer in time, starts a rollback. |
| commit | Tell the device to keep the new release. Then read the release again and re-read the device config. |
| cleanup | Remove the software that the device does not run, which makes room for the next upgrade. A failed cleanup leaves the run `succeeded`, with the error in `reason`. |
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
- A device runs one upgrade at a time. A change of intent during a run is
  taken up when the run ends.
- Under a veto, a read that fails gives `unknown`, with the error in
  `reason`. If the device was not connected, the manager reads it again when
  it connects; after another error, after 5 seconds, then twice as long each
  time, up to 5 minutes. Without a veto, a device that is not connected
  gives `unknown` too, and is read again when it connects; another read
  error goes on to the upgrade, which reports what fails.
- Right before the install, after the pre-checks, the manager looks at the
  config again. A veto now holds the install, with `upgrade-needed` and the
  holders in `reason`. A changed or removed target, or a changed campaign,
  ends the run with `upgrade-needed` and says so in `reason`; a new target
  or campaign is read then. A new attempt does not stop the run. The install
  installs the release the run read the device for.
- Run state lives in memory. After a restart the state has no attempts, and
  the stored config makes the manager read the device again.

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
| `upgrade-campaign`, `target-release` | The campaign and the target of the attempts: those of the read or run that answered them, not the configuration of the moment |
| `attempt[number]` | One entry for each attempt that the manager has answered at that target in that campaign, with the leaves below. The first answer for another campaign or target starts the list over |
| `attempt/status` | `unknown`, `up-to-date`, `upgrade-needed`, `in-progress`, `succeeded`, `failed` or `rolled-back` |
| `attempt/stage` | The step the attempt's run is in, or the step it ended in |
| `attempt/reason` | Why the run failed or rolled back, why the release could not be read, or what held the install |
| `attempt/precheck`, `attempt/postcheck` | `verdict` (`not-run`, `pass` or `fail`), `detail`, and `at`, the time of the verdict |
| `attempt/job[prepare]` | The attempt's last prepare: `state` (`running`, `done` or `failed`), `release`, `started`, `ended` and, when it failed, `message`. While it runs, `message` says what the device does, as the adapter reports it, and an adapter that transfers the image sets `progress` in percent of `image-size` and `message` with the bytes |
| `attempt/job[install]` | The install of the attempt's run, with the same leaves. While it runs, `message` says what the device does, for example `add: extract` or `waiting for the device to boot`. After the install, until the run commits or rolls back, it says when the commit window ends, for example `commit window ends 23:07 UTC` |
| `veto[holder]` | The vetoes of the configuration, with their `reason`, so that a campaign sees the vetoes of other holders |

The release the device runs is `state/platform/version` (see
`device-platform.md`). The manager reads the platform again when an install
ends, also after a rollback.

Every change goes into the device's operational data, so reads and oper
subscriptions see it right away. A run of an attempt that a veto held
removes its `reason` and sets both verdicts back to `not-run`. A new
attempt is a new entry, and the entries of the earlier attempts stay.
Removing `target-release` keeps the state. State is not saved; after a
restart it has no attempts.

A prepare under a veto runs once per attempt, and again after a restart.
Its result is only in the attempt's `job[prepare]`: a failed prepare leaves
the status `upgrade-needed`, and is not run again, also not when
`allow-staging` goes off and on. Turning `allow-staging` off does not stop a
prepare that runs. When the veto goes, the run prepares again, since the IOS
XE adapter copies the image every time, and fills the same job entry.

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
| `cleanup(done)` | Remove old images. The manager calls it after the commit, once the device runs the target. |
| `plan_estimate()` | Seconds a whole upgrade takes, for planners. Static. |
| `prepare_estimate()` | Seconds the copy of the image takes, for planners. Static. |
| `supports_mocking()` | Whether the adapter works with the device mock. |

Jobs report through `done`. The error message becomes the run's `reason`, so
it should name the operation and the device's cause, for example
`add failed: install-verify-pkg-fail`.

While prepare or install runs, the adapter can tell the device's
`SoftwareManager` (`dev.get_swmgr()`) what the device does:
`report_step(message)` sets the job's `message`, and
`report_transfer(transferred, total)` its `progress` and the bytes.

## IOS XE

`IosXeSoftwareAdapter` in `src/adapters/software_iosxe.act` runs each step
over NETCONF when the device has the module for it, and over the IOS XE CLI
adapter when the device has that as an extra adapter and lacks the module,
as IOS XE 16.8 on a C1111 lacks NETCONF. It plans from the adapters that are
connected, so after a reload a step runs over whichever adapter is back.
Before it stages, it waits for an adapter that is not connected until that
adapter has been without a connection for 2 minutes. An adapter that never
connects, like NETCONF on 16.8, holds up only the first stage of an upgrade.

| Step | NETCONF | CLI |
| --- | --- | --- |
| read the release | `software-version` in `Cisco-IOS-XE-device-hardware-oper` | `show version` |
| read the versions | `install-version-state-info` | `show install summary` |
| list bootflash | `Cisco-IOS-XE-platform-software-oper` | `dir bootflash:` |
| check the image | none | `verify /sha512`, `verify /md5`, or `verify` for the signature |
| prepare | `xcopy` from `image-url` to bootflash | `copy` |
| install | `install` (add only), then `activate` with a 30 minute auto-abort timer | `install add`, then `install activate auto-abort-timer 30` |
| commit | `install-commit` | `install commit` |
| rollback | `abort` | `install abort` |
| cleanup | `remove` of the inactive software | `install remove inactive` |

- An `<ok/>` reply only means the device accepted the RPC. The adapter then
  reads `install-oper-data` for the records with its UUID until the
  operation ends. A CLI command returns when it ends, or when the session
  ends as the device reloads.
- `activate` names the image by the version the device gave it during the
  add, for example `17.18.03a.0.5540`.
- The device reboots after `activate` and after `abort`. Read errors during
  the reboot are expected. The adapter reads the running release until it is
  the one it waits for.
- Without `install-commit` within 30 minutes of `activate`, the device goes
  back to the old release on its own. 30 is the lowest value IOS XE accepts.
- Releases are compared part by part, so `17.18.03a` matches `17.18.3a`.
- Operation records are read every 10 seconds for up to 30 minutes. During a
  reboot the release is read every 20 seconds for up to 35 minutes. Nothing
  is retried.
- Prepare keeps an image that is on bootflash and passes its check, and
  transfers one that is missing or fails it. Install checks it again,
  unless the image passed the same check and `dir bootflash:` shows the
  index, size and date that it had then, as stat would: a file written
  again, also deleted and copied anew, gets another index. A check of a
  735 MB image takes about a minute on a C1111. The driver keeps the
  checks in memory: after a restart it checks again.
- While the image transfers, the adapter reports how far it is: over
  NETCONF from the size of the file on bootflash at each poll of the
  `xcopy`, over the CLI from the marks that `copy` prints, one `!` per
  196608 bytes over http (measured on 16.8.1 and 17.15.06). The CLI adapter answers a
  read of `copy-progress` from what the running copy printed, without a
  command.
- While the install runs, the adapter reports its step: over NETCONF the
  `txn-cmd` of the last transaction that the operation began, without
  `install-txn-`, as `add: extract` or `activate: reload`; over the CLI
  the last step line that the install command printed, as `Performing Add
  on Active/Standby`, from a read of `install-progress`. During a reboot
  the step is `waiting for the device to boot`. The check and the
  transfer of the image are steps too.
- Before a transfer, bootflash needs 2.2 times the `image-size` of the
  intent: the image, and the packages that the add makes of it. Without the
  room, the adapter removes the inactive software once and looks again.
- With the CLI adapter, install refuses to start when the running
  configuration has changes that `write memory` has not saved, because the
  reboot would lose them.
- A device in bundle mode, which booted a `.bin`, takes no `install add`
  alone. Over the CLI the adapter converts it: `boot system` names
  `packages.conf` and then the running image, `write memory` saves that,
  and `install add file ... activate commit` adds, activates and commits in
  one command. That release has no commit window and no abort.
- A device that runs IOS XE 16 in install mode installs with the same one
  command, over the CLI. On a C1111 with 16.8.1, `install activate` with
  the auto-abort timer waited until its SSH session closed, and from
  17.9.5a `install abort` back to 16.8.1 failed, so a commit window cannot
  take the device back. A release that it has added is removed first: the
  one command adds it again from the image file.

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
| `upgrade-duration-variance` | Percent by which each upgrade's duration can differ from `upgrade-duration`, either way. Each upgrade draws its duration evenly in that range when its `xcopy` starts. Default 20; 0 makes every upgrade exact. |
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

