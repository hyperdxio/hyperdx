## base #############################################################################################
FROM timberio/vector:0.33.0-alpine AS base

RUN mkdir -p /var/lib/vector
VOLUME ["/var/lib/vector"]

WORKDIR /app

COPY ./*.toml ./


## dev #############################################################################################
FROM base as dev

EXPOSE 8002 8686

ENTRYPOINT ["vector", "-c", "http-server.core.toml", "-c", "http-server.sinks.toml", "--require-healthy", "true"]


## prod #############################################################################################
FROM base as prod

EXPOSE 8002 8686

ENTRYPOINT ["vector", "-c", "http-server.core.toml", "-c", "http-server.sinks.toml", "--require-healthy", "true"]
