## base #############################################################################################
FROM node:22.16.0-alpine AS base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./tsconfig.base.json ./
# Only copy package.json for workspace resolution during yarn install;
# full source is copied in the build stages that need it.
COPY ./packages/common-utils/package.json ./packages/common-utils/package.json
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/tsconfig.build.json ./packages/api/package.json ./packages/api/
COPY ./packages/api/bin ./packages/api/bin
# Use BuildKit cache mount to persist Yarn download cache across builds,
# so unchanged packages aren't re-downloaded even when yarn.lock changes.
RUN --mount=type=cache,target=/root/.yarn/berry/cache,id=yarn-cache \
    yarn install --mode=skip-build && yarn cache clean


## dev #############################################################################################

FROM base AS dev

COPY ./packages/common-utils ./packages/common-utils

EXPOSE 8000

ENTRYPOINT ["npx", "nx", "run", "@hyperdx/api:dev"]


## common-utils-builder ############################################################################
# Separate stage so common-utils build is cached independently of API source changes.

FROM base AS common-utils-builder

COPY ./packages/common-utils ./packages/common-utils
RUN yarn workspace @hyperdx/common-utils run build


## builder #########################################################################################

FROM base AS builder

# Copy pre-built common-utils from its dedicated build stage
COPY --from=common-utils-builder /app/packages/common-utils ./packages/common-utils

COPY ./packages/api/src ./packages/api/src
RUN yarn workspace @hyperdx/api run build
RUN --mount=type=cache,target=/root/.yarn/berry/cache,id=yarn-cache \
    rm -rf node_modules && yarn workspaces focus @hyperdx/api --production


## prod ############################################################################################

FROM node:22.16.0-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX API" \
      org.opencontainers.image.description="HyperDX API service for observability platform" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV OTEL_RESOURCE_ATTRIBUTES="service.version=$CODE_VERSION"
ENV NODE_ENV production

ARG PORT

ENV PORT=$PORT

EXPOSE ${PORT}

USER node

WORKDIR /app

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/api/build ./packages/api/build
COPY --chown=node:node --from=builder /app/packages/api/bin ./packages/api/bin
COPY --chown=node:node --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8000)+'/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["./packages/api/bin/hyperdx", "api"]
