package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/DataDog/go-sqllexer"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	for {
		query, err := reader.ReadString('\n')
		if err != nil {
			// write to stderr
			fmt.Fprintf(os.Stderr, "error: %s\n", err)
			os.Exit(1)
		}
		stripped_string := strings.Trim(query, " \t\r\n")
		if stripped_string == "" {
			// skip empty entries
			continue
		}

		normalizer := sqllexer.NewNormalizer(
			sqllexer.WithCollectComments(false),
			sqllexer.WithCollectCommands(false),
			sqllexer.WithCollectTables(false),
			sqllexer.WithKeepSQLAlias(false),
		)

		normalized, _, err := normalizer.Normalize(query)
		if err != nil {
			// write to stderr
			fmt.Fprintf(os.Stderr, "error: %s\n", err)
			os.Exit(1)
		}

		obfuscator := sqllexer.NewObfuscator()
		obfuscated := obfuscator.Obfuscate(normalized)
		fmt.Printf("%s\n", obfuscated)
	}
}
