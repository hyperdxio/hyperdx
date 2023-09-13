LATEST_VERSION := $$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
BUILD_PLATFORMS = linux/arm64/v8,linux/arm/v7,linux/amd64

include .env

.PHONY: all
all: install-tools

.PHONY: install-tools
install-tools:
	yarn install
	@echo "All tools installed"

.PHONY: dev-lint
dev-lint:
	./docker/ingestor/run_linting.sh && yarn workspaces run lint

.PHONY: ci-lint
ci-lint:
	./docker/ingestor/run_linting.sh && yarn workspaces run ci:lint

.PHONY: dev-int
dev-int:
	docker compose -p int -f ./docker-compose.ci.yml run --rm api dev:int

.PHONY: ci-int
ci-int:
	docker compose -p int -f ./docker-compose.ci.yml run --rm api ci:int


.PHONY: build-and-push-ghcr
build-and-push-ghcr:
	docker buildx build --platform ${BUILD_PLATFORMS} . -f ./packages/miner/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-miner  --target dev --push &
	docker buildx build --platform ${BUILD_PLATFORMS} . -f ./docker/hostmetrics/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-hostmetrics  --target dev --push &
	docker buildx build --platform ${BUILD_PLATFORMS} . -f ./docker/ingestor/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-ingestor  --target dev --push &
	docker buildx build --platform ${BUILD_PLATFORMS} . -f ./docker/otel-collector/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-otel-collector  --target dev --push &
	docker buildx build --platform ${BUILD_PLATFORMS} . -f ./packages/api/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-api  --target dev --push &
	docker buildx build --platform ${BUILD_PLATFORMS} . -f ./packages/app/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-app  --target prod --push


