# HyperDX OTel Collector

Custom-built OpenTelemetry Collector for HyperDX, compiled via
[OCB (OpenTelemetry Collector Builder)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder).
This replaces the pre-built `otel/opentelemetry-collector-contrib` image with a
binary that includes the components HyperDX needs plus commonly-used core and
contrib components, and any custom receivers/processors added in this package.

## Architecture

### Build process

The collector binary is built during `docker build` via a multi-stage
Dockerfile:

1. The `ocb` binary is copied from the official
   `otel/opentelemetry-collector-builder:<version>` image
2. It's placed into a `golang:<version>-alpine` base (the official OCB image may
   ship an older Go than the contrib modules require)
3. Version placeholders in `builder-config.yaml` are substituted via `sed`
4. `ocb` compiles the custom binary from the resolved manifest

### Key files

| File                  | Purpose                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builder-config.yaml` | OCB manifest — declares which components to include. Uses `__OTEL_COLLECTOR_VERSION__` and `__OTEL_COLLECTOR_CORE_VERSION__` placeholders substituted at build time. |
| `cmd/migrate/main.go` | Go-based ClickHouse migration tool (goose) with full TLS support                                                                                                     |
| `go.mod` / `go.sum`   | Go module for the migration tool                                                                                                                                     |

### Dockerfiles that build this collector

| Dockerfile                         | Description                                                          |
| ---------------------------------- | -------------------------------------------------------------------- |
| `docker/otel-collector/Dockerfile` | Standalone collector image (dev + prod targets)                      |
| `docker/hyperdx/Dockerfile`        | All-in-one image (includes collector, ClickHouse, MongoDB, API, App) |

### Version configuration

The collector version is controlled by two variables:

- **`OTEL_COLLECTOR_VERSION`** — The contrib/core component version (e.g.
  `0.149.0`)
- **`OTEL_COLLECTOR_CORE_VERSION`** — The core confmap provider version (e.g.
  `1.55.0`)

These are defined in the root `.env` file and passed as Docker build args. Both
Dockerfiles also have matching `ARG` defaults as fallbacks for standalone
builds.

## Included components

Components used by HyperDX internally are marked with their config references.
Components marked "user configs" are included so users can reference them in
custom OTel configurations without rebuilding the collector.

### Receivers

| Component        | Module  | Used in                                           |
| ---------------- | ------- | ------------------------------------------------- |
| `nop`            | core    | OpAMP controller                                  |
| `otlp`           | core    | standalone configs, OpAMP controller, smoke tests |
| `dockerstats`    | contrib | user configs                                      |
| `filelog`        | contrib | user configs                                      |
| `fluentforward`  | contrib | standalone configs, OpAMP controller, smoke tests |
| `hostmetrics`    | contrib | custom.config.yaml                                |
| `k8scluster`     | contrib | user configs                                      |
| `kubeletstats`   | contrib | user configs                                      |
| `prometheus`     | contrib | OpAMP controller, smoke tests                     |

### Processors

| Component              | Module  | Used in                                           |
| ---------------------- | ------- | ------------------------------------------------- |
| `batch`                | core    | config.yaml, standalone configs, OpAMP controller |
| `memory_limiter`       | core    | config.yaml, standalone configs, OpAMP controller |
| `attributes`           | contrib | user configs                                      |
| `cumulativetodelta`    | contrib | user configs                                      |
| `filter`               | contrib | user configs                                      |
| `groupbyattrs`         | contrib | user configs                                      |
| `k8sattributes`        | contrib | user configs                                      |
| `logdedup`             | contrib | user configs                                      |
| `metricstransform`     | contrib | user configs                                      |
| `probabilisticsampler` | contrib | user configs                                      |
| `redaction`            | contrib | user configs                                      |
| `resourcedetection`    | contrib | config.yaml                                       |
| `resource`             | contrib | user configs                                      |
| `span`                 | contrib | user configs                                      |
| `tailsampling`         | contrib | user configs                                      |
| `transform`            | contrib | config.yaml, standalone configs, OpAMP controller |

### Exporters

| Component    | Module  | Used in                              |
| ------------ | ------- | ------------------------------------ |
| `clickhouse` | contrib | standalone configs, OpAMP controller |
| `debug`      | core    | OpAMP controller                     |
| `nop`        | core    | OpAMP controller                     |
| `otlp`       | core    | included for utility                 |
| `otlphttp`   | core    | custom.config.yaml                   |

### Connectors

| Component | Module  | Used in                              |
| --------- | ------- | ------------------------------------ |
| `forward` | core    | included for utility                 |
| `routing` | contrib | standalone configs, OpAMP controller |

### Extensions

| Component         | Module  | Used in                                  |
| ----------------- | ------- | ---------------------------------------- |
| `memorylimiter`   | core    | user configs                             |
| `zpages`          | core    | user configs                             |
| `bearertokenauth` | contrib | standalone-auth config, OpAMP controller |
| `file_storage`    | contrib | OpAMP controller (sending queue storage) |
| `health_check`    | contrib | config.yaml, standalone-auth config      |
| `opamp`           | contrib | used by OpAMP supervisor                 |
| `pprof`           | contrib | included for debugging/profiling         |

### Confmap Providers

| Provider | Module |
| -------- | ------ |
| `env`    | core   |
| `file`   | core   |
| `http`   | core   |
| `https`  | core   |
| `yaml`   | core   |

## Overriding base components via `CUSTOM_OTELCOL_CONFIG_FILE`

The collector ships with a default `memory_limiter` processor sized for a
small (~2 GiB) container. On larger pods you typically want to switch to
`limit_percentage`/`spike_limit_percentage` mode so the limit scales with
the pod's memory allocation.

The OTel `confmap` package merges YAML maps **leaf-by-leaf** rather than
replacing a block wholesale, and the `memorylimiterprocessor` silently
prefers `limit_mib` over `limit_percentage` when both are set. The
combination means you cannot switch the default `memory_limiter` to
percentage mode by leaf-merging into the existing block — your percentage
values land in `effective.yaml` but the inherited mib values still win at
runtime.

The supported pattern is to **define a new processor with a different
name** and swap the pipeline `processors:` lists in
`CUSTOM_OTELCOL_CONFIG_FILE` to reference it:

```yaml
# custom.config.yaml
processors:
  memory_limiter/custom:
    check_interval: 5s
    limit_percentage: 75
    spike_limit_percentage: 25

service:
  pipelines:
    traces:
      processors: [memory_limiter/custom, batch]
    metrics:
      processors: [memory_limiter/custom, batch]
    logs/out-default:
      processors: [memory_limiter/custom, transform, batch]
    logs/out-rrweb:
      processors: [memory_limiter/custom, batch]
```

After restart, the collector instantiates `memory_limiter/custom` (and not
the unused default `memory_limiter`). You can confirm by checking
`/etc/otel/supervisor-data/effective.yaml` and the `"Memory limiter
configured"` log line emitted at collector start.

The same pattern works for any other base processor (`batch`, `transform`,
…) — define a new component with a different name and re-declare the
pipelines that should use it.

> Pipeline `processors:` lists live in `docker/otel-collector/config.yaml`
> (for OpAMP supervisor mode) and `docker/otel-collector/config.standalone.yaml`
> (for standalone mode). The OpAMP remote config from
> `packages/api/src/opamp/controllers/opampController.ts` intentionally
> does **not** set `processors:` on pipelines, so your bootstrap+custom
> merge is not overwritten.

## Upgrading the OTel Collector version

### Step 1: Look up the core version

Check the upstream contrib manifest to find the core provider version that
corresponds to the new contrib version:

https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-contrib/manifest.yaml

Look at the `providers:` section — the core version follows a different scheme
(e.g. contrib `0.149.0` corresponds to core `1.55.0`).

### Step 2: Update these files

**`.env`** (root) — primary source of truth:

```
OTEL_COLLECTOR_VERSION=<new_version>
OTEL_COLLECTOR_CORE_VERSION=<new_core_version>
```

**`docker/otel-collector/Dockerfile`** — ARG defaults:

```dockerfile
ARG OTEL_COLLECTOR_VERSION=<new_version>
ARG OTEL_COLLECTOR_CORE_VERSION=<new_core_version>
```

**`docker/hyperdx/Dockerfile`** — ARG defaults:

```dockerfile
ARG OTEL_COLLECTOR_VERSION=<new_version>
ARG OTEL_COLLECTOR_CORE_VERSION=<new_core_version>
```

**`smoke-tests/otel-collector/docker-compose.yaml`** — fallback defaults:

```yaml
args:
  OTEL_COLLECTOR_VERSION: ${OTEL_COLLECTOR_VERSION:-<new_version>}
  OTEL_COLLECTOR_CORE_VERSION: ${OTEL_COLLECTOR_CORE_VERSION:-<new_core_version>}
```

### Files you do NOT need to change

- `packages/otel-collector/builder-config.yaml` — uses placeholders, substituted
  at build time
- `docker-compose.dev.yml` — reads from `.env` automatically
- `docker-compose.ci.yml` — reads from `.env` automatically

### Step 3: Verify

Build the image and check the version:

```bash
docker build -f docker/otel-collector/Dockerfile --target dev -t hdx-otel-test .
docker run --rm --entrypoint /otelcontribcol hdx-otel-test --version
docker rmi hdx-otel-test
```

## Adding a custom component

There are two approaches for including custom components, depending on whether
the component source lives in this monorepo or is published as a standalone Go
module.

### Approach A: Local source (monorepo development)

Best for active development — iterate on the component alongside the rest of the
codebase without needing to publish a Go module tag on every change.

1. Create the Go module under this package (e.g.
   `packages/otel-collector/receiver/myreceiver/`) with its own `go.mod`.

2. Add an entry to `builder-config.yaml` under the appropriate section with a
   `path:` directive pointing to the local module:

   ```yaml
   receivers:
     - gomod:
         github.com/hyperdxio/hyperdx/packages/otel-collector/receiver/myreceiver
         v0.0.0
       path: ./receiver/myreceiver
   ```

3. **Update the Dockerfiles** to copy the component source into the OCB build
   stage. Currently, only `builder-config.yaml` is copied. In both
   `docker/otel-collector/Dockerfile` and `docker/hyperdx/Dockerfile`, expand
   the `COPY` line in the `ocb-builder` stage:

   ```dockerfile
   # Before (only copies the manifest):
   COPY packages/otel-collector/builder-config.yaml .

   # After (also copies custom component source):
   COPY packages/otel-collector/builder-config.yaml .
   COPY packages/otel-collector/receiver/ ./receiver/
   ```

   Or, to copy everything at once (simpler, but any change to files in
   `packages/otel-collector/` will invalidate the Docker layer cache for the OCB
   build stage):

   ```dockerfile
   COPY packages/otel-collector/ .
   ```

4. Add the component to the relevant OTel config files and/or the OpAMP
   controller (`packages/api/src/opamp/controllers/opampController.ts`).

### Approach B: Published Go module (remote reference)

Best for stable, versioned components — especially useful for components shared
across repos or distributed to external users. No Dockerfile `COPY` changes
needed.

1. Publish the component as a Go module with a tagged version (e.g.
   `github.com/hyperdxio/my-otel-receiver v0.1.0`). For modules in a monorepo
   subdirectory, the Git tag must include the module path prefix (e.g.
   `packages/otel-collector/receiver/myreceiver/v0.1.0`).

2. Add an entry to `builder-config.yaml` **without** a `path:` directive — OCB
   will fetch it via the Go module proxy, just like contrib components:

   ```yaml
   receivers:
     - gomod: github.com/hyperdxio/my-otel-receiver v0.1.0
   ```

   No Dockerfile changes needed — OCB downloads it during `go mod download`.

3. Add the component to the relevant OTel config files and/or the OpAMP
   controller.

### Which approach to use?

|                             | Local (`path:`)      | Remote (`gomod:`)                 |
| --------------------------- | -------------------- | --------------------------------- |
| Dockerfile COPY needed      | Yes                  | No                                |
| Works with unpublished code | Yes                  | No — must be tagged and published |
| Dev iteration speed         | Fast — rebuild image | Must push, tag, wait for proxy    |
| Monorepo friendly           | Yes                  | Requires proper Go module tagging |
| Best for                    | Active development   | Stable/shared components          |

For most HyperDX development, **Approach A (local source)** is recommended. Use
Approach B when the component is mature and independently versioned.
