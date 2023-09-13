LATEST_VERSION = $$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)

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
	cp .shared.env .ghcr.env
	echo "IMAGE_VERSION=${LATEST_VERSION}" >> .ghcr.env
	DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose --env-file .ghcr.env -f docker-compose.yml build
	DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose --env-file .ghcr.env -f docker-compose.yml push
