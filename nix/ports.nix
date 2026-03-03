# Port configuration for HyperDX CI services
# All ports are defined here to ensure consistency across containers and compose files
{
  services = {
    # MongoDB / FerretDB (matches docker-compose.ci.yml)
    mongodb = 29999;

    # PostgreSQL (used as FerretDB v2.x backend)
    postgres = 25432;

    # ClickHouse
    clickhouseHttp = 8123;
    clickhouseNative = 9000;
    clickhouseInterserver = 9009;

    # OTel Collector
    otelCollectorHealth = 13133;

    # API test server (must not conflict with ClickHouse native port 9000)
    apiTestServer = 19123;
    apiTestOpamp = 14320;
  };
}
