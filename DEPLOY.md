# HyperDX Deployment Guide

[HyperDX](https://hyperdx.io) helps engineers quickly figure out why production
is broken by making it easy to search & visualize logs and traces on top of any
Clickhouse cluster (imagine Kibana, for Clickhouse). You can learn more about
HyperDX in our [README](/README.md).

HyperDX can be deployed in a few different ways:

- [Bring Your Own ClickHouse](#bring-your-own-clickhouse)
- [All-in-one Docker Compose Stack](#all-in-one-docker-compose-stack)
- [Local Development Mode](#local-development-mode)

## Bring Your Own ClickHouse

If you already have an existing ClickHouse cluster, you can simply deploy a
HyperDX container that connects to your ClickHouse cluster. You'll need a
separate MongoDB instance to persist your users, dashboards, searches and more.

To get started, you can run the following image:

```bash
docker run -e MONGO_URI=mongodb://YOUR_MONGODB_URI -p 8080:8080 docker.hyperdx.io/hyperdx/hyperdx:2-beta
```

You'll need to set the `MONGO_URI` environment variable to the URI of your
MongoDB instance. Afterwards, you'll want to visit http://localhost:8080 to set
up your connection with ClickHouse.

Before deploying into production, you'll want to set the
`EXPRESS_SESSION_SECRET` environment variable to a random string.

To customize the frontend URL, set the `FRONTEND_URL` environment variable to
the URL your HyperDX instance is hosted on.

## All-in-one Docker Compose Stack

The easiest way to get started with HyperDX from scratch is to use our
all-in-one Docker Compose stack. This stack will start Clickhouse, an
OpenTelemetry collector, and HyperDX with a MongoDB and Redis instance.

To get started, clone this repository and run the following command:

```bash
docker compose up -d
```

This will start the HyperDX stack and open a port for the UI, API, and OTel
collector.

When deploying into production, you'll want to disable any extra ports outside
of the otel collector and api container. Beware that exposing any port in Docker
Compose will make it publicly accessible even when using iptable-based firewalls
such as ufw. See the
[Docker docs](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)
for more information.

Additionally, you'll want to set the `EXPRESS_SESSION_SECRET` environment
variable to a random string.

## Local Development Mode

HyperDX can also be deployed alongside your existing local development stack to
help you debug issues locally. This mode will start an OpenTelemetry collector,
Clickhouse, and HyperDX with a MongoDB in a single instance, without any
authentication or configuration persistence.

To get started, spin up the local mode container:

```bash
docker run -p 8080:8080 docker.hyperdx.io/hyperdx/hyperdx-local:2-beta
```
