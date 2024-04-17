#!/bin/bash
# Meant to be run from the root of the repo

docker build --squash -t hdx-oss-dev-local -f ./docker/local/Dockerfile \
  --build-context clickhouse=./docker/clickhouse \
  --build-context otel-collector=./docker/otel-collector \
  --build-context ingestor=./docker/ingestor \
  --build-context local=./docker/local \
  --build-context api=./packages/api \
  --build-context app=./packages/app \
  .
