#!/bin/bash
set -e

clickhouse client -n <<-EOSQL
  CREATE DATABASE docker;
  CREATE TABLE docker.docker (x Int32) ENGINE = Log;
EOSQL
