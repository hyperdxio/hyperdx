# DocumentDB (MIT): Postgres extensions plus a Mongo wire-protocol gateway, used
# in place of MongoDB (SSPL). Built from source because upstream ships glibc
# packages only; Alpine 3.24 matches the all-in-one base and its PostGIS targets PG18.
ARG DOCUMENTDB_VERSION=v1.0-RC2
# Tags can move; the build fails unless the tag still resolves to this commit.
ARG DOCUMENTDB_COMMIT=b0cb0dae85e8746f4e0b79c847894179b2f80d64

FROM alpine:3.24 AS builder
ARG DOCUMENTDB_VERSION
ARG DOCUMENTDB_COMMIT
RUN apk add --no-cache build-base cmake git curl bash tar pkgconf perl linux-headers python3 \
      icu-dev krb5-dev openssl-dev rust cargo \
      postgresql18 postgresql18-dev postgresql18-contrib postgresql-pg_cron postgresql-pgvector postgis
ENV PG_CONFIG=/usr/libexec/postgresql18/pg_config INSTALL_DEPENDENCIES_ROOT=/deps
RUN git clone --depth 1 --branch ${DOCUMENTDB_VERSION} https://github.com/documentdb/documentdb.git /src \
 && test "$(git -C /src rev-parse HEAD)" = "${DOCUMENTDB_COMMIT}" \
 && mkdir -p /deps
# musl exports _init/_fini from every .so, which the duplicate-export check counts.
RUN sed -i "s#grep -vxE '_PG_init|Pg_magic_func'#grep -vxE '_PG_init|Pg_magic_func|_init|_fini'#g" \
      /src/pg_documentdb_extended_rum/validate_rum_core_exports.sh
RUN cd /src/scripts && MAKE_PROGRAM=cmake bash install_setup_libbson.sh \
 && bash install_setup_pcre2.sh && bash install_setup_intel_decimal_math_lib.sh
# Serial make: with -j the RUM export check can run before the library is linked.
RUN cd /src && make install-documentdb with_llvm=no PG_CONFIG=$PG_CONFIG
RUN cd /src/pg_documentdb_gw && cargo build --release -p documentdb_gateway \
 && install -s target/release/documentdb_gateway /usr/bin/documentdb-gateway
# Keep only what Postgres and DocumentDB link against: no GDAL, JIT or PostGIS raster/topology.
RUN set -e; PG=/usr/libexec/postgresql18; LIB=/usr/lib/postgresql18; SH=/usr/share/postgresql18; \
  rm -f $LIB/llvmjit*.so $LIB/postgis_raster-3.so $LIB/postgis_sfcgal-3.so $LIB/postgis_topology-3.so $LIB/address_standardizer*.so; rm -rf $LIB/bitcode; \
  rm -f $SH/extension/postgis_raster* $SH/extension/postgis_sfcgal* $SH/extension/postgis_topology* $SH/extension/postgis_tiger* $SH/extension/address_standardizer*; rm -rf $SH/contrib/postgis*; \
  for f in $PG/postgres $PG/pg_ctl $PG/initdb $PG/psql /usr/bin/documentdb-gateway $LIB/*.so; do echo $f; ldd $f 2>/dev/null | awk '/=> \//{print $3}'; done | sort -u > /tmp/files; \
  mkdir /out; tar -ch -T /tmp/files -f - | tar -x -C /out; \
  tar -ch $PG/postgres $PG/pg_ctl $PG/initdb $PG/psql $LIB $SH /usr/share/proj /usr/share/icu -f - | tar -x -C /out; \
  install -D -m 644 /src/pg_documentdb_gw/SetupConfiguration.json /out/etc/documentdb/gateway/SetupConfiguration.json

FROM alpine:3.24 AS runtime
RUN apk add --no-cache bash openssl su-exec \
 && addgroup -S postgres && adduser -S -G postgres -h /var/lib/postgresql postgres \
 && install -d -o postgres -g postgres /data/docdb
COPY --from=builder /out/ /
COPY --chmod=755 entrypoint.sh /usr/local/bin/documentdb-entrypoint.sh
ENV PATH=/usr/libexec/postgresql18:$PATH PGDATA=/data/docdb/pgdata
EXPOSE 10260
# The gateway only listens once Postgres is initialised and the user exists; the
# psql probe catches Postgres dying under a gateway that keeps its port open.
HEALTHCHECK --interval=2s --timeout=3s --start-period=60s --retries=30 \
  CMD nc -z 127.0.0.1 10260 && psql -h /tmp -U postgres -d postgres -qtAX -c 'SELECT 1' >/dev/null
ENTRYPOINT ["bash", "/usr/local/bin/documentdb-entrypoint.sh"]
