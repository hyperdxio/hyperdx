.PHONY: install
install:
	yarn install

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

.PHONY: build-env-file
build-env-file:
	cp .env .ghcr.env
	sed -i '/IMAGE_VERSION=.*/c\IMAGE_VERSION=${RELEASE_VERSION}' .ghcr.env
	sed -i '/IMAGE_NAME=.*/c\IMAGE_NAME=${GHCR_REPO}' .ghcr.env


