# Starts several services in a single container
# For production build:
# - API (Node)
# - App (Frontend)
# For all-in-one build:
# - Clickhouse
# - Mongo
# - Otel Collector (otelcol)

ARG NODE_VERSION=22.14.0
ARG CLICKHOUSE_VERSION=24
ARG OTEL_COLLECTOR_VERSION=0.120.0

# base #############################################################################################
# == Clickhouse/Base Image ==
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}-alpine AS clickhouse_base
# == Otel Collector Image ==
FROM otel/opentelemetry-collector-contrib:${OTEL_COLLECTOR_VERSION} AS otel_collector_base

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

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE false
ENV NEXT_PUBLIC_IS_LOCAL_MODE false
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/api,@hyperdx/app
RUN rm -rf node_modules && yarn workspaces focus @hyperdx/api @hyperdx/app --production


# prod ############################################################################################
FROM node:${NODE_VERSION}-alpine AS prod

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV production

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

USER node

# Set up API
WORKDIR /app/api
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/api/build ./packages/api/build
COPY --chown=node:node --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist
COPY --chown=node:node --from=node_base /app/packages/common-utils/node_modules ./packages/common-utils/node_modules

# Set up App
WORKDIR /app/app
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/app/public ./public
COPY --chown=node:node --from=builder /app/packages/app/.next ./.next
# COPY --chown=node:node --from=builder /app/packages/app/node_modules ./packages/app/node_modules
COPY --from=builder /app/packages/app/next.config.js ./next.config.js
COPY --from=builder /app/packages/app/package.json ./package.json

# Set up start script
COPY --chown=node:node --from=hyperdx ./entry.prod.sh /etc/local/entry.sh
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one base ############################################################################################
FROM scratch AS all-in-one-base

# Copy from clickhouse and otel collector bases
COPY --from=clickhouse_base / /
COPY --from=otel_collector_base /otelcol-contrib /usr/local/bin/otelcol-contrib

# Copy Node.js runtime from node base
COPY --from=node_base --link /usr/local/bin /usr/local/bin
COPY --from=node_base --link /usr/local/lib /usr/local/lib
COPY --from=node_base /usr/lib /usr/lib
COPY --from=node_base /usr/local/include /usr/local/include

# Set up Clickhouse
COPY --from=clickhouse ./local/*.xml /etc/clickhouse-server
COPY --from=hyperdx ./clickhouseConfig.xml /etc/clickhouse-server/config.xml

# Set up Otel Collector
COPY --from=otel-collector ./config.yaml /etc/otelcol-contrib/config.yaml

# Install MongoDB and other dependencies (consolidated into a single RUN command)
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories && \
  echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories && \
  apk update && \
  apk add --no-cache mongodb yaml-cpp=0.6.2-r2 curl && \
  mkdir -p /data/db && \
  rm -rf /var/cache/apk/*

ENV NODE_ENV production

# Set up App (copy from prod stage)
COPY --from=prod /app/api /app/api
COPY --from=prod /app/app /app/app
COPY --from=hyperdx ./entry.local.base.sh /etc/local/entry.base.sh

WORKDIR /app/app

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

