SYSNAME=mini
ACTON_TARGET?=aarch64-linux-gnu.2.35
ACTON_BUILD_FLAGS?=
MINISYS_BIN?=$(PROJECT_DIR)/out/bin/$(SYSNAME)

ifneq ($(strip $(ACTON_TARGET)),)
ACTON_BUILD_TARGET_FLAG=--target $(ACTON_TARGET)
endif

.PHONY: build
build:
	cd $(PROJECT_DIR) && acton build $(ACTON_BUILD_TARGET_FLAG) $(ACTON_BUILD_FLAGS)

build-sweave-image:
	docker build -t $(SYSNAME)-sweave-base -f ../common/Dockerfile.sweave .

.PHONY: start
start: build-sweave-image
	$(CLAB_BIN) deploy --topo $(TESTENV:$(SYSNAME)-%=%).clab.yml --log-level debug --reconfigure

.PHONY: stop
stop:
	$(CLAB_BIN) destroy --topo $(TESTENV:$(SYSNAME)-%=%).clab.yml --log-level debug

.PHONY: wait $(addprefix wait-,$(ROUTERS_XR))
WAIT?=60
wait: $(addprefix platform-wait-,$(ROUTERS_XR))

.PHONY: copy
copy: build
	docker cp $(MINISYS_BIN) $(TESTENV)-sweave:/$(SYSNAME)
	docker cp netinfra.xml $(TESTENV)-sweave:/netinfra.xml

ifndef CI
INTERACTIVE=-it
endif

.PHONY: run
run: copy
	docker exec $(INTERACTIVE) $(TESTENV)-sweave /$(SYSNAME) --rts-bt-dbg

.PHONY: run-detached run-bg
run-detached run-bg: copy
	docker exec -d $(TESTENV)-sweave sh -lc '/$(SYSNAME) --rts-bt-dbg > /tmp/$(SYSNAME).log 2>&1'

.PHONY: logs
logs:
	docker exec $(INTERACTIVE) $(TESTENV)-sweave tail -f /tmp/$(SYSNAME).log

.PHONY: stop-mini
stop-mini:
	docker exec $(TESTENV)-sweave sh -lc 'pkill -x $(SYSNAME) || true'

.PHONY: run-and-configure
run-and-configure: copy
	docker exec $(INTERACTIVE) -e EXIT_ON_DONE=$(CI) $(TESTENV)-sweave /$(SYSNAME) netinfra.xml --rts-bt-dbg

.PHONY: configure
configure:
	$(MAKE) FILE="netinfra.xml" send-config-wait

.PHONY: shell
shell:
	docker exec -it $(TESTENV)-sweave bash -l

.PHONY: send-config send-config-async
send-config: send-config-wait

RESTCONF_PORT=$(shell docker inspect -f '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}' $(TESTENV)-sweave)

.PHONY: send-config-async
send-config-async:
	curl -X PATCH -H "Content-Type: application/yang-data+xml" -H "Async: true" -d @$(FILE) http://localhost:$(RESTCONF_PORT)/restconf/data

.PHONY: send-config-wait
send-config-wait:
	curl -X PATCH -H "Content-Type: application/yang-data+xml" -d @$(FILE) http://localhost:$(RESTCONF_PORT)/restconf/data

.PHONY: get-data get-router get-telemetry
get-data:
	curl -H "Accept: application/yang-data+json" http://localhost:$(RESTCONF_PORT)/restconf/data

get-router get-telemetry:
	curl -H "Accept: application/yang-data+json" http://localhost:$(RESTCONF_PORT)/restconf/data/netinfra:netinfra/router=rtr1

.PHONY: get-config0 get-config1 get-config2
get-config0 get-config1 get-config2:
	curl -H "Accept: application/yang-data+xml" http://localhost:$(RESTCONF_PORT)/layer/$(subst get-config,,$@)

.PHONY: get-config-adata0 get-config-adata1 get-config-adata2
get-config-adata0 get-config-adata1 get-config-adata2:
	@curl -H "Accept: application/yang-data+acton-adata" http://localhost:$(RESTCONF_PORT)/layer/$(subst get-config-adata,,$@)

.PHONY: delete-rtr1
delete-rtr1:
	curl -X DELETE http://localhost:$(RESTCONF_PORT)/restconf/data/netinfra:netinfra/router=rtr1
