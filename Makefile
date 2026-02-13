LATEST_VERSION := $$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
BUILD_PLATFORMS = linux/arm64,linux/amd64

include .env

.PHONY: all
all: install-tools

.PHONY: install-tools
install-tools:
	yarn setup
	@echo "All tools installed"

.PHONY: dev-build
dev-build:
	docker compose -f docker-compose.dev.yml build

.PHONY: dev-up
dev-up:
	npm run dev

.PHONY: dev-down
dev-down:
	docker compose -f docker-compose.dev.yml down

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
	docker compose -p int -f ./docker-compose.ci.yml build

.PHONY: dev-int
dev-int:
	docker compose -p int -f ./docker-compose.ci.yml up -d
	npx nx run @hyperdx/api:dev:int $(FILE)
	docker compose -p int -f ./docker-compose.ci.yml down

.PHONY: dev-int-common-utils
dev-int-common-utils:
	docker compose -p int -f ./docker-compose.ci.yml up -d
	npx nx run @hyperdx/common-utils:dev:int $(FILE)
	docker compose -p int -f ./docker-compose.ci.yml down

.PHONY: ci-int
ci-int:
	docker compose -p int -f ./docker-compose.ci.yml up -d
	npx nx run-many -t ci:int --parallel=false
	docker compose -p int -f ./docker-compose.ci.yml down

.PHONY: dev-unit
dev-unit:
	npx nx run-many -t dev:unit

.PHONY: ci-unit
ci-unit:
	npx nx run-many -t ci:unit

.PHONY: e2e
e2e:
	# Run full-stack by default (MongoDB + API + local Docker ClickHouse)
	# For more control (--ui, --last-failed, --headed, etc), call the script directly:
	#   ./scripts/test-e2e.sh --ui --last-failed
	./scripts/test-e2e.sh



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

# Release targets (with multi-platform build and push)

.PHONY: release-otel-collector
release-otel-collector:
	@TAG_EXISTS=$$(docker manifest inspect ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} > /dev/null 2>&1 && echo "true" || echo "false"); \
	if [ "$$TAG_EXISTS" = "true" ]; then \
		echo "Tag ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} already exists. Skipping push."; \
	else \
		echo "Tag ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} does not exist. Building and pushing..."; \
		docker buildx build --platform ${BUILD_PLATFORMS} . -f docker/otel-collector/Dockerfile \
			-t ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			-t ${NEXT_OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${NEXT_OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${NEXT_OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			--target prod \
			--push \
			--cache-from=type=gha \
			--cache-to=type=gha,mode=max; \
	fi

.PHONY: release-local
release-local:
	@TAG_EXISTS=$$(docker manifest inspect ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} > /dev/null 2>&1 && echo "true" || echo "false"); \
	if [ "$$TAG_EXISTS" = "true" ]; then \
		echo "Tag ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} already exists. Skipping push."; \
	else \
		echo "Tag ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} does not exist. Building and pushing..."; \
		docker buildx build --squash . -f ./docker/hyperdx/Dockerfile \
			--build-context clickhouse=./docker/clickhouse \
			--build-context otel-collector=./docker/otel-collector \
			--build-context hyperdx=./docker/hyperdx \
			--build-context api=./packages/api \
			--build-context app=./packages/app \
			--build-arg CODE_VERSION=${CODE_VERSION} \
			--platform ${BUILD_PLATFORMS} \
			-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			-t ${NEXT_LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${NEXT_LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${NEXT_LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			--target all-in-one-noauth \
			--push \
			--cache-from=type=gha \
			--cache-to=type=gha,mode=max; \
	fi

.PHONY: release-all-in-one
release-all-in-one:
	@TAG_EXISTS=$$(docker manifest inspect ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} > /dev/null 2>&1 && echo "true" || echo "false"); \
	if [ "$$TAG_EXISTS" = "true" ]; then \
		echo "Tag ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} already exists. Skipping push."; \
	else \
		echo "Tag ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} does not exist. Building and pushing..."; \
		docker buildx build --squash . -f ./docker/hyperdx/Dockerfile \
			--build-context clickhouse=./docker/clickhouse \
			--build-context otel-collector=./docker/otel-collector \
			--build-context hyperdx=./docker/hyperdx \
			--build-context api=./packages/api \
			--build-context app=./packages/app \
			--build-arg CODE_VERSION=${CODE_VERSION} \
			--platform ${BUILD_PLATFORMS} \
			-t ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			-t ${NEXT_ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${NEXT_ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${NEXT_ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			--target all-in-one-auth \
			--push \
			--cache-from=type=gha \
			--cache-to=type=gha,mode=max; \
	fi

.PHONY: release-app
release-app:
	@TAG_EXISTS=$$(docker manifest inspect ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} > /dev/null 2>&1 && echo "true" || echo "false"); \
	if [ "$$TAG_EXISTS" = "true" ]; then \
		echo "Tag ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} already exists. Skipping push."; \
	else \
		echo "Tag ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} does not exist. Building and pushing..."; \
		docker buildx build --squash . -f ./docker/hyperdx/Dockerfile \
			--build-context hyperdx=./docker/hyperdx \
			--build-context api=./packages/api \
			--build-context app=./packages/app \
			--build-arg CODE_VERSION=${CODE_VERSION} \
			--platform ${BUILD_PLATFORMS} \
			-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}${IMAGE_VERSION_SUB_TAG} \
			-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
			-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_LATEST_TAG} \
			--target prod \
			--push \
			--cache-from=type=gha \
			--cache-to=type=gha,mode=max; \
	fi

.PHONY: release-otel-collector-nightly
release-otel-collector-nightly:
	@echo "Building and pushing nightly tag ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG}..."; \
	docker buildx build --platform ${BUILD_PLATFORMS} . -f docker/otel-collector/Dockerfile \
		-t ${OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		-t ${NEXT_OTEL_COLLECTOR_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target prod \
		--push \
		--cache-from=type=gha \
		--cache-to=type=gha,mode=max

.PHONY: release-app-nightly
release-app-nightly:
	@echo "Building and pushing nightly tag ${IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG}..."; \
	docker buildx build --squash . -f ./docker/hyperdx/Dockerfile \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${IMAGE_NIGHTLY_TAG} \
		--platform ${BUILD_PLATFORMS} \
		-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target prod \
		--push \
		--cache-from=type=gha \
		--cache-to=type=gha,mode=max

.PHONY: release-local-nightly
release-local-nightly:
	@echo "Building and pushing nightly tag ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG}..."; \
	docker buildx build --squash . -f ./docker/hyperdx/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${IMAGE_NIGHTLY_TAG} \
		--platform ${BUILD_PLATFORMS} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		-t ${NEXT_LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target all-in-one-noauth \
		--push \
		--cache-from=type=gha \
		--cache-to=type=gha,mode=max

.PHONY: release-all-in-one-nightly
release-all-in-one-nightly:
	@echo "Building and pushing nightly tag ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG}..."; \
	docker buildx build --squash . -f ./docker/hyperdx/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context hyperdx=./docker/hyperdx \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg CODE_VERSION=${IMAGE_NIGHTLY_TAG} \
		--platform ${BUILD_PLATFORMS} \
		-t ${ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		-t ${NEXT_ALL_IN_ONE_IMAGE_NAME_DOCKERHUB}:${IMAGE_NIGHTLY_TAG} \
		--target all-in-one-auth \
		--push \
		--cache-from=type=gha \
		--cache-to=type=gha,mode=max
