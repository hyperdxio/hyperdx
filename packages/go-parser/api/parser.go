package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"go-parser/env"
	"io"
	"net/http"
	"slices"
	"time"

	"github.com/DataDog/go-sqllexer"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-retryablehttp"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
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

func Parser(router *gin.RouterGroup, log *zap.Logger) {
	router.POST("/", func(ctx *gin.Context) {
		logger := WithTraceMetadata(ctx.Request.Context(), log)
		contentEncodingHeader := ctx.GetHeader("Content-Encoding")
		if contentEncodingHeader != "gzip" {
			logger.Error("Error: Content-Encoding must be gzip")
			fmt.Println("Error: Content-Encoding must be gzip")
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "Content-Encoding must be gzip"})
			return
		}

		var logs []map[string]interface{}

		if err := ctx.ShouldBindWith(&logs, &GzipJSONBinding{}); err != nil {
			logger.Error("Error: ", zap.Error(err))
			fmt.Println("Error:", err)
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		ctx.JSON(http.StatusOK, gin.H{
			"message": "ok",
		})

		// **********************************************************
		// ****************** Parse Logs/Spans **********************
		// **********************************************************
		t1 := time.Now()
		normalizer := sqllexer.NewNormalizer(
			sqllexer.WithCollectComments(false),
			sqllexer.WithCollectCommands(false),
			sqllexer.WithCollectTables(false),
			sqllexer.WithKeepSQLAlias(false),
		)
		skippedLogs := 0
		for _, log := range logs {
			dbStatement := log["b"].(map[string]interface{})["db.statement"]
			dbSystem := log["b"].(map[string]interface{})["db.system"]
			if dbStatement != nil {
				// defaults to dbStatement
				log["b"].(map[string]interface{})["db.normalized_statement"] = dbStatement
				if dbSystem != nil && slices.Contains(env.NON_SQL_DB_SYSTEMS, dbSystem.(string)) {
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

		logger.Info(
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
			logger.Error("Error marshaling JSON: ", zap.Error(err))
			fmt.Println("Error marshaling JSON:", err)
			return
		}

		retryClient := retryablehttp.NewClient()
		retryClient.RetryMax = 10

		req, err := retryablehttp.NewRequest("POST", env.AGGREGATOR_URL, bytes.NewBuffer(jsonData))
		if err != nil {
			logger.Error("Error creating request: ", zap.Error(err))
			fmt.Println("Error creating request:", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := retryClient.Do(req)
		if err != nil {
			logger.Error("Error sending request: ", zap.Error(err))
			fmt.Println("Error sending request:", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			logger.Error("Unexpected response status: ", zap.String("status", resp.Status))
			fmt.Println("Unexpected response status:", resp.Status)
			return
		}

		logger.Info(
			"Sent logs/spans",
			zap.Int("n", len(logs)),
			zap.Int64("took", time.Since(t2).Milliseconds()),
		)
		fmt.Println("Sent", len(logs), "logs/spans took:", time.Since(t2))
	})
}
