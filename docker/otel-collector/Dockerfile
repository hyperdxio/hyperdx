## base #############################################################################################
FROM otel/opentelemetry-collector-contrib:0.126.0 AS col
FROM ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-opampsupervisor:0.126.0 AS supervisor 

# From: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/aa5c3aa4c7ec174361fcaf908de8eaca72263078/cmd/opampsupervisor/Dockerfile#L18
FROM alpine:latest@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c AS prep
RUN apk --update add ca-certificates
RUN mkdir -p /etc/otel/supervisor-data/

FROM scratch AS base

ARG USER_UID=10001
ARG USER_GID=10001
USER ${USER_UID}:${USER_GID}

COPY --from=prep /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=prep --chmod=777 --chown=${USER_UID}:${USER_GID} /etc/otel/supervisor-data /etc/otel/supervisor-data
COPY --from=supervisor --chmod=755 /usr/local/bin/opampsupervisor /
COPY ./supervisor_docker.yaml /etc/otel/supervisor.yaml
COPY --from=col --chmod=755 /otelcol-contrib /otelcontribcol

## dev ##############################################################################################
FROM base AS dev

COPY ./config.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 4317 4318 13133

ENTRYPOINT ["/opampsupervisor"]
CMD ["--config", "/etc/otel/supervisor.yaml"]

## prod #############################################################################################
FROM base AS prod

COPY ./config.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 4317 4318 13133

ENTRYPOINT ["/opampsupervisor"]
CMD ["--config", "/etc/otel/supervisor.yaml"]
