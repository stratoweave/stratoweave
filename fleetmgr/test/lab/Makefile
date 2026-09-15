# Targets for the lab in lab.clab.yml; README.md explains the lab.
#
# Container addresses are assigned by docker at deploy time and are not
# stable across a redeploy, so every target resolves them at call time.

TESTENV ?= fleetmgr-lab-$(shell id -un)
HTTP_PORT ?= 18200
API = http://localhost:$(HTTP_PORT)/restconf
CES = ce1 ce2 ce3
SHARD ?= flotilla-1
CAMPAIGN ?= lab
RELEASE ?= 17.18.03a
# vrnetlab build of the c8000v: Cisco software, a private package.
C8000V_IMAGE ?= ghcr.io/stratoweave/vr-c8000v:17.18.02
# One OCI artifact per release, one .SPA.bin each, pinned in images.txt.
IMAGES_REPO ?= ghcr.io/stratoweave/iosxe-image/c8000v
IMAGES_LIST ?= images.txt
IMAGE_DIR = /usr/share/nginx/html/images
# nginx and sshd, no software inside, public.
IMAGE_SERVER ?= ghcr.io/stratoweave/lab-image-server:1
# Set in image-server/Dockerfile.
SCP_PASSWORD = admin
# .SPA.bin files to publish; only software-push reads it.
IMAGES_SRC ?=
# ORAS from its container, as you, with your Docker login. ORAS_FLAGS takes
# e.g. --plain-http for a local registry.
ORAS_IMAGE ?= ghcr.io/oras-project/oras:v1.3.0
ORAS_FLAGS ?=
oras = docker run --rm --network host --user $(shell id -u):$(shell id -g) -e HOME=/tmp \
  -v $(HOME)/.docker/config.json:/tmp/.docker/config.json:ro -v $(abspath $(1)):/work -w /work $(ORAS_IMAGE)
SSH = sshpass -p admin ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10
JSON = -H "Content-Type: application/yang-data+json" -H "Accept: application/yang-data+json"

ip = $$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(TESTENV)-$(1))
# The staged file for RELEASE.
image_file = $(notdir $(firstword $(wildcard image-server/images/*.$(RELEASE).SPA.bin)))

export TESTENV
export C8000V_IMAGE
export IMAGE_SERVER

# What a deploy needs, fetched with your registry login: both containers and
# the artifacts images.txt lists.
.PHONY: pull
pull:
	@mkdir -p image-server/images
	@docker image inspect $(C8000V_IMAGE) >/dev/null 2>&1 || docker pull $(C8000V_IMAGE)
	@docker image inspect $(IMAGE_SERVER) >/dev/null 2>&1 || docker pull $(IMAGE_SERVER)
	@grep -v '^#' $(IMAGES_LIST) | grep -v '^$$' | while read -r ref; do \
	  echo "pull $$ref"; $(call oras,image-server/images) pull $(ORAS_FLAGS) "$$ref" -o /work >/dev/null || exit 1; \
	done
	@ls image-server/images

# One artifact per .SPA.bin in IMAGES_SRC; rewrites their lines in
# images.txt with the digest.
.PHONY: software-push
software-push:
	@test -n "$(IMAGES_SRC)" || { echo "set IMAGES_SRC to the directory holding the .SPA.bin files"; exit 1; }
	@for f in $(IMAGES_SRC)/*.SPA.bin; do \
	  name=$$(basename $$f); platform=$${name%%-*}; \
	  version=$$(echo $$name | sed -E 's/^.*\.([0-9]+\.[0-9]+\.[0-9]+[a-z]?)\.SPA\.bin$$/\1/'); \
	  ref=$(IMAGES_REPO):$$version; echo "push $$name -> $$ref"; \
	  out=$$($(call oras,$(IMAGES_SRC)) push $(ORAS_FLAGS) --artifact-type application/vnd.cisco.iosxe.image \
	    -a org.opencontainers.image.version=$$version -a io.stratoweave.platform=$$platform \
	    $$ref $$name:application/octet-stream) || { echo "$$out"; exit 1; }; \
	  digest=$$(echo "$$out" | sed -n 's/^Digest: //p'); \
	  { grep -vF -- "$$ref" $(IMAGES_LIST) 2>/dev/null; echo "$$ref@$$digest"; } > $(IMAGES_LIST).new; \
	  mv $(IMAGES_LIST).new $(IMAGES_LIST); \
	done
	@echo "pinned in $(IMAGES_LIST):"; grep -v '^#' $(IMAGES_LIST)

# Retag a local vrnetlab build as C8000V_IMAGE and push it.
.PHONY: c8000v-push
c8000v-push:
	@test -n "$(C8000V_SRC)" || { echo "set C8000V_SRC to the local vrnetlab c8000v image to publish"; exit 1; }
	docker tag $(C8000V_SRC) $(C8000V_IMAGE)
	docker push $(C8000V_IMAGE)

# The image server container.
.PHONY: server-build
server-build:
	docker build -t $(IMAGE_SERVER) image-server

.PHONY: server-push
server-push:
	docker push $(IMAGE_SERVER)

.PHONY: start
start:
	@ls image-server/images/*.SPA.bin >/dev/null 2>&1 || { echo "no software images staged; run make pull"; exit 1; }
	@docker image inspect $(IMAGE_SERVER) >/dev/null 2>&1 || { \
	  echo "$(IMAGE_SERVER) not found; run make pull, or make server-build"; exit 1; }
	@docker image inspect $(C8000V_IMAGE) >/dev/null 2>&1 || { \
	  echo "$(C8000V_IMAGE) not found; pull or build it, or set C8000V_IMAGE"; exit 1; }
	sudo -E containerlab deploy -t lab.clab.yml

.PHONY: stop
stop:
	sudo -E containerlab destroy -t lab.clab.yml

.PHONY: redeploy
redeploy: stop start

# Until every CE's SSH on 830 answers. ssh-keyscan sends the client banner
# first, which IOS XE waits for, and needs no login. A c8000v boots in about
# six minutes; the NETCONF data model can take another ten to sync on first
# boot.
.PHONY: wait
wait:
	@for ce in $(CES); do \
	  addr=$(call ip,$$ce); \
	  printf 'waiting for %s (%s) NETCONF ' $$ce $$addr; \
	  for i in $$(seq 1 90); do \
	    ssh-keyscan -p 830 -T 5 $$addr 2>/dev/null | grep -q . && break; \
	    printf .; sleep 20; \
	    if [ $$i = 90 ]; then echo " TIMEOUT"; exit 1; fi; \
	  done; \
	  echo " up"; \
	done

# Ground truth straight from the devices.
.PHONY: bgp
bgp:
	@for ce in $(CES); do \
	  addr=$(call ip,$$ce); \
	  echo "=== $$ce ($$addr) ==="; \
	  $(SSH) admin@$$addr 'show ip bgp summary | begin Neighbor' 2>/dev/null | head -5; \
	done

.PHONY: pe
pe:
	@docker exec $(TESTENV)-pe-01 vtysh -c "show bgp vrf all summary" 2>/dev/null || echo "PE not ready"

# The top, with the ten flotillas lab.xml declares. Build first: just build.
.PHONY: run
run:
	cd ../.. && out/bin/fleetmgr --http.port $(HTTP_PORT) --netconf.port 12900 test/lab/lab.xml

# Onboard the CEs into one flotilla. Async: the response returns at commit;
# a synchronous write waits for southbound application.
.PHONY: add-devices
add-devices:
	@for ce in $(CES); do \
	  addr=$(call ip,$$ce); \
	  case $$ce in ce3) vrf=vrf-b;; *) vrf=vrf-a;; esac; \
	  echo "$$ce -> $$addr (shard $(SHARD), $$vrf)"; \
	  curl -sf -X PATCH $(JSON) -H "Async: true" --data-binary \
	    "{\"fleetmgr:fleet\": {\"device\": [{\"name\": \"$$ce\", \"type\": \"iosxe\", \"shard\": \"$(SHARD)\", \"description\": \"c8000v CE in $$vrf\", \"address\": [{\"name\": \"oob\", \"address\": \"$$addr\", \"port\": 830}], \"credentials\": {\"username\": \"admin\", \"password\": \"admin\"}}]}}" \
	    $(API)/data || echo "  FAILED"; \
	done

.PHONY: remove-devices
remove-devices:
	@for ce in $(CES); do \
	  curl -sf -X DELETE $(JSON) "$(API)/data/fleetmgr:fleet/device=$$ce" && echo "removed $$ce" || echo "$$ce FAILED"; \
	done

# For a campaign. The device pulls from the image server's management address.
.PHONY: image-url
image-url:
	@test -n "$(image_file)" || { echo "no image-server/images/*.$(RELEASE).SPA.bin staged; run make pull"; exit 1; }
	@echo "scp://root:$(SCP_PASSWORD)@$(call ip,image-server):$(IMAGE_DIR)/$(image_file)"

# Create the campaign and run it; a RELEASE below the running one is a
# downgrade.
.PHONY: upgrade
upgrade:
	@test -n "$(image_file)" || { echo "no image-server/images/*.$(RELEASE).SPA.bin staged; run make pull"; exit 1; }
	@url="scp://root:$(SCP_PASSWORD)@$(call ip,image-server):$(IMAGE_DIR)/$(image_file)"; \
	devs=$$(printf '{"name": "%s"},' $(CES)); devs=$${devs%,}; \
	echo "campaign $(CAMPAIGN): $(CES) -> $(RELEASE) from $$url"; \
	curl -sf -X PATCH $(JSON) -H "Async: true" --data-binary \
	  "{\"software:software\": {\"upgrade-campaign\": [{\"name\": \"$(CAMPAIGN)\", \"target-release\": \"$(RELEASE)\", \"image-url\": \"$$url\", \"device\": [$$devs], \"admin-state\": \"run\"}]}}" \
	  $(API)/data && echo "  accepted"

.PHONY: upgrade-clear
upgrade-clear:
	@curl -sf -X DELETE $(JSON) "$(API)/data/software:software/upgrade-campaign=$(CAMPAIGN)" && echo "cleared" || echo "FAILED"

.PHONY: state
state:
	@out=$$(curl -sf $(JSON) "$(API)/data/software:software/upgrade-campaign=$(CAMPAIGN)") \
	  && echo "$$out" | jq '.["software:upgrade-campaign"][0].state // "no state yet"' \
	  || echo "no campaign $(CAMPAIGN)"

.PHONY: clean
clean:
	rm -rf image-server/images
