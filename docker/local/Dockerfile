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

FROM clickhouse/clickhouse-server:23.11.1-alpine AS base

# ===
# === Install Deps
# ===

# == Install Otel Collector Deps ==
EXPOSE 1888 4317 4318 55679 13133

RUN apk update
RUN apk add wget shadow
RUN wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.90.1/otelcol-contrib_0.90.1_linux_arm64.apk
RUN apk add --allow-untrusted otelcol-contrib_0.90.1_linux_arm64.apk

# == Install Node Deps ==
RUN apk add nodejs npm yarn

# == Install Vector Deps ==
RUN apk add curl
RUN curl --proto '=https' --tlsv1.2 -sSfL https://sh.vector.dev | bash -s -- -y

# == Install MongoDB v4 Deps ==
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories
RUN apk update
RUN apk add mongodb yaml-cpp=0.6.2-r2

# == Install Redis ==
RUN apk add redis

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
COPY ./yarn.lock .
COPY --from=api ./package.json .
RUN yarn install --frozen-lockfile && yarn cache clean

COPY --from=api ./tsconfig.json .
COPY --from=api ./src ./src
RUN yarn run build

EXPOSE 8000

# Set up App
# NOTE: THIS PULLS FROM THE OSS DOCKER IMAGE BUILD, NOT FROM LOCAL
WORKDIR /app/app
COPY --from=app /app/public ./public
COPY --from=app /app/.next ./.next
COPY --from=app /app/node_modules ./node_modules
COPY --from=app /app/package.json ./package.json

EXPOSE 8080

# Set up start script
COPY --from=local ./entry.sh /etc/local/entry.sh
CMD sh /etc/local/entry.sh
