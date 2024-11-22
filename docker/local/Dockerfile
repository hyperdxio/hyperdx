# Starts several services in a single container for local use
# - Clickhouse
# - Mongo
# - Otel Collector (otelcol)
# - API (Node)
# - App (Frontend)
# - Redis Cache

# TODO:
# - Customize ports, need to set up env vars or relax CORS and other port requirements
# - Have otel collector listen to a directory users can mount logs into
# - Allow persisting settings on disk
# - Limiting persisted data with some auto rotation

ARG NODE_VERSION=18.20.3
ARG CLICKHOUSE_VERSION=24
ARG OTEL_COLLECTOR_VERSION=0.113.0
# Get Node base image to copy over Node binaries
FROM node:${NODE_VERSION}-alpine AS node

# == API Builder Image ==
# FROM node:${NODE_VERSION}-alpine AS api_builder

# WORKDIR /app/api
# COPY ./yarn.lock ./.yarnrc.yml .
# COPY ./.yarn ./.yarn
# COPY --from=api ./package.json .
# RUN yarn install && yarn cache clean

# COPY --from=api ./tsconfig.json .
# COPY --from=api ./src ./src
# RUN yarn run build

# == App Builder Image ==
FROM node:${NODE_VERSION}-alpine AS app_builder

WORKDIR /app/app

COPY ./yarn.lock ./.yarnrc.yml .
COPY ./.yarn ./.yarn
COPY --from=app ./package.json .

RUN yarn install && yarn cache clean

COPY --from=app ./.eslintrc.js ./next.config.js ./tsconfig.json ./next.config.js ./mdx.d.ts ./.eslintrc.js ./
COPY --from=app ./src ./src 
COPY --from=app ./pages ./pages 
COPY --from=app ./public ./public 
COPY --from=app ./styles ./styles

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE true
ENV NEXT_PUBLIC_IS_LOCAL_MODE true
RUN yarn build

# == Clickhouse/Base Image ==
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}-alpine AS clickhouse_base

# == Otel Collector Image ==
FROM otel/opentelemetry-collector-contrib:${OTEL_COLLECTOR_VERSION} AS otel_collector_base

FROM scratch as base
COPY --from=clickhouse_base / /
COPY --from=otel_collector_base /otelcol-contrib /usr/local/bin/otelcol-contrib

# ===
# === Install Deps
# ===

# == Install Node Deps ==
COPY --from=node /usr/lib /usr/lib
COPY --from=node /usr/local/lib /usr/local/lib
COPY --from=node /usr/local/include /usr/local/include
COPY --from=node /usr/local/bin /usr/local/bin

# RUN npm install -g yarn --force

# == Install MongoDB v4 Deps ==
# RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories
# RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories
# RUN apk update
# RUN apk add mongodb yaml-cpp=0.6.2-r2 
RUN apk add curl

# == Install Redis ==
# If this version pinning fails, this is likely due to the version being dropped
# from APK
# RUN apk add 'redis<7.0.14'

# ===
# === Set Up Services
# ===

# Set up Clickhouse
COPY --from=clickhouse ./local/*.xml /etc/clickhouse-server
# overwrite default config
COPY --from=local ./clickhouseConfig.xml /etc/clickhouse-server/config.xml

# Set up Mongo
# RUN mkdir -p /data/db

# Set up Otel Collector
COPY --from=otel-collector ./config.local.yaml /etc/otelcol-contrib/config.yaml

# Set up API (NOT USED YET)
# WORKDIR /app/api

# COPY --from=api_builder ./app/api/build ./build
# COPY ./yarn.lock ./.yarnrc.yml .
# COPY ./.yarn ./.yarn
# COPY --from=api_builder ./app/api/package.json .

# # Only install prod dependencies
# RUN yarn workspaces focus --production && yarn cache clean

# # Remove dev dependencies
# RUN rm -rf ./.yarn

# Set up App
WORKDIR /app/app
COPY --from=app_builder ./app/app/public .
COPY --from=app_builder ./app/app/.next/standalone .
COPY --from=app_builder ./app/app/.next/static ./.next/static

# Expose ports
EXPOSE 8000 8080 4317 4318 13133 8123 9000

# Set up start script
COPY --from=local ./entry.sh /etc/local/entry.sh
CMD sh /etc/local/entry.sh
