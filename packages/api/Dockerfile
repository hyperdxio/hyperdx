## base #############################################################################################
FROM node:18.15.0-alpine AS base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc yarn.lock ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/package.json ./
RUN yarn install --frozen-lockfile && yarn cache clean


## dev ###############################################################################################

FROM base AS dev

EXPOSE 8000

ENTRYPOINT ["yarn"]
CMD ["dev"]


## builder #########################################################################################

FROM base AS builder

COPY ./packages/api/src ./src
RUN yarn run build


## prod ############################################################################################

FROM node:18.15.0-alpine AS prod

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION

EXPOSE 8000

USER node

WORKDIR /app

COPY --chown=node:node --from=builder /app/build ./build
COPY --chown=node:node --from=base /app/node_modules ./node_modules

ENTRYPOINT ["node", "-r", "@hyperdx/node-opentelemetry/build/src/tracing", "./build/index.js"]
