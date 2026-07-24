package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// getEnv / getOrDefault
// ---------------------------------------------------------------------------

func TestGetEnv(t *testing.T) {
	const key = "TEST_GETENV_KEY_MIGRATE"

	// Returns default when env var is unset
	got := getEnv(key, "fallback")
	if got != "fallback" {
		t.Errorf("getEnv unset: got %q, want %q", got, "fallback")
	}

	// Returns value when env var is set
	t.Setenv(key, "custom")
	got = getEnv(key, "fallback")
	if got != "custom" {
		t.Errorf("getEnv set: got %q, want %q", got, "custom")
	}

	// Treats empty string the same as unset (returns default)
	t.Setenv(key, "")
	got = getEnv(key, "fallback")
	if got != "fallback" {
		t.Errorf("getEnv empty: got %q, want %q", got, "fallback")
	}
}

func TestGetOrDefault(t *testing.T) {
	if got := getOrDefault("", "def"); got != "def" {
		t.Errorf("getOrDefault empty: got %q, want %q", got, "def")
	}
	if got := getOrDefault("val", "def"); got != "val" {
		t.Errorf("getOrDefault non-empty: got %q, want %q", got, "val")
	}
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

func TestLoadConfig(t *testing.T) {
	// Save and restore os.Args
	origArgs := os.Args
	t.Cleanup(func() { os.Args = origArgs })

	t.Run("missing schema dir arg", func(t *testing.T) {
		os.Args = []string{"migrate"}
		_, err := loadConfig()
		if err == nil {
			t.Fatal("expected error when no schema dir argument")
		}
		if !strings.Contains(err.Error(), "usage:") {
			t.Errorf("expected usage message, got: %v", err)
		}
	})

	t.Run("nonexistent schema dir", func(t *testing.T) {
		os.Args = []string{"migrate", "/nonexistent/path/schema"}
		_, err := loadConfig()
		if err == nil {
			t.Fatal("expected error for nonexistent schema dir")
		}
		if !strings.Contains(err.Error(), "does not exist") {
			t.Errorf("expected 'does not exist' error, got: %v", err)
		}
	})

	t.Run("valid config with defaults", func(t *testing.T) {
		dir := t.TempDir()
		os.Args = []string{"migrate", dir}

		cfg, err := loadConfig()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cfg.Endpoint != "tcp://localhost:9000" {
			t.Errorf("Endpoint: got %q, want default", cfg.Endpoint)
		}
		if cfg.User != "default" {
			t.Errorf("User: got %q, want %q", cfg.User, "default")
		}
		if cfg.Database != "default" {
			t.Errorf("Database: got %q, want %q", cfg.Database, "default")
		}
		if cfg.TablesTTL != "720h" {
			t.Errorf("TablesTTL: got %q, want %q", cfg.TablesTTL, "720h")
		}
		for name, got := range map[string]string{"LogsTTL": cfg.LogsTTL, "TracesTTL": cfg.TracesTTL, "MetricsTTL": cfg.MetricsTTL, "SessionsTTL": cfg.SessionsTTL} {
			if got != "720h" {
				t.Errorf("%s should default to 720h, got %q", name, got)
			}
		}
		if cfg.ReconcileTableTTL {
			t.Error("ReconcileTableTTL should default to false")
		}
		if cfg.SchemaDir != dir {
			t.Errorf("SchemaDir: got %q, want %q", cfg.SchemaDir, dir)
		}
		if cfg.TLSInsecureSkipVerify {
			t.Error("TLSInsecureSkipVerify should default to false")
		}
	})

	t.Run("env var overrides", func(t *testing.T) {
		dir := t.TempDir()
		os.Args = []string{"migrate", dir}
		t.Setenv("CLICKHOUSE_ENDPOINT", "https://ch.example.com:8443")
		t.Setenv("CLICKHOUSE_USER", "admin")
		t.Setenv("CLICKHOUSE_PASSWORD", "secret")
		t.Setenv("HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE", "mydb")
		t.Setenv("HYPERDX_OTEL_EXPORTER_TABLES_TTL", "7d")
		t.Setenv("CLICKHOUSE_TLS_INSECURE_SKIP_VERIFY", "true")

		cfg, err := loadConfig()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cfg.Endpoint != "https://ch.example.com:8443" {
			t.Errorf("Endpoint: got %q", cfg.Endpoint)
		}
		if cfg.User != "admin" {
			t.Errorf("User: got %q", cfg.User)
		}
		if cfg.Password != "secret" {
			t.Errorf("Password: got %q", cfg.Password)
		}
		if cfg.Database != "mydb" {
			t.Errorf("Database: got %q", cfg.Database)
		}
		if cfg.TablesTTL != "7d" {
			t.Errorf("TablesTTL: got %q", cfg.TablesTTL)
		}
		if !cfg.TLSInsecureSkipVerify {
			t.Error("TLSInsecureSkipVerify should be true")
		}
	})
}

// ---------------------------------------------------------------------------
// parseEndpoint
// ---------------------------------------------------------------------------

func TestParseEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		protocol string
		host     string
		port     string
		secure   bool
		wantErr  bool
	}{
		{
			name:     "tcp with port",
			input:    "tcp://localhost:9000",
			protocol: "native", host: "localhost", port: "9000", secure: false,
		},
		{
			name:     "tcp default port",
			input:    "tcp://clickhouse",
			protocol: "native", host: "clickhouse", port: "9000", secure: false,
		},
		{
			name:     "http with port",
			input:    "http://clickhouse:8123",
			protocol: "http", host: "clickhouse", port: "8123", secure: false,
		},
		{
			name:     "http default port",
			input:    "http://clickhouse",
			protocol: "http", host: "clickhouse", port: "8123", secure: false,
		},
		{
			name:     "https with port",
			input:    "https://clickhouse:9443",
			protocol: "http", host: "clickhouse", port: "9443", secure: true,
		},
		{
			name:     "https default port",
			input:    "https://clickhouse.example.com",
			protocol: "http", host: "clickhouse.example.com", port: "8443", secure: true,
		},
		{
			name:     "clickhouse scheme with port",
			input:    "clickhouse://ch.example.com:9000",
			protocol: "native", host: "ch.example.com", port: "9000", secure: false,
		},
		{
			name:     "clickhouse scheme default port",
			input:    "clickhouse://ch.example.com",
			protocol: "native", host: "ch.example.com", port: "9000", secure: false,
		},
		{
			name:     "tcps scheme with port",
			input:    "tcps://ch.example.com:9440",
			protocol: "native", host: "ch.example.com", port: "9440", secure: true,
		},
		{
			name:     "tcps scheme default port",
			input:    "tcps://ch.example.com",
			protocol: "native", host: "ch.example.com", port: "9440", secure: true,
		},
		{
			name:     "tcps scheme custom port",
			input:    "tcps://ch.example.com:19440",
			protocol: "native", host: "ch.example.com", port: "19440", secure: true,
		},
		{
			name:     "tls scheme with port",
			input:    "tls://ch.example.com:9440",
			protocol: "native", host: "ch.example.com", port: "9440", secure: true,
		},
		{
			name:     "tls scheme default port",
			input:    "tls://ch.example.com",
			protocol: "native", host: "ch.example.com", port: "9440", secure: true,
		},
		{
			name:     "tcp with secure query param",
			input:    "tcp://hostname:9440?secure=true",
			protocol: "native", host: "hostname", port: "9440", secure: true,
		},
		{
			name:     "http with secure query param",
			input:    "http://hostname:8443?secure=true",
			protocol: "http", host: "hostname", port: "8443", secure: true,
		},
		{
			name:     "secure query param false is no-op",
			input:    "tcp://hostname:9000?secure=false",
			protocol: "native", host: "hostname", port: "9000", secure: false,
		},
		{
			name:     "no scheme defaults to tcp",
			input:    "clickhouse:9000",
			protocol: "native", host: "clickhouse", port: "9000", secure: false,
		},
		{
			name:    "unsupported scheme",
			input:   "ftp://clickhouse:21",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proto, host, port, secure, err := parseEndpoint(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("parseEndpoint(%q) expected error", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseEndpoint(%q) unexpected error: %v", tt.input, err)
			}
			if proto != tt.protocol {
				t.Errorf("protocol: got %q, want %q", proto, tt.protocol)
			}
			if host != tt.host {
				t.Errorf("host: got %q, want %q", host, tt.host)
			}
			if port != tt.port {
				t.Errorf("port: got %q, want %q", port, tt.port)
			}
			if secure != tt.secure {
				t.Errorf("secure: got %v, want %v", secure, tt.secure)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// parseTLSConfig
// ---------------------------------------------------------------------------

// helper: generate a self-signed CA + leaf cert/key pair on disk.
func generateTestCerts(t *testing.T, dir string) (caFile, certFile, keyFile string) {
	t.Helper()

	// CA key & cert
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caFile = filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0644); err != nil {
		t.Fatal(err)
	}

	// Leaf key & cert (signed by CA)
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "test-leaf"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, caTemplate, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	certFile = filepath.Join(dir, "cert.pem")
	if err := os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}), 0644); err != nil {
		t.Fatal(err)
	}

	keyDER, err := x509.MarshalECPrivateKey(leafKey)
	if err != nil {
		t.Fatal(err)
	}
	keyFile = filepath.Join(dir, "key.pem")
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0644); err != nil {
		t.Fatal(err)
	}

	return caFile, certFile, keyFile
}

func TestParseTLSConfig(t *testing.T) {
	dir := t.TempDir()
	caFile, certFile, keyFile := generateTestCerts(t, dir)

	t.Run("empty config", func(t *testing.T) {
		cfg := &Config{}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tlsCfg.InsecureSkipVerify {
			t.Error("InsecureSkipVerify should be false")
		}
		if tlsCfg.ServerName != "" {
			t.Errorf("ServerName should be empty, got %q", tlsCfg.ServerName)
		}
		if tlsCfg.RootCAs != nil {
			t.Error("RootCAs should be nil")
		}
		if len(tlsCfg.Certificates) != 0 {
			t.Error("Certificates should be empty")
		}
	})

	t.Run("insecure skip verify", func(t *testing.T) {
		cfg := &Config{TLSInsecureSkipVerify: true}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !tlsCfg.InsecureSkipVerify {
			t.Error("InsecureSkipVerify should be true")
		}
	})

	t.Run("server name override", func(t *testing.T) {
		cfg := &Config{TLSServerNameOverride: "custom.host"}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tlsCfg.ServerName != "custom.host" {
			t.Errorf("ServerName: got %q, want %q", tlsCfg.ServerName, "custom.host")
		}
	})

	t.Run("CA certificate", func(t *testing.T) {
		cfg := &Config{TLSCAFile: caFile}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tlsCfg.RootCAs == nil {
			t.Fatal("RootCAs should not be nil")
		}
	})

	t.Run("client certificate", func(t *testing.T) {
		cfg := &Config{TLSCertFile: certFile, TLSKeyFile: keyFile}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(tlsCfg.Certificates) != 1 {
			t.Errorf("expected 1 client cert, got %d", len(tlsCfg.Certificates))
		}
	})

	t.Run("full TLS config", func(t *testing.T) {
		cfg := &Config{
			TLSCAFile:             caFile,
			TLSCertFile:           certFile,
			TLSKeyFile:            keyFile,
			TLSServerNameOverride: "ch.example.com",
			TLSInsecureSkipVerify: true,
		}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tlsCfg.RootCAs == nil {
			t.Error("RootCAs should not be nil")
		}
		if len(tlsCfg.Certificates) != 1 {
			t.Errorf("expected 1 client cert, got %d", len(tlsCfg.Certificates))
		}
		if tlsCfg.ServerName != "ch.example.com" {
			t.Errorf("ServerName: got %q", tlsCfg.ServerName)
		}
		if !tlsCfg.InsecureSkipVerify {
			t.Error("InsecureSkipVerify should be true")
		}
	})

	t.Run("nonexistent CA file", func(t *testing.T) {
		cfg := &Config{TLSCAFile: "/nonexistent/ca.pem"}
		_, err := parseTLSConfig(cfg)
		if err == nil {
			t.Fatal("expected error for nonexistent CA file")
		}
	})

	t.Run("invalid CA PEM", func(t *testing.T) {
		badCA := filepath.Join(dir, "bad-ca.pem")
		if err := os.WriteFile(badCA, []byte("not a certificate"), 0644); err != nil {
			t.Fatal(err)
		}
		cfg := &Config{TLSCAFile: badCA}
		_, err := parseTLSConfig(cfg)
		if err == nil {
			t.Fatal("expected error for invalid CA PEM")
		}
	})

	t.Run("nonexistent client cert", func(t *testing.T) {
		cfg := &Config{TLSCertFile: "/nonexistent/cert.pem", TLSKeyFile: keyFile}
		_, err := parseTLSConfig(cfg)
		if err == nil {
			t.Fatal("expected error for nonexistent client cert")
		}
	})

	t.Run("cert without key is ignored", func(t *testing.T) {
		// Only TLSCertFile set, TLSKeyFile empty → should not load client cert
		cfg := &Config{TLSCertFile: certFile}
		tlsCfg, err := parseTLSConfig(cfg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(tlsCfg.Certificates) != 0 {
			t.Error("should not load client cert when key is missing")
		}
	})
}

// ---------------------------------------------------------------------------
// listSQLFiles
// ---------------------------------------------------------------------------

func TestListSQLFiles(t *testing.T) {
	t.Run("mixed files", func(t *testing.T) {
		dir := t.TempDir()
		// Create SQL and non-SQL files
		for _, name := range []string{"002_b.sql", "001_a.sql", "readme.md", "003_c.sql"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("--"), 0644); err != nil {
				t.Fatal(err)
			}
		}
		// Create a subdirectory (should be skipped)
		if err := os.Mkdir(filepath.Join(dir, "subdir"), 0755); err != nil {
			t.Fatal(err)
		}

		files, err := listSQLFiles(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := []string{"001_a.sql", "002_b.sql", "003_c.sql"}
		if len(files) != len(expected) {
			t.Fatalf("got %d files, want %d: %v", len(files), len(expected), files)
		}
		for i, f := range files {
			if f != expected[i] {
				t.Errorf("files[%d] = %q, want %q", i, f, expected[i])
			}
		}
	})

	t.Run("empty dir", func(t *testing.T) {
		dir := t.TempDir()
		files, err := listSQLFiles(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(files) != 0 {
			t.Errorf("expected no files, got %v", files)
		}
	})

	t.Run("nonexistent dir", func(t *testing.T) {
		_, err := listSQLFiles("/nonexistent/dir")
		if err == nil {
			t.Fatal("expected error for nonexistent dir")
		}
	})
}

// ---------------------------------------------------------------------------
// processSchemaDir (additional cases)
// ---------------------------------------------------------------------------

func TestProcessSchemaDir_Subdirectories(t *testing.T) {
	schemaDir := t.TempDir()
	subDir := filepath.Join(schemaDir, "sub")
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(subDir, "001_nested.sql"),
		[]byte("CREATE DATABASE IF NOT EXISTS ${DATABASE};"),
		0644,
	); err != nil {
		t.Fatal(err)
	}

	tempDir, err := processSchemaDir(schemaDir, "testdb", map[string]string{"TABLES_TTL": "toIntervalHour(48)"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	got, err := os.ReadFile(filepath.Join(tempDir, "sub", "001_nested.sql"))
	if err != nil {
		t.Fatalf("nested file not found: %v", err)
	}
	expected := "CREATE DATABASE IF NOT EXISTS testdb;"
	if string(got) != expected {
		t.Errorf("got %q, want %q", string(got), expected)
	}
}

func TestProcessSchemaDir_MultipleReplacements(t *testing.T) {
	schemaDir := t.TempDir()
	content := "${DATABASE}.t1 TTL ${TABLES_TTL} ${DATABASE}.t2 TTL ${TABLES_TTL}"
	if err := os.WriteFile(filepath.Join(schemaDir, "001.sql"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	tempDir, err := processSchemaDir(schemaDir, "db", map[string]string{"TABLES_TTL": "toIntervalDay(7)"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	got, err := os.ReadFile(filepath.Join(tempDir, "001.sql"))
	if err != nil {
		t.Fatal(err)
	}
	expected := "db.t1 TTL toIntervalDay(7) db.t2 TTL toIntervalDay(7)"
	if string(got) != expected {
		t.Errorf("got %q, want %q", string(got), expected)
	}
}

func TestProcessSchemaDir_NoMacros(t *testing.T) {
	schemaDir := t.TempDir()
	content := "SELECT 1;"
	if err := os.WriteFile(filepath.Join(schemaDir, "001.sql"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	tempDir, err := processSchemaDir(schemaDir, "db", map[string]string{"TABLES_TTL": "toIntervalDay(30)"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	got, err := os.ReadFile(filepath.Join(tempDir, "001.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Errorf("content should be unchanged: got %q", string(got))
	}
}

func TestProcessSchemaDir_NonexistentDir(t *testing.T) {
	_, err := processSchemaDir("/nonexistent/schema", "db", map[string]string{"TABLES_TTL": "toIntervalDay(30)"})
	if err == nil {
		t.Fatal("expected error for nonexistent schema dir")
	}
}

// ---------------------------------------------------------------------------
// per-signal TTL resolution + reconcile helpers
// ---------------------------------------------------------------------------

func TestLoadConfig_PerSignalTTL(t *testing.T) {
	dir := t.TempDir()
	os.Args = []string{"migrate", dir}
	t.Setenv("HYPERDX_OTEL_EXPORTER_TABLES_TTL", "30d")
	t.Setenv("HYPERDX_OTEL_EXPORTER_LOGS_TTL", "180d")
	t.Setenv("HYPERDX_OTEL_EXPORTER_TRACES_TTL", "180d")
	t.Setenv("HYPERDX_OTEL_EXPORTER_RECONCILE_TABLE_TTL", "true")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.LogsTTL != "180d" || cfg.TracesTTL != "180d" {
		t.Errorf("per-signal override not applied: logs=%q traces=%q", cfg.LogsTTL, cfg.TracesTTL)
	}
	// Not individually set -> fall back to TABLES_TTL.
	if cfg.MetricsTTL != "30d" || cfg.SessionsTTL != "30d" {
		t.Errorf("fallback to TABLES_TTL failed: metrics=%q sessions=%q", cfg.MetricsTTL, cfg.SessionsTTL)
	}
	if !cfg.ReconcileTableTTL {
		t.Error("ReconcileTableTTL should be true")
	}
}

func TestClassifySignal(t *testing.T) {
	cases := map[string]string{
		"otel_logs":                 "LOGS_TTL",
		"otel_logs_kv_rollup_15m":   "LOGS_TTL",
		"otel_traces":               "TRACES_TTL",
		"otel_traces_kv_rollup_15m": "TRACES_TTL",
		"otel_metrics_sum":          "METRICS_TTL",
		"otel_metrics_gauge":        "METRICS_TTL",
		"hyperdx_sessions":          "SESSIONS_TTL",
	}
	for table, want := range cases {
		if got, ok := classifySignal(table); !ok || got != want {
			t.Errorf("classifySignal(%q) = %q,%v; want %q,true", table, got, ok, want)
		}
	}
	// metrics_ts is the PromQL TimeSeries table (no otel_ prefix, no TTL) and must
	// NOT be classified; some_other_table is unmanaged.
	for _, name := range []string{"metrics_ts", "some_other_table"} {
		if _, ok := classifySignal(name); ok {
			t.Errorf("classifySignal(%q) should return ok=false", name)
		}
	}
}

func TestExtractTTLExpr(t *testing.T) {
	cases := []struct {
		name, query, want string
		ok                bool
	}{
		{
			name:  "trailing SETTINGS",
			query: "CREATE TABLE default.otel_logs (Timestamp DateTime64(9)) ENGINE = MergeTree ORDER BY Timestamp TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192",
			want:  "toDateTime(Timestamp) + toIntervalDay(30)", ok: true,
		},
		{
			name:  "TTL is the final clause (no SETTINGS)",
			query: "CREATE TABLE default.otel_traces (Timestamp DateTime) ENGINE = MergeTree ORDER BY Timestamp TTL toDate(Timestamp) + toIntervalDay(30)",
			want:  "toDate(Timestamp) + toIntervalDay(30)", ok: true,
		},
		{
			name:  "column-level TTL earlier; table-level TTL wins",
			query: "CREATE TABLE default.otel_logs (Timestamp DateTime, Body String TTL Timestamp + toIntervalDay(1)) ENGINE = MergeTree ORDER BY Timestamp TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS ttl_only_drop_parts = 1",
			want:  "toDateTime(Timestamp) + toIntervalDay(30)", ok: true,
		},
		{
			name:  "no TTL clause",
			query: "CREATE TABLE x (a Int) ENGINE = MergeTree ORDER BY a", ok: false,
		},
	}
	for _, c := range cases {
		got, ok := extractTTLExpr(c.query)
		if ok != c.ok || (c.ok && got != c.want) {
			t.Errorf("%s: extractTTLExpr = %q,%v; want %q,%v", c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestIntervalSeconds(t *testing.T) {
	cases := map[string]int64{
		"toIntervalDay(30)":    30 * 86400,
		"toIntervalDay(180)":   180 * 86400,
		"toIntervalHour(12)":   12 * 3600,
		"toIntervalMinute(90)": 90 * 60,
		"toIntervalSecond(90)": 90,
		"INTERVAL 7 DAY":       7 * 86400, // ClickHouse-rendered form
		"INTERVAL 30 DAYS":     30 * 86400,
	}
	for term, want := range cases {
		if got, ok := intervalSeconds(term); !ok || got != want {
			t.Errorf("intervalSeconds(%q) = %d,%v; want %d", term, got, ok, want)
		}
	}
	if _, ok := intervalSeconds("toDateTime(Timestamp)"); ok {
		t.Error("expected ok=false when no interval present")
	}
}

func TestPlanTTLReconcile(t *testing.T) {
	ttlExprs := map[string]string{
		"LOGS_TTL": "toIntervalDay(180)", "TRACES_TTL": "toIntervalDay(180)",
		"METRICS_TTL": "toIntervalDay(30)", "SESSIONS_TTL": "toIntervalDay(30)",
	}
	ct := func(table, ttl string) string {
		return "CREATE TABLE default." + table + " (Timestamp DateTime) ENGINE = MergeTree ORDER BY Timestamp TTL " + ttl + " SETTINGS index_granularity = 8192"
	}
	cases := []struct {
		name, table, createQuery string
		wantAction               ttlAction
		wantNewTTL               string
		wantExtend               bool
	}{
		{"unmanaged table", "some_table", ct("some_table", "toDateTime(Timestamp) + toIntervalDay(30)"), ttlSkip, "", false},
		{"already at desired retention", "otel_metrics_sum", ct("otel_metrics_sum", "toDateTime(TimeUnix) + toIntervalDay(30)"), ttlSkip, "", false},
		{"diff-guard equal across syntaxes", "otel_logs", ct("otel_logs", "toDateTime(Timestamp) + INTERVAL 180 DAY"), ttlSkip, "", false},
		{"extend logs 30d -> 180d", "otel_logs", ct("otel_logs", "toDateTime(Timestamp) + toIntervalDay(30)"), ttlAlter, "toDateTime(Timestamp) + toIntervalDay(180)", true},
		{"shrink metrics 90d -> 30d", "otel_metrics_gauge", ct("otel_metrics_gauge", "toDateTime(TimeUnix) + toIntervalDay(90)"), ttlAlter, "toDateTime(TimeUnix) + toIntervalDay(30)", false},
		{"traces anchor preserved", "otel_traces", ct("otel_traces", "toDate(Timestamp) + toIntervalDay(30)"), ttlAlter, "toDate(Timestamp) + toIntervalDay(180)", true},
		{"rewrite CH-rendered INTERVAL form", "otel_logs", ct("otel_logs", "toDateTime(Timestamp) + INTERVAL 30 DAY"), ttlAlter, "toDateTime(Timestamp) + toIntervalDay(180)", true},
		{"managed table with no TTL", "otel_logs", "CREATE TABLE default.otel_logs (Timestamp DateTime) ENGINE = MergeTree ORDER BY Timestamp", ttlWarn, "", false},
		{"multi-interval TTL refused", "otel_logs", ct("otel_logs", "toDateTime(Timestamp) + toIntervalDay(7) TO VOLUME 'cold', toDateTime(Timestamp) + toIntervalDay(30)"), ttlWarn, "", false},
	}
	for _, c := range cases {
		got := planTTLReconcile(c.table, c.createQuery, ttlExprs)
		if got.action != c.wantAction {
			t.Errorf("%s: action = %v; want %v (reason: %s)", c.name, got.action, c.wantAction, got.reason)
			continue
		}
		if c.wantAction == ttlAlter && (got.newTTL != c.wantNewTTL || got.extend != c.wantExtend) {
			t.Errorf("%s: newTTL=%q extend=%v; want %q, %v", c.name, got.newTTL, got.extend, c.wantNewTTL, c.wantExtend)
		}
	}

	// A signal with no configured TTL entry must warn, not silently skip.
	if got := planTTLReconcile("otel_logs", ct("otel_logs", "toDateTime(Timestamp) + toIntervalDay(30)"), map[string]string{}); got.action != ttlWarn {
		t.Errorf("missing ttlExprs entry: action = %v; want ttlWarn", got.action)
	}
}

func TestProcessSchemaDir_PerSignalMacros(t *testing.T) {
	schemaDir := t.TempDir()
	content := "logs ${LOGS_TTL} traces ${TRACES_TTL} metrics ${METRICS_TTL} sessions ${SESSIONS_TTL}"
	if err := os.WriteFile(filepath.Join(schemaDir, "001.sql"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	tempDir, err := processSchemaDir(schemaDir, "db", map[string]string{
		"LOGS_TTL":     "toIntervalDay(180)",
		"TRACES_TTL":   "toIntervalDay(180)",
		"METRICS_TTL":  "toIntervalDay(30)",
		"SESSIONS_TTL": "toIntervalDay(30)",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)
	got, err := os.ReadFile(filepath.Join(tempDir, "001.sql"))
	if err != nil {
		t.Fatal(err)
	}
	want := "logs toIntervalDay(180) traces toIntervalDay(180) metrics toIntervalDay(30) sessions toIntervalDay(30)"
	if string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

// ---------------------------------------------------------------------------
// parseTTLDuration / ttlToClickHouseInterval (existing tests below)
// ---------------------------------------------------------------------------

func TestParseTTLDuration(t *testing.T) {
	tests := []struct {
		input    string
		expected time.Duration
		wantErr  bool
	}{
		// Days
		{"1d", 24 * time.Hour, false},
		{"30d", 30 * 24 * time.Hour, false},
		{"365d", 365 * 24 * time.Hour, false},

		// Standard Go durations
		{"720h", 720 * time.Hour, false},
		{"48h", 48 * time.Hour, false},
		{"90m", 90 * time.Minute, false},
		{"3600s", 3600 * time.Second, false},
		{"1h30m", time.Hour + 30*time.Minute, false},

		// Errors
		{"", 0, true},
		{"abc", 0, true},
		{"d", 0, true},
		{"12.5d", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := parseTTLDuration(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("parseTTLDuration(%q) expected error, got %v", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Errorf("parseTTLDuration(%q) unexpected error: %v", tt.input, err)
				return
			}
			if got != tt.expected {
				t.Errorf("parseTTLDuration(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestTTLToClickHouseInterval(t *testing.T) {
	tests := []struct {
		input    string
		expected string
		wantErr  bool
	}{
		// Days - evenly divisible by 24h
		{"30d", "toIntervalDay(30)", false},
		{"1d", "toIntervalDay(1)", false},
		{"365d", "toIntervalDay(365)", false},
		{"720h", "toIntervalDay(30)", false},
		{"48h", "toIntervalDay(2)", false},
		{"24h", "toIntervalDay(1)", false},

		// Hours - not evenly divisible by 24h
		{"36h", "toIntervalHour(36)", false},
		{"1h", "toIntervalHour(1)", false},
		{"100h", "toIntervalHour(100)", false},

		// Minutes
		{"90m", "toIntervalMinute(90)", false},
		{"30m", "toIntervalMinute(30)", false},
		{"1h30m", "toIntervalMinute(90)", false},

		// Seconds
		{"90s", "toIntervalSecond(90)", false},
		{"1m30s", "toIntervalSecond(90)", false},

		// Errors
		{"0s", "", true},
		{"-1h", "", true},
		{"abc", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := ttlToClickHouseInterval(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ttlToClickHouseInterval(%q) expected error, got %q", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Errorf("ttlToClickHouseInterval(%q) unexpected error: %v", tt.input, err)
				return
			}
			if got != tt.expected {
				t.Errorf("ttlToClickHouseInterval(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// supportsFullTextSearch
// ---------------------------------------------------------------------------

func TestSupportsFullTextSearch(t *testing.T) {
	tests := []struct {
		name     string
		major    int
		minor    int
		expected bool
	}{
		{"26.2 exact threshold", 26, 2, true},
		{"26.3 above minor", 26, 3, true},
		{"27.0 above major", 27, 0, true},
		{"27.1 above both", 27, 1, true},
		{"26.1 below minor", 26, 1, false},
		{"26.0 below minor", 26, 0, false},
		{"25.9 below major", 25, 9, false},
		{"24.8 old version", 24, 8, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := supportsFullTextSearch(tt.major, tt.minor)
			if got != tt.expected {
				t.Errorf("supportsFullTextSearch(%d, %d) = %v, want %v", tt.major, tt.minor, got, tt.expected)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// swapLogsSchemaForCompat
// ---------------------------------------------------------------------------

func TestSwapLogsSchemaForCompat(t *testing.T) {
	t.Run("swaps compat over full text", func(t *testing.T) {
		dir := t.TempDir()
		fullTextPath := filepath.Join(dir, "00002_otel_logs.sql")
		compatPath := filepath.Join(dir, "00002_otel_logs_compat.sql")

		if err := os.WriteFile(fullTextPath, []byte("FULL TEXT SCHEMA"), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(compatPath, []byte("COMPAT SCHEMA"), 0644); err != nil {
			t.Fatal(err)
		}

		if err := swapLogsSchemaForCompat(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		// The full text path should now contain the compat content
		got, err := os.ReadFile(fullTextPath)
		if err != nil {
			t.Fatalf("failed to read swapped file: %v", err)
		}
		if string(got) != "COMPAT SCHEMA" {
			t.Errorf("expected compat content, got %q", string(got))
		}

		// The compat file should no longer exist
		if _, err := os.Stat(compatPath); !os.IsNotExist(err) {
			t.Error("compat file should have been renamed away")
		}
	})

	t.Run("works when full text file is missing", func(t *testing.T) {
		dir := t.TempDir()
		compatPath := filepath.Join(dir, "00002_otel_logs_compat.sql")

		if err := os.WriteFile(compatPath, []byte("COMPAT SCHEMA"), 0644); err != nil {
			t.Fatal(err)
		}

		if err := swapLogsSchemaForCompat(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		got, err := os.ReadFile(filepath.Join(dir, "00002_otel_logs.sql"))
		if err != nil {
			t.Fatalf("failed to read swapped file: %v", err)
		}
		if string(got) != "COMPAT SCHEMA" {
			t.Errorf("expected compat content, got %q", string(got))
		}
	})

	t.Run("errors when compat file is missing", func(t *testing.T) {
		dir := t.TempDir()
		fullTextPath := filepath.Join(dir, "00002_otel_logs.sql")

		if err := os.WriteFile(fullTextPath, []byte("FULL TEXT SCHEMA"), 0644); err != nil {
			t.Fatal(err)
		}

		err := swapLogsSchemaForCompat(dir)
		if err == nil {
			t.Fatal("expected error when compat file is missing")
		}
	})
}

// ---------------------------------------------------------------------------
// removeCompatLogsSchema
// ---------------------------------------------------------------------------

func TestRemovePromqlSchema(t *testing.T) {
	t.Run("removes existing promql schema file", func(t *testing.T) {
		dir := t.TempDir()
		promqlPath := filepath.Join(dir, "00008_otel_metrics_timeseries.sql")

		if err := os.WriteFile(promqlPath, []byte("PROMQL SCHEMA"), 0644); err != nil {
			t.Fatal(err)
		}

		if err := removePromqlSchema(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if _, err := os.Stat(promqlPath); !os.IsNotExist(err) {
			t.Error("promql schema file should have been removed")
		}
	})

	t.Run("no error when promql schema file does not exist", func(t *testing.T) {
		dir := t.TempDir()

		if err := removePromqlSchema(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("preserves other files", func(t *testing.T) {
		dir := t.TempDir()
		otherPath := filepath.Join(dir, "00001_other.sql")
		promqlPath := filepath.Join(dir, "00008_otel_metrics_timeseries.sql")

		if err := os.WriteFile(otherPath, []byte("OTHER"), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(promqlPath, []byte("PROMQL"), 0644); err != nil {
			t.Fatal(err)
		}

		if err := removePromqlSchema(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if _, err := os.Stat(otherPath); err != nil {
			t.Error("other file should still exist")
		}
		if _, err := os.Stat(promqlPath); !os.IsNotExist(err) {
			t.Error("promql schema file should have been removed")
		}
	})
}

func TestRemoveCompatLogsSchema(t *testing.T) {
	t.Run("removes existing compat file", func(t *testing.T) {
		dir := t.TempDir()
		compatPath := filepath.Join(dir, "00002_otel_logs_compat.sql")

		if err := os.WriteFile(compatPath, []byte("COMPAT SCHEMA"), 0644); err != nil {
			t.Fatal(err)
		}

		if err := removeCompatLogsSchema(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if _, err := os.Stat(compatPath); !os.IsNotExist(err) {
			t.Error("compat file should have been removed")
		}
	})

	t.Run("no error when compat file does not exist", func(t *testing.T) {
		dir := t.TempDir()

		if err := removeCompatLogsSchema(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("preserves other files", func(t *testing.T) {
		dir := t.TempDir()
		otherPath := filepath.Join(dir, "00001_other.sql")
		compatPath := filepath.Join(dir, "00002_otel_logs_compat.sql")

		if err := os.WriteFile(otherPath, []byte("OTHER"), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(compatPath, []byte("COMPAT"), 0644); err != nil {
			t.Fatal(err)
		}

		if err := removeCompatLogsSchema(dir); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if _, err := os.Stat(otherPath); err != nil {
			t.Error("other file should still exist")
		}
	})
}

// ---------------------------------------------------------------------------
// processSchemaDir
// ---------------------------------------------------------------------------

func TestProcessSchemaDir(t *testing.T) {
	// Create a temp schema directory with a test SQL file
	schemaDir := t.TempDir()
	sqlContent := `CREATE TABLE IF NOT EXISTS ${DATABASE}.test_table
(col1 String)
ENGINE = MergeTree
ORDER BY col1
TTL toDateTime(col1) + ${TABLES_TTL}
SETTINGS ttl_only_drop_parts = 1;`

	if err := os.WriteFile(filepath.Join(schemaDir, "001_test.sql"), []byte(sqlContent), 0644); err != nil {
		t.Fatal(err)
	}

	tempDir, err := processSchemaDir(schemaDir, "mydb", map[string]string{"TABLES_TTL": "toIntervalDay(30)"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	got, err := os.ReadFile(filepath.Join(tempDir, "001_test.sql"))
	if err != nil {
		t.Fatal(err)
	}

	expected := `CREATE TABLE IF NOT EXISTS mydb.test_table
(col1 String)
ENGINE = MergeTree
ORDER BY col1
TTL toDateTime(col1) + toIntervalDay(30)
SETTINGS ttl_only_drop_parts = 1;`

	if string(got) != expected {
		t.Errorf("processSchemaDir output mismatch\ngot:\n%s\nwant:\n%s", string(got), expected)
	}
}
