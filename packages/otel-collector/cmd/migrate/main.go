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
	"sort"
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
	case "tcp":
		protocol = "native"
		port = getOrDefault(u.Port(), "9000")
	case "http":
		protocol = "http"
		port = getOrDefault(u.Port(), "8123")
	case "https":
		protocol = "http"
		port = getOrDefault(u.Port(), "8443")
		secure = true
	default:
		return "", "", "", false, fmt.Errorf("unsupported protocol: %s", u.Scheme)
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

// processSchemaDir creates a temporary directory with SQL files that have
// the ${DATABASE} macro replaced with the actual database name
func processSchemaDir(schemaDir, database string) (string, error) {
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

		// Replace ${DATABASE} macro with actual database name
		processedContent := strings.ReplaceAll(string(content), "${DATABASE}", database)

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

	// Process schema directory (replace ${DATABASE} macro)
	log.Printf("Preparing SQL files with database: %s", cfg.Database)
	tempDir, err := processSchemaDir(cfg.SchemaDir, cfg.Database)
	if err != nil {
		log.Fatalf("Failed to process schema directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

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
