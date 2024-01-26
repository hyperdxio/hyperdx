#!/bin/bash

yarn changeset version

# update root package.json version
API_LATEST_VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' ./packages/api/package.json)
APP_LATEST_VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' ./packages/app/package.json)

# check if api and app versions are the same
if [ "$API_LATEST_VERSION" != "$APP_LATEST_VERSION" ]; then
  echo "API and APP versions are not the same. Please check and try again."
  exit 1
fi

# update root package.json version
sed -i '' -e "s/\"version\": \".*\"/\"version\": \"$API_LATEST_VERSION\"/g" ./package.json
echo "Updated root package.json version to $API_LATEST_VERSION"

# update .env IMAGE_VERSION
sed -i '' -e "s/IMAGE_VERSION=.*/IMAGE_VERSION=$API_LATEST_VERSION/g" ./.env
echo "Updated .env IMAGE_VERSION to $API_LATEST_VERSION"

echo "Run 'make release' to publish new version to GHCR"
