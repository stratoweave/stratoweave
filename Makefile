.PHONY: build
build: src/stratoweave/device_meta_config.act
	acton build $(DEP_OVERRIDES)

.PHONY: build-ldep
build-ldep: src/stratoweave/device_meta_config.act
	$(MAKE) build DEP_OVERRIDES="--dep yang=../acton-yang --dep netconf=../netconf --dep http_router=../http-router --dep actmf=../actmf"

.PHONY: gen
gen: src/stratoweave/device_meta_config.act

.PHONY: gen-ldep
gen-ldep: DEP_OVERRIDES=--dep yang=../acton-yang
gen-ldep: src/stratoweave/device_meta_config.act
	$(MAKE) --always-make gen DEP_OVERRIDES="--dep yang=../acton-yang"

src/stratoweave/device_meta_config.act: gen_dmc/out/bin/gen_dmc src/stratoweave/yang.act
	gen_dmc/out/bin/gen_dmc

gen_dmc/out/bin/gen_dmc: gen_dmc/src/gen_dmc.act src/stratoweave/yang.act
	cp -a src/stratoweave/yang.act gen_dmc/src/swyang.act
	cd gen_dmc && acton build $(subst ../,../../,$(DEP_OVERRIDES))

.PHONY: test
test:
	acton test $(DEP_OVERRIDES)

.PHONY: test-ldep
test-ldep:
	$(MAKE) test DEP_OVERRIDES="--dep yang=../acton-yang --dep netconf=../netconf --dep http_router=../http-router --dep actmf=../actmf"

.PHONY: pkg-upgrade
pkg-upgrade:
	acton pkg upgrade
	cd gen_dmc && acton pkg upgrade
	cd minisys && acton pkg upgrade
	cd minisys/gen && acton pkg upgrade

.PHONY: check-dep-consistency
check-dep-consistency:
	@python3 scripts/check_dep_consistency.py

.PHONY: test-mini
test-mini: check-mini-is-up-to-date
	cd minisys && acton test
	bash minisys/test/test_persistence_restart.sh

.PHONY: test-mini-ldep
test-mini-ldep: check-mini-is-up-to-date
	cd minisys && acton test --dep yang=../../acton-yang --dep netconf=../../netconf --dep http_router=../../http-router --dep actmf=../../actmf
	ACTON_BUILD_ARGS="--dep yang=../acton-yang --dep netconf=../netconf --dep http_router=../http-router --dep actmf=../actmf" bash minisys/test/test_persistence_restart.sh

.PHONY: check-mini-is-up-to-date
check-mini-is-up-to-date:
	$(MAKE) gen-mini
	git diff --exit-code

.PHONY: build-mini
build-mini:
	cd minisys && acton build

.PHONY: build-mini-ldep
build-mini-ldep:
	cd minisys && acton build --dep yang=../../acton-yang --dep netconf=../../netconf --dep http_router=../../http-router --dep actmf=../../actmf

.PHONY: gen-mini
gen-mini:
	cd minisys/gen && acton build && out/bin/gen

.PHONY: gen-mini-ldep
gen-mini-ldep:
	cd minisys/gen && acton build --dep yang=../../../acton-yang --dep netconf=../../../netconf --dep http_router=../../../http-router --dep actmf=../../../actmf && out/bin/gen
