## base #############################################################################################
FROM otel/opentelemetry-collector-contrib:0.145.0 AS col
FROM otel/opentelemetry-collector-opampsupervisor:0.145.0 AS supervisor
FROM hairyhenderson/gomplate:v4.3.3-alpine AS gomplate
FROM kukymbr/goose-docker@sha256:0cd025636df126e7f66472861ca4db3683bc649be46cd1f6ef1a316209058e23 AS goose

# Build the Go migration tool with full TLS support for ClickHouse
# Note: Build context must be repo root (use: docker build -f docker/otel-collector/Dockerfile .)
FROM golang:1.25-alpine AS migrate-builder
WORKDIR /build
COPY packages/otel-collector/go.mod packages/otel-collector/go.sum ./
RUN go mod download
COPY packages/otel-collector/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /migrate ./cmd/migrate

# From: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/aa5c3aa4c7ec174361fcaf908de8eaca72263078/cmd/opampsupervisor/Dockerfile#L18
FROM alpine:3.23@sha256:25109184c71bdad752c8312a8623239686a9a2071e8825f20acb8f2198c3f659 AS base

ARG USER_UID=10001
ARG USER_GID=10001

# Install certs, create user/group, and make the writable data dir
RUN apk add --no-cache ca-certificates && \
  addgroup -S -g ${USER_GID} otel && \
  adduser  -S -u ${USER_UID} -G otel otel && \
  install -d -m 0777 -o ${USER_UID} -g ${USER_GID} /etc/otel/supervisor-data && \
  install -d -m 0755 -o ${USER_UID} -g ${USER_GID} /etc/otelcol-contrib

# Copy gomplate binary from the gomplate image
COPY --from=gomplate /bin/gomplate /usr/local/bin/gomplate

# Copy goose binary for shell-based migrations (default)
COPY --from=goose /bin/goose /usr/local/bin/goose

# Copy migrate binary (Go-based goose migration tool with full TLS support)
COPY --from=migrate-builder /migrate /usr/local/bin/migrate

USER ${USER_UID}:${USER_GID}

COPY --from=supervisor --chmod=755 /usr/local/bin/opampsupervisor /opampsupervisor
COPY --from=col --chmod=755 /otelcol-contrib /otelcontribcol

# Copy entrypoint and log tail wrapper scripts
COPY --chmod=755 docker/otel-collector/entrypoint.sh /entrypoint.sh
COPY --chmod=755 docker/otel-collector/log-tailer.sh /log-tailer.sh

## dev ##############################################################################################
FROM base AS dev

LABEL org.opencontainers.image.vendor="HyperDX" \
  org.opencontainers.image.title="HyperDX OTel Collector (Dev)" \
  org.opencontainers.image.description="OpenTelemetry Collector for HyperDX development" \
  org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
  org.opencontainers.image.licenses="MIT"

COPY --chown=10001:10001 docker/otel-collector/config.yaml /etc/otelcol-contrib/config.yaml
COPY --chown=10001:10001 docker/otel-collector/config.standalone.yaml /etc/otelcol-contrib/standalone-config.yaml
COPY --chown=10001:10001 docker/otel-collector/config.standalone.auth.yaml /etc/otelcol-contrib/standalone-auth-config.yaml
COPY --chown=10001:10001 docker/otel-collector/supervisor_docker.yaml.tmpl /etc/otel/supervisor.yaml.tmpl
COPY --chown=10001:10001 docker/otel-collector/schema /etc/otel/schema

EXPOSE 4317 4318 13133

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:13133/ || exit 1

ENTRYPOINT ["/entrypoint.sh", "/opampsupervisor"]

## prod #############################################################################################
FROM base AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
  org.opencontainers.image.title="HyperDX OTel Collector" \
  org.opencontainers.image.description="OpenTelemetry Collector for HyperDX observability platform" \
  org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
  org.opencontainers.image.licenses="MIT"

COPY --chown=10001:10001 docker/otel-collector/config.yaml /etc/otelcol-contrib/config.yaml
COPY --chown=10001:10001 docker/otel-collector/config.standalone.yaml /etc/otelcol-contrib/standalone-config.yaml
COPY --chown=10001:10001 docker/otel-collector/config.standalone.auth.yaml /etc/otelcol-contrib/standalone-auth-config.yaml
COPY --chown=10001:10001 docker/otel-collector/supervisor_docker.yaml.tmpl /etc/otel/supervisor.yaml.tmpl
COPY --chown=10001:10001 docker/otel-collector/schema /etc/otel/schema

EXPOSE 4317 4318 13133

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:13133/ || exit 1

ENTRYPOINT ["/entrypoint.sh", "/opampsupervisor"]
