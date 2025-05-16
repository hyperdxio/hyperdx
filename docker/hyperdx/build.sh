#!/bin/bash
# Meant to be run from the root of the repo

# No Auth
docker build --squash . -f ./docker/hyperdx/Dockerfile \
    --build-context clickhouse=./docker/clickhouse \
    --build-context otel-collector=./docker/otel-collector \
    --build-context hyperdx=./docker/hyperdx \
    --build-context api=./packages/api \
    --build-context app=./packages/app \
    --target all-in-one-noauth -t hyperdx/dev-all-in-one-noauth
