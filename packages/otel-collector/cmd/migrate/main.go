// Package main provides a CLI tool for running ClickHouse schema seed using
// goose without version tracking (WithNoVersioning). Seed SQL files are
// re-applied on every run, so they MUST be idempotent (e.g. CREATE TABLE IF
// NOT EXISTS). See docker/otel-collector/schema/seed/ for the SQL files.
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/pressly/goose/v3"
)

// Config holds all configuration for the migration tool
type Config struct {
	// ClickHouse connection settings
	Endpoint string
	User     string
	Password string
	Database string

	// DatabaseEngine selects the engine used when creating the target
	// database. Empty (default) keeps the current behavior where the seed SQL
	// creates the database with the server default (Atomic). "Replicated"
	// makes the seed ensure the database uses the Replicated
	// (DatabaseReplicated) engine, matching clickhouse-operator's
	// enableDatabaseSync behavior.
	DatabaseEngine string

	// Table TTL (Go duration string, e.g. "720h")
	TablesTTL string

	// TLS settings
	TLSCAFile             string
	TLSCertFile           string
	TLSKeyFile            string
	TLSServerNameOverride string
	TLSInsecureSkipVerify bool

	// Migration settings
	SchemaDir  string
	MaxRetries int
}

// loadConfig reads configuration from environment variables and CLI arguments
func loadConfig() (*Config, error) {
	cfg := &Config{
		Endpoint:              getEnv("CLICKHOUSE_ENDPOINT", "tcp://localhost:9000"),
		User:                  getEnv("CLICKHOUSE_USER", "default"),
		Password:              getEnv("CLICKHOUSE_PASSWORD", ""),
		Database:              getEnv("HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE", "default"),
		DatabaseEngine:        getEnv("HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE_ENGINE", ""),
		TablesTTL:             getEnv("HYPERDX_OTEL_EXPORTER_TABLES_TTL", "720h"),
		TLSCAFile:             getEnv("CLICKHOUSE_TLS_CA_FILE", ""),
		TLSCertFile:           getEnv("CLICKHOUSE_TLS_CERT_FILE", ""),
		TLSKeyFile:            getEnv("CLICKHOUSE_TLS_KEY_FILE", ""),
		TLSServerNameOverride: getEnv("CLICKHOUSE_TLS_SERVER_NAME_OVERRIDE", ""),
		TLSInsecureSkipVerify: getEnv("CLICKHOUSE_TLS_INSECURE_SKIP_VERIFY", "") == "true",
		MaxRetries:            5,
	}

	// Validate the database engine. Only the default (Atomic) and Replicated
	// engines are supported; anything else is a deterministic
	// misconfiguration.
	if !isDefaultEngine(cfg.DatabaseEngine) && !isReplicatedEngine(cfg.DatabaseEngine) {
		return nil, fmt.Errorf(
			"invalid HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE_ENGINE %q (supported: %q, %q)",
			cfg.DatabaseEngine, "Atomic", "Replicated")
	}

	// Get schema directory from CLI argument
	if len(os.Args) < 2 {
		return nil, fmt.Errorf("usage: %s <schema-directory>", os.Args[0])
	}
	cfg.SchemaDir = os.Args[1]

	// Validate schema directory exists
	if _, err := os.Stat(cfg.SchemaDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("schema directory does not exist: %s", cfg.SchemaDir)
	}

	return cfg, nil
}

// getEnv returns environment variable value or default if not set
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// parseTLSConfig creates a TLS configuration from the provided settings
func parseTLSConfig(cfg *Config) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.TLSInsecureSkipVerify,
	}

	// Set server name override if provided
	if cfg.TLSServerNameOverride != "" {
		tlsConfig.ServerName = cfg.TLSServerNameOverride
	}

	// Load CA certificate if provided
	if cfg.TLSCAFile != "" {
		caCert, err := os.ReadFile(cfg.TLSCAFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA certificate file: %w", err)
		}
		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("failed to parse CA certificate")
		}
		tlsConfig.RootCAs = caCertPool
	}

	// Load client certificate and key if both are provided
	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load client certificate: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}

// parseEndpoint parses the CLICKHOUSE_ENDPOINT and returns connection options
func parseEndpoint(endpoint string) (protocol string, host string, port string, secure bool, err error) {
	// Default values
	protocol = "native"
	port = "9000"
	secure = false

	// Parse the URL
	if !strings.Contains(endpoint, "://") {
		endpoint = "tcp://" + endpoint
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return "", "", "", false, fmt.Errorf("failed to parse endpoint: %w", err)
	}

	host = u.Hostname()
	if u.Port() != "" {
		port = u.Port()
	}

	switch u.Scheme {
	case "tcp", "clickhouse":
		protocol = "native"
		port = getOrDefault(u.Port(), "9000")
	case "tcps", "tls":
		protocol = "native"
		port = getOrDefault(u.Port(), "9440")
		secure = true
	case "http":
		protocol = "http"
		port = getOrDefault(u.Port(), "8123")
	case "https":
		protocol = "http"
		port = getOrDefault(u.Port(), "8443")
		secure = true
	default:
		return "", "", "", false, fmt.Errorf("unsupported protocol scheme: %s (supported: tcp, clickhouse, tcps, tls, http, https)", u.Scheme)
	}

	// Allow ?secure=true query parameter to override TLS setting
	if strings.EqualFold(u.Query().Get("secure"), "true") {
		secure = true
	}

	return protocol, host, port, secure, nil
}

func getOrDefault(value, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

// createClickHouseDB creates a database connection to ClickHouse
func createClickHouseDB(cfg *Config) (*sql.DB, error) {
	protocol, host, port, secure, err := parseEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}

	// Build connection options
	// Note: Connection pool settings (MaxOpenConns, MaxIdleConns, ConnMaxLifetime)
	// must be set on the *sql.DB object, not in clickhouse.Options when using OpenDB()
	opts := &clickhouse.Options{
		Addr: []string{fmt.Sprintf("%s:%s", host, port)},
		Auth: clickhouse.Auth{
			Username: cfg.User,
			Password: cfg.Password,
		},
		Protocol: clickhouse.Native,
		Settings: clickhouse.Settings{
			"max_execution_time": 60,
		},
		Compression: &clickhouse.Compression{
			Method: clickhouse.CompressionLZ4,
		},
		DialTimeout:      30 * time.Second,
		ConnOpenStrategy: clickhouse.ConnOpenInOrder,
	}

	// Set protocol
	if protocol == "http" {
		opts.Protocol = clickhouse.HTTP
	}

	// Configure TLS if needed
	if secure || cfg.TLSCAFile != "" || cfg.TLSCertFile != "" {
		tlsConfig, err := parseTLSConfig(cfg)
		if err != nil {
			return nil, fmt.Errorf("failed to create TLS config: %w", err)
		}
		opts.TLS = tlsConfig
	}

	// Open connection using database/sql interface (required for goose)
	db := clickhouse.OpenDB(opts)

	// Set connection pool settings on the *sql.DB object
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(10 * time.Minute)

	return db, nil
}

// parseTTLDuration parses a duration string that supports days ("30d") in
// addition to the standard Go duration format ("720h", "90m", "3600s").
func parseTTLDuration(s string) (time.Duration, error) {
	// Handle "d" suffix (days) which Go's time.ParseDuration doesn't support
	if strings.HasSuffix(s, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(s, "d"))
		if err != nil {
			return 0, fmt.Errorf("invalid duration %q: %w", s, err)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	return time.ParseDuration(s)
}

// ttlToClickHouseInterval converts a duration string (e.g. "30d", "720h",
// "90m") to a ClickHouse interval expression, following the same approach as
// the upstream otel-collector-contrib ClickHouse exporter's GenerateTTLExpr.
func ttlToClickHouseInterval(ttl string) (string, error) {
	d, err := parseTTLDuration(ttl)
	if err != nil {
		return "", fmt.Errorf("invalid TTL duration %q: %w", ttl, err)
	}
	if d <= 0 {
		return "", fmt.Errorf("TTL must be positive, got %q", ttl)
	}
	switch {
	case d%(24*time.Hour) == 0:
		return fmt.Sprintf("toIntervalDay(%d)", d/(24*time.Hour)), nil
	case d%time.Hour == 0:
		return fmt.Sprintf("toIntervalHour(%d)", d/time.Hour), nil
	case d%time.Minute == 0:
		return fmt.Sprintf("toIntervalMinute(%d)", d/time.Minute), nil
	default:
		return fmt.Sprintf("toIntervalSecond(%d)", d/time.Second), nil
	}
}

// processSchemaDir creates a temporary directory with SQL files that have
// the ${DATABASE} and ${TABLES_TTL} macros replaced with actual values
func processSchemaDir(schemaDir, database, tablesTTLExpr string) (string, error) {
	tempDir, err := os.MkdirTemp("", "schema-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	// Walk through the schema directory and process SQL files
	err = filepath.Walk(schemaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Get relative path from schema directory
		relPath, err := filepath.Rel(schemaDir, path)
		if err != nil {
			return err
		}

		destPath := filepath.Join(tempDir, relPath)

		if info.IsDir() {
			return os.MkdirAll(destPath, 0755)
		}

		// Read the file
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		// Replace macros with actual values
		processedContent := strings.ReplaceAll(string(content), "${DATABASE}", database)
		processedContent = strings.ReplaceAll(processedContent, "${TABLES_TTL}", tablesTTLExpr)

		// Write processed content to temp directory
		if err := os.WriteFile(destPath, []byte(processedContent), 0644); err != nil {
			return fmt.Errorf("failed to write file %s: %w", destPath, err)
		}

		return nil
	})

	if err != nil {
		os.RemoveAll(tempDir)
		return "", fmt.Errorf("failed to process schema directory: %w", err)
	}

	return tempDir, nil
}

// runMigrationWithRetry runs goose seed with exponential backoff retry
func runMigrationWithRetry(ctx context.Context, db *sql.DB, migrationsDir string, maxRetries int) error {
	var lastErr error
	retryDelay := time.Second

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Set dialect to clickhouse
		if err := goose.SetDialect("clickhouse"); err != nil {
			return fmt.Errorf("failed to set goose dialect: %w", err)
		}

		// Run the migrations with no versioning to avoid ClickHouse transaction
		// issues with goose's version table. All migration SQL files must be
		// idempotent (e.g. CREATE TABLE IF NOT EXISTS).
		if err := goose.UpContext(ctx, db, migrationsDir, goose.WithNoVersioning()); err != nil {
			lastErr = err
			if attempt < maxRetries {
				log.Printf("RETRY: Seed failed, retrying in %v... (attempt %d/%d): %v",
					retryDelay, attempt, maxRetries, err)
				time.Sleep(retryDelay)
				retryDelay *= 2 // Exponential backoff
				continue
			}
		} else {
			return nil // Success
		}
	}

	return fmt.Errorf("seed failed after %d attempts: %w", maxRetries, lastErr)
}

// getClickHouseVersion queries the ClickHouse server version and returns the
// major and minor version numbers (e.g. 26, 2 for version "26.2.1.0").
func getClickHouseVersion(ctx context.Context, db *sql.DB) (major, minor int, err error) {
	var version string
	if err := db.QueryRowContext(ctx, "SELECT version()").Scan(&version); err != nil {
		return 0, 0, fmt.Errorf("failed to query ClickHouse version: %w", err)
	}

	parts := strings.SplitN(version, ".", 3)
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("unexpected version format: %s", version)
	}

	major, err = strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("failed to parse major version %q: %w", parts[0], err)
	}
	minor, err = strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("failed to parse minor version %q: %w", parts[1], err)
	}

	return major, minor, nil
}

// supportsFullTextSearch returns true if the ClickHouse version supports
// full text search indexes (TYPE text). This requires ClickHouse >= 26.2.
func supportsFullTextSearch(major, minor int) bool {
	return major > 26 || (major == 26 && minor >= 2)
}

// replicatedEngineName is the engine name reported by system.databases for
// databases using the Replicated (DatabaseReplicated) engine.
const replicatedEngineName = "Replicated"

// isDefaultEngine returns true when the configured database engine keeps the
// default behavior (the seed SQL creates the database with the server default,
// Atomic).
func isDefaultEngine(engine string) bool {
	return engine == "" || strings.EqualFold(engine, "atomic")
}

// isReplicatedEngine returns true when the configured database engine requests
// the Replicated (DatabaseReplicated) engine.
func isReplicatedEngine(engine string) bool {
	return strings.EqualFold(engine, replicatedEngineName)
}

// databaseAction describes what ensureReplicatedDatabase should do with the
// target database.
type databaseAction int

const (
	// dbActionCreate: the database does not exist; create it as Replicated.
	dbActionCreate databaseAction = iota
	// dbActionNone: the database already uses the Replicated engine.
	dbActionNone
	// dbActionConvert: the database exists with a non-Replicated engine and is
	// empty; drop it and recreate it as Replicated. This mirrors
	// clickhouse-operator's enableDatabaseSync conversion so the collector and
	// operator agree on the engine no matter which side runs first.
	dbActionConvert
	// dbActionKeep: the database exists with a non-Replicated engine and
	// already has tables. Never drop it (that would lose data); keep it as-is.
	dbActionKeep
)

// decideDatabaseAction is the pure decision function behind
// ensureReplicatedDatabase, factored out for testability.
func decideDatabaseAction(exists bool, engine string, tableCount uint64) databaseAction {
	if !exists {
		return dbActionCreate
	}
	if engine == replicatedEngineName {
		return dbActionNone
	}
	if tableCount == 0 {
		return dbActionConvert
	}
	return dbActionKeep
}

// replicatedDatabaseDDL returns the DDL for creating the target database with
// the Replicated engine. The Keeper path follows clickhouse-operator's
// convention (/clickhouse/databases/<name>) and the shard/replica names come
// from the server-side {shard}/{replica} macros.
func replicatedDatabaseDDL(database string) string {
	return fmt.Sprintf(
		"CREATE DATABASE IF NOT EXISTS `%s` ENGINE = Replicated('/clickhouse/databases/%s', '{shard}', '{replica}')",
		database, database)
}

// getDatabaseEngine queries system.databases for the target database's engine.
// exists is false when the database does not exist.
func getDatabaseEngine(ctx context.Context, db *sql.DB, database string) (engine string, exists bool, err error) {
	err = db.QueryRowContext(ctx,
		"SELECT engine FROM system.databases WHERE name = ?", database).Scan(&engine)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("failed to query engine of database %q: %w", database, err)
	}
	return engine, true, nil
}

// countDatabaseTables returns the number of tables in the target database.
func countDatabaseTables(ctx context.Context, db *sql.DB, database string) (uint64, error) {
	var count uint64
	err := db.QueryRowContext(ctx,
		"SELECT count() FROM system.tables WHERE database = ?", database).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count tables in database %q: %w", database, err)
	}
	return count, nil
}

// ensureReplicatedDatabase makes sure the target database uses the Replicated
// engine before the schema seed runs:
//   - missing            -> create it as Replicated
//   - already Replicated -> nothing to do
//   - other engine, empty -> drop + recreate as Replicated (mirrors
//     clickhouse-operator's enableDatabaseSync conversion; resolves the
//     startup race between the collector seed and the operator)
//   - other engine, has tables -> keep as-is and warn; dropping it would lose
//     data
func ensureReplicatedDatabase(ctx context.Context, db *sql.DB, database string) error {
	engine, exists, err := getDatabaseEngine(ctx, db, database)
	if err != nil {
		return err
	}

	var tableCount uint64
	if exists {
		tableCount, err = countDatabaseTables(ctx, db, database)
		if err != nil {
			return err
		}
	}

	switch decideDatabaseAction(exists, engine, tableCount) {
	case dbActionNone:
		log.Printf("Database %q already uses the Replicated engine", database)
		return nil
	case dbActionKeep:
		log.Printf("WARNING: Database %q uses the %s engine and already has %d table(s); refusing to drop it to avoid data loss. It will NOT be converted to the Replicated engine.",
			database, engine, tableCount)
		return nil
	case dbActionConvert:
		log.Printf("Database %q uses the %s engine and is empty; dropping and recreating it with the Replicated engine", database, engine)
		if _, err := db.ExecContext(ctx, fmt.Sprintf("DROP DATABASE `%s` SYNC", database)); err != nil {
			return fmt.Errorf("failed to drop database %q: %w", database, err)
		}
	case dbActionCreate:
		log.Printf("Database %q does not exist; creating it with the Replicated engine", database)
	}

	if _, err := db.ExecContext(ctx, replicatedDatabaseDDL(database)); err != nil {
		return fmt.Errorf("failed to create Replicated database %q: %w", database, err)
	}
	return nil
}

// mergeTreeEngineRe matches the plain (Summing)MergeTree engine lines emitted
// by the seed schema files. It is anchored to whole lines so other engines
// (e.g. the experimental TimeSeries engine) are never touched.
var mergeTreeEngineRe = regexp.MustCompile(`(?m)^ENGINE = (MergeTree|SummingMergeTree)\b`)

// rewriteEnginesForReplicated rewrites the table engines in the processed
// schema directory to their Replicated variants (MergeTree ->
// ReplicatedMergeTree, SummingMergeTree -> ReplicatedSummingMergeTree). In a
// Replicated database, plain MergeTree tables would have replicated metadata
// but local (non-replicated) data, so replicated table engines are required
// for correctness on multi-replica clusters.
func rewriteEnginesForReplicated(tempDir string) error {
	return filepath.Walk(tempDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".sql") {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read schema file %s: %w", path, err)
		}

		rewritten := mergeTreeEngineRe.ReplaceAll(content, []byte("ENGINE = Replicated$1"))
		if string(rewritten) == string(content) {
			return nil
		}

		if err := os.WriteFile(path, rewritten, 0644); err != nil {
			return fmt.Errorf("failed to write schema file %s: %w", path, err)
		}
		return nil
	})
}

// swapLogsSchemaForCompat replaces the full-text-search logs schema with the
// compatibility variant (bloom_filter indexes) in the processed temp directory.
// It removes 00002_otel_logs.sql and renames 00002_otel_logs_compat.sql to
// take its place, so goose runs the compat schema instead.
func swapLogsSchemaForCompat(tempDir string) error {
	fullTextPath := filepath.Join(tempDir, "00002_otel_logs.sql")
	compatPath := filepath.Join(tempDir, "00002_otel_logs_compat.sql")

	// Remove the full-text-search schema
	if err := os.Remove(fullTextPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove full text logs schema: %w", err)
	}

	// Rename compat schema to the original name so goose picks it up in order
	if err := os.Rename(compatPath, fullTextPath); err != nil {
		return fmt.Errorf("failed to rename compat logs schema: %w", err)
	}

	return nil
}

// removeCompatLogsSchema removes the compat schema file from the temp directory
// when full text search is supported, so goose doesn't run both schemas.
func removeCompatLogsSchema(tempDir string) error {
	compatPath := filepath.Join(tempDir, "00002_otel_logs_compat.sql")
	if err := os.Remove(compatPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove compat logs schema: %w", err)
	}
	return nil
}

// removePromqlSchema removes the experimental TimeSeries-engine schema from
// the temp directory so it is only created when PromQL support is opted into
// via ENABLE_PROMQL=true. Keeps the experimental engine and metrics_ts
// table out of deployments that have not enabled the feature.
func removePromqlSchema(tempDir string) error {
	promqlPath := filepath.Join(tempDir, "00008_otel_metrics_timeseries.sql")
	if err := os.Remove(promqlPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove promql schema: %w", err)
	}
	return nil
}

// swapTracesSchemaForCompat replaces the full-text-search traces schema with
// the compatibility variant (bloom_filter indexes, no items columns) in the
// processed temp directory. It removes 00005_otel_traces.sql and renames
// 00005_otel_traces_compat.sql to take its place, so goose runs the compat
// schema instead.
func swapTracesSchemaForCompat(tempDir string) error {
	fullTextPath := filepath.Join(tempDir, "00005_otel_traces.sql")
	compatPath := filepath.Join(tempDir, "00005_otel_traces_compat.sql")

	if err := os.Remove(fullTextPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove full text traces schema: %w", err)
	}

	if err := os.Rename(compatPath, fullTextPath); err != nil {
		return fmt.Errorf("failed to rename compat traces schema: %w", err)
	}

	return nil
}

// removeCompatTracesSchema removes the compat traces schema file from the temp
// directory when full text search is supported, so goose doesn't run both
// schemas.
func removeCompatTracesSchema(tempDir string) error {
	compatPath := filepath.Join(tempDir, "00005_otel_traces_compat.sql")
	if err := os.Remove(compatPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove compat traces schema: %w", err)
	}
	return nil
}

// listSQLFiles lists all SQL files in a directory for logging purposes
func listSQLFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	return files, nil
}

func main() {
	log.SetFlags(log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[seed] ")

	// Load configuration
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	log.Println("========================================")
	log.Println("Running ClickHouse schema seed...")
	log.Println("========================================")
	log.Printf("Target database: %s", cfg.Database)
	log.Printf("Schema directory: %s", cfg.SchemaDir)

	// Create database connection
	db, err := createClickHouseDB(cfg)
	if err != nil {
		log.Fatalf("Failed to create database connection: %v", err)
	}
	defer db.Close()

	// Test connection
	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("Failed to connect to ClickHouse: %v", err)
	}
	log.Println("Successfully connected to ClickHouse")

	// Check ClickHouse version for feature support
	chMajor, chMinor, err := getClickHouseVersion(ctx, db)
	if err != nil {
		log.Fatalf("Failed to determine ClickHouse version: %v", err)
	}

	// When the Replicated database engine is requested, make sure the target
	// database uses it before seeding tables.
	if isReplicatedEngine(cfg.DatabaseEngine) {
		log.Printf("Requested database engine: %s", replicatedEngineName)
		if err := ensureReplicatedDatabase(ctx, db, cfg.Database); err != nil {
			log.Fatalf("Failed to ensure Replicated database %q: %v", cfg.Database, err)
		}
	}

	// Detect the actual engine of the target database. If it uses the
	// Replicated engine — whether created above or e.g. by
	// clickhouse-operator's enableDatabaseSync — the table engines in the
	// schema are rewritten to their Replicated variants below.
	dbEngine, dbExists, err := getDatabaseEngine(ctx, db, cfg.Database)
	if err != nil {
		log.Fatalf("Failed to determine engine of database %q: %v", cfg.Database, err)
	}
	targetIsReplicated := dbExists && dbEngine == replicatedEngineName

	// Parse tables TTL
	tablesTTLExpr, err := ttlToClickHouseInterval(cfg.TablesTTL)
	if err != nil {
		log.Fatalf("Invalid HYPERDX_OTEL_EXPORTER_TABLES_TTL: %v", err)
	}
	log.Printf("Tables TTL: %s (%s)", cfg.TablesTTL, tablesTTLExpr)

	// Process schema directory (replace ${DATABASE} and ${TABLES_TTL} macros)
	log.Printf("Preparing SQL files with database: %s", cfg.Database)
	tempDir, err := processSchemaDir(cfg.SchemaDir, cfg.Database, tablesTTLExpr)
	if err != nil {
		log.Fatalf("Failed to process schema directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Select the appropriate logs and traces schemas based on ClickHouse version
	if supportsFullTextSearch(chMajor, chMinor) {
		if err := removeCompatLogsSchema(tempDir); err != nil {
			log.Fatalf("Failed to remove compat logs schema: %v", err)
		}
		if err := removeCompatTracesSchema(tempDir); err != nil {
			log.Fatalf("Failed to remove compat traces schema: %v", err)
		}
	} else {
		log.Printf("ClickHouse %d.%d < 26.2, falling back to compatibility logs and traces schemas", chMajor, chMinor)
		if err := swapLogsSchemaForCompat(tempDir); err != nil {
			log.Fatalf("Failed to swap logs schema: %v", err)
		}
		if err := swapTracesSchemaForCompat(tempDir); err != nil {
			log.Fatalf("Failed to swap traces schema: %v", err)
		}
	}

	if os.Getenv("ENABLE_PROMQL") != "true" {
		log.Printf("ENABLE_PROMQL not set, skipping PromQL TimeSeries schema")
		if err := removePromqlSchema(tempDir); err != nil {
			log.Fatalf("Failed to remove promql schema: %v", err)
		}
	}

	// Rewrite table engines to their Replicated variants when the target
	// database uses the Replicated engine, so table data is replicated across
	// replicas (plain MergeTree tables in a Replicated database only replicate
	// metadata).
	if targetIsReplicated {
		log.Printf("Database %q uses the Replicated engine; rewriting table engines to Replicated variants", cfg.Database)
		if err := rewriteEnginesForReplicated(tempDir); err != nil {
			log.Fatalf("Failed to rewrite table engines for Replicated database: %v", err)
		}
	}

	// List SQL files
	sqlFiles, err := listSQLFiles(tempDir)
	if err != nil {
		log.Printf("WARNING: Failed to list SQL files: %v", err)
	} else {
		for _, f := range sqlFiles {
			log.Printf("  - %s", f)
		}
	}

	// Run seed with retry
	if err := runMigrationWithRetry(ctx, db, tempDir, cfg.MaxRetries); err != nil {
		log.Printf("ERROR: Schema seed failed after %d attempts: %v", cfg.MaxRetries, err)
		log.Println("========================================")
		os.Exit(1)
	}

	log.Println("========================================")
	log.Println("Schema seed completed successfully")
	log.Println("========================================")
}
