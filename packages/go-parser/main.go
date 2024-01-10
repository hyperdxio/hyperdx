package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/DataDog/go-sqllexer"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/xwb1989/sqlparser"
)

const (
	VERSION        = "0.0.1"
	PORT           = "7777"
	AGGREGATOR_URL = "http://aggregator:8001"
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

func main() {
	normalizer := sqllexer.NewNormalizer(
		sqllexer.WithCollectComments(false),
		sqllexer.WithCollectCommands(false),
		sqllexer.WithCollectTables(false),
		sqllexer.WithKeepSQLAlias(false),
	)
	router := gin.New()
	router.Use(gin.Recovery()) // recover from panics
	router.Use(gin.Logger())   // log requests to stdout
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"version": VERSION,
		})
	})

	router.POST("/", func(c *gin.Context) {
		contentEncodingHeader := c.GetHeader("Content-Encoding")
		if contentEncodingHeader != "gzip" {
			fmt.Println("Error: Content-Encoding must be gzip")
			c.JSON(http.StatusBadRequest, gin.H{"error": "Content-Encoding must be gzip"})
			return
		}

		var logs []map[string]interface{}

		if err := c.ShouldBindWith(&logs, &GzipJSONBinding{}); err != nil {
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
		for _, log := range logs {
			dbStatement := log["b"].(map[string]interface{})["db.statement"]
			if dbStatement != nil {
				if valid, err := isSQLValid(dbStatement.(string)); !valid {
					fmt.Println("Error parsing SQL:", err)
					continue
				}
				normalized, _, err := normalizer.Normalize(dbStatement.(string))
				if err != nil {
					fmt.Println("Error normalizing SQL:", err)
					continue
				}
				obfuscator := sqllexer.NewObfuscator()
				obfuscated := obfuscator.Obfuscate(normalized)
				log["b"].(map[string]interface{})["db.sql.normalized"] = obfuscated
			}
		}

		// **********************************************************
		// ************** Send Logs Back to Aggregator **************
		// **********************************************************
		jsonData, err := json.Marshal(logs)
		if err != nil {
			fmt.Println("Error marshaling JSON:", err)
			return
		}

    retryClient := retryablehttp.NewClient()
    retryClient.RetryMax = 10

		req, err := retryablehttp.NewRequest("POST", AGGREGATOR_URL, bytes.NewBuffer(jsonData))
		if err != nil {
			fmt.Println("Error creating request:", err)
			return
		}

		req.Header.Set("Content-Type", "application/json")

		resp, err := retryClient.Do(req)
		if err != nil {
			fmt.Println("Error sending request:", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			fmt.Println("Unexpected response status:", resp.Status)
			return
		}

		fmt.Println(len(logs), "Logs sent successfully")
	})

	if err := http.ListenAndServe(":"+PORT, router); err != nil {
		panic(err)
	}
}
