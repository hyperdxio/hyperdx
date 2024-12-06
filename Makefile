LATEST_VERSION := $$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
BUILD_PLATFORMS = linux/arm64,linux/amd64

include .env

.PHONY: all
all: install-tools

.PHONY: install-tools
install-tools:
	yarn install
	@echo "All tools installed"

.PHONY: dev-build
dev-build:
	docker compose -f docker-compose.dev.yml build

.PHONY: dev-up
dev-up:
	docker compose -f docker-compose.dev.yml up -d

.PHONY: dev-down
dev-down:
	docker compose -f docker-compose.dev.yml down

.PHONY: dev-lint
dev-lint:
	npx nx run-many -t lint:fix

.PHONY: ci-lint
ci-lint:
	npx nx run-many -t ci:lint

.PHONY: dev-int-build
dev-int-build:
	docker compose -p int -f ./docker-compose.ci.yml build

.PHONY: dev-int
dev-int:
	docker compose -p int -f ./docker-compose.ci.yml run --rm api dev:int $(FILE)
	docker compose -p int -f ./docker-compose.ci.yml down

.PHONY: ci-int
ci-int:
	docker compose -p int -f ./docker-compose.ci.yml run --rm api ci:int
	# @echo "\n\n"
	# @echo "Checking otel-collector...\n"
	# curl -v http://localhost:23133
	# @echo "\n\n"
	# @echo "Checking ingestor...\n"
	# curl -v http://localhost:28686/health

.PHONY: dev-unit
dev-unit:
	npx nx run-many -t dev:unit

.PHONY: ci-unit
ci-unit:
	npx nx run-many -t ci:unit

# TODO: check db connections before running the migration CLIs
.PHONY: dev-migrate-db
dev-migrate-db:
	@echo "Migrating Mongo db...\n"
	npx nx run @hyperdx/api:dev:migrate-db
	@echo "Migrating ClickHouse db...\n"
	npx nx run @hyperdx/api:dev:migrate-ch

.PHONY: build-local
build-local:

.PHONY: version
version:
	sh ./version.sh

.PHONY: release-local
release-local:
	docker buildx build --squash . -f ./docker/local/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context local=./docker/local \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--platform ${BUILD_PLATFORMS} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION} \
		-t ${LOCAL_IMAGE_NAME}:${IMAGE_VERSION} --push

.PHONY: release-ui
release-ui:
	docker buildx build . -f ./packages/app/Dockerfile \
		--build-arg IS_LOCAL_MODE=true \
		--build-arg PORT=${HYPERDX_APP_PORT} \
		--target prod \
		--platform ${BUILD_PLATFORMS} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}-ui \
		-t ${LOCAL_IMAGE_NAME}:${IMAGE_VERSION}-ui --push

.PHONY: release
release:
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/otel-collector \
		-t ${IMAGE_NAME}:${IMAGE_VERSION}-otel-collector \
		-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}-otel-collector \
		--target prod --push &
	docker buildx build --squash . -f ./docker/fullstack/Dockerfile \
		--build-context fullstack=./docker/fullstack \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--build-arg HYPERDX_API_PORT=${HYPERDX_API_PORT} \
		--platform ${BUILD_PLATFORMS} \
		-t ${IMAGE_NAME_DOCKERHUB}:${IMAGE_VERSION}-app \
		-t ${IMAGE_NAME}:${IMAGE_VERSION}-app \
		--target prod --push
