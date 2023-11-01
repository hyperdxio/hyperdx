LATEST_VERSION := $$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
BUILD_PLATFORMS = linux/arm64/v8,linux/amd64

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

.PHONY: aws-ecs
aws-ecs:
	ecs-cli configure profile --profile-name ${ECS_PROFILE_NAME} --access-key ${AWS_ACCESS_KEY_ID} --secret-key ${AWS_SECRET_ACCESS_KEY}
	ecs-cli configure --cluster ${ECS_CLUSTER_NAME} --default-launch-type ${ECS_LAUNCH_TYPE} --region ${AWS_REGION} --config-name ${ECS_PROFILE_NAME}

.PHONY: aws-compose
aws-compose:
	HYPERDX_APP_URL=${HYPERDX_APP_ALB_URL} HYPERDX_APP_PORT=${HYPERDX_APP_ALB_PORT} ecs-cli compose --project-name ${ECS_CLUSTER_NAME} --file ./docker-compose.aws.yml --region ${AWS_REGION} --ecs-params ./aws/ecs-params.yml create --launch-type ${ECS_LAUNCH_TYPE} --create-log-groups

.PHONY: aws-create-service
aws-create-service:
	aws ecs create-service --service-name ${ECS_SERVICE_NAME} --cluster ${ECS_CLUSTER_NAME} --cli-input-json file://aws/service-definition.json

.PHONY: build-local
build-local:
	docker build ./docker/hostmetrics -t ${IMAGE_NAME}:${LATEST_VERSION}-hostmetrics --target prod &
	docker build ./docker/ingestor -t ${IMAGE_NAME}:${LATEST_VERSION}-ingestor --target prod &
	docker build ./docker/otel-collector -t ${IMAGE_NAME}:${LATEST_VERSION}-otel-collector --target prod &
	docker build --build-arg CODE_VERSION=${LATEST_VERSION} . -f ./packages/miner/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-miner --target prod &
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

.PHONY: release
release:
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/hostmetrics -t ${IMAGE_NAME}:${LATEST_VERSION}-hostmetrics --target prod --push &
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/ingestor -t ${IMAGE_NAME}:${LATEST_VERSION}-ingestor --target prod --push &
	docker buildx build --platform ${BUILD_PLATFORMS} ./docker/otel-collector -t ${IMAGE_NAME}:${LATEST_VERSION}-otel-collector --target prod --push &
	docker buildx build --build-arg CODE_VERSION=${LATEST_VERSION} --platform ${BUILD_PLATFORMS} . -f ./packages/miner/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-miner --target prod --push &
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
		--platform ${BUILD_PLATFORMS} . -f ./packages/app/Dockerfile -t ${IMAGE_NAME}:${LATEST_VERSION}-app --target prod --push

