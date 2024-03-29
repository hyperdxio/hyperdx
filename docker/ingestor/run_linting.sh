#!/bin/bash

directory="./docker/ingestor"

export AGGREGATOR_API_URL="http://aggregator:8001"
export GO_PARSER_API_URL="http://go-parser:7777"
export HYPERDX_API_KEY="tacocat"

vector validate --no-environment $directory/*.toml
