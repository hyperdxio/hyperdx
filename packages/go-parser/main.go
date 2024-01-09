package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/DataDog/go-sqllexer"
	"github.com/gin-gonic/gin"
)

const (
	VERSION = "0.0.1"
	PORT    = "7777"
)

// This is a simple command line tool that reads multiple newline-separated SQL queries from stdin
// and normalizes and obfuscates them, then prints them one at a time (newline separated) to stdout.
// Example:
// $ echo "SELECT * FROM foo as foo_table limit 1; SELECT * FROM /* sql comment */ bar where name = 'bob';" | go run sql_obfuscator.go
// SELECT * FROM foo limit ?; SELECT * FROM bar where name = ?
func main() {
	normalizer := sqllexer.NewNormalizer(
		sqllexer.WithCollectComments(false),
		sqllexer.WithCollectCommands(false),
		sqllexer.WithCollectTables(false),
		sqllexer.WithKeepSQLAlias(false),
	)
	router := gin.New()
	router.Use(gin.Recovery()) // recover from panics
  router.Use(gin.Logger()) // log requests to stdout
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"version": VERSION,
		})
	})

	router.POST("/parse", func(c *gin.Context) {
		normalized, _, err := normalizer.Normalize("select * from foo as foo_table limit 1;")
		if err != nil {
			// write to stderr
			fmt.Fprintf(os.Stderr, "error: %s\n", err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": err,
			})
			return
		}
		obfuscator := sqllexer.NewObfuscator()
		obfuscated := obfuscator.Obfuscate(normalized)
		fmt.Printf("%s\n", obfuscated)
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	if err := http.ListenAndServe(":"+PORT, router); err != nil {
		panic(err)
	}
}
