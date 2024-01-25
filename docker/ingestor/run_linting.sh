#!/bin/bash

directory="./docker/ingestor"

export AGGREGATOR_API_URL="http://aggregator:8001"
export GO_PARSER_API_URL="http://go-parser:7777"

vector validate --no-environment $directory/*.toml
