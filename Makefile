LATEST_VERSION := $$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
BUILD_PLATFORMS = linux/arm64,linux/amd64

include .env

# ---------------------------------------------------------------------------
# Multi-agent / worktree isolation
# ---------------------------------------------------------------------------
# Compute a deterministic port offset (0-99) from the working directory name
# so that multiple worktrees can run integration tests in parallel without
# port conflicts.  Override HDX_CI_SLOT manually if you need a specific slot.
#
# Port mapping (base + slot):
#   ClickHouse HTTP : 18123 + slot
#   MongoDB         : 39999 + slot
#   API test server : 19000 + slot
#   OpAMP           : 14320 + slot
# ---------------------------------------------------------------------------
HDX_CI_SLOT      ?= $(shell printf '%s' "$(notdir $(CURDIR))" | cksum | awk '{print $$1 % 100}')
HDX_CI_PROJECT   := int-$(HDX_CI_SLOT)
HDX_CI_CH_PORT   := $(shell echo $$((18123 + $(HDX_CI_SLOT))))
HDX_CI_MONGO_PORT:= $(shell echo $$((39999 + $(HDX_CI_SLOT))))
HDX_CI_API_PORT  := $(shell echo $$((19000 + $(HDX_CI_SLOT))))
HDX_CI_OPAMP_PORT:= $(shell echo $$((14320 + $(HDX_CI_SLOT))))

export HDX_CI_CH_PORT HDX_CI_MONGO_PORT HDX_CI_API_PORT HDX_CI_OPAMP_PORT

# Log directory for dev-portal visibility (integration tests)
HDX_CI_LOGS_DIR := $(HOME)/.config/hyperdx/dev-slots/$(HDX_CI_SLOT)/logs-int
HDX_CI_HISTORY_DIR := $(HOME)/.config/hyperdx/dev-slots/$(HDX_CI_SLOT)/history

# Archive integration logs to history (call at end of each test target)
# Usage: $(call archive-int-logs)
define archive-int-logs
	if [ -d "$(HDX_CI_LOGS_DIR)" ] && [ -n "$$(ls -A $(HDX_CI_LOGS_DIR) 2>/dev/null)" ]; then \
		_ts=$$(date -u +%Y-%m-%dT%H:%M:%SZ); \
		_hist="$(HDX_CI_HISTORY_DIR)/int-$$_ts"; \
		mkdir -p "$$_hist"; \
		mv $(HDX_CI_LOGS_DIR)/* "$$_hist/" 2>/dev/null; \
		_wt=$$(basename "$$(git rev-parse --show-toplevel 2>/dev/null || pwd)"); \
		_br=$$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"); \
		printf '{"worktree":"%s","branch":"%s","worktreePath":"%s"}\n' "$$_wt" "$$_br" "$(CURDIR)" > "$$_hist/meta.json"; \
	fi; \
	rm -rf $(HDX_CI_LOGS_DIR) 2>/dev/null
endef

.PHONY: all
all: install-tools

.PHONY: install-tools
install-tools:
	yarn setup
	@echo "All tools installed"

# ---------------------------------------------------------------------------
# Dev environment with worktree isolation
# ---------------------------------------------------------------------------
# Ports are allocated in the 30100-31199 range (base + slot) to avoid
# conflicts with CI (14320-40098) and E2E (20320-21399) ports.
#
# Port mapping (base + slot):
#   API server        : 30100 + slot
#   App (Next.js)     : 30200 + slot
#   OpAMP             : 30300 + slot
#   MongoDB           : 30400 + slot
#   ClickHouse HTTP   : 30500 + slot
#   ClickHouse Native : 30600 + slot
#   OTel health       : 30700 + slot
#   OTel gRPC         : 30800 + slot
#   OTel HTTP         : 30900 + slot
#   OTel metrics      : 31000 + slot
#   OTel JSON HTTP    : 31100 + slot
# ---------------------------------------------------------------------------

.PHONY: dev
dev:
	yarn dev

.PHONY: dev-build
dev-build:
	bash -c '. ./scripts/dev-env.sh && docker compose -p "$$HDX_DEV_PROJECT" -f docker-compose.dev.yml build'

.PHONY: dev-up
dev-up:
	yarn dev

.PHONY: dev-down
dev-down:
	yarn dev:down

.PHONY: dev-portal
dev-portal:
	node scripts/dev-portal/server.js

.PHONY: dev-portal-stop
dev-portal-stop:
	@pid=$$(lsof -ti :$${HDX_PORTAL_PORT:-9900} 2>/dev/null); \
	if [ -n "$$pid" ]; then \
		echo "Stopping dev portal (PID $$pid)"; \
		kill $$pid 2>/dev/null || true; \
	else \
		echo "Dev portal is not running"; \
	fi

.PHONY: dev-lint
dev-lint:
	npx nx run-many -t lint:fix

.PHONY: ci-build
ci-build:
	npx nx run-many -t ci:build

.PHONY: ci-lint
ci-lint:
	npx nx run-many -t ci:lint

.PHONY: dev-int-down
dev-int-down:
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down
	@for port in $(HDX_CI_API_PORT) $(HDX_CI_OPAMP_PORT); do \
		pids=$$(lsof -ti :$$port 2>/dev/null); \
		for pid in $$pids; do \
			echo "Killing process $$pid on port $$port"; \
			kill $$pid 2>/dev/null || true; \
		done; \
	done
	@$(call archive-int-logs); true

.PHONY: dev-e2e-down
dev-e2e-down:
	$(eval HDX_E2E_SLOT := $(shell printf '%s' "$(notdir $(CURDIR))" | cksum | awk '{print $$1 % 100}'))
	docker compose -p e2e-$(HDX_E2E_SLOT) -f packages/app/tests/e2e/docker-compose.yml down -v
	@for port in $$((21000 + $(HDX_E2E_SLOT))) $$((20320 + $(HDX_E2E_SLOT))) $$((21300 + $(HDX_E2E_SLOT))) $$((21200 + $(HDX_E2E_SLOT))); do \
		pids=$$(lsof -ti :$$port 2>/dev/null); \
		for pid in $$pids; do \
			echo "Killing process $$pid on port $$port"; \
			kill $$pid 2>/dev/null || true; \
		done; \
	done

.PHONY: dev-clean
dev-clean: dev-down dev-int-down dev-e2e-down dev-portal-stop
	@rm -rf $(HOME)/.config/hyperdx/dev-slots
	@echo "All dev services cleaned up"

.PHONY: dev-int-build
dev-int-build:
	npx nx run-many -t ci:build
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml build

.PHONY: dev-int
dev-int:
	@echo "Using CI slot $(HDX_CI_SLOT) (project=$(HDX_CI_PROJECT) ch=$(HDX_CI_CH_PORT) mongo=$(HDX_CI_MONGO_PORT) api=$(HDX_CI_API_PORT))"
	@mkdir -p $(HDX_CI_LOGS_DIR)
	@bash scripts/ensure-dev-portal.sh
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml up -d
	npx nx run @hyperdx/api:dev:int $(FILE) 2>&1 | tee $(HDX_CI_LOGS_DIR)/api-int.log; ret=$${PIPESTATUS[0]}; \
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down; \
	$(call archive-int-logs); \
	exit $$ret

.PHONY: dev-int-common-utils
dev-int-common-utils:
	@echo "Using CI slot $(HDX_CI_SLOT) (project=$(HDX_CI_PROJECT) ch=$(HDX_CI_CH_PORT) mongo=$(HDX_CI_MONGO_PORT))"
	@mkdir -p $(HDX_CI_LOGS_DIR)
	@bash scripts/ensure-dev-portal.sh
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml up -d
	npx nx run @hyperdx/common-utils:dev:int $(FILE) 2>&1 | tee $(HDX_CI_LOGS_DIR)/common-utils-int.log; ret=$${PIPESTATUS[0]}; \
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down; \
	$(call archive-int-logs); \
	exit $$ret

.PHONY: ci-int
ci-int:
	@mkdir -p $(HDX_CI_LOGS_DIR)
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml up -d --quiet-pull
	npx nx run-many -t ci:int --parallel=false 2>&1 | tee $(HDX_CI_LOGS_DIR)/ci-int.log; ret=$${PIPESTATUS[0]}; \
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down; \
	$(call archive-int-logs); \
	exit $$ret

.PHONY: dev-unit
dev-unit:
	npx nx run-many -t dev:unit

.PHONY: ci-unit
ci-unit:
	npx nx run-many -t ci:unit

# ---------------------------------------------------------------------------
# E2E tests — port isolation is handled by scripts/test-e2e.sh
# ---------------------------------------------------------------------------
# Slot for the Playwright report server (only used by the Makefile REPORT flag)
HDX_E2E_SLOT ?= $(shell printf '%s' "$(notdir $(CURDIR))" | cksum | awk '{print $$1 % 100}')

.PHONY: e2e
e2e:
	./scripts/test-e2e.sh

# Remove E2E test artifacts (results, reports, auth state)
.PHONY: dev-e2e-clean
dev-e2e-clean:
	rm -rf packages/app/test-results packages/app/playwright-report packages/app/blob-report packages/app/tests/e2e/.auth

# Run a specific E2E test file or grep pattern (dev mode: hot reload)
# Usage:
#   make dev-e2e FILE=navigation                    # Match files containing "navigation"
#   make dev-e2e FILE=navigation GREP="help menu"   # Also filter by test name
#   make dev-e2e GREP="should navigate"             # Filter by test name across all files
#   make dev-e2e FILE=navigation REPORT=1           # Open HTML report after tests finish
.PHONY: dev-e2e
dev-e2e:
	./scripts/test-e2e.sh --dev $(if $(FILE),$(FILE)) $(if $(GREP),--grep "$(GREP)") $(ARGS); \
	ret=$$?; \
	$(if $(REPORT),cd packages/app && npx playwright show-report --port $$((9323 + $(HDX_E2E_SLOT)));) \
	exit $$ret



# TODO: check db connections before running the migration CLIs
.PHONY: dev-migrate-db
dev-migrate-db:
	@echo "Migrating Mongo db...\n"
	npx nx run @hyperdx/api:dev:migrate-db
	@echo "Migrating ClickHouse db...\n"
	npx nx run @hyperdx/api:dev:migrate-ch

.PHONY: version
version:
	sh ./version.sh

# Build targets (local builds only)

.PHONY: build-otel-collector
build-otel-collector:
	docker build . -f docker/otel-collector/Dockerfile \
		-t ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		-t ${NEXT_OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		--target prod

.PHONY: build-local
build-local:
	docker build . -f ./docker/hyperdx/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${CODE_VERSION} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		-t ${NEXT_LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		--target all-in-one-noauth

.PHONY: build-all-in-one
build-all-in-one:
	docker build . -f ./docker/hyperdx/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${CODE_VERSION} \
		-t ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		-t ${NEXT_ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		--target all-in-one-auth

.PHONY: build-app
build-app:
	docker build . -f ./docker/hyperdx/Dockerfile \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${CODE_VERSION} \
		-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
		--target prod

.PHONY: build-otel-collector-nightly
build-otel-collector-nightly:
	docker build . -f docker/otel-collector/Dockerfile \
		-t ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		-t ${NEXT_OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target prod

.PHONY: build-app-nightly
build-app-nightly:
	docker build . -f ./docker/hyperdx/Dockerfile \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${CODE_VERSION} \
		-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target prod

.PHONY: build-local-nightly
build-local-nightly:
	docker build . -f ./docker/hyperdx/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${CODE_VERSION} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		-t ${NEXT_LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target all-in-one-noauth

.PHONY: build-all-in-one-nightly
build-all-in-one-nightly:
	docker build . -f ./docker/hyperdx/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${CODE_VERSION} \
		-t ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		-t ${NEXT_ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target all-in-one-auth

