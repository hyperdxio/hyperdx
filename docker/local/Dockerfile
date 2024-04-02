# Starts several services in a single container for local use
# - Clickhouse
# - Mongo
# - Otel Collector (otelcol)
# - Ingestor (Vector)
# - API (Node)
# - Aggregator (Node)
# - App (Frontend)
# - Redis Cache

# TODO:
# - Customize ports, need to set up env vars or relax CORS and other port requirements
# - Have otel collector listen to a directory users can mount logs into
# - Allow persisting settings on disk
# - Limiting persisted data with some auto rotation

# Get Node base image to copy over Node binaries
ARG NODE_VERSION=18.15.0
FROM node:${NODE_VERSION}-alpine AS node

# == API Builder Image ==
FROM node:${NODE_VERSION}-alpine AS api_builder

WORKDIR /app/api
COPY ./yarn.lock .
COPY --from=api ./package.json .
RUN yarn install --frozen-lockfile && yarn cache clean

COPY --from=api ./tsconfig.json .
COPY --from=api ./src ./src
RUN yarn run build

# == App Builder Image ==
FROM node:${NODE_VERSION}-alpine AS app_builder

WORKDIR /app/app

COPY ./yarn.lock ./.yarnrc .
COPY ./.yarn ./.yarn
COPY --from=app ./package.json .

RUN yarn install --frozen-lockfile && yarn cache clean

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

FROM clickhouse/clickhouse-server:23.11.1-alpine AS clickhouse_base 

# Clean up 390MB of unused CH binaries
RUN rm -rf /usr/bin/clickhouse-odbc-bridge /usr/bin/clickhouse-library-bridge  /usr/bin/clickhouse-diagnostics
FROM scratch as base
COPY --from=clickhouse_base / /

# ===
# === Install Deps
# ===

# == Install Otel Collector Deps ==
EXPOSE 1888 4317 4318 55679 13133

RUN apk update
RUN apk add wget shadow
RUN wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.90.1/otelcol-contrib_0.90.1_linux_arm64.apk && \
  apk add --allow-untrusted otelcol-contrib_0.90.1_linux_arm64.apk && \
  rm -rf otelcol-contrib_0.90.1_linux_arm64.apk

# == Install Node Deps ==

COPY --from=node /usr/lib /usr/lib
COPY --from=node /usr/local/lib /usr/local/lib
COPY --from=node /usr/local/include /usr/local/include
COPY --from=node /usr/local/bin /usr/local/bin

RUN npm install -g yarn --force

# == Install Vector Deps ==
RUN apk add curl
RUN mkdir -p vector
RUN curl -sSfL --proto '=https' --tlsv1.2 https://packages.timber.io/vector/0.34.0/vector-0.34.0-x86_64-unknown-linux-musl.tar.gz | tar xzf - -C vector --strip-components=2 && \
  mv ./vector/bin/vector /usr/local/bin/vector && \
  rm -rf ./vector

# == Install MongoDB v4 Deps ==
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories
RUN apk update
RUN apk add mongodb yaml-cpp=0.6.2-r2

# == Install Redis ==
# If this version pinning fails, this is likely due to the version being dropped
# from APK
RUN apk add 'redis<7.0.14'

# ===
# === Set Up Services
# ===

# Set up Vector
COPY --from=ingestor ./*.toml /etc/vector/
EXPOSE 8002 8686

# Set up Clickhouse
COPY --from=clickhouse ./local/*.xml /etc/clickhouse-server
# overwrite default config
COPY --from=local ./clickhouseConfig.xml /etc/clickhouse-server/config.xml

# Set up Mongo
RUN mkdir -p /data/db

# Set up Otel Collector
COPY --from=otel-collector ./config.yaml /etc/otelcol-contrib/config.yaml

# Set up API
WORKDIR /app/api

COPY --from=api_builder ./app/api/build ./build
COPY ./yarn.lock .
COPY --from=api_builder ./app/api/package.json .

# Only install prod dependencies
RUN yarn install --production --frozen-lockfile && yarn cache clean

EXPOSE 8000

# Set up App
WORKDIR /app/app
COPY --from=app_builder ./app/app/public .
COPY --from=app_builder ./app/app/.next/standalone .
COPY --from=app_builder ./app/app/.next/static ./.next/static

EXPOSE 8080

# Set up start script
COPY --from=local ./entry.sh /etc/local/entry.sh
CMD sh /etc/local/entry.sh
