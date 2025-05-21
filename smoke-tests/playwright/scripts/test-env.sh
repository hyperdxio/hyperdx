#!/bin/bash

# Function to cleanup on exit
cleanup() {
    echo "Cleaning up test environment..."
    docker compose -f ../docker-compose.yml down
}

# Set up trap to ensure cleanup happens on script exit
trap cleanup EXIT

# Start the test environment
echo "Starting test environment..."
docker compose -f ../docker-compose.yml up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Run the tests
echo "Running tests..."
npx playwright test ../tests