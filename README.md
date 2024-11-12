<p align="center">
  <a href="https://hyperdx.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./.github/images/logo_dark.png#gh-dark-mode-only">
      <img alt="hyperdx logo" src="./.github/images/logo_light.png#gh-light-mode-only">
    </picture>
  </a>
</p>

---

# HyperDX

[HyperDX](https://hyperdx.io) helps engineers quickly figure out why production
is broken by making it easy to search & visualize logs and traces on top of any
Clickhouse cluster (imagine Kibana, for Clickhouse).

<p align="center">
  <a href="https://www.hyperdx.io/docs/v2/">Documentation</a> • <a href="https://hyperdx.io/discord">Chat on Discord</a>  • <a href="https://play.hyperdx.io/search">Live Demo</a>  • <a href="https://github.com/hyperdxio/hyperdx/issues/new">Bug Reports</a> • <a href="./CONTRIBUTING.md">Contributing</a> • <a href="https://hyperdx.io/v2">Website</a>
</p>

- 🕵️ Correlate/search logs and traces all in one place
- 📝 Schema agnostic, works on top of your existing Clickhouse schema
- 🔥 Blazing fast searches & visualizations optimized for Clickhouse
- 🔍 Intuitive full-text search and property search syntax (ex. `level:err`),
  SQL optional!
- 📊 Analyze trends in anomalies with event deltas
- 📈 Dashboard high cardinality events without a complex query language
- `{` Native JSON string querying
- ⚡ Live tail logs and traces to always get the freshest events
- 🔭 OpenTelemetry supported out of the box
- ⏱️ Monitor health and performance from HTTP requests to DB queries (APM)

<br/>
<img alt="Search logs and traces all in one place" src="./.github/images/search_splash.png" title="Search logs and traces all in one place">

## Spinning Up HyperDX

> **Note:** HyperDX v2 is currently in beta for local mode.

You can get started by standing up the HyperDX local container, which will run
an OpenTelemetry collector (on port 4317), Clickhouse (on port 8123), and the
HyperDX UI (on port 8080).

You can spin up the container with the following command:

```bash
docker run -p 8080:8080 -p 8123:8123 -p 4317:4317 -p 4318:4318 hyperdx/hyperdx-local:2-beta
```

Afterwards, you can visit http://localhost:8080 to access the HyperDX UI. If
you're connecting to an external Clickhouse cluster, you can simply just forward
port 8080 and set up the connection in the UI.

> **Safari & Brave Browser Users:** There are known issues with Safari & Brave's
> CORS implementation that can prevent connecting to Clickhouse in local mode.
> We recommend using another browser in the interim.

> We recommend having _at least_ 1GB of RAM and 1 CPU core available for the
> container if using the included OpenTelemetry collector and Clickhouse server.

### Hosted Cloud

HyperDX is also available as a hosted cloud service at
[hyperdx.io](https://hyperdx.io). You can sign up for a free account and start
sending data in minutes.

## Instrumenting Your App

To get logs, metrics, traces, session replay, etc into HyperDX, you'll need to
instrument your app to collect and send telemetry data over to your HyperDX
instance.

We provide a set of SDKs and integration options to make it easier to get
started with HyperDX, such as
[Browser](https://www.hyperdx.io/docs/install/browser),
[Node.js](https://www.hyperdx.io/docs/install/javascript), and
[Python](https://www.hyperdx.io/docs/install/python)

You can find the full list in [our docs](https://www.hyperdx.io/docs).

**OpenTelemetry**

Additionally, HyperDX is compatible with
[OpenTelemetry](https://opentelemetry.io/), a vendor-neutral standard for
instrumenting your application backed by CNCF. Supported languages/platforms
include:

- Kubernetes
- Javascript
- Python
- Java
- Go
- Ruby
- PHP
- .NET
- Elixir
- Rust

(Full list [here](https://opentelemetry.io/docs/instrumentation/))

Once HyperDX is running, you can point your OpenTelemetry SDK to the
OpenTelemetry collector spun up at `http://localhost:4318`.

## Contributing

We welcome all contributions! There's many ways to contribute to the project,
including but not limited to:

- Opening a PR ([Contribution Guide](./CONTRIBUTING.md))
- [Submitting feature requests or bugs](https://github.com/hyperdxio/hyperdx/issues/new)
- Improving our product or contribution documentation
- Voting on [open issues](https://github.com/hyperdxio/hyperdx/issues) or
  contributing use cases to a feature request

## Motivation

Our mission is to help engineers ship reliable software. To enable that, we
believe every engineer needs to be able to easily leverage production telemetry
to quickly solve burning production issues.

However, in our experience, the existing tools we've used tend to fall short in
a few ways:

1. They're expensive, and the pricing has failed to scale with TBs of telemetry
   becoming the norm, leading to teams aggressively cutting the amount of data
   they can collect.
2. They're hard to use, requiring full-time SREs to set up, and domain experts
   to use confidently.
3. They requiring hopping from tool to tool (logs, session replay, APM,
   exceptions, etc.) to stitch together the clues yourself.

We're still early on in our journey, but are building in the open to solve these
key issues in observability. We hope you give HyperDX a try and let us know how
we're doing!

## Open Source vs Hosted Cloud

HyperDX is open core, with most of our features available here under an MIT
license. We have a cloud-hosted version available at
[hyperdx.io](https://hyperdx.io) with a few
[additional features](https://www.hyperdx.io/docs/oss-vs-cloud) beyond what's
offered in the open source version.

Our cloud hosted version exists so that we can build a sustainable business and
continue building HyperDX as an open source platform. We hope to have more
comprehensive documentation on how we balance between cloud-only and open source
features in the future. In the meantime, we're highly aligned with Gitlab's
[stewardship model](https://handbook.gitlab.com/handbook/company/stewardship/).

## Contact

- [Open an Issue](https://github.com/hyperdxio/hyperdx/issues/new)
- [Discord](https://discord.gg/FErRRKU78j)
- [Email](mailto:support@hyperdx.io)

## License

[MIT](/LICENSE)
