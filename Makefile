GENERATED_ACT := src/device_meta_config.act src/device_oper.act src/ietf_restconf_monitoring.act src/ietf_yang_library.act src/adapters/software_iosxe_rpc.act src/adapters/software_iosxe_oper.act src/adapters/platform_iosxr_oper.act src/adapters/platform_srlinux_oper.act src/adapters/platform_sros_oper.act src/adapters/platform_arcos_oper.act
# The YANG that gen_adata compiles. It builds from its own copies in gen_adata/src.
GEN_YANG := src/swyang.act src/adapters/software_iosxe_yang.act src/adapters/platform_iosxr_yang.act src/adapters/platform_srlinux_yang.act src/adapters/platform_sros_yang.act src/adapters/platform_arcos_yang.act

.PHONY: build
build: $(GENERATED_ACT)
	acton build $(DEP_OVERRIDES) $(TARGET)

.PHONY: build-ldep
build-ldep: $(GENERATED_ACT)
	$(MAKE) build DEP_OVERRIDES="--dep yang=../acton-yang --dep http_router=../http-router --dep actmf=../actmf"

.PHONY: build-linux-x86_64
build-linux-x86_64:
	$(MAKE) build TARGET="--target x86_64-linux-gnu.2.27"

.PHONY: build-linux-aarch64
build-linux-aarch64:
	$(MAKE) build TARGET="--target aarch64-linux-gnu.2.27"

.PHONY: build-macos-aarch64
build-macos-aarch64:
	$(MAKE) build TARGET="--target aarch64-macos"

.PHONY: gen
gen: $(GENERATED_ACT)

.PHONY: gen-ldep
gen-ldep: DEP_OVERRIDES=--dep yang=../acton-yang
gen-ldep: $(GENERATED_ACT)
	$(MAKE) --always-make gen DEP_OVERRIDES="--dep yang=../acton-yang"

.NOTPARALLEL: $(GENERATED_ACT)
$(GENERATED_ACT): gen_adata/out/bin/gen_adata $(GEN_YANG)
	@stale=; for f in gen_adata/out/bin/gen_adata $(GEN_YANG); do [ "$@" -ot "$$f" ] && stale=1; done; \
	if [ ! -f "$@" ] || [ -n "$$stale" ]; then \
		gen_adata/out/bin/gen_adata; \
	fi

gen_adata/out/bin/gen_adata: gen_adata/src/gen_adata.act $(GEN_YANG)
	mkdir -p gen_adata/src/adapters
	for f in $(GEN_YANG); do cp -a $$f gen_adata/$$f; done
	cd gen_adata && acton build $(subst ../,../../,$(DEP_OVERRIDES))

.PHONY: test
test:
	acton test $(DEP_OVERRIDES)

.PHONY: test-ldep
test-ldep:
	$(MAKE) test DEP_OVERRIDES="--dep yang=../acton-yang --dep http_router=../http-router --dep actmf=../actmf"

.PHONY: pkg-upgrade
pkg-upgrade:
	acton pkg upgrade
	cd gen_adata && acton pkg upgrade
	cd minisys && acton pkg upgrade
	cd minisys/gen && acton pkg upgrade

.PHONY: check-dep-consistency
check-dep-consistency:
	@python3 scripts/check_dep_consistency.py

.PHONY: test-mini
test-mini: check-mini-is-up-to-date
	cd minisys && acton test
	bash minisys/test/test_persistence_restart.sh
	bash minisys/test/test_image_upload.sh

.PHONY: test-mini-ldep
test-mini-ldep: check-mini-is-up-to-date
	cd minisys && acton test --dep yang=../../acton-yang --dep http_router=../../http-router --dep actmf=../../actmf
	ACTON_BUILD_ARGS="--dep yang=../acton-yang --dep http_router=../http-router --dep actmf=../actmf" bash minisys/test/test_persistence_restart.sh
	ACTON_BUILD_ARGS="--dep yang=../acton-yang --dep http_router=../http-router --dep actmf=../actmf" bash minisys/test/test_image_upload.sh

.PHONY: check-mini-is-up-to-date
check-mini-is-up-to-date:
	$(MAKE) gen-mini
	git diff --exit-code

.PHONY: build-mini
build-mini:
	cd minisys && acton build

.PHONY: build-mini-ldep
build-mini-ldep:
	cd minisys && acton build --dep yang=../../acton-yang --dep http_router=../../http-router --dep actmf=../../actmf

.PHONY: gen-mini
gen-mini:
	cd minisys/gen && acton build && out/bin/gen

.PHONY: gen-mini-ldep
gen-mini-ldep:
	cd minisys/gen && acton build --dep yang=../../../acton-yang --dep http_router=../../../http-router --dep actmf=../../../actmf && out/bin/gen
