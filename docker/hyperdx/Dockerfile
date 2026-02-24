# Starts several services in a single container
# For production build:
# - API (Node)
# - App (Frontend)
# For all-in-one build:
# - Clickhouse
# - Mongo
# - Otel Collector (otelcol)

ARG NODE_VERSION=22.22
ARG CLICKHOUSE_VERSION=26.1
ARG OTEL_COLLECTOR_VERSION=0.145.0
ARG OTEL_COLLECTOR_OPAMPSUPERVISOR_VERSION=0.145.0

# base #############################################################################################
# == Otel Collector Image ==
FROM otel/opentelemetry-collector-contrib:${OTEL_COLLECTOR_VERSION} AS otel_collector_base
FROM otel/opentelemetry-collector-opampsupervisor:${OTEL_COLLECTOR_OPAMPSUPERVISOR_VERSION} AS otel_collector_opampsupervisor_base
FROM kukymbr/goose-docker@sha256:0cd025636df126e7f66472861ca4db3683bc649be46cd1f6ef1a316209058e23 AS goose

# Build the Go migration tool with full TLS support for ClickHouse
FROM golang:1.26-alpine AS migrate-builder
WORKDIR /build
COPY packages/otel-collector/go.mod packages/otel-collector/go.sum ./
RUN go mod download
COPY packages/otel-collector/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /migrate ./cmd/migrate

FROM node:${NODE_VERSION}-alpine AS node_base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./tsconfig.base.json ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/tsconfig.build.json ./packages/api/package.json ./packages/api/
COPY ./packages/app/jest.config.js ./packages/app/tsconfig.json ./packages/app/tsconfig.build.json ./packages/app/package.json ./packages/app/next.config.mjs ./packages/app/mdx.d.ts ./packages/app/eslint.config.mjs ./packages/app/

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

RUN yarn install --mode=skip-build && yarn cache clean


## API/APP Builder Image ##########################################################################
FROM node_base AS builder

WORKDIR /app

COPY --from=api ./src ./packages/api/src
COPY --from=app ./src ./packages/app/src
COPY --from=app ./pages ./packages/app/pages
COPY --from=app ./public ./packages/app/public
COPY --from=app ./styles ./packages/app/styles
COPY --from=app ./types ./packages/app/types

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_STANDALONE=true
ENV NEXT_PUBLIC_IS_LOCAL_MODE=false
ENV NX_DAEMON=false
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/api,@hyperdx/app
RUN rm -rf node_modules && yarn workspaces focus @hyperdx/api --production


# prod ############################################################################################
FROM node:${NODE_VERSION}-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX Production" \
      org.opencontainers.image.description="HyperDX production image with API and App services" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV=production

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

USER node

# Set up API and App
WORKDIR /app
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/api/build ./packages/api/build
COPY --chown=node:node --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist
COPY --chown=node:node --from=node_base /app/packages/common-utils/node_modules ./packages/common-utils/node_modules
COPY --chown=node:node --from=builder /app/packages/app/.next/standalone ./packages/app
COPY --chown=node:node --from=builder /app/packages/app/.next/static ./packages/app/packages/app/.next/static
COPY --chown=node:node --from=builder /app/packages/app/public ./packages/app/packages/app/public

# Set up start script
COPY --chown=node:node --from=hyperdx ./entry.prod.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8000/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one base ############################################################################################
FROM hairyhenderson/gomplate:v4.3.3-alpine AS gomplate
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}-alpine AS all-in-one-base

ARG CODE_VERSION
ARG USER_UID=10001
ARG USER_GID=10001

ENV CODE_VERSION=$CODE_VERSION
# Copy from otel collector bases
COPY --from=otel_collector_base --chmod=755 /otelcol-contrib /otelcontribcol
COPY --from=otel_collector_opampsupervisor_base --chmod=755 /usr/local/bin/opampsupervisor /usr/local/bin/opampsupervisor

# Copy Node.js runtime from node base
COPY --from=node_base --link /usr/local/bin /usr/local/bin
COPY --from=node_base --link /usr/local/lib /usr/local/lib
COPY --from=node_base /usr/lib /usr/lib
COPY --from=node_base /usr/local/include /usr/local/include

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

# Set up Clickhouse
COPY --from=clickhouse ./local/*.xml /etc/clickhouse-server
COPY --from=hyperdx ./clickhouseConfig.xml /etc/clickhouse-server/config.xml

# Set up Otel Collector
COPY --from=otel-collector ./config.yaml /etc/otelcol-contrib/config.yaml
COPY --from=otel-collector ./supervisor_docker.yaml.tmpl /etc/otel/supervisor.yaml.tmpl
COPY --from=otel-collector ./schema /etc/otel/schema

# Copy otel-collector entrypoint script
COPY --from=otel-collector --chmod=755 ./entrypoint.sh /otel-entrypoint.sh

# Copy gomplate binary from the gomplate image
COPY --from=gomplate /bin/gomplate /usr/local/bin/gomplate

# Copy goose binary from the goose image
COPY --from=goose /bin/goose /usr/local/bin/goose

# Copy migrate binary (Go-based goose migration tool with full TLS support)
COPY --from=migrate-builder /migrate /usr/local/bin/migrate

# Install MongoDB and other dependencies (consolidated into a single RUN command)
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories && \
  echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories && \
  apk update && \
  apk add --no-cache mongodb yaml-cpp=0.6.2-r2 curl ca-certificates && \
  addgroup -S -g ${USER_GID} otel && \
  adduser  -S -u ${USER_UID} -G otel otel && \
  mkdir -p /data/db && \
  install -d -m 0777 -o ${USER_UID} -g ${USER_GID} /etc/otel/supervisor-data && \
  rm -rf /var/cache/apk/*

ENV NODE_ENV=production

# Set up App (copy from prod stage)
COPY --from=prod /app /app
COPY --from=hyperdx ./entry.local.base.sh /etc/local/entry.base.sh

WORKDIR /app

# Add hosts entry in entrypoint script instead of here

# Expose ports
EXPOSE 8080 4317 4318 13133 8123 9000

# all-in-one no auth ############################################################################################
FROM all-in-one-base AS all-in-one-noauth

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX All-in-One (No Auth)" \
      org.opencontainers.image.description="HyperDX all-in-one image with ClickHouse, MongoDB, and OTel Collector (no authentication)" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

COPY --from=hyperdx ./entry.local.noauth.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one with auth ############################################################################################
FROM all-in-one-base AS all-in-one-auth

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX All-in-One (With Auth)" \
      org.opencontainers.image.description="HyperDX all-in-one image with ClickHouse, MongoDB, and OTel Collector (with authentication)" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

COPY --from=hyperdx ./entry.local.auth.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

ENTRYPOINT ["sh", "/etc/local/entry.sh"]

