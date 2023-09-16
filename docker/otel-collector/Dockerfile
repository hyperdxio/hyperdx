## base #############################################################################################
FROM otel/opentelemetry-collector-contrib:0.83.0 AS base


## dev ##############################################################################################
FROM base as dev

COPY ./config.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 1888 4317 4318 55679 13133


## prod #############################################################################################
FROM base as prod

COPY ./config.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 1888 4317 4318 55679 13133
