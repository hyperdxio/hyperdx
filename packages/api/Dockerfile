## base #############################################################################################
FROM node:22.16.0-alpine AS base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./tsconfig.base.json ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/tsconfig.build.json ./packages/api/package.json ./packages/api/
RUN yarn install --mode=skip-build && yarn cache clean


## dev #############################################################################################

FROM base AS dev

EXPOSE 8000

ENTRYPOINT ["npx", "nx", "run", "@hyperdx/api:dev"]


## builder #########################################################################################

FROM base AS builder

ENV NX_DAEMON false

COPY ./packages/api/src ./packages/api/src
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/api
RUN rm -rf node_modules && yarn workspaces focus @hyperdx/api --production


## prod ############################################################################################

FROM node:22.16.0-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX API" \
      org.opencontainers.image.description="HyperDX API service for observability platform" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV production

ARG PORT

ENV PORT=$PORT

EXPOSE ${PORT}

USER node

WORKDIR /app

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/api/build ./packages/api/build
COPY --chown=node:node --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8000)+'/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["node", "-r", "@hyperdx/node-opentelemetry/build/src/tracing", "./packages/api/build/index.js"]
