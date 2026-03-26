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
# conflicts with CI (14320-40098) and E2E (8123, 29000, 29998) ports.
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

.PHONY: dev-lint
dev-lint:
	npx nx run-many -t lint:fix

.PHONY: ci-build
ci-build:
	npx nx run-many -t ci:build

.PHONY: ci-lint
ci-lint:
	npx nx run-many -t ci:lint

.PHONY: dev-int-build
dev-int-build:
	npx nx run-many -t ci:build
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml build

.PHONY: dev-int
dev-int:
	@echo "Using CI slot $(HDX_CI_SLOT) (project=$(HDX_CI_PROJECT) ch=$(HDX_CI_CH_PORT) mongo=$(HDX_CI_MONGO_PORT) api=$(HDX_CI_API_PORT))"
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml up -d
	npx nx run @hyperdx/api:dev:int $(FILE); ret=$$?; \
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down; \
	exit $$ret

.PHONY: dev-int-common-utils
dev-int-common-utils:
	@echo "Using CI slot $(HDX_CI_SLOT) (project=$(HDX_CI_PROJECT) ch=$(HDX_CI_CH_PORT) mongo=$(HDX_CI_MONGO_PORT))"
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml up -d
	npx nx run @hyperdx/common-utils:dev:int $(FILE)
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down

.PHONY: ci-int
ci-int:
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml up -d --quiet-pull
	npx nx run-many -t ci:int --parallel=false
	docker compose -p $(HDX_CI_PROJECT) -f ./docker-compose.ci.yml down

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

