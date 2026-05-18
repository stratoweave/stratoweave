# Testing

StratoWeave projects use the standard Acton testing model described in
[Testing](https://acton.guide/testing.html) and
[Snapshot testing](https://acton.guide/testing/snapshot.html). Acton discovers
test cases whose names start with `_test_`, supports both synchronous and
asynchronous test harnesses, and compares returned strings or `t.success(...)`
values against files in `snapshots/expected/...`.

Regular Acton unit tests work well for testing StratoWeave transforms and helper
functions. Build end-to-end tests with `stratoweave.test_main(...)` and
`stratoweave.testing.TestRig` to apply Layer 0 input, inspect layer state,
and snapshot rendered device configuration with `device_adata_snapshot()`.

The repository Makefile is the canonical entry point:

```sh
make test
```

That target runs:

```sh
acton test $(DEP_OVERRIDES)
```

## Test scopes

StratoWeave deployments usually benefit from three test scopes.

### Focused transform tests

For a regular transform, instantiate the class directly and exercise it with
typed inputs or XML. A focused transform test is usually the cheapest way to
verify one abstraction step in isolation.

```acton
def _test_inter_router():
    xmlin = """<router>
    <name>rtr1</name>
    <asn>65001</asn>
    </router>"""
    transform = dummy.inter.Router()
    out, _ = transform.transform_xml(xml.decode(xmlin), yang.gdata.Container())
    return out.to_xmlstr()
```

Use this style when the main question is: given this input, did the transform
produce the right next-layer data?

### Device-aware RFS tests

RFS transforms usually depend on device capabilities, so the test often
constructs a mock `DeviceInfo` and then calls the transform directly. This
keeps the test fast while still checking vendor selection and device-specific
rendering logic.

```acton
proc def _test_rfs_interface_junos(t: testing.SyncT):
    modeled_input = dummy.rfs.Interface.input_type()(...) 
    mock_di = stratoweave.ttt.DeviceInfo("edge-1", {...})
    transform = dummy.rfs.Interface(t.log_handler)
    out = transform.transform(modeled_input, mock_di).to_gdata()
    return out.to_xmlstr()
```

Use this when the behavior depends on vendor modules, device naming, supported
features, or other RFS context.

### End-to-end system tests

For full pipeline validation, build layer-0 input data and run it through the
real `SYSSPEC`. `stratoweave.test_main(...)` creates a `TestRig` that can apply
input config, inspect layer state, and capture rendered device configurations
as a snapshot string.

```acton
actor _test_service_snapshot(t: testing.AsyncT):
    root = sample.layers.y_0.root()
    root.netinfra.router.create("rtr1", 1, "ietf")

    tr = stratoweave.test_main(sample.sysspec.SYSSPEC, t.log_handler)

    def cont(_r: value):
        t.success(tr.device_adata_snapshot())

    tr.edit_config(root.to_gdata(), cont)
```

The local `minisys/src/test_mini.act` suite shows three useful system-wide
patterns:

- `_test_netinfra1(t: testing.AsyncT)`: apply a small but complete baseline
  config and snapshot the rendered device output. This is the most direct
  end-to-end check for whether a service model produces the expected device
  configuration.
- `_test_netinfra_router_oper(t: testing.AsyncT)`: apply config, then poll the
  CFS view until a transform actor or RFS stage publishes operational state.
  This is the right pattern when the system under test updates config `false`
  state asynchronously and the test needs a bounded timeout.
- `_test_l3vpn1(t: testing.AsyncT)`: model a service that spans multiple
  routers and endpoints, then snapshot the final rendered output for all
  affected devices. This is useful when validating decomposition across
  services, intermediate layers, and per-device config generation.

Use end-to-end tests when a change crosses layers or when a regression would
only be visible after the whole system has processed the input.

## Recommended workflow

1. Update the YANG spec or transform implementation.
2. Run `make gen` if the change touched `spec/yang`, generated layers, or the
   system layout.
3. Add or update the closest `_test_*` case.
4. Run `make test`.
5. If a snapshot changed intentionally, inspect `snapshots/output/...` versus
   `snapshots/expected/...`, then accept it with `acton test --accept`.
