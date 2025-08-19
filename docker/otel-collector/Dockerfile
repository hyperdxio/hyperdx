## base #############################################################################################
FROM otel/opentelemetry-collector-contrib:0.129.1 AS col
FROM otel/opentelemetry-collector-opampsupervisor:0.128.0 AS supervisor

# From: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/aa5c3aa4c7ec174361fcaf908de8eaca72263078/cmd/opampsupervisor/Dockerfile#L18
FROM alpine:latest@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c AS base

ARG USER_UID=10001
ARG USER_GID=10001

# Install certs, gomplate for templating, create user/group, and make the writable data dir
RUN apk add --no-cache ca-certificates && \
  wget -O /usr/local/bin/gomplate https://github.com/hairyhenderson/gomplate/releases/download/v4.3.3/gomplate_linux-amd64 && \
  chmod +x /usr/local/bin/gomplate && \
  addgroup -S -g ${USER_GID} otel && \
  adduser  -S -u ${USER_UID} -G otel otel && \
  install -d -m 0777 -o ${USER_UID} -g ${USER_GID} /etc/otel/supervisor-data

USER ${USER_UID}:${USER_GID}

COPY --from=supervisor --chmod=755 /usr/local/bin/opampsupervisor /opampsupervisor
COPY --from=col --chmod=755 /otelcol-contrib /otelcontribcol

# Copy entrypoint and log rotation scripts
COPY --chmod=755 ./entrypoint.sh /entrypoint.sh
COPY --chmod=755 ./log-rotator.sh /log-rotator.sh

## dev ##############################################################################################
FROM base AS dev

COPY ./config.yaml /etc/otelcol-contrib/config.yaml
COPY ./supervisor_docker.yaml.tmpl /etc/otel/supervisor.yaml.tmpl

EXPOSE 4317 4318 13133

ENTRYPOINT ["/entrypoint.sh", "/opampsupervisor"]
CMD ["--config", "/etc/otel/supervisor.yaml"]

## prod #############################################################################################
FROM base AS prod

COPY ./config.yaml /etc/otelcol-contrib/config.yaml
COPY ./supervisor_docker.yaml.tmpl /etc/otel/supervisor.yaml.tmpl

EXPOSE 4317 4318 13133

ENTRYPOINT ["/entrypoint.sh", "/opampsupervisor"]
CMD ["--config", "/etc/otel/supervisor.yaml"]
