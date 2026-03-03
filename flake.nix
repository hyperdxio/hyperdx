{
  description = "HyperDX development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true; # MongoDB has SSPL license
        };

        # Port configuration
        ports = import ./nix/ports.nix;

        # Container images for CI
        containers = pkgs.callPackage ./nix/containers.nix { };

        # Helper to create integration test app derivations
        mkIntTestApp = { name, composeFile, testCommand, passArgs ? false }:
          let
            script = pkgs.writeShellApplication {
              inherit name;
              runtimeInputs = with pkgs; [
                docker
                docker-compose
                nodejs_22
                yarn-berry
                git
                mongosh
              ];
              text = ''
                REPO_ROOT="$(git rev-parse --show-toplevel)"
                cd "$REPO_ROOT"

                cleanup() {
                  echo "Tearing down containers..."
                  docker compose -p int -f "./${composeFile}" down || true
                }
                trap cleanup EXIT

                # Load Nix-built container images
                echo "Loading Nix-built container images..."
                "${containers.loadScript}"

                # Start containers
                echo "Starting containers from ${composeFile}..."
                docker compose -p int -f "./${composeFile}" up -d

                # Wait for MongoDB/FerretDB to be ready
                echo "Waiting for database to be ready on port ${toString ports.services.mongodb}..."
                for i in $(seq 1 30); do
                  if mongosh --port ${toString ports.services.mongodb} --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
                    echo "Database is ready."
                    break
                  fi
                  if [ "$i" -eq 30 ]; then
                    echo "ERROR: Database did not become ready in time."
                    exit 1
                  fi
                  sleep 1
                done

                # Run tests
                echo "Running integration tests..."
                ${testCommand}
              '';
            };
          in
          {
            type = "app";
            program = "${script}/bin/${name}";
          };
      in
      {
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            nodejs_22
            yarn-berry
            docker
            docker-compose
            jq
            curl
            mongosh
            clickhouse
            nil
            nixpkgs-fmt
          ];

          shellHook = ''
            echo "HyperDX Dev Environment"
            echo "Node: $(node --version)"
            echo "Yarn: $(yarn --version)"
            echo ""
            echo "Commands:"
            echo "  yarn setup          - Install deps"
            echo "  yarn lint           - Lint all packages"
            echo "  make ci-unit        - Unit tests"
            echo "  make ci-int         - Integration tests (needs Docker)"
            echo "  make nix-ci-int     - Integration tests (Nix images + MongoDB 7)"
            echo "  make nix-ci-int-ferretdb - Integration tests (Nix images + FerretDB)"
            echo ""
            echo "Quick test (host networking, no compose):"
            echo "  nix run .#test-services-up          - Start MongoDB + ClickHouse"
            echo "  nix run .#test-services-up-ferretdb - Start FerretDB + ClickHouse"
            echo "  cd packages/api && yarn ci:int      - Run integration tests"
            echo "  nix run .#test-services-down        - Stop services"
          '';
        };

        packages = {
          mongodb-image = containers.mongodbImage;
          ferretdb-image = containers.ferretdbImage;
          clickhouse-image = containers.clickhouseImage;
          otel-collector-image = containers.otelCollectorImage;
          all-test-images = containers.allImages;
        };

        # Convenience scripts for starting/stopping test services with host networking
        apps.test-services-up = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "test-services-up";
            runtimeInputs = with pkgs; [ docker mongosh curl ];
            text = ''
              echo "Starting test services with host networking..."

              # MongoDB
              if docker ps --format '{{.Names}}' | grep -q '^hyperdx-test-mongo$'; then
                echo "MongoDB already running."
              else
                docker rm -f hyperdx-test-mongo 2>/dev/null || true
                echo "Starting MongoDB on port ${toString ports.services.mongodb}..."
                docker run -d --name hyperdx-test-mongo --network host \
                  mongo:5.0.32-focal --port ${toString ports.services.mongodb}
              fi

              # ClickHouse
              if docker ps --format '{{.Names}}' | grep -q '^hyperdx-test-ch$'; then
                echo "ClickHouse already running."
              else
                REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
                docker rm -f hyperdx-test-ch 2>/dev/null || true
                echo "Starting ClickHouse on port ${toString ports.services.clickhouseHttp}..."
                docker run -d --name hyperdx-test-ch --network host \
                  -v "$REPO_ROOT/docker/clickhouse/local/config.xml:/etc/clickhouse-server/config.xml" \
                  -v "$REPO_ROOT/docker/clickhouse/local/users.xml:/etc/clickhouse-server/users.xml" \
                  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
                  clickhouse/clickhouse-server:25.6-alpine
              fi

              # Wait for services
              echo "Waiting for MongoDB..."
              for i in $(seq 1 30); do
                if mongosh --port ${toString ports.services.mongodb} --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
                  echo "MongoDB ready."
                  break
                fi
                if [ "$i" -eq 30 ]; then echo "ERROR: MongoDB not ready."; exit 1; fi
                sleep 1
              done

              echo "Waiting for ClickHouse..."
              for i in $(seq 1 15); do
                if curl -sf http://localhost:${toString ports.services.clickhouseHttp}/ping > /dev/null 2>&1; then
                  echo "ClickHouse ready."
                  break
                fi
                if [ "$i" -eq 15 ]; then echo "ERROR: ClickHouse not ready."; exit 1; fi
                sleep 1
              done

              echo ""
              echo "Test services running:"
              echo "  MongoDB:    localhost:${toString ports.services.mongodb}"
              echo "  ClickHouse: localhost:${toString ports.services.clickhouseHttp}"
              echo ""
              echo "Run tests with: cd packages/api && yarn ci:int"
              echo "Stop with:      nix run .#test-services-down"
            '';
          }}/bin/test-services-up";
        };

        apps.test-services-down = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "test-services-down";
            runtimeInputs = with pkgs; [ docker ];
            text = ''
              echo "Stopping test services..."
              docker rm -f hyperdx-test-mongo 2>/dev/null && echo "MongoDB stopped." || echo "MongoDB not running."
              docker rm -f hyperdx-test-ferretdb 2>/dev/null && echo "FerretDB stopped." || echo "FerretDB not running."
              docker rm -f hyperdx-test-postgres 2>/dev/null && echo "PostgreSQL stopped." || echo "PostgreSQL not running."
              docker rm -f hyperdx-test-ch 2>/dev/null && echo "ClickHouse stopped." || echo "ClickHouse not running."
              echo "Done."
            '';
          }}/bin/test-services-down";
        };

        apps.test-services-up-ferretdb = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "test-services-up-ferretdb";
            runtimeInputs = with pkgs; [ docker mongosh curl ];
            text = ''
              echo "Starting FerretDB v2 test services with host networking..."

              # PostgreSQL with DocumentDB extension (FerretDB v2.x backend)
              if docker ps --format '{{.Names}}' | grep -q '^hyperdx-test-postgres$'; then
                echo "PostgreSQL already running."
              else
                docker rm -f hyperdx-test-postgres 2>/dev/null || true
                echo "Starting PostgreSQL+DocumentDB on port ${toString ports.services.postgres}..."
                docker run -d --name hyperdx-test-postgres --network host \
                  -e POSTGRES_USER=ferretdb -e POSTGRES_PASSWORD=ferretdb -e POSTGRES_DB=postgres \
                  ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0 \
                  -p ${toString ports.services.postgres}
              fi

              # FerretDB v2.x
              if docker ps --format '{{.Names}}' | grep -q '^hyperdx-test-ferretdb$'; then
                echo "FerretDB already running."
              else
                docker rm -f hyperdx-test-ferretdb 2>/dev/null || true
                echo "Starting FerretDB on port ${toString ports.services.mongodb}..."
                docker run -d --name hyperdx-test-ferretdb --network host \
                  -e FERRETDB_POSTGRESQL_URL=postgres://ferretdb:ferretdb@127.0.0.1:${toString ports.services.postgres}/postgres \
                  ghcr.io/ferretdb/ferretdb:2.7.0 \
                  --listen-addr=:${toString ports.services.mongodb} --no-auth
              fi

              # ClickHouse
              if docker ps --format '{{.Names}}' | grep -q '^hyperdx-test-ch$'; then
                echo "ClickHouse already running."
              else
                REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
                docker rm -f hyperdx-test-ch 2>/dev/null || true
                echo "Starting ClickHouse on port ${toString ports.services.clickhouseHttp}..."
                docker run -d --name hyperdx-test-ch --network host \
                  -v "$REPO_ROOT/docker/clickhouse/local/config.xml:/etc/clickhouse-server/config.xml" \
                  -v "$REPO_ROOT/docker/clickhouse/local/users.xml:/etc/clickhouse-server/users.xml" \
                  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
                  clickhouse/clickhouse-server:25.6-alpine
              fi

              # Wait for PostgreSQL
              echo "Waiting for PostgreSQL..."
              for i in $(seq 1 30); do
                if docker exec hyperdx-test-postgres pg_isready -U ferretdb -p ${toString ports.services.postgres} > /dev/null 2>&1; then
                  echo "PostgreSQL ready."
                  break
                fi
                if [ "$i" -eq 30 ]; then echo "ERROR: PostgreSQL not ready."; exit 1; fi
                sleep 1
              done

              # Wait for FerretDB
              echo "Waiting for FerretDB..."
              for i in $(seq 1 30); do
                if mongosh --port ${toString ports.services.mongodb} --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
                  echo "FerretDB ready."
                  break
                fi
                if [ "$i" -eq 30 ]; then echo "ERROR: FerretDB not ready."; exit 1; fi
                sleep 1
              done

              echo "Waiting for ClickHouse..."
              for i in $(seq 1 15); do
                if curl -sf http://localhost:${toString ports.services.clickhouseHttp}/ping > /dev/null 2>&1; then
                  echo "ClickHouse ready."
                  break
                fi
                if [ "$i" -eq 15 ]; then echo "ERROR: ClickHouse not ready."; exit 1; fi
                sleep 1
              done

              echo ""
              echo "Test services running:"
              echo "  PostgreSQL: localhost:${toString ports.services.postgres}"
              echo "  FerretDB:   localhost:${toString ports.services.mongodb}"
              echo "  ClickHouse: localhost:${toString ports.services.clickhouseHttp}"
              echo ""
              echo "Run tests with: cd packages/api && yarn ci:int"
              echo "Stop with:      nix run .#test-services-down"
            '';
          }}/bin/test-services-up-ferretdb";
        };

        apps.load-test-images = {
          type = "app";
          program = "${containers.loadScript}";
        };

        apps.ci-int = mkIntTestApp {
          name = "ci-int";
          composeFile = "docker-compose.ci.nix.yml";
          testCommand = "npx nx run-many -t ci:int --parallel=false";
        };

        apps.ci-int-ferretdb = mkIntTestApp {
          name = "ci-int-ferretdb";
          composeFile = "docker-compose.ci.ferretdb.yml";
          testCommand = "npx nx run-many -t ci:int --parallel=false";
        };

        apps.dev-int = mkIntTestApp {
          name = "dev-int";
          composeFile = "docker-compose.ci.nix.yml";
          testCommand = ''npx nx run @hyperdx/api:dev:int "$@"'';
          passArgs = true;
        };

        apps.dev-int-ferretdb = mkIntTestApp {
          name = "dev-int-ferretdb";
          composeFile = "docker-compose.ci.ferretdb.yml";
          testCommand = ''npx nx run @hyperdx/api:dev:int "$@"'';
          passArgs = true;
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
