## base #############################################################################################
FROM otel/opentelemetry-collector-contrib:0.90.0 AS base


## dev #############################################################################################
FROM base as dev

COPY ./config.dev.yaml /etc/otelcol-contrib/config.yaml


## prod #############################################################################################
FROM base as prod

COPY ./config.dev.yaml /etc/otelcol-contrib/config.yaml
