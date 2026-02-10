package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

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

	tempDir, err := processSchemaDir(schemaDir, "mydb", "toIntervalDay(30)")
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
