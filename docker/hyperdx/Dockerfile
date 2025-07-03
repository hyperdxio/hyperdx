# Starts several services in a single container
# For production build:
# - API (Node)
# - App (Frontend)
# For all-in-one build:
# - Clickhouse
# - Mongo
# - Otel Collector (otelcol)

ARG NODE_VERSION=22.16.0
ARG CLICKHOUSE_VERSION=25.6
ARG OTEL_COLLECTOR_VERSION=0.129.1
ARG OTEL_COLLECTOR_OPAMPSUPERVISOR_VERSION=0.128.0

# base #############################################################################################
# == Otel Collector Image ==
FROM otel/opentelemetry-collector-contrib:${OTEL_COLLECTOR_VERSION} AS otel_collector_base
FROM otel/opentelemetry-collector-opampsupervisor:${OTEL_COLLECTOR_OPAMPSUPERVISOR_VERSION} AS otel_collector_opampsupervisor_base

FROM node:${NODE_VERSION}-alpine AS node_base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/package.json ./packages/api/
COPY ./packages/app/jest.config.js ./packages/app/tsconfig.json ./packages/app/tsconfig.test.json ./packages/app/package.json ./packages/app/next.config.js ./packages/app/mdx.d.ts ./packages/app/.eslintrc.js ./packages/app/

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

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE true
ENV NEXT_PUBLIC_IS_LOCAL_MODE false
ENV NX_DAEMON=false
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/api,@hyperdx/app

# prod ############################################################################################
FROM node:${NODE_VERSION}-alpine AS prod

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV production

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

USER node

# Set up API and App
WORKDIR /app
COPY --chown=node:node --from=builder /app/packages/api/dist ./packages/api
COPY --chown=node:node --from=builder /app/packages/app/.next/standalone ./packages/app
COPY --chown=node:node --from=builder /app/packages/app/.next/static ./packages/app/packages/app/.next/static
COPY --chown=node:node --from=builder /app/packages/app/public ./packages/app/packages/app/public

# Set up start script
COPY --chown=node:node --from=hyperdx ./entry.prod.sh /etc/local/entry.sh
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one base ############################################################################################
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}-alpine AS all-in-one-base 

ARG CODE_VERSION

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
COPY --from=otel-collector ./supervisor_docker.yaml  /etc/otel/supervisor.yaml

# Install MongoDB and other dependencies (consolidated into a single RUN command)
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories && \
  echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories && \
  apk update && \
  apk add --no-cache mongodb yaml-cpp=0.6.2-r2 curl ca-certificates && \
  mkdir -p /data/db && \
  mkdir -p /etc/otel/supervisor-data && \
  rm -rf /var/cache/apk/*

ENV NODE_ENV production

# Set up App (copy from prod stage)
COPY --from=prod /app /app
COPY --from=hyperdx ./entry.local.base.sh /etc/local/entry.base.sh

WORKDIR /app

# Add hosts entry in entrypoint script instead of here

# Expose ports
EXPOSE 8080 4317 4318 13133 8123 9000

# all-in-one no auth ############################################################################################
FROM all-in-one-base AS all-in-one-noauth
COPY --from=hyperdx ./entry.local.noauth.sh /etc/local/entry.sh
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one with auth ############################################################################################
FROM all-in-one-base AS all-in-one-auth
COPY --from=hyperdx ./entry.local.auth.sh /etc/local/entry.sh
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

