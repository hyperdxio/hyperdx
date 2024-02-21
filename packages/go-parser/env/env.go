package env

import "os"

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
