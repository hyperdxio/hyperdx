{ lib
, pkgs
, dockerTools
, buildEnv
, writeShellScript
, runCommand
}:

let
  # Import port configuration
  ports = import ./ports.nix;

  # Import container factory
  containerLib = import ./lib/containers.nix { inherit lib pkgs; };

  # Build custom packages
  otelMigrate = pkgs.callPackage ./otel-migrate.nix { };
  opampsupervisor = pkgs.callPackage ./opampsupervisor.nix { };

  # ============================================
  # Standard Image Configurations
  # ============================================
  imageConfigs = {
    mongodb = {
      packages = [ pkgs.mongodb pkgs.mongosh ];
      pathsToLink = [ "/bin" "/etc" "/share" ];
      extraDirs = [ "data/db" "var/log/mongodb" "tmp" ];
      entrypoint = [ "/bin/mongod" ];
      cmd = [ "--bind_ip_all" "--port" "${toString ports.services.mongodb}" ];
      env = [ ];
      exposedPorts = [ ports.services.mongodb ];
      volumes = [ "/data/db" ];
      description = "MongoDB for HyperDX CI tests";
      includeTls = false;
    };

    ferretdb = {
      packages = [ pkgs.ferretdb ];
      pathsToLink = [ "/bin" "/etc" "/share" ];
      extraDirs = [ "data" ];
      entrypoint = [ "/bin/ferretdb" ];
      cmd = [ "--listen-addr=:${toString ports.services.mongodb}" "--no-auth" ];
      env = [ "FERRETDB_POSTGRESQL_URL=postgres://ferretdb:ferretdb@postgres:5432/postgres" ];
      exposedPorts = [ ports.services.mongodb ];
      volumes = [ "/data" ];
      description = "FerretDB v2 (MongoDB-compatible) with PostgreSQL+DocumentDB backend";
      includeTls = false;
    };
  };

  # Generate standard images using the factory
  standardImages = lib.mapAttrs
    (name: cfg:
      containerLib.mkImage (cfg // { inherit name; })
    )
    imageConfigs;

  # ============================================
  # ClickHouse (Special Case - Baked-in Config)
  # ============================================
  clickhouseConfigDir = runCommand "clickhouse-config" { } ''
    mkdir -p $out/opt/clickhouse-config

    # Server configuration (matches docker/clickhouse/local/config.xml)
    cat > $out/opt/clickhouse-config/config.xml << 'XMLEOF'
<?xml version="1.0"?>
<clickhouse>
    <logger>
        <level>debug</level>
        <console>true</console>
        <log remove="remove" />
        <errorlog remove="remove" />
    </logger>

    <listen_host>0.0.0.0</listen_host>
    <http_port>8123</http_port>
    <tcp_port>9000</tcp_port>
    <interserver_http_host>ch-server</interserver_http_host>
    <interserver_http_port>9009</interserver_http_port>

    <max_connections>4096</max_connections>
    <keep_alive_timeout>64</keep_alive_timeout>
    <max_concurrent_queries>100</max_concurrent_queries>
    <uncompressed_cache_size>8589934592</uncompressed_cache_size>
    <mark_cache_size>5368709120</mark_cache_size>

    <path>/var/lib/clickhouse/</path>
    <tmp_path>/var/lib/clickhouse/tmp/</tmp_path>
    <user_files_path>/var/lib/clickhouse/user_files/</user_files_path>

    <user_directories>
        <users_xml>
            <path>users.xml</path>
        </users_xml>
    </user_directories>
    <default_profile>default</default_profile>
    <default_database>default</default_database>
    <timezone>UTC</timezone>
    <mlock_executable>false</mlock_executable>

    <prometheus>
        <endpoint>/metrics</endpoint>
        <port>9363</port>
        <metrics>true</metrics>
        <events>true</events>
        <asynchronous_metrics>true</asynchronous_metrics>
        <errors>true</errors>
    </prometheus>

    <query_log>
        <database>system</database>
        <table>query_log</table>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </query_log>

    <metric_log>
        <database>system</database>
        <table>metric_log</table>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
        <collect_interval_milliseconds>1000</collect_interval_milliseconds>
    </metric_log>

    <asynchronous_metric_log>
        <database>system</database>
        <table>asynchronous_metric_log</table>
        <flush_interval_milliseconds>7000</flush_interval_milliseconds>
    </asynchronous_metric_log>

    <opentelemetry_span_log>
        <engine>
            engine MergeTree
            partition by toYYYYMM(finish_date)
            order by (finish_date, finish_time_us, trace_id)
        </engine>
        <database>system</database>
        <table>opentelemetry_span_log</table>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </opentelemetry_span_log>

    <crash_log>
        <database>system</database>
        <table>crash_log</table>
        <partition_by />
        <flush_interval_milliseconds>1000</flush_interval_milliseconds>
    </crash_log>

    <processors_profile_log>
        <database>system</database>
        <table>processors_profile_log</table>
        <partition_by>toYYYYMM(event_date)</partition_by>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </processors_profile_log>

    <part_log>
        <database>system</database>
        <table>part_log</table>
        <partition_by>toYYYYMM(event_date)</partition_by>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </part_log>

    <trace_log>
        <database>system</database>
        <table>trace_log</table>
        <partition_by>toYYYYMM(event_date)</partition_by>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </trace_log>

    <query_thread_log>
        <database>system</database>
        <table>query_thread_log</table>
        <partition_by>toYYYYMM(event_date)</partition_by>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </query_thread_log>

    <query_views_log>
        <database>system</database>
        <table>query_views_log</table>
        <partition_by>toYYYYMM(event_date)</partition_by>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </query_views_log>

    <remote_servers>
        <hdx_cluster>
            <shard>
                <replica>
                    <host>ch-server</host>
                    <port>9000</port>
                </replica>
            </shard>
        </hdx_cluster>
    </remote_servers>

    <distributed_ddl>
        <path>/clickhouse/task_queue/ddl</path>
    </distributed_ddl>

    <format_schema_path>/var/lib/clickhouse/format_schemas/</format_schema_path>

    <custom_settings_prefixes>hyperdx</custom_settings_prefixes>
</clickhouse>
XMLEOF

    # Users configuration (matches docker/clickhouse/local/users.xml)
    cat > $out/opt/clickhouse-config/users.xml << 'XMLEOF'
<?xml version="1.0"?>
<clickhouse>
    <profiles>
        <default>
            <max_memory_usage>10000000000</max_memory_usage>
            <use_uncompressed_cache>0</use_uncompressed_cache>
            <load_balancing>in_order</load_balancing>
            <log_queries>1</log_queries>
        </default>
    </profiles>

    <users>
        <default>
            <password></password>
            <profile>default</profile>
            <networks>
                <ip>::/0</ip>
            </networks>
            <quota>default</quota>
        </default>
        <api>
            <password>api</password>
            <profile>default</profile>
            <networks>
                <ip>::/0</ip>
            </networks>
            <quota>default</quota>
        </api>
        <worker>
            <password>worker</password>
            <profile>default</profile>
            <networks>
                <ip>::/0</ip>
            </networks>
            <quota>default</quota>
        </worker>
    </users>

    <quotas>
        <default>
            <interval>
                <duration>3600</duration>
                <queries>0</queries>
                <errors>0</errors>
                <result_rows>0</result_rows>
                <read_rows>0</read_rows>
                <execution_time>0</execution_time>
            </interval>
        </default>
    </quotas>
</clickhouse>
XMLEOF
  '';

  clickhouseImage = dockerTools.buildImage {
    name = "clickhouse";
    tag = "latest";

    copyToRoot = buildEnv {
      name = "clickhouse-root";
      paths = [
        pkgs.clickhouse
        clickhouseConfigDir
        pkgs.cacert
        pkgs.tzdata
      ];
      pathsToLink = [ "/bin" "/etc" "/share" "/opt" ];
    };

    extraCommands = ''
      mkdir -p var/lib/clickhouse/tmp
      mkdir -p var/lib/clickhouse/user_files
      mkdir -p var/lib/clickhouse/format_schemas
      mkdir -p var/log/clickhouse-server
    '';

    config = {
      Entrypoint = [ "/bin/clickhouse-server" ];
      Cmd = [ "--config-file=/opt/clickhouse-config/config.xml" ];

      Env = [
        "CLICKHOUSE_DB=default"
        "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
        "TZDIR=/share/zoneinfo"
      ];

      ExposedPorts = {
        "${toString ports.services.clickhouseHttp}/tcp" = { };
        "${toString ports.services.clickhouseNative}/tcp" = { };
        "${toString ports.services.clickhouseInterserver}/tcp" = { };
      };

      Volumes = {
        "/var/lib/clickhouse" = { };
      };

      Labels = containerLib.commonLabels // {
        "org.opencontainers.image.title" = "clickhouse";
        "org.opencontainers.image.description" = "ClickHouse for HyperDX CI tests";
      };
    };
  };

  # ============================================
  # OTel Collector (Special Case - Multiple Binaries + Config)
  # ============================================

  # Assemble all OTel Collector config files into a single derivation
  otelConfigDir = runCommand "otel-config" { } ''
    mkdir -p $out/etc/otelcol-contrib
    mkdir -p $out/etc/otel/schema/seed
    mkdir -p $out/etc/otel/supervisor-data

    # Copy config files
    cp ${../docker/otel-collector/config.yaml} $out/etc/otelcol-contrib/config.yaml
    cp ${../docker/otel-collector/config.standalone.yaml} $out/etc/otelcol-contrib/standalone-config.yaml
    cp ${../docker/otel-collector/config.standalone.auth.yaml} $out/etc/otelcol-contrib/standalone-auth-config.yaml
    cp ${../docker/otel-collector/supervisor_docker.yaml.tmpl} $out/etc/otel/supervisor.yaml.tmpl

    # Copy schema files
    for f in ${../docker/otel-collector/schema/seed}/*.sql; do
      cp "$f" $out/etc/otel/schema/seed/
    done

    # Copy entrypoint and log-tailer scripts
    cp ${../docker/otel-collector/entrypoint.sh} $out/etc/otel/entrypoint.sh
    chmod 755 $out/etc/otel/entrypoint.sh
    cp ${../docker/otel-collector/log-tailer.sh} $out/etc/otel/log-tailer.sh
    chmod 755 $out/etc/otel/log-tailer.sh

    # Make supervisor-data world-writable (matches Dockerfile behavior)
    chmod 777 $out/etc/otel/supervisor-data
  '';

  otelCollectorImage = dockerTools.buildImage {
    name = "otel-collector";
    tag = "latest";

    copyToRoot = buildEnv {
      name = "otel-collector-root";
      paths = [
        pkgs.opentelemetry-collector-contrib # /bin/otelcol-contrib
        opampsupervisor # /bin/opampsupervisor
        pkgs.gomplate # /bin/gomplate
        pkgs.goose # /bin/goose
        otelMigrate # /bin/migrate
        otelConfigDir # /etc/otelcol-contrib/ + /etc/otel/
        pkgs.cacert
        pkgs.tzdata
        pkgs.busybox # sh, tail, mkfifo, wget (for entrypoint + healthcheck)
      ];
      pathsToLink = [ "/bin" "/etc" "/share" ];
    };

    extraCommands = ''
      mkdir -p tmp
      chmod 1777 tmp
      mkdir -p etc/otel/supervisor-data
      chmod 777 etc/otel/supervisor-data
      # Compatibility symlinks: Dockerfile paths -> Nix paths
      ln -s /bin/otelcol-contrib otelcontribcol
      ln -s /bin/opampsupervisor opampsupervisor
      ln -s /etc/otel/entrypoint.sh entrypoint.sh
      ln -s /etc/otel/log-tailer.sh log-tailer.sh
    '';

    config = {
      Entrypoint = [ "/etc/otel/entrypoint.sh" ];
      Cmd = [ "/bin/opampsupervisor" ];

      Env = [
        "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
        "TZDIR=/share/zoneinfo"
      ];

      ExposedPorts = {
        "4317/tcp" = { };
        "4318/tcp" = { };
        "${toString ports.services.otelCollectorHealth}/tcp" = { };
      };

      Labels = containerLib.commonLabels // {
        "org.opencontainers.image.title" = "otel-collector";
        "org.opencontainers.image.description" = "OpenTelemetry Collector for HyperDX CI tests";
      };
    };
  };

  # ============================================
  # All Images Combined
  # ============================================
  allImagesList = [
    { name = "mongodb"; image = standardImages.mongodb; }
    { name = "ferretdb"; image = standardImages.ferretdb; }
    { name = "clickhouse"; image = clickhouseImage; }
    { name = "otel-collector"; image = otelCollectorImage; }
  ];

  # ============================================
  # Helper Scripts
  # ============================================
  loadScript = writeShellScript "load-images" ''
    set -e
    echo "Loading container images into Docker..."
    ${lib.concatMapStringsSep "\n" (img: ''
      echo "Loading ${img.name}..."
      ${pkgs.docker}/bin/docker load < ${img.image}
    '') allImagesList}
    echo ""
    echo "Images loaded successfully:"
    ${pkgs.docker}/bin/docker images | grep -E "(mongodb|ferretdb|clickhouse|otel-collector)" || true
  '';

  # Bundle all images
  allImages = runCommand "all-images" { } ''
    mkdir -p $out
    ${lib.concatMapStringsSep "\n" (img: ''
      cp ${img.image} $out/${img.name}.tar.gz
    '') allImagesList}
  '';

in
{
  mongodbImage = standardImages.mongodb;
  ferretdbImage = standardImages.ferretdb;
  clickhouseImage = clickhouseImage;
  otelCollectorImage = otelCollectorImage;
  inherit loadScript allImages;
}
