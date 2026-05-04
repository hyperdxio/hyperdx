## base #############################################################################################
FROM otel/opentelemetry-collector-contrib:0.90.0 AS base


## dev #############################################################################################
FROM base as dev

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX Host Metrics (Dev)" \
      org.opencontainers.image.description="Host metrics collector for HyperDX development" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

COPY ./config.dev.yaml /etc/otelcol-contrib/config.yaml


## prod #############################################################################################
FROM base as prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX Host Metrics" \
      org.opencontainers.image.description="Host metrics collector for HyperDX observability platform" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

COPY ./config.dev.yaml /etc/otelcol-contrib/config.yaml
