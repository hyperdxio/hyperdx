package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"slices"
	"time"

	"github.com/DataDog/go-sqllexer"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/hyperdxio/opentelemetry-go/otelzap"
	"github.com/hyperdxio/opentelemetry-logs-go/exporters/otlp/otlplogs"
	sdk "github.com/hyperdxio/opentelemetry-logs-go/sdk/logs"
	"github.com/hyperdxio/otel-config-go/otelconfig"
	"github.com/xwb1989/sqlparser"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

var (
	VERSION        = "0.0.1"
	PORT           = os.Getenv("PORT")
	AGGREGATOR_URL = os.Getenv("AGGREGATOR_API_URL")
	SERVICE_NAME   = os.Getenv("OTEL_SERVICE_NAME")
	// https://opentelemetry.io/docs/specs/semconv/database/database-spans/#:~:text=db.system%20has%20the%20following%20list%20of%20well%2Dknown%20values
	NON_SQL_DB_SYSTEMS = []string{
		"adabas",
		"filemaker",
		"coldfusion",
		"cassandra",
		"hbase",
		"mongodb",
		"redis",
		"couchbase",
		"couchdb",
		"cosmosdb",
		"dynamodb",
		"neo4j",
		"geode",
		"elasticsearch",
		"memcached",
		"opensearch",
	}
)

type GzipJSONBinding struct {
}

func (b *GzipJSONBinding) Name() string {
	return "gzipjson"
}

func (b *GzipJSONBinding) Bind(req *http.Request, dst interface{}) error {
	r, err := gzip.NewReader(req.Body)
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dst)
}

func isSQLValid(sql string) (bool, error) {
	_, err := sqlparser.Parse(sql)
	if err != nil {
		return false, err
	}
	return true, nil
}

// attach trace id to the log
func WithTraceMetadata(ctx context.Context, logger *zap.Logger) *zap.Logger {
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		// ctx does not contain a valid span.
		// There is no trace metadata to add.
		return logger
	}
	return logger.With(
		zap.String("trace_id", spanContext.TraceID().String()),
		zap.String("span_id", spanContext.SpanID().String()),
	)
}

func main() {
	// Initialize otel config and use it across the entire app
	otelShutdown, err := otelconfig.ConfigureOpenTelemetry()
	if err != nil {
		log.Fatalf("error setting up OTel SDK - %e", err)
	}

	defer otelShutdown()

	ctx := context.Background()

	// configure opentelemetry logger provider
	logExporter, _ := otlplogs.NewExporter(ctx)
	loggerProvider := sdk.NewLoggerProvider(
		sdk.WithBatcher(logExporter),
	)

	// gracefully shutdown logger to flush accumulated signals before program finish
	defer loggerProvider.Shutdown(ctx)

	// create new logger with opentelemetry zap core and set it globally
	logger := zap.New(otelzap.NewOtelCore(loggerProvider))
	zap.ReplaceGlobals(logger)

	normalizer := sqllexer.NewNormalizer(
		sqllexer.WithCollectComments(false),
		sqllexer.WithCollectCommands(false),
		sqllexer.WithCollectTables(false),
		sqllexer.WithKeepSQLAlias(false),
	)
	router := gin.New()
	router.Use(otelgin.Middleware(SERVICE_NAME))
	router.Use(gin.Recovery()) // recover from panics
	router.Use(gin.Logger())   // log requests to stdout
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"version": VERSION,
		})
	})

	router.POST("/", func(c *gin.Context) {
		_logger := WithTraceMetadata(c.Request.Context(), logger)
		contentEncodingHeader := c.GetHeader("Content-Encoding")
		if contentEncodingHeader != "gzip" {
			_logger.Error("Error: Content-Encoding must be gzip")
			fmt.Println("Error: Content-Encoding must be gzip")
			c.JSON(http.StatusBadRequest, gin.H{"error": "Content-Encoding must be gzip"})
			return
		}

		var logs []map[string]interface{}

		if err := c.ShouldBindWith(&logs, &GzipJSONBinding{}); err != nil {
			_logger.Error("Error: ", zap.Error(err))
			fmt.Println("Error:", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "ok",
		})

		// **********************************************************
		// ****************** Parse Logs/Spans **********************
		// **********************************************************
		t1 := time.Now()
		skippedLogs := 0
		for _, log := range logs {
			dbStatement := log["b"].(map[string]interface{})["db.statement"]
			dbSystem := log["b"].(map[string]interface{})["db.system"]
			if dbStatement != nil {
				// defaults to dbStatement
				log["b"].(map[string]interface{})["db.normalized_statement"] = dbStatement
				if dbSystem != nil && slices.Contains(NON_SQL_DB_SYSTEMS, dbSystem.(string)) {
					skippedLogs++
					// fmt.Println("Skipping non-SQL DB system:", dbSystem.(string))
					continue
				}
				normalized, _, err := normalizer.Normalize(dbStatement.(string))
				if err != nil {
					fmt.Println("Error normalizing SQL:", err)
					continue
				}
				obfuscator := sqllexer.NewObfuscator()
				obfuscated := obfuscator.Obfuscate(normalized)
				log["b"].(map[string]interface{})["db.normalized_statement"] = obfuscated
			}
		}
		_logger.Info(
			"Parsed logs/spans",
			zap.Int("n", len(logs)),
			zap.Int("skipped", skippedLogs),
			zap.Int64("took", time.Since(t1).Milliseconds()),
		)
		fmt.Println("Parsing", len(logs), "logs/spans took:", time.Since(t1))

		// **********************************************************
		// ************** Send Logs Back to Aggregator **************
		// **********************************************************
		t2 := time.Now()
		jsonData, err := json.Marshal(logs)
		if err != nil {
			_logger.Error("Error marshaling JSON: ", zap.Error(err))
			fmt.Println("Error marshaling JSON:", err)
			return
		}

		retryClient := retryablehttp.NewClient()
		retryClient.RetryMax = 10

		req, err := retryablehttp.NewRequest("POST", AGGREGATOR_URL, bytes.NewBuffer(jsonData))
		if err != nil {
			_logger.Error("Error creating request: ", zap.Error(err))
			fmt.Println("Error creating request:", err)
			return
		}

		req.Header.Set("Content-Type", "application/json")

		resp, err := retryClient.Do(req)
		if err != nil {
			_logger.Error("Error sending request: ", zap.Error(err))
			fmt.Println("Error sending request:", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			_logger.Error("Unexpected response status: ", zap.String("status", resp.Status))
			fmt.Println("Unexpected response status:", resp.Status)
			return
		}

		_logger.Info(
      "Sent logs/spans",
      zap.Int("n", len(logs)),
      zap.Int64("took", time.Since(t2).Milliseconds()),
    )
		fmt.Println("Sent", len(logs), "logs/spans took:", time.Since(t2))
	})

	if err := http.ListenAndServe(":"+PORT, router); err != nil {
		panic(err)
	}
}
