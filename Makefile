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
	docker build ./docker/hostmetrics -t ${IMAGE_NAME}:${LATEST_VERSION}-hostmetrics --target prod &
	docker build ./docker/ingestor -t ${IMAGE_NAME}:${LATEST_VERSION}-ingestor --target prod &
	docker build ./docker/otel-collector -t ${IMAGE_NAME}:${LATEST_VERSION}-otel-collector --target prod &
	docker build --build-arg CODE_VERSION=${LATEST_VERSION} . -f ./packages/miner/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-miner --target prod &
	docker build --build-arg CODE_VERSION=${LATEST_VERSION} . -f ./packages/go-parser/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-go-parser &
	docker build \
		--build-arg CODE_VERSION=${LATEST_VERSION} \
		--build-arg PORT=${HYPERDX_API_PORT} \
		. -f ./packages/api/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-api --target prod &
	docker build \
		--build-arg CODE_VERSION=${LATEST_VERSION} \
		--build-arg OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT} \
		--build-arg OTEL_SERVICE_NAME=${OTEL_SERVICE_NAME} \
		--build-arg PORT=${HYPERDX_APP_PORT} \
		--build-arg SERVER_URL=${HYPERDX_API_URL}:${HYPERDX_API_PORT} \
		. -f ./packages/app/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-app --target prod

.PHONY: version
version:
	sh ./version.sh

.PHONY: release-v2-beta-ui
release-v2-beta-ui:
	docker buildx build . -f ./packages/app/Dockerfile \
		--build-arg IS_LOCAL_MODE=true \
		--build-arg PORT=${HYPERDX_APP_PORT} \
		--target prod \
		--platform ${BUILD_PLATFORMS} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${V2_BETA_IMAGE_VERSION}-ui \
		-t ${LOCAL_IMAGE_NAME}:${V2_BETA_IMAGE_VERSION}-ui --push

.PHONY: release-v2-beta
release-v2-beta:
	docker buildx build --squash . -f ./docker/local/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context local=./docker/local \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--platform ${BUILD_PLATFORMS} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${V2_BETA_IMAGE_VERSION} \
		-t ${LOCAL_IMAGE_NAME}:${V2_BETA_IMAGE_VERSION} --push

.PHONY: release
release:
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/hostmetrics -t ${IMAGE_NAME}:${LATEST_VERSION}-hostmetrics --target prod --push &
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/ingestor -t ${IMAGE_NAME}:${LATEST_VERSION}-ingestor --target prod --push &
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/otel-collector -t ${IMAGE_NAME}:${LATEST_VERSION}-otel-collector --target prod --push &
	docker buildx build --build-arg CODE_VERSION=${LATEST_VERSION} --platform ${BUILD_PLATFORMS} . -f ./packages/miner/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-miner --target prod --push &
	docker buildx build --build-arg CODE_VERSION=${LATEST_VERSION} --platform ${BUILD_PLATFORMS} . -f ./packages/go-parser/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-go-parser --push &
	docker buildx build \
		--build-arg CODE_VERSION=${LATEST_VERSION} \
		--build-arg PORT=${HYPERDX_API_PORT} \
		--platform ${BUILD_PLATFORMS} . -f ./packages/api/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-api --target prod --push &
	docker buildx build \
		--build-arg CODE_VERSION=${LATEST_VERSION} \
		--build-arg OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT} \
		--build-arg OTEL_SERVICE_NAME=${OTEL_SERVICE_NAME} \
		--build-arg PORT=${HYPERDX_APP_PORT} \
		--build-arg SERVER_URL=${HYPERDX_API_URL}:${HYPERDX_API_PORT} \
		--platform ${BUILD_PLATFORMS} . -f ./packages/app/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-app --target prod --push &
	docker buildx build \
		--squash . -f ./docker/local/Dockerfile \
		--build-context clickhouse=./docker/clickhouse \
		--build-context otel-collector=./docker/otel-collector \
		--build-context ingestor=./docker/ingestor \
		--build-context local=./docker/local \
		--build-context api=./packages/api \
		--build-context app=./packages/app \
		--platform ${BUILD_PLATFORMS} \
		-t ${LOCAL_IMAGE_NAME_DOCKERHUB}:latest -t ${LOCAL_IMAGE_NAME_DOCKERHUB}:${LATEST_VERSION} \
		-t ${LOCAL_IMAGE_NAME}:latest -t ${LOCAL_IMAGE_NAME}:${LATEST_VERSION} --push
