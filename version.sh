#!/bin/bash

# update packages versions
npx changeset version

# upload yarn.lock
yarn

# update root package.json version
API_LATEST_VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' ./packages/api/package.json)
APP_LATEST_VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' ./packages/app/package.json)

# check if api and app versions are the same
if [ "$API_LATEST_VERSION" != "$APP_LATEST_VERSION" ]; then
  echo "API and APP versions are not the same. Please check and try again."
  exit 1
fi

# update root package.json version
sed -i '' 's/\("version":\s*"\)[^"]*/\"$API_LATEST_VERSION\"/' package.json
echo "Updated root package.json version to $API_LATEST_VERSION"

# update tags in .env 
sed -i '' -e "s/CODE_VERSION=.*/CODE_VERSION=$API_LATEST_VERSION/g" ./.env
echo "Updated .env CODE_VERSION to $API_LATEST_VERSION"

sed -i '' -e "s/IMAGE_VERSION_SUB_TAG=.*/IMAGE_VERSION_SUB_TAG=.${API_LATEST_VERSION#*.}/g" ./.env
echo "Updated .env IMAGE_VERSION_SUB_TAG to .${API_LATEST_VERSION#*.}"

echo "Run 'make release' to publish images"
