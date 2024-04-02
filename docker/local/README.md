# HyperDX Local

HyperDX Local is a single container local-optimized version of HyperDX that allows you to pipe OpenTelemetry telemetry (logs, metrics, traces) to a local instance of HyperDX running on your own machine. This makes it easily to debug complex applications locally using the same telemetry you have in prod or to test your instrumentation before pushing it into production.

HyperDX Local has a few additional benefits over the regular open source version:
- 📦 Packaged in a single container, to slot alongside your existing dev environment (ex. Docker Compose stack)
- 🔑 No need to auth to send and view telemetry
- 🐏 Optimized for lower memory footprint

And it has all the features you would expect from HyperDX:
- 🔭 Native OpenTelemetry logs, metrics, and traces support
- 🔍 Full text searching of logs and traces
- `{` Automatic JSON structured log parsing
- ⏱️ Application performance monitoring
- 📈 Charting logs, metrics and traces in a single UI

## Getting Started

To get started, simply run the Docker container with the appropriate ports forwarded:

```
docker run -p 8000:8000 -p 4318:4318 -p 4317:4317 -p 8080:8080 -p 8002:8002 ghcr.io/hyperdxio/hyperdx-local:1.7.0
```

Afterwards, you can visit `http://localhost:8080` and immediately jump into the HyperDX UI.

> We recommend having _at least_ 1GB of RAM and 1 CPU core available for the container.

## Configuring Instrumentation

Configuring instrumentation for HyperDX local is similar to configuring it for the regular open source version. You should point your OpenTelemetry instrumentation to the OpenTelemetry endpoints:

- `http://localhost:4318` for HTTP
- `localhost:4317` for gRPC

Most instrumentations can be configured using the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable. Ex: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

If you're using a HyperDX provided SDK, you may need to give a non-empty `HYPERDX_API_KEY` as well, API keys are not validated in HyperDX Local and therefore can be any non-empty value.

## Customizing Ports

If you need to customize the app (8080) or api (8000) ports that HyperDX Local runs on, you'll need to modify the `docker run` command to forward the appropriate ports and set a few environment variables.

Customizing the OpenTelemetry ports can simply be changed by modifying the port forwarding flags. Ex. Replacing `-p 4318:4318` with `-p 4999:4318` to change the OpenTelemetry HTTP port to 4999.

```bash
HYPERDX_APP_PORT=YOUR_CUSTOM_APP_PORT \
HYPERDX_API_PORT=YOUR_CUSTOM_API_PORT; \
docker run \
-e HYPERDX_APP_PORT=$HYPERDX_APP_PORT \
-e HYPERDX_API_PORT=$HYPERDX_API_PORT \
-p $HYPERDX_API_PORT:8000 \
-p 4318:4318 -p 4317:4317 \
-p $HYPERDX_APP_PORT:8080 \
-p 8002:8002 \
ghcr.io/hyperdxio/hyperdx-local:1.7.0
```

## Notes

### Limitations vs Regular Open Source Version

There are a few minor limitations compared to the regular open source version:
- Single user mode only (due to lack of auth requirement)
- No support for management APIs
- No alerting support (alerts will not fire)
- Log and DB query patterns will not be calculated
- No persistence of data if the container is torn down 

### Ports

- `4317` - OpenTelemetry gRPC endpoint
- `4318` - OpenTelemetry HTTP endpoint
- `8000` - Private HyperDX API for the UI
- `8002` - HyperDX HTTP Logging Endpoint
- `8080` - HyperDX UI (Next.js)

### Build Image (Only For Development)

To develop this image, you can build the image locally by running the build script from project root:

```
./docker/local/build.sh
```
