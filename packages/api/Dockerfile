## base #############################################################################################
FROM node:22.16.0-alpine AS base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/package.json ./packages/api/
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

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV NODE_ENV production

ARG PORT

ENV PORT=$PORT

EXPOSE ${PORT}

USER node

WORKDIR /app

COPY --chown=node:node --from=builder /app/packages/api/dist ./

ENTRYPOINT ["node", "-r", "./tracing", "./index"]
