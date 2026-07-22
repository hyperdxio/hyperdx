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

	// TTL as a Go duration (e.g. "720h"); per-signal values fall back to TablesTTL.
	TablesTTL   string
	LogsTTL     string
	TracesTTL   string
	MetricsTTL  string
	SessionsTTL string

	// Reconcile TTL on already-existing tables, not just newly created ones.
	ReconcileTableTTL bool

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
	tablesTTL := getEnv("HYPERDX_OTEL_EXPORTER_TABLES_TTL", "720h")
	cfg := &Config{
		Endpoint:              getEnv("CLICKHOUSE_ENDPOINT", "tcp://localhost:9000"),
		User:                  getEnv("CLICKHOUSE_USER", "default"),
		Password:              getEnv("CLICKHOUSE_PASSWORD", ""),
		Database:              getEnv("HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE", "default"),
		TablesTTL:             tablesTTL,
		LogsTTL:               getEnv("HYPERDX_OTEL_EXPORTER_LOGS_TTL", tablesTTL),
		TracesTTL:             getEnv("HYPERDX_OTEL_EXPORTER_TRACES_TTL", tablesTTL),
		MetricsTTL:            getEnv("HYPERDX_OTEL_EXPORTER_METRICS_TTL", tablesTTL),
		SessionsTTL:           getEnv("HYPERDX_OTEL_EXPORTER_SESSIONS_TTL", tablesTTL),
		ReconcileTableTTL:     getEnv("HYPERDX_OTEL_EXPORTER_RECONCILE_TABLE_TTL", "false") == "true",
		TLSCAFile:             getEnv("CLICKHOUSE_TLS_CA_FILE", ""),
		TLSCertFile:           getEnv("CLICKHOUSE_TLS_CERT_FILE", ""),
		TLSKeyFile:            getEnv("CLICKHOUSE_TLS_KEY_FILE", ""),
		TLSServerNameOverride: getEnv("CLICKHOUSE_TLS_SERVER_NAME_OVERRIDE", ""),
		TLSInsecureSkipVerify: getEnv("CLICKHOUSE_TLS_INSECURE_SKIP_VERIFY", "") == "true",
		MaxRetries:            5,
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

func classifySignal(table string) (string, bool) {
	switch {
	case strings.HasPrefix(table, "otel_logs"):
		return "LOGS_TTL", true
	case strings.HasPrefix(table, "otel_traces"):
		return "TRACES_TTL", true
	case strings.HasPrefix(table, "otel_metrics"):
		return "METRICS_TTL", true
	case strings.HasPrefix(table, "hyperdx_sessions"):
		return "SESSIONS_TTL", true
	default:
		return "", false
	}
}

var (
	ttlKeywordRe = regexp.MustCompile(`(?i)\bTTL\b`)
	settingsRe   = regexp.MustCompile(`(?is)\s+SETTINGS\b`)
)

// extractTTLExpr returns the table-level TTL expression from a create_table_query.
// It anchors on the LAST TTL keyword: any column-level TTLs appear earlier (inside
// the column list), so the table-level clause is always last. SETTINGS names
// containing "ttl" (e.g. ttl_only_drop_parts) are not word-bounded matches.
func extractTTLExpr(createTableQuery string) (string, bool) {
	locs := ttlKeywordRe.FindAllStringIndex(createTableQuery, -1)
	if len(locs) == 0 {
		return "", false
	}
	tail := createTableQuery[locs[len(locs)-1][1]:]
	if idx := settingsRe.FindStringIndex(tail); idx != nil {
		tail = tail[:idx[0]]
	}
	return strings.TrimSpace(tail), true
}

// Matches a CH interval as toIntervalX(N) (what we emit) or INTERVAL N UNIT (what CH may echo back).
var intervalRe = regexp.MustCompile(`(?i)toInterval(Day|Hour|Minute|Second)\((\d+)\)|\bINTERVAL\s+(\d+)\s+(DAY|HOUR|MINUTE|SECOND)S?\b`)

var intervalUnitSeconds = map[string]int64{"DAY": 86400, "HOUR": 3600, "MINUTE": 60, "SECOND": 1}

// intervalSeconds converts a single interval term (toIntervalX(N) or INTERVAL N UNIT)
// to seconds, so the diff-guard can compare retention regardless of rendered syntax.
func intervalSeconds(term string) (int64, bool) {
	m := intervalRe.FindStringSubmatch(term)
	if m == nil {
		return 0, false
	}
	var unit, num string
	if m[1] != "" { // toIntervalX(N)
		unit, num = strings.ToUpper(m[1]), m[2]
	} else { // INTERVAL N UNIT
		unit, num = strings.ToUpper(m[4]), m[3]
	}
	n, err := strconv.ParseInt(num, 10, 64)
	if err != nil {
		return 0, false
	}
	return n * intervalUnitSeconds[unit], true
}

type ttlAction int

const (
	ttlSkip  ttlAction = iota // not managed, or already at the desired retention
	ttlAlter                  // retention differs; newTTL should be applied
	ttlWarn                   // managed but cannot be reconciled safely; needs an operator
)

type ttlPlan struct {
	action  ttlAction
	managed bool
	newTTL  string // set when action == ttlAlter
	extend  bool   // set when action == ttlAlter; true if the new retention is longer
	reason  string
}

// planTTLReconcile decides, for one table, what reconcile should do — pure so the
// decision (especially the cross-syntax diff-guard) is testable without a database.
func planTTLReconcile(table, createQuery string, ttlExprs map[string]string) ttlPlan {
	macro, ok := classifySignal(table)
	if !ok {
		return ttlPlan{action: ttlSkip, reason: "not a managed table"}
	}
	desired, ok := ttlExprs[macro]
	if !ok {
		return ttlPlan{action: ttlWarn, managed: true, reason: fmt.Sprintf("no configured TTL for signal %s", macro)}
	}
	live, ok := extractTTLExpr(createQuery)
	if !ok {
		return ttlPlan{action: ttlWarn, managed: true, reason: "managed table has no TTL clause"}
	}
	terms := intervalRe.FindAllStringIndex(live, -1)
	switch {
	case len(terms) == 0:
		return ttlPlan{action: ttlWarn, managed: true, reason: fmt.Sprintf("unrecognized TTL %q", live)}
	case len(terms) > 1:
		// A tiered TTL (e.g. TO VOLUME ..., ... DELETE) has several intervals;
		// blindly rewriting one would corrupt it, so refuse and let an operator decide.
		return ttlPlan{action: ttlWarn, managed: true, reason: fmt.Sprintf("multi-interval TTL %q; skipping to avoid corrupting it", live)}
	}
	liveSecs, ok := intervalSeconds(live[terms[0][0]:terms[0][1]])
	if !ok {
		return ttlPlan{action: ttlWarn, managed: true, reason: fmt.Sprintf("unparseable interval in TTL %q", live)}
	}
	desiredSecs, ok := intervalSeconds(desired)
	if !ok {
		return ttlPlan{action: ttlWarn, managed: true, reason: fmt.Sprintf("unparseable desired interval %q", desired)}
	}
	if liveSecs == desiredSecs {
		return ttlPlan{action: ttlSkip, managed: true, reason: "already at desired retention"}
	}
	newTTL := live[:terms[0][0]] + desired + live[terms[0][1]:]
	return ttlPlan{action: ttlAlter, managed: true, newTTL: newTTL, extend: desiredSecs > liveSecs}
}

// reconcileTableTTLs brings the TTL of existing managed tables in line with config.
// It only alters tables whose retention differs, preserves each table's timestamp
// anchor, and reports a summary. Extending uses materialize_ttl_after_modify=1 so
// the new (longer) retention actually applies to data already on disk without
// deleting anything; shrinking uses =0 so a startup reconcile never triggers a bulk
// delete (existing parts age out under their old TTL; run MATERIALIZE TTL to reclaim now).
func reconcileTableTTLs(ctx context.Context, db *sql.DB, database string, ttlExprs map[string]string) error {
	rows, err := db.QueryContext(ctx,
		"SELECT name, create_table_query FROM system.tables WHERE database = ? AND engine LIKE '%MergeTree%'",
		database)
	if err != nil {
		return fmt.Errorf("could not list tables; no tables reconciled: %w", err)
	}
	defer rows.Close()

	// Collect first, then ALTER: avoid writing while the result cursor is open.
	type pending struct {
		table, newTTL string
		extend        bool
	}
	var todo []pending
	var examined, matched, skipped, warned int
	for rows.Next() {
		var name, createQuery string
		if err := rows.Scan(&name, &createQuery); err != nil {
			return fmt.Errorf("could not read table list; no tables reconciled: %w", err)
		}
		examined++
		plan := planTTLReconcile(name, createQuery, ttlExprs)
		if plan.managed {
			matched++
		}
		switch plan.action {
		case ttlSkip:
			if plan.managed {
				skipped++
			}
		case ttlWarn:
			warned++
			log.Printf("WARNING: reconcile: %s: %s", name, plan.reason)
		case ttlAlter:
			log.Printf("reconcile: %s -> TTL %s", name, plan.newTTL)
			todo = append(todo, pending{name, plan.newTTL, plan.extend})
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error reading table list: %w", err)
	}

	var altered, failed int
	var firstErr error
	for _, p := range todo {
		materialize := 0
		if p.extend {
			materialize = 1
		}
		stmt := fmt.Sprintf(
			"ALTER TABLE `%s`.`%s` MODIFY TTL %s SETTINGS materialize_ttl_after_modify = %d",
			database, p.table, p.newTTL, materialize)
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			failed++
			log.Printf("WARNING: reconcile: ALTER failed for %s: %v", p.table, err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		altered++
	}
	if altered > 0 || warned > 0 || failed > 0 {
		log.Printf("reconcile: examined=%d matched=%d altered=%d skipped=%d warned=%d failed=%d",
			examined, matched, altered, skipped, warned, failed)
	}
	if firstErr != nil {
		return fmt.Errorf("%d of %d table(s) failed to reconcile (first error: %w)", failed, len(todo), firstErr)
	}
	return nil
}

// processSchemaDir creates a temporary directory with SQL files that have the
// ${DATABASE} and per-signal ${*_TTL} macros replaced with actual values.
// ttlExprs maps a macro name (e.g. "LOGS_TTL") to its ClickHouse interval expr.
func processSchemaDir(schemaDir, database string, ttlExprs map[string]string) (string, error) {
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
		for macro, expr := range ttlExprs {
			processedContent = strings.ReplaceAll(processedContent, "${"+macro+"}", expr)
		}

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

	ttlExprs := make(map[string]string)
	for _, s := range []struct{ macro, env, value string }{
		{"TABLES_TTL", "HYPERDX_OTEL_EXPORTER_TABLES_TTL", cfg.TablesTTL},
		{"LOGS_TTL", "HYPERDX_OTEL_EXPORTER_LOGS_TTL", cfg.LogsTTL},
		{"TRACES_TTL", "HYPERDX_OTEL_EXPORTER_TRACES_TTL", cfg.TracesTTL},
		{"METRICS_TTL", "HYPERDX_OTEL_EXPORTER_METRICS_TTL", cfg.MetricsTTL},
		{"SESSIONS_TTL", "HYPERDX_OTEL_EXPORTER_SESSIONS_TTL", cfg.SessionsTTL},
	} {
		expr, err := ttlToClickHouseInterval(s.value)
		if err != nil {
			log.Fatalf("Invalid %s: %v", s.env, err)
		}
		ttlExprs[s.macro] = expr
	}
	log.Printf("Table TTLs: logs=%s traces=%s metrics=%s sessions=%s (default %s)",
		cfg.LogsTTL, cfg.TracesTTL, cfg.MetricsTTL, cfg.SessionsTTL, cfg.TablesTTL)

	// Process schema directory (replace ${DATABASE} and ${*_TTL} macros)
	log.Printf("Preparing SQL files with database: %s", cfg.Database)
	tempDir, err := processSchemaDir(cfg.SchemaDir, cfg.Database, ttlExprs)
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

	// CREATE TABLE IF NOT EXISTS won't update TTL on existing tables; reconcile
	// (opt-in) applies it to them too. Non-fatal so it can't block startup.
	if cfg.ReconcileTableTTL {
		if err := reconcileTableTTLs(ctx, db, cfg.Database, ttlExprs); err != nil {
			log.Printf("WARNING: reconcile: %v", err)
		}
	}

	log.Println("========================================")
	log.Println("Schema seed completed successfully")
	log.Println("========================================")
}
