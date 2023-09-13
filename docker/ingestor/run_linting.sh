#!/bin/bash

directory="./docker/ingestor"

vector validate --no-environment $directory/*.toml
