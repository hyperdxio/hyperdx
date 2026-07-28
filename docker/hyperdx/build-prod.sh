#!/bin/bash
# Builds the app-only image (API + Next.js app + alert task).
# ClickHouse, MongoDB and the OTel collector are NOT included — supply those
# externally.  For the batteries-included image see ./build.sh instead.
#
# Meant to be run from the root of the repo.
#
#   ./docker/hyperdx/build-prod.sh                 # build both arches
#   PUSH=1 ./docker/hyperdx/build-prod.sh          # build and push
#   VERSION=v2.32.0 PUSH=1 ./docker/hyperdx/build-prod.sh
#   PLATFORMS=linux/arm64 ./docker/hyperdx/build-prod.sh   # single arch, --load
#
# Multi-arch builds need a docker-container builder; the plain `docker` driver
# cannot export a manifest list.  Pick one with BUILDER, e.g.
#
#   BUILDER=colima-builder PUSH=1 ./docker/hyperdx/build-prod.sh

set -euo pipefail

IMAGE="${IMAGE:-myyrakle/hyperdx_plus}"
VERSION="${VERSION:-v2.31.1}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

extra=()

if [ -n "${BUILDER:-}" ]; then
    extra+=(--builder "$BUILDER")
fi

if [ "${PUSH:-0}" = "1" ]; then
    extra+=(--push)
elif [ "${PLATFORMS#*,}" = "$PLATFORMS" ]; then
    # Single platform, so the result can land in the local image store.
    extra+=(--load)
else
    echo "warning: multi-platform build without PUSH=1 — --load cannot export a" >&2
    echo "         manifest list, so the result stays in the build cache only." >&2
fi

docker buildx build . -f ./docker/hyperdx/Dockerfile \
    --target prod \
    --platform "$PLATFORMS" \
    --build-context hyperdx=./docker/hyperdx \
    --build-context api=./packages/api \
    --build-context app=./packages/app \
    --build-arg CODE_VERSION="$VERSION" \
    -t "$IMAGE:$VERSION" \
    ${extra[@]+"${extra[@]}"}
