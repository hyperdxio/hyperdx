# ClickStack Deployment Guide

[ClickStack](https://hyperdx.io) helps engineers quickly figure out why production
is broken by making it easy to search & visualize logs and traces on top of any
ClickHouse cluster (imagine Kibana, for ClickHouse). You can learn more about
ClickStack in our [README](/README.md).

ClickStack can be deployed in a few different ways:

- [Bring Your Own ClickHouse](#bring-your-own-clickhouse)
- [All-in-one Docker Compose Stack](#all-in-one-docker-compose-stack)
- [Local Development Mode](#local-development-mode)

## Container image names

ClickStack images are published to Docker Hub under the `clickhouse` namespace
and are also served from `docker.clickhouse.com`:

| Image                       | Name                                   |
| --------------------------- | -------------------------------------- |
| ClickStack (UI + API)       | `clickhouse/clickstack`                |
| All-in-one (with auth)      | `clickhouse/clickstack-all-in-one`     |
| Local (all-in-one, no auth) | `clickhouse/clickstack-local`          |
| OpenTelemetry collector     | `clickhouse/clickstack-otel-collector` |

The legacy `hyperdx/hyperdx`, `hyperdx/hyperdx-all-in-one`,
`hyperdx/hyperdx-local` and `hyperdx/hyperdx-otel-collector` names (also served
from `docker.hyperdx.io`) keep receiving the same tags for a transition period.
Switch to the `clickhouse/clickstack-*` names now; the date the legacy names
stop updating will be announced in the changelog.

## Bring Your Own ClickHouse

If you already have an existing ClickHouse cluster, you can simply deploy the
ClickStack container that connects to your ClickHouse cluster. You'll need a
separate MongoDB instance to persist your users, dashboards, searches and more.

To get started, you can run the following image:

```bash
docker run -e MONGO_URI=mongodb://YOUR_MONGODB_URI -p 8080:8080 docker.clickhouse.com/clickhouse/clickstack:2
```

You'll need to set the `MONGO_URI` environment variable to the URI of your
MongoDB instance. Afterwards, you'll want to visit http://localhost:8080 to set
up your connection with ClickHouse.

Before deploying into production, set the `EXPRESS_SESSION_SECRET` environment
variable to a random string (e.g. `openssl rand -hex 32`). Without it the API
generates one per process, which signs users out on every restart and prevents
replicas from sharing sessions. The old public value `hyperdx is cool 👋` is
also replaced with a per-process secret when authentication is enabled.

To customize the frontend URL, set the `FRONTEND_URL` environment variable to
the URL your ClickStack instance is hosted on.

## All-in-one Docker Compose Stack

The easiest way to get started with ClickStack from scratch is to use our
all-in-one Docker Compose stack. This stack will start ClickHouse, an
OpenTelemetry collector, the ClickStack UI and API, and MongoDB.

To get started, clone this repository and run the following command:

```bash
docker compose up -d
```

This will start the ClickStack stack and open a port for the UI, API, and OTel
collector.

When deploying into production, you'll want to disable any extra ports outside
of the otel collector and api container. Beware that exposing any port in Docker
Compose will make it publicly accessible even when using iptable-based firewalls
such as ufw. See the
[Docker docs](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)
for more information.

Generate a secret once with `openssl rand -hex 32`, then set
`EXPRESS_SESSION_SECRET=<generated value>` in `.env.local`, which Git ignores.
Do not put the secret in the tracked root `.env`. Compose forwards this value to
the app container when you load `.env.local` after `.env`:

```bash
docker compose --env-file .env --env-file .env.local up -d
```

Reuse the same secret across restarts and all replicas. Without it the API
generates one per process, which signs users out on every restart and prevents
replicas from sharing sessions. The old public value is not a production secret.

## Local Development Mode

ClickStack can also be deployed alongside your existing local development stack to
help you debug issues locally. This mode will start an OpenTelemetry collector,
ClickHouse, the ClickStack UI and API, and MongoDB in a single container, without any
authentication or configuration persistence.

To get started, spin up the local mode container:

```bash
docker run -p 8080:8080 docker.clickhouse.com/clickhouse/clickstack-local:2
```
