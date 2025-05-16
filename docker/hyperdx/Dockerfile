# Starts several services in a single container for local use
# - API (Node)
# - App (Frontend)

ARG NODE_VERSION=22.14.0
ARG CLICKHOUSE_VERSION=24
ARG OTEL_COLLECTOR_VERSION=0.120.0

# base #############################################################################################
# == Clickhouse/Base Image ==
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}-alpine AS clickhouse_base
# == Otel Collector Image ==
FROM otel/opentelemetry-collector-contrib:${OTEL_COLLECTOR_VERSION} AS otel_collector_base

FROM node:${NODE_VERSION}-alpine AS node_base

WORKDIR /app/api

COPY ./yarn.lock ./.yarnrc.yml ./
COPY ./.yarn ./.yarn
COPY --from=api ./package.json .
RUN yarn install && yarn cache clean

WORKDIR /app/app

COPY ./yarn.lock ./.yarnrc.yml ./
COPY ./.yarn ./.yarn
COPY --from=app ./package.json ./

RUN yarn install && yarn cache clean


## API Builder Image ###############################################################################
FROM node_base AS api_builder

WORKDIR /app/api

COPY --from=api ./tsconfig.json ./
COPY --from=api ./src ./src
RUN yarn build && rm -rf node_modules && yarn workspaces focus --production


# APP Builder Image ###############################################################################
FROM node_base AS app_builder

WORKDIR /app/app

COPY --from=app ./.eslintrc.js ./next.config.js ./tsconfig.json ./next.config.js ./mdx.d.ts ./.eslintrc.js ./
COPY --from=app ./src ./src 
COPY --from=app ./pages ./pages 
COPY --from=app ./public ./public 
COPY --from=app ./styles ./styles

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE false
ENV NEXT_PUBLIC_IS_LOCAL_MODE false
RUN yarn build && rm -rf node_modules && yarn workspaces focus --production


# prod ############################################################################################
FROM node:${NODE_VERSION}-alpine AS prod

ENV NODE_ENV production

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

USER node

# Set up API
WORKDIR /app/api
COPY --chown=node:node --from=api_builder ./app/api/build ./build
COPY --chown=node:node --from=api_builder ./app/api/node_modules ./node_modules

# Set up App
WORKDIR /app/app
COPY --from=app_builder /app/app/next.config.js ./
COPY --chown=node:node --from=app_builder /app/app/public ./public
COPY --chown=node:node --from=app_builder /app/app/.next ./.next
COPY --from=app_builder /app/app/node_modules ./node_modules
COPY --from=app_builder /app/app/package.json ./package.json

# Set up start script
COPY --chown=node:node --from=hyperdx ./entry.prod.sh /etc/local/entry.sh
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# prod-extended ############################################################################################
FROM scratch AS all-in-one

# Copy base
COPY --from=clickhouse_base / /
COPY --from=otel_collector_base /otelcol-contrib /usr/local/bin/otelcol-contrib
COPY --from=node_base --link /usrlocal./local/bin /usr/local/bin
COPY --from=node_base --link /usr/local/lib /usr/local/lib
COPY --from=node_base /usr/lib /usr/lib
COPY --from=node_base /usr/local/include /usr/local/include


# Set up Clickhouse
COPY --from=clickhouse ./local/*.xml /etc/clickhouse-server
# overwrite default config
COPY --from=hyperdx ./clickhouseConfig.xml /etc/clickhouse-server/config.xml
# Set up Otel Collector
COPY --from=otel-collector ./config.yaml /etc/otelcol-contrib/config.yaml

# == Install MongoDB v4 Deps ==
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories
RUN apk update
RUN apk add mongodb yaml-cpp=0.6.2-r2

# Install libs used for the start script
RUN apk add curl

# Set up Mongo directories with proper permissions
RUN mkdir -p /data/db

ENV NODE_ENV production

# Set up App
COPY --from=prod /app/api /app/api
COPY --from=prod /app/app /app/app
COPY --from=hyperdx ./entry.local.sh /etc/local/entry.sh

WORKDIR /app/app
# Expose ports
EXPOSE 8080 4317 4318 13133 8123 9000
ENTRYPOINT ["sh", "/etc/local/entry.sh"]
